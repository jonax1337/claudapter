import type { FallbackRule } from './config.js';
import type { Model } from './models.js';
import { RouteNoticeBus, switchReason, type RecoveryCause, type RouteScope } from './route-events.js';

export interface Identity { session?: string; agent?: string; requestClass?: string; prompt?: string }
/** `reason` keeps the gateway's internal label; route notices translate it with `switchReason`. */
export interface RouteState { requested: string; actual: string; provider: string; until: number; reason: string }
export interface RouteSwitch { requested: string; actual: string; provider: string; cooldownMs: number; reason: string; retryAfterMs?: number }

const MAIN_SCOPE = 'main';

function scopeOf(key: string): RouteScope {
  const separator = key.indexOf('/');
  const agent = key.slice(separator + 1);
  return { session: key.slice(0, separator), ...(agent === MAIN_SCOPE ? {} : { agent }) };
}

export class FallbackState {
  readonly agents = new Map<string,string>();
  readonly routes = new Map<string,RouteState>();
  readonly interrupted = new Map<string,{prompt?:string;reason:string}>();
  readonly notices = new RouteNoticeBus();
  constructor(readonly rules: FallbackRule[]) {}
  key(i: Identity): string | undefined { return i.session ? i.session + '/' + (i.agent ?? MAIN_SCOPE) : undefined; }
  register(session: string, agent: string, name: string) { this.agents.set(session+'/'+agent,name.replace(/^claudapter:/,'')); }
  rule(i: Identity, model: string): FallbackRule | undefined {
    if (!i.session || !['main','subagent'].includes(i.requestClass ?? '')) return;
    const scope = i.agent ? this.agents.get(this.key(i)!) : MAIN_SCOPE;
    if (!scope || (i.requestClass==='subagent' && !i.agent)) return;
    return this.rules.find(r=>r.enabled && r.from===model && r.scopes.includes(scope));
  }
  route(i: Identity, requested: string, now = Date.now()): string {
    const key = this.key(i); if (!key) return requested;
    const state = this.routes.get(key);
    if (!state) return requested;
    const rule=this.rule(i,requested);
    if (state.until<=now) { this.recover(key,'cooldown_ended',now); return requested; }
    if (!rule || !rule.targets.includes(state.actual) || state.requested!==requested) { this.recover(key,'superseded',now); return requested; }
    return state.actual;
  }
  set(i: Identity, change: RouteSwitch, now = Date.now()) {
    const key = this.key(i); if (!key) return;
    const until = now + change.cooldownMs;
    this.routes.set(key,{requested:change.requested,actual:change.actual,provider:change.provider,until,reason:change.reason});
    this.notices.publish({kind:'switched',scope:scopeOf(key),requested:change.requested,actual:change.actual,provider:change.provider,
      reason:switchReason(change.reason),cooldownUntil:until,at:now,...(change.retryAfterMs?{retryAfterMs:change.retryAfterMs}:{})});
  }
  /**
   * An explicit user choice to continue a scope on one of its rule's targets for the rule's cooldown.
   * It never sends anything itself; the user's next prompt is the only request that uses the route.
   */
  steer(i: Identity, requested: string, target: Model, now = Date.now()) {
    const rule = this.rule(i, requested);
    if (!rule?.targets.includes(target.id)) throw new Error('Only a target of an enabled fallback rule for this scope can be chosen.');
    if (target.auth !== 'authenticated') throw new Error('Fallback target is not signed in: ' + target.id);
    this.set(i,{requested,actual:target.id,provider:target.provider,cooldownMs:rule.cooldownMs,reason:'user_retry'},now);
  }
  /** Ends every cooldown that has run out so interfaces learn about recovery without waiting for a request. */
  expire(now = Date.now()) {
    for (const [key,state] of [...this.routes]) if (state.until<=now) this.recover(key,'cooldown_ended',now);
  }
  block(i: Identity,reason='interrupted') { const key = this.key(i); if (key) this.interrupted.set(key,{prompt:i.prompt,reason}); }
  isBlocked(i: Identity): boolean {
    const key = this.key(i); if (!key || !this.interrupted.has(key)) return false;
    const prompt = this.interrupted.get(key)?.prompt;
    if (prompt && i.prompt && prompt!==i.prompt) { this.interrupted.delete(key); return false; }
    return true;
  }
  reset(session?: string, agent?: string) {
    const selected = (key: string) => !session || key===session+'/'+(agent??MAIN_SCOPE);
    for (const key of [...this.routes.keys()]) if (selected(key)) this.recover(key,'reset');
    for (const key of [...this.interrupted.keys()]) if (selected(key)) this.interrupted.delete(key);
  }
  private recover(key: string, cause: RecoveryCause, now = Date.now()) {
    const state = this.routes.get(key); if (!state) return;
    this.routes.delete(key);
    this.notices.publish({kind:'recovered',scope:scopeOf(key),requested:state.requested,previous:state.actual,cause,at:now});
  }
}

/** An explicit HTTP rejection before any output is the only automatic replay boundary. */
export function classify(status: number, body: any): 'rate_limit' | 'unavailable' | undefined {
  const type = String(body?.error?.type ?? body?.error?.code ?? '');
  if (/auth|permission|billing|credit|spend|policy|invalid|content|refus/i.test(type)) return;
  if (/billing|credit balance|spend(?:ing)? (?:cap|limit)|organization.*policy|credential|authentication|unauthori[sz]ed|not authorized/i.test(String(body?.error?.message??''))) return;
  if (status===429 && ['rate_limit_error','rate_limit_exceeded','usage_limit_reached'].includes(type)) return 'rate_limit';
  if ([500,502,503,504,529].includes(status) && (!type || ['api_error','overloaded_error','server_error','service_unavailable'].includes(type))) return 'unavailable';
}
export function retryDelay(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0,seconds*1000) : Math.max(0,Date.parse(value)-now) || 0;
}
export function assertCompatible(body: any, target: Model): void {
  if (body.tools?.length && !target.tools) throw new Error('Fallback target does not support tools.');
  const content = JSON.stringify({system:body.system,messages:body.messages,tools:body.tools});
  if (/"type":"(?:image|document)"/.test(content)) {
    if (!target.vision || /"type":"document"/.test(content)) throw new Error('Fallback target cannot accept this visual content.');
    throw new Error('Automatic fallback with images requires a verified multimodal token bound; switch manually.');
  }
  // UTF-8 bytes bound text tokens conservatively; never use a heuristic to silently truncate.
  const bytes=Buffer.byteLength(content), output=body.max_tokens??32000;
  if (!target.context || bytes + output + 4096 > target.context)
    throw new Error('Fallback target context capacity cannot safely fit this request ('+bytes+' UTF-8 bytes + '+output+' output reserve + 4096 overhead; capacity '+(target.context??'unknown')+').');
}

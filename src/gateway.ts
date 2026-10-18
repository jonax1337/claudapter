import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAuth } from './auth.js';
import { Registry, type Model } from './models.js';
import { TurnTranslator, readServerSentEvents } from './translate.js';
import { defaults, type Config } from './config.js';
import { FallbackState, classify, assertCompatible, retryDelay, type Identity } from './fallback.js';
import { switchReason, type RouteScope } from './route-events.js';
import { Providers } from './providers.js';
import { UsageLedger, QuotaReader, type UsageAttempt } from './usage.js';
import { ClaudeAccountAuth, profileClaudeHome } from './profiles.js';

export const TOKEN_HEADER = 'x-claudapter-token';
/** A provider whose fresh quota window reports this much usage is skipped for earlier fallback targets. */
export const QUOTA_PREEMPT_PERCENT = 95;
/** How often expired cooldowns are announced as recovered without waiting for the next request. */
const COOLDOWN_SWEEP_MS = 1000;
/**
 * A request is stopped only after the upstream stays silent this long. Every received chunk restarts the wait,
 * so long reasoning turns survive; the value matches Claude Code's own default API timeout.
 */
export const UPSTREAM_IDLE_TIMEOUT_MS = 600_000;
export interface RouteEvent {
  time: string; event: string; session?: string; agent?: string; requestClass?: string;
  requested: string; actual: string; provider: string; status?: number;
  tools?: string[]; toolResults?: number; reason?: string;
  attemptId?: string;
}
export interface GatewayOptions {
  registry: Registry; auth?: CodexAuth;
  onEvent?: (event: RouteEvent) => void;
  // Dependency injection for isolated transport tests; never populated from project files.
  fetch?: typeof fetch; idleTimeoutMs?: number;
  config?: Config;
  refresh?: () => Promise<void>;
}

export async function startGateway(options: GatewayOptions) {
  const token = randomBytes(32).toString('hex');
  const auth = options.auth ?? new CodexAuth();
  const upstreamFetch = options.fetch ?? fetch;
  const config = options.config ?? defaults();
  const providers = new Providers(config,auth,upstreamFetch);
  const usage = new UsageLedger();
  const quotas = new QuotaReader(config,auth,upstreamFetch);
  const state = new FallbackState(config.fallback);
  const sweep = setInterval(() => state.expire(), COOLDOWN_SWEEP_MS); sweep.unref();
  const controllers = new Set<AbortController>();
  const interrupted = new Set<string>();
  /** Interruption fingerprints kept to refuse automatic replays; beyond this, the oldest are dropped. */
  const INTERRUPTED_MAX = 4096;
  const events: RouteEvent[] = [];
  const emit = (event: RouteEvent) => { events.push(event); if (events.length > 200) events.shift(); options.onEvent?.(event); };
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 100;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const controller = new AbortController();
    controllers.add(controller);
    res.once('close', () => { if (!res.writableFinished) controller.abort(new Error('Client disconnected.')); });
    const watchdog = idleWatchdog(controller, options.idleTimeoutMs ?? UPSTREAM_IDLE_TIMEOUT_MS);
    let fingerprint = '';
    let event: RouteEvent | undefined;
    let identity: Identity = {};
    let usageAttempt: UsageAttempt | undefined;
    try {
      if (req.headers[TOKEN_HEADER] !== token) return error(res, 401, 'Local gateway authentication required.');
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method==='GET' && path==='/status') return json(res,200,manifest());
      if (req.method==='GET' && path==='/usage') return json(res,200,usage.snapshot(quotas.snapshot()));
      if (req.method==='POST' && path==='/usage/refresh') { await quotas.refresh(controller.signal); return json(res,200,usage.snapshot(quotas.snapshot())); }
      if (req.method==='POST' && path==='/refresh') { await options.refresh?.(); return json(res,200,manifest()); }
      if (req.method==='POST' && path==='/reset') {
        const body=JSON.parse(await readBody(req));
        if (body.session && typeof body.session!=='string' || body.agent && typeof body.agent!=='string') return error(res,400,'Invalid reset scope.');
        state.reset(body.session,body.agent); return json(res,200,{reset:true});
      }
      if (req.method==='POST' && path==='/hook') {
        const body=JSON.parse(await readBody(req));
        if (body.hook_event_name==='SubagentStart' && typeof body.session_id==='string' && typeof body.agent_id==='string' && typeof body.agent_type==='string') {
          state.register(body.session_id,body.agent_id,body.agent_type);
          emit({time:new Date().toISOString(),event:'agent_registered',session:body.session_id,agent:body.agent_id,requested:config.agents[body.agent_type.replace(/^claudapter:/,'')]??'',actual:'',provider:'',reason:body.agent_type});
        }
        const hookEventName=body.hook_event_name;
        return json(res,200,{hookSpecificOutput:{hookEventName,additionalContext:JSON.stringify(context(hookEventName))},
          ...(hookEventName==='SessionStart'?{systemMessage:'Claudapter active. Use /model then s for a session-only switch. Routing notices show the actual backend.'}:{})});
      }
      if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { data: options.registry.list().map(m => ({id: m.id, display_name: m.label, type: 'model'})), has_more: false });
      if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(path)) return error(res, 404, 'Unsupported gateway route.');
      const raw = await readBody(req);
      let body: any;
      try { body = JSON.parse(raw); } catch { return error(res, 400, 'Invalid JSON.'); }
      if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages)) return error(res, 400, 'Messages and an explicit model are required.');
      let model: Model;
      try { model = options.registry.resolve(body.model); } catch { return error(res, 400, 'Unknown model; no provider substitution was performed.'); }
      if (model.provider==='anthropic') quotas.observeClaudeAuthorization(req.headers.authorization);
      const session = header(req, 'x-claude-code-session-id');
      const agent = header(req, 'x-claude-code-agent-id');
      const requestClass = header(req, 'x-claude-code-request-class');
      identity={session,agent,requestClass,prompt:header(req,'x-claude-code-prompt-id')};
      const agentName=state.agents.get(state.key(identity)??'');
      const expected=agentName?config.agents[agentName]:undefined;
      if (expected && body.model!==expected) return error(res,409,'Configured agent model '+expected+' was overridden by Claude Code. Refusing silent substitution.');
      if (state.isBlocked(identity)) return error(res,400,'This turn was interrupted or its policy attempts are exhausted. Automatic replay is blocked; issue a new user prompt.');
      const policy=state.rule(identity,body.model);
      const routed=state.route(identity,body.model);
      if (routed!==body.model) { model=options.registry.resolve(routed); assertCompatible(body,model); }
      event = { time: new Date().toISOString(), event: 'request', session, agent, requestClass, requested: body.model, actual: model.id, provider: model.provider,
        toolResults: body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((b: any) => b.type === 'tool_result').length };
      fingerprint = createHash('sha256').update((session ?? '') + (agent ?? '') + raw).digest('hex');
      if (interrupted.has(fingerprint)) return error(res, 409, 'Interrupted turn cannot be replayed automatically. Inspect tool results and issue an explicit new instruction.');
      if (model.provider === 'chatgpt' && path.endsWith('count_tokens')) return error(res, 501, 'Exact ChatGPT token counting is unavailable.');
      if (model.provider === 'ollama' && path.endsWith('count_tokens')) return error(res, 501, 'Exact Ollama token counting is unavailable.');
      emit(event);
      let upstream!: Response;
      const targets=policy?[model.id,...policy.targets.filter(id=>id!==model.id)]:[model.id];
      let lastReason=''; let retryHint=0;
      if (policy) void quotas.refresh(controller.signal).catch(()=>{});
      outer: for (let targetIndex=0;targetIndex<targets.length;targetIndex++) {
        model=options.registry.resolve(targets[targetIndex]);
        if (model.provider==='chatgpt' && await auth.status()!=='authenticated') {
          model.auth=await auth.status();model.availability='auth_failed';delete model.verifiedAt;
          return error(res,401,'ChatGPT credentials are missing, expired or unsupported. Refresh with the official Codex CLI, then retry.');
        }
        if (model.provider.startsWith('anthropic@')) {
          const name=model.provider.slice('anthropic@'.length);
          const status=await new ClaudeAccountAuth(profileClaudeHome(name)).status();
          if (status!=='authenticated') {
            model.auth=status;model.availability='auth_failed';delete model.verifiedAt;
            return error(res,401,'Claude account "'+name+'" is missing or expired. Run `claudapter profile login '+name+'`, then retry.');
          }
          model.auth='authenticated';
        }
        if (model.id!==body.model) assertCompatible(body,model);
        // Pre-empt a near-exhausted provider before its 429 breaks a turn; the last target is always attempted.
        if (targetIndex<targets.length-1 && quotas.preempt(model.provider,QUOTA_PREEMPT_PERCENT)) {
          lastReason='quota_near_limit'; continue;
        }
        event={...event,actual:model.id,provider:model.provider};
        if (targetIndex>0) emit({...event,event:'fallback',reason:lastReason});
        for (let attempt=0;attempt<=(policy?.retries??0);attempt++) {
          usageAttempt = path==='/v1/messages' ? usage.begin({provider:model.provider,requestedModel:body.model,actualModel:model.id,
            upstreamModel:model.upstream,session,agent,requestClass}) : undefined;
          event={...event,attemptId:usageAttempt?.id};
          watchdog.restart();
          upstream=await providers.request({model,body,request:req,path:path+new URL(req.url!,'http://localhost').search,session:session??fingerprint,
            signal: policy ? AbortSignal.any([controller.signal,AbortSignal.timeout(policy.timeoutMs)]) : controller.signal});
          if (usageAttempt) usageAttempt.status=upstream.status;
          emit({...event,event:'response',status:upstream.status});
          if (upstream.ok) {
            if (model.id!==body.model && policy && (targetIndex>0 || routed===body.model))
              state.set(identity,{requested:body.model,actual:model.id,provider:model.provider,cooldownMs:Math.max(policy.cooldownMs,retryHint),reason:lastReason,retryAfterMs:retryHint});
            break outer;
          }
          if ([401,403].includes(upstream.status)) {model.auth='expired';model.availability='auth_failed';delete model.verifiedAt;}
          const failure=await readFailure(upstream);
          if (usageAttempt) usage.finish(usageAttempt,'rejected');
          const reason=classify(upstream.status,failure);
          retryHint=retryDelay(upstream.headers.get('retry-after'));
          if(reason) {model.availability='temporarily_unavailable';model.unavailableUntil=Date.now()+Math.max(retryHint,policy?.cooldownMs??60000);}
          if (!policy || !reason || !policy.errors.includes(reason)) {
            if(policy)state.block(identity,'policy-failed');
            else if(reason) announceUnprotected(identity,body.model,model.provider,reason,retryHint);
            return failureResponse(res,upstream,failure,model.provider);
          }
          lastReason=reason;
          if (attempt<(policy.retries) && retryHint<=policy.timeoutMs) {
            await delay(Math.max(100,retryHint),undefined,{signal:controller.signal}); continue;
          }
          if (targetIndex===targets.length-1) {
            state.block(identity,'policy-exhausted');
            const scope=noticeScope(identity);
            if(scope) state.notices.publish({kind:'exhausted',scope,requested:body.model,chain:targets,reason:switchReason(lastReason),at:Date.now()});
            return error(res,upstream.status,'Configured fallback chain exhausted; no other provider is allowed.');
          }
          break;
        }
      }
      if (!upstream.body) throw new Error('Missing upstream stream.');
      const stream = observed(upstream.body, watchdog.restart);
      if (model.provider !== 'chatgpt') {
        const headers: Record<string,string> = {};
        upstream.headers.forEach((v,k) => { if (k === 'content-type' || k === 'retry-after' || k.startsWith('anthropic-')) headers[k] = v; });
        res.writeHead(upstream.status, headers);
        if (body.stream===true) {
          let complete=false;
          let reportedUsage: Record<string,unknown> = {}; let reportedModel: unknown; let finalUsage=false;
          for await (const item of readServerSentEvents(stream)) {
            if (item.type==='error') throw new Error('Upstream stream failed.');
            if (item.type==='message_start') { reportedUsage={...((item.message as any)?.usage??{})}; reportedModel=(item.message as any)?.model; }
            if (item.type==='message_delta') { reportedUsage={...reportedUsage,...(item.usage as any??{})}; finalUsage ||= Object.hasOwn(item.usage as object??{},'output_tokens'); }
            await write(res,'event: '+item.type+'\ndata: '+JSON.stringify(item)+'\n\n');
            if (item.type==='message_stop') { complete=true; break; }
          }
          if (!complete) throw new Error('Truncated Anthropic stream.');
          if (usageAttempt) usage.finish(usageAttempt,'completed',finalUsage?reportedUsage:undefined,reportedModel);
        } else {
          // Bound inspection while preserving every passthrough byte, including unknown provider fields.
          const chunks: Uint8Array[]=[]; let size=0;
          for await (const chunk of stream) { size+=chunk.length; if(size<=16*1024*1024) chunks.push(chunk); await write(res,chunk); }
          let message: any;
          if(size<=16*1024*1024) try { message=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Missing usage stays unknown. */ }
          if (usageAttempt) usage.finish(usageAttempt,'completed',message?.usage,message?.model);
        }
        model.verifiedAt=new Date().toISOString();model.availability='verified';model.auth='authenticated';delete model.unavailableUntil;
        res.end(); return;
      }
      const translator = new TurnTranslator(model.id, model.upstream);
      let complete = false;
      for await (const incoming of readServerSentEvents(stream)) {
        if (incoming.type === 'response.failed' || incoming.type === 'response.incomplete' || incoming.type === 'error') throw new Error('Upstream did not complete the turn.');
        if (incoming.type === 'response.output_item.done' && (incoming.item as any)?.type === 'function_call')
          emit({...event, event: 'tool', tools: [(incoming.item as any).name]});
        if (incoming.type==='response.completed' && (incoming.response as any)?.model && (incoming.response as any).model!==model.upstream)
          throw new Error('Upstream reported a different model.');
        if (incoming.type==='response.completed' && usageAttempt)
          usage.finish(usageAttempt,'completed',(incoming.response as any)?.usage,(incoming.response as any)?.model);
        const translated = translator.handle(incoming);
        if (body.stream === true) {
          if (!res.headersSent && translated.length) res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'});
          for (const out of translated) await write(res, 'event: ' + out.event + '\ndata: ' + JSON.stringify(out.data) + '\n\n');
        }
        if (incoming.type === 'response.completed') {
          const reported=(incoming.response as any)?.model;
          if(reported && reported!==model.upstream) throw new Error('Upstream reported a different model.');
          complete = true; break;
        }
      }
      if (!complete) throw new Error('Truncated upstream stream.');
      model.verifiedAt=new Date().toISOString();model.availability='verified';model.auth='authenticated';delete model.unavailableUntil;
      if (body.stream === true) res.end();
      else json(res, 200, translator.toMessage());
    } catch (e) {
      if (usageAttempt) usage.finish(usageAttempt,'interrupted');
      if (res.headersSent) {
        state.block(identity);
        if (fingerprint) { if (interrupted.size >= INTERRUPTED_MAX) interrupted.delete(interrupted.values().next().value!); interrupted.add(fingerprint); }
        if (event) emit({...event, event:'interrupted',reason:'No replay after output started: '+safeMessage((e as Error).message)});
        const scope=noticeScope(identity);
        if (event && scope) state.notices.publish({kind:'interrupted',scope,requested:event.requested,actual:event.actual,provider:event.provider,at:Date.now()});
        // A protocol error ends the turn; the replay guard also catches native retries.
        res.end('event: error\ndata: '+JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Interrupted upstream stream. Automatic replay is blocked.'}})+'\n\n');
      } else error(res, e instanceof BodyLimitError ? 413 : 400, 'Gateway request stopped; no replay. ' + safeMessage((e as Error).message));
    } finally { watchdog.stop(); controllers.delete(controller); }
  }
  /** Main and sub-agent requests only: auxiliary traffic cannot be protected by a fallback rule. */
  function noticeScope(identity: Identity): RouteScope | undefined {
    if (!identity.session || !['main','subagent'].includes(identity.requestClass ?? '')) return;
    return {session:identity.session,...(identity.agent?{agent:identity.agent}:{})};
  }
  function announceUnprotected(identity: Identity, requested: string, provider: string, reason: string, retryAfterMs: number) {
    const scope=noticeScope(identity); if (!scope) return;
    state.notices.publish({kind:'unprotected',scope,requested,provider,reason:switchReason(reason),at:Date.now(),...(retryAfterMs?{retryAfterMs}:{})});
  }
  function context(event: string) {
    const full=manifest();
    return {product:full.product,delegation:full.delegation,agents:full.agents,rules:full.rules,
      models:full.models.map(m=>({id:m.id,provider:m.provider,context:m.context,tools:m.tools,vision:m.vision,auth:m.auth,availability:m.availability??'unknown',catalogStale:m.catalogStale})),
      routes:full.routes,discovery:full.discovery};
  }
  function manifest() {
    return {product:'Claudapter',updatedAt:new Date().toISOString(),models:options.registry.list().map(m=>({...m,catalogStale:m.fetchedAt?Date.now()-Date.parse(m.fetchedAt)>86400000:undefined})),
      agents:Object.entries(config.agents).map(([name,model])=>({name:'claudapter:'+name,model,purpose:name.includes('review')?'Review on explicit user request':'Implement on explicit user request'})),
      delegation:'Only delegate when the user explicitly requests it. Availability is not permission.',
      rules:config.fallback,registeredAgents:[...state.agents].map(([scope,name])=>({scope,name})),routes:[...state.routes].map(([scope,value])=>({scope,...value,active:value.until>Date.now()})),
      recentRoutes:events.slice(-20),usage:usage.snapshot(quotas.snapshot()),discovery:'Use the claudapter discovery MCP tool to refresh read-only availability. Quotas: POST /usage/refresh. Auth readiness is not proof of live availability.'};
  }
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot bind loopback gateway.');
  return { baseUrl:'http://127.0.0.1:' + address.port, token, events, registry: options.registry,state,manifest,usage,quotas,
    subscribeRoutes: state.notices.subscribe,
    async close() { clearInterval(sweep); for (const c of controllers) c.abort(new Error('Gateway shut down.')); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

function header(req: IncomingMessage, key: string): string | undefined {
  const v = req.headers[key]; return typeof v === 'string' && /^[\w.:-]{1,128}$/.test(v) ? v : undefined;
}
/** Aborts the request once `idleMs` pass without a `restart()`. */
function idleWatchdog(controller: AbortController, idleMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const stop = () => clearTimeout(timer);
  const restart = () => {
    stop();
    timer = setTimeout(() => controller.abort(new Error('Upstream sent nothing for '+idleMs/1000+' s.')), idleMs);
  };
  restart();
  return {restart, stop};
}
/** Passes the upstream body through unchanged and reports every chunk as a sign of life. */
function observed(body: ReadableStream<Uint8Array>, onChunk: () => void): ReadableStream<Uint8Array> {
  return body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk, out) { onChunk(); out.enqueue(chunk); }}));
}
class BodyLimitError extends Error {}
async function readBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers['content-length'])>16*1024*1024) throw new BodyLimitError();
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new BodyLimitError(); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function write(res: ServerResponse, data: string | Uint8Array) {
  if(res.destroyed) throw new Error('Client disconnected.');
  if (!res.write(data)) await new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{res.off('drain',ready);res.off('close',closed);res.off('error',closed);};
    const ready=()=>{cleanup();resolve();};
    const closed=()=>{cleanup();reject(new Error('Client disconnected.'));};
    res.once('drain',ready);res.once('close',closed);res.once('error',closed);
  });
}
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, {'content-type':'application/json','x-should-retry':'false'}); res.end(JSON.stringify(body)); }
function error(res: ServerResponse, status: number, message: string) {
  if (!res.destroyed) json(res, status, {type:'error',error:{type: status === 401 ? 'authentication_error' : 'invalid_request_error',message}});
}
async function readFailure(response: Response): Promise<any> {
  if (!response.body) return {};
  let text='';
  for await (const chunk of response.body) { text+=Buffer.from(chunk).toString('utf8'); if (text.length>65536) break; }
  try { return JSON.parse(text); } catch { return {}; }
}
function safeMessage(message: string): string {
  return message.replace(/(?:Bearer\s+)[^\s"']+/gi,'Bearer [redacted]').replace(/(?:sk-|eyJ)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,500);
}
function failureResponse(res: ServerResponse, upstream: Response, failure: any, provider: string) {
  const headers: Record<string,string>={'content-type':'application/json','x-should-retry':'false'};
  upstream.headers.forEach((value,key)=>{if (key.startsWith('anthropic-ratelimit-') || key==='retry-after') headers[key]=value;});
  res.writeHead(upstream.status,headers);
  // Native Claude and the keyless local Ollama server report actionable upstream text; other providers stay masked.
  const messagePassthrough=provider==='anthropic'||provider.startsWith('anthropic@')||provider==='ollama';
  res.end(JSON.stringify({type:'error',error:{type: typeof failure.error?.type==='string'?failure.error.type:'invalid_request_error',
    message:messagePassthrough?safeMessage(String(failure.error?.message ?? 'Upstream '+provider+' request failed.')):'Upstream '+provider+' rejected the request (HTTP '+upstream.status+').'}}));
}

import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { CodexAuth } from './auth.js';

export interface TokenUsage {
  /** Total input, including cache reads and writes. Cache fields are subsets. */
  input: number; output: number; cacheRead: number | null; cacheCreate: number | null; reasoning: number | null;
}
export interface UsageScope {
  provider: string; requestedModel: string; actualModel: string; upstreamModel: string;
  session?: string; agent?: string; requestClass?: string;
}
export interface UsageAttempt extends UsageScope {
  id: string; startedAt: string; finishedAt?: string; status?: number;
  outcome: 'pending' | 'completed' | 'rejected' | 'interrupted';
  tokens: TokenUsage | null; reportedModel?: string;
}
export interface UsageTotal {
  provider: string; actualModel: string; reportedModel?: string; session?: string; agent?: string; requestClass?: string;
  attempts: number; completed: number; unknown: number; interrupted: number;
  /** Reported complete attempts only; unknown attempts are never represented as zero usage. */
  tokens: TokenUsage | null;
}
export interface QuotaWindow { id: string; label?: string; usedPercent: number | null; resetsAt: string | null; windowSeconds: number | null }
export interface ProviderUsage {
  provider: string; state: 'available' | 'unknown' | 'unavailable'; source: string;
  updatedAt?: string; reason?: string; windows: QuotaWindow[]; stale: boolean;
  money: { status: 'unknown'; amount: null; note: string };
}
export interface UsageSnapshot {
  since: string; scope: string; attempts: UsageAttempt[]; totals: UsageTotal[]; providers: ProviderUsage[];
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown) => count(value) ? value : null;

export function normalizeUsage(provider: string, raw: any): TokenUsage | null {
  if (!raw || !count(raw.input_tokens) || !count(raw.output_tokens)) return null;
  if (provider === 'chatgpt') {
    const cached = optional(raw.input_tokens_details?.cached_tokens);
    const reasoning = optional(raw.output_tokens_details?.reasoning_tokens);
    if (raw.input_tokens_details?.cached_tokens !== undefined && cached === null || raw.output_tokens_details?.reasoning_tokens !== undefined && reasoning === null) return null;
    if (cached !== null && cached > raw.input_tokens || reasoning !== null && reasoning > raw.output_tokens) return null;
    return {input:raw.input_tokens,output:raw.output_tokens,cacheRead:cached,cacheCreate:null,reasoning};
  }
  const read = optional(raw.cache_read_input_tokens), created = optional(raw.cache_creation_input_tokens);
  if (raw.cache_read_input_tokens !== undefined && read === null || raw.cache_creation_input_tokens !== undefined && created === null) return null;
  const input = raw.input_tokens + (read ?? 0) + (created ?? 0);
  return count(input) ? {input,output:raw.output_tokens,cacheRead:read,cacheCreate:created,reasoning:null} : null;
}

/** In-memory, gateway-lifetime accounting. No prompts, credentials or SDK aggregate usage enter this ledger. */
export class UsageLedger {
  readonly since = new Date().toISOString();
  private attempts: UsageAttempt[] = [];
  private totals = new Map<string, UsageTotal>();
  begin(scope: UsageScope): UsageAttempt {
    const attempt: UsageAttempt = {...scope,id:randomUUID(),startedAt:new Date().toISOString(),outcome:'pending',tokens:null};
    this.attempts.push(attempt);
    if (this.attempts.length > 200) {
      const index = this.attempts.findIndex(a=>a.outcome !== 'pending');
      if (index >= 0) this.attempts.splice(index,1);
    }
    return attempt;
  }
  finish(attempt: UsageAttempt, outcome: Exclude<UsageAttempt['outcome'],'pending'>, raw?: any, reportedModel?: unknown) {
    if (attempt.outcome !== 'pending') return;
    attempt.outcome = outcome; attempt.finishedAt = new Date().toISOString();
    if (typeof reportedModel === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(reportedModel)) attempt.reportedModel = reportedModel;
    attempt.tokens = outcome === 'completed' ? normalizeUsage(attempt.provider,raw) : null;
    const key = JSON.stringify([attempt.provider,attempt.actualModel,attempt.reportedModel,attempt.session,attempt.agent,attempt.requestClass]);
    const total = this.totals.get(key) ?? {provider:attempt.provider,actualModel:attempt.actualModel,reportedModel:attempt.reportedModel,session:attempt.session,agent:attempt.agent,
      requestClass:attempt.requestClass,attempts:0,completed:0,unknown:0,interrupted:0,tokens:null};
    total.attempts++; if (outcome === 'completed') total.completed++; if (outcome === 'interrupted') total.interrupted++;
    if (!attempt.tokens) total.unknown++;
    else if (!total.tokens) total.tokens = {...attempt.tokens};
    else for (const field of ['input','output','cacheRead','cacheCreate','reasoning'] as const) {
      const previous = total.tokens[field], next = attempt.tokens[field];
      (total.tokens as any)[field] = previous === null || next === null ? null : previous + next;
    }
    this.totals.set(key,total);
    while (this.attempts.length > 200) {
      const index=this.attempts.findIndex(a=>a.outcome!=='pending');
      if(index<0) break; this.attempts.splice(index,1);
    }
  }
  snapshot(providers: ProviderUsage[] = []): UsageSnapshot {
    return structuredClone({since:this.since,scope:'This gateway lifetime only; account quotas include other sessions. Recent attempts limited to 200; totals include all attempts.',
      attempts:this.attempts,totals:[...this.totals.values()],providers});
  }
}

const iso = (value: unknown): string | null => {
  const time = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time >= 0 && time <= 8640000000000000 ? new Date(time).toISOString() : null;
};
const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
export function quotaWindows(provider: string, body: any): QuotaWindow[] {
  const result: QuotaWindow[] = [];
  if (provider === 'chatgpt') {
    const limits = [{id:'codex',rate_limit:body?.rate_limit},...(Array.isArray(body?.additional_rate_limits) ? body.additional_rate_limits : [])];
    for (const limit of limits) for (const key of ['primary_window','secondary_window']) {
      const window = limit?.rate_limit?.[key];
      if (!window || typeof window !== 'object') continue;
      const id = String(limit.id ?? limit.metered_feature ?? limit.limit_name ?? 'additional').slice(0,128);
      result.push({id:id+'/'+key,usedPercent:percent(window.used_percent),resetsAt:iso(window.reset_at),windowSeconds:optional(window.limit_window_seconds)});
    }
  } else if (provider === 'anthropic') {
    if (Array.isArray(body?.limits)) return body.limits.filter((row: any)=>row && typeof row.kind==='string').map((row: any,index: number)=>({
      id:row.kind.slice(0,128)+'/'+index,label:String(row.scope?.model?.display_name??row.scope?.surface?.display_name??row.kind).slice(0,128),
      usedPercent:percent(row.percent),resetsAt:iso(row.resets_at),windowSeconds:null}));
    for (const key of ['five_hour','seven_day','seven_day_opus','seven_day_sonnet','seven_day_oauth_apps','seven_day_cowork']) {
      const window = body?.[key];
      if (window && typeof window === 'object') result.push({id:key,usedPercent:percent(window.utilization),resetsAt:iso(window.resets_at),windowSeconds:null});
    }
    if (Array.isArray(body?.model_scoped)) for (const [index,window] of body.model_scoped.entries()) {
      if (window && typeof window === 'object') result.push({id:'model_scoped/'+index,label:String(window.display_name??'Model').slice(0,128),
        usedPercent:percent(window.utilization),resetsAt:iso(window.resets_at),windowSeconds:null});
    }
  }
  return result;
}

/** Only fixed first-party GET endpoints; credential refresh and paid-credit redemption are never attempted. */
export class QuotaReader {
  private claudeAuthorization?: string;
  private values = new Map<string,ProviderUsage>();
  private nextRefresh = new Map<string,number>();
  private refreshing?: Promise<void>;
  constructor(readonly config: Config, readonly auth: CodexAuth, readonly send: typeof fetch = fetch) {
    for (const provider of [...(config.claude?['anthropic']:[]),...(config.chatgpt?['chatgpt']:[]),...config.providers.map(p=>p.id)]) {
      this.values.set(provider,{provider,state:'unknown',source:provider==='chatgpt'?'ChatGPT Codex account usage':provider==='anthropic'?'Claude OAuth account usage':'No quota adapter',
        windows:[],stale:true,reason:'Not refreshed.',money:{status:'unknown',amount:null,note:provider==='chatgpt'?'Subscription access; actual billed amount and credit use are not reported per request.':'No authoritative per-request price or billing data.'}});
    }
  }
  observeClaudeAuthorization(value: unknown) {
    if (this.config.claude && typeof value === 'string' && value.startsWith('Bearer ') && value !== 'Bearer claudapter-local-only' && value !== this.claudeAuthorization) {
      this.claudeAuthorization = value; this.nextRefresh.delete('anthropic');
    }
  }
  /** SDK usage control owns its auth; session/model cost aggregates are deliberately not imported. */
  ingestClaudeSdkUsage(result: unknown) {
    const previous = this.values.get('anthropic'); if (!previous) return;
    const data=result as any;
    const windows=data?.rate_limits_available===true ? quotaWindows('anthropic',data.rate_limits) : [];
    this.values.set('anthropic',{...previous,source:'Claude Agent SDK experimental usage control (account quotas only)',updatedAt:new Date().toISOString(),stale:false,windows,
      state:windows.some(w=>w.usedPercent!==null)?'available':'unknown',reason:windows.some(w=>w.usedPercent!==null)?undefined:'Claude SDK did not provide available account quota windows.'});
    this.nextRefresh.set('anthropic',Date.now()+60_000);
  }
  snapshot(): ProviderUsage[] {
    return structuredClone([...this.values.values()].map(value=>({...value,stale:!value.updatedAt || Date.now()-Date.parse(value.updatedAt)>60_000})));
  }
  refresh(signal?: AbortSignal): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = Promise.all([...this.values.keys()].map(provider=>this.read(provider,signal))).then(()=>{}).finally(()=>{this.refreshing=undefined;});
    return this.refreshing;
  }
  private async read(provider: string, signal?: AbortSignal) {
    if (Date.now() < (this.nextRefresh.get(provider) ?? 0)) return;
    const previous = this.values.get(provider)!;
    const unknown = (reason: string, state: ProviderUsage['state']='unknown') => this.values.set(provider,{...previous,state,reason,updatedAt:new Date().toISOString(),windows:[],stale:false});
    this.nextRefresh.set(provider,Date.now()+60_000);
    try {
      let url: string; let headers: Record<string,string>;
      if (provider === 'chatgpt') {
        const credential = await this.auth.credentials();
        url = 'https://chatgpt.com/backend-api/wham/usage';
        headers = {authorization:'Bearer '+credential.accessToken,'chatgpt-account-id':credential.accountId,'user-agent':'codex-cli'};
      } else if (provider === 'anthropic') {
        if (!this.claudeAuthorization) { unknown('No Claude OAuth credential observed in this gateway. Start a Claude turn; API-key quotas are not available here.'); return; }
        url = 'https://api.anthropic.com/api/oauth/usage';
        headers = {authorization:this.claudeAuthorization,'anthropic-beta':'oauth-2025-04-20'};
      } else { unknown('No read-only quota interface is configured for this provider.'); return; }
      const response = await this.send(url,{method:'GET',headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000)});
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
        if (seconds > 0) this.nextRefresh.set(provider,Date.now()+Math.max(60,Math.min(seconds,86400))*1000);
        await response.body?.cancel(); unknown('Quota request returned HTTP '+response.status+'. No credential refresh was attempted.','unavailable'); return;
      }
      if (!response.body) { unknown('Quota response has no body.'); return; }
      let length=0; const chunks: Uint8Array[]=[];
      for await (const chunk of response.body) { length+=chunk.length; if(length>256*1024) throw new Error('Quota response too large.'); chunks.push(chunk); }
      const windows = quotaWindows(provider,JSON.parse(Buffer.concat(chunks).toString('utf8')));
      this.values.set(provider,{...previous,state:windows.some(w=>w.usedPercent!==null)?'available':'unknown',updatedAt:new Date().toISOString(),windows,stale:false,
        reason:windows.some(w=>w.usedPercent!==null)?undefined:'Provider did not report recognized quota windows.'});
    } catch { unknown('Quota unavailable: missing/expired credentials, transport failure or unsupported response. No credentials were changed.','unavailable'); }
  }
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codexHome, type AuthState } from './auth.js';
import { CodexAuth } from './auth.js';
import type { Config } from './config.js';
import { accountProvider, ClaudeAccountAuth, listProfiles, profileClaudeHome, splitAccountModel } from './profiles.js';

export interface Model {
  id: string; provider: string; upstream: string; label: string;
  context?: number; tools: boolean; vision: boolean; efforts: string[];
  defaultContext?: number; maxContext?: number;
  contextSource?: 'max_context_window' | 'context_window' | 'provider configuration';
  source: string; fetchedAt?: string; auth: AuthState; verifiedAt?: string;
  availability?: 'unknown' | 'verified' | 'temporarily_unavailable' | 'auth_failed';
  unavailableUntil?: number;
}

export async function chatgptModels(auth: AuthState, home = codexHome()): Promise<Model[]> {
  let cache;
  try { cache = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')); } catch { return []; }
  if (!Array.isArray(cache?.models)) return [];
  return cache.models.filter((m: any) => m && typeof m.slug === 'string' && m.visibility !== 'hide')
    .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m: any) => ({ id: m.slug, upstream: m.slug, provider: 'chatgpt', label: m.display_name ?? m.slug,
      ...catalogContext(m), tools: true, vision: m.input_modalities?.includes('image') === true,
      efforts: (m.supported_reasoning_levels ?? []).map((e: any) => e.effort),
      source: 'Codex account model cache (not a live availability check)', fetchedAt: cache.fetched_at, auth }));
}

function catalogContext(model: {context_window?: unknown; max_context_window?: unknown}): Pick<Model, 'context' | 'defaultContext' | 'maxContext' | 'contextSource'> {
  const valid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1024;
  const defaultContext = valid(model.context_window) ? model.context_window : undefined;
  const maxContext = valid(model.max_context_window) ? model.max_context_window : undefined;
  // Codex treats max_context_window as the override ceiling, even if a stale default is larger.
  return {context: maxContext ?? defaultContext, defaultContext, maxContext,
    contextSource: maxContext !== undefined ? 'max_context_window' : defaultContext !== undefined ? 'context_window' : undefined};
}

export class Registry {
  readonly entries = new Map<string, Model>();
  constructor(models: Model[] = []) { for (const m of models) this.add(m); }
  add(model: Model): void {
    if (model.provider!=='anthropic' && !model.provider.startsWith('anthropic@') && /^(?:claude-|sonnet$|opus$|haiku$|fable$|default$|opusplan$)/i.test(model.id))
      throw new Error('External model collides with a reserved Claude model ID: '+model.id);
    if (this.entries.has(model.id)) throw new Error('Duplicate model ID: ' + model.id);
    this.entries.set(model.id, model);
  }
  resolve(id: string): Model {
    const known = this.entries.get(id);
    if (known) return known;
    const account = splitAccountModel(id);
    if (account) {
      const base = this.resolve(account.base);
      if (base.provider!=='anthropic') throw new Error('Profile account routing applies only to Claude models: '+id);
      const routed: Model = {...base,id,provider:accountProvider(account.profile),upstream:base.upstream,
        label:base.label+' · '+account.profile,source:'Claude model through profile "'+account.profile+'"; read-only account credentials',auth:'unknown'};
      this.add(routed); return routed;
    }
    // Anthropic validates its own versioned IDs; arbitrary foreign IDs never route there.
    if (/^claude-(?:opus|sonnet|haiku|fable)-[a-z0-9.-]+$/.test(id)) {
      const model: Model = { id, upstream: id, provider: 'anthropic', label: id, tools: true, vision: true,
        efforts: [], source: 'Claude Code requested ID; upstream validates availability', auth: 'unknown' };
      this.add(model); return model;
    }
    throw new Error('Unknown model: ' + id);
  }
  list(): Model[] { return [...this.entries.values()]; }
}

export function nativeContextSettings(registry: Registry): {
  env: Record<string, string>; modelSettings: Record<string, {autoCompactWindow: number}>;
} {
  // Profile-account models are native Claude transports; the native engine keeps owning their window.
  const external = registry.list().filter(model => model.provider !== 'anthropic' && !model.provider.startsWith('anthropic@'));
  if (!external.length) return {env:{}, modelSettings:{}};
  for (const model of external) if (!Number.isSafeInteger(model.context) || model.context! < 1024)
    throw new Error('Cannot configure the native context window for '+model.id+': catalog capacity is unknown or invalid. Refresh the catalog or configure its capacity.');
  const ceiling = Math.max(...external.map(model => model.context!));
  const windows: [string, {autoCompactWindow:number}][] = [];
  for (const model of external) {
    const context = model.context!;
    if (context >= 100000 && context <= 1000000) windows.push([model.id,{autoCompactWindow:context}]);
    else if (context !== ceiling)
      throw new Error('Claude Code cannot configure a distinct context window of '+context+' for '+model.id+' alongside larger models (per-model windows support 100000 to 1000000 tokens).');
  }
  return {env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:String(ceiling)}, modelSettings:Object.fromEntries(windows)};
}

export async function buildRegistry(config: Config, auth: CodexAuth): Promise<Registry> {
  const registry = new Registry(config.chatgpt ? await chatgptModels(await auth.status(),auth.home) : []);
  if (config.claude) for (const id of ['sonnet','opus','haiku']) registry.add({id,upstream:id,provider:'anthropic',label:'Claude '+id,
    tools:true,vision:true,efforts:[],source:'Native Claude Code alias; resolved by the installed client',auth:'unknown'});
  for (const p of config.providers) for (const m of p.models) registry.add({...m,upstream:m.upstream??m.id,provider:p.id,label:m.id,
    contextSource:'provider configuration',efforts:[],source:'Explicit user provider configuration',auth:process.env[p.keyEnv]?'authenticated':'missing'});
  if (config.claude) for (const profile of await listProfiles().catch(() => [])) {
    const account = await new ClaudeAccountAuth(profileClaudeHome(profile.name)).status();
    for (const id of ['sonnet','opus','haiku']) registry.resolve(id+'@'+profile.name).auth = account;
  }
  for (const model of Object.values(config.agents)) registry.resolve(model);
  for (const rule of config.fallback.filter(r=>r.enabled)) {
    registry.resolve(rule.from);
    for (const id of rule.targets) registry.resolve(id);
  }
  return registry;
}

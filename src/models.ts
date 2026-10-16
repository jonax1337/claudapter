import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codexHome, type AuthState } from './auth.js';
import { CodexAuth } from './auth.js';
import type { Config } from './config.js';

export interface Model {
  id: string; provider: string; upstream: string; label: string;
  context?: number; tools: boolean; vision: boolean; efforts: string[];
  source: string; fetchedAt?: string; auth: AuthState; verifiedAt?: string;
  availability?: 'unknown' | 'verified' | 'temporarily_unavailable' | 'auth_failed';
  unavailableUntil?: number;
}

export async function chatgptModels(auth: AuthState, home = codexHome()): Promise<Model[]> {
  let cache;
  try { cache = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')); } catch { return []; }
  if (!Array.isArray(cache.models)) return [];
  return cache.models.filter((m: any) => typeof m.slug === 'string' && m.visibility !== 'hide')
    .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m: any) => ({ id: m.slug, upstream: m.slug, provider: 'chatgpt', label: m.display_name ?? m.slug,
      context: m.context_window, tools: true, vision: m.input_modalities?.includes('image') === true,
      efforts: (m.supported_reasoning_levels ?? []).map((e: any) => e.effort),
      source: 'Codex account model cache (not a live availability check)', fetchedAt: cache.fetched_at, auth }));
}

export class Registry {
  readonly entries = new Map<string, Model>();
  constructor(models: Model[] = []) { for (const m of models) this.add(m); }
  add(model: Model): void {
    if (model.provider!=='anthropic' && /^(?:claude-|sonnet$|opus$|haiku$|fable$|default$|opusplan$)/i.test(model.id))
      throw new Error('External model collides with a reserved Claude model ID: '+model.id);
    if (this.entries.has(model.id)) throw new Error('Duplicate model ID: ' + model.id);
    this.entries.set(model.id, model);
  }
  resolve(id: string): Model {
    const known = this.entries.get(id);
    if (known) return known;
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

export async function buildRegistry(config: Config, auth: CodexAuth): Promise<Registry> {
  const registry = new Registry(config.chatgpt ? await chatgptModels(await auth.status(),auth.home) : []);
  if (config.claude) for (const id of ['sonnet','opus','haiku']) registry.add({id,upstream:id,provider:'anthropic',label:'Claude '+id,
    tools:true,vision:true,efforts:[],source:'Native Claude Code alias; resolved by the installed client',auth:'unknown'});
  for (const p of config.providers) for (const m of p.models) registry.add({...m,upstream:m.upstream??m.id,provider:p.id,label:m.id,
    efforts:[],source:'Explicit user provider configuration',auth:process.env[p.keyEnv]?'authenticated':'missing'});
  for (const model of Object.values(config.agents)) registry.resolve(model);
  for (const rule of config.fallback.filter(r=>r.enabled)) {
    registry.resolve(rule.from);
    for (const id of rule.targets) registry.resolve(id);
  }
  return registry;
}

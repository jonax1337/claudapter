import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface CompatibleProvider {
  id: string; baseUrl: string; keyEnv: string;
  models: { id: string; upstream?: string; context: number; tools: boolean; vision: boolean }[];
}
export interface FallbackRule {
  enabled: boolean; from: string; targets: string[]; scopes: string[];
  errors: ('rate_limit' | 'unavailable')[]; retries: number; timeoutMs: number; cooldownMs: number;
}
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export interface Config {
  version: 1; chatgpt: boolean; claude: boolean;
  /** Claudapter default model for TUI sessions; absent keeps the native default. */
  model?: string;
  /** Per-model default reasoning effort applied at session start and model switch. */
  modelEffort?: Record<string, string>;
  providers: CompatibleProvider[]; agents: Record<string, string>; fallback: FallbackRule[];
}
export const defaults = (): Config => ({ version:1, chatgpt:true, claude:true, providers:[], agents:{}, fallback:[] });
export const configHome = () => {
  const home = process.env.CLAUDAPTER_HOME ?? join(homedir(), '.claudapter');
  if (!isAbsolute(home)) throw new Error('CLAUDAPTER_HOME must be an absolute trusted user directory.');
  return resolve(home);
};
export async function loadConfig(): Promise<Config> {
  try { return validateConfig(JSON.parse(await readFile(join(configHome(), 'config.json'),'utf8'))); }
  catch (e: any) { if (e.code === 'ENOENT') return defaults(); throw e; }
}
export async function saveConfig(config: Config) {
  validateConfig(config); await mkdir(configHome(),{recursive:true,mode:0o700});
  await writeFile(join(configHome(),'config.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
}
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(x);
function keys(value: any, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!allowed.includes(k))) throw new Error('Invalid or unknown configuration field.');
}
export function validateConfig(value: any): Config {
  keys(value,['version','chatgpt','claude','model','modelEffort','providers','agents','fallback']);
  const c = {...defaults(),...value};
  if (c.version!==1 || typeof c.chatgpt!=='boolean' || typeof c.claude!=='boolean' || !Array.isArray(c.providers) || !Array.isArray(c.fallback)) throw new Error('Invalid Claudapter configuration.');
  if (c.model!==undefined && !id(c.model)) throw new Error('Default model must be a known model id.');
  if (c.modelEffort!==undefined) {
    const modelEffort = c.modelEffort as Record<string, string>;
    keys(modelEffort,Object.keys(modelEffort));
    for (const [model, effort] of Object.entries(modelEffort))
      if (!id(model) || !(EFFORT_LEVELS as readonly string[]).includes(effort)) throw new Error('Per-model effort must be a model id and one of: '+EFFORT_LEVELS.join(', ')+'.');
  }
  keys(c.agents,Object.keys(c.agents ?? {}));
  const seen = new Set<string>(['anthropic','chatgpt']);
  for (const p of c.providers) {
    keys(p,['id','baseUrl','keyEnv','models']);
    if (!id(p.id) || seen.has(p.id) || !/^[A-Z][A-Z0-9_]+$/.test(p.keyEnv) || /^(ANTHROPIC|CLAUDE|CODEX|CLAUDAPTER|OPENAI)_/.test(p.keyEnv)) throw new Error('Provider ID/keyEnv must be unique and separate from built-in account credentials.');
    seen.add(p.id);
    const url = new URL(p.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Compatible providers require an explicit HTTPS base URL without credentials or query.');
    if (!Array.isArray(p.models) || !p.models.length) throw new Error('Provider needs explicit models.');
    for (const m of p.models) {
      keys(m,['id','upstream','context','tools','vision']);
      if (!id(m.id) || (m.upstream && !id(m.upstream)) || !Number.isSafeInteger(m.context) || m.context < 1024 || typeof m.tools!=='boolean' || typeof m.vision!=='boolean') throw new Error('Invalid provider model capabilities.');
    }
  }
  for (const r of c.fallback) {
    keys(r,['enabled','from','targets','scopes','errors','retries','timeoutMs','cooldownMs']);
    if (typeof r.enabled!=='boolean' || !id(r.from) || !Array.isArray(r.targets) || !r.targets.length || r.targets.length>3 || !r.targets.every(id) || new Set([r.from,...r.targets]).size!==r.targets.length+1) throw new Error('Fallback requires 1-3 distinct explicit targets.');
    if (!Array.isArray(r.scopes) || !r.scopes.length || !r.scopes.every((s: string)=>s==='main'||Object.hasOwn(c.agents,s))) throw new Error('Fallback scope must be main or a configured agent name.');
    if (!Array.isArray(r.errors) || !r.errors.length || !r.errors.every((e: string)=>['rate_limit','unavailable'].includes(e))) throw new Error('Fallback supports only explicit rate_limit/unavailable errors.');
    for (const [key,min,max] of [['retries',0,2],['timeoutMs',1000,300000],['cooldownMs',1000,86400000]] as const)
      if (!Number.isSafeInteger(r[key]) || r[key]<min || r[key]>max) throw new Error('Invalid bounded fallback ' + key + '.');
  }
  const scopes = new Set();
  for (const r of c.fallback.filter((r: FallbackRule)=>r.enabled)) for (const scope of r.scopes) {
    const key = r.from + ':' + scope; if (scopes.has(key)) throw new Error('Overlapping fallback policies.'); scopes.add(key);
  }
  return c;
}

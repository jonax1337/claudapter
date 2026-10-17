import type { Config } from './config.js';
import type { Model } from './models.js';

/** Default Ollama server; auto-detection probes it on every registry build. */
export const OLLAMA_DEFAULT_BASE = 'http://127.0.0.1:11434';
/** A hanging local server must never stall a launch. */
const DISCOVERY_TIMEOUT_MS = 1500;

export interface OllamaEndpoint { baseUrl: string; explicit: boolean }

/** Loopback and private networks are the only plaintext destinations for local model traffic. */
function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  if (octets.length === 4 && octets.every(octet => /^\d+$/.test(octet))) {
    const [a, b] = octets.map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd]/.test(host); // IPv6 unique-local and link-local ranges
}

/** Parses an Ollama server address; throws with the setting's name when it cannot serve models safely. */
export function parseOllamaUrl(value: string, setting: string): URL {
  if (typeof value !== 'string' || !value.trim()) throw new Error(setting + ' must be a server address.');
  const url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) ? value : 'http://' + value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash)
    throw new Error(setting + ' must be a plain http(s) server address without credentials, path or query.');
  if (url.protocol === 'http:' && !privateHost(url.hostname))
    throw new Error(setting + ' would carry model traffic in plaintext; use https or a loopback/private address.');
  // Ollama's plain default port applies to http; an https proxy keeps its implicit port.
  if (!url.port && url.protocol === 'http:') url.port = '11434';
  return url;
}

/** Config wins over OLLAMA_HOST; an explicitly named server is reported so an unreachable probe can warn. */
export function ollamaEndpoint(config: Config, host = process.env.OLLAMA_HOST ?? ''): OllamaEndpoint {
  if (config.ollama?.baseUrl) return { baseUrl: parseOllamaUrl(config.ollama.baseUrl, 'Ollama baseUrl').origin, explicit: true };
  if (host) return { baseUrl: parseOllamaUrl(host, 'OLLAMA_HOST').origin, explicit: true };
  return { baseUrl: OLLAMA_DEFAULT_BASE, explicit: false };
}

export interface OllamaCatalog { models: Model[]; reachable: boolean; notes: string[] }

const offlineCatalog = (): OllamaCatalog => ({ models: [], reachable: false, notes: [] });

/**
 * Live listing of a local Ollama server: /api/tags names every installed model and /api/show
 * supplies its capabilities and trained context. An unreachable or broken server yields an
 * empty catalog — auto-detection must never fail a launch — while per-model failures become notes.
 */
export async function ollamaCatalog(baseUrl: string, send: typeof fetch = fetch, timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<OllamaCatalog> {
  let listed: unknown;
  try {
    const tags = await send(baseUrl + '/api/tags', { signal: AbortSignal.timeout(timeoutMs) });
    if (!tags.ok) return offlineCatalog();
    listed = ((await tags.json()) as any)?.models;
  } catch { return offlineCatalog(); }
  if (!Array.isArray(listed)) return offlineCatalog();
  const described = await Promise.all((listed as any[]).map(entry => describeModel(entry, baseUrl, send, timeoutMs)));
  return {
    models: described.flatMap(entry => entry.model ? [entry.model] : []).sort((a, b) => a.id.localeCompare(b.id)),
    reachable: true,
    notes: described.flatMap(entry => entry.note ? [entry.note] : []),
  };
}

async function describeModel(entry: any, baseUrl: string, send: typeof fetch, timeoutMs: number): Promise<{ model?: Model; note?: string }> {
  const name = typeof entry?.name === 'string' ? entry.name : '';
  if (!name) return { note: 'Ollama entry without a model name skipped.' };
  try {
    const response = await send(baseUrl + '/api/show', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { note: 'Ollama model "' + name + '" skipped: /api/show answered HTTP ' + response.status + '.' };
    const details = (await response.json()) as any;
    const architecture = details?.model_info?.['general.architecture'];
    const context = details?.model_info?.[String(architecture) + '.context_length'];
    if (typeof architecture !== 'string' || !Number.isSafeInteger(context) || context < 1024)
      return { note: 'Ollama model "' + name + '" skipped: no usable context_length in model_info.' };
    const capabilities: unknown[] = Array.isArray(details?.capabilities) ? details.capabilities : [];
    const size = [entry?.details?.parameter_size, entry?.details?.quantization_level].filter(Boolean).join(' ');
    return { model: {
      id: name, upstream: name, provider: 'ollama', label: name + (size ? ' · ' + size : ''),
      context, tools: capabilities.includes('tools'), vision: capabilities.includes('vision'), efforts: [],
      source: 'Ollama live /api/tags + /api/show listing (not an inference check)',
      fetchedAt: new Date().toISOString(), auth: 'authenticated',
    } };
  } catch { return { note: 'Ollama model "' + name + '" skipped: /api/show failed.' }; }
}

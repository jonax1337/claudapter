type Fields = Record<string, unknown>;

export interface WebSource { url: string; title?: string }

const JSON_LINK = /\{[^{}]*"title"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"url"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}|\{[^{}]*"url"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"title"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}/g;
const BARE_URL = /https?:\/\/[^\s"'<>)\]]+/g;
const MAX_SOURCES = 50;

const isRecord = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value);

function unescapeJson(value: string): string {
  try { return JSON.parse('"' + value + '"'); } catch { return value; }
}

function linksInResult(result: unknown): WebSource[] {
  const results = isRecord(result) && Array.isArray(result.results) ? result.results : [];
  return results.flatMap(group => (isRecord(group) && Array.isArray(group.content) ? group.content : []))
    .filter((item): item is Fields => isRecord(item) && typeof item.url === 'string')
    .map(item => ({ url: item.url as string, title: typeof item.title === 'string' ? item.title : undefined }));
}

function linksInText(output: string): WebSource[] {
  const titled = [...output.matchAll(JSON_LINK)].map(match => ({
    url: unescapeJson(match[2] ?? match[3]), title: unescapeJson(match[1] ?? match[4]) }));
  return titled.length ? titled : (output.match(BARE_URL) ?? []).map(url => ({ url: url.replace(/[.,;]+$/, '') }));
}

/** Distinct sources of a WebSearch result: structured result first, then the links printed in the output text. */
export function webSources(output: string, result: unknown): WebSource[] {
  const structured = linksInResult(result);
  const seen = new Set<string>();
  return (structured.length ? structured : linksInText(output)).filter(source => !seen.has(source.url) && !!seen.add(source.url)).slice(0, MAX_SOURCES);
}

/** Short `host/path` form of a URL for a one-line source entry. */
export function sourceLabel(source: WebSource): string {
  try {
    const parsed = new URL(source.url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return parsed.host + path;
  } catch {
    return source.url;
  }
}

export interface FetchMeta { code?: number; codeText?: string; bytes?: number }

export function fetchMeta(result: unknown): FetchMeta {
  if (!isRecord(result)) return {};
  return {
    code: typeof result.code === 'number' ? result.code : undefined,
    codeText: typeof result.codeText === 'string' ? result.codeText : undefined,
    bytes: typeof result.bytes === 'number' ? result.bytes : undefined,
  };
}

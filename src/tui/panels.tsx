import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import type { Model } from '../models.js';
import type { UsageSnapshot } from '../usage.js';
import { safeText, wrapText } from './editor.js';

export type TranscriptEntry = {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'notice' | 'error';
  text: string;
  toolName?: string;
  status?: 'running' | 'done' | 'error';
  details?: string;
  agent?: string;
};
export type Entry = TranscriptEntry;

export type TranscriptLine = { text: string; tone: 'text' | 'accent' | 'muted' | 'code' | 'error'; bold?: boolean };
type Size = { width: number; height: number; accent: string; scroll?:number };
const dimension = (n: number) => Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : 1;
const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const format = (n: unknown) => number(n) ? n.toLocaleString('en-US') : 'unknown';
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const label = (v: unknown, fallback = 'unknown') => typeof v === 'string' && v ? safeText(v) : fallback;

function add(lines: TranscriptLine[], text: string, width: number, tone: TranscriptLine['tone'] = 'text', bold = false, prefix = '') {
  const usablePrefix = width > prefix.length + 1 ? prefix : '';
  for (const line of wrapText(text, Math.max(1, width - usablePrefix.length))) lines.push({ text: width === 1 && stringWidth(line) > 1 ? '?' : usablePrefix + line, tone, bold });
}

/** Logical, terminal-safe rows. Fenced code keeps indentation and line breaks. */
export function transcriptLines(entries: TranscriptEntry[], width: number, showThinking = false): TranscriptLine[] {
  const columns = dimension(width);
  const lines: TranscriptLine[] = [];
  for (const entry of entries) {
    if (entry.kind === 'thinking' && !showThinking) continue;
    if (lines.length) lines.push({ text: '', tone: 'muted' });
    const agent = entry.agent ? ` · ${safeText(entry.agent)}` : '';
    if (entry.kind === 'tool') {
      const status = entry.status === 'running' ? 'RUNNING' : entry.status === 'error' ? 'FAILED' : entry.status === 'done' ? 'DONE' : 'TOOL';
      add(lines, `┌ ${label(entry.toolName, 'Tool')}  ·  ${status}${agent}`, columns, entry.status === 'error' ? 'error' : 'accent', true);
      add(lines, entry.text, columns, 'muted', false, '│ ');
      if (entry.details) add(lines, entry.details, columns, 'code', false, '│ ');
      add(lines, '└', columns, 'muted');
      continue;
    }
    const role = { user: 'YOU', assistant: 'CLAUDAPTER', thinking: 'THINKING', notice: 'NOTICE', error: 'ERROR' }[entry.kind];
    const tone = entry.kind === 'error' ? 'error' : entry.kind === 'thinking' || entry.kind === 'notice' ? 'muted' : 'accent';
    add(lines, role + agent, columns, tone, true);
    let fence: { marker: string; length: number } | undefined;
    for (const paragraph of safeText(entry.text).split('\n')) {
      const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(paragraph);
      if (marker && !fence) {
        fence = { marker: marker[1][0], length: marker[1].length };
        add(lines, `┌ ${marker[2].trim() || 'code'}`, columns, 'muted');
      } else if (marker && fence && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined;
        add(lines, '└', columns, 'muted');
      } else if (fence) add(lines, paragraph, columns, 'code', false, '│ ');
      else {
        const heading = /^#{1,6}\s+(.+)$/.exec(paragraph);
        add(lines, heading?.[1] ?? paragraph, columns, entry.kind === 'error' ? 'error' : entry.kind === 'thinking' || entry.kind === 'notice' ? 'muted' : 'text', Boolean(heading), '  ');
      }
    }
  }
  return lines;
}

function Rows({ lines, width, accent }: { lines: TranscriptLine[]; width: number; accent: string }) {
  return <Box flexDirection="column" width={width} flexShrink={0}>{lines.map((line, index) => <Text key={index}
    color={line.tone === 'accent' ? accent : line.tone === 'error' ? '#f08a91' : line.tone === 'code' ? '#b9c9dd' : undefined}
    dimColor={line.tone === 'muted'} bold={line.bold} wrap="truncate-end">{line.text || ' '}</Text>)}</Box>;
}

export function TranscriptView({ entries, width, height, scroll = 0, showThinking = false, accent }: Size & {
  entries: TranscriptEntry[]; scroll?: number; showThinking?: boolean;
}) {
  const columns = dimension(width), rows = dimension(height);
  const all = transcriptLines(entries, columns, showThinking);
  if (!all.length) return <Box width={columns} height={rows} flexDirection="column" justifyContent="center">
    <Text color={accent} bold wrap="truncate-end">Your workspace. Your models.</Text>
    {rows > 1 && <Text dimColor wrap="truncate-end">Ask a question, start a task, or type / for commands.</Text>}
  </Box>;
  const viewport = Math.max(1, rows - 1);
  const offset = Math.min(Math.max(0, Number.isFinite(scroll) ? Math.trunc(scroll) : 0), Math.max(0, all.length - viewport));
  const end = all.length - offset, start = Math.max(0, end - viewport);
  return <Box width={columns} height={rows} flexDirection="column" overflow="hidden">
    <Rows lines={all.slice(start, end)} width={columns} accent={accent}/>
    {rows > 1 && <Box marginTop={Math.max(0, viewport - (end - start))}><Text dimColor wrap="truncate-end">
      {offset ? `↑ ${start} earlier · ↓ ${offset} newer · End to follow` : start ? `↑ ${start} earlier · PgUp to browse` : ' '}
    </Text></Box>}
  </Box>;
}

function Panel({ title, subtitle, lines, width, height, accent,scroll=0 }: Size & { title: string; subtitle: string; lines: TranscriptLine[] }) {
  const columns = dimension(width), rows = dimension(height);
  const content: TranscriptLine[] = [];
  add(content, title, columns, 'accent', true);
  if (rows > 1) add(content, subtitle, columns, 'muted');
  content.push({ text: '', tone: 'muted' }, ...lines);
  const offset=Math.min(Math.max(0,scroll),Math.max(0,content.length-rows+1));
  const visible = content.length > rows ? [...content.slice(offset,offset+rows-1), { text: `${offset+1}–${Math.min(offset+rows-1,content.length)} / ${content.length} · PgUp/PgDn scroll`, tone: 'muted' as const }] : content;
  return <Box width={columns} height={rows} flexDirection="column" overflow="hidden"><Rows lines={visible} width={columns} accent={accent}/></Box>;
}

function meter(percent: number, width: number) {
  const cells = Math.max(2, Math.min(20, width - 14));
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * cells);
  return '━'.repeat(filled) + '─'.repeat(cells - filled);
}

export function UsagePanel({ snapshot, width, height, accent,scroll }: Size & { snapshot?: UsageSnapshot | null }) {
  const columns = dimension(width), lines: TranscriptLine[] = [];
  if (!snapshot) add(lines, 'Usage has not been loaded. Account quotas and request usage are unknown.', columns, 'muted');
  else {
    for (const provider of snapshot.providers) {
      add(lines, `${provider.provider.toUpperCase()}${provider.stale ? '  ·  STALE' : ''}`, columns, 'accent', true);
      add(lines, `Quota · ${provider.state}${provider.updatedAt ? ` · ${provider.updatedAt}` : ''}`, columns, 'muted');
      if (!provider.windows.length) add(lines, 'Quota remaining · unknown', columns);
      for (const window of provider.windows) {
        const known = number(window.usedPercent) && window.usedPercent <= 100;
        add(lines, `${window.label ?? window.id} · ${known ? `${window.usedPercent}% used` : 'usage unknown'}`, columns);
        if (known) add(lines, meter(window.usedPercent!, columns), columns, 'accent');
        if (window.resetsAt) add(lines, `Resets · ${window.resetsAt}`, columns, 'muted');
      }
      if (provider.reason) add(lines, provider.reason, columns, 'muted');
      add(lines, `Source · ${provider.source}`, columns, 'muted');
      add(lines, `Cost · unknown. ${provider.money.note}`, columns, 'muted');
      lines.push({ text: '', tone: 'muted' });
    }
    if (!snapshot.providers.length) add(lines, 'Account quotas · unknown; no provider data.', columns, 'muted');
    add(lines, 'REQUEST TOKENS', columns, 'accent', true);
    if (!snapshot.totals.length) add(lines, 'No completed request accounting yet.', columns, 'muted');
    for (const total of snapshot.totals) {
      add(lines, `${total.provider} / ${total.actualModel}${total.agent ? ` · agent ${total.agent}` : total.requestClass ? ` · ${total.requestClass}` : ' · unattributed'}`, columns, 'text', true);
      if (total.reportedModel && total.reportedModel !== total.actualModel) add(lines, `Provider reported · ${total.reportedModel}`, columns, 'muted');
      add(lines, `Input ${format(total.tokens?.input)} · Output ${format(total.tokens?.output)}`, columns);
      add(lines, `Cache read ${format(total.tokens?.cacheRead)} · Cache write ${format(total.tokens?.cacheCreate)} · Reasoning ${format(total.tokens?.reasoning)}`, columns, 'muted');
      add(lines, `${total.completed}/${total.attempts} completed · ${total.unknown} unmeasured · ${total.interrupted} interrupted`, columns, 'muted');
    }
    const pending = snapshot.attempts.filter(a => a.outcome === 'pending').length;
    if (pending) add(lines, `${pending} request${pending === 1 ? '' : 's'} in progress; tokens not yet reported.`, columns, 'muted');
    add(lines, `Since · ${snapshot.since}`, columns, 'muted');
    add(lines, snapshot.scope, columns, 'muted');
    add(lines, 'Cache/reasoning are subsets; do not add them to input/output. Missing usage is not zero.', columns, 'muted');
  }
  return <Panel title="USAGE" subtitle="Provider quotas · actual routed models · reported tokens" lines={lines} width={columns} height={height} accent={accent} scroll={scroll}/>;
}

export function ContextPanel({ context, model, width, height, accent,scroll }: Size & { context?: unknown; model?: Model | string | null }) {
  const columns = dimension(width), lines: TranscriptLine[] = [];
  const data = object(context) ? context : {};
  const catalog = typeof model === 'object' && model ? model : undefined;
  add(lines, label(catalog?.label ?? model, 'Current model'), columns, 'accent', true);
  add(lines, `Catalog capacity · ${format(catalog?.maxContext ?? catalog?.context)} tokens`, columns);
  if (catalog?.contextSource) add(lines, `Catalog source · ${catalog.contextSource}`, columns, 'muted');
  add(lines, `Engine model · ${label(data.model)}`, columns, 'muted');
  add(lines, `Engine capacity · ${format(data.rawMaxTokens)} tokens`, columns);
  add(lines, `Active context window · ${format(data.maxTokens)} tokens`, columns);
  add(lines, `Auto-compact threshold · ${format(data.autoCompactThreshold)} tokens`, columns);
  add(lines, `Context used · ${format(data.totalTokens)} tokens (engine estimate)`, columns);
  if (number(data.totalTokens) && number(data.maxTokens) && data.maxTokens > 0) {
    const ratio = data.totalTokens / data.maxTokens * 100;
    add(lines, `${meter(ratio, columns)}  ${ratio.toFixed(1)}%`, columns, ratio > 100 ? 'error' : 'accent');
    if (ratio > 100) add(lines, 'Context exceeds the active window. Compact before continuing.', columns, 'error');
  }
  lines.push({ text: '', tone: 'muted' });
  if (Array.isArray(data.categories)) {
    for (const item of data.categories) if (object(item) && typeof item.name === 'string') add(lines, `${item.name} · ${format(item.tokens)}`, columns, item.kind === 'used' ? 'text' : 'muted');
  } else add(lines, 'Context breakdown not loaded. Refresh to request engine estimates.', columns, 'muted');
  add(lines, 'Catalog limits, engine limits and measured provider tokens are distinct. Summary counts can be estimates.', columns, 'muted');
  return <Panel title="CONTEXT" subtitle="Capacity and compaction · kept separate from account limits" lines={lines} width={columns} height={height} accent={accent} scroll={scroll}/>;
}

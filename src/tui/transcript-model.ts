import { safeText } from './editor.js';
import { imageBlocks, type ImageRef } from './image-info.js';

export type TranscriptEntry = {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'notice' | 'error' | 'permission';
  text: string;
  toolName?: string;
  status?: 'running' | 'done' | 'error';
  /** Legacy flat rendering of tool input and output; structured consumers use `input`/`output`. */
  details?: string;
  agent?: string;
  /** Parsed tool input. */
  input?: Record<string, unknown>;
  /** Flattened tool result text, capped at 16000 characters. */
  output?: string;
  isError?: boolean;
  /** Controller task that this tool call spawned. */
  taskId?: string;
  /** Estimated thinking tokens; the text may be empty because the model redacts it. */
  thinkingTokens?: number;
  redacted?: boolean;
  /** Milliseconds from tool start to its result. */
  elapsedMs?: number;
  /** Raw structured tool result (e.g. Edit/Write patch data), at most 16 KB serialized. */
  result?: unknown;
  /** Permission request and its decision, for `permission` entries. */
  permission?: PermissionRecord;
  /** Images attached to a prompt or returned by a tool. */
  images?: ImageRef[];
};

export const OUTPUT_LIMIT = 16000;
const RESULT_LIMIT = 16 * 1024;
export const HISTORY_TAIL = 150;
export const INTERRUPTED_RESULT = 'No result recorded (interrupted)';
export const COMPACTION_NOTICE = 'Conversation compacted; earlier context was summarized.';

const SYNTHETIC_BLOCK = /^\s*<(system-reminder|command-name|command-message|command-args|local-command-[a-z]+|user-prompt-submit-hook|task-notification)\b|^\s*\[Request interrupted by user/;
const INLINE_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Tool result content as text. Text blocks are joined; other blocks are named, never JSON-dumped. */
export function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  if (!Array.isArray(content)) return JSON.stringify(content, null, 2);
  return content.map((block: any) => block?.type === 'text' ? block.text ?? '' : block?.type === 'image' ? '[image]' : JSON.stringify(block)).join('\n');
}

/** Structured tool results are kept only when small enough to ship through UI state. */
export function smallResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= RESULT_LIMIT ? value : undefined;
  } catch { return undefined; }
}

/** Text the user typed. Engine-injected reminders and command wrappers are dropped. */
export function promptText(content: unknown): string {
  if (typeof content === 'string') return SYNTHETIC_BLOCK.test(content) ? '' : content.replace(INLINE_REMINDER, '').trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string' && !SYNTHETIC_BLOCK.test(block.text))
    .map((block: any) => block.text.replace(INLINE_REMINDER, '').trim())
    .filter(Boolean).join('\n');
}

export const isMetaMessage = (message: any) => message.isMeta === true || message.is_meta === true || message.isSynthetic === true;

/** Sub-agent frames carry the spawning tool call; they belong to the sub-agent's transcript, never to the main one. */
export const isSubagentMessage = (message: any) => typeof message.parent_tool_use_id === 'string' && message.parent_tool_use_id !== '';

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const AGENT_ID_TRAILER = /\bagentId:\s*([A-Za-z0-9_-]+)/;

/** The sub-agent an Agent tool result names, from its structured result or the `agentId:` trailer of its text. */
export function reportedAgentId(toolName: string | undefined, result: unknown, output: string): string | undefined {
  if (!toolName || !AGENT_TOOLS.has(toolName)) return undefined;
  const structured = (result as { agentId?: unknown } | undefined)?.agentId;
  return typeof structured === 'string' && structured ? structured : AGENT_ID_TRAILER.exec(output)?.[1];
}

/** Terminal-safe copy without undefined fields, so partial updates never erase known values when merged. */
export function sanitizeEntry(entry: TranscriptEntry): TranscriptEntry {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) if (value !== undefined) clean[key] = value;
  const text = (value: unknown) => typeof value === 'string' ? safeText(value) : value;
  return { ...clean, text: safeText(entry.text), ...(clean.details !== undefined ? { details: text(clean.details) } : {}), ...(clean.output !== undefined ? { output: text(clean.output) } : {}) } as TranscriptEntry;
}

export function toolStartEntry(block: any, agent?: string): TranscriptEntry {
  const input = isRecord(block.input) ? block.input : undefined;
  return { id: 'tool:' + block.id, kind: 'tool', text: block.name, toolName: block.name, status: 'running', agent,
    ...(input ? { input, details: JSON.stringify(input, null, 2) } : {}) };
}

/**
 * Entry for a text, thinking or redacted-thinking block; undefined for any other block.
 * While a block is still streaming, empty thinking text is not yet proof that the model redacted it.
 */
export function contentBlockEntry(id: string, block: any, agent?: string, streaming = false): TranscriptEntry | undefined {
  if (block.type === 'text') return { id, kind: 'assistant', text: block.text ?? '', agent };
  if (block.type === 'thinking') return { id, kind: 'thinking', text: block.thinking ?? '', agent, ...(streaming ? {} : { redacted: !block.thinking }) };
  if (block.type === 'redacted_thinking') return { id, kind: 'thinking', text: '', redacted: true, agent };
  return undefined;
}

export type PermissionDecision = 'pending' | 'allow-once' | 'allow-session' | 'deny' | 'cancelled';

/** A permission request and how it ended: `decidedBy` is the user, or the engine when the request was aborted. */
export interface PermissionRecord { decision: PermissionDecision; decidedBy?: 'user' | 'engine'; agentId?: string; blockedPath?: string; rules?: string[] }

const INPUT_FIELD_LIMIT = 300;

/** Shallow copy of a tool input with long strings clipped: enough to name the request, without carrying file contents. */
function clippedInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' && value.length > INPUT_FIELD_LIMIT ? value.slice(0, INPUT_FIELD_LIMIT) + '…' : value]));
}

/** Transcript row for a permission request; the id is derived from the engine's request id so decisions update the same row. */
export function permissionEntry(requestId: string, toolName: string, input: Record<string, unknown>, permission: PermissionRecord): TranscriptEntry {
  return { id: 'permission:' + requestId, kind: 'permission', text: toolName, toolName, input: clippedInput(input), permission };
}

/** `Tool(content)` names of the session rules a permission suggestion would add. */
export function suggestionRules(suggestions: unknown): string[] {
  return (Array.isArray(suggestions) ? suggestions : []).flatMap(suggestion => (Array.isArray(suggestion?.rules) ? suggestion.rules : []))
    .map((rule: any) => (rule?.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : String(rule?.toolName ?? ''))).filter(Boolean).map(safeText);
}

/** Maps the dialog answer to a decision. An aborted request ends as cancelled, decided by the engine rather than the user. */
export function permissionOutcome(answer: unknown, aborted: boolean): Pick<PermissionRecord, 'decision' | 'decidedBy'> {
  if (aborted) return { decision: 'cancelled', decidedBy: 'engine' };
  return { decision: answer === 'allow' ? 'allow-once' : answer === 'session' ? 'allow-session' : 'deny', decidedBy: 'user' };
}

export interface ToolResultContext { existing?: TranscriptEntry; elapsedMs?: number; result?: unknown }

/** Entry update that closes a tool call. `details` stays the legacy flat input-plus-output rendering. */
export function toolResultEntry(block: any, { existing, elapsedMs, result }: ToolResultContext): TranscriptEntry {
  const output = safeText(flattenToolResult(block.content)).slice(0, OUTPUT_LIMIT);
  const isError = Boolean(block.is_error);
  const images = imageBlocks(block.content);
  return { id: 'tool:' + block.tool_use_id, kind: 'tool', text: existing?.toolName ?? 'Tool result', toolName: existing?.toolName,
    status: isError ? 'error' : 'done', details: (existing?.details ?? '') + '\n\n' + output, agent: existing?.agent,
    output, isError, elapsedMs, result: smallResult(result), ...(images.length ? { images } : {}) };
}

/** A tool call that never got a result (the session ended mid-call) must not look like it is still running. */
export function interruptedToolEntry(entry: TranscriptEntry): TranscriptEntry {
  return { ...entry, status: 'done', output: INTERRUPTED_RESULT, isError: false, details: (entry.details ?? '') + '\n\n' + INTERRUPTED_RESULT };
}

export interface History { entries: TranscriptEntry[]; hiddenMessages: number }

class HistoryBuilder {
  readonly entries: TranscriptEntry[] = [];
  private readonly byId = new Map<string, TranscriptEntry>();
  private readonly toolStarts = new Map<string, number>();
  private readonly blocks = new Map<string, number>();

  add(message: any) {
    if (message.type === 'assistant') this.addAssistant(message);
    else if (message.type === 'user') this.addUser(message);
  }

  /** Tool calls without a result are closed so a resumed session shows no phantom running tool. */
  finish() {
    this.entries.forEach((entry, index) => {
      if (entry.kind === 'tool' && entry.status === 'running') this.entries[index] = interruptedToolEntry(entry);
    });
    return this.entries;
  }

  private push(entry: TranscriptEntry) {
    const known = this.byId.get(entry.id);
    if (known) Object.assign(known, entry);
    else { this.byId.set(entry.id, entry); this.entries.push(entry); }
  }

  private nextBlockId(messageId: string) {
    const index = this.blocks.get(messageId) ?? 0;
    this.blocks.set(messageId, index + 1);
    return 'block:' + messageId + ':f' + index;
  }

  private addAssistant(message: any) {
    const agent = message.parent_tool_use_id ?? undefined;
    for (const block of message.message?.content ?? []) {
      if (block.type === 'tool_use') {
        this.toolStarts.set(block.id, Date.parse(message.timestamp));
        this.push(toolStartEntry(block, agent));
        continue;
      }
      const entry = contentBlockEntry(this.nextBlockId(message.message?.id ?? message.uuid), block, agent);
      if (entry && (entry.kind !== 'assistant' || entry.text)) this.push(entry);
    }
  }

  private addUser(message: any) {
    const content = message.message?.content;
    if (message.isCompactSummary) { this.push({ id: 'notice:' + message.uuid, kind: 'notice', text: COMPACTION_NOTICE }); return; }
    const text = isMetaMessage(message) ? '' : promptText(content);
    const images = isMetaMessage(message) ? [] : imageBlocks(content);
    if (text || images.length) this.push({ id: message.uuid, kind: 'user', text, ...(images.length ? { images } : {}) });
    for (const block of Array.isArray(content) ? content : []) if (block.type === 'tool_result') this.addToolResult(block, message);
  }

  private addToolResult(block: any, message: any) {
    const existing = this.byId.get('tool:' + block.tool_use_id);
    if (!existing || existing.status !== 'running') return;
    const elapsedMs = Date.parse(message.timestamp) - (this.toolStarts.get(block.tool_use_id) ?? NaN);
    const closed = toolResultEntry(block, { existing, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : undefined });
    const agentId = reportedAgentId(existing.toolName, message.toolUseResult ?? message.tool_use_result, closed.output ?? '');
    this.push(agentId ? { ...closed, taskId: agentId } : closed);
  }
}

/**
 * Convert saved session messages into transcript entries and keep only the newest `tail` of them.
 * `hiddenMessages` counts the saved messages whose entries were cut off.
 */
export function historyEntries(messages: any[], tail = HISTORY_TAIL): History {
  const builder = new HistoryBuilder();
  const entryCountAfter = messages.map(message => { builder.add(message); return builder.entries.length; });
  const entries = builder.finish();
  const cut = Math.max(0, entries.length - tail);
  const hiddenMessages = cut ? entryCountAfter.filter(count => count <= cut).length : 0;
  if (!hiddenMessages) return { entries, hiddenMessages: 0 };
  return { entries: [{ id: 'notice:history-truncated', kind: 'notice', text: hiddenMessages + ' earlier messages hidden' }, ...entries.slice(cut)], hiddenMessages };
}

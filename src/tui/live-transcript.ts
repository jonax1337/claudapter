import { randomUUID } from 'node:crypto';
import { safeText } from './editor.js';
import type { TranscriptEntry } from './transcript-model.js';
import { StreamTrace } from './stream-trace.js';
import { contentBlockEntry, isMetaMessage, promptText, sanitizeEntry, toolResultEntry, toolStartEntry } from './transcript-model.js';

export interface TranscriptHooks {
  changed(): void;
  taskOfTool(toolUseId: string): string | undefined;
  /** Every start and every result of a tool call in this stream. */
  toolChanged?(entry: TranscriptEntry): void;
}

/**
 * One conversation thread (the main agent or one sub-agent) folded from engine messages into transcript
 * entries. Streamed blocks, their complete messages and tool results are reconciled per thread, so two
 * threads never share entry ids, thinking state or the message being streamed.
 */
export class LiveTranscript {
  private readonly trace = new StreamTrace();
  private thinking: { entryId?: string; pendingTokens?: number } = {};
  private messageId = 'stream';

  constructor(private readonly entries: () => TranscriptEntry[], private readonly hooks: TranscriptHooks, private readonly limit: number) {}

  reset() {
    this.trace.reset();
    this.thinking = {};
    this.messageId = 'stream';
  }

  entry(id: string) {
    return this.entries().find(entry => entry.id === id);
  }

  upsert(entry: TranscriptEntry) {
    const entries = this.entries();
    const clean = sanitizeEntry(entry);
    const index = entries.findIndex(known => known.id === clean.id);
    if (index < 0) entries.push(clean); else entries[index] = { ...entries[index], ...clean };
    if (entries.length > this.limit) entries.splice(0, entries.length - this.limit);
    this.hooks.changed();
  }

  patch(id: string, patch: Partial<TranscriptEntry>) {
    const entries = this.entries();
    const index = entries.findIndex(entry => entry.id === id);
    if (index < 0) return;
    entries[index] = { ...entries[index], ...patch };
    this.hooks.changed();
  }

  /** The agent id an Agent tool result reported for the tool call `toolUseId`. */
  agentOf(toolUseId: string | undefined) {
    return this.trace.agentOf(toolUseId);
  }

  stream(event: any) {
    if (event.type === 'message_start') this.messageId = event.message.id;
    const key = 'block:' + this.messageId + ':' + event.index;
    if (event.type === 'content_block_start') this.startBlock(key, event.content_block);
    else if (event.type === 'content_block_delta') this.appendDelta(key, event.delta);
    else if (event.type === 'content_block_stop') this.stopBlock(key);
    else if (event.type === 'message_stop') this.thinking.entryId = undefined;
  }

  assistant(message: any) {
    for (const [index, block] of (message.message?.content ?? []).entries()) {
      if (block.type === 'tool_use') { this.upsertTool(block); continue; }
      const kind = block.type === 'text' ? 'assistant' : 'thinking';
      const entry = contentBlockEntry(this.trace.finalBlockId(message, index, kind, id => this.entry(id)?.kind), block);
      if (entry) this.upsert(entry);
    }
  }

  /** Prompt text (shown once, a replayed echo never rewrites it) and tool results of a user message. */
  user(message: any) {
    const content = message.message?.content;
    const text = isMetaMessage(message) ? '' : promptText(content);
    const id = message.uuid ?? message.message?.id ?? randomUUID();
    if (text && !this.entry(id)) this.upsert({ id, kind: 'user', text });
    const results = (Array.isArray(content) ? content : []).filter((block: any) => block.type === 'tool_result');
    for (const block of results) {
      this.trace.rememberAgent(block.tool_use_id, message.tool_use_result?.agentId);
      this.closeTool(block, results.length === 1 ? message.tool_use_result : undefined);
    }
  }

  /** Thinking progress arrives as a token estimate while the model hides the thinking text. */
  thinkingTokens(tokens: unknown) {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return;
    const id = this.thinking.entryId;
    if (!id) { this.thinking.pendingTokens = tokens; return; }
    this.patch(id, { thinkingTokens: tokens, ...(this.entry(id)?.text ? {} : { redacted: true }) });
  }

  private startBlock(key: string, block: any) {
    if (block.type === 'tool_use') { this.upsertTool(block); return; }
    const entry = contentBlockEntry(key, block, undefined, true);
    if (!entry) return;
    this.trace.streamedBlock(this.messageId, key);
    if (entry.kind === 'thinking') { entry.thinkingTokens = this.thinking.pendingTokens; this.thinking = { entryId: key }; }
    this.upsert(entry);
  }

  private appendDelta(key: string, delta: any) {
    const entry = this.entry(key);
    if (!entry) return;
    entry.text += safeText(delta.text ?? delta.thinking ?? '');
    this.hooks.changed();
  }

  private stopBlock(key: string) {
    if (this.thinking.entryId !== key) return;
    this.thinking.entryId = undefined;
    if (!this.entry(key)?.text) this.patch(key, { redacted: true });
  }

  private upsertTool(block: any) {
    const previous = this.entry('tool:' + block.id);
    const finished = previous?.status === 'done' || previous?.status === 'error';
    const start = toolStartEntry(block);
    this.trace.toolStarted(block.id);
    this.upsert({ ...start, status: previous?.status ?? 'running', details: finished ? previous.details : start.details, taskId: this.hooks.taskOfTool(block.id) });
    this.hooks.toolChanged?.(this.entry(start.id)!);
  }

  private closeTool(block: any, result: unknown) {
    const existing = this.entry('tool:' + block.tool_use_id);
    if (existing?.status === 'done' || existing?.status === 'error') return;
    this.upsert(toolResultEntry(block, { existing, elapsedMs: this.trace.toolElapsedMs(block.tool_use_id), result }));
    this.hooks.toolChanged?.(this.entry('tool:' + block.tool_use_id)!);
  }
}

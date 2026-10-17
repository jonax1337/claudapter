import type { TranscriptEntry } from './transcript-model.js';

/**
 * Bookkeeping that ties live stream events to the complete messages that follow them.
 *
 * The engine emits every content block of one API response as its own `assistant` message with the
 * same message id, so the block position inside a message cannot identify an entry. A finished block
 * therefore claims the first unclaimed streamed entry of its kind, or gets a fresh id.
 */
export class StreamTrace {
  private readonly streamed = new Map<string, string[]>();
  private readonly claimed = new Set<string>();
  private readonly finalIds = new Map<string, string>();
  private readonly toolStarts = new Map<string, number>();
  private readonly agentIds = new Map<string, string>();
  private finalCount = 0;

  reset() {
    for (const memory of [this.streamed, this.claimed, this.finalIds, this.toolStarts, this.agentIds] as { clear(): void }[]) memory.clear();
    this.finalCount = 0;
  }

  streamedBlock(messageId: string, entryId: string) {
    this.streamed.set(messageId, [...(this.streamed.get(messageId) ?? []), entryId]);
  }

  /** Stable entry id of block `index` of a complete message, reconciled with its streamed entry when one exists. */
  finalBlockId(message: any, index: number, kind: TranscriptEntry['kind'], kindOf: (entryId: string) => TranscriptEntry['kind'] | undefined) {
    const messageId: string = message.message.id;
    const key = (message.uuid ?? messageId) + ':' + index;
    const known = this.finalIds.get(key);
    if (known) return known;
    const streamed = (this.streamed.get(messageId) ?? []).find(id => !this.claimed.has(id) && kindOf(id) === kind);
    const id = streamed ?? 'block:' + messageId + ':f' + this.finalCount++;
    this.claimed.add(id);
    this.finalIds.set(key, id);
    return id;
  }

  toolStarted(toolUseId: string) {
    if (!this.toolStarts.has(toolUseId)) this.toolStarts.set(toolUseId, Date.now());
  }

  toolElapsedMs(toolUseId: string) {
    const started = this.toolStarts.get(toolUseId);
    return started === undefined ? undefined : Date.now() - started;
  }

  rememberAgent(toolUseId: string, agentId: unknown) {
    if (typeof agentId === 'string' && agentId) this.agentIds.set(toolUseId, agentId);
  }

  agentOf(toolUseId: string | undefined) {
    return toolUseId === undefined ? undefined : this.agentIds.get(toolUseId);
  }
}

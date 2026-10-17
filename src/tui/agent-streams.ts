import type { TranscriptEntry } from './transcript-model.js';
import { LiveTranscript } from './live-transcript.js';
import type { RelayView } from './agent-relay.js';

/** Entries kept per sub-agent; the oldest fall off first, like the main transcript. */
export const AGENT_ENTRY_LIMIT = 1500;
const HINT_LIMIT = 80;
const HINT_KEYS = ['description', 'file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query'];

/** Per agent: revision and size of its own transcript, its last action and the state of the latest relayed message. */
export interface AgentStreamView { id: string; revision: number; entries: number; lastAction?: string; relay?: RelayView }

export interface AgentStreamHooks {
  changed(): void;
  taskOfTool(toolUseId: string): string | undefined;
}

interface AgentThread { id: string; entries: TranscriptEntry[]; transcript: LiveTranscript }

/**
 * Every sub-agent's own transcript, captured from the engine stream whether or not anybody looks at it.
 *
 * Sub-agent frames carry the spawning tool call in `parent_tool_use_id`; complete messages also carry the
 * agent id, which equals the `task_id` of the agent's task events. Frames whose agent is not yet known are
 * kept under their tool call id and adopted by the agent once the id is learned.
 */
export class AgentStreams {
  readonly views: Record<string, AgentStreamView> = {};
  private readonly threads = new Map<string, AgentThread>();
  private readonly agentsByTool = new Map<string, string>();

  constructor(private readonly hooks: AgentStreamHooks) {}

  /** Folds one sub-agent message into its agent's own thread and returns the agent id. */
  receive(message: any): string {
    const thread = this.thread(this.agentOf(message));
    if (message.type === 'stream_event') thread.transcript.stream(message.event);
    else if (message.type === 'assistant') thread.transcript.assistant(message);
    else if (message.type === 'user') thread.transcript.user(message);
    return thread.id;
  }

  /** Records that the tool call `toolUseId` runs the agent `agentId`. */
  learn(toolUseId: string | undefined, agentId: string | undefined) {
    if (!toolUseId || !agentId || this.agentsByTool.get(toolUseId) === agentId) return;
    this.agentsByTool.set(toolUseId, agentId);
    if (toolUseId !== agentId) this.adopt(toolUseId, agentId);
  }

  entries(agentId: string): TranscriptEntry[] {
    return this.threads.get(agentId)?.entries.map(entry => ({ ...entry })) ?? [];
  }

  add(agentId: string, entry: TranscriptEntry) {
    this.thread(agentId).transcript.upsert(entry);
  }

  setRelay(agentId: string, relay: RelayView) {
    this.view(agentId).relay = relay;
    this.hooks.changed();
  }

  /** Marks the agent's tool entry for `toolUseId` as the call that runs task `taskId`, in whichever thread holds it. */
  linkTask(toolUseId: string, taskId: string) {
    for (const { transcript } of this.threads.values()) {
      const tool = transcript.entry('tool:' + toolUseId);
      if (tool && tool.taskId !== taskId) transcript.patch(tool.id, { taskId });
    }
  }

  /** The agent id a nested Agent tool result reported for `toolUseId`. */
  reportedAgent(toolUseId: string | undefined) {
    for (const { transcript } of this.threads.values()) {
      const agentId = transcript.agentOf(toolUseId);
      if (agentId) return agentId;
    }
    return undefined;
  }

  reset() {
    this.threads.clear();
    this.agentsByTool.clear();
    for (const id of Object.keys(this.views)) delete this.views[id];
  }

  private agentOf(message: any): string {
    const toolUseId: string = message.parent_tool_use_id;
    this.learn(toolUseId, typeof message.agent_id === 'string' ? message.agent_id : undefined);
    return this.agentsByTool.get(toolUseId) ?? toolUseId;
  }

  private thread(id: string): AgentThread {
    const known = this.threads.get(id);
    if (known) return known;
    const entries: TranscriptEntry[] = [];
    const thread: AgentThread = { id, entries, transcript: undefined! };
    thread.transcript = new LiveTranscript(() => entries, {
      changed: () => this.touch(thread),
      taskOfTool: toolUseId => this.hooks.taskOfTool(toolUseId),
      toolChanged: entry => { if (entry.status === 'running') { this.view(thread.id).lastAction = actionHint(entry); this.hooks.changed(); } },
    }, AGENT_ENTRY_LIMIT);
    this.threads.set(id, thread);
    return thread;
  }

  private adopt(toolUseId: string, agentId: string) {
    const provisional = this.threads.get(toolUseId);
    if (!provisional) return;
    this.threads.delete(toolUseId);
    delete this.views[toolUseId];
    const target = this.threads.get(agentId);
    if (target) target.entries.unshift(...provisional.entries);
    else { provisional.id = agentId; this.threads.set(agentId, provisional); }
    this.touch(target ?? provisional);
  }

  private view(id: string): AgentStreamView {
    return this.views[id] ??= { id, revision: 0, entries: 0 };
  }

  private touch(thread: AgentThread) {
    const view = this.view(thread.id);
    view.revision++;
    view.entries = thread.entries.length;
    this.hooks.changed();
  }
}

/** "Read src/a.ts": the tool name and its most telling input, one short line. */
export function actionHint(entry: TranscriptEntry): string {
  const key = HINT_KEYS.find(candidate => typeof entry.input?.[candidate] === 'string');
  const detail = key ? String(entry.input![key]).replace(/\s+/g, ' ').trim() : '';
  const hint = [entry.toolName ?? entry.text, detail].filter(Boolean).join(' ');
  return hint.length > HINT_LIMIT ? hint.slice(0, HINT_LIMIT - 1) + '…' : hint;
}

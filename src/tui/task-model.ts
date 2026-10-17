import { safeText } from './editor.js';

export type TaskKind = 'agent' | 'workflow' | 'shell' | 'monitor' | 'other';
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  subagentType?: string;
  workflowName?: string;
  parentId?: string;
  depth?: number;
  background?: boolean;
  toolUseId?: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  lastTool?: string;
  summary?: string;
  /** UI-only. Never log it. */
  prompt?: string;
  error?: string;
  ambient?: boolean;
  /** The engine marked the task as housekeeping (`skip_transcript`). */
  hidden?: boolean;
}

export type TaskMap = Record<string, TaskView>;

const PROMPT_LIMIT = 2000;
const TERMINAL: readonly TaskStatus[] = ['completed', 'failed', 'stopped'];
const BACKGROUND_KINDS: readonly TaskKind[] = ['shell', 'monitor'];
const KINDS: Record<string, TaskKind> = { local_agent: 'agent', local_workflow: 'workflow', local_bash: 'shell', monitor: 'monitor' };

export const isTerminal = (status: TaskStatus) => TERMINAL.includes(status);

export function taskKind(taskType: unknown, subagentType?: unknown): TaskKind {
  if (typeof taskType === 'string' && KINDS[taskType]) return KINDS[taskType];
  return typeof taskType !== 'string' && subagentType ? 'agent' : 'other';
}

/** The engine reports a stopped task as `killed`. */
function taskStatus(status: unknown): TaskStatus | undefined {
  if (status === 'killed') return 'stopped';
  return ['pending', 'running', 'paused', 'completed', 'failed', 'stopped'].includes(status as string) ? status as TaskStatus : undefined;
}

const text = (value: unknown, limit?: number) => typeof value === 'string' ? safeText(limit ? value.slice(0, limit) : value) : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Copy only defined values so a partial update never erases known fields. */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function usageFields(usage: any) {
  return { totalTokens: count(usage?.total_tokens), toolUses: count(usage?.tool_uses), durationMs: count(usage?.duration_ms) };
}

function created(message: any, now: number): TaskView {
  return {
    id: message.task_id, kind: taskKind(message.task_type, message.subagent_type), title: text(message.description) ?? message.task_id,
    status: 'running', startedAt: now,
    ...defined({
      subagentType: text(message.subagent_type), workflowName: text(message.workflow_name), parentId: message.parent_task_id,
      depth: count(message.spawn_depth), background: typeof message.is_backgrounded === 'boolean' ? message.is_backgrounded : undefined,
      toolUseId: message.tool_use_id, prompt: text(message.prompt, PROMPT_LIMIT),
      ambient: message.ambient, hidden: message.skip_transcript,
    }),
  };
}

function ended(previous: TaskView, status: TaskStatus, now: number, endedAt?: number): Partial<TaskView> {
  return isTerminal(status) ? { endedAt: endedAt ?? previous.endedAt ?? now } : {};
}

const apply: Record<string, (previous: TaskView, message: any, now: number) => Partial<TaskView>> = {
  task_started: (_base, message, now) => {
    const { startedAt: _startedAt, status: _status, ...fields } = created(message, now);
    return fields;
  },
  task_progress: (_previous, message) => defined({
    ...usageFields(message.usage), lastTool: text(message.last_tool_name), summary: text(message.summary),
    subagentType: text(message.subagent_type), toolUseId: message.tool_use_id,
  }),
  task_updated: (previous, message, now) => {
    const patch = message.patch ?? {};
    const status = taskStatus(patch.status) ?? previous.status;
    return defined({
      status, title: text(patch.description), error: text(patch.error),
      background: typeof patch.is_backgrounded === 'boolean' ? patch.is_backgrounded : undefined,
      ...ended(previous, status, now, count(patch.end_time)),
    });
  },
  task_notification: (previous, message, now) => {
    const status = taskStatus(message.status) ?? previous.status;
    return defined({
      status, summary: text(message.summary), ambient: message.ambient, hidden: message.skip_transcript,
      toolUseId: message.tool_use_id, ...usageFields(message.usage), ...ended(previous, status, now),
    });
  },
};

/** Fold one `task_*` system message into the task map. Other messages are ignored. */
export function applyTaskMessage(tasks: TaskMap, message: any, now = Date.now()) {
  const reduce = apply[message.subtype];
  if (!reduce || typeof message.task_id !== 'string') return;
  const previous = tasks[message.task_id];
  const resumed = message.subtype === 'task_started' && previous && isTerminal(previous.status);
  const base = !previous || resumed ? created(message, now) : previous;
  tasks[message.task_id] = { ...base, ...reduce(base, message, now) };
}

/**
 * `background_tasks_changed` is a level signal with replace semantics: every live background task is
 * listed. Listed tasks are upserted; background tasks that are still shown as active but are missing
 * from the list lost their closing bookend and are marked stopped.
 */
export function applyBackgroundTasks(tasks: TaskMap, listed: any[], now = Date.now()) {
  const live = new Set<string>();
  for (const entry of listed) {
    const id = entry.task_id ?? entry.id;
    if (typeof id !== 'string') continue;
    live.add(id);
    const previous = tasks[id];
    if (previous && isTerminal(previous.status)) continue;
    tasks[id] = { ...(previous ?? created({ ...entry, task_id: id }, now)), ...defined({
      subagentType: text(entry.subagent_type), parentId: entry.parent_task_id, ambient: entry.ambient,
      title: previous ? undefined : text(entry.description),
    }), background: true };
  }
  for (const task of Object.values(tasks)) {
    const background = task.background || BACKGROUND_KINDS.includes(task.kind);
    if (background && !live.has(task.id) && !isTerminal(task.status) && task.status !== 'pending')
      tasks[task.id] = { ...task, status: 'stopped', endedAt: now };
  }
}

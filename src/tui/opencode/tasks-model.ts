import { truncate } from './layout';

// Structural mirror of the controller's TaskView; the UI never imports the controller types.
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
  prompt?: string;
  error?: string;
  ambient?: boolean;
  hidden?: boolean;
}

export type TaskMap = Record<string, TaskView>;

/** A finished task stays in the live strip for this long. */
export const RECENT_MS = 10_000;
export const STRIP_MAX_ROWS = 5;
/** Older tasks beyond this many are not rendered; the controller may hold far more. */
export const MAX_RENDERED_TASKS = 400;

export interface TaskNode { task: TaskView; children: TaskNode[] }
export interface TaskRow { task: TaskView; depth: number; prefix: string }

const KIND_GLYPHS: Record<TaskKind, string> = { agent: '◉', workflow: '⛓', shell: '$', monitor: '◔', other: '◇' };
const KIND_NOUNS: Record<TaskKind, [singular: string, plural: string]> = {
  agent: ['agent', 'agents'], workflow: ['workflow', 'workflows'], shell: ['shell', 'shells'],
  monitor: ['monitor', 'monitors'], other: ['task', 'tasks'] };
const FINISHED_GLYPHS: Record<TaskStatus, string> = { pending: '○', running: '●', paused: '⏸', completed: '✓', failed: '✗', stopped: '■' };

export const kindGlyph = (kind: TaskKind) => KIND_GLYPHS[kind] ?? KIND_GLYPHS.other;
export const statusGlyph = (status: TaskStatus) => FINISHED_GLYPHS[status] ?? '○';

export function isLive(task: TaskView) {
  return task.status === 'running' || task.status === 'pending' || task.status === 'paused';
}

export function isShown(task: TaskView) {
  return !task.ambient && !task.hidden;
}

const taskList = (source: TaskMap | TaskView[] | undefined) => Array.isArray(source) ? source : Object.values(source ?? {});
const newestFirst = (left: TaskView, right: TaskView) => right.startedAt - left.startedAt || left.id.localeCompare(right.id);

/** The workflow label or sub-agent type that qualifies a task title. */
export function taskType(task: TaskView): string | undefined {
  return task.kind === 'workflow' ? task.workflowName : task.subagentType;
}

export function elapsedMs(task: TaskView, now: number): number {
  if (isLive(task)) return Math.max(0, now - task.startedAt);
  return task.durationMs ?? Math.max(0, (task.endedAt ?? task.startedAt) - task.startedAt);
}

/**
 * Builds the task hierarchy. Parents come from `parentId`; a parentless agent that started while exactly one
 * workflow was running belongs to that workflow. Unknown or cyclic parents leave the task at the root.
 */
export function buildTaskTree(source: TaskMap | TaskView[] | undefined): TaskNode[] {
  const shown = taskList(source).filter(isShown).sort(newestFirst).slice(0, MAX_RENDERED_TASKS);
  const parents = resolveParents(shown);
  const nodes = new Map(shown.map(task => [task.id, { task, children: [] as TaskNode[] }]));
  const roots: TaskNode[] = [];
  for (const task of shown) {
    const parent = parents.get(task.id);
    (parent ? nodes.get(parent)!.children : roots).push(nodes.get(task.id)!);
  }
  return roots;
}

function resolveParents(tasks: TaskView[]): Map<string, string | undefined> {
  const known = new Set(tasks.map(task => task.id));
  const workflows = tasks.filter(task => task.kind === 'workflow');
  const parents = new Map(tasks.map(task => [task.id, parentOf(task, known, workflows)]));
  breakCycles(parents);
  return parents;
}

function parentOf(task: TaskView, known: Set<string>, workflows: TaskView[]): string | undefined {
  if (task.parentId) return task.parentId !== task.id && known.has(task.parentId) ? task.parentId : undefined;
  return task.kind === 'agent' ? soleRunningWorkflow(task, workflows)?.id : undefined;
}

function soleRunningWorkflow(task: TaskView, workflows: TaskView[]): TaskView | undefined {
  const candidates = workflows.filter(workflow => workflow.startedAt <= task.startedAt && task.startedAt <= (workflow.endedAt ?? Infinity));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function breakCycles(parents: Map<string, string | undefined>) {
  for (const start of parents.keys()) {
    const seen = new Set<string>();
    for (let current: string | undefined = start; current; current = parents.get(current)) {
      if (seen.has(current)) { parents.set(current, undefined); break; }
      seen.add(current);
    }
  }
}

/** Depth-first rows with box-drawing prefixes (`├─`, `└─`, `│`) for the tree view. */
export function flattenTree(nodes: TaskNode[]): TaskRow[] {
  const rows: TaskRow[] = [];
  appendRows(nodes, '', 0, rows);
  return rows;
}

function appendRows(nodes: TaskNode[], trunk: string, depth: number, rows: TaskRow[]) {
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1;
    rows.push({ task: node.task, depth, prefix: depth === 0 ? '' : trunk + (last ? '└─ ' : '├─ ') });
    appendRows(node.children, depth === 0 ? '' : trunk + (last ? '   ' : '│  '), depth + 1, rows);
  });
}

const isRecent = (task: TaskView, now: number) => isLive(task) || (task.endedAt !== undefined && now - task.endedAt <= RECENT_MS);

/** Keeps running or just-finished tasks, plus the ancestors that give them context. */
function pruneInactive(nodes: TaskNode[], now: number): TaskNode[] {
  return nodes.flatMap(node => {
    const children = pruneInactive(node.children, now);
    return isRecent(node.task, now) || children.length ? [{ task: node.task, children }] : [];
  });
}

export interface StripRows { rows: TaskRow[]; more: number }

/** Rows for the live strip above the composer, capped at `STRIP_MAX_ROWS`, running tasks first. */
export function stripRows(source: TaskMap | undefined, now: number): StripRows {
  const roots = pruneInactive(buildTaskTree(source), now);
  const runningFirst = [...roots].sort((left, right) => Number(subtreeLive(right)) - Number(subtreeLive(left)));
  const all = flattenTree(runningFirst);
  return { rows: all.slice(0, STRIP_MAX_ROWS), more: Math.max(0, all.length - STRIP_MAX_ROWS) };
}

const subtreeLive = (node: TaskNode): boolean => isLive(node.task) || node.children.some(subtreeLive);

/** When the strip next needs to re-evaluate because a finished task ages out; `undefined` when none will. */
export function nextExpiry(source: TaskMap | undefined, now: number): number | undefined {
  const expiries = taskList(source).filter(task => isShown(task) && !isLive(task) && task.endedAt !== undefined)
    .map(task => task.endedAt! + RECENT_MS).filter(expiry => expiry > now);
  return expiries.length ? Math.min(...expiries) : undefined;
}

export interface TaskChip { text: string; running: number }

/** "◉ 3 agents · ⛓ 1 workflow" for the status bar; `undefined` while nothing runs. */
export function taskChip(source: TaskMap | undefined): TaskChip | undefined {
  const live = taskList(source).filter(task => isShown(task) && isLive(task));
  if (!live.length) return undefined;
  const parts = (Object.keys(KIND_NOUNS) as TaskKind[]).flatMap(kind => {
    const count = live.filter(task => (KIND_NOUNS[task.kind] ? task.kind : 'other') === kind).length;
    return count ? [`${kindGlyph(kind)} ${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`] : [];
  });
  return { text: parts.join(' · '), running: live.length };
}

/** The first `maxLines` non-empty lines of `text`, each cut to `width`, with a final line counting what was left out. */
export function leadingLines(text: string | undefined, maxLines: number, width: number): string[] {
  const lines = (text ?? '').split('\n').map(line => line.trimEnd()).filter(line => line.trim());
  const shown = lines.slice(0, maxLines).map(line => truncate(line, width));
  return lines.length > maxLines ? [...shown, `… ${lines.length - maxLines} more lines`] : shown;
}

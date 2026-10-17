import { elapsedMs, isLive, isShown, type TaskMap, type TaskStatus, type TaskView } from './tasks-model';

// Structural mirrors of the controller's agent stream and route state; the UI never imports controller types.
/** The model the gateway actually used for an agent (`state.agentRoutes`), with the reason when it fell back. */
export interface AgentRoute { requested: string; actual: string; provider: string; reason?: string; cooldownUntil?: number }
export type AgentRouteMap = Record<string, AgentRoute>;
export type RelayStatus = 'queued' | 'sent' | 'delivered' | 'failed';
export interface RelayView { status: RelayStatus; text: string; detail?: string; at: number }
export interface AgentStreamView { id: string; revision: number; entries: number; lastAction?: string; relay?: RelayView }
export type AgentStreamMap = Record<string, AgentStreamView>;
/** What the session knows about one agent; each part may be missing (no task after a resume, no route yet). */
export interface AgentSources { task?: TaskView; stream?: AgentStreamView; route?: AgentRoute }

/** The view id of the main conversation; every other view id is a sub-agent id (its task id). */
export const MAIN_VIEW = 'main';
const LABEL_LIMIT = 18;

export interface AgentTab { id: string; label: string; status?: TaskStatus }

/** The agent's type, or its task title when it has none. */
export function agentName(id: string, task: TaskView | undefined): string {
  return task?.subagentType || task?.title || id;
}

/**
 * Tabs of the agent strip: main first, then every sub-agent with a task or a captured stream, oldest first so
 * a tab keeps its position while others start. Housekeeping tasks never get a tab.
 */
export function agentTabs(tasks: TaskMap | undefined, streams: AgentStreamMap | undefined): AgentTab[] {
  const agentTasks = Object.values(tasks ?? {}).filter(task => task.kind === 'agent' && isShown(task));
  const known = new Set(Object.values(tasks ?? {}).map(task => task.id));
  const orphans = Object.keys(streams ?? {}).filter(id => !known.has(id));
  const agents = [...agentTasks.sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)).map(task => task.id), ...orphans];
  return [{ id: MAIN_VIEW, label: 'main' }, ...agents.map(id => tabOf(id, tasks?.[id]))];
}

function tabOf(id: string, task: TaskView | undefined): AgentTab {
  const name = agentName(id, task);
  return { id, label: name.length > LABEL_LIMIT ? name.slice(0, LABEL_LIMIT - 1) + '…' : name, ...(task ? { status: task.status } : {}) };
}

/** The view `delta` tabs away from `current`, wrapping around; main when `current` has no tab any more. */
export function cycleView(current: string, tabs: AgentTab[], delta: number): string {
  const index = tabs.findIndex(tab => tab.id === current);
  if (index < 0) return MAIN_VIEW;
  return tabs[(index + delta + tabs.length) % tabs.length].id;
}

/** Navigation history of the agent views: `open` remembers where the user came from, `back` returns there. */
export class ViewHistory {
  private readonly previous: string[] = [];
  constructor(private current = MAIN_VIEW) {}

  get view() { return this.current; }

  open(view: string) {
    if (view === this.current) return;
    this.previous.push(this.current);
    this.current = view;
  }

  back() {
    this.current = this.previous.pop() ?? MAIN_VIEW;
  }

  /** Drops views that no longer exist, for example after the conversation was reset. */
  retain(exists: (view: string) => boolean) {
    const kept = this.previous.filter(view => view === MAIN_VIEW || exists(view));
    this.previous.splice(0, this.previous.length, ...kept);
    if (this.current !== MAIN_VIEW && !exists(this.current)) this.back();
  }
}

/** The gateway answered with another model than the one Claude Code requested. */
export function isRerouted(route: AgentRoute | undefined): boolean {
  return Boolean(route && route.actual !== route.requested);
}

/** "gpt-6-sol · chatgpt", with the fallback reason when the gateway answered with another model. */
export function routeLabel(route: AgentRoute | undefined, provider: (id: string) => string = id => id): string | undefined {
  if (!route) return undefined;
  const actual = route.actual + ' · ' + provider(route.provider);
  if (!isRerouted(route)) return actual;
  return actual + ' ↪ ' + route.requested + (route.reason ? ' ' + route.reason.replace(/_/g, ' ') : '');
}

export interface AgentSummary {
  title: string;
  type?: string;
  status: TaskStatus;
  elapsedMs?: number;
  tokens?: number;
  route?: string;
  hint?: string;
}

/**
 * The one main-transcript row of an agent launch. Without a task (a resumed session) the launch tool entry's
 * own status and input describe it.
 */
export function agentSummary(launch: { status?: string; input?: Record<string, unknown> }, { task, stream, route }: AgentSources,
  now: number, provider?: (id: string) => string): AgentSummary {
  const input = launch.input ?? {};
  const status: TaskStatus = task?.status ?? (launch.status === 'error' ? 'failed' : launch.status === 'running' ? 'running' : 'completed');
  const live = task ? isLive(task) : status === 'running';
  return {
    title: task?.title ?? stringField(input.description) ?? 'Agent',
    type: task?.subagentType ?? stringField(input.subagent_type),
    status,
    elapsedMs: task ? elapsedMs(task, now) : undefined,
    tokens: task?.totalTokens,
    route: routeLabel(route, provider),
    hint: live ? task?.summary ?? stream?.lastAction ?? task?.lastTool : task?.summary,
  };
}

const stringField = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

export interface Addressee {
  /** "→ Explore": who the composer sends to. */
  label: string;
  canSend: boolean;
  /** How the message travels, or why it cannot. */
  note: string;
}

export const RELAY_NOTES = {
  unavailable: 'This Claude Code session has no SendMessage tool, so sub-agents cannot receive messages.',
  foreground: 'Relayed by the main agent with SendMessage once it is free; ctrl+b moves this agent to the background.',
  running: 'Relayed by the main agent with SendMessage; the agent reads it at its next tool round.',
  finished: 'Relayed by the main agent with SendMessage; Claude Code resumes the finished agent with it.',
  stopped: 'Stopped: Claude Code refuses messages to agents you stopped; one the main agent stopped may still resume.',
  unknown: 'Relayed by the main agent with SendMessage; Claude Code decides whether this agent is still reachable.',
} as const;

/** Who an agent view's composer addresses and whether the engine can deliver a message there. */
export function addresseeOf(id: string, task: TaskView | undefined, messaging: boolean | undefined): Addressee {
  const label = '→ ' + agentName(id, task);
  if (messaging === false) return { label, canSend: false, note: RELAY_NOTES.unavailable };
  if (!task) return { label, canSend: true, note: RELAY_NOTES.unknown };
  if (task.status === 'stopped') return { label, canSend: true, note: RELAY_NOTES.stopped };
  if (!isLive(task)) return { label, canSend: true, note: RELAY_NOTES.finished };
  return { label, canSend: true, note: task.background === false ? RELAY_NOTES.foreground : RELAY_NOTES.running };
}

const RELAY_LABELS: Record<RelayStatus, string> = {
  queued: 'Waiting for the main agent to relay your message',
  sent: 'Main agent is sending your message',
  delivered: 'Delivered',
  failed: 'Not delivered',
};

/** The state of the latest message to an agent, with the engine's own wording when it gave one. */
export function relayLine(relay: RelayView | undefined): string | undefined {
  if (!relay) return undefined;
  return RELAY_LABELS[relay.status] + (relay.detail ? ': ' + relay.detail : '');
}

import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core';
import { useClock } from './clock';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { SEGMENT_GAP, fitSegments, textWidth, truncate, type Fittable } from './layout';
import { Spinner, formatDuration, formatTokens } from './status';
import {
  buildTaskTree, elapsedMs, flattenTree, isLive, kindGlyph, leadingLines, nextExpiry, statusGlyph, stripRows, taskType,
  type StripRows, type TaskMap, type TaskRow, type TaskStatus, type TaskView,
} from './tasks-model';
import { useTheme, type Theme } from './theme';
import { Transcript, type TranscriptEntry } from './transcript';

const MIN_TITLE_WIDTH = 10;
const EXPIRY_SLACK_MS = 50;
const COMPACT_WIDTH = 44;
const PROMPT_LINES = 6;
const SUMMARY_LINES = 8;
/** Rows of the list dialog taken by the summary line, the scroll indicator and the footer spacing. */
const LIST_CHROME_ROWS = 4;
const TRANSCRIPT_CHROME_ROWS = 2;

type ToneName = 'muted' | 'text' | 'secondary';
type LinePartId = 'type' | 'elapsed' | 'tokens' | 'tool';
interface LinePart extends Fittable { id: LinePartId; text: string; tone: ToneName }

function linePartsOf(task: TaskView, now: number): LinePart[] {
  const part = (id: LinePartId, text: string, priority: number, tone: ToneName): LinePart => ({ id, text, priority, tone, width: textWidth(text) });
  const type = taskType(task);
  return [
    ...(type ? [part('type', type, 3, 'secondary')] : []),
    part('elapsed', formatDuration(elapsedMs(task, now)), 1, 'muted'),
    ...(task.totalTokens ? [part('tokens', formatTokens(task.totalTokens) + ' tok', 2, 'muted')] : []),
    ...(task.lastTool && isLive(task) ? [part('tool', task.lastTool, 4, 'muted')] : []),
  ];
}

export function statusColor(theme: Theme, status: TaskStatus) {
  if (status === 'completed') return theme.success;
  if (status === 'failed') return theme.error;
  if (status === 'stopped' || status === 'paused') return theme.warning;
  return status === 'running' ? theme.accent : theme.muted;
}

export function TaskIcon(props: { status: TaskStatus; selected?: boolean }) {
  const theme = useTheme();
  const color = () => props.selected ? theme().selectionText : statusColor(theme(), props.status);
  return (
    <Show when={props.status === 'running'} fallback={<text fg={color()} wrapMode="none">{statusGlyph(props.status)}</text>}>
      <Spinner color={color()} />
    </Show>
  );
}

interface TaskLineProps { row: TaskRow; now: number; width: number; selected?: boolean }

/** One task on one terminal row: tree prefix, status, kind, title, then whatever metadata fits. */
function TaskLine(props: TaskLineProps) {
  const theme = useTheme();
  const task = () => props.row.task;
  const fixedWidth = () => textWidth(props.row.prefix) + 4;
  const parts = createMemo(() => fitSegments(linePartsOf(task(), props.now), props.width - fixedWidth() - MIN_TITLE_WIDTH - SEGMENT_GAP));
  const titleWidth = () => Math.max(1, props.width - fixedWidth() - parts().reduce((sum, part) => sum + part.width + SEGMENT_GAP, 0));
  const color = (tone: ToneName) => props.selected ? theme().selectionText : theme()[tone];
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={props.selected ? theme().selection : undefined}>
      <text fg={color('muted')} wrapMode="none">{props.row.prefix}</text>
      <TaskIcon status={task().status} selected={props.selected} />
      <text fg={color('text')} wrapMode="none" attributes={props.selected ? TextAttributes.BOLD : undefined}>
        {' ' + kindGlyph(task().kind) + ' ' + truncate(task().title, titleWidth())}
        <For each={parts()}>{part => <span style={{ fg: color(part.tone) }}>{' '.repeat(SEGMENT_GAP) + part.text}</span>}</For>
      </text>
    </box>
  );
}

function stripWidth(terminalWidth: number) {
  return terminalWidth - 2 * (terminalWidth < COMPACT_WIDTH ? 1 : 2);
}

function StripBody(props: { view: StripRows }) {
  const theme = useTheme();
  const now = useClock();
  const dimensions = useTerminalDimensions();
  return (
    <box flexShrink={0} marginTop={1}>
      <For each={props.view.rows}>{row => <TaskLine row={row} now={now()} width={stripWidth(dimensions().width)} />}</For>
      <Show when={props.view.more}><text fg={theme().muted} wrapMode="none">{'+' + props.view.more + ' more · ctrl+t'}</text></Show>
    </box>
  );
}

/** Live view of running and just-finished tasks above the composer; renders nothing when there are none. */
export function TasksStrip(props: { tasks?: TaskMap }) {
  const [revision, bumpRevision] = createSignal(0);
  const view = createMemo(() => { revision(); return stripRows(props.tasks, Date.now()); });
  createEffect(() => {
    revision();
    const expiry = nextExpiry(props.tasks, Date.now());
    if (expiry === undefined) return;
    const timer = setTimeout(() => bumpRevision(value => value + 1), expiry - Date.now() + EXPIRY_SLACK_MS);
    onCleanup(() => clearTimeout(timer));
  });
  return <Show when={view().rows.length}><StripBody view={view()} /></Show>;
}

export interface TasksPanelProps {
  tasks: TaskMap;
  thinking: boolean;
  details: boolean;
  stopTask?(id: string): void | Promise<void>;
  agentTranscript?(id: string): TranscriptEntry[] | Promise<TranscriptEntry[]>;
  /** Switches the session to the agent's own view; the panel closes. */
  onOpenAgent?(id: string): void;
  onClose(): void;
}

type PanelView = 'list' | 'detail' | 'transcript';

const LIST_HINTS: KeyHint[] = [['↑↓', 'select'], ['enter', 'details'], ['o', 'open view'], ['x', 'stop'], ['esc', 'close']];
const DETAIL_HINTS: KeyHint[] = [['t', 'transcript'], ['o', 'open view'], ['x', 'stop'], ['esc', 'back']];
const TRANSCRIPT_HINTS: KeyHint[] = [['↑↓', 'scroll'], ['esc', 'back']];

/** Tree of agents and workflows with a detail view, agent transcripts and stop; opened with ctrl+t or /tasks. */
export function TasksPanel(props: TasksPanelProps) {
  const theme = useTheme();
  const now = useClock();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth('large');
  const rows = createMemo(() => flattenTree(buildTaskTree(props.tasks)));
  const [selectedId, setSelectedId] = createSignal<string>();
  const [view, setView] = createSignal<PanelView>('list');
  const [stopTarget, setStopTarget] = createSignal<TaskView>();
  const [error, setError] = createSignal('');
  const selectedIndex = createMemo(() => Math.max(0, rows().findIndex(row => row.task.id === selectedId())));
  const selected = () => rows()[selectedIndex()]?.task;
  const listHeight = () => Math.max(1, Math.min(rows().length, bodyLimit() - LIST_CHROME_ROWS));
  const windowStart = createMemo<number>(previous => {
    const height = listHeight();
    const anchored = selectedIndex() < previous ? selectedIndex() : selectedIndex() >= previous + height ? selectedIndex() - height + 1 : previous;
    return Math.max(0, Math.min(anchored, rows().length - height));
  }, 0);
  const windowRows = () => rows().slice(windowStart(), windowStart() + listHeight());
  const liveCount = () => rows().filter(row => isLive(row.task)).length;
  const canTranscript = () => selected()?.kind === 'agent' && Boolean(props.agentTranscript);
  let transcriptScroll: ScrollBoxRenderable | undefined;

  const move = (delta: number) => {
    const target = rows()[Math.max(0, Math.min(rows().length - 1, selectedIndex() + delta))];
    if (target) setSelectedId(target.task.id);
  };
  const open = (id: string) => { setSelectedId(id); setView('detail'); };
  const askToStop = () => {
    const task = selected();
    if (!task) return;
    if (!isLive(task) || !props.stopTask) { setError('Only running tasks can be stopped.'); return; }
    setError('');
    setStopTarget(task);
  };
  const confirmStop = async () => {
    const task = stopTarget();
    setStopTarget(undefined);
    try { await props.stopTask?.(task!.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Stopping the task failed.'); }
  };
  const showTranscript = () => { if (canTranscript()) setView('transcript'); };
  const openAgentView = () => {
    const task = selected();
    if (task?.kind === 'agent' && props.onOpenAgent) props.onOpenAgent(task.id);
    else setError('Only agents have a view of their own.');
  };

  function handleConfirmKey(event: KeyEvent) {
    event.preventDefault();
    if (event.name === 'return' || event.name === 'y') void confirmStop();
    else if (event.name === 'escape' || event.name === 'n') setStopTarget(undefined);
  }
  function handleListKey(event: KeyEvent) {
    const page = listHeight();
    const actions: Record<string, () => void> = {
      up: () => move(-1), down: () => move(1), pageup: () => move(-page), pagedown: () => move(page),
      home: () => move(-rows().length), end: () => move(rows().length),
      return: () => { const task = selected(); if (task) open(task.id); }, x: askToStop, o: openAgentView, escape: props.onClose,
    };
    return runKeyAction(event, actions);
  }
  function handleDetailKey(event: KeyEvent) {
    return runKeyAction(event, { escape: () => setView('list'), t: showTranscript, return: showTranscript, o: openAgentView, x: askToStop });
  }
  function handleTranscriptKey(event: KeyEvent) {
    const page = Math.max(1, bodyLimit() - TRANSCRIPT_CHROME_ROWS);
    return runKeyAction(event, { escape: () => setView('detail'), up: () => transcriptScroll?.scrollBy(-1), down: () => transcriptScroll?.scrollBy(1),
      pageup: () => transcriptScroll?.scrollBy(-page), pagedown: () => transcriptScroll?.scrollBy(page) });
  }
  useKeyboard(event => {
    if (stopTarget()) { handleConfirmKey(event); return; }
    if (event.ctrl && event.name === 't') { event.preventDefault(); props.onClose(); return; }
    if (event.ctrl || event.meta) return;
    if (view() === 'list') handleListKey(event);
    else if (view() === 'detail') handleDetailKey(event);
    else handleTranscriptKey(event);
  });

  const title = () => view() === 'list' ? 'Agents & Workflows' : truncate(selected()?.title ?? 'Task', contentWidth() - 8);
  const footer = () => (
    <Show when={!stopTarget()} fallback={
      <text fg={theme().warning} wrapMode="none">{truncate('Stop "' + stopTarget()!.title + '"?  enter confirm · esc cancel', contentWidth())}</text>
    }>
      <KeyHints hints={view() === 'list' ? LIST_HINTS : view() === 'detail' ? (canTranscript() ? DETAIL_HINTS : DETAIL_HINTS.slice(1)) : TRANSCRIPT_HINTS} />
    </Show>
  );
  return (
    <Dialog title={title()} size="large" footer={footer()} onBackdrop={props.onClose}>
      <Show when={view() === 'list'}>
        <Show when={rows().length} fallback={<EmptyState />}>
          <text fg={theme().muted} marginTop={1} wrapMode="none">{liveCount() + ' running · ' + (rows().length - liveCount()) + ' finished'}</text>
          <box marginTop={1} flexShrink={0}>
            <For each={windowRows()}>{row => (
              <box onMouseMove={() => setSelectedId(row.task.id)} onMouseUp={() => open(row.task.id)}>
                <TaskLine row={row} now={now()} width={contentWidth()} selected={row.task.id === selected()?.id} />
              </box>
            )}</For>
          </box>
          <Show when={rows().length > listHeight()}>
            <text fg={theme().muted} wrapMode="none">{(windowStart() + 1) + '–' + (windowStart() + listHeight()) + ' of ' + rows().length}</text>
          </Show>
        </Show>
      </Show>
      <Show when={view() === 'detail' && selected()} keyed>{task => <TaskDetail task={task} now={now()} width={contentWidth()} />}</Show>
      <Show when={view() === 'transcript' && selected()} keyed>{task => (
        <AgentTranscript task={task} load={props.agentTranscript} height={bodyLimit() - TRANSCRIPT_CHROME_ROWS}
          thinking={props.thinking} details={props.details} onScroll={scroll => { transcriptScroll = scroll; }} />
      )}</Show>
      <Show when={error()}><text fg={theme().error} marginTop={1}>{error()}</text></Show>
    </Dialog>
  );
}

function runKeyAction(event: KeyEvent, actions: Record<string, () => void>) {
  const action = actions[event.name];
  if (!action) return;
  event.preventDefault();
  action();
}

function EmptyState() {
  const theme = useTheme();
  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={theme().text}>No agents or workflows in this session yet.</text>
      <text fg={theme().muted}>Sub-agents and workflows that Claude starts appear here while they run.</text>
    </box>
  );
}

function Field(props: { label: string; value: string | undefined; color?: string }) {
  const theme = useTheme();
  return (
    <Show when={props.value}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme().muted} width={11} wrapMode="none">{props.label}</text>
        <text fg={props.color ?? theme().text} wrapMode="none">{props.value}</text>
      </box>
    </Show>
  );
}

function Section(props: { label: string; lines: string[]; color?: string }) {
  const theme = useTheme();
  return (
    <Show when={props.lines.length}>
      <box marginTop={1} flexShrink={0}>
        <text fg={theme().muted}>{props.label}</text>
        <For each={props.lines}>{line => <text fg={props.color ?? theme().text} wrapMode="none">{line}</text>}</For>
      </box>
    </Show>
  );
}

function TaskDetail(props: { task: TaskView; now: number; width: number }): JSX.Element {
  const theme = useTheme();
  const task = () => props.task;
  const kind = () => task().kind + (taskType(task()) ? ' · ' + taskType(task()) : '') + (task().background ? ' · background' : '');
  const started = () => new Date(task().startedAt).toLocaleTimeString();
  return (
    <box marginTop={1} flexShrink={0}>
      <Field label="Status" value={task().status} color={statusColor(theme(), task().status)} />
      <Field label="Kind" value={kind()} />
      <Field label="Started" value={started()} />
      <Field label="Duration" value={formatDuration(elapsedMs(task(), props.now))} />
      <Field label="Tokens" value={task().totalTokens ? formatTokens(task().totalTokens!) : undefined} />
      <Field label="Tool uses" value={task().toolUses !== undefined ? String(task().toolUses) : undefined} />
      <Field label="Last tool" value={task().lastTool} />
      <Section label="Prompt" lines={leadingLines(task().prompt, PROMPT_LINES, props.width)} />
      <Section label="Summary" lines={leadingLines(task().summary, SUMMARY_LINES, props.width)} />
      <Section label="Error" lines={leadingLines(task().error, SUMMARY_LINES, props.width)} color={theme().error} />
    </box>
  );
}

interface AgentTranscriptProps {
  task: TaskView;
  load?: TasksPanelProps['agentTranscript'];
  height: number;
  thinking: boolean;
  details: boolean;
  onScroll(scroll: ScrollBoxRenderable | undefined): void;
}

interface LoadedTranscript { entries: TranscriptEntry[]; failure?: string }

/** The agent's own conversation, reloaded as the task makes progress. */
function AgentTranscript(props: AgentTranscriptProps) {
  const theme = useTheme();
  const progress = () => [props.task.id, props.task.status, props.task.toolUses, props.task.totalTokens].join(':');
  const [loaded] = createResource(progress, async (): Promise<LoadedTranscript> => {
    try { return { entries: (await props.load?.(props.task.id)) ?? [] }; }
    catch (cause) { return { entries: [], failure: cause instanceof Error ? cause.message : 'Transcript failed to load.' }; }
  });
  const entries = () => loaded.latest?.entries ?? [];
  return (
    <box marginTop={1} flexShrink={0}>
      <Show when={entries().length} fallback={
        <text fg={loaded.latest?.failure ? theme().error : theme().muted}>{loaded.latest?.failure ?? (loaded.loading ? 'Loading…' : 'No transcript is available for this task.')}</text>
      }>
        <scrollbox ref={props.onScroll} height={Math.max(3, props.height)} stickyScroll stickyStart="bottom">
          <Transcript entries={entries()} busy={isLive(props.task)} thinking={props.thinking} details={props.details} />
        </scrollbox>
      </Show>
    </box>
  );
}

import { For, Show, createMemo, createResource, type JSX } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { useClock } from './clock';
import { SEGMENT_GAP, fitSegments, textWidth, truncate, type Fittable } from './layout';
import { formatDuration, formatTokens } from './status';
import { kindGlyph, isLive, statusGlyph } from './tasks-model';
import { TaskIcon, statusColor } from './tasks';
import { providerLabel, useTheme } from './theme';
import { Transcript, type TranscriptEntry } from './transcript';
import { useAgentEntries } from './bridge';
import {
  MAIN_VIEW, agentName, agentSummary, isRerouted, relayLine, routeLabel,
  type Addressee, type AgentSources, type AgentTab, type RelayStatus,
} from './agent-model';

const MIN_TITLE_WIDTH = 12;
/** Columns taken by the session padding around the transcript. */
const ROW_CHROME = 6;
const TAB_SEPARATOR = ' · ';
const SWITCH_HINT = 'alt+←→ switch · esc back';
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const RELAY_TONES: Record<RelayStatus, 'muted' | 'accent' | 'success' | 'error'> = { queued: 'muted', sent: 'accent', delivered: 'success', failed: 'error' };

type Tone = 'muted' | 'text' | 'secondary' | 'warning';
interface Segment extends Fittable { text: string; tone: Tone }

const segment = (text: string, priority: number, tone: Tone): Segment => ({ text, priority, tone, width: textWidth(text) });

/** Persistent breadcrumb "main · ● Explore · ✗ general-purpose": the current view is highlighted, a click opens a view. */
export function AgentTabs(props: { tabs: AgentTab[]; current: string; onSelect(id: string): void }) {
  const theme = useTheme();
  return (
    <Show when={props.tabs.length > 1}>
      <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
        <box flexDirection="row" flexShrink={1} overflow="hidden">
          <For each={props.tabs}>{(tab, index) => {
            const current = () => tab.id === props.current;
            return (
              <box flexDirection="row" flexShrink={0} onMouseUp={() => props.onSelect(tab.id)}>
                <Show when={index() > 0}><text fg={theme().muted} wrapMode="none">{TAB_SEPARATOR}</text></Show>
                <Show when={tab.status}>{status =>
                  <text fg={current() ? theme().selectionText : statusColor(theme(), status())} bg={current() ? theme().selection : undefined} wrapMode="none">{statusGlyph(status()) + ' '}</text>
                }</Show>
                <text fg={current() ? theme().selectionText : tab.id === MAIN_VIEW ? theme().text : theme().secondary}
                  bg={current() ? theme().selection : undefined} attributes={current() ? TextAttributes.BOLD : undefined} wrapMode="none">{tab.label}</text>
              </box>
            );
          }}</For>
        </box>
        <text fg={theme().muted} wrapMode="none" flexShrink={0}>{SWITCH_HINT}</text>
      </box>
    </Show>
  );
}

export interface AgentRowProps {
  entry: TranscriptEntry;
  sources: AgentSources;
  onOpen?(agentId: string): void;
}

/**
 * The single main-transcript row of a sub-agent launch: status, name and type, the model and provider the
 * gateway actually used, elapsed time, tokens and what it is doing. The agent's own stream lives in its view.
 */
export function AgentSummaryRow(props: AgentRowProps) {
  const theme = useTheme();
  const now = useClock();
  const dimensions = useTerminalDimensions();
  const summary = createMemo(() => agentSummary(props.entry, props.sources, now(), providerLabel));
  const width = () => Math.max(MIN_TITLE_WIDTH, dimensions().width - ROW_CHROME);
  const segments = createMemo(() => {
    const value = summary();
    const all = [
      ...(value.type ? [segment(value.type, 5, 'secondary')] : []),
      ...(value.route ? [segment(value.route, 4, isRerouted(props.sources.route) ? 'warning' : 'muted')] : []),
      ...(value.elapsedMs !== undefined ? [segment(formatDuration(value.elapsedMs), 1, 'muted')] : []),
      ...(value.tokens ? [segment(formatTokens(value.tokens) + ' tok', 2, 'muted')] : []),
      ...(value.hint ? [segment(value.hint, 6, 'muted')] : []),
    ];
    return fitSegments(all, width() - 4 - MIN_TITLE_WIDTH - SEGMENT_GAP);
  });
  const titleWidth = () => Math.max(1, width() - 4 - segments().reduce((sum, part) => sum + part.width + SEGMENT_GAP, 0));
  const open = () => { const id = props.entry.taskId; if (id) props.onOpen?.(id); };
  return (
    <box flexDirection="row" height={1} flexShrink={0} paddingLeft={3} onMouseUp={open}>
      <TaskIcon status={summary().status} />
      <text fg={theme().text} wrapMode="none">
        {' ' + kindGlyph('agent') + ' '}
        <span style={{ fg: theme().text, bold: true }}>{truncate(summary().title, titleWidth())}</span>
        <For each={segments()}>{part => <span style={{ fg: theme()[part.tone] }}>{' '.repeat(SEGMENT_GAP) + part.text}</span>}</For>
      </text>
    </box>
  );
}

/** The `taskCall` transcript slot: agent launches render as one summary row, workflows keep their default card. */
export function agentLaunchRow(entry: TranscriptEntry, sourcesOf: (agentId: string) => AgentSources,
  onOpen: (agentId: string) => void): JSX.Element | undefined {
  const sources = entry.taskId ? sourcesOf(entry.taskId) : {};
  const isAgent = sources.task ? sources.task.kind === 'agent' : AGENT_TOOLS.has(entry.toolName ?? '');
  if (!isAgent) return undefined;
  return <AgentSummaryRow entry={entry} sources={sources} onOpen={onOpen} />;
}

/** Above an agent view's composer: how a message reaches this agent, or why it cannot. */
export function AddresseeNote(props: { addressee: Addressee }) {
  const theme = useTheme();
  return (
    <text fg={props.addressee.canSend ? theme().muted : theme().warning} paddingBottom={1} flexShrink={0}>
      <span style={{ fg: theme().secondary, bold: true }}>{props.addressee.label + '  '}</span>{props.addressee.note}
    </text>
  );
}

export interface AgentViewSource {
  agentEntries?(agentId: string): TranscriptEntry[];
  agentTranscript?(agentId: string): TranscriptEntry[] | Promise<TranscriptEntry[]>;
}

export interface AgentViewProps {
  agentId: string;
  sources: AgentSources;
  source: AgentViewSource;
  thinking: boolean;
  details: boolean;
}

/**
 * One sub-agent's own conversation: header with status, routed model and relay state, then its full transcript.
 * The live capture is shown; the saved transcript on disk is the fallback, for example after a resume.
 */
export function AgentView(props: AgentViewProps) {
  const theme = useTheme();
  const now = useClock();
  const task = () => props.sources.task;
  const live = useAgentEntries(id => props.source.agentEntries?.(id) ?? [], () => props.agentId, () => props.sources.stream?.revision);
  const running = () => Boolean(task() && isLive(task()!));
  const [saved] = createResource(() => !live().length && props.source.agentTranscript ? props.agentId + ':' + (task()?.status ?? '') : undefined,
    async () => (await props.source.agentTranscript?.(props.agentId)) ?? []);
  const entries = () => live().length ? live() : saved.latest ?? [];
  const empty = () => saved.loading ? 'Loading…' : running() ? 'Waiting for the agent’s first output…' : 'No transcript was captured for this agent.';
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <box flexShrink={0} paddingLeft={3} paddingBottom={1}>
        <box flexDirection="row" gap={2} height={1}>
          <Show when={task()} fallback={<text fg={theme().muted} wrapMode="none">{'◉ ' + props.agentId}</text>}>{known => <>
            <TaskIcon status={known().status} />
            <text fg={theme().text} attributes={TextAttributes.BOLD} wrapMode="none">{agentName(props.agentId, known()) + (known().subagentType ? ' — ' + known().title : '')}</text>
            <text fg={statusColor(theme(), known().status)} wrapMode="none">{known().status}</text>
            <text fg={theme().muted} wrapMode="none">{formatDuration(Math.max(0, (known().endedAt ?? now()) - known().startedAt))}</text>
            <Show when={known().totalTokens}><text fg={theme().muted} wrapMode="none">{formatTokens(known().totalTokens!) + ' tok'}</text></Show>
          </>}</Show>
        </box>
        <text fg={isRerouted(props.sources.route) ? theme().warning : theme().muted} wrapMode="none">
          {routeLabel(props.sources.route, providerLabel) ?? 'model: not reported by the gateway yet'}
        </text>
        <Show when={props.sources.stream?.relay}>{relay => <text fg={theme()[RELAY_TONES[relay().status]]}>{relayLine(relay())}</text>}</Show>
        <Show when={task()?.error}><text fg={theme().error}>{task()!.error}</text></Show>
      </box>
      <Show when={entries().length} fallback={<text fg={theme().muted} paddingLeft={3}>{empty()}</text>}>
        <scrollbox stickyScroll stickyStart="bottom" flexGrow={1} minHeight={0}>
          <Transcript entries={entries()} busy={running()} thinking={props.thinking} details={props.details} />
        </scrollbox>
      </Show>
    </box>
  );
}

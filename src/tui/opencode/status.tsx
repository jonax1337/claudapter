import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { KeyHints, type KeyHint } from './dialog';
import { useClock } from './clock';
import { SEGMENT_GAP, fitSegments, textWidth, type Fittable } from './layout';
import { useAnimationFrame } from './motion';
import { taskChip, type TaskMap } from './tasks-model';
import { mix, providerColor, useTheme, type Theme } from './theme';

export { providerColor };

export interface ContextUsage { totalTokens: number; maxTokens: number }
/** `cooldownUntil` (epoch ms) is set while a fallback keeps the conversation on `actual`. */
export interface RouteView { requested: string; actual: string; provider: string; cooldownUntil?: number }
export interface HookView { id: string; name: string; outcome: string }
/** The slice of the provider usage snapshot the status bar reads. */
export interface UsageView {
  providers: { provider: string; state: string; windows: { usedPercent: number | null; resetsAt: string | null }[] }[];
}

const SCANNER_CELLS = 8;
const SCANNER_TRAIL = 4;
const SCANNER_FRAME_MS = 80;
const SCANNER_IDLE_GLOW = 0.15;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_FRAME_MS = 90;
const METER_CELLS = 10;
const COMPACT_METER_CELLS = 5;
const FULL_CELL = '━';
const HALF_CELL = '╸';
const WARNING_RATIO = 0.7;
const DANGER_RATIO = 0.9;
const COMPACT_WIDTH = 44;
const INTERRUPT_HINT_MIN_WIDTH = 80;
const INTERRUPT_HINT_WIDTH = 15;
const SEGMENT_SPACING = 3;
const LEFT_RIGHT_GAP = 2;
const ELAPSED_CELLS = 6;
const USAGE_WARNING_PERCENT = 80;
const USAGE_DANGER_PERCENT = 95;
const USAGE_RESET_HINT_PERCENT = 90;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MODE_LABELS: Record<string, string> = { default: 'default', acceptEdits: 'accept edits', plan: 'plan', bypassPermissions: 'bypass',
  dontAsk: "don't ask", auto: 'auto' };

/** Spinners animating at the same rate share one timer, so many running tools stay cheap and in phase. */
export function Spinner(props: { color: string }) {
  const frame = useAnimationFrame(SPINNER_FRAME_MS);
  return <text fg={props.color} wrapMode="none">{SPINNER_FRAMES[frame() % SPINNER_FRAMES.length]}</text>;
}

/** A light sweeping back and forth across a row of cells while a turn runs. */
export function Scanner() {
  const theme = useTheme();
  const frame = useAnimationFrame(SCANNER_FRAME_MS);
  const head = () => {
    const period = (SCANNER_CELLS - 1) * 2;
    const step = frame() % period;
    return step < SCANNER_CELLS ? step : period - step;
  };
  const glow = (cell: number) => Math.max(SCANNER_IDLE_GLOW, 1 - Math.abs(cell - head()) / SCANNER_TRAIL);
  return (
    <text wrapMode="none">
      <For each={Array.from({ length: SCANNER_CELLS }, (_, cell) => cell)}>
        {cell => <span style={{ fg: mix(theme().background, theme().accent, glow(cell)) }}>■</span>}
      </For>
    </text>
  );
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

export function formatTokens(tokens: number) {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return (tokens / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (tokens / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

type Tone = 'ready' | 'pending' | 'warning' | 'error';

function toneOf(status: string): Tone {
  if (status === 'Ready') return 'ready';
  if (/fail|stopped|declined|closed/i.test(status)) return 'error';
  if (/interrupt/i.test(status)) return 'warning';
  return 'pending';
}

/** Idle connection state: a dot when ready, a spinner while connecting, a mark on failure. */
export function StatusIndicator(props: { status: string }) {
  const theme = useTheme();
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <Switch>
        <Match when={toneOf(props.status) === 'ready'}><text fg={theme().success}>●</text></Match>
        <Match when={toneOf(props.status) === 'error'}><text fg={theme().error}>✗</text></Match>
        <Match when={toneOf(props.status) === 'warning'}><text fg={theme().warning}>■</text></Match>
        <Match when={true}><Spinner color={theme().accent} /></Match>
      </Switch>
      <text fg={toneOf(props.status) === 'error' ? theme().error : theme().muted} wrapMode="none">{props.status}</text>
    </box>
  );
}

/** Mounted once per turn, so the elapsed clock starts when the turn starts. */
function WorkingIndicator(props: { status: string; showInterruptHint: boolean }) {
  const theme = useTheme();
  const now = useClock();
  const startedAt = Date.now();
  const elapsed = () => formatDuration(now() - startedAt);
  return (
    <box flexDirection="row" gap={2} flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <Scanner />
        <text fg={theme().text} wrapMode="none">{props.status}</text>
        <text fg={theme().muted} wrapMode="none">{elapsed()}</text>
      </box>
      <Show when={props.showInterruptHint}><KeyHints hints={[['esc', 'interrupt']]} /></Show>
    </box>
  );
}

/** "50K / 200K 25%" */
export function contextLabel(usage: ContextUsage) {
  return formatTokens(usage.totalTokens) + ' / ' + formatTokens(usage.maxTokens) + ' ' + Math.round(contextRatio(usage) * 100) + '%';
}

const contextRatio = (usage: ContextUsage) => Math.min(1, usage.totalTokens / usage.maxTokens);

/** "50%" — the context segment once the bar is too narrow for token counts. */
export function compactContextLabel(usage: ContextUsage) {
  return Math.round(contextRatio(usage) * 100) + '%';
}

/** Filled and empty parts of a meter `cells` wide, at half-cell resolution so small changes stay visible. */
export function meterCells(ratio: number, cells: number) {
  const halves = Math.round(Math.min(1, Math.max(0, ratio)) * cells * 2);
  const half = halves % 2 === 1 ? HALF_CELL : '';
  const full = Math.floor(halves / 2);
  return { filled: FULL_CELL.repeat(full) + half, empty: FULL_CELL.repeat(cells - full - half.length) };
}

/** Context fill as a bar; the full form adds token counts, the compact form only the percentage. */
export function ContextMeter(props: { usage?: ContextUsage; compact?: boolean }) {
  const theme = useTheme();
  const ratio = () => contextRatio(props.usage!);
  const cells = () => meterCells(ratio(), props.compact ? COMPACT_METER_CELLS : METER_CELLS);
  const color = () => ratio() >= DANGER_RATIO ? theme().error : ratio() >= WARNING_RATIO ? theme().warning : theme().accent;
  return (
    <Show when={props.usage?.maxTokens}>
      <text fg={theme().muted} wrapMode="none">
        <span style={{ fg: color() }}>{cells().filled}</span>
        <span style={{ fg: theme().border }}>{cells().empty}</span>
        <Show when={!props.compact}>{' ' + formatTokens(props.usage!.totalTokens) + ' / ' + formatTokens(props.usage!.maxTokens)}</Show>
        <span style={{ fg: color() }}>{' ' + compactContextLabel(props.usage!)}</span>
      </text>
    </Show>
  );
}

export function modeLabel(mode: string | undefined) {
  return MODE_LABELS[mode ?? 'default'] ?? mode ?? 'default';
}

function modeColor(theme: Theme, mode: string | undefined) {
  if (mode === 'plan') return theme.warning;
  if (mode === 'bypassPermissions') return theme.error;
  if (mode === 'acceptEdits' || mode === 'auto') return theme.success;
  return theme.muted;
}

export interface RouteLabel { text: string; differs: boolean }

/**
 * `requested → actual` when fallback or routing changed the model, otherwise just the model in use;
 * a running fallback cooldown adds when the requested model returns, e.g. `sonnet → gpt-6-astra · back in 4m`.
 */
export function routeLabel(route: RouteView, now = Date.now()): RouteLabel {
  const differs = route.requested !== route.actual;
  const remaining = differs && route.cooldownUntil ? route.cooldownUntil - now : 0;
  const text = differs ? route.requested + ' → ' + route.actual : route.actual;
  return { text: remaining > 0 ? text + ' · back in ' + formatCountdown(remaining) : text, differs };
}

/** Seconds during the last minute so the return is visibly imminent; minutes and hours before. */
export function formatCountdown(milliseconds: number) {
  return milliseconds < MINUTE_MS ? Math.ceil(milliseconds / 1000) + 's' : formatReset(milliseconds);
}

export function formatReset(milliseconds: number) {
  if (milliseconds <= 0) return 'now';
  if (milliseconds < HOUR_MS) return Math.max(1, Math.round(milliseconds / MINUTE_MS)) + 'm';
  if (milliseconds < 2 * DAY_MS) {
    const totalMinutes = Math.round(milliseconds / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? hours + 'h ' + minutes + 'm' : hours + 'h';
  }
  return Math.round(milliseconds / DAY_MS) + 'd';
}

export interface UsageLabel { text: string; tone: 'muted' | 'warning' | 'error' }

/**
 * The most constrained quota window of the routed provider, e.g. `chatgpt 77% left`.
 * `undefined` when the provider reports no usable window, so the bar shows nothing for unknown quotas.
 */
export function usageLabel(usage: UsageView | undefined, provider: string | undefined, now: number): UsageLabel | undefined {
  const available = (usage?.providers ?? []).filter(entry => entry.state === 'available');
  const chosen = provider ? available.find(entry => entry.provider === provider) : available[0];
  const windows = (chosen?.windows ?? []).filter(window => window.usedPercent !== null);
  if (!chosen || !windows.length) return undefined;
  const tightest = windows.reduce((worst, window) => window.usedPercent! > worst.usedPercent! ? window : worst);
  const used = tightest.usedPercent!;
  const left = Math.max(0, Math.round(100 - used));
  const reset = tightest.resetsAt ? formatReset(Date.parse(tightest.resetsAt) - now) : undefined;
  const text = left === 0 ? chosen.provider + ' limit reached' + (reset ? ' · resets in ' + reset : '')
    : chosen.provider + ' ' + left + '% left' + (used >= USAGE_RESET_HINT_PERCENT && reset ? ' · ' + reset : '');
  return { text, tone: used >= USAGE_DANGER_PERCENT ? 'error' : used >= USAGE_WARNING_PERCENT ? 'warning' : 'muted' };
}

export type BarSegmentId = 'tasks' | 'mode' | 'context' | 'route' | 'usage' | 'hooks' | 'hints';
export interface BarSegment extends Fittable { id: BarSegmentId }

/** Lower numbers survive narrower terminals: tasks and mode last longest, shortcut hints go first. */
const PRIORITY: Record<BarSegmentId, number> = { tasks: 1, mode: 2, context: 3, route: 4, usage: 5, hooks: 6, hints: 7 };

const hintsWidth = (hints: KeyHint[]) => hints.reduce((sum, [key, label]) => sum + textWidth(key) + 1 + textWidth(label), 0) + SEGMENT_SPACING * Math.max(0, hints.length - 1);

export interface StatusBarProps {
  busy: boolean;
  status: string;
  context?: ContextUsage;
  hints: KeyHint[];
  route?: RouteView;
  mode?: string;
  usage?: UsageView;
  tasks?: TaskMap;
  hooks?: HookView[];
  /** Overrides the terminal-derived width available to the bar; used by tests. */
  width?: number;
  onTasks?(): void;
  onCycleMode?(): void;
}

const runningHooks = (hooks: HookView[] | undefined) => (hooks ?? []).filter(hook => hook.outcome === 'running').length;

/** The row under the composer: turn progress on the left, then whatever fits of tasks, mode, context, route, quota and shortcuts. */
export function StatusBar(props: StatusBarProps) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const barWidth = () => props.width ?? dimensions().width - 2 * (dimensions().width < COMPACT_WIDTH ? 1 : 2);
  const showInterruptHint = () => barWidth() >= INTERRUPT_HINT_MIN_WIDTH;
  const leftWidth = () => props.busy
    ? SCANNER_CELLS + 1 + textWidth(props.status) + 1 + ELAPSED_CELLS + (showInterruptHint() ? 2 + INTERRUPT_HINT_WIDTH : 0)
    : 2 + textWidth(props.status);
  const chip = createMemo(() => taskChip(props.tasks));
  const usage = createMemo(() => usageLabel(props.usage, props.route?.provider, Date.now()));
  const hooks = createMemo(() => runningHooks(props.hooks));
  const now = useClock();
  const route = createMemo(() => props.route ? routeLabel(props.route, props.route.cooldownUntil ? now() : Date.now()) : undefined);
  const segments = createMemo<BarSegment[]>(() => {
    const candidates: (BarSegment | false | undefined)[] = [
      chip() && { id: 'tasks', width: 2 + textWidth(chip()!.text), priority: PRIORITY.tasks },
      props.mode !== undefined && { id: 'mode', width: textWidth(modeLabel(props.mode)), priority: PRIORITY.mode },
      props.context?.maxTokens ? { id: 'context', width: METER_CELLS + 1 + textWidth(contextLabel(props.context)),
        compactWidth: COMPACT_METER_CELLS + 1 + textWidth(compactContextLabel(props.context)), priority: PRIORITY.context } : undefined,
      route() && { id: 'route', width: textWidth(route()!.text), priority: PRIORITY.route },
      usage() && { id: 'usage', width: textWidth(usage()!.text), priority: PRIORITY.usage },
      hooks() > 0 && { id: 'hooks', width: textWidth(hookText(hooks())), priority: PRIORITY.hooks },
      props.hints.length > 0 && { id: 'hints', width: hintsWidth(props.hints), priority: PRIORITY.hints },
    ];
    return candidates.filter((segment): segment is BarSegment => Boolean(segment));
  });
  const fitted = createMemo(() => fitSegments(segments(), barWidth() - leftWidth() - LEFT_RIGHT_GAP, SEGMENT_SPACING));
  const visible = createMemo(() => fitted().map(segment => segment.id));
  const compactContext = () => fitted().some(segment => segment.id === 'context' && segment.compact);
  return (
    <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0} gap={LEFT_RIGHT_GAP}>
      <Show when={props.busy} fallback={<StatusIndicator status={props.status} />}>
        <WorkingIndicator status={props.status} showInterruptHint={showInterruptHint()} />
      </Show>
      <box flexDirection="row" gap={SEGMENT_SPACING} flexShrink={0}>
        <For each={visible()}>{id => (
          <Switch>
            <Match when={id === 'tasks'}>
              <box flexDirection="row" gap={1} onMouseUp={() => props.onTasks?.()}>
                <Spinner color={theme().accent} />
                <text fg={theme().text} wrapMode="none">{chip()?.text}</text>
              </box>
            </Match>
            <Match when={id === 'mode'}>
              <text fg={modeColor(theme(), props.mode)} wrapMode="none" onMouseUp={() => props.onCycleMode?.()}>{modeLabel(props.mode)}</text>
            </Match>
            <Match when={id === 'context'}><ContextMeter usage={props.context} compact={compactContext()} /></Match>
            <Match when={id === 'route'}>
              <text fg={route()?.differs ? providerColor(theme(), props.route!.provider) : theme().muted} wrapMode="none">{route()?.text}</text>
            </Match>
            <Match when={id === 'usage'}>
              <text fg={usage()?.tone === 'muted' ? theme().muted : theme()[usage()!.tone]} wrapMode="none">{usage()?.text}</text>
            </Match>
            <Match when={id === 'hooks'}><text fg={theme().warning} wrapMode="none">{hookText(hooks())}</text></Match>
            <Match when={id === 'hints'}><KeyHints hints={props.hints} /></Match>
          </Switch>
        )}</For>
      </box>
    </box>
  );
}

const hookText = (count: number) => '⚙ ' + count + (count === 1 ? ' hook' : ' hooks');

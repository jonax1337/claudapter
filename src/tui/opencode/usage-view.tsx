// Graphical provider usage panel; dialog structure adapted from the tasks dialog (OpenCode UI, MIT).
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { TextAttributes, type KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { formatReset, formatTokens, providerColor } from './status';
import { relativeTime } from './sessions-model';
import { useTheme, type Theme } from './theme';

/** The slice of the usage snapshot this panel reads; the UI never imports controller types. */
export interface UsageSnapshotView {
  since: string;
  scope: string;
  attempts: { outcome: string }[];
  totals: {
    provider: string; actualModel: string; reportedModel?: string; session?: string; agent?: string; requestClass?: string;
    attempts: number; completed: number; unknown: number; interrupted: number;
    tokens: { input: number; output: number; cacheRead: number | null; cacheCreate: number | null; reasoning: number | null } | null;
  }[];
  providers: {
    provider: string; state: string; source: string; updatedAt?: string; reason?: string; stale: boolean;
    windows: { id: string; label?: string; usedPercent: number | null; resetsAt: string | null }[];
  }[];
}

type UsageWindow = UsageSnapshotView['providers'][number]['windows'][number];
type UsageTotal = UsageSnapshotView['totals'][number];

const METER_CELLS = 12;
const WARNING_RATIO = 0.8;
const DANGER_RATIO = 0.95;
const HINTS: KeyHint[] = [['↑↓', 'scroll'], ['r', 'refresh'], ['esc', 'close']];

export interface UsagePanelProps {
  snapshot: UsageSnapshotView | undefined;
  /** Reloads quotas and accounting; failures surface in the panel. */
  refresh(): Promise<void>;
  onClose(): void;
}

/** Provider quotas with meter bars plus the request tokens routed through each actual model. */
export function UsagePanel(props: UsagePanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const [offset, setOffset] = createSignal(0);
  const [error, setError] = createSignal('');
  const [refreshing, setRefreshing] = createSignal(false);
  const rows = createMemo(() => usageRows(props.snapshot, theme(), Date.now()));
  const height = () => Math.max(1, bodyLimit() - 2);
  const clamp = (next: number) => Math.max(0, Math.min(next, Math.max(0, rows().length - height())));

  async function refresh() {
    setRefreshing(true);
    setError('');
    try { await props.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Refreshing usage failed.'); }
    finally { setRefreshing(false); }
  }

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const actions: Record<string, () => void> = {
      up: () => setOffset(value => clamp(value - 1)),
      down: () => setOffset(value => clamp(value + 1)),
      pageup: () => setOffset(value => clamp(value - height())),
      pagedown: () => setOffset(value => clamp(value + height())),
      home: () => setOffset(0),
      end: () => setOffset(clamp(rows().length)),
      r: () => void refresh(),
      escape: props.onClose,
    };
    const action = actions[event.name];
    if (action) { event.preventDefault(); action(); }
  });

  const visible = () => rows().slice(offset(), offset() + height());
  return (
    <Dialog title="Provider Usage" size="large" footer={<KeyHints hints={HINTS} />} onBackdrop={props.onClose}>
      <Show when={!refreshing()} fallback={<text fg={theme().muted} marginTop={1}>Refreshing quotas…</text>}>
        <box marginTop={1} flexShrink={0}>
          <For each={visible()}>{row => row}</For>
        </box>
        <Show when={rows().length > height()}>
          <text fg={theme().muted} wrapMode="none">{(offset() + 1) + '–' + (offset() + height()) + ' of ' + rows().length}</text>
        </Show>
        <Show when={error()}><text fg={theme().error} marginTop={1}>{error()}</text></Show>
      </Show>
    </Dialog>
  );
}

function usageRows(snapshot: UsageSnapshotView | undefined, theme: Theme, now: number) {
  if (!snapshot) return [<text fg={theme.muted}>Usage has not been loaded yet. Press r to load account quotas.</text>];
  const rows: JSX.Element[] = [];
  for (const provider of snapshot.providers) {
    const color = providerColor(theme, provider.provider);
    rows.push(<text fg={color} attributes={TextAttributes.BOLD} wrapMode="none">
      {provider.provider.toUpperCase() + (provider.stale ? ' · STALE' : '')}</text>);
    rows.push(muted(theme, 'Quota ' + provider.state + (provider.updatedAt ? ' · updated ' + relativeTime(Date.parse(provider.updatedAt), now) : '')));
    if (!provider.windows.length) rows.push(muted(theme, 'Quota windows unknown'));
    for (const window of provider.windows) rows.push(...windowRows(window, theme, now));
    if (provider.reason) rows.push(muted(theme, provider.reason));
    rows.push(muted(theme, 'Source ' + provider.source));
    rows.push(<text>{''}</text>);
  }
  if (!snapshot.providers.length) rows.push(muted(theme, 'No provider quota data.'));
  rows.push(<text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">REQUEST TOKENS</text>);
  if (!snapshot.totals.length) rows.push(muted(theme, 'No completed request accounting yet.'));
  for (const total of snapshot.totals) {
    rows.push(<text fg={providerColor(theme, total.provider)} wrapMode="none">
      {total.provider + ' / ' + total.actualModel + attribution(total)}</text>);
    if (total.reportedModel && total.reportedModel !== total.actualModel) rows.push(muted(theme, 'Provider reported ' + total.reportedModel));
    rows.push(...tokenRows(total, theme));
  }
  const pending = snapshot.attempts.filter(attempt => attempt.outcome === 'pending').length;
  if (pending) rows.push(muted(theme, pending + ' request' + (pending === 1 ? '' : 's') + ' in progress; tokens not yet reported'));
  rows.push(<text>{''}</text>);
  rows.push(muted(theme, 'Since ' + snapshot.since + ' · ' + snapshot.scope));
  rows.push(muted(theme, 'Cache/reasoning are subsets of input/output; missing usage is not zero.'));
  return rows;
}

function windowRows(window: UsageWindow, theme: Theme, now: number) {
  const name = window.label ?? window.id;
  if (window.usedPercent === null) return [muted(theme, name + ' · usage unknown')];
  const ratio = Math.min(1, window.usedPercent / 100);
  const filled = Math.round(ratio * METER_CELLS);
  const color = ratio >= DANGER_RATIO ? theme.error : ratio >= WARNING_RATIO ? theme.warning : theme.accent;
  const reset = window.resetsAt ? ' · resets in ' + formatReset(Date.parse(window.resetsAt) - now) : '';
  return [
    <text fg={theme.text} wrapMode="none">{name}</text>,
    <text wrapMode="none">
      <span style={{ fg: color }}>{'━'.repeat(filled)}</span>
      <span style={{ fg: theme.border }}>{'━'.repeat(METER_CELLS - filled)}</span>
      <span style={{ fg: color }}>{' ' + Math.round(window.usedPercent) + '% used'}</span>
      <span style={{ fg: theme.muted }}>{reset}</span>
    </text>,
  ];
}

function tokenRows(total: UsageTotal, theme: Theme) {
  if (!total.tokens) return [<text fg={theme.text} wrapMode="none">Tokens unknown</text>];
  const { input, output, cacheRead, cacheCreate, reasoning } = total.tokens;
  return [
    <text fg={theme.text} wrapMode="none">{'Input ' + formatTokens(input) + ' · Output ' + formatTokens(output)}</text>,
    muted(theme, 'Cache read ' + formatTokens(cacheRead ?? 0) + ' · write ' + formatTokens(cacheCreate ?? 0) + ' · reasoning ' + formatTokens(reasoning ?? 0)),
    muted(theme, total.completed + '/' + total.attempts + ' completed · ' + total.unknown + ' unmeasured · ' + total.interrupted + ' interrupted'),
  ];
}

const attribution = (total: UsageTotal) =>
  total.agent ? ' · agent ' + total.agent : total.requestClass ? ' · ' + total.requestClass : '';

/** Six call sites share this lockstep secondary-text style. */
const muted = (theme: Theme, value: string) => <text fg={theme.muted} wrapMode="none">{value}</text>;

// Graphical context window panel; dialog structure adapted from the usage panel (OpenCode UI, MIT).
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, type KeyHint } from './dialog';
import { formatTokens, providerColor } from './status';
import { useTheme, type Theme } from './theme';

/** Catalog entry of the selected model; the UI never imports controller types. */
export interface ContextModelView {
  label: string;
  provider: string;
  context?: number;
  maxContext?: number;
  contextSource?: string;
}

/** The slice of the engine's context usage response this panel reads. */
export interface ContextUsageView {
  model: string;
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  categories?: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[];
  memoryFiles?: { path: string; tokens: number }[];
  mcpTools?: { name: string; serverName: string; tokens: number }[];
}

const BAR_CELLS = 24;
const WARNING_RATIO = 0.7;
const DANGER_RATIO = 0.9;
const HINTS: KeyHint[] = [['↑↓', 'scroll'], ['esc', 'close']];
type CategoryKind = NonNullable<ContextUsageView['categories']>[number]['kind'];
const KIND_COLOR: Record<CategoryKind, keyof Theme> = {
  used: 'accent', free: 'border', buffer: 'warning', deferred: 'muted',
};

export interface ContextPanelProps {
  usage: ContextUsageView | undefined;
  model?: ContextModelView;
  onClose(): void;
}

/** Active window, catalog capacity, compaction buffer and context categories as meter bars. */
export function ContextPanel(props: ContextPanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const [offset, setOffset] = createSignal(0);
  const rows = createMemo(() => contextRows(props.usage, props.model, theme()));
  const height = () => Math.max(1, bodyLimit() - 2);
  const clamp = (next: number) => Math.max(0, Math.min(next, Math.max(0, rows().length - height())));

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const actions: Record<string, () => void> = {
      up: () => setOffset(value => clamp(value - 1)),
      down: () => setOffset(value => clamp(value + 1)),
      pageup: () => setOffset(value => clamp(value - height())),
      pagedown: () => setOffset(value => clamp(value + height())),
      home: () => setOffset(0),
      end: () => setOffset(clamp(rows().length)),
      escape: props.onClose,
    };
    const action = actions[event.name];
    if (action) { event.preventDefault(); action(); }
  });

  const visible = () => rows().slice(offset(), offset() + height());
  return (
    <Dialog title="Context" size="large" footer={<KeyHints hints={HINTS} />} onBackdrop={props.onClose}>
      <box marginTop={1} flexShrink={0}>
        <For each={visible()}>{row => row}</For>
      </box>
      <Show when={rows().length > height()}>
        <text fg={theme().muted} wrapMode="none">{(offset() + 1) + '–' + (offset() + height()) + ' of ' + rows().length}</text>
      </Show>
    </Dialog>
  );
}

function contextRows(usage: ContextUsageView | undefined, model: ContextModelView | undefined, theme: Theme) {
  if (!usage) return [<text fg={theme.muted}>Context has not been loaded yet.</text>];
  const rows: JSX.Element[] = [];
  const color = model ? providerColor(theme, model.provider) : theme.text;
  rows.push(<text fg={color} attributes={TextAttributes.BOLD} wrapMode="none">{model?.label ?? usage.model}</text>);
  const capacity = model?.maxContext ?? model?.context;
  if (capacity) rows.push(plain(theme, 'Catalog capacity ' + formatTokens(capacity) + ' tokens' + (model?.contextSource ? ' · ' + model.contextSource : '')));
  rows.push(muted(theme, 'Engine model ' + usage.model + ' · engine capacity ' + formatTokens(usage.rawMaxTokens) + ' tokens'));
  rows.push(plain(theme, 'Active window ' + formatTokens(usage.maxTokens) + ' tokens · used ' + formatTokens(usage.totalTokens)));
  rows.push(...windowMeter(usage, theme));
  const categories = usage.categories ?? [];
  if (categories.length) rows.push(...categoryBars(categories, usage.maxTokens, theme));
  else rows.push(muted(theme, 'Context breakdown not loaded.'));
  rows.push(...fileSection(theme, 'Memory files', (usage.memoryFiles ?? []).map(file => [file.path, file.tokens] as const)));
  rows.push(...fileSection(theme, 'MCP tools', (usage.mcpTools ?? []).map(tool => [tool.serverName + ' · ' + tool.name, tool.tokens] as const)));
  rows.push(<text>{''}</text>);
  rows.push(muted(theme, 'Catalog limits, engine limits and measured provider tokens are distinct. Summary counts can be estimates.'));
  return rows;
}

function windowMeter(usage: ContextUsageView, theme: Theme) {
  if (!usage.maxTokens) return [muted(theme, 'Used tokens unknown')];
  const ratio = Math.min(1, usage.totalTokens / usage.maxTokens);
  const filled = Math.round(ratio * BAR_CELLS);
  const color = ratio >= DANGER_RATIO ? theme.error : ratio >= WARNING_RATIO ? theme.warning : theme.accent;
  const percent = Math.round(ratio * 100);
  return [
    <text wrapMode="none">
      <span style={{ fg: color }}>{'━'.repeat(filled)}</span>
      <span style={{ fg: theme.border }}>{'━'.repeat(BAR_CELLS - filled)}</span>
      <span style={{ fg: color }}>{' ' + percent + '%'}</span>
    </text>,
    ...(ratio > 1 ? [<text fg={theme.error} wrapMode="none">Context exceeds the active window. Compact before continuing.</text>] : []),
  ];
}

/** One proportional stacked bar (used categories plus the compaction buffer) followed by per-category rows. */
function categoryBars(categories: NonNullable<ContextUsageView['categories']>, windowTokens: number, theme: Theme) {
  const windowed = categories.filter(category => category.kind === 'used' || category.kind === 'buffer');
  const bar = (
    <text wrapMode="none">
      <For each={windowed}>{category =>
        <span style={{ fg: theme[KIND_COLOR[category.kind]] }}>{'█'.repeat(Math.max(0, Math.round(category.tokens / Math.max(1, windowTokens) * BAR_CELLS)))}</span>
      }</For>
    </text>
  );
  const detail = categories.map(category => (
    <text fg={category.kind === 'used' ? theme.text : theme.muted} wrapMode="none">
      {category.name + ' · ' + formatTokens(category.tokens) + (category.kind === 'deferred' ? ' · deferred (outside the window)' : category.kind === 'buffer' ? ' · compaction reserve' : category.kind === 'free' ? ' · remaining' : '')}
    </text>
  ));
  return [bar, ...detail];
}

function fileSection(theme: Theme, title: string, entries: readonly (readonly [string, number])[]) {
  if (!entries.length) return [];
  const total = entries.reduce((sum, [, tokens]) => sum + tokens, 0);
  return [
    <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">{title.toUpperCase() + ' · ' + formatTokens(total)}</text>,
    ...entries.map(([name, tokens]) => muted(theme, name + ' · ' + formatTokens(tokens))),
  ];
}

const plain = (theme: Theme, value: string) => <text fg={theme.text} wrapMode="none">{value}</text>;
const muted = (theme: Theme, value: string) => <text fg={theme.muted} wrapMode="none">{value}</text>;

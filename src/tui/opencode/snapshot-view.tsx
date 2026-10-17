// Structured snapshot renderer; turns admin/engine JSON payloads into readable panels (OpenCode UI, MIT).
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { leadingLines } from './tasks-model';
import { truncate } from './layout';
import { useTheme, type Theme } from './theme';
const VALUE_LIMIT = 300;
const DESCRIPTION_LINES = 3;
const HINTS: KeyHint[] = [['↑↓', 'scroll'], ['esc', 'close']];

const STATUS_TONE: [RegExp, 'success' | 'error' | 'warning'][] = [
  [/^connected$|^on$|^enabled$|^ok$|^healthy$|^authenticated$|^available$/i, 'success'],
  [/fail|error|disabled$|^off$|denied|expired|disconnected|unavailable|missing/i, 'error'],
  [/pending|paused|connecting|warning|stale/i, 'warning'],
];

export interface SnapshotPanelProps {
  title: string;
  snapshot: unknown;
  onClose(): void;
}

/** Renders structured engine snapshots (sections, record lists, status fields) without raw JSON. */
export function SnapshotPanel(props: SnapshotPanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth('large');
  const [offset, setOffset] = createSignal(0);
  const rows = createMemo(() => snapshotRows(props.snapshot, contentWidth(), theme()));
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

  return (
    <Dialog title={props.title} size="large" footer={<KeyHints hints={HINTS} />} onBackdrop={props.onClose}>
      <box marginTop={1} flexShrink={0}>
        <For each={rows().slice(offset(), offset() + height())}>{row => row}</For>
      </box>
      <Show when={rows().length > height()}>
        <text fg={theme().muted} wrapMode="none">{(offset() + 1) + '–' + (offset() + height()) + ' of ' + rows().length}</text>
      </Show>
    </Dialog>
  );
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] | undefined => Array.isArray(value) ? value : undefined;

function snapshotRows(snapshot: unknown, width: number, theme: Theme): JSX.Element[] {
  const rows: JSX.Element[] = [];
  const sections = record(snapshot)?.sections;
  if (Array.isArray(sections) && sections.every(record)) {
    for (const section of sections) {
      const entries = Array.isArray(section.rows) ? section.rows : [];
      if (typeof section.title === 'string') rows.push(header(theme, section.title));
      for (const entry of entries.filter(record)) {
        const label = scalar(entry.label) ?? '';
        const value = scalar(entry.value) ?? '';
        if (label || value) rows.push(row(theme, label, value, width));
      }
    }
    return rows.length ? rows : [empty(theme)];
  }
  renderValue(snapshot, width, theme, rows, 0);
  return rows.length ? rows : [empty(theme)];
}

/** Recursively renders one snapshot value: records become labelled rows, arrays become groups. */
function renderValue(value: unknown, width: number, theme: Theme, rows: JSX.Element[], depth: number) {
  const asRecord = record(value);
  if (asRecord) {
    for (const [key, entry] of Object.entries(asRecord)) {
      if (entry === undefined || entry === null || entry === '') continue;
      if (isTitle(key)) rows.push(header(theme, scalar(entry) ?? key));
      else if (list(entry)?.length) { rows.push(header(theme, key)); renderValue(entry, width, theme, rows, depth + 1); }
      else if (record(entry)) renderValue(entry, width, theme, rows, depth + 1);
      else {
        const text = scalar(entry) ?? JSON.stringify(entry);
        if (text !== undefined) rows.push(row(theme, key, truncate(text, VALUE_LIMIT), width, depth));
      }
    }
    return;
  }
  const asList = list(value);
  if (asList) {
    for (const entry of asList) {
      const entryRecord = record(entry);
      if (!entryRecord) { rows.push(muted(theme, indent(scalar(entry) ?? '', depth))); continue; }
      rows.push(recordHeader(theme, entryRecord, width, depth));
      renderFields(entryRecord, width, theme, rows, depth, titleKeyOf(entryRecord));
    }
    return;
  }
  const text = scalar(value);
  if (text !== undefined) rows.push(muted(theme, indent(text, depth)));
}

function renderFields(source: Record<string, unknown>, width: number, theme: Theme, rows: JSX.Element[], depth: number, skipKey?: string) {
  const description = DESCRIPTION_KEYS.map(key => scalar(source[key])).find(value => value);
  if (description) for (const line of leadingLines(description, DESCRIPTION_LINES, width - depth * 2)) rows.push(muted(theme, indent(line, depth)));
  for (const [key, value] of Object.entries(source)) {
    if (isTitle(key) || key === skipKey || STATUS_KEYS.includes(key) || DESCRIPTION_KEYS.includes(key)) continue;
    if (value === undefined || value === null || value === '' || typeof value === 'function') continue;
    const nested = record(value) ?? list(value);
    if (nested) {
      rows.push(muted(theme, indent(key, depth)));
      renderValue(nested, width, theme, rows, depth + 1);
    } else {
      const text = scalar(value) ?? JSON.stringify(value);
      if (text !== undefined) rows.push(row(theme, key, truncate(text, VALUE_LIMIT), width, depth));
    }
  }
}

const TITLE_KEYS = ['name', 'title', 'label', 'display_name', 'displayName', 'id', 'key'];
const STATUS_KEYS = ['status', 'state', 'kind', 'scope'];
const DESCRIPTION_KEYS = ['description', 'summary'];

function titleKeyOf(source: Record<string, unknown>): string | undefined {
  return TITLE_KEYS.find(key => scalar(source[key]) !== undefined);
}
function recordHeader(theme: Theme, source: Record<string, unknown>, width: number, depth: number): JSX.Element {
  const title = scalar(source[titleKeyOf(source) ?? '']) ?? 'entry';
  const status = STATUS_KEYS.map(key => scalar(source[key])).find(value => value);
  const tone = status ? statusTone(status) : undefined;
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">{indent(truncate(title, width - (status ? 28 : 4)), depth)}</text>
      <Show when={status} keyed>{statusText => <text fg={tone === 'success' ? theme.success : tone === 'error' ? theme.error : tone === 'warning' ? theme.warning : theme.muted} wrapMode="none">{'· ' + truncate(statusText, 20)}</text>}</Show>
    </box>
  );
}

const header = (theme: Theme, title: string) => <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">{title.toUpperCase()}</text>;
const empty = (theme: Theme) => <text fg={theme.muted}>No entries.</text>;
const muted = (theme: Theme, value: string) => <text fg={theme.muted} wrapMode="none">{value}</text>;

function row(theme: Theme, label: string, value: string, width: number, depth = 0) {
  const labelWidth = Math.max(8, Math.floor(width / 3));
  return (
    <text wrapMode="none">
      <span style={{ fg: theme.text }}>{indent(truncate(label, labelWidth) + '  ', depth)}</span>
      <span style={{ fg: theme.muted }}>{truncate(value, width - labelWidth - depth * 2 - 2)}</span>
    </text>
  );
}

const indent = (text: string, depth: number) => '  '.repeat(depth) + text;

function statusTone(status: string): 'success' | 'error' | 'warning' | undefined {
  return STATUS_TONE.find(([pattern]) => pattern.test(status))?.[1];
}

function isTitle(key: string) {
  return key === 'title' || key === 'section';
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

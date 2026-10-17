// Settings hub panel; row selection adapted from the workspace diff list (OpenCode UI, MIT).
import { TextAttributes } from '@opentui/core';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { padToWidth, truncate } from './layout';
import { useTheme } from './theme';

/** One actionable configuration row; the label carries the setting, the value its current state. */
export interface SettingsEntry {
  label: string;
  value?: string;
  run(): void;
}

export interface SettingsGroup { title: string; entries: SettingsEntry[] }

type Row = { header: string; key: string } | { entry: SettingsEntry; key: string };

const HINTS: KeyHint[] = [['↑↓', 'select'], ['enter', 'change'], ['esc', 'close']];
const ROW_PADDING = 1;

export interface SettingsPanelProps {
  groups: SettingsGroup[];
  onClose(): void;
}

/** Grouped configuration rows: default model, per-model effort, fallback rules. */
export function SettingsPanel(props: SettingsPanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth('large');
  const rows = createMemo<Row[]>(() => props.groups.flatMap((group, groupIndex) =>
    [{ header: group.title, key: 'h' + groupIndex }, ...group.entries.map((entry, entryIndex) => ({ entry, key: groupIndex + ':' + entryIndex }))]));
  const isEntry = (row: Row): row is { entry: SettingsEntry; key: string } => 'entry' in row;
  const [selected, setSelected] = createSignal(Math.max(0, rows().findIndex(isEntry)));
  const move = (delta: number) => {
    const step = delta < 0 ? -1 : 1;
    for (let index = selected() + step; index >= 0 && index < rows().length; index += step)
      if (isEntry(rows()[index])) { setSelected(index); return; }
  };
  const chosen = () => { const row = rows()[selected()]; return isEntry(row) ? row.entry : undefined; };

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const actions: Record<string, () => void> = {
      up: () => move(-1), down: () => move(1),
      home: () => setSelected(rows().findIndex(isEntry)),
      end: () => setSelected(Math.max(0, rows().length - 1)),
      return: () => chosen()?.run(),
      escape: props.onClose,
    };
    const action = actions[event.name];
    if (action) { event.preventDefault(); action(); }
  });

  return (
    <Dialog title="Settings" size="large" footer={<KeyHints hints={HINTS} />} onBackdrop={props.onClose}>
      <box marginTop={1} flexDirection="column" flexShrink={0}>
        <For each={rows()}>{(row, index) => isEntry(row)
          ? <SettingRow entry={row.entry} selected={index() === selected()} width={contentWidth()}
              onHover={() => setSelected(index())} onRun={row.entry.run} />
          : <text fg={theme().muted} attributes={TextAttributes.BOLD} wrapMode="none" marginTop={index() ? 1 : 0}>{row.header.toUpperCase()}</text>}
        </For>
      </box>
      <Show when={rows().length > bodyLimit() - 4}>
        <text fg={theme().muted} wrapMode="none">{'more below · ' + rows().length + ' rows'}</text>
      </Show>
    </Dialog>
  );
}

function SettingRow(props: { entry: SettingsEntry; selected: boolean; width: number; onHover(): void; onRun(): void }) {
  const theme = useTheme();
  const labelWidth = () => Math.floor(props.width / 2) - 2;
  return (
    <box height={1} flexShrink={0} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}
      backgroundColor={props.selected ? theme().selection : undefined} onMouseMove={props.onHover} onMouseUp={props.onRun}>
      <text wrapMode="none" attributes={props.selected ? TextAttributes.BOLD : undefined}>
        <span style={{ fg: props.selected ? theme().selectionText : theme().text }}>{padToWidth(truncate(props.entry.label, labelWidth()), labelWidth() + 2)}</span>
        <span style={{ fg: props.selected ? theme().selectionText : theme().muted }}>{truncate(props.entry.value ?? '', props.width - labelWidth() - 2 - ROW_PADDING * 2)}</span>
      </text>
    </box>
  );
}

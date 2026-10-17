// Keyboard shortcut overlay (`?` on an empty prompt); dialog structure follows the other OpenCode-style panels (MIT).
import { For, Show, createMemo } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { truncate } from './layout';
import { usePagedRows } from './paged-rows';
import { useTheme } from './theme';

export interface ShortcutGroup { title: string; keys: KeyHint[] }

/** The key that opens the overlay; it only acts while the prompt is empty, otherwise it types a `?`. */
export const SHORTCUTS_KEY = '?';

const BUILT_IN: ShortcutGroup[] = [
  { title: 'General', keys: [
    ['ctrl+p', 'Command palette'],
    [SHORTCUTS_KEY, 'This overview (empty prompt)'],
    ['esc', 'Close the top dialog, else interrupt the turn'],
    ['ctrl+c', 'Copy selection · interrupt · twice to exit'],
    ['ctrl+t', 'Agents & tasks'],
    ['shift+tab', 'Cycle permission mode'],
  ] },
  { title: 'Prompt', keys: [
    ['enter', 'Send'],
    ['shift+enter', 'New line (also ctrl+j)'],
    ['↑ ↓', 'Prompt history (empty prompt)'],
    ['/', 'Slash commands · tab completes'],
  ] },
  { title: 'Transcript', keys: [
    ['pgup pgdn', 'Scroll'],
    ['home end', 'Beginning · back to live output (empty prompt)'],
    ['drag', 'Select text, then ctrl+c to copy'],
    ['click', 'Task chip opens tasks · mode label cycles mode'],
  ] },
];

/** Built-in shortcuts plus the user's own bindings from `ui.json`, which the palette shortcut is already part of. */
export function shortcutGroups(keybindings: Record<string, string>): ShortcutGroup[] {
  const builtIn = new Set(BUILT_IN.flatMap(group => group.keys.map(([key]) => key)));
  const custom = Object.entries(keybindings)
    .filter(([chord]) => !builtIn.has(chord))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([chord, command]): KeyHint => [chord, command]);
  return custom.length ? [...BUILT_IN, { title: 'Command shortcuts', keys: custom }] : BUILT_IN;
}

type Row = { kind: 'header'; title: string } | { kind: 'key'; key: string; label: string };

const KEY_COLUMN = 14;
const HINTS: KeyHint[] = [['↑↓', 'scroll'], ['esc', 'close']];

export function ShortcutsPanel(props: { keybindings: Record<string, string>; onClose(): void }) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const width = useDialogContentWidth('large');
  const rows = createMemo<Row[]>(() => shortcutGroups(props.keybindings).flatMap((group, index) => [
    ...(index ? [{ kind: 'header' as const, title: '' }] : []),
    { kind: 'header' as const, title: group.title },
    ...group.keys.map(([key, label]) => ({ kind: 'key' as const, key, label })),
  ]));
  const paged = usePagedRows(rows, () => Math.max(1, bodyLimit() - 2));

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    if (event.name === 'escape' || event.name === SHORTCUTS_KEY) props.onClose();
    else if (!paged.handleKey(event.name)) return;
    event.preventDefault();
  });

  return (
    <Dialog title="Keyboard shortcuts" size="large" footer={<KeyHints hints={HINTS} />} onBackdrop={props.onClose}>
      <box marginTop={1} flexShrink={0}>
        <For each={paged.visible()}>{row => row.kind === 'header'
          ? <text fg={theme().muted} attributes={TextAttributes.BOLD} wrapMode="none" height={1}>{row.title}</text>
          : <text wrapMode="none" height={1}>
              <span style={{ fg: theme().accent }}>{row.key.padEnd(KEY_COLUMN)}</span>
              <span style={{ fg: theme().text }}>{truncate(row.label, width() - KEY_COLUMN)}</span>
            </text>}
        </For>
      </box>
      <Show when={paged.rangeLabel()}><text fg={theme().muted} wrapMode="none">{paged.rangeLabel()}</text></Show>
    </Dialog>
  );
}

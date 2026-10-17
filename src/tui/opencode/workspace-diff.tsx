// Graphical workspace diff browser; dialog structure adapted from the tasks panel (OpenCode UI, MIT).
import { For, Show, createMemo, createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { DiffView, unifiedDiff, type FileDiff } from './diff';
import { truncate } from './layout';
import { useTheme } from './theme';

export interface WorkspaceDiffData { diff: string; untracked: string[]; truncated: boolean; staged: boolean }

const LIST_HINTS: KeyHint[] = [['↑↓', 'select'], ['enter', 'review'], ['esc', 'close']];
const DETAIL_HINTS: KeyHint[] = [['e', 'expand'], ['esc', 'back']];

export interface WorkspaceDiffPanelProps {
  data: WorkspaceDiffData;
  onClose(): void;
}

/** Browsable list of changed files with colored counts; Enter reviews one file's hunks. */
export function WorkspaceDiffPanel(props: WorkspaceDiffPanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth('large');
  const files = createMemo(() => unifiedDiff(props.data.diff));
  const [selected, setSelected] = createSignal(0);
  const [open, setOpen] = createSignal<string>();
  const [expanded, setExpanded] = createSignal(false);
  const chosen = createMemo(() => files().find(file => file.path === open()));
  const totals = createMemo(() => files().reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 }));

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const actions: Record<string, () => void> = chosen()
      ? { e: () => setExpanded(value => !value), escape: () => { setOpen(undefined); setExpanded(false); } }
      : {
          up: () => setSelected(index => Math.max(0, index - 1)),
          down: () => setSelected(index => Math.min(files().length - 1, index + 1)),
          return: () => { const file = files()[selected()]; if (file) setOpen(file.path); },
          escape: props.onClose,
        };
    const action = actions[event.name];
    if (action) { event.preventDefault(); action(); }
  });

  return (
    <Dialog title={chosen() ? truncate(chosen()!.path, contentWidth() - 8) : (props.data.staged ? 'Staged changes' : 'Workspace changes')}
      size="large" footer={<KeyHints hints={chosen() ? DETAIL_HINTS : LIST_HINTS} />} onBackdrop={props.onClose}>
      <Show when={chosen()} keyed fallback={<FileList files={files()} untracked={props.data.untracked} truncated={props.data.truncated}
        totals={totals()} selected={selected()} width={contentWidth()} onHover={setSelected}
        onPick={index => { setSelected(index); setOpen(files()[index]?.path); }} />}>
        {file => <DiffView diff={file} expanded={expanded()} />}
      </Show>
    </Dialog>
  );
}

function FileList(props: { files: FileDiff[]; untracked: string[]; truncated: boolean; totals: { added: number; removed: number };
  selected: number; width: number; onHover(index: number): void; onPick(index: number): void }) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const height = () => Math.max(1, bodyLimit() - 6 - props.untracked.length);
  return (
    <box marginTop={1} flexDirection="column" flexShrink={0}>
      <text fg={theme().text} wrapMode="none">
        {props.files.length + ' file' + (props.files.length === 1 ? '' : 's') + ' · '}
        <span style={{ fg: theme().success }}>{'+' + props.totals.added}</span>
        {' / '}
        <span style={{ fg: theme().error }}>{'-' + props.totals.removed}</span>
      </text>
      <box marginTop={1}>
        <For each={props.files.slice(0, height())}>{(file, index) =>
          <box height={1} flexShrink={0} backgroundColor={index() === props.selected ? theme().selection : undefined}
            onMouseMove={() => props.onHover(index())} onMouseUp={() => props.onPick(index())}>
            <text wrapMode="none">
              <span style={{ fg: index() === props.selected ? theme().selectionText : theme().text }}>{truncate(file.path, props.width - 14) + '  '}</span>
              <span style={{ fg: index() === props.selected ? theme().selectionText : theme().success }}>{file.added ? '+' + file.added : '  '}</span>
              {' '}
              <span style={{ fg: index() === props.selected ? theme().selectionText : theme().error }}>{file.removed ? '-' + file.removed : '  '}</span>
            </text>
          </box>
        }</For>
      </box>
      <Show when={props.untracked.length}>
        <text fg={theme().text} marginTop={1} wrapMode="none">{'Untracked · ' + props.untracked.length}</text>
        <For each={props.untracked}>{path => <text fg={theme().muted} wrapMode="none">{truncate(path, props.width)}</text>}</For>
      </Show>
      <Show when={props.truncated}><text fg={theme().warning} wrapMode="none">Output truncated by Git; some changes may be missing.</text></Show>
    </box>
  );
}

// Searchable, recency-grouped session picker for /resume. List/dialog structure follows OpenCode dialog-select (MIT); see docs/opencode-provenance.md.
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { Spinner } from './status';
import { useTheme } from './theme';
import {
  moveSelection, revealStart, rowOfItem, scrollTopToReveal, toFlatRows, toRows, type ListRow,
} from './list-model';
import {
  formatSize, groupSessions, relativeTime, searchSessions, sessionTitle, type SessionInfo,
} from './sessions-model';

export interface SessionPickerActions {
  load(): Promise<SessionInfo[]>;
  resume(session: SessionInfo): Promise<void>;
  remove(session: SessionInfo): Promise<void>;
  rename(session: SessionInfo, title: string): Promise<void>;
  fork(session: SessionInfo): Promise<void>;
}

export interface SessionPickerProps {
  actions: SessionPickerActions;
  /** Id of the session that is open right now; it is marked in the list. */
  currentId?: string;
  now?(): number;
  onClose(): void;
}

type Mode =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'list' }
  | { kind: 'confirm-delete'; session: SessionInfo }
  | { kind: 'rename'; session: SessionInfo }
  | { kind: 'working'; message: string };

const ROW_PADDING = 1;
const MARKER_WIDTH = 2;
const TIME_COLUMN = 9;
const BRANCH_COLUMN = 16;
const WIDE_ROW = 52;
/** Rows below the list: margin plus the three preview lines. */
const PREVIEW_RESERVED_ROWS = 4;
const MIN_LIST_ROWS = 3;
const ELLIPSIS = '…';
const OPEN_MARKER = '●';

export function SessionPicker(props: SessionPickerProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth('large');
  const [sessions, setSessions] = createSignal<SessionInfo[]>([]);
  const [mode, setMode] = createSignal<Mode>({ kind: 'loading' });
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  const [draftTitle, setDraftTitle] = createSignal('');
  const [notice, setNotice] = createSignal('');
  let scroll: ScrollBoxRenderable | undefined;

  const now = () => props.now?.() ?? Date.now();
  const rows = createMemo<ListRow<SessionInfo>[]>(() => query().trim() ?
    toFlatRows(searchSessions(sessions(), query())) : toRows(groupSessions(sessions(), now())));
  const items = createMemo(() => rows().flatMap(row => row.kind === 'item' ? [row.item] : []));
  const highlighted = () => items()[selected()];
  const narrow = () => contentWidth() < WIDE_ROW;
  const listHeight = () => Math.min(Math.max(rows().length, 1),
    Math.max(MIN_LIST_ROWS, bodyLimit() - PREVIEW_RESERVED_ROWS - (narrow() ? 2 : 1)));
  const busy = () => mode().kind === 'working';

  onMount(() => void load());
  createEffect(on(query, () => setSelected(0), { defer: true }));
  createEffect(() => reveal(selected(), rows(), listHeight()));

  async function load() {
    setMode({ kind: 'loading' });
    try {
      setSessions(await props.actions.load());
      setMode({ kind: 'list' });
    } catch (cause) {
      setMode({ kind: 'failed', message: describe(cause, 'Could not list sessions.') });
    }
  }
  /** Runs a slow action behind a progress message; false means it failed and the error is shown. */
  async function work(message: string, task: () => Promise<void>): Promise<boolean> {
    setNotice('');
    setMode({ kind: 'working', message });
    try {
      await task();
      return true;
    } catch (cause) {
      setNotice(describe(cause, 'Action failed.'));
      return false;
    } finally {
      setMode({ kind: 'list' });
    }
  }
  async function resume(session: SessionInfo) {
    if (await work('Resuming “' + sessionTitle(session) + '”…', () => props.actions.resume(session))) props.onClose();
  }
  async function fork(session: SessionInfo) {
    if (await work('Forking “' + sessionTitle(session) + '”…', () => props.actions.fork(session))) props.onClose();
  }
  async function remove(session: SessionInfo) {
    const removed = await work('Deleting “' + sessionTitle(session) + '”…', () => props.actions.remove(session));
    if (!removed) return;
    setSessions(all => all.filter(candidate => candidate.sessionId !== session.sessionId));
    setSelected(index => moveSelection(index, 0, items().length));
  }
  async function rename(session: SessionInfo, title: string) {
    if (!title.trim()) { setNotice('A title is required.'); return; }
    const renamed = await work('Renaming…', () => props.actions.rename(session, title.trim()));
    if (renamed) setSessions(all => all.map(candidate =>
      candidate.sessionId === session.sessionId ? { ...candidate, customTitle: title.trim() } : candidate));
  }

  function reveal(index: number, current: ListRow<SessionInfo>[], height: number) {
    if (!scroll || scroll.isDestroyed) return;
    scroll.scrollTo(scrollTopToReveal(scroll.scrollTop, height, revealStart(current, index), rowOfItem(current, index)));
  }
  function navigate(key: string) {
    const last = items().length;
    const step: Record<string, number> = { up: -1, down: 1, pageup: -listHeight(), pagedown: listHeight() };
    if (key === 'home') setSelected(0);
    else if (key === 'end') setSelected(moveSelection(0, last, last));
    else setSelected(index => moveSelection(index, step[key], last));
  }
  function openRename(session: SessionInfo) {
    setDraftTitle(sessionTitle(session));
    setMode({ kind: 'rename', session });
  }

  function handleListKey(event: KeyEvent) {
    const session = highlighted();
    if (event.name === 'escape') props.onClose();
    else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(event.name)) { setNotice(''); navigate(event.name); }
    else if (event.name === 'return' && session) void resume(session);
    else if (event.ctrl && event.name === 'd' && session) setMode({ kind: 'confirm-delete', session });
    else if (event.ctrl && event.name === 'r' && session) openRename(session);
    else if (event.ctrl && event.name === 'f' && session) void fork(session);
    else return false;
    return true;
  }
  function handleConfirmKey(event: KeyEvent, session: SessionInfo) {
    if (event.name === 'return') void remove(session);
    else if (event.name === 'escape') setMode({ kind: 'list' });
    else return false;
    return true;
  }
  function handleRenameKey(event: KeyEvent, session: SessionInfo) {
    if (event.name === 'return') void rename(session, draftTitle());
    else if (event.name === 'escape') setMode({ kind: 'list' });
    else return false;
    return true;
  }
  function handleFailedKey(event: KeyEvent) {
    if (event.name === 'return') void load();
    else if (event.name === 'escape') props.onClose();
    else return false;
    return true;
  }
  function handleKey(event: KeyEvent) {
    const current = mode();
    switch (current.kind) {
      case 'working': return true;
      case 'loading': if (event.name === 'escape') props.onClose(); return event.name === 'escape';
      case 'failed': return handleFailedKey(event);
      case 'confirm-delete': return handleConfirmKey(event, current.session);
      case 'rename': return handleRenameKey(event, current.session);
      case 'list': return handleListKey(event);
    }
  }
  useKeyboard(event => { if (handleKey(event)) event.preventDefault(); });

  const footerRows = (): KeyHint[][] => {
    const current = mode().kind;
    if (current === 'confirm-delete') return [[['enter', 'delete'], ['esc', 'cancel']]];
    if (current === 'rename') return [[['enter', 'save'], ['esc', 'cancel']]];
    if (current !== 'list') return [[['esc', 'close']]];
    return narrow() ?
      [[['↑↓', 'select'], ['enter', 'resume'], ['esc', 'close']], [['^d', 'delete'], ['^r', 'rename'], ['^f', 'fork']]] :
      [[['↑↓', 'select'], ['enter', 'resume'], ['ctrl+d', 'delete'], ['ctrl+r', 'rename'], ['ctrl+f', 'fork'], ['esc', 'close']]];
  };
  const footer = () => <box flexDirection="column">
    <For each={footerRows()}>{hints => <KeyHints hints={hints} />}</For>
  </box>;
  const confirming = () => { const current = mode(); return current.kind === 'confirm-delete' ? current.session : undefined; };
  const renaming = () => mode().kind === 'rename';
  const working = () => { const current = mode(); return current.kind === 'working' ? current.message : undefined; };
  const failure = () => { const current = mode(); return current.kind === 'failed' ? current.message : undefined; };

  return (
    <Dialog title="Resume session" size="large" footer={footer()} onBackdrop={() => { if (!busy()) props.onClose(); }}>
      <Switch>
        <Match when={mode().kind === 'loading'}>
          <box flexDirection="row" gap={1} marginTop={1}><Spinner color={theme().accent} /><text fg={theme().muted}>Loading sessions…</text></box>
        </Match>
        <Match when={failure()}>
          <text fg={theme().error} marginTop={1}>{failure()}</text>
          <text fg={theme().muted}>Press enter to retry.</text>
        </Match>
        <Match when={true}>
          <Show when={renaming()} fallback={
            <box marginTop={1} flexShrink={0} backgroundColor={theme().element} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}>
              <input focused={mode().kind === 'list'} value={query()} placeholder="Search title, prompt, branch or id"
                textColor={theme().text} focusedTextColor={theme().text}
                backgroundColor={theme().element} focusedBackgroundColor={theme().element} onInput={setQuery} />
            </box>
          }>
            <box marginTop={1} flexShrink={0} backgroundColor={theme().element} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}>
              <input focused value={draftTitle()} textColor={theme().text} focusedTextColor={theme().text}
                backgroundColor={theme().element} focusedBackgroundColor={theme().element} onInput={setDraftTitle} />
            </box>
          </Show>
          <Show when={working()} fallback={
            <>
              <SessionList rows={rows()} selected={selected()} height={listHeight()} width={contentWidth()} currentId={props.currentId}
                now={now()} query={query()} empty={sessions().length === 0} scrollRef={element => { scroll = element; }}
                onHover={setSelected} onChoose={session => void resume(session)} />
              <Show when={confirming()} fallback={<SessionPreview session={highlighted()} width={contentWidth()} />}>
                {session => <text fg={theme().warning} marginTop={1}>
                  {fit('Delete “' + sessionTitle(session()) + '”? This cannot be undone.', contentWidth(), true)}</text>}
              </Show>
              <Show when={notice()}><text fg={theme().error}>{notice()}</text></Show>
            </>
          }>
            {message => <box flexDirection="row" gap={1} marginTop={1}><Spinner color={theme().accent} /><text fg={theme().text}>{message()}</text></box>}
          </Show>
        </Match>
      </Switch>
    </Dialog>
  );
}

interface SessionListProps {
  rows: ListRow<SessionInfo>[];
  selected: number;
  height: number;
  width: number;
  currentId?: string;
  now: number;
  query: string;
  empty: boolean;
  scrollRef(element: ScrollBoxRenderable): void;
  onHover(index: number): void;
  onChoose(session: SessionInfo): void;
}

function SessionList(props: SessionListProps) {
  const theme = useTheme();
  const innerWidth = () => props.width - ROW_PADDING * 2;
  return (
    <scrollbox ref={props.scrollRef} height={props.height} marginTop={1} flexShrink={0}>
      <For each={props.rows}>{row => row.kind === 'header' ?
        <text fg={theme().muted} attributes={TextAttributes.BOLD} paddingLeft={ROW_PADDING} height={1} flexShrink={0}>{row.label}</text> :
        <SessionRow session={row.item} active={row.index === props.selected} open={row.item.sessionId === props.currentId}
          width={innerWidth()} now={props.now} onHover={() => props.onHover(row.index)} onChoose={() => props.onChoose(row.item)} />
      }</For>
      <Show when={!props.rows.length}>
        <text fg={theme().muted} paddingLeft={ROW_PADDING}>
          {props.empty ? 'No saved sessions in this directory' : 'No sessions match “' + props.query.trim() + '”'}
        </text>
      </Show>
    </scrollbox>
  );
}

function SessionRow(props: { session: SessionInfo; active: boolean; open: boolean; width: number; now: number; onHover(): void; onChoose(): void }) {
  const theme = useTheme();
  const wide = () => props.width + ROW_PADDING * 2 >= WIDE_ROW;
  const branchWidth = () => wide() ? BRANCH_COLUMN + 1 : 0;
  const titleWidth = () => props.width - MARKER_WIDTH - TIME_COLUMN - branchWidth();
  const color = (normal: string) => props.active ? theme().background : normal;
  return (
    <box height={1} flexShrink={0} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}
      backgroundColor={props.active ? theme().accent : undefined} onMouseMove={props.onHover} onMouseUp={props.onChoose}>
      <text wrapMode="none" attributes={props.active ? TextAttributes.BOLD : undefined}>
        <span style={{ fg: color(theme().success) }}>{props.open ? OPEN_MARKER + ' ' : '  '}</span>
        <span style={{ fg: color(theme().text) }}>{fit(sessionTitle(props.session), titleWidth())}</span>
        <Show when={wide()}><span style={{ fg: color(theme().secondary) }}>{' ' + fit(props.session.gitBranch ?? '', BRANCH_COLUMN)}</span></Show>
        <span style={{ fg: color(theme().muted) }}>{relativeTime(props.session.lastModified, props.now).padStart(TIME_COLUMN)}</span>
      </text>
    </box>
  );
}

function SessionPreview(props: { session: SessionInfo | undefined; width: number }) {
  const theme = useTheme();
  const details = () => {
    const session = props.session;
    if (!session) return '';
    return [session.gitBranch, session.fileSize === undefined ? undefined : formatSize(session.fileSize), session.tag].filter(Boolean).join(' · ');
  };
  return (
    <box marginTop={1} flexShrink={0} height={PREVIEW_RESERVED_ROWS - 1}>
      <text fg={theme().text} wrapMode="none">{fit(oneLine(props.session?.firstPrompt ?? ''), props.width, true)}</text>
      <text fg={theme().muted} wrapMode="none">{fit(props.session?.sessionId ?? '', props.width, true)}</text>
      <text fg={theme().muted} wrapMode="none">{fit(details(), props.width, true)}</text>
    </box>
  );
}

function describe(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Truncates with an ellipsis and, unless `loose`, pads to exactly `width` columns so rows align. */
function fit(text: string, width: number, loose = false): string {
  const clipped = text.length > width ? text.slice(0, Math.max(0, width - 1)) + ELLIPSIS : text;
  return loose ? clipped : clipped.padEnd(width);
}

/** Spinner dialog for a session change that was started elsewhere (for example `/resume <id>`). */
export function ProgressDialog(props: { title: string; message: string; task: Promise<void>; onClose(): void }) {
  const theme = useTheme();
  const [failure, setFailure] = createSignal('');
  onMount(() => void props.task.then(props.onClose, cause => setFailure(describe(cause, 'Action failed.'))));
  useKeyboard(event => {
    event.preventDefault();
    if (failure() && event.name === 'escape') props.onClose();
  });
  return (
    <Dialog title={props.title} footer={<Show when={failure()}><KeyHints hints={[['esc', 'close']]} /></Show>}>
      <Show when={failure()} fallback={
        <box flexDirection="row" gap={1} marginTop={1}><Spinner color={theme().accent} /><text fg={theme().text}>{props.message}</text></box>
      }>
        <text fg={theme().error} marginTop={1}>{failure()}</text>
      </Show>
    </Dialog>
  );
}

// Adapted from OpenCode ui/dialog-select.tsx (MIT); see docs/opencode-provenance.md.
import { For, Show, createMemo, createSignal, createEffect, on } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth } from './dialog';
import { padToWidth, textWidth, truncate } from './layout';
import { Spinner } from './status';
import { useTheme } from './theme';
import {
  highlightRuns, matchPositions, moveSelection, rankItems, revealStart, rowOfItem, scrollTopToReveal, toFlatRows, toRows,
  type ListGroup, type ListRow,
} from './list-model';

export interface MenuItem {
  title: string;
  description?: string;
  /** Items sharing a group are listed under one heading while the search box is empty. */
  group?: string;
  /** Right-aligned shortcut label such as `ctrl+t`. */
  hint?: string;
  /** Marks the value in effect now: the menu opens on it and shows a marker. */
  current?: boolean;
  /** Shows the effect of the item while it is highlighted; the current item's preview restores it on dismissal. */
  preview?(): void;
  run(): void | Promise<void>;
}

const ROW_PADDING = 1;
const TITLE_GAP = 2;
/** Titles share one column so descriptions line up, but never take more than this share of the row. */
const TITLE_COLUMN_SHARE = 0.45;
const MARKER_WIDTH = 2;
const CURRENT_MARKER = '●';
const TITLE_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const NAVIGATION_KEYS = ['up', 'down', 'pageup', 'pagedown', 'home', 'end'];

export function Menu(props: { title:string; items:MenuItem[]; onClose():void }) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth();
  const [filter,setFilter] = createSignal('');
  const [selected,setSelected] = createSignal(Math.max(0, props.items.findIndex(item => item.current)));
  const [error,setError] = createSignal('');
  const [busy,setBusy] = createSignal(false);
  let scroll: ScrollBoxRenderable | undefined;
  const rows = createMemo(() => rowsFor(props.items, filter()));
  const options = createMemo(() => rows().flatMap(row => row.kind==='item' ? [row.item] : []));
  const marked = () => props.items.some(item => item.current);
  const titleColumn = createMemo(() => Math.min(Math.max(0, ...options().map(item => textWidth(item.title))),
    Math.floor(contentWidth() * TITLE_COLUMN_SHARE)));
  const listHeight = () => Math.min(Math.max(rows().length, 1), bodyLimit());
  createEffect(on(options, () => setSelected(0), { defer: true }));
  createEffect(() => keepVisible(selected(), rows()));
  createEffect(on(() => options()[selected()], item => item?.preview?.(), { defer: true }));

  function keepVisible(index:number, current:ListRow<MenuItem>[]) {
    if (!scroll || scroll.isDestroyed) return;
    scroll.scrollTo(scrollTopToReveal(scroll.scrollTop, listHeight(), revealStart(current, index), rowOfItem(current, index)));
  }
  function navigate(key:string) {
    const count = options().length;
    const step: Record<string, number> = { up: -1, down: 1, pageup: -listHeight(), pagedown: listHeight() };
    setError('');
    if (key==='home') setSelected(0);
    else if (key==='end') setSelected(moveSelection(0, count, count));
    else setSelected(index => moveSelection(index, step[key], count));
  }
  async function choose(item:MenuItem|undefined) {
    if (!item || busy()) return;
    setBusy(true);
    setError('');
    try { await item.run(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  /** Leaves without choosing: undoes any preview by previewing the current item again. */
  const dismiss = () => {
    if (busy()) return;
    props.items.find(item => item.current)?.preview?.();
    props.onClose();
  };
  useKeyboard(event => {
    if (event.name==='escape') { event.preventDefault(); if (filter()) setFilter(''); else dismiss(); }
    if (NAVIGATION_KEYS.includes(event.name)) { event.preventDefault(); navigate(event.name); }
    if(event.name==='return'){event.preventDefault();void choose(options()[selected()]);}
  });
  const footer = () => busy()
    ? <box flexDirection="row" gap={1}><Spinner color={theme().accent} /><text fg={theme().muted}>Working…</text></box>
    : <KeyHints hints={[['↑↓','select'],['enter','open'],['esc', filter() ? 'clear' : 'close']]} />;
  return (
    <Dialog title={props.title} onBackdrop={dismiss} footer={footer()}>
      <box marginTop={1} flexShrink={0} backgroundColor={theme().element} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}>
        <input focused={!busy()} value={filter()} placeholder="Search" textColor={theme().text} focusedTextColor={theme().text}
          placeholderColor={theme().muted} backgroundColor={theme().element} focusedBackgroundColor={theme().element}
          onInput={value=>setFilter(value)} />
      </box>
      <scrollbox ref={scroll} height={listHeight()} marginTop={1} flexShrink={0}>
        <For each={rows()}>{row => row.kind==='header' ?
          <text fg={theme().muted} attributes={TextAttributes.BOLD} height={1} flexShrink={0} paddingLeft={ROW_PADDING}>{row.label}</text> :
          <MenuRow item={row.item} active={row.index===selected()} width={contentWidth()} titleColumn={titleColumn()}
            query={filter()} marked={marked()}
            onHover={()=>setSelected(row.index)} onChoose={()=>void choose(row.item)} />
        }</For>
        <Show when={!options().length}>
          <text fg={theme().muted} paddingLeft={ROW_PADDING} wrapMode="none">
            {filter().trim() ? 'No matches for “' + filter().trim() + '”' : 'Nothing to choose from'}
          </text>
        </Show>
      </scrollbox>
      <Show when={error()}><text fg={theme().error} marginTop={1}>{error()}</text></Show>
    </Dialog>
  );
}

interface MenuRowProps {
  item:MenuItem; active:boolean; width:number; titleColumn:number; query:string; marked:boolean; onHover():void; onChoose():void;
}

function MenuRow(props: MenuRowProps) {
  const theme = useTheme();
  const hint = () => props.item.hint ?? '';
  const inner = () => props.width - ROW_PADDING * 2 - (props.marked ? MARKER_WIDTH : 0) - (hint() ? textWidth(hint()) + TITLE_GAP : 0);
  const title = () => truncate(props.item.title, props.item.description ? Math.min(inner(), props.titleColumn) : inner());
  const descriptionWidth = () => Math.max(0, inner() - Math.max(textWidth(title()), props.titleColumn) - TITLE_GAP);
  const color = (normal:string) => props.active ? theme().selectionText : normal;
  return <box flexDirection="row" height={1} flexShrink={0} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}
    backgroundColor={props.active ? theme().selection : undefined} onMouseMove={props.onHover} onMouseUp={props.onChoose}>
    <Show when={props.marked}>
      <text fg={color(theme().success)} wrapMode="none" flexShrink={0}>{padToWidth(props.item.current ? CURRENT_MARKER : '', MARKER_WIDTH)}</text>
    </Show>
    <MatchText text={padToWidth(title(), props.titleColumn)} query={props.query} active={props.active} />
    <text fg={color(theme().muted)} wrapMode="none" flexGrow={1}>
      {descriptionWidth() > 1 ? ' '.repeat(TITLE_GAP) + truncate(props.item.description ?? '', descriptionWidth()) : ''}
    </text>
    <Show when={hint()}><text fg={color(theme().muted)} wrapMode="none" flexShrink={0}>{' '.repeat(TITLE_GAP) + hint()}</text></Show>
  </box>;
}

/** Text with the characters that matched the search query emphasized: accent color, or underlined on a selected row. */
export function MatchText(props: { text:string; query:string; active:boolean; color?:string }) {
  const theme = useTheme();
  const runs = createMemo(() => highlightRuns(props.text, matchPositions(props.query, props.text)));
  const plain = () => props.active ? theme().selectionText : props.color ?? theme().text;
  const emphasis = () => props.active ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD;
  return (
    <text wrapMode="none" flexShrink={0} attributes={props.active ? TextAttributes.BOLD : undefined}>
      <For each={runs()}>{run => run.match
        ? <span style={{ fg: props.active ? theme().selectionText : theme().accent, attributes: emphasis() }}>{run.text}</span>
        : <span style={{ fg: plain() }}>{run.text}</span>}
      </For>
    </text>
  );
}

/** Grouped rows while the search box is empty, relevance-ordered flat rows once the user types. */
function rowsFor(items:MenuItem[], filter:string): ListRow<MenuItem>[] {
  if (filter.trim()) {
    return toFlatRows(rankItems(items, filter, item => [[item.title, TITLE_WEIGHT], [item.description, DESCRIPTION_WEIGHT]]));
  }
  return items.some(item => item.group) ? toRows(groupsInOrder(items)) : toFlatRows(items);
}

function groupsInOrder(items:MenuItem[]): ListGroup<MenuItem>[] {
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) groups.set(item.group ?? '', [...(groups.get(item.group ?? '') ?? []), item]);
  return [...groups].map(([label, members]) => ({ label, items: members }));
}

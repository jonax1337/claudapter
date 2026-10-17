// Adapted from OpenCode ui/dialog-select.tsx (MIT); see docs/opencode-provenance.md.
import { For, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth } from './dialog';
import { useTheme } from './theme';
import {
  moveSelection, rankItems, revealStart, rowOfItem, scrollTopToReveal, toFlatRows, toRows, type ListGroup, type ListRow,
} from './list-model';

export interface MenuItem {
  title: string;
  description?: string;
  /** Items sharing a group are listed under one heading while the search box is empty. */
  group?: string;
  /** Right-aligned shortcut label such as `ctrl+t`. */
  hint?: string;
  run(): void | Promise<void>;
}

const ROW_PADDING = 1;
const TITLE_GAP = 2;
const TITLE_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const NAVIGATION_KEYS = ['up', 'down', 'pageup', 'pagedown', 'home', 'end'];

export function Menu(props: { title:string; items:MenuItem[]; onClose():void }) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const contentWidth = useDialogContentWidth();
  const [filter,setFilter] = createSignal('');
  const [selected,setSelected] = createSignal(0);
  const [error,setError] = createSignal('');
  const [busy,setBusy] = createSignal(false);
  let scroll: ScrollBoxRenderable | undefined;
  const rows = createMemo(() => rowsFor(props.items, filter()));
  const options = createMemo(() => rows().flatMap(row => row.kind==='item' ? [row.item] : []));
  const listHeight = () => Math.min(Math.max(rows().length, 1), bodyLimit());
  createEffect(() => { options(); setSelected(0); });
  createEffect(() => keepVisible(selected(), rows()));

  function keepVisible(index:number, current:ListRow<MenuItem>[]) {
    if (!scroll || scroll.isDestroyed) return;
    scroll.scrollTo(scrollTopToReveal(scroll.scrollTop, listHeight(), revealStart(current, index), rowOfItem(current, index)));
  }
  function navigate(key:string) {
    const count = options().length;
    const step: Record<string, number> = { up: -1, down: 1, pageup: -listHeight(), pagedown: listHeight() };
    if (key==='home') setSelected(0);
    else if (key==='end') setSelected(moveSelection(0, count, count));
    else setSelected(index => moveSelection(index, step[key], count));
  }
  async function choose(item:MenuItem|undefined) {
    if (!item || busy()) return;
    setBusy(true);
    try { await item.run(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  const close = () => { if (!busy()) props.onClose(); };
  useKeyboard(event => {
    if (event.name==='escape') { event.preventDefault(); close(); }
    if (NAVIGATION_KEYS.includes(event.name)) { event.preventDefault(); navigate(event.name); }
    if(event.name==='return'){event.preventDefault();void choose(options()[selected()]);}
  });
  const footer = () => busy() ? <text fg={theme().warning}>Working…</text> :
    <KeyHints hints={[['↑↓','select'],['enter','open'],['esc','close']]} />;
  return (
    <Dialog title={props.title} onBackdrop={close} footer={footer()}>
      <box marginTop={1} flexShrink={0} backgroundColor={theme().element} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}>
        <input focused={!busy()} placeholder="Search" textColor={theme().text} focusedTextColor={theme().text}
          backgroundColor={theme().element} focusedBackgroundColor={theme().element} onInput={value=>setFilter(value)} />
      </box>
      <scrollbox ref={scroll} height={listHeight()} marginTop={1} flexShrink={0}>
        <For each={rows()}>{row => row.kind==='header' ?
          <text fg={theme().muted} attributes={TextAttributes.BOLD} height={1} flexShrink={0} paddingLeft={ROW_PADDING}>{row.label}</text> :
          <MenuRow item={row.item} active={row.index===selected()} width={contentWidth()}
            onHover={()=>setSelected(row.index)} onChoose={()=>void choose(row.item)} />
        }</For>
        <Show when={!options().length}><text fg={theme().muted} paddingLeft={ROW_PADDING}>No results found</text></Show>
      </scrollbox>
      <Show when={error()}><text fg={theme().error} marginTop={1}>{error()}</text></Show>
    </Dialog>
  );
}

function MenuRow(props: { item:MenuItem; active:boolean; width:number; onHover():void; onChoose():void }) {
  const theme = useTheme();
  const hint = () => props.item.hint ?? '';
  const descriptionWidth = () => props.width - props.item.title.length - TITLE_GAP * 2 - hint().length - ROW_PADDING * 2;
  const color = (normal:string) => props.active ? theme().background : normal;
  return <box flexDirection="row" gap={TITLE_GAP} height={1} flexShrink={0} paddingLeft={ROW_PADDING} paddingRight={ROW_PADDING}
    backgroundColor={props.active ? theme().accent : undefined} onMouseMove={props.onHover} onMouseUp={props.onChoose}>
    <text fg={color(theme().text)} attributes={props.active ? TextAttributes.BOLD : undefined} wrapMode="none" flexShrink={0}>{props.item.title}</text>
    <text fg={color(theme().muted)} wrapMode="none">{truncate(props.item.description ?? '', descriptionWidth()).padEnd(Math.max(0, descriptionWidth()))}</text>
    <Show when={hint()}><text fg={color(theme().muted)} wrapMode="none" flexShrink={0}>{hint()}</text></Show>
  </box>;
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

function truncate(text:string, width:number) {
  if (width <= 1) return '';
  return text.length > width ? text.slice(0, width - 1) + '…' : text;
}

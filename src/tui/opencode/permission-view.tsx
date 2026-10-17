import { For, Match, Switch } from 'solid-js';
import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { wrappedRows } from './dialog';
import { LABEL_WIDTH, type DisplayRow } from './permission';
import { useTheme } from './theme';

const CODE_PADDING = 1;

/** Rows the permission view needs at `width` columns once long lines wrap. */
export function permissionRowCount(rows: DisplayRow[], width: number) {
  return rows.reduce((total, row) => {
    const available = row.tone === 'label' ? width - LABEL_WIDTH : row.tone === 'plain' || row.tone === 'muted' || row.tone === 'title' ? width : width - CODE_PADDING;
    return total + wrappedRows(row.text, available);
  }, 0);
}

function Row(props: { row: DisplayRow }) {
  const theme = useTheme();
  const row = () => props.row;
  return (
    <Switch>
      <Match when={row().tone === 'title'}>
        <text fg={theme().accent} attributes={TextAttributes.BOLD}>{row().text}</text>
      </Match>
      <Match when={row().tone === 'label'}>
        <box flexDirection="row" flexShrink={0}>
          <box width={LABEL_WIDTH} flexShrink={0}><text fg={theme().muted} wrapMode="none">{row().label}</text></box>
          <box flexGrow={1}><text fg={theme().text}>{row().text}</text></box>
        </box>
      </Match>
      <Match when={row().tone === 'code'}>
        <box backgroundColor={theme().element} paddingLeft={CODE_PADDING} flexShrink={0}><text fg={theme().text}>{row().text}</text></box>
      </Match>
      <Match when={row().tone === 'added'}>
        <box backgroundColor={theme().diffAddedBg} paddingLeft={CODE_PADDING} flexShrink={0}><text fg={theme().diffAdded}>{row().text}</text></box>
      </Match>
      <Match when={row().tone === 'removed'}>
        <box backgroundColor={theme().diffRemovedBg} paddingLeft={CODE_PADDING} flexShrink={0}><text fg={theme().diffRemoved}>{row().text}</text></box>
      </Match>
      <Match when={row().tone === 'muted'}><text fg={theme().muted}>{row().text}</text></Match>
      <Match when={true}><text fg={theme().text}>{row().text}</text></Match>
    </Switch>
  );
}

/** Scrollable, tool-specific rendering of a permission request. */
export function PermissionView(props: { rows: DisplayRow[]; height: number; scrollRef?(box: ScrollBoxRenderable): void }) {
  return (
    <scrollbox ref={props.scrollRef} height={props.height} marginTop={1} flexShrink={0}>
      <For each={props.rows}>{row => <Row row={row} />}</For>
    </scrollbox>
  );
}

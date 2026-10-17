// Adapted from OpenCode ui/dialog.tsx (MIT); see docs/opencode-provenance.md.
import { RGBA, TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, type JSX } from 'solid-js';
import { useTheme } from './theme';

export type DialogSize = 'medium' | 'large';

const DIALOG_WIDTH: Record<DialogSize, number> = { medium: 60, large: 88 };
const BACKDROP = RGBA.fromInts(0, 0, 0, 150);
const SCREEN_MARGIN = 2;
const HORIZONTAL_PADDING = 2;
/** Rows taken by the header, footer and vertical padding around a dialog body. */
const DIALOG_CHROME_ROWS = 7;

const topOffset = (height: number) => Math.floor(height / 4);

/** Rows a dialog body may occupy before it has to scroll. */
export function useDialogBodyLimit() {
  const dimensions = useTerminalDimensions();
  return () => Math.max(3, dimensions().height - topOffset(dimensions().height) - DIALOG_CHROME_ROWS);
}

/** Columns available for content inside a dialog of the given size. */
export function useDialogContentWidth(size: DialogSize = 'medium') {
  const dimensions = useTerminalDimensions();
  return () => Math.min(DIALOG_WIDTH[size], dimensions().width - SCREEN_MARGIN * 2) - HORIZONTAL_PADDING * 2;
}

/** Rows `text` occupies once wrapped to `width` columns; every line takes at least one row. */
export function wrappedRows(text: string, width: number) {
  return text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(1, width))), 0);
}

export interface DialogProps {
  title: string;
  size?: DialogSize;
  footer?: JSX.Element;
  /** Called for backdrop clicks; omitted for decisions that must be answered explicitly. */
  onBackdrop?(): void;
  children: JSX.Element;
}

export function Dialog(props: DialogProps) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const contentWidth = useDialogContentWidth(props.size);
  return (
    <box position="absolute" left={0} top={0} width={dimensions().width} height={dimensions().height} zIndex={3000}
      backgroundColor={BACKDROP} alignItems="center" paddingTop={topOffset(dimensions().height)}
      onMouseUp={() => props.onBackdrop?.()}>
      <box width={contentWidth() + HORIZONTAL_PADDING * 2} backgroundColor={theme().panel}
        paddingLeft={HORIZONTAL_PADDING} paddingRight={HORIZONTAL_PADDING} paddingTop={1} paddingBottom={1}
        onMouseUp={event => event.stopPropagation()}>
        {/* Focus sink: panels without inputs must take focus or the composer editor keeps claiming keys. */}
        <box height={0} width={0} flexShrink={0}>
          <input focused width={0} textColor={theme().panel} focusedTextColor={theme().panel}
            backgroundColor={theme().panel} focusedBackgroundColor={theme().panel} onInput={() => {}} />
        </box>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={theme().text} attributes={TextAttributes.BOLD}>{props.title}</text>
          <text fg={theme().muted}>esc</text>
        </box>
        {props.children}
        <Show when={props.footer}>
          <box flexShrink={0} marginTop={1}>{props.footer}</box>
        </Show>
      </box>
    </box>
  );
}

export type KeyHint = [key: string, label: string];

/** Key hints such as `enter open`: the key in body text, its label muted. */
export function KeyHints(props: { hints: KeyHint[] }) {
  const theme = useTheme();
  return (
    <box flexDirection="row" gap={3} flexShrink={0}>
      <For each={props.hints}>{([key, label]) =>
        <text fg={theme().muted} wrapMode="none">
          <span style={{ fg: theme().text }}>{key}</span> {label}
        </text>
      }</For>
    </box>
  );
}

// Adapted from OpenCode packages/tui/src/routes/home.tsx and component/logo.tsx (MIT).
// Upstream: 07bbd0fd166c82d87e79f053dc70e6fdb66f88ac. See docs/opencode-provenance.md.
import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, type JSX } from 'solid-js';
import { mix, useTheme } from './theme';

/**
 * Block glyphs, four rows each. Markup follows the upstream logo:
 * `_` is a shadow-filled cell, `^` an upper half block over shadow.
 */
const GLYPHS: Record<string, string[]> = {
  a: ['    ', '▀▀▀█', '█▀▀█', '▀▀▀▀'],
  c: ['    ', '█▀▀▀', '█___', '▀▀▀▀'],
  d: ['   ▄', '█▀▀█', '█__█', '▀▀▀▀'],
  e: ['    ', '█▀▀█', '█^^^', '▀▀▀▀'],
  l: ['▄  ', '█  ', '█__', '▀▀▀'],
  p: ['    ', '█▀▀█', '█__█', '█▀▀▀'],
  r: ['    ', '█▀▀▀', '█   ', '▀   '],
  t: ['▄  ', '█▀▀', '█__', '▀▀▀'],
  u: ['    ', '█  █', '█__█', '▀▀▀▀'],
};
const LEFT_WORD = 'claud';
const RIGHT_WORD = 'apter';
const SHADOW_STRENGTH = 0.25;
const SIDE_BY_SIDE_WIDTH = 52;
const STACKED_WIDTH = 28;
const MIN_LOGO_HEIGHT = 16;
const COMPACT_PADDING_WIDTH = 44;

function wordRows(word: string): string[] {
  return GLYPHS.a.map((_, row) => Array.from(word, letter => GLYPHS[letter][row]).join(' '));
}

type Run = { text: string; fg: string; bg?: string };

/** Splits one markup row into runs of equally styled cells. */
function styledRuns(row: string, fg: string, shadow: string): Run[] {
  const cell = (char: string): Run => {
    if (char === '_') return { text: ' ', fg, bg: shadow };
    if (char === '^') return { text: '▀', fg, bg: shadow };
    return { text: char, fg };
  };
  return Array.from(row, cell).reduce<Run[]>((runs, next) => {
    const last = runs.at(-1);
    if (last && last.fg === next.fg && last.bg === next.bg) last.text += next.text;
    else runs.push(next);
    return runs;
  }, []);
}

function LogoRow(props: { row: string; fg: string; bold: boolean }) {
  const theme = useTheme();
  const runs = () => styledRuns(props.row, props.fg, mix(theme().background, props.fg, SHADOW_STRENGTH));
  return (
    <text selectable={false} wrapMode="none" attributes={props.bold ? TextAttributes.BOLD : undefined}>
      <For each={runs()}>{run => <span style={{ fg: run.fg, bg: run.bg }}>{run.text}</span>}</For>
    </text>
  );
}

function Word(props: { word: string; fg: string; bold: boolean }) {
  return <box><For each={wordRows(props.word)}>{row => <LogoRow row={row} fg={props.fg} bold={props.bold} />}</For></box>;
}

export function Logo() {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const tall = () => dimensions().height >= MIN_LOGO_HEIGHT;
  const left = () => <Word word={LEFT_WORD} fg={theme().muted} bold={false} />;
  const right = () => <Word word={RIGHT_WORD} fg={theme().text} bold={true} />;
  return (
    <box alignItems="center" flexShrink={0}>
      <Show when={tall() && dimensions().width >= STACKED_WIDTH} fallback={
        <text attributes={TextAttributes.BOLD}><span style={{ fg: theme().muted }}>{LEFT_WORD}</span>{RIGHT_WORD}</text>
      }>
        <Show when={dimensions().width >= SIDE_BY_SIDE_WIDTH} fallback={<box alignItems="center">{left()}{right()}</box>}>
          <box flexDirection="row" gap={1}>{left()}{right()}</box>
        </Show>
      </Show>
      <box height={1} />
      <text fg={theme().muted}>
        Your Claude Code. <span style={{ fg: theme().accent }}>Your choice of models.</span>
      </text>
    </box>
  );
}

export interface HomeProps {
  logo: JSX.Element;
  prompt: JSX.Element;
  footer: JSX.Element;
}

export function Home(props: HomeProps) {
  const dimensions = useTerminalDimensions();
  const padding = () => dimensions().width < COMPACT_PADDING_WIDTH ? 1 : 2;
  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={padding()} paddingRight={padding()}>
        <box flexGrow={1} minHeight={0} />
        <box flexShrink={0}>{props.logo}</box>
        <box height={2} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={75} zIndex={1000} flexShrink={0} position="relative">
          {props.prompt}
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0} paddingLeft={padding()} paddingRight={padding()}>{props.footer}</box>
    </>
  );
}

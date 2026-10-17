// Adapted from OpenCode packages/tui/src/routes/home.tsx and component/logo.tsx (MIT).
// Upstream: 07bbd0fd166c82d87e79f053dc70e6fdb66f88ac. See docs/opencode-provenance.md.
import { TextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, createResource, type JSX } from 'solid-js';
import { RECENT_SESSION_LIMIT, providerSummaries, recentSessions, type ProviderSummary } from './home-model';
import { textWidth, truncate } from './layout';
import { relativeTime, sessionTitle, type SessionInfo } from './sessions-model';
import { mix, providerColor, providerLabel, useTheme } from './theme';

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
const PROMPT_MAX_WIDTH = 75;
/** Terminal rows needed before the overview shows provider chips, and additionally the recent sessions. */
const PROVIDERS_MIN_HEIGHT = 22;
const RECENT_MIN_HEIGHT = 32;
const CHIP_GAP = 3;
const TIME_COLUMN = 9;
const READY_MARK = '●';
const SIGN_IN_MARK = '○';

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
  /** Provider chips and recent sessions below the prompt. */
  overview?: JSX.Element;
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
        <box width="100%" maxWidth={PROMPT_MAX_WIDTH} zIndex={1000} flexShrink={0} position="relative">
          {props.prompt}
        </box>
        <Show when={props.overview}>
          <box width="100%" maxWidth={PROMPT_MAX_WIDTH} flexShrink={0}>{props.overview}</box>
        </Show>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0} paddingLeft={padding()} paddingRight={padding()}>{props.footer}</box>
    </>
  );
}

export interface HomeOverviewProps {
  models: { provider: string; auth?: string }[];
  /** Loads saved sessions of this directory; without it the recent list is not offered. */
  loadSessions?(): Promise<SessionInfo[]>;
  currentId?: string;
  now?(): number;
  onResume(sessionId: string): void;
}

/**
 * Which providers are usable and where the user left off. Every section keeps a fixed height once the terminal is
 * tall enough, so neither loading nor a resize shifts the prompt.
 */
export function HomeOverview(props: HomeOverviewProps) {
  const dimensions = useTerminalDimensions();
  const summaries = () => providerSummaries(props.models);
  return (
    <box flexShrink={0}>
      <Show when={dimensions().height >= PROVIDERS_MIN_HEIGHT && summaries().length}>
        <ProviderChips summaries={summaries()} />
      </Show>
      <Show when={props.loadSessions && dimensions().height >= RECENT_MIN_HEIGHT}>
        <RecentSessions load={props.loadSessions!} currentId={props.currentId} now={props.now?.() ?? Date.now()}
          width={Math.min(PROMPT_MAX_WIDTH, dimensions().width - 4)} onResume={props.onResume} />
      </Show>
    </box>
  );
}

function ProviderChips(props: { summaries: ProviderSummary[] }) {
  const theme = useTheme();
  return (
    <box flexDirection="row" justifyContent="center" gap={CHIP_GAP} height={1} marginTop={1} flexShrink={0}>
      <For each={props.summaries}>{summary =>
        <text wrapMode="none">
          <span style={{ fg: summary.needsSignIn ? theme().warning : providerColor(theme(), summary.provider) }}>
            {(summary.needsSignIn ? SIGN_IN_MARK : READY_MARK) + ' '}
          </span>
          <span style={{ fg: summary.needsSignIn ? theme().muted : theme().text }}>{providerLabel(summary.provider)}</span>
          <Show when={summary.needsSignIn}><span style={{ fg: theme().warning }}>{' · sign in'}</span></Show>
        </text>
      }</For>
    </box>
  );
}

interface RecentSessionsProps { load(): Promise<SessionInfo[]>; currentId?: string; now: number; width: number; onResume(id: string): void }

function RecentSessions(props: RecentSessionsProps) {
  const theme = useTheme();
  const [sessions] = createResource(async () => recentSessions(await props.load(), props.currentId));
  const placeholder = () => sessions.error ? 'Saved sessions could not be listed.'
    : sessions.loading ? '' : 'No earlier sessions here yet; your first prompt starts one.';
  return (
    <box marginTop={1} height={1 + RECENT_SESSION_LIMIT} flexShrink={0}>
      <text fg={theme().muted} wrapMode="none">
        Recent<span style={{ fg: theme().border }}>{'  ·  '}</span>/resume for all
      </text>
      <Show when={!sessions.error && sessions()?.length} fallback={<text fg={theme().muted} wrapMode="none">{placeholder()}</text>}>
        <For each={sessions()}>{session =>
          <RecentSessionRow session={session} now={props.now} width={props.width} onResume={props.onResume} />}
        </For>
      </Show>
    </box>
  );
}

function RecentSessionRow(props: { session: SessionInfo; now: number; width: number; onResume(id: string): void }) {
  const theme = useTheme();
  const age = () => relativeTime(props.session.lastModified, props.now);
  const title = () => truncate(sessionTitle(props.session), props.width - TIME_COLUMN - 2);
  return (
    <box flexDirection="row" height={1} flexShrink={0} onMouseUp={() => props.onResume(props.session.sessionId)}>
      <text fg={theme().text} wrapMode="none">{'› ' + title()}</text>
      <box flexGrow={1} />
      <text fg={theme().muted} wrapMode="none">{age().padStart(Math.max(textWidth(age()), TIME_COLUMN))}</text>
    </box>
  );
}

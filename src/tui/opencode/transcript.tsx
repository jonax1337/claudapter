// Message layout adapted from OpenCode routes/session/{index,message-parts}.tsx (MIT, see docs/opencode-provenance.md).
import { For, Match, Show, Switch, createMemo, type JSX } from 'solid-js';
import { SyntaxStyle, TextAttributes } from '@opentui/core';
import { useRenderer } from '@opentui/solid';
import { SPLIT_BORDER, ToolView, indentFor, toolSummary, type TranscriptEntry } from './tool-views';
import { useTheme, type Theme } from './theme';

export { toolSummary, type TranscriptEntry };

const AGENT_RULE = { ...SPLIT_BORDER, vertical: '│' };
const AGENT_INDENT = 2;
const THOUGHT_NOTE = '(content not provided by the model)';

function markdownStyle(theme: Theme, base: string) {
  return {
    default: { fg: base },
    'markup.heading': { fg: theme.accent, bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.strikethrough': { dim: true },
    'markup.raw': { fg: theme.secondary },
    'markup.raw.block': { fg: theme.secondary },
    'markup.link': { fg: theme.secondary },
    'markup.link.label': { fg: theme.secondary, underline: true },
    'markup.link.url': { fg: theme.muted, underline: true },
    'markup.quote': { fg: theme.muted, italic: true },
    'markup.list': { fg: theme.accent },
  };
}

function formatTokens(count: number): string {
  return count < 1000 ? String(count) : (count / 1000).toFixed(1) + 'K';
}

function tokenNote(entry: TranscriptEntry): string {
  return entry.thinkingTokens ? ` · ~${formatTokens(entry.thinkingTokens)} tokens` : '';
}

/** Thinking entries only appear while the toggle is on; empty assistant entries never produce a blank row. */
export function isRenderable(entry: TranscriptEntry, showThinking: boolean): boolean {
  if (entry.kind === 'thinking') return showThinking;
  return entry.kind !== 'assistant' || entry.text.trim() !== '';
}

function UserMessage(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  return (
    <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={theme().accent}
      backgroundColor={theme().panel} paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
      <text fg={theme().text}>{props.entry.text}</text>
    </box>
  );
}

function AssistantMessage(props: { entry: TranscriptEntry; streaming: boolean; style: SyntaxStyle }) {
  const theme = useTheme();
  return (
    <Show when={props.entry.text.trim()}>
      <box paddingLeft={indentFor(props.entry)} flexShrink={0} width="100%">
        <markdown syntaxStyle={props.style} content={props.entry.text.trim()} streaming={props.streaming}
          internalBlockMode="top-level" tableOptions={{ style: 'grid', cellPaddingX: 1 }} conceal
          fg={props.entry.agent ? theme().muted : theme().text} />
      </box>
    </Show>
  );
}

function ThinkingMessage(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  const hasText = () => !props.entry.redacted && props.entry.text.trim() !== '';
  return (
    <box paddingLeft={indentFor(props.entry)} flexShrink={0}>
      <Show when={hasText()} fallback={
        <text fg={theme().muted}>{`◌ Thought${tokenNote(props.entry)} ${THOUGHT_NOTE}`}</text>
      }>
        <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={theme().border} paddingLeft={1}>
          <text fg={theme().warning} attributes={TextAttributes.ITALIC}>{'Thinking' + tokenNote(props.entry)}</text>
          <text fg={theme().muted} attributes={TextAttributes.ITALIC}>{props.entry.text}</text>
        </box>
      </Show>
    </box>
  );
}

function ErrorMessage(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  return (
    <box paddingLeft={indentFor(props.entry)} flexShrink={0}>
      <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={theme().error} paddingLeft={1}>
        <text fg={theme().error}>{props.entry.text}</text>
      </box>
    </box>
  );
}

function NoticeMessage(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  return (
    <box width="100%" alignItems="center" flexShrink={0}>
      <text fg={theme().muted}>{props.entry.text}</text>
    </box>
  );
}

/** Sets sub-agent output apart from the main thread with a dim rule and, on the first entry of a run, the agent name. */
function AgentFrame(props: { agent?: string; labelled: boolean; children: JSX.Element }) {
  const theme = useTheme();
  return (
    <Show when={props.agent} fallback={props.children}>
      <box marginLeft={AGENT_INDENT} border={['left']} customBorderChars={AGENT_RULE} borderColor={theme().border} paddingLeft={1} flexShrink={0}>
        <Show when={props.labelled}><text fg={theme().muted}>{props.agent}</text></Show>
        {props.children}
      </box>
    </Show>
  );
}

export function Transcript(props: { entries: TranscriptEntry[]; busy: boolean; thinking: boolean; details: boolean }) {
  const renderer = useRenderer();
  const theme = useTheme();
  const style = createMemo<SyntaxStyle>(previous => {
    if (previous) void renderer.idle().then(() => previous.destroy());
    return SyntaxStyle.fromStyles(markdownStyle(theme(), theme().text), renderer.nativeScene);
  });
  const hasAgentText = createMemo(() => props.entries.some(entry => entry.agent && entry.kind === 'assistant'));
  const mutedStyle = createMemo<SyntaxStyle | undefined>(previous => {
    if (previous) void renderer.idle().then(() => previous.destroy());
    return hasAgentText() ? SyntaxStyle.fromStyles(markdownStyle(theme(), theme().muted), renderer.nativeScene) : undefined;
  });
  const visible = createMemo(() => props.entries.filter(entry => isRenderable(entry, props.thinking)));
  const isStreaming = (entry: TranscriptEntry) => props.busy && entry.id === props.entries[props.entries.length - 1]?.id;
  const startsAgentRun = (entry: TranscriptEntry, index: number) => visible()[index - 1]?.agent !== entry.agent;
  return (
    <For each={visible()}>
      {(entry, index) => (
        <box flexShrink={0} marginTop={1} width="100%">
          <AgentFrame agent={entry.agent} labelled={startsAgentRun(entry, index())}>
            <Switch fallback={<AssistantMessage entry={entry} streaming={isStreaming(entry)} style={(entry.agent && mutedStyle()) || style()} />}>
              <Match when={entry.kind === 'user'}><UserMessage entry={entry} /></Match>
              <Match when={entry.kind === 'thinking'}><ThinkingMessage entry={entry} /></Match>
              <Match when={entry.kind === 'tool'}><ToolView entry={entry} expanded={props.details} /></Match>
              <Match when={entry.kind === 'error'}><ErrorMessage entry={entry} /></Match>
              <Match when={entry.kind === 'notice'}><NoticeMessage entry={entry} /></Match>
            </Switch>
          </AgentFrame>
        </box>
      )}
    </For>
  );
}

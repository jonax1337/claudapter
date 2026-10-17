// Message layout adapted from OpenCode routes/session/{index,message-parts}.tsx (MIT, see docs/opencode-provenance.md).
import { For, Index, Match, Show, Switch, createMemo, type JSX } from 'solid-js';
import { TextAttributes } from '@opentui/core';
import { CodeBlock } from './block-code';
import { ImageList } from './block-image';
import { PermissionRow } from './block-permission';
import { useSyntaxStyle } from './block-syntax';
import { splitFences } from './markdown-blocks';
import { SPLIT_BORDER, ToolView, indentFor, summarizeInput, toolSummary, type TranscriptEntry } from './tool-views';
import { useTheme } from './theme';

export { toolSummary, type TranscriptEntry };

const AGENT_RULE = { ...SPLIT_BORDER, vertical: '│' };
const AGENT_INDENT = 2;
const THOUGHT_NOTE = '(content not provided by the model)';

/**
 * Extension points for features that add to the transcript without editing the renderers. Every hook is
 * optional and called per entry:
 * - `entryFooter` renders under an entry (for example a route badge or turn footer under an assistant entry);
 * - `taskCall` replaces the default launch card of a sub-agent or workflow tool call (compact agent summary row);
 * - `hide` removes an entry from the main thread (for example sub-agent stream content).
 */
export interface TranscriptSlots {
  entryFooter?(entry: TranscriptEntry): JSX.Element | undefined;
  taskCall?(entry: TranscriptEntry): JSX.Element | undefined;
  hide?(entry: TranscriptEntry): boolean;
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
  if (entry.kind === 'permission') return !!entry.permission;
  if (entry.kind === 'user') return entry.text.trim() !== '' || !!entry.images?.length;
  return entry.kind !== 'assistant' || entry.text.trim() !== '';
}

function UserMessage(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  return (
    <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={theme().accent}
      backgroundColor={theme().panel} paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
      <Show when={props.entry.text.trim()}><text fg={theme().text}>{props.entry.text}</text></Show>
      <Show when={props.entry.images?.length}><ImageList images={props.entry.images!} /></Show>
    </box>
  );
}

function AssistantMessage(props: { entry: TranscriptEntry; streaming: boolean }) {
  const theme = useTheme();
  const style = useSyntaxStyle('text');
  const mutedStyle = useSyntaxStyle('muted');
  const blocks = createMemo(() => splitFences(props.entry.text.trim()));
  const isLast = (index: number) => index === blocks().length - 1;
  return (
    <Show when={props.entry.text.trim()}>
      <box paddingLeft={indentFor(props.entry)} flexShrink={0} width="100%">
        <Index each={blocks()}>
          {(block, index) => (
            <Show when={block().kind === 'code'} fallback={
              <markdown syntaxStyle={props.entry.agent ? mutedStyle() : style()} content={block().text}
                streaming={props.streaming && isLast(index)} internalBlockMode="top-level"
                tableOptions={{ style: 'grid', widthMode: 'content', cellPaddingX: 1 }} conceal fg={props.entry.agent ? theme().muted : theme().text} />
            }>
              <CodeBlock code={block().text} language={(block() as { language: string }).language} streaming={props.streaming && isLast(index)} />
            </Show>
          )}
        </Index>
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

function PermissionMessage(props: { entry: TranscriptEntry }) {
  return (
    <PermissionRow permission={props.entry.permission!} toolName={props.entry.toolName ?? props.entry.text}
      subject={summarizeInput(props.entry.input ?? {})} indent={indentFor(props.entry)} />
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

export function Transcript(props: { entries: TranscriptEntry[]; busy: boolean; thinking: boolean; details: boolean; slots?: TranscriptSlots }) {
  const visible = createMemo(() => props.entries.filter(entry => isRenderable(entry, props.thinking) && !props.slots?.hide?.(entry)));
  const isStreaming = (entry: TranscriptEntry) => props.busy && entry.id === props.entries[props.entries.length - 1]?.id;
  const startsAgentRun = (entry: TranscriptEntry, index: number) => visible()[index - 1]?.agent !== entry.agent;
  return (
    <For each={visible()}>
      {(entry, index) => (
        <box flexShrink={0} marginTop={1} width="100%">
          <AgentFrame agent={entry.agent} labelled={startsAgentRun(entry, index())}>
            <Switch fallback={<AssistantMessage entry={entry} streaming={isStreaming(entry)} />}>
              <Match when={entry.kind === 'user'}><UserMessage entry={entry} /></Match>
              <Match when={entry.kind === 'thinking'}><ThinkingMessage entry={entry} /></Match>
              <Match when={entry.kind === 'tool'}><ToolView entry={entry} expanded={props.details} taskCard={props.slots?.taskCall} /></Match>
              <Match when={entry.kind === 'permission'}><PermissionMessage entry={entry} /></Match>
              <Match when={entry.kind === 'error'}><ErrorMessage entry={entry} /></Match>
              <Match when={entry.kind === 'notice'}><NoticeMessage entry={entry} /></Match>
            </Switch>
            {props.slots?.entryFooter?.(entry)}
          </AgentFrame>
        </box>
      )}
    </For>
  );
}

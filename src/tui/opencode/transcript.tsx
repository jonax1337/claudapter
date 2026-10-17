// Message layout adapted from OpenCode routes/session/{index,message-parts}.tsx (MIT, see docs/opencode-provenance.md).
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup } from 'solid-js';
import { SyntaxStyle } from '@opentui/core';
import { useRenderer } from '@opentui/solid';

export type TranscriptEntry = { id: string; kind: string; text: string; details?: string; toolName?: string; status?: string; agent?: string };

const SPLIT_BORDER = { topLeft: '', bottomLeft: '', vertical: '┃', topRight: '', bottomRight: '', horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '' };
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SUMMARY_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];
const SUMMARY_LIMIT = 90;
const COLORS = { raised: '#1c1c22', text: '#eeeeee', muted: '#8b8b96', warning: '#e5c07b', error: '#ff7777', success: '#7ee787', code: '#7dd3fc' };

/** One-line description of a tool call, taken from the first recognised input field. */
export function toolSummary(details: string | undefined): string {
  const input = parseInput(details);
  const key = SUMMARY_KEYS.find(candidate => typeof input[candidate] === 'string');
  const value = key ? String(input[key]).replace(/\s+/g, ' ').trim() : '';
  return value.length > SUMMARY_LIMIT ? value.slice(0, SUMMARY_LIMIT - 1) + '…' : value;
}

function parseInput(details: string | undefined): Record<string, unknown> {
  const jsonPart = details?.split('\n\n')[0] ?? '';
  try {
    const parsed = JSON.parse(jsonPart);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markdownStyle(accent: string) {
  return {
    default: { fg: COLORS.text },
    'markup.heading': { fg: accent, bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.strikethrough': { dim: true },
    'markup.raw': { fg: COLORS.code },
    'markup.raw.block': { fg: COLORS.code },
    'markup.link': { fg: COLORS.code },
    'markup.link.label': { fg: COLORS.code, underline: true },
    'markup.link.url': { fg: COLORS.muted, underline: true },
    'markup.quote': { fg: COLORS.muted, italic: true },
    'markup.list': { fg: accent },
  };
}

function Spinner(props: { color: string; children: string }) {
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame(value => (value + 1) % SPINNER_FRAMES.length), 90);
  onCleanup(() => clearInterval(timer));
  return <text fg={props.color}>{SPINNER_FRAMES[frame()]} {props.children}</text>;
}

function UserMessage(props: { entry: TranscriptEntry; accent: string }) {
  return (
    <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={props.accent}
      backgroundColor={COLORS.raised} paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
      <text fg={COLORS.text}>{props.entry.text}</text>
    </box>
  );
}

function AssistantMessage(props: { entry: TranscriptEntry; streaming: boolean; style: SyntaxStyle }) {
  return (
    <Show when={props.entry.text.trim()}>
      <box paddingLeft={3} flexShrink={0} width="100%">
        <markdown syntaxStyle={props.style} content={props.entry.text.trim()} streaming={props.streaming}
          internalBlockMode="top-level" tableOptions={{ style: 'grid', cellPaddingX: 1 }} conceal fg={COLORS.text} />
      </box>
    </Show>
  );
}

function ThinkingMessage(props: { entry: TranscriptEntry }) {
  return (
    <box paddingLeft={3} flexShrink={0}>
      <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={COLORS.raised} paddingLeft={1}>
        <text fg={COLORS.warning}>Thinking</text>
        <text fg={COLORS.muted}>{props.entry.text}</text>
      </box>
    </box>
  );
}

function ToolMessage(props: { entry: TranscriptEntry; expanded: boolean }) {
  const summary = createMemo(() => toolSummary(props.entry.details));
  const label = () => [props.entry.agent ? '[' + props.entry.agent + ']' : '', props.entry.toolName ?? props.entry.text, summary()].filter(Boolean).join(' ');
  return (
    <box paddingLeft={3} flexShrink={0}>
      <Switch>
        <Match when={props.entry.status === 'error'}><text fg={COLORS.error}>✗ {label()}</text></Match>
        <Match when={props.entry.status === 'done'}><text fg={COLORS.muted}><span style={{ fg: COLORS.success }}>✓ </span>{label()}</text></Match>
        <Match when={true}><Spinner color={COLORS.warning}>{label()}</Spinner></Match>
      </Switch>
      <Show when={props.expanded && props.entry.details}>
        <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={COLORS.raised} backgroundColor={COLORS.raised}
          marginTop={1} paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
          <text fg={COLORS.muted}>{props.entry.details}</text>
        </box>
      </Show>
    </box>
  );
}

function ErrorMessage(props: { entry: TranscriptEntry }) {
  return (
    <box paddingLeft={3} flexShrink={0}>
      <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={COLORS.error} paddingLeft={1}>
        <text fg={COLORS.error}>{props.entry.text}</text>
      </box>
    </box>
  );
}

export function Transcript(props: { entries: TranscriptEntry[]; busy: boolean; accent: string; thinking: boolean; details: boolean }) {
  const renderer = useRenderer();
  const style = createMemo<SyntaxStyle>(previous => {
    if (previous) void renderer.idle().then(() => previous.destroy());
    return SyntaxStyle.fromStyles(markdownStyle(props.accent), renderer.nativeScene);
  });
  const visible = () => props.entries.filter(entry => props.thinking || entry.kind !== 'thinking');
  const isStreaming = (entry: TranscriptEntry) => props.busy && entry.id === props.entries[props.entries.length - 1]?.id;
  return (
    <For each={visible()}>
      {entry => (
        <box flexShrink={0} marginTop={1} width="100%">
          <Switch fallback={<AssistantMessage entry={entry} streaming={isStreaming(entry)} style={style()} />}>
            <Match when={entry.kind === 'user'}><UserMessage entry={entry} accent={props.accent} /></Match>
            <Match when={entry.kind === 'thinking'}><ThinkingMessage entry={entry} /></Match>
            <Match when={entry.kind === 'tool'}><ToolMessage entry={entry} expanded={props.details} /></Match>
            <Match when={entry.kind === 'error'}><ErrorMessage entry={entry} /></Match>
          </Switch>
        </box>
      )}
    </For>
  );
}

import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { DiffView, fileDiffFor } from './diff';
import { Spinner } from './status';
import { useTheme } from './theme';

export type TranscriptEntry = {
  id: string; kind: string; text: string; details?: string; toolName?: string; status?: string; agent?: string;
  input?: Record<string, unknown>; output?: string; isError?: boolean; taskId?: string;
  thinkingTokens?: number; redacted?: boolean; elapsedMs?: number; result?: unknown;
};

type Fields = Record<string, unknown>;

export const SPLIT_BORDER = { topLeft: '', bottomLeft: '', vertical: '┃', topRight: '', bottomRight: '', horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '' };
const SUMMARY_KEYS = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];
const SUMMARY_LIMIT = 90;
const GIST_LIMIT = 100;
const BASH_TAIL_LINES = 12;
const SEARCH_PREVIEW_LINES = 5;
const ERROR_PREVIEW_LINES = 5;
const PROMPT_PREVIEW_LINES = 12;
const MAIN_INDENT = 3;
const NESTED_INDENT = 1;
const TASK_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** Leading glyph per tool, following the upstream inline tool rows. */
const TOOL_ICONS: Record<string, string> = { Read: '→', Write: '←', Edit: '←', MultiEdit: '←', NotebookEdit: '←', Bash: '$',
  Grep: '✱', Glob: '✱', WebFetch: '%', WebSearch: '◈', Task: '◉', Agent: '◉', Workflow: '◉', TodoWrite: '☐' };
const DEFAULT_TOOL_ICON = '⚙';
const TODO_GLYPHS: Record<string, string> = { completed: '☑', in_progress: '◐', pending: '☐' };

/** Left padding of a transcript entry; sub-agent entries sit closer to their attribution rule. */
export function indentFor(entry: TranscriptEntry): number {
  return entry.agent ? NESTED_INDENT : MAIN_INDENT;
}

function clip(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
}

/** One-line description of a tool call, taken from the first recognised input field. */
export function toolSummary(details: string | undefined): string {
  return summarizeInput(parseInput(details));
}

export function summarizeInput(input: Fields): string {
  const key = SUMMARY_KEYS.find(candidate => typeof input[candidate] === 'string');
  return key ? clip(String(input[key]), SUMMARY_LIMIT) : '';
}

function parseInput(details: string | undefined): Fields {
  const jsonPart = details?.split('\n\n')[0] ?? '';
  try {
    const parsed = JSON.parse(jsonPart);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Parsed tool input; falls back to the legacy `details` JSON when the controller sent no structured input. */
export function toolInput(entry: TranscriptEntry): Fields {
  return entry.input ?? parseInput(entry.details);
}

/** Tool result text; falls back to the part of the legacy `details` after the input JSON. */
export function toolOutput(entry: TranscriptEntry): string {
  if (typeof entry.output === 'string') return entry.output;
  const separator = entry.details?.indexOf('\n\n') ?? -1;
  return separator < 0 ? '' : entry.details!.slice(separator + 2);
}

export function toolNameOf(entry: TranscriptEntry): string {
  return entry.toolName ?? entry.text;
}

export function isTaskCall(entry: TranscriptEntry): boolean {
  return !!entry.taskId || TASK_TOOLS.has(toolNameOf(entry));
}

export function isFailed(entry: TranscriptEntry): boolean {
  return entry.status === 'error' || entry.isError === true;
}

export function outputLines(text: string): string[] {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? trimmed.split('\n') : [];
}

/** Last `max` lines (or all when `expanded`) together with the number of hidden earlier lines. */
export function tailLines(text: string, max: number, expanded = false) {
  const lines = outputLines(text);
  const hidden = expanded ? 0 : Math.max(0, lines.length - max);
  return { shown: lines.slice(hidden), hidden };
}

/** First `max` lines (or all when `expanded`) together with the number of hidden later lines. */
export function headLines(text: string, max: number, expanded = false) {
  const lines = outputLines(text);
  const shown = expanded ? lines : lines.slice(0, max);
  return { shown, hidden: lines.length - shown.length };
}

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function plural(count: number, noun: string, pluralNoun = noun + 's'): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

function resultCount(name: string, input: Fields, output: string): string | undefined {
  const lines = outputLines(output);
  if (!lines.length) return undefined;
  if (name === 'Read') return plural(lines.length, 'line');
  const none = /^no (matches|files)/i.test(lines[0]);
  if (name === 'Glob') return plural(none ? 0 : lines.length, 'file');
  if (name !== 'Grep') return undefined;
  const count = none ? 0 : lines.length;
  return input.output_mode === 'content' ? plural(count, 'match', 'matches') : plural(count, 'file');
}

/** Exit code that Bash reports as the first line of a failed result ("Exit code 1"). */
export function exitCodeOf(output: string): number | undefined {
  const match = /^Exit code (\d+)/.exec(output);
  return match ? Number(match[1]) : undefined;
}

/** Text appended to a tool row: result count, exit status, elapsed time. */
export function rowSuffix(entry: TranscriptEntry): string {
  const name = toolNameOf(entry);
  const output = toolOutput(entry);
  const finished = entry.status === 'done' || isFailed(entry);
  const parts = [
    finished ? resultCount(name, toolInput(entry), output) : undefined,
    name === 'Bash' && isFailed(entry) ? exitLabel(output) : undefined,
    finished && entry.elapsedMs !== undefined ? formatElapsed(entry.elapsedMs) : undefined,
  ].filter(Boolean);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

function exitLabel(output: string): string | undefined {
  const code = exitCodeOf(output);
  return code === undefined ? undefined : `exit ${code}`;
}

function rowSummary(entry: TranscriptEntry): string {
  const input = toolInput(entry);
  if (toolNameOf(entry) === 'TodoWrite' && Array.isArray(input.todos)) return plural(input.todos.length, 'todo');
  return summarizeInput(input);
}

function firstLine(value: unknown, limit: number): string {
  return typeof value === 'string' ? clip(value.split('\n').find(line => line.trim()) ?? '', limit) : '';
}

function MoreLines(props: { count: number }) {
  const theme = useTheme();
  return <Show when={props.count > 0}><text fg={theme().muted}>{`… ${props.count} more lines (ctrl+o to expand)`}</text></Show>;
}

/** Output panel; `tail` keeps the end of the text (command output), otherwise the start. */
function OutputBlock(props: { text: string; max: number; expanded: boolean; tail?: boolean; color?: string; bar?: string }) {
  const theme = useTheme();
  const view = createMemo(() => (props.tail ? tailLines : headLines)(props.text, props.max, props.expanded));
  return (
    <Show when={view().shown.length}>
      <box border={['left']} customBorderChars={SPLIT_BORDER} borderColor={props.bar ?? theme().border} backgroundColor={theme().panel}
        marginTop={1} paddingLeft={2} flexShrink={0}>
        <MoreLines count={view().hidden} />
        <text fg={props.color ?? theme().muted}>{view().shown.join('\n')}</text>
      </box>
    </Show>
  );
}

function Checklist(props: { todos: Fields[] }) {
  const theme = useTheme();
  const label = (todo: Fields) => String(todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content ?? '');
  const color = (todo: Fields) => todo.status === 'completed' ? theme().muted : todo.status === 'in_progress' ? theme().warning : theme().text;
  return (
    <box paddingLeft={2} flexShrink={0}>
      <For each={props.todos}>
        {todo => <text fg={color(todo)}>{(TODO_GLYPHS[String(todo.status)] ?? TODO_GLYPHS.pending) + ' ' + label(todo)}</text>}
      </For>
    </box>
  );
}

function todosOf(input: Fields): Fields[] {
  return Array.isArray(input.todos) ? input.todos.filter((todo): todo is Fields => !!todo && typeof todo === 'object') : [];
}

function Gist(props: { output: string }) {
  const theme = useTheme();
  const line = () => firstLine(props.output, GIST_LIMIT);
  return <Show when={line()}><text fg={theme().muted}>{'  └ ' + line()}</text></Show>;
}

function ToolBody(props: { entry: TranscriptEntry; input: Fields; output: string; expanded: boolean }) {
  const theme = useTheme();
  const name = () => toolNameOf(props.entry);
  const diff = createMemo(() => EDIT_TOOLS.has(name()) ? fileDiffFor(name(), props.input, props.entry.result) : undefined);
  return (
    <Switch>
      <Match when={isFailed(props.entry)}>
        <OutputBlock text={props.output} max={ERROR_PREVIEW_LINES} expanded={props.expanded} color={theme().error} bar={theme().error} />
      </Match>
      <Match when={diff()}>{shown => <DiffView diff={shown()} expanded={props.expanded} />}</Match>
      <Match when={name() === 'Bash'}>
        <OutputBlock text={props.output} max={BASH_TAIL_LINES} expanded={props.expanded} tail />
      </Match>
      <Match when={name() === 'Read'}>
        <Show when={props.expanded}><OutputBlock text={props.output} max={0} expanded /></Show>
      </Match>
      <Match when={name() === 'Grep' || name() === 'Glob'}>
        <OutputBlock text={props.output} max={SEARCH_PREVIEW_LINES} expanded={props.expanded} />
      </Match>
      <Match when={name() === 'WebFetch' || name() === 'WebSearch'}>
        <Show when={props.expanded} fallback={<Gist output={props.output} />}><OutputBlock text={props.output} max={0} expanded /></Show>
      </Match>
      <Match when={name() === 'TodoWrite'}><Checklist todos={todosOf(props.input)} /></Match>
      <Match when={props.expanded && props.entry.details && !EDIT_TOOLS.has(name())}>
        <OutputBlock text={props.entry.details!} max={0} expanded />
      </Match>
    </Switch>
  );
}

function StatusGlyph(props: { entry: TranscriptEntry }) {
  const theme = useTheme();
  const finished = () => props.entry.status === 'done' || isFailed(props.entry);
  return (
    <Show when={finished()} fallback={<Spinner color={theme().warning} />}>
      <text fg={isFailed(props.entry) ? theme().error : theme().success}>{isFailed(props.entry) ? '✗' : '✓'}</text>
    </Show>
  );
}

/** Subagent/workflow launch card. The live task tree belongs to the tasks panel; this shows what the entry itself knows. */
export function TaskCallCard(props: { entry: TranscriptEntry; expanded?: boolean }) {
  const theme = useTheme();
  const input = createMemo(() => toolInput(props.entry));
  const name = () => {
    const fields = input();
    const named = props.entry.toolName === 'Workflow' ? fields.workflow ?? fields.name ?? fields.script : fields.subagent_type;
    return typeof named === 'string' && named ? named : toolNameOf(props.entry);
  };
  const description = () => typeof input().description === 'string' ? clip(input().description as string, SUMMARY_LIMIT) : '';
  const prompt = createMemo(() => typeof input().prompt === 'string' ? input().prompt as string : '');
  const promptView = () => headLines(prompt(), props.expanded ? PROMPT_PREVIEW_LINES : 1);
  const failed = () => isFailed(props.entry);
  return (
    <box paddingLeft={indentFor(props.entry)} flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <text fg={failed() ? theme().error : theme().secondary} flexShrink={1}>
          {'◉ '}<span style={{ fg: theme().text }}>{name()}</span>{description() ? ' — ' + description() : ''}
        </text>
        <StatusGlyph entry={props.entry} />
      </box>
      <Show when={promptView().shown.length}>
        <text fg={theme().muted}>{promptView().shown.map(line => '  ' + clip(line, props.expanded ? Infinity : GIST_LIMIT)).join('\n')}</text>
      </Show>
      <Show when={failed() || props.expanded}>
        <OutputBlock text={toolOutput(props.entry)} max={ERROR_PREVIEW_LINES} expanded={!!props.expanded}
          color={failed() ? theme().error : undefined} bar={failed() ? theme().error : undefined} />
      </Show>
    </box>
  );
}

/** Compact tool row (icon, name, summary) with the tool specific result view beneath it. */
export function ToolView(props: { entry: TranscriptEntry; expanded: boolean }) {
  const theme = useTheme();
  const input = createMemo(() => toolInput(props.entry));
  const output = createMemo(() => toolOutput(props.entry));
  const name = () => toolNameOf(props.entry);
  const failed = () => isFailed(props.entry);
  const finished = () => props.entry.status === 'done' || failed();
  return (
    <Show when={!isTaskCall(props.entry)} fallback={<TaskCallCard entry={props.entry} expanded={props.expanded} />}>
      <box paddingLeft={indentFor(props.entry)} flexShrink={0}>
        <box flexDirection="row" gap={1}>
          <Show when={finished()} fallback={<Spinner color={theme().warning} />}>
            <text fg={failed() ? theme().error : theme().accent}>{failed() ? '✗' : TOOL_ICONS[name()] ?? DEFAULT_TOOL_ICON}</text>
          </Show>
          <text fg={theme().muted}>
            <span style={{ fg: failed() ? theme().error : theme().text }}>{name()}</span>
            {(rowSummary(props.entry) ? ' ' + rowSummary(props.entry) : '') + rowSuffix(props.entry)}
          </text>
        </box>
        <ToolBody entry={props.entry} input={input()} output={output()} expanded={props.expanded} />
      </box>
    </Show>
  );
}

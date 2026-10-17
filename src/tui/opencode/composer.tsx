// Adapted from OpenCode component/prompt/index.tsx and prompt/autocomplete.tsx (MIT); see docs/opencode-provenance.md.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextAttributes, type KeyEvent, type PasteEvent, type TextareaRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { safeText } from '../../../dist/tui/editor.js';
import { saveClipboardImage } from './clipboard-image';
import {
  attachmentChip, continuesLine, cursorIndex, cursorPosition, expandPastes, lineCount, pastedImagePath, pasteToken,
  shouldCollapsePaste, withoutContinuation, type Attachment,
} from './composer-text';
import { applyMention, createFileIndex, listWorkspaceFiles, mentionAt, rankFiles } from './mentions';
import { useTheme, type Theme } from './theme';

export interface CommandInfo { name: string; description?: string }

export interface ComposerProps {
  disabled: boolean;
  /** Shown in place of the placeholder while disabled, so the user knows what the composer is waiting for. */
  disabledReason?: string;
  model: string;
  provider?: string;
  mode?: string;
  recalled?: {text:string};
  /** Earlier prompts, oldest first, recalled with the arrow keys. */
  history?: string[];
  /** Slash commands offered while the prompt is a bare `/word`. */
  commands?: CommandInfo[];
  /** Workspace root that `@` mentions complete paths from; defaults to the process directory. */
  cwd?: string;
  /** Replaces the workspace file listing behind `@` mentions. */
  listFiles?(): Promise<string[]>;
  /** Queues an image file for the next prompt. Without it image attachments are unavailable. */
  onAttach?(path: string): void | Promise<void>;
  /** Replaces the clipboard image reader; resolves to a PNG path or undefined when the clipboard has none. */
  readClipboardImage?(): Promise<string | undefined>;
  onSubmit(text: string): void | Promise<void>;
}

/** One row of the popup above the prompt: a slash command or a file to mention. */
interface Suggestion {
  label: string;
  detail?: string;
  /** Slash commands run on Enter; file mentions only insert the path. */
  submitsOnEnter: boolean;
  accept(): void;
}

const RAIL = { topLeft: '┃', bottomLeft: '╹', vertical: '┃', topRight: '', bottomRight: '', horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '' };
const MODE_LABELS: Record<string, string> = { default: 'Ask', acceptEdits: 'Edit', plan: 'Plan', bypassPermissions: 'Bypass', dontAsk: "Don't ask", auto: 'Auto' };
const MAX_SUGGESTIONS = 6;
const MAX_INPUT_ROWS = 8;
const COMPACT_WIDTH = 44;
const DESCRIPTION_GAP = 2;
const SLASH_QUERY = /^\/(\S*)$/;
const PLACEHOLDER = 'Ask anything, @ to mention a file, / for commands';
const INPUT_KEY_BINDINGS = [
  { name: 'return', action: 'submit' }, { name: 'return', shift: true, action: 'newline' }, { name: 'return', meta: true, action: 'newline' },
] as const;

function modeColor(theme: Theme, mode: string | undefined) {
  if (mode === 'plan') return theme.warning;
  if (mode === 'bypassPermissions') return theme.error;
  if (mode === 'acceptEdits' || mode === 'auto') return theme.success;
  return theme.accent;
}

function rankedCommands(commands: CommandInfo[], query: string) {
  const needle = query.toLowerCase();
  const named = (command: CommandInfo) => command.name.slice(1).toLowerCase();
  return commands.filter(command => named(command).includes(needle))
    .sort((left, right) => Number(!named(left).startsWith(needle)) - Number(!named(right).startsWith(needle)))
    .slice(0, MAX_SUGGESTIONS);
}

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

export function Composer(props: ComposerProps) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  let input: TextareaRenderable | undefined;
  const [text, setText] = createSignal('');
  const [cursor, setCursor] = createSignal(0);
  const [error, setError] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(0);
  const [dismissed, setDismissed] = createSignal<string>();
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [files, setFiles] = createSignal<string[]>([]);
  const pastes = new Map<string, string>();
  const fileIndex = createFileIndex(() => (props.listFiles ?? (() => listWorkspaceFiles(props.cwd ?? process.cwd())))());
  let historyIndex: number | undefined;
  const accent = () => modeColor(theme(), props.mode);
  const padding = () => dimensions().width < COMPACT_WIDTH ? 1 : 2;
  const placeholder = () => props.disabled ? props.disabledReason ?? 'Unavailable right now' : PLACEHOLDER;

  const mention = createMemo(() => text() === dismissed() ? undefined : mentionAt(text(), cursor()));
  createEffect(() => { if (mention()) void fileIndex.files().then(setFiles); });
  const suggestions = createMemo<Suggestion[]>(() => {
    const slashQuery = SLASH_QUERY.exec(text())?.[1];
    if (text() === dismissed()) return [];
    if (slashQuery !== undefined) return rankedCommands(props.commands ?? [], slashQuery).map(command => ({
      label: command.name, detail: command.description, submitsOnEnter: true, accept: () => replaceText(command.name + ' '),
    }));
    const active = mention();
    return active ? rankFiles(files(), active.query, MAX_SUGGESTIONS).map(path => ({
      label: path, submitsOnEnter: false, accept: () => insertMention(active, path),
    })) : [];
  });
  createEffect(() => { suggestions(); setHighlighted(0); });
  createEffect(() => { const recalled = props.recalled; if (recalled && input) replaceText(recalled.text); });
  // A closing dialog leaves focus nowhere; reclaim it whenever the composer becomes editable again.
  createEffect(() => { if (!props.disabled && !submitting() && input) input.focus(); });
  function syncState() {
    const value = input!.plainText;
    setText(value);
    setCursor(cursorIndex(value, input!.logicalCursor.row, input!.logicalCursor.col));
  }
  function replaceText(value: string) {
    input!.setText(value);
    input!.gotoBufferEnd();
    syncState();
  }
  function insertMention(active: NonNullable<ReturnType<typeof mention>>, path: string) {
    const applied = applyMention(text(), active, path);
    input!.setText(applied.text);
    const position = cursorPosition(applied.text, applied.cursor);
    input!.setCursor(position.row, position.column);
    syncState();
  }
  function contentChanged() {
    syncState();
    setError('');
    if (historyIndex !== undefined && text() !== props.history?.[historyIndex]) historyIndex = undefined;
  }

  async function attachQueued() {
    for (const attachment of attachments()) {
      await props.onAttach!(attachment.path);
      setAttachments(queued => queued.slice(1));
    }
  }
  async function submit() {
    if (props.disabled || submitting() || !input || !input.plainText.trim()) return;
    const submittedInput = input;
    const typed = input.plainText;
    setSubmitting(true);
    try {
      await attachQueued();
      await props.onSubmit(expandPastes(typed, pastes));
      if (!submittedInput.isDestroyed && submittedInput.plainText === typed) { submittedInput.clear(); pastes.clear(); }
      historyIndex = undefined;
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed.');
    } finally { setSubmitting(false); }
  }

  function addAttachment(path: string) {
    if (!props.onAttach) { setError('Image attachments are not available here.'); return; }
    setAttachments(queued => [...queued, { path }]);
  }
  async function attachClipboardImage() {
    const path = await (props.readClipboardImage ?? saveClipboardImage)();
    if (path) addAttachment(path); else setError('No image on the clipboard. Paste text with your terminal shortcut.');
  }
  function handlePaste(event: PasteEvent) {
    if (props.disabled) { event.preventDefault(); return; }
    const pasted = safeText(new TextDecoder().decode(event.bytes));
    const imagePath = pastedImagePath(pasted);
    const resolvedImage = imagePath && resolve(props.cwd ?? process.cwd(), imagePath);
    if (!pasted.trim()) { event.preventDefault(); void attachClipboardImage(); }
    else if (resolvedImage && isFile(resolvedImage)) { event.preventDefault(); addAttachment(resolvedImage); }
    else if (shouldCollapsePaste(pasted)) {
      event.preventDefault();
      const token = pasteToken(lineCount(pasted), pastes.keys());
      pastes.set(token, pasted);
      input!.insertText(token);
    }
  }

  /** Steps through history; returns false when the key should keep its editing meaning. */
  function recallHistory(step: -1 | 1) {
    const history = props.history ?? [];
    const browsing = historyIndex !== undefined;
    if (!history.length || (!browsing && (step === 1 || text() !== ''))) return false;
    if (step === -1 && input!.logicalCursor.row > 0) return false;
    const next = (historyIndex ?? history.length) + step;
    if (next < 0) return true;
    if (next >= history.length) { historyIndex = undefined; replaceText(''); return true; }
    historyIndex = next;
    replaceText(history[next]);
    return true;
  }
  function handleSuggestionKey(event: KeyEvent) {
    const count = suggestions().length;
    const chosen = suggestions()[highlighted()];
    if (event.name === 'up' || event.name === 'down') setHighlighted(index => (index + (event.name === 'up' ? count - 1 : 1)) % count);
    else if (event.name === 'tab') chosen.accept();
    else if (event.name === 'return' && !event.shift) { chosen.accept(); if (chosen.submitsOnEnter) void submit(); }
    else if (event.name === 'escape') setDismissed(text());
    else return false;
    return true;
  }
  const atBufferEnd = () => cursor() === text().length;
  /** Keys that edit the attachment chips or continue the line; returns whether the key was consumed. */
  function handleEditingKey(event: KeyEvent) {
    if (event.ctrl && event.name === 'v') { void attachClipboardImage(); return true; }
    if (event.name === 'backspace' && !text() && attachments().length) { setAttachments(queued => queued.slice(0, -1)); return true; }
    if (event.name === 'return' && !event.shift && !event.meta && !event.ctrl && continuesLine(text()) && atBufferEnd()) {
      replaceText(withoutContinuation(text()));
      return true;
    }
    return false;
  }
  function handleKey(event: KeyEvent) {
    if (props.disabled) { event.preventDefault(); return; }
    const handled = (suggestions().length && handleSuggestionKey(event)) || handleEditingKey(event) ||
      ((event.name === 'up' || event.name === 'down') && recallHistory(event.name === 'up' ? -1 : 1));
    if (handled) event.preventDefault();
  }

  return (
    <box width="100%" flexShrink={0}>
      <Show when={suggestions().length}>
        <SuggestionList items={suggestions()} highlighted={highlighted()} padding={padding()}
          onHover={setHighlighted} onPick={index => { setHighlighted(index); suggestions()[index].accept(); }} />
      </Show>
      <box border={['left']} customBorderChars={RAIL} borderColor={accent()} flexShrink={0}>
        <box paddingLeft={padding()} paddingRight={padding()} paddingTop={1} paddingBottom={1}
          backgroundColor={theme().panel} flexGrow={1}>
          <Show when={attachments().length}>
            <box flexDirection="row" gap={1} paddingBottom={1} flexShrink={0}>
              <For each={attachments()}>{(_, index) =>
                <box onMouseUp={() => setAttachments(queued => queued.filter((_, position) => position !== index()))}>
                  <text fg={theme().secondary} wrapMode="none">{attachmentChip(index())}</text>
                </box>
              }</For>
            </box>
          </Show>
          <textarea
            ref={input}
            width="100%"
            placeholder={placeholder()}
            textColor={theme().text}
            focusedTextColor={theme().text}
            minHeight={1}
            maxHeight={MAX_INPUT_ROWS}
            focused={!props.disabled && !submitting()}
            keyBindings={[...INPUT_KEY_BINDINGS]}
            onSubmit={submit}
            onContentChange={contentChanged}
            onCursorChange={syncState}
            onPaste={handlePaste}
            onKeyDown={handleKey}
          />
          <Show when={error()}><text fg={theme().error} paddingTop={1}>{error()}</text></Show>
          <box flexDirection="row" gap={1} paddingTop={1} flexShrink={0}>
            <text fg={accent()} attributes={TextAttributes.BOLD} wrapMode="none">{MODE_LABELS[props.mode ?? 'default'] ?? props.mode}</text>
            <text fg={theme().text} wrapMode="none">{props.model}</text>
            <Show when={props.provider}><text fg={theme().muted} wrapMode="none">{props.provider}</text></Show>
          </box>
        </box>
      </box>
    </box>
  );
}

interface SuggestionListProps {
  items: Suggestion[];
  highlighted: number;
  padding: number;
  onHover(index: number): void;
  onPick(index: number): void;
}

function SuggestionList(props: SuggestionListProps) {
  const theme = useTheme();
  return (
    <box backgroundColor={theme().element} marginBottom={1} paddingTop={1} paddingBottom={1} flexShrink={0}>
      <For each={props.items}>{(item, index) => {
        const active = () => index() === props.highlighted;
        return <box flexDirection="row" gap={DESCRIPTION_GAP} height={1} paddingLeft={props.padding} paddingRight={props.padding}
          backgroundColor={active() ? theme().accent : undefined}
          onMouseMove={() => props.onHover(index())} onMouseUp={() => props.onPick(index())}>
          <text fg={active() ? theme().background : theme().text} attributes={active() ? TextAttributes.BOLD : undefined}
            wrapMode="none" flexShrink={0}>{item.label}</text>
          <text fg={active() ? theme().background : theme().muted} wrapMode="none">{item.detail ?? ''}</text>
        </box>;
      }}</For>
    </box>
  );
}

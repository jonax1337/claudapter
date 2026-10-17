// Bridges OpenTUI key events and the textarea to the pure Vim interpreter.
import type { EditBufferRenderable } from '@opentui/core';
import { visualSelection, type VimDoc, type VimMode, type VimState } from '../../../dist/tui/vim.js';
import type { KillKind } from '../../../dist/tui/kill-ring.js';
import { cursorIndex, cursorPosition } from './composer-text';

export interface VimKeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  super?: boolean;
}

/** The interpreter's name for a key event, or undefined for keys Vim mode leaves to the editor. */
export function vimKeyName(event: VimKeyEvent): string | undefined {
  if (event.meta || event.super) return undefined;
  if (event.ctrl) return event.name === 'r' ? 'ctrl+r' : undefined;
  if (event.name === 'escape') return 'Escape';
  if (event.name === 'backspace') return 'Backspace';
  if (event.name === 'return' || event.name === 'enter') return event.shift ? undefined : 'Return';
  return Array.from(event.sequence).length === 1 && event.sequence >= ' ' ? event.sequence : undefined;
}

export function readDocument(input: EditBufferRenderable): VimDoc {
  const text = input.plainText;
  return { text, cursor: cursorIndex(text, input.logicalCursor.row, input.logicalCursor.col) };
}

export function writeDocument(input: EditBufferRenderable, doc: VimDoc) {
  if (input.plainText !== doc.text) input.replaceText(doc.text);
  const position = cursorPosition(doc.text, doc.cursor);
  input.setCursor(position.row, position.column);
}

/** Highlights the visual selection, or clears any highlight when the mode has none. */
export function showSelection(input: EditBufferRenderable, state: VimState) {
  const span = visualSelection(state, readDocument(input));
  if (span) input.editorView.setSelection(span.start, span.end);
  else if (input.editorView.hasSelection()) input.editorView.resetSelection();
}

export const VIM_MODE_LABELS: Record<VimMode, string> = { insert: 'INSERT', normal: 'NORMAL', visual: 'VISUAL', 'visual-line': 'V-LINE' };

export type KillCommand = KillKind | 'yank' | 'yank-pop';

export interface KillBinding {
  chord: string;
  command: KillCommand;
  description: string;
}

/** Emacs-style kill and yank keys; the single source for both dispatch and the keyboard reference. */
export const KILL_BINDINGS: readonly KillBinding[] = [
  { chord: 'ctrl+k', command: 'line-end', description: 'Kill to the end of the line' },
  { chord: 'ctrl+u', command: 'line-start', description: 'Kill to the start of the line' },
  { chord: 'ctrl+w', command: 'shell-word-back', description: 'Kill the word before the cursor' },
  { chord: 'alt+d', command: 'word-forward', description: 'Kill the word after the cursor' },
  { chord: 'alt+backspace', command: 'word-back', description: 'Kill back to the previous word start' },
  { chord: 'ctrl+y', command: 'yank', description: 'Yank the latest kill' },
  { chord: 'alt+y', command: 'yank-pop', description: 'Replace the yank with the previous kill' },
];

export function killCommandOf(event: VimKeyEvent): KillCommand | undefined {
  if (event.super || event.ctrl === event.meta) return undefined;
  const chord = (event.ctrl ? 'ctrl+' : 'alt+') + event.name;
  return KILL_BINDINGS.find(binding => binding.chord === chord)?.command;
}

const TEXTAREA_EDITING_CHORDS = new Set([
  'ctrl+w', 'ctrl+d', 'ctrl+k', 'ctrl+u', 'ctrl+delete', 'meta+d', 'meta+backspace', 'meta+delete', 'meta+return',
  'delete', 'linefeed', 'kpenter', 'shift+return', 'shift+backspace', 'shift+delete', 'ctrl+backspace',
]);

/** Whether the textarea would edit text for this key; Vim's command modes must not let it. */
export function editsText(event: VimKeyEvent): boolean {
  const chord = [event.ctrl ? 'ctrl' : '', event.meta ? 'meta' : '', event.shift ? 'shift' : '', event.name].filter(Boolean).join('+');
  return TEXTAREA_EDITING_CHORDS.has(chord) || TEXTAREA_EDITING_CHORDS.has(event.name);
}

// Keyboard reference assembled from what is registered: the textarea's own bindings, the composer's overrides,
// the kill ring and Vim tables, and the user's configured shortcuts.
import { defaultTextareaKeyBindings, type KeyBinding, type TextareaAction } from '@opentui/core';
import { VIM_REFERENCE } from '../../../dist/tui/vim-reference.js';
import type { ReferenceSection } from '../../../dist/tui/parity-info.js';
import { INPUT_KEY_BINDINGS } from './composer';
import { KILL_BINDINGS } from './composer-vim';

/** Plain description for every textarea action; the record type makes a new upstream action a compile error. */
const ACTION_DESCRIPTIONS: Record<TextareaAction, string> = {
  'move-left': 'Cursor left', 'move-right': 'Cursor right', 'move-up': 'Cursor up', 'move-down': 'Cursor down',
  'select-left': 'Extend selection left', 'select-right': 'Extend selection right', 'select-up': 'Extend selection up', 'select-down': 'Extend selection down',
  'line-home': 'Start of line', 'line-end': 'End of line', 'select-line-home': 'Select to line start', 'select-line-end': 'Select to line end',
  'visual-line-home': 'Start of screen line', 'visual-line-end': 'End of screen line',
  'select-visual-line-home': 'Select to screen-line start', 'select-visual-line-end': 'Select to screen-line end',
  'buffer-home': 'Start of prompt', 'buffer-end': 'End of prompt', 'select-buffer-home': 'Select to prompt start', 'select-buffer-end': 'Select to prompt end',
  'delete-line': 'Delete the line', 'delete-to-line-end': 'Delete to line end', 'delete-to-line-start': 'Delete to line start',
  backspace: 'Delete before cursor', delete: 'Delete after cursor', newline: 'New line', undo: 'Undo', redo: 'Redo',
  'word-forward': 'Next word', 'word-backward': 'Previous word', 'select-word-forward': 'Select next word', 'select-word-backward': 'Select previous word',
  'delete-word-forward': 'Delete next word', 'delete-word-backward': 'Delete previous word', 'select-all': 'Select all', submit: 'Send the prompt',
};

/** Session-level shortcuts. `source` must appear in the file that registers the key, so a drifting entry fails a test. */
export const SESSION_SHORTCUTS: readonly { chord: string; description: string; file: string; source: string }[] = [
  { chord: 'ctrl+p', description: 'Command palette', file: 'app.tsx', source: "'ctrl+p'" },
  { chord: 'ctrl+t', description: 'Agents and workflows', file: 'app.tsx', source: "event.name==='t'" },
  { chord: 'shift+tab', description: 'Cycle permission mode', file: 'app.tsx', source: "event.name==='tab'" },
  { chord: 'esc', description: 'Interrupt the running turn', file: 'app.tsx', source: "event.name==='escape'" },
  { chord: 'pageup / pagedown', description: 'Scroll the transcript', file: 'app.tsx', source: "'pageup'" },
  { chord: 'ctrl+c', description: 'Copy selection, interrupt, or exit', file: 'main.tsx', source: "event.name !== 'c'" },
];

const PROMPT_BEHAVIOR: readonly [string, string][] = [
  ['enter', 'Send the prompt'],
  ['shift+enter, alt+enter', 'New line'],
  ['\\ then enter', 'Continue on the next line'],
  ['up / down', 'Recall earlier prompts from an empty prompt'],
  ['tab', 'Accept the highlighted command or file'],
  ['ctrl+v', 'Attach an image from the clipboard'],
  ['/btw <question>', 'Side question; also works while Claude is working'],
];

const modifierOrder = ['ctrl', 'alt', 'shift', 'super'] as const;

export function chordOf(binding: Pick<KeyBinding, 'name' | 'ctrl' | 'meta' | 'shift' | 'super'>): string {
  const held = { ctrl: binding.ctrl, alt: binding.meta, shift: binding.shift, super: binding.super };
  return [...modifierOrder.filter(modifier => held[modifier]), binding.name].join('+');
}

/** The textarea's bindings with the composer's own overrides applied, as the running editor sees them. */
export function effectiveTextareaBindings(): KeyBinding[] {
  const identity = (binding: KeyBinding) => chordOf(binding);
  const overridden = new Set(INPUT_KEY_BINDINGS.map(identity));
  return [...defaultTextareaKeyBindings.filter(binding => !overridden.has(identity(binding))), ...INPUT_KEY_BINDINGS];
}

function editingRows(bindings: KeyBinding[]) {
  const byAction = new Map<string, string[]>();
  for (const binding of bindings) byAction.set(binding.action, [...(byAction.get(binding.action) ?? []), chordOf(binding)]);
  return [...byAction].map(([action, chords]) => ({ label: chords.slice(0, 3).join(', '), value: ACTION_DESCRIPTIONS[action as TextareaAction] }));
}

export function keymapSections(configured: Record<string, string>): ReferenceSection[] {
  const own = Object.entries(configured).map(([chord, command]) => ({ label: chord, value: command }));
  return [
    { title: 'Prompt', rows: PROMPT_BEHAVIOR.map(([label, value]) => ({ label, value })) },
    { title: 'Session', rows: SESSION_SHORTCUTS.map(({ chord, description }) => ({ label: chord, value: description })) },
    { title: 'Your shortcuts (/keybindings)', rows: own.length ? own : [{ label: 'none', value: 'Bind keys with /keybindings' }] },
    { title: 'Prompt editing', rows: editingRows(effectiveTextareaBindings()) },
    { title: 'Kill ring', rows: KILL_BINDINGS.map(({ chord, description }) => ({ label: chord, value: description })) },
    ...VIM_REFERENCE.map(group => ({ title: `Vim mode (/vim) · ${group.title}`, rows: group.entries.map(({ keys, description }) => ({ label: keys, value: description })) })),
  ];
}

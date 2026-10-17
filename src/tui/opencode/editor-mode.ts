// Session-wide composer editing mode, shared by the composer, the /vim command and the app's Esc handling.
import { createSignal } from 'solid-js';
import type { EditorMode } from '../../../dist/tui/preferences.js';
import type { VimMode } from '../../../dist/tui/vim.js';

const [editorMode, setEditorMode] = createSignal<EditorMode>('normal');
const [vimMode, setVimMode] = createSignal<VimMode>('insert');
const consumedEscapes = new WeakSet<object>();

/** Called by the composer when an Esc left INSERT or VISUAL, so the same key does not also interrupt the turn. */
export function markEscapeConsumed(event: object) {
  consumedEscapes.add(event);
}

/**
 * Whether this Esc belongs to the prompt's Vim mode instead of the running turn. Works in either handler order:
 * the composer marks the event when it already changed the mode, otherwise the mode itself still says INSERT or VISUAL.
 */
export function escapeBelongsToPrompt(event: object): boolean {
  return consumedEscapes.has(event) || editorMode() === 'vim' && vimMode() !== 'normal';
}

export { editorMode, setEditorMode, vimMode, setVimMode };

// Emacs-style kill ring for the composer: kills are saved and can be yanked back with Ctrl+Y / Alt+Y.
import { backward, classOf, forward, lineEnd, lineStart, previousWordStart, runEnd } from './vim-motions.js';
import type { VimDoc } from './vim-edits.js';

export type KillKind = 'line-end' | 'line-start' | 'word-back' | 'shell-word-back' | 'word-forward';

export interface KillRing {
  /** Newest first. */
  entries: string[];
  /** Text a yank just inserted, which Alt+Y replaces with the next older entry. */
  yanked?: { start: number; end: number; slot: number };
}

export const KILL_RING_LIMIT = 60;
export const emptyKillRing = (): KillRing => ({ entries: [] });

interface KillSpan {
  start: number;
  end: number;
  /** Kills made before the cursor are prepended to a continuing kill. */
  backward: boolean;
}

function killSpan(doc: VimDoc, kind: KillKind): KillSpan | undefined {
  const { text, cursor } = doc;
  switch (kind) {
    case 'line-end': {
      const end = lineEnd(text, cursor);
      const span = end > cursor ? { start: cursor, end } : { start: cursor, end: Math.min(text.length, cursor + 1) };
      return span.end > span.start ? { ...span, backward: false } : undefined;
    }
    case 'line-start': {
      const start = lineStart(text, cursor);
      return start < cursor ? { start, end: cursor, backward: true } : undefined;
    }
    case 'word-back': return cursor > 0 ? { start: previousWordStart(text, cursor, false), end: cursor, backward: true } : undefined;
    case 'shell-word-back': return cursor > 0 ? { start: shellWordStart(text, cursor), end: cursor, backward: true } : undefined;
    case 'word-forward': return cursor < text.length ? { start: cursor, end: wordForwardEnd(text, cursor), backward: false } : undefined;
  }
}

/** End of the word at or after `cursor`, skipping blanks first. */
function wordForwardEnd(text: string, cursor: number): number {
  let position = cursor;
  while (position < text.length && /\s/.test(text[position])) position++;
  return position >= text.length ? text.length : forward(text, runEnd(text, position, false));
}

/** Start of the whitespace-delimited word before `cursor`, as readline's unix-word-rubout does. */
function shellWordStart(text: string, cursor: number): number {
  let position = cursor;
  while (position > 0 && classOf(text.slice(backward(text, position), position), true) === 'space') position = backward(text, position);
  while (position > 0 && classOf(text.slice(backward(text, position), position), true) !== 'space') position = backward(text, position);
  return position;
}

export interface KillOutcome {
  doc: VimDoc;
  ring: KillRing;
}

/**
 * Removes text and saves it. When `continuing` is true the previous command was also a kill,
 * so the text joins the newest entry instead of starting a new one.
 */
export function kill(ring: KillRing, doc: VimDoc, kind: KillKind, continuing: boolean): KillOutcome | undefined {
  const span = killSpan(doc, kind);
  if (!span) return undefined;
  const killed = doc.text.slice(span.start, span.end);
  const entries = continuing && ring.entries.length
    ? [span.backward ? killed + ring.entries[0] : ring.entries[0] + killed, ...ring.entries.slice(1)]
    : [killed, ...ring.entries].slice(0, KILL_RING_LIMIT);
  return { doc: { text: doc.text.slice(0, span.start) + doc.text.slice(span.end), cursor: span.start }, ring: { entries } };
}

/** Ctrl+Y: inserts the newest kill at the cursor. */
export function yank(ring: KillRing, doc: VimDoc): KillOutcome | undefined {
  return insertEntry(ring, doc, doc.cursor, 0);
}

/** Alt+Y: directly after a yank, swaps the yanked text for the next older kill. */
export function yankPop(ring: KillRing, doc: VimDoc): KillOutcome | undefined {
  const last = ring.yanked;
  if (!last || ring.entries.length < 2 || doc.text.slice(last.start, last.end) !== ring.entries[last.slot]) return undefined;
  const without = { text: doc.text.slice(0, last.start) + doc.text.slice(last.end), cursor: last.start };
  return insertEntry(ring, without, last.start, (last.slot + 1) % ring.entries.length);
}

function insertEntry(ring: KillRing, doc: VimDoc, at: number, slot: number): KillOutcome | undefined {
  const entry = ring.entries[slot];
  if (entry === undefined) return undefined;
  const text = doc.text.slice(0, at) + entry + doc.text.slice(at);
  return { doc: { text, cursor: at + entry.length }, ring: { entries: ring.entries, yanked: { start: at, end: at + entry.length, slot } } };
}

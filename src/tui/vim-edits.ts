// Pure text edits behind the composer's Vim operators. Each returns a new document and never mutates its input.
import { backward, clampNormal, firstNonBlank, forward, lineEnd, lineStart, repeatTimes } from './vim-motions.js';

export interface VimDoc {
  text: string;
  /** UTF-16 offset of the cursor. */
  cursor: number;
}

export interface Register {
  text: string;
  /** Pasted as whole lines instead of inline. */
  linewise: boolean;
}

/** A range of text; `end` is exclusive. Linewise spans cover whole lines without their trailing newline. */
export interface Span {
  start: number;
  end: number;
  linewise: boolean;
}

export interface EditResult {
  doc: VimDoc;
  register?: Register;
}

const splice = (text: string, start: number, end: number, insertion = '') => text.slice(0, start) + insertion + text.slice(end);

export function charSpan(start: number, end: number): Span {
  return { start: Math.min(start, end), end: Math.max(start, end), linewise: false };
}

/** Whole lines from the line holding `from` through the line holding `to`. */
export function lineSpan(text: string, from: number, to: number): Span {
  const [low, high] = from <= to ? [from, to] : [to, from];
  return { start: lineStart(text, low), end: lineEnd(text, high), linewise: true };
}

export function yankSpan(doc: VimDoc, span: Span): EditResult {
  const register = { text: doc.text.slice(span.start, span.end), linewise: span.linewise };
  return { doc: { text: doc.text, cursor: clampNormal(doc.text, span.start) }, register };
}

/** Deletes the span; a linewise span removes its lines and the newline that separated them. */
export function removeSpan(doc: VimDoc, span: Span): EditResult {
  const { text } = doc;
  const register = { text: text.slice(span.start, span.end), linewise: span.linewise };
  if (!span.linewise) return { doc: afterDelete(splice(text, span.start, span.end), span.start), register };
  const hasNext = span.end < text.length;
  const remaining = hasNext ? splice(text, span.start, span.end + 1) : span.start > 0 ? splice(text, span.start - 1, span.end) : '';
  const landing = hasNext ? span.start : Math.max(0, span.start - 1);
  return { doc: { text: remaining, cursor: firstNonBlank(remaining, Math.min(landing, remaining.length)) }, register };
}

/** Like {@link removeSpan} for `c`: a linewise change keeps one empty line to type into. */
export function changeSpan(doc: VimDoc, span: Span): EditResult {
  const register = { text: doc.text.slice(span.start, span.end), linewise: span.linewise };
  const text = splice(doc.text, span.start, span.end);
  return { doc: { text, cursor: span.start }, register };
}

function afterDelete(text: string, at: number): VimDoc {
  return { text, cursor: clampNormal(text, at) };
}

/** `p` / `P` with a repeat count; an empty register leaves the document unchanged. */
export function putRegister(doc: VimDoc, register: Register | undefined, before: boolean, count: number): VimDoc {
  if (!register || !register.text) return doc;
  const { text, cursor } = doc;
  if (register.linewise) return putLines(doc, register.text, before, count);
  const insertion = register.text.repeat(count);
  const at = before || text.length === 0 ? cursor : forward(text, cursor);
  const updated = splice(text, at, at, insertion);
  return { text: updated, cursor: clampNormal(updated, at + insertion.length - 1) };
}

function putLines(doc: VimDoc, lines: string, before: boolean, count: number): VimDoc {
  const block = Array.from({ length: count }, () => lines).join('\n');
  const { text, cursor } = doc;
  if (before) {
    const at = lineStart(text, cursor);
    const updated = splice(text, at, at, block + '\n');
    return { text: updated, cursor: firstNonBlank(updated, at) };
  }
  const at = lineEnd(text, cursor);
  const updated = splice(text, at, at, '\n' + block);
  return { text: updated, cursor: firstNonBlank(updated, at + 1) };
}

/** `J`: joins `count` lines (at least two) with a single space. */
export function joinLines(doc: VimDoc, count: number): VimDoc {
  let { text } = doc;
  let cursor = doc.cursor;
  for (let joined = 0; joined < Math.max(2, count) - 1; joined++) {
    const end = lineEnd(text, cursor);
    if (end >= text.length) break;
    const following = /^[ \t]*/.exec(text.slice(end + 1))![0].length;
    const nextIsEmpty = text[end + 1 + following] === '\n' || end + 1 + following >= text.length;
    const separator = nextIsEmpty || /\s$/.test(text.slice(0, end)) ? '' : ' ';
    text = splice(text, end, end + 1 + following, separator);
    cursor = end;
  }
  return { text, cursor: clampNormal(text, cursor) };
}

/** `r{char}`: replaces `count` characters from the cursor; undefined when the line is too short. */
export function replaceCharacters(doc: VimDoc, character: string, count: number): VimDoc | undefined {
  const { text, cursor } = doc;
  const characters = Array.from(text.slice(cursor, lineEnd(text, cursor)));
  if (characters.length < count) return undefined;
  const replaced = characters.slice(0, count).map(() => character).join('');
  const updated = splice(text, cursor, cursor + characters.slice(0, count).join('').length, replaced);
  return { text: updated, cursor: clampNormal(updated, cursor + replaced.length - character.length) };
}

/** `~`: toggles the case of `count` characters and moves past them. */
export function toggleCase(doc: VimDoc, count: number): VimDoc {
  const { text, cursor } = doc;
  const span = Array.from(text.slice(cursor, lineEnd(text, cursor))).slice(0, count).join('');
  const flipped = Array.from(span).map(character => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()).join('');
  const updated = splice(text, cursor, cursor + span.length, flipped);
  return { text: updated, cursor: clampNormal(updated, cursor + flipped.length) };
}

/** `o` / `O`: opens an empty line below or above and returns the cursor on it. */
export function openLine(doc: VimDoc, above: boolean): VimDoc {
  const { text, cursor } = doc;
  if (above) {
    const at = lineStart(text, cursor);
    return { text: splice(text, at, at, '\n'), cursor: at };
  }
  const at = lineEnd(text, cursor);
  return { text: splice(text, at, at, '\n'), cursor: at + 1 };
}

/** `x` / `X` span: `count` characters after or before the cursor, never crossing the line. */
export function characterSpan(text: string, cursor: number, count: number, backwardDirection: boolean): Span | undefined {
  if (backwardDirection) {
    const start = repeatTimes(count, index => index > lineStart(text, index) ? backward(text, index) : index, cursor);
    return start < cursor ? charSpan(start, cursor) : undefined;
  }
  const end = repeatTimes(count, index => index < lineEnd(text, index) ? forward(text, index) : index, cursor);
  return end > cursor ? charSpan(cursor, end) : undefined;
}

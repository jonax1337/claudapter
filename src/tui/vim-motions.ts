// Pure text positions for the composer's Vim mode. Indices are UTF-16 offsets that never split a surrogate pair.

export type CharClass = 'space' | 'word' | 'punctuation';
export type FindKind = 'f' | 'F' | 't' | 'T';

export interface Motion {
  /** Offset the cursor moves to. */
  target: number;
  /** Whether an operator also covers the character at `target`. */
  inclusive: boolean;
  /** Whether an operator covers whole lines. */
  linewise: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function forward(text: string, index: number): number {
  const code = text.codePointAt(index);
  return Math.min(text.length, index + (code !== undefined && code > 0xffff ? 2 : 1));
}

export function backward(text: string, index: number): number {
  if (index <= 0) return 0;
  const low = text.charCodeAt(index - 1);
  const isPair = low >= 0xdc00 && low <= 0xdfff && index >= 2 && text.charCodeAt(index - 2) >= 0xd800 && text.charCodeAt(index - 2) <= 0xdbff;
  return index - (isPair ? 2 : 1);
}

const characterAt = (text: string, index: number) => text.slice(index, forward(text, index));

export function classOf(character: string, bigWord: boolean): CharClass {
  if (/\s/u.test(character)) return 'space';
  return bigWord || WORD_CHAR.test(character) ? 'word' : 'punctuation';
}

export const lineStart = (text: string, index: number) => text.lastIndexOf('\n', index - 1) + 1;

export function lineEnd(text: string, index: number): number {
  const newline = text.indexOf('\n', index);
  return newline < 0 ? text.length : newline;
}

export function firstNonBlank(text: string, index: number): number {
  const start = lineStart(text, index);
  const end = lineEnd(text, index);
  let position = start;
  while (position < end && /[ \t]/.test(text[position])) position++;
  return position < end ? position : Math.max(start, end - 1);
}

/** Last character of the line, or the line start when the line is empty. */
export function lastCharacter(text: string, index: number): number {
  const start = lineStart(text, index);
  const end = lineEnd(text, index);
  return end > start ? backward(text, end) : start;
}

/** A normal-mode cursor rests on a character, never past the end of its line. */
export function clampNormal(text: string, index: number): number {
  const bounded = Math.max(0, Math.min(index, text.length));
  return Math.min(bounded, lastCharacter(text, bounded));
}

export function lineIndexOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length - 1;
}

export function lineStartOf(text: string, line: number): number {
  return text.split('\n').slice(0, Math.max(0, line)).reduce((total, current) => total + current.length + 1, 0);
}

export const lineTotal = (text: string) => text.split('\n').length;

export function nextWordStart(text: string, index: number, bigWord: boolean): number {
  let position = index;
  const current = position < text.length ? classOf(characterAt(text, position), bigWord) : 'space';
  if (current !== 'space') while (position < text.length && classOf(characterAt(text, position), bigWord) === current) position = forward(text, position);
  while (position < text.length && classOf(characterAt(text, position), bigWord) === 'space') position = forward(text, position);
  return position;
}

export function previousWordStart(text: string, index: number, bigWord: boolean): number {
  let position = backward(text, index);
  while (position > 0 && classOf(characterAt(text, position), bigWord) === 'space') position = backward(text, position);
  const current = classOf(characterAt(text, position), bigWord);
  while (position > 0 && classOf(characterAt(text, backward(text, position)), bigWord) === current) position = backward(text, position);
  return position;
}

/** Last character of the run of equal-class characters that contains `index`. */
export function runEnd(text: string, index: number, bigWord: boolean): number {
  const current = classOf(characterAt(text, index), bigWord);
  let position = index;
  while (forward(text, position) < lineEnd(text, index) && classOf(characterAt(text, forward(text, position)), bigWord) === current) position = forward(text, position);
  return position;
}

export function wordEnd(text: string, index: number, bigWord: boolean): number {
  let position = forward(text, index);
  while (position < text.length && classOf(characterAt(text, position), bigWord) === 'space') position = forward(text, position);
  if (position >= text.length) return Math.max(0, backward(text, text.length));
  const current = classOf(characterAt(text, position), bigWord);
  while (forward(text, position) < text.length && classOf(characterAt(text, forward(text, position)), bigWord) === current) position = forward(text, position);
  return position;
}

/** `f`, `F`, `t`, `T` target within the cursor's line, or undefined when the character is not there. */
export function findCharacter(text: string, index: number, kind: FindKind, character: string, count: number): number | undefined {
  const positions: number[] = [];
  for (let position = lineStart(text, index); position < lineEnd(text, index); position = forward(text, position)) positions.push(position);
  const at = positions.indexOf(index);
  const direction = kind === 'f' || kind === 't' ? 1 : -1;
  let found = 0;
  for (let slot = at + direction; at >= 0 && slot >= 0 && slot < positions.length; slot += direction) {
    if (characterAt(text, positions[slot]) !== character || ++found < count) continue;
    return kind === 'f' || kind === 'F' ? positions[slot] : positions[slot - direction];
  }
  return undefined;
}

/** Bounds [start, end) of the word under the cursor for the `iw` and `aw` text objects. */
export function wordObject(text: string, index: number, around: boolean): { start: number; end: number } | undefined {
  if (index >= text.length || text[index] === '\n') return undefined;
  const current = classOf(characterAt(text, index), false);
  let start = index;
  let end = forward(text, index);
  while (start > lineStart(text, index) && classOf(characterAt(text, backward(text, start)), false) === current) start = backward(text, start);
  while (end < lineEnd(text, index) && classOf(characterAt(text, end), false) === current) end = forward(text, end);
  if (!around) return { start, end };
  const trailingEnd = skipBlanksForward(text, end);
  if (trailingEnd > end) return { start, end: trailingEnd };
  return { start: skipBlanksBackward(text, start), end };
}

function skipBlanksForward(text: string, index: number): number {
  let position = index;
  while (position < lineEnd(text, index) && /[ \t]/.test(text[position])) position++;
  return position;
}

function skipBlanksBackward(text: string, index: number): number {
  let position = index;
  while (position > lineStart(text, index) && /[ \t]/.test(text[position - 1])) position--;
  return position;
}

export function repeatTimes(count: number, step: (index: number) => number, from: number): number {
  let position = from;
  for (let done = 0; done < count; done++) position = step(position);
  return position;
}

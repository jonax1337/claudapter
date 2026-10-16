import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import type { Key } from 'ink';

export type Draft = {text:string; cursor:number};
type EditorKey = Partial<Pick<Key, 'leftArrow' | 'rightArrow' | 'upArrow' | 'downArrow' | 'home' | 'end' | 'ctrl' | 'meta' | 'super' | 'escape' | 'return' | 'backspace' | 'delete' | 'tab' | 'eventType'>>;
const graphemes = new Intl.Segmenter(undefined, {granularity:'grapheme'});

export function safeText(text: string): string {
  return stripVTControlCharacters(text
    .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, '')
    .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

function boundaries(text: string): number[] {
  return [...graphemes.segment(text)].map(part => part.index).concat(text.length);
}

function cellWidth(text: string, column: number): number {
  return text === '\t' ? 4 - column % 4 : stringWidth(text);
}

function columnOf(text: string): number {
  let column = 0;
  for (const {segment} of graphemes.segment(text)) column += cellWidth(segment, column);
  return column;
}

function offsetAtColumn(text: string, target: number): number {
  let column = 0;
  for (const {segment,index} of graphemes.segment(text)) {
    column += cellWidth(segment, column);
    if (column > target) return index;
  }
  return text.length;
}

export function editDraft(draft: Draft, input: string, key: EditorKey = {}): Draft {
  const text = safeText(draft.text);
  const requested = Number.isFinite(draft.cursor) ? Math.max(0, Math.min(draft.text.length, Math.trunc(draft.cursor))) : 0;
  const stops = boundaries(text);
  const cursor = stops.findLast(index => index <= safeText(draft.text.slice(0,requested)).length) ?? 0;
  const current = {text,cursor};
  const index = stops.indexOf(cursor);
  const previous = stops[Math.max(0,index-1)];
  const next = stops[Math.min(stops.length-1,index+1)];
  const start = text.slice(0,cursor).lastIndexOf('\n')+1;
  const end = text.indexOf('\n',cursor) < 0 ? text.length : text.indexOf('\n',cursor);
  const replace = (from: number, to: number, insertion = ''): Draft => {
    const updated = text.slice(0,from)+insertion+text.slice(to);
    const after = from+insertion.length;
    return {text:updated,cursor:boundaries(updated).find(position => position >= after) ?? updated.length};
  };
  const wordLeft = () => {
    let pos = index;
    while (pos > 0 && /^\s+$/u.test(text.slice(stops[pos-1],stops[pos]))) pos--;
    while (pos > 0 && !/^\s+$/u.test(text.slice(stops[pos-1],stops[pos]))) pos--;
    return stops[pos];
  };
  const wordRight = () => {
    let pos = index;
    while (pos < stops.length-1 && !/^\s+$/u.test(text.slice(stops[pos],stops[pos+1]))) pos++;
    while (pos < stops.length-1 && /^\s+$/u.test(text.slice(stops[pos],stops[pos+1]))) pos++;
    return stops[pos];
  };
  if (key.eventType === 'release' || key.escape || key.return || key.meta || key.super) return current;
  if (key.home) return {text,cursor:key.ctrl ? 0 : start};
  if (key.end) return {text,cursor:key.ctrl ? text.length : end};
  if (key.leftArrow) return {text,cursor:key.ctrl ? wordLeft() : previous};
  if (key.rightArrow) return {text,cursor:key.ctrl ? wordRight() : next};
  if (key.upArrow || key.downArrow) {
    if (key.upArrow && start === 0 || key.downArrow && end === text.length) return current;
    const targetStart = key.upArrow ? text.slice(0,start-1).lastIndexOf('\n')+1 : end+1;
    const targetEnd = key.upArrow ? start-1 : text.indexOf('\n',targetStart);
    const line = text.slice(targetStart,targetEnd < 0 ? text.length : targetEnd);
    return {text,cursor:targetStart+offsetAtColumn(line,columnOf(text.slice(start,cursor)))};
  }
  if (key.ctrl) {
    switch (input.toLowerCase()) {
      case 'a': return {text,cursor:start};
      case 'e': return {text,cursor:end};
      case 'u': return replace(start,cursor);
      case 'k': return replace(cursor,end === cursor ? Math.min(text.length,end+1) : end);
      case 'w': return replace(wordLeft(),cursor);
      default: return current;
    }
  }
  if (key.backspace) return replace(previous,cursor);
  if (key.delete) return replace(cursor,next);
  return replace(cursor,cursor,key.tab ? '\t' : safeText(input));
}

export function wrapText(text: string, width: number): string[] {
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError('Text width must be a positive integer.');
  const lines: string[] = [];
  for (const paragraph of safeText(text).split('\n')) {
    let line = '', column = 0;
    const append = (segment: string) => {
      const cells = stringWidth(segment);
      if (column > 0 && column+cells > width) {lines.push(line);line='';column=0;}
      // shortcut: an indivisible wide grapheme can exceed width 1; clip in a renderer that requires single-cell rows.
      line += segment;
      column += cells;
    };
    for (const {segment} of graphemes.segment(paragraph)) {
      if (segment === '\t') for (let spaces=4-column%4; spaces>0; spaces--) append(' ');
      else append(segment);
    }
    lines.push(line);
  }
  return lines;
}

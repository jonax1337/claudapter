import stringWidth from 'string-width';
import type { TranscriptLine } from './panels.js';

export type Point = { row: number; column: number };
export type Selection = { lines: TranscriptLine[]; start: Point; end: Point; dragging: boolean };

export function selectionBounds(selection: Selection, row: number): [number, number] | undefined {
  const { start, end } = selection;
  const forward = start.row < end.row || start.row === end.row && start.column <= end.column;
  const first = forward ? start : end, last = forward ? end : start;
  if (row < first.row || row > last.row) return;
  return [row === first.row ? first.column : 0, row === last.row ? last.column + 1 : Infinity];
}

export function splitSelectedText(text: string, bounds?: [number, number]) {
  const parts = { before: '', selected: '', after: '' };
  let column = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const width = stringWidth(segment);
    const key = !bounds || column + width <= bounds[0] ? 'before' : column >= bounds[1] ? 'after' : 'selected';
    parts[key] += segment;
    column += width;
  }
  return parts;
}

export function selectedText(selection: Selection): string {
  return selection.lines.flatMap((line, row) => {
    const bounds = selectionBounds(selection, row);
    return bounds ? [splitSelectedText(line.text, bounds).selected] : [];
  }).join('\n');
}

import stringWidth from 'string-width';

export const SEGMENT_GAP = 2;
const ELLIPSIS = '…';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A piece of a single-row layout that can be shortened or dropped when the row is too narrow. */
export interface Fittable {
  width: number;
  /** Lower numbers are kept longer; the highest number is dropped first. */
  priority: number;
  /** Width of a shorter rendering that is tried before the segment is dropped. */
  compactWidth?: number;
}

export type Fitted<T> = T & { compact: boolean };

/** Terminal cells taken by `text`: wide CJK characters and emoji count two, combining marks none. */
export function textWidth(text: string): number {
  return stringWidth(text);
}

/** At most `width` cells of `text`, ending in `…` when shortened; never splits a grapheme cluster. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (textWidth(text) <= width) return text;
  return leadingCells(text, width - textWidth(ELLIPSIS)) + ELLIPSIS;
}

/** `text` followed by spaces up to `cells` terminal cells, so the next column starts at the same position. */
export function padToWidth(text: string, cells: number): string {
  return text + ' '.repeat(Math.max(0, cells - textWidth(text)));
}

/** The longest prefix of whole grapheme clusters that fits into `cells`. */
function leadingCells(text: string, cells: number): string {
  let kept = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const width = textWidth(segment);
    if (used + width > cells) break;
    kept += segment;
    used += width;
  }
  return kept;
}

/**
 * Keeps as many segments as fit into `available` cells. The least important segment is first switched to its
 * compact form, if it has one, and dropped only when that is still too wide. Ties shrink the later segment.
 * The surviving segments keep their original order.
 */
export function fitSegments<T extends Fittable>(segments: T[], available: number, gap = SEGMENT_GAP): Fitted<T>[] {
  const kept = segments.map(segment => ({ ...segment, compact: false }));
  const occupied = () => kept.reduce((sum, segment) => sum + fittedWidth(segment), 0) + gap * Math.max(0, kept.length - 1);
  while (kept.length > 0 && occupied() > available) shrinkLeastImportant(kept);
  return kept;
}

function fittedWidth(segment: Fitted<Fittable>): number {
  return segment.compact ? segment.compactWidth! : segment.width;
}

function shrinkLeastImportant(segments: Fitted<Fittable>[]) {
  const index = leastImportantIndex(segments);
  const segment = segments[index];
  if (!segment.compact && segment.compactWidth !== undefined) segment.compact = true;
  else segments.splice(index, 1);
}

function leastImportantIndex(segments: Fittable[]): number {
  let worst = 0;
  segments.forEach((segment, index) => { if (segment.priority >= segments[worst].priority) worst = index; });
  return worst;
}

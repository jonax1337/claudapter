export const SEGMENT_GAP = 2;

/** A piece of a single-row layout that can be dropped when the row is too narrow. */
export interface Fittable {
  width: number;
  /** Lower numbers are kept longer; the highest number is dropped first. */
  priority: number;
}

/** Terminal cells taken by `text`, counting code points rather than UTF-16 units. */
export function textWidth(text: string): number {
  return [...text].length;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  const characters = [...text];
  return characters.length <= width ? text : characters.slice(0, width - 1).join('') + '…';
}

/**
 * Keeps as many segments as fit into `available` cells, dropping the least important first.
 * Ties drop the later segment. The surviving segments keep their original order.
 */
export function fitSegments<T extends Fittable>(segments: T[], available: number, gap = SEGMENT_GAP): T[] {
  const kept = [...segments];
  const occupied = () => kept.reduce((sum, segment) => sum + segment.width, 0) + gap * Math.max(0, kept.length - 1);
  while (kept.length > 0 && occupied() > available) kept.splice(leastImportantIndex(kept), 1);
  return kept;
}

function leastImportantIndex(segments: Fittable[]): number {
  let worst = 0;
  segments.forEach((segment, index) => { if (segment.priority >= segments[worst].priority) worst = index; });
  return worst;
}

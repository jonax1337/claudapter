export type ScrollAnchor = { entryId: string; line: number } | null;
type Row = { entryId?: string; entryLine?: number };

export function viewportStart(lines: Row[], height: number, anchor: ScrollAnchor): number {
  const bottom = Math.max(0, lines.length - Math.max(1, height));
  if (!anchor) return bottom;
  const first = lines.findIndex(line => line.entryId === anchor.entryId);
  if (first < 0) return 0;
  const last = lines.findLastIndex(line => line.entryId === anchor.entryId);
  return Math.min(bottom, first + Math.min(anchor.line, last - first));
}

export function scrollViewport(lines: Row[], height: number, anchor: ScrollAnchor, delta: number): ScrollAnchor {
  const bottom = Math.max(0, lines.length - Math.max(1, height));
  const start = Math.max(0, Math.min(bottom, viewportStart(lines, height, anchor) + delta));
  if (start === bottom) return null;
  const row = lines[start];
  return row?.entryId ? { entryId: row.entryId, line: row.entryLine ?? 0 } : null;
}

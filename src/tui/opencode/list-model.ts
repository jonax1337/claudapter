// Pure helpers shared by the searchable list dialogs (command palette, session picker).

export interface ListGroup<T> { label: string; items: T[] }
export type ListRow<T> = { kind: 'header'; label: string } | { kind: 'item'; item: T; index: number };
/** A searchable text of an item and how strongly a match in it counts. */
export type SearchField = readonly [text: string | undefined, weight: number];

const SUBSTRING_BASE = 1000;
const SUBSTRING_POSITION_PENALTY = 2;
const WORD_START_BONUS = 100;
const SUBSEQUENCE_CAP = 500;
const SUBSEQUENCE_CHAR = 10;
const SUBSEQUENCE_CONSECUTIVE = 15;
const SUBSEQUENCE_WORD_START = 10;
const SUBSEQUENCE_MAX_GAP_PENALTY = 5;
const WORD_SEPARATOR = /[\s\-_/.:]/;

/** Higher is better; undefined when `text` does not match every whitespace-separated term of `query`. */
export function fuzzyScore(query: string, text: string): number | undefined {
  const terms = queryTerms(query);
  const haystack = text.toLowerCase();
  let total = 0;
  for (const term of terms) {
    const score = termScore(term, haystack);
    if (score === undefined) return undefined;
    total += score;
  }
  return total;
}

/** A stretch of text that either matched the search query or did not; consecutive matches merge. */
export interface TextRun { text: string; match: boolean }

/**
 * Character indices of `text` that make it match `query`, for highlighting: the substring a term matched,
 * or the characters of its fuzzy subsequence. Empty when the query is blank or does not match.
 */
export function matchPositions(query: string, text: string): number[] {
  const terms = queryTerms(query);
  const haystack = text.toLowerCase();
  const positions = new Set<number>();
  for (const term of terms) {
    const matched = termPositions(term, haystack);
    if (!matched) return [];
    matched.forEach(position => positions.add(position));
  }
  return [...positions].sort((left, right) => left - right);
}

/** Splits `text` into alternating plain and matched runs. */
export function highlightRuns(text: string, positions: number[]): TextRun[] {
  const matched = new Set(positions);
  const runs: TextRun[] = [];
  [...text].forEach((character, index) => {
    const match = matched.has(index);
    const last = runs.at(-1);
    if (last && last.match === match) last.text += character;
    else runs.push({ text: character, match });
  });
  return runs;
}

/** Items matching `query` best-first; ties keep their original order. An empty query keeps every item. */
export function rankItems<T>(items: T[], query: string, fields: (item: T) => readonly SearchField[]): T[] {
  if (!query.trim()) return items;
  return items.map((item, order) => ({ item, order, score: bestScore(query, fields(item)) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(entry => entry.item);
}

/** Flattens groups into rows, a header before each non-empty group; `index` counts items only. */
export function toRows<T>(groups: ListGroup<T>[]): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  let index = 0;
  for (const group of groups) {
    if (!group.items.length) continue;
    rows.push({ kind: 'header', label: group.label });
    for (const item of group.items) rows.push({ kind: 'item', item, index: index++ });
  }
  return rows;
}

/** Rows without headers, for filtered results that are ordered by relevance instead of by group. */
export function toFlatRows<T>(items: T[]): ListRow<T>[] {
  return items.map((item, index) => ({ kind: 'item', item, index }));
}

export function rowOfItem<T>(rows: ListRow<T>[], itemIndex: number): number {
  return Math.max(rows.findIndex(candidate => candidate.kind === 'item' && candidate.index === itemIndex), 0);
}

/** Row to scroll to for an item: its group header when it opens a group, so the header stays visible with it. */
export function revealStart<T>(rows: ListRow<T>[], itemIndex: number): number {
  const row = rowOfItem(rows, itemIndex);
  return row > 0 && rows[row - 1].kind === 'header' ? row - 1 : row;
}

/** New scroll offset that keeps rows `first..last` inside a viewport of `height` rows. */
export function scrollTopToReveal(top: number, height: number, first: number, last: number): number {
  if (first < top) return first;
  if (last >= top + height) return Math.max(first, last - height + 1);
  return top;
}

/** Moves a selection by `delta` and clamps it to the available items. */
export function moveSelection(current: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, current + delta));
}

function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function bestScore(query: string, fields: readonly SearchField[]): number | undefined {
  let best: number | undefined;
  for (const [text, weight] of fields) {
    const score = text === undefined ? undefined : fuzzyScore(query, text);
    if (score !== undefined && (best === undefined || score * weight > best)) best = score * weight;
  }
  return best;
}

function termScore(term: string, haystack: string): number | undefined {
  const at = haystack.indexOf(term);
  if (at < 0) return subsequenceScore(term, haystack);
  const wordStart = isWordStart(haystack, at) ? WORD_START_BONUS : 0;
  return SUBSTRING_BASE - at * SUBSTRING_POSITION_PENALTY + wordStart;
}

function termPositions(term: string, haystack: string): number[] | undefined {
  const at = haystack.indexOf(term);
  if (at >= 0) return Array.from({ length: term.length }, (_, offset) => at + offset);
  return subsequencePositions(term, haystack);
}

function subsequencePositions(term: string, haystack: string): number[] | undefined {
  const positions: number[] = [];
  let from = 0;
  for (const char of term) {
    const at = haystack.indexOf(char, from);
    if (at < 0) return undefined;
    positions.push(at);
    from = at + 1;
  }
  return positions;
}

function subsequenceScore(term: string, haystack: string): number | undefined {
  const positions = subsequencePositions(term, haystack);
  if (!positions) return undefined;
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const at of positions) {
    score += SUBSEQUENCE_CHAR - Math.min(at - from, SUBSEQUENCE_MAX_GAP_PENALTY);
    if (at === previous + 1) score += SUBSEQUENCE_CONSECUTIVE;
    if (isWordStart(haystack, at)) score += SUBSEQUENCE_WORD_START;
    previous = at;
    from = at + 1;
  }
  return Math.min(score, SUBSEQUENCE_CAP);
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || WORD_SEPARATOR.test(text[index - 1]);
}

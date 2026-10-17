import { Show, createMemo, createSignal } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { filetypeForPath, useSyntaxStyle } from './block-syntax';
import { useClick } from './block-click';
import { mix, useTheme } from './theme';

export type DiffKind = 'add' | 'remove' | 'context' | 'gap';

/**
 * One rendered row of a unified diff. `lineNumber` is only set when the real file position is known;
 * `oldLine`/`newLine` are the positions on each side (removals only have the old, additions only the new one).
 */
export interface DiffRow { kind: DiffKind; text: string; lineNumber?: number; oldLine?: number; newLine?: number }

export interface FileDiff { path: string; rows: DiffRow[]; added: number; removed: number }

const CONTEXT_LINES = 3;
const COLLAPSED_ROWS = 40;
/** Above this many table cells the LCS is skipped and the changed middle is shown as one replace block. */
const MAX_LCS_CELLS = 1_000_000;
const TAB_WIDTH = '  ';

type Fields = Record<string, unknown>;

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function rowsOf(kind: DiffKind, lines: string[]): DiffRow[] {
  return lines.map(text => ({ kind, text }));
}

function commonLength(before: string[], after: string[], fromEnd: boolean, limit: number): number {
  let length = 0;
  while (length < limit && (fromEnd
    ? before[before.length - 1 - length] === after[after.length - 1 - length]
    : before[length] === after[length])) length++;
  return length;
}

/** Longest-common-subsequence line diff of the already prefix/suffix-trimmed middle. */
function diffMiddle(before: string[], after: string[]): DiffRow[] {
  if (!before.length || !after.length) return [...rowsOf('remove', before), ...rowsOf('add', after)];
  if (before.length * after.length > MAX_LCS_CELLS) return [...rowsOf('remove', before), ...rowsOf('add', after)];
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'context', text: before[i++] });
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) rows.push({ kind: 'remove', text: before[i++] });
    else rows.push({ kind: 'add', text: after[j++] });
  }
  return [...rows, ...rowsOf('remove', before.slice(i)), ...rowsOf('add', after.slice(j))];
}

/** Full line diff (all context lines kept) between two texts. */
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const before = splitLines(oldText);
  const after = splitLines(newText);
  const limit = Math.min(before.length, after.length);
  const prefix = commonLength(before, after, false, limit);
  const suffix = commonLength(before, after, true, limit - prefix);
  return [
    ...rowsOf('context', before.slice(0, prefix)),
    ...diffMiddle(before.slice(prefix, before.length - suffix), after.slice(prefix, after.length - suffix)),
    ...rowsOf('context', before.slice(before.length - suffix)),
  ];
}

function gapRow(hidden: number): DiffRow {
  return { kind: 'gap', text: `⋯ ${hidden} unchanged ${hidden === 1 ? 'line' : 'lines'}` };
}

/** Keeps changed rows plus `context` neighbours; collapsed stretches become one gap row. */
export function trimContext(rows: DiffRow[], context = CONTEXT_LINES): DiffRow[] {
  const keep = new Uint8Array(rows.length);
  rows.forEach((row, index) => {
    if (row.kind === 'context') return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    for (let near = from; near <= to; near++) keep[near] = 1;
  });
  const trimmed: DiffRow[] = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (hidden && trimmed.length) trimmed.push(gapRow(hidden));
      hidden = 0;
      trimmed.push(row);
    } else hidden++;
  });
  return trimmed;
}

/** Assigns consecutive line numbers: removals use the old numbering, everything else the new one. */
export function numberRows(rows: DiffRow[], oldStart = 1, newStart = 1): DiffRow[] {
  let oldLine = oldStart;
  let newLine = newStart;
  return rows.map(row => {
    if (row.kind === 'gap') return row;
    if (row.kind === 'remove') return { ...row, lineNumber: oldLine, oldLine: oldLine++ };
    if (row.kind === 'add') return { ...row, lineNumber: newLine, newLine: newLine++ };
    return { ...row, lineNumber: newLine, oldLine: oldLine++, newLine: newLine++ };
  });
}

function asRecord(value: unknown): Fields | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;
}

function text(input: Fields, key: string): string {
  return typeof input[key] === 'string' ? input[key] as string : '';
}

const HUNK_PREFIX_KIND: Record<string, DiffKind> = { '+': 'add', '-': 'remove', ' ': 'context' };

/** Converts the `structuredPatch` hunks returned by Edit/Write into numbered rows with gaps between hunks. */
export function patchRows(patch: unknown): DiffRow[] {
  if (!Array.isArray(patch)) return [];
  const rows: DiffRow[] = [];
  let previousEnd: number | undefined;
  for (const hunk of patch) {
    const fields = asRecord(hunk);
    if (!fields || !Array.isArray(fields.lines)) continue;
    const oldStart = Number(fields.oldStart) || 1;
    if (previousEnd !== undefined && oldStart > previousEnd) rows.push(gapRow(oldStart - previousEnd));
    const body = (fields.lines as unknown[]).filter((line): line is string => typeof line === 'string' && line[0] !== '\\')
      .map(line => ({ kind: HUNK_PREFIX_KIND[line[0]] ?? 'context', text: line.slice(1) }) as DiffRow);
    rows.push(...numberRows(body, oldStart, Number(fields.newStart) || 1));
    previousEnd = oldStart + (Number(fields.oldLines) || 0);
  }
  return rows;
}

const HUNK_HEAD = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const OLD_FILE_HEAD = /^--- (?:a\/)?(.+)$/;
const NEW_FILE_HEAD = /^\+\+\+ (?:b\/)?(.+)$/;

/**
 * Splits a Git unified text diff into per-file diffs. The `+++` header names the file
 * (`---` supplies it for deletions where the new side is `/dev/null`); `@@` hunks restart
 * line numbering; marker lines and `\ No newline` notes are dropped.
 */
export function unifiedDiff(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let oldPath: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of splitLines(patch)) {
    const hunk = HUNK_HEAD.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); continue; }
    const oldHead = OLD_FILE_HEAD.exec(line);
    if (oldHead) { oldPath = oldHead[1]; continue; }
    const newHead = NEW_FILE_HEAD.exec(line);
    if (newHead) {
      const path = newHead[1] === '/dev/null' ? oldPath ?? newHead[1] : newHead[1];
      current = { path, rows: [], added: 0, removed: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    const kind = HUNK_PREFIX_KIND[line[0]];
    if (!kind) continue;
    const content = line.slice(1);
    if (kind === 'remove') { current.rows.push({ kind, text: content, lineNumber: oldLine, oldLine }); current.removed++; oldLine++; }
    else if (kind === 'add') { current.rows.push({ kind, text: content, lineNumber: newLine, newLine }); current.added++; newLine++; }
    else { current.rows.push({ kind, text: content, lineNumber: newLine, oldLine, newLine }); oldLine++; newLine++; }
  }
  return files.filter(file => file.rows.length);
}

function replacementRows(oldText: string, newText: string): DiffRow[] {
  return trimContext(lineDiff(oldText, newText));
}

function joinWithGaps(groups: DiffRow[][]): DiffRow[] {
  return groups.filter(group => group.length).flatMap((group, index) => index ? [{ kind: 'gap' as const, text: '⋯' }, ...group] : group);
}

function multiEditRows(input: Fields): DiffRow[] {
  const edits = Array.isArray(input.edits) ? input.edits.map(asRecord).filter((edit): edit is Fields => !!edit) : [];
  return joinWithGaps(edits.map(edit => replacementRows(text(edit, 'old_string'), text(edit, 'new_string'))));
}

function addedRows(content: string): DiffRow[] {
  return numberRows(rowsOf('add', splitLines(content)));
}

function rowsForTool(toolName: string, input: Fields, result: unknown): { path: string; rows: DiffRow[] } {
  const patch = patchRows(asRecord(result)?.structuredPatch);
  const path = text(input, 'file_path') || text(input, 'notebook_path') || text(input, 'path');
  switch (toolName) {
    case 'Edit': return { path, rows: patch.length ? patch : replacementRows(text(input, 'old_string'), text(input, 'new_string')) };
    case 'MultiEdit': return { path, rows: patch.length ? patch : multiEditRows(input) };
    case 'Write': return { path, rows: patch.length ? patch : addedRows(text(input, 'content')) };
    case 'NotebookEdit': return { path, rows: input.edit_mode === 'delete' ? [] : addedRows(text(input, 'new_source')) };
    default: return { path, rows: [] };
  }
}

export function countChanges(rows: DiffRow[]) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'add') added++;
    else if (row.kind === 'remove') removed++;
  }
  return { added, removed };
}

/** Builds the displayable diff of an edit-style tool call, or undefined when nothing changed. */
export function fileDiffFor(toolName: string, input: Fields, result?: unknown): FileDiff | undefined {
  const { path, rows } = rowsForTool(toolName, input, result);
  const { added, removed } = countChanges(rows);
  return added || removed ? { path, rows, added, removed } : undefined;
}

export function visibleRows(rows: DiffRow[], expanded: boolean): { shown: DiffRow[]; hidden: number } {
  if (expanded || rows.length <= COLLAPSED_ROWS) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, COLLAPSED_ROWS), hidden: rows.length - COLLAPSED_ROWS };
}

/** Terminal width from which a diff with both additions and removals is shown side by side. */
export const SPLIT_MIN_WIDTH = 120;

function hunksOf(rows: DiffRow[]): DiffRow[][] {
  const hunks: DiffRow[][] = [[]];
  for (const row of rows) {
    if (row.kind === 'gap') hunks.push([]);
    else hunks[hunks.length - 1].push(row);
  }
  return hunks.filter(hunk => hunk.length);
}

function hunkHeader(rows: DiffRow[]): string {
  const oldCount = rows.filter(row => row.kind !== 'add').length;
  const newCount = rows.filter(row => row.kind !== 'remove').length;
  const firstOld = rows.find(row => row.oldLine !== undefined)?.oldLine;
  const firstNew = rows.find(row => row.newLine !== undefined)?.newLine;
  const oldStart = oldCount ? firstOld ?? 1 : Math.max(0, (firstNew ?? 1) - 1);
  const newStart = newCount ? firstNew ?? 1 : Math.max(0, (firstOld ?? 1) - 1);
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

const PATCH_PREFIX: Record<DiffKind, string> = { add: '+', remove: '-', context: ' ', gap: ' ' };

/** Git-style unified patch of the rows, in the format the native diff renderable parses; gaps start a new hunk. */
export function toUnifiedPatch(path: string, rows: DiffRow[]): string {
  const hunks = hunksOf(rows).flatMap(hunk => [hunkHeader(hunk), ...hunk.map(row => PATCH_PREFIX[row.kind] + row.text.replaceAll('\t', TAB_WIDTH))]);
  return [`--- a/${path}`, `+++ b/${path}`, ...hunks].join('\n');
}

function viewFor(diff: FileDiff, width: number): 'split' | 'unified' {
  return width >= SPLIT_MIN_WIDTH && diff.added > 0 && diff.removed > 0 ? 'split' : 'unified';
}

/** Collapsed-by-default diff block: header with +/- counts, then the native diff (unified, or split on wide terminals). */
export function DiffView(props: { diff: FileDiff; expanded: boolean }) {
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const style = useSyntaxStyle();
  const [chosen, choose] = createSignal<boolean>();
  const open = () => chosen() ?? props.expanded;
  const toggle = useClick(() => choose(!open()));
  const slice = createMemo(() => visibleRows(props.diff.rows, open()));
  const patch = createMemo(() => toUnifiedPatch(props.diff.path, slice().shown));
  const numbered = () => slice().shown.some(row => row.lineNumber !== undefined);
  const lineBackground = (tint: string) => mix(theme().background, tint, 0.28);
  return (
    <box flexShrink={0} paddingLeft={2} marginTop={1}>
      <box onMouseUp={toggle}>
        <text fg={theme().muted}>
          {props.diff.path + ' '}
          <span style={{ fg: theme().diffAdded }}>{'+' + props.diff.added}</span>
          {' '}
          <span style={{ fg: theme().diffRemoved }}>{'−' + props.diff.removed}</span>
        </text>
      </box>
      <diff diff={patch()} view={viewFor(props.diff, dimensions().width)} filetype={filetypeForPath(props.diff.path)}
        syntaxStyle={style()} fg={theme().text} showLineNumbers={numbered()} wrapMode="word" width="100%"
        addedBg={theme().diffAddedBg} removedBg={theme().diffRemovedBg} contextBg={theme().panel}
        addedSignColor={theme().diffAdded} removedSignColor={theme().diffRemoved}
        lineNumberFg={theme().lineNumber} lineNumberBg={theme().panel}
        addedLineNumberBg={lineBackground(theme().success)} removedLineNumberBg={lineBackground(theme().error)} />
      <Show when={slice().hidden}>
        <box onMouseUp={toggle}><text fg={theme().muted}>{`… ${slice().hidden} more lines (ctrl+o to expand)`}</text></box>
      </Show>
    </box>
  );
}

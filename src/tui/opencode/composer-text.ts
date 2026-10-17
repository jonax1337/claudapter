import { fileURLToPath } from 'node:url';
import stringWidth from 'string-width';

/** Pastes with more lines than this are shown as one `[pasted N lines]` token. */
export const PASTE_COLLAPSE_LINES = 20;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;
const QUOTED = /^(["'])(.*)\1$/;

/** Pastes beyond this many characters are refused instead of freezing the prompt. */
export const MAX_PASTE_CHARS = 500_000;

export function pasteTooLarge(text: string) {
  return text.length > MAX_PASTE_CHARS;
}

export type PastedBlocks = ReadonlyMap<string, string>;

export function lineCount(text: string) {
  return text.split('\n').length;
}

export function shouldCollapsePaste(text: string) {
  return lineCount(text) > PASTE_COLLAPSE_LINES;
}

/** Unique token for a collapsed paste; equal line counts get a `#n` suffix so each token maps to one block. */
export function pasteToken(lines: number, taken: Iterable<string>) {
  const used = new Set(taken);
  const base = `[pasted ${lines} lines`;
  for (let ordinal = 1; ; ordinal++) {
    const token = base + (ordinal > 1 ? ` #${ordinal}` : '') + ']';
    if (!used.has(token)) return token;
  }
}

/** Swaps every collapsed-paste token for the full text it stands for; edited or deleted tokens stay literal. */
export function expandPastes(text: string, blocks: PastedBlocks) {
  let expanded = text;
  for (const [token, full] of blocks) expanded = expanded.split(token).join(full);
  return expanded;
}

/** A single trailing backslash before Enter means "continue on the next line". */
export function continuesLine(text: string) {
  return text.endsWith('\\');
}

export function withoutContinuation(text: string) {
  return text.slice(0, -1) + '\n';
}

/**
 * The image file a terminal pasted when a file is dropped onto it: bare, quoted, `file://`
 * or with shell-escaped spaces. Only the path shape is checked here; the caller verifies it exists.
 */
export function pastedImagePath(pasted: string): string | undefined {
  const trimmed = pasted.trim();
  if (!trimmed || trimmed.includes('\n')) return undefined;
  const unquoted = QUOTED.exec(trimmed)?.[2] ?? trimmed;
  const path = unquoted.startsWith('file://') ? fileUrlPath(unquoted) : unquoted.replace(/\\ /g, ' ');
  return path && IMAGE_PATH.test(path) ? path : undefined;
}

function fileUrlPath(url: string) {
  try { return fileURLToPath(url); }
  catch { return undefined; }
}

export interface Attachment {
  path: string;
}

export function attachmentChip(index: number) {
  return `[image ${index + 1} ✕]`;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** String index of a cursor given as logical row and display column (wide characters take two columns). */
export function cursorIndex(text: string, row: number, column: number) {
  const lines = text.split('\n');
  const line = lines[row] ?? '';
  const lineStart = lines.slice(0, row).reduce((total, previous) => total + previous.length + 1, 0);
  let width = 0;
  for (const { segment, index } of graphemes.segment(line)) {
    if (width >= column) return lineStart + index;
    width += stringWidth(segment);
  }
  return lineStart + line.length;
}

/** Inverse of {@link cursorIndex}: logical row and display column for a string index. */
export function cursorPosition(text: string, index: number) {
  const lines = text.slice(0, index).split('\n');
  return { row: lines.length - 1, column: stringWidth(lines[lines.length - 1]) };
}

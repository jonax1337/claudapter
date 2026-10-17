import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export const MAX_INDEXED_FILES = 5000;
export const MAX_MENTION_RESULTS = 6;
const INDEX_TTL_MS = 30_000;
const GIT_LISTING_BYTES = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', '__pycache__', 'vendor']);
const MENTION_BEFORE_CURSOR = /(?:^|\s)@([^\s@]*)$/;

export interface Mention {
  /** Offset of the `@` sign. */
  start: number;
  /** Offset after the last character of the token the cursor is in. */
  end: number;
  /** Text typed after the `@`, up to the cursor. */
  query: string;
}

/** Finds the `@mention` token under the cursor; an `@` inside a word (an e-mail address) is not a mention. */
export function mentionAt(text: string, cursor: number): Mention | undefined {
  const query = MENTION_BEFORE_CURSOR.exec(text.slice(0, cursor))?.[1];
  if (query === undefined) return undefined;
  const tokenRest = /^\S*/.exec(text.slice(cursor))![0];
  return { start: cursor - query.length - 1, end: cursor + tokenRest.length, query };
}

/** Rank 0 is the best match; undefined means the path does not match the needle at all. */
function matchRank(path: string, needle: string): number | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (path.includes(needle)) return 2;
  return isSubsequence(path, needle) ? 3 : undefined;
}

function isSubsequence(haystack: string, needle: string) {
  let position = 0;
  for (const character of haystack) if (character === needle[position] && ++position === needle.length) return true;
  return needle.length === 0;
}

const depthOf = (path: string) => path.split('/').length;

/** Case-insensitive fuzzy filter: name prefix, name substring, path substring, then scattered characters. */
export function rankFiles(files: readonly string[], query: string, limit = MAX_MENTION_RESULTS): string[] {
  const needle = query.toLowerCase();
  const ranked: { path: string; rank: number }[] = [];
  for (const path of files) {
    const rank = needle ? matchRank(path.toLowerCase(), needle) : 0;
    if (rank !== undefined) ranked.push({ path, rank });
  }
  ranked.sort((left, right) => left.rank - right.rank || depthOf(left.path) - depthOf(right.path) ||
    left.path.length - right.path.length || (left.path < right.path ? -1 : 1));
  return ranked.slice(0, limit).map(entry => entry.path);
}

/** Claude Code resolves `@path` and `@"path with spaces"` itself, so the composer only inserts text. */
export function mentionText(path: string) {
  return /\s/.test(path) ? '@"' + path + '"' : '@' + path;
}

/** Replaces the mention token with the chosen path and returns the new text and cursor offset. */
export function applyMention(text: string, mention: Mention, path: string) {
  const following = text.slice(mention.end);
  const separator = /^\s/.test(following) ? '' : ' ';
  const inserted = mentionText(path) + separator;
  return { text: text.slice(0, mention.start) + inserted + following, cursor: mention.start + inserted.length };
}

async function gitFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execute('git', ['--no-pager', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_LISTING_BYTES });
  return stdout.split('\0').filter(Boolean);
}

/** Breadth-first walk so shallow files survive the cap; skips dot-directories, build output and symlinks. */
async function walkFiles(cwd: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  const queue = [''];
  for (let directory = queue.shift(); directory !== undefined && files.length < limit; directory = queue.shift()) {
    let entries;
    try { entries = await readdir(cwd + '/' + directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const path = directory ? directory + '/' + entry.name : entry.name;
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) queue.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

/** Tracked and untracked-but-not-ignored files when `cwd` is a Git work tree, otherwise a bounded directory walk. */
export async function listWorkspaceFiles(cwd: string, limit = MAX_INDEXED_FILES): Promise<string[]> {
  const listed = [...new Set(await gitFiles(cwd).catch(() => walkFiles(cwd, limit)))];
  return listed.length > limit ? listed.sort((left, right) => depthOf(left) - depthOf(right)).slice(0, limit) : listed;
}

export interface FileIndex {
  files(): Promise<string[]>;
}

/** Shares one listing between keystrokes and refreshes it after `ttlMs`; failed listings are not cached. */
export function createFileIndex(load: () => Promise<string[]>, ttlMs = INDEX_TTL_MS, now: () => number = Date.now): FileIndex {
  let cached: { loadedAt: number; files: Promise<string[]> } | undefined;
  return {
    files() {
      if (!cached || now() - cached.loadedAt > ttlMs) {
        const files = load().catch(() => { cached = undefined; return [] as string[]; });
        cached = { loadedAt: now(), files };
      }
      return cached.files;
    },
  };
}

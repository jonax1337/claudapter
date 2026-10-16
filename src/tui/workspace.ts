import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { invokeCompat } from './compat.js';
import { safeText } from './editor.js';

const execute = promisify(execFile);
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPath = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !value.startsWith('\\\\') && !value.startsWith('//');

async function git(cwd: string, args: string[]): Promise<{ text: string; truncated: boolean }> {
  try {
    const result = await execute('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
      cwd, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' },
    });
    return { text: result.stdout, truncated: false };
  } catch (error: any) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { text: typeof error.stdout === 'string' ? error.stdout : '', truncated: true };
    throw new Error('Git inspection failed: ' + safeText(String(error.stderr || error.message)).trim().slice(0,1000));
  }
}

export async function workspaceDiff(cwd: string, staged = false): Promise<{ diff: string; untracked: string[]; truncated: boolean; staged: boolean }> {
  const results = await Promise.all([
    git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--color=never', ...(staged ? ['--cached'] : []), '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const [diff, files] = results;
  const names = files.text.split('\0');
  // The final name can be incomplete when Git's output hit the cap.
  if (files.truncated || names.at(-1) === '') names.pop();
  return { diff: safeText(diff.text), untracked: names.map(name => safeText(name)), truncated: diff.truncated || files.truncated, staged };
}

/** Grant file access only; don't promote other scopes' rules into the trusted flag layer. */
export async function addWorkspaceDirectory(query: Query, cwd: string, input: string, confirmed: boolean): Promise<{ directory: string; workspaceDirectories: unknown[] }> {
  if (confirmed !== true) throw new Error('Adding a working directory requires explicit confirmation.');
  if (!validPath(input)) throw new Error('Choose a local directory without hidden or control characters.');
  const directory = await realpath(resolve(cwd, input));
  if (!validPath(directory) || !(await stat(directory)).isDirectory()) throw new Error('The selected path is not a local directory.');
  const snapshot = await invokeCompat(query, 'getSettings');
  const flags = snapshot.sources.find((source: any) => source?.source === 'flagSettings')?.settings;
  const permissions = object(flags?.permissions) ? flags.permissions : {};
  const existing = permissions.additionalDirectories;
  if (existing !== undefined && (!Array.isArray(existing) || !existing.every((value: unknown) => typeof value === 'string'))) throw new Error('Native flag directory settings have an unexpected shape.');
  const directories = [...new Set([...(existing ?? []), directory])];
  await query.applyFlagSettings({ permissions: { ...permissions, additionalDirectories: directories } });
  const state = (await invokeCompat(query, 'listPermissionRules')).state;
  if (!state.workspaceDirectories.some((entry: any) => typeof entry.path === 'string' && resolve(entry.path) === directory)) throw new Error('The native engine did not grant the requested directory. Existing policy remains authoritative.');
  return { directory, workspaceDirectories: state.workspaceDirectories };
}

export async function outputStyles(query: Query): Promise<{ current: string; styles: string[] }> {
  const refreshed = await query.reloadOutputStyles();
  const snapshot = await invokeCompat(query, 'getSettings');
  const initialized = await query.initializationResult();
  const styles = refreshed.available_output_styles;
  if (!Array.isArray(styles) || !styles.every(style => typeof style === 'string')) throw new Error('Native output-style list has an unexpected shape.');
  return { current: typeof snapshot.effective.outputStyle === 'string' ? snapshot.effective.outputStyle : initialized.output_style, styles };
}

export async function setOutputStyle(query: Query, style: string): Promise<void> {
  const available = await outputStyles(query);
  if (!available.styles.includes(style)) throw new Error('Choose an output style offered by this session.');
  await query.applyFlagSettings({ outputStyle: style });
  const current = await invokeCompat(query, 'getSettings');
  if (current.effective.outputStyle !== style) throw new Error('The native engine did not apply this output style. Check higher-priority settings.');
}

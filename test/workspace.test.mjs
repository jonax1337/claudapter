import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspaceDiff, addWorkspaceDirectory, outputStyles, setOutputStyle } from '../dist/tui/workspace.js';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'claudapter-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('workspace diff disables external diff/text conversion and lists untracked files separately', async t => {
  const cwd = await temporary(t);
  const git = args => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  git(['init', '--quiet']);
  await writeFile(join(cwd, 'tracked.txt'), 'before\n');
  await writeFile(join(cwd, '.gitattributes'), '*.txt diff=fixture\n');
  git(['add', '--', 'tracked.txt', '.gitattributes']);
  git(['config', 'diff.external', 'definitely-not-an-installed-program']);
  git(['config', 'diff.fixture.textconv', 'definitely-not-an-installed-program']);
  git(['config', 'core.fsmonitor', 'definitely-not-an-installed-program']);
  await writeFile(join(cwd, 'tracked.txt'), 'after\n');
  await writeFile(join(cwd, 'untracked file.txt'), 'untracked\n');
  const index = await readFile(join(cwd, '.git', 'index'));
  const diff = await workspaceDiff(cwd);
  assert.match(diff.diff, /-before/); assert.match(diff.diff, /\+after/);
  assert.deepEqual(diff.untracked, ['untracked file.txt']);
  assert.equal(diff.truncated, false); assert.equal(diff.staged, false);
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
  const staged = await workspaceDiff(cwd, true);
  assert.match(staged.diff, /\+before/); assert.equal(staged.staged, true);
});

test('additional directories preserve flag rules and do not promote untrusted project rules', async t => {
  const cwd = await temporary(t), target = join(cwd, 'target'); await mkdir(target);
  let applied;
  const q = {
    initializationResult: async () => ({ claude_code_version: '2.1.301' }),
    getSettings: async () => ({ effective: { permissions: { allow: ['Bash(untrusted-project)'], deny: ['Bash(policy-deny)'] } },
      sources: [{ source: 'flagSettings', settings: { permissions: { allow: ['Read(existing)'], additionalDirectories: ['C:/existing'] } } }] }),
    applyFlagSettings: async settings => { applied = settings; },
    listPermissionRules: async () => ({ state: { rules: [], workspaceDirectories: [{ path: await realpath(target), source: 'flagSettings' }], managedOnly: false } }),
  };
  await assert.rejects(addWorkspaceDirectory(q, cwd, 'target', false), /confirmation/);
  await assert.rejects(addWorkspaceDirectory(q, cwd, '\\\\server\\share', true), /local directory/);
  const added = await addWorkspaceDirectory(q, cwd, 'target', true);
  assert.deepEqual(applied.permissions.allow, ['Read(existing)']);
  assert.deepEqual(applied.permissions.additionalDirectories, ['C:/existing', await realpath(target)]);
  assert.equal(applied.permissions.deny, undefined);
  assert.equal(added.directory, await realpath(target));
  q.listPermissionRules = async () => ({ state: { rules: [], workspaceDirectories: [], managedOnly: true } });
  await assert.rejects(addWorkspaceDirectory(q, cwd, 'target', true), /did not grant/);
});

test('output style picker uses native catalog and applies only a selected known style', async () => {
  const calls = [];
  let current = 'Explanatory';
  const q = { initializationResult: async () => ({ claude_code_version: '2.1.301', output_style: 'default' }),
    getSettings: async () => ({ effective: { outputStyle: current }, sources: [] }),
    reloadOutputStyles: async () => ({ available_output_styles: ['default', 'Explanatory', 'Learning'] }),
    applyFlagSettings: async settings => { calls.push(settings); current = settings.outputStyle; } };
  assert.equal((await outputStyles(q)).current, 'Explanatory');
  await assert.rejects(setOutputStyle(q, 'not-installed'), /offered/);
  await setOutputStyle(q, 'Learning');
  assert.deepEqual(calls, [{ outputStyle: 'Learning' }]);
  q.applyFlagSettings = async () => {};
  await assert.rejects(setOutputStyle(q, 'default'), /did not apply/);
});

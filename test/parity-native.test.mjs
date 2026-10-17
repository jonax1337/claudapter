import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from '../dist/config.js';
import { Registry } from '../dist/models.js';
import { invokeCompat } from '../dist/tui/compat.js';
import { TuiController } from '../dist/tui/controller.js';
import { askSideQuestion, requireSideQuestion, sideQuestionOf } from '../dist/tui/side-question.js';
import { changeWorkingDirectory, resolveTargetDirectory } from '../dist/tui/working-directory.js';
import { officialUrl, openOfficialPage } from '../dist/tui/external-link.js';
import { checkpointExcerpt, summarizeFromCheckpointCommand } from '../dist/tui/checkpoint-summary.js';
import { confirmationText, OFFICIAL_PAGES, TUTORIAL_SECTIONS, UNAVAILABLE_FEATURES, unavailableText } from '../dist/tui/parity-info.js';
import { defaultPreferences, loadPreferences, savePreferences } from '../dist/tui/preferences.js';

const fakeQuery = extra => ({ initializationResult: async () => ({ claude_code_version: '2.1.301' }), ...extra });
const temporary = async () => realpath(await mkdtemp(join(tmpdir(), 'claudapter-parity-')));

// Side questions -----------------------------------------------------------

test('/btw is recognised only at the start and keeps the question text', () => {
  assert.equal(sideQuestionOf('/btw what is a monad?'), 'what is a monad?');
  assert.equal(sideQuestionOf('  /btw   spaced  '), 'spaced');
  assert.equal(sideQuestionOf('/btw'), '');
  assert.equal(sideQuestionOf('/btwx nope'), undefined);
  assert.equal(sideQuestionOf('please /btw later'), undefined);
  assert.throws(() => requireSideQuestion('   '), /Ask a question/);
  assert.throws(() => requireSideQuestion('x'.repeat(4001)), /limited to 4000/);
});

test('side questions go through the pinned private method with confirmation, never the input queue', async () => {
  const calls = [];
  const query = fakeQuery({ askSideQuestion: async (question, options) => { calls.push({ question, options }); return { response: 'An answer\u001b[2J', synthetic: false }; } });
  const abort = new AbortController();
  const answer = await askSideQuestion(query, '  why?  ', abort.signal);
  assert.deepEqual(answer, { text: 'An answer', synthetic: false, fallbackModel: undefined });
  assert.equal(calls[0].question, 'why?');
  assert.equal(calls[0].options.signal, abort.signal);
  assert.equal(await askSideQuestion(fakeQuery({ askSideQuestion: async () => null }), 'why?'), undefined);
  const refused = await askSideQuestion(fakeQuery({ askSideQuestion: async () => ({ response: 'ok', synthetic: true, refusalFallback: { fallbackModel: 'gpt-fixture' } }) }), 'why?');
  assert.deepEqual([refused.synthetic, refused.fallbackModel], [true, 'gpt-fixture']);
});

test('side-question compatibility rejects unverified engines, unconfirmed calls and malformed answers', async () => {
  let called = false;
  const query = fakeQuery({ initializationResult: async () => ({ claude_code_version: '2.1.400' }), askSideQuestion: async () => { called = true; return null; } });
  await assert.rejects(invokeCompat(query, 'askSideQuestion', { question: 'q', confirmed: true }), /requires/);
  assert.equal(called, false);
  const live = fakeQuery({ askSideQuestion: async () => ({ response: 1 }) });
  await assert.rejects(invokeCompat(live, 'askSideQuestion', { question: 'q' }), /explicit confirmation/);
  await assert.rejects(invokeCompat(live, 'askSideQuestion', { question: 'q', confirmed: true, extra: 1 }), /valid arguments/);
  await assert.rejects(invokeCompat(live, 'askSideQuestion', { question: 'q', confirmed: true, signal: {} }), /signal/);
  await assert.rejects(invokeCompat(live, 'askSideQuestion', { question: 'q', confirmed: true }), /Unexpected native/);
});

// /cd --------------------------------------------------------------------------

test('target directories resolve relative to the session, expand home and must exist', async () => {
  const base = await temporary();
  await mkdir(join(base, 'child'));
  await writeFile(join(base, 'file.txt'), 'x');
  assert.equal(await resolveTargetDirectory(base, 'child'), join(base, 'child'));
  assert.equal(await resolveTargetDirectory(join(base, 'child'), '..'), base);
  await assert.rejects(resolveTargetDirectory(base, 'missing'), /Not a directory/);
  await assert.rejects(resolveTargetDirectory(base, 'file.txt'), /Not a directory/);
  await assert.rejects(resolveTargetDirectory(base, '  '), /Name a directory/);
});

const host = async (overrides = {}) => {
  const cwd = await temporary();
  const target = await temporary();
  const requests = [];
  const query = fakeQuery({ setCwd: async (path, consent) => {
    requests.push({ path, consent });
    return consent ? { status: 'ok', cwd: target, changed: true } : { status: 'ok', cwd: target, changed: true };
  } });
  return { cwd, target, requests, host: { cwd, query, args: [], config: defaults(), registry: new Registry([]), confirmTrust: async () => false, ...overrides } };
};

test('/cd relocates through the native method after validating the target settings', async () => {
  const { host: h, target, requests } = await host();
  assert.deepEqual(await changeWorkingDirectory(h, target), { cwd: target, changed: true });
  assert.deepEqual(requests, [{ path: target, consent: undefined }]);
});

test('/cd to the current directory is a no-op that never calls the engine', async () => {
  const { host: h, cwd, requests } = await host();
  assert.deepEqual(await changeWorkingDirectory(h, cwd), { cwd, changed: false });
  assert.equal(requests.length, 0);
});

test('/cd refuses a target whose settings override the gateway before touching the engine', async () => {
  const { host: h, target, requests } = await host();
  await mkdir(join(target, '.claude'));
  await writeFile(join(target, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://elsewhere.invalid' } }));
  await assert.rejects(changeWorkingDirectory(h, target), /conflicting gateway/);
  assert.equal(requests.length, 0);
  await writeFile(join(target, '.claude', 'settings.json'), '{broken');
  await assert.rejects(changeWorkingDirectory(h, target), /Cannot parse settings/);
  assert.equal(requests.length, 0);
});

test('/cd into an untrusted directory needs fresh consent for the exact directory and answers the challenge once', async () => {
  const { cwd, target } = await host();
  const requests = [];
  const asked = [];
  const query = fakeQuery({ setCwd: async (path, consent) => {
    requests.push({ path, consent });
    return consent ? { status: 'ok', cwd: target, changed: true } : { status: 'needs_trust', directory: target, trust_root: target };
  } });
  const h = { cwd, query, args: [], config: defaults(), registry: new Registry([]), confirmTrust: async directory => { asked.push(directory); return true; } };
  assert.deepEqual(await changeWorkingDirectory(h, target), { cwd: target, changed: true });
  assert.deepEqual(asked, [target]);
  assert.deepEqual(requests.map(request => request.consent), [undefined, { trustAccepted: true, trustedDirectory: target }]);
});

test('declining trust or an engine rejection leaves the session where it was', async () => {
  const { cwd, target } = await host();
  const calls = [];
  const untrusted = fakeQuery({ setCwd: async (path, consent) => { calls.push(consent); return { status: 'needs_trust', directory: target, trust_root: target }; } });
  const base = { cwd, args: [], config: defaults(), registry: new Registry([]) };
  await assert.rejects(changeWorkingDirectory({ ...base, query: untrusted, confirmTrust: async () => false }, target), /not trusted/);
  assert.deepEqual(calls, [undefined]);
  const rejected = fakeQuery({ setCwd: async () => ({ status: 'rejected', reason: 'policy', message: 'blocked by policy' }) });
  await assert.rejects(changeWorkingDirectory({ ...base, query: rejected, confirmTrust: async () => true }, target), /blocked by policy/);
});

test('the controller adopts the new directory, refreshes its lists and asks trust through its own dialog', async () => {
  const { cwd, target } = await host();
  const originalCwd = process.cwd();
  process.chdir(cwd);
  try {
    const controller = new TuiController([], defaults());
    const query = fakeQuery({
      setCwd: async (path, consent) => consent ? { status: 'ok', cwd: target, changed: true } : { status: 'needs_trust', directory: target, trust_root: target },
      supportedAgents: async () => [{ name: 'project-agent' }],
      supportedCommands: async () => [{ name: 'project-skill' }],
      getContextUsage: async () => ({ totalTokens: 1 }),
    });
    Object.assign(controller, { query, session: { registry: new Registry([]) }, cwd });
    controller.state.ready = true;
    const moving = controller.changeDirectory(target);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(controller.state.pending[0].title, 'Do you trust this project?');
    assert.ok(controller.state.pending[0].description.includes(target));
    assert.equal(controller.state.pending[0].choices[controller.state.pending[0].defaultIndex].value, false);
    controller.answer(controller.state.pending[0].id, true);
    assert.equal(await moving, target);
    assert.equal(controller.cwd, target);
    assert.equal(await realpath(process.cwd()), target);
    assert.deepEqual(controller.state.agents, [{ name: 'project-agent' }]);
    assert.deepEqual(controller.state.commands, [{ name: 'project-skill' }]);
    assert.match(controller.state.entries.at(-1).text, /Working directory changed/);
  } finally { process.chdir(originalCwd); }
});

test('the controller refuses to move during a turn or before the engine is ready', async () => {
  const controller = new TuiController([], defaults());
  await assert.rejects(controller.changeDirectory('.'), /still starting/);
  controller.state.busy = true;
  await assert.rejects(controller.changeDirectory('.'), /Interrupt or finish/);
});

// Account pages ------------------------------------------------------------------

test('only official https pages can be opened and only through the supplied opener', async () => {
  for (const url of ['http://claude.ai/upgrade', 'https://evil.example/upgrade', 'https://claude.ai.evil.example/x', 'https://user:pw@claude.ai/x', 'https://claude.ai:8443/x', 'file:///etc/passwd', 'javascript:alert(1)', 'nonsense']) {
    assert.throws(() => officialUrl(url), /Refusing|Not a valid/);
  }
  const opened = [];
  for (const page of OFFICIAL_PAGES) assert.equal(await openOfficialPage(page.url, async url => { opened.push(url); }), page.url);
  assert.deepEqual(opened, OFFICIAL_PAGES.map(page => page.url));
  await assert.rejects(openOfficialPage('https://claude.ai/x', async () => { throw new Error('no browser'); }), /no browser/);
});

test('page confirmations name the exact URL and promise nothing is sent', () => {
  for (const page of OFFICIAL_PAGES) {
    const text = confirmationText(page);
    assert.ok(text.includes(page.url));
    assert.match(text, /sends nothing/);
  }
});

// Native-only entries ------------------------------------------------------------

test('native-only features explain themselves, point to native claude and claim nothing', () => {
  assert.deepEqual(UNAVAILABLE_FEATURES.map(feature => feature.command).sort(), ['/artifacts', '/cloud', '/ide', '/passes', '/voice']);
  for (const feature of UNAVAILABLE_FEATURES) {
    const text = unavailableText(feature);
    assert.match(text, /native `claude`/);
    assert.match(text, /nothing was started/);
    assert.doesNotMatch(text, /enabled|connected|started successfully/i);
  }
});

test('the tutorial only names commands that exist in the registry or the documented keys', () => {
  const named = TUTORIAL_SECTIONS.flatMap(section => section.rows.map(row => row.label));
  assert.ok(named.some(label => label.startsWith('/btw')));
  assert.ok(named.some(label => label.startsWith('/cd')));
  assert.ok(named.includes('/vim') && named.includes('/keymap'));
});

// Checkpoint summarization ---------------------------------------------------------

test('checkpoint summaries are an honest whole-conversation /compact focused on the checkpoint', () => {
  const command = summarizeFromCheckpointCommand('Fix the "login" bug\nin auth.ts');
  assert.ok(command.startsWith('/compact '));
  assert.ok(command.includes("Fix the 'login' bug in auth.ts"));
  assert.doesNotMatch(command, /\n/);
  assert.equal(checkpointExcerpt('x'.repeat(500)).length, 160);
});

// Preferences ---------------------------------------------------------------------

test('the editor mode round-trips, defaults to absent and rejects unknown values', async () => {
  const home = await temporary();
  assert.equal('editorMode' in defaultPreferences(), false);
  await savePreferences({ ...defaultPreferences(), editorMode: 'vim' }, home);
  assert.equal((await loadPreferences(home)).editorMode, 'vim');
  await writeFile(join(home, 'ui.json'), JSON.stringify({ editorMode: 'emacs' }));
  await assert.rejects(loadPreferences(home), /normal or vim/);
});

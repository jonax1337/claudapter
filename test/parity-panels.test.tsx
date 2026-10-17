import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testRender } from '@opentui/solid';
import type { JSX } from 'solid-js';
import { defaultTextareaKeyBindings } from '@opentui/core';
import { createActions } from '../src/tui/opencode/actions';
import { SideQuestionPanel } from '../src/tui/opencode/side-question-view';
import { editorMode, setEditorMode } from '../src/tui/opencode/editor-mode';
import { effectiveTextareaBindings, keymapSections, SESSION_SHORTCUTS } from '../src/tui/opencode/keymap';
import { KILL_BINDINGS } from '../src/tui/opencode/composer-vim';
import { commandGroup, NATIVE_ONLY_GROUP } from '../src/tui/opencode/palette';
import { loadPreferences } from '../dist/tui/preferences.js';
import { describeNativeDialog, nativeDialogKinds } from '../dist/tui/native-dialogs.js';

beforeAll(() => { process.env.CLAUDAPTER_HOME = mkdtempSync(join(tmpdir(), 'claudapter-panels-')); });

const FRAME_WAIT_MS = 2000;
async function frameContaining(view: Awaited<ReturnType<typeof testRender>>, text: string) {
  const deadline = Date.now() + FRAME_WAIT_MS;
  await view.renderOnce();
  while (!view.captureCharFrame().includes(text) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    await view.renderOnce();
  }
  return view.captureCharFrame();
}

function harness(overrides: Record<string, unknown> = {}, options = {}) {
  const log = {
    menus: [] as { title: string; items: any[] }[], views: [] as { title: string; value: unknown }[], forms: [] as { title: string; submit(fields: Record<string, string>): unknown }[],
    confirms: [] as { title: string; description: string; action(): unknown }[], panels: [] as ((close: () => void) => JSX.Element)[],
    snapshots: [] as { title: string; value: any }[], closed: 0, sent: [] as string[], notices: [] as string[], moved: [] as string[],
  };
  const controller: any = {
    state: { commands: [{ name: 'cloud' }, { name: 'ide' }], models: [], entries: [], tasks: {}, agents: [], busy: false }, cwd: process.cwd(),
    send: (text: string) => log.sent.push(text), notice: (text: string) => log.notices.push(text),
    changeDirectory: async (path: string) => { log.moved.push(path); return path; }, ...overrides,
  };
  const dialogs: any = {
    menu: (title: string, items: any[]) => log.menus.push({ title, items }), view: (title: string, value: unknown) => log.views.push({ title, value }),
    form: (title: string, _d: string, _f: unknown, submit: (fields: Record<string, string>) => unknown) => log.forms.push({ title, submit }),
    confirm: (title: string, description: string, action: () => unknown) => log.confirms.push({ title, description, action }),
    close: () => { log.closed++; }, recall() {}, appearance() {}, toggle() {}, panel: (render: (close: () => void) => JSX.Element) => log.panels.push(render),
    snapshot: (title: string, value: any) => log.snapshots.push({ title, value }),
  };
  return { log, controller, ...createActions(controller, dialogs, async () => {}, options) };
}

test('/btw asks on the side while a turn is running and shows the answer without touching the conversation', async () => {
  let resolveAnswer: (value: unknown) => void = () => {};
  const asked: { question: string; signal?: AbortSignal }[] = [];
  const query = {
    initializationResult: async () => ({ claude_code_version: '2.1.301' }),
    askSideQuestion: (question: string, options?: { signal?: AbortSignal }) => { asked.push({ question, signal: options?.signal }); return new Promise(resolve => { resolveAnswer = resolve; }); },
  };
  const { log, execute, controller } = harness({ query, state: { commands: [], models: [], entries: [], tasks: {}, agents: [], busy: true } });
  await execute('/btw what does this flag do?');
  expect(asked.map(call => call.question)).toEqual(['what does this flag do?']);
  expect(log.sent).toEqual([]);
  expect(controller.state.entries).toEqual([]);
  const view = await testRender(() => log.panels[0](() => {}), { width: 100, height: 30 });
  try {
    expect(await frameContaining(view, 'without interrupting the main turn')).toContain('what does this flag do?');
    resolveAnswer({ response: 'It enables verbose output.', synthetic: false });
    const frame = await frameContaining(view, 'It enables verbose output.');
    expect(frame).toContain('Not saved to the conversation.');
  } finally { view.renderer.destroy(); }
});

test('escape on a pending side question aborts the engine request and closes the panel', async () => {
  const signals: AbortSignal[] = [];
  const query = {
    initializationResult: async () => ({ claude_code_version: '2.1.301' }),
    askSideQuestion: (_question: string, options?: { signal?: AbortSignal }) => { signals.push(options!.signal!); return new Promise(() => {}); },
  };
  const { log, execute } = harness({ query });
  await execute('/btw anything');
  let closed = 0;
  const view = await testRender(() => log.panels[0](() => { closed++; }), { width: 100, height: 30 });
  try {
    await view.renderOnce();
    view.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 80));
    await view.renderOnce();
    expect(signals[0].aborted).toBe(true);
    expect(closed).toBe(1);
  } finally { view.renderer.destroy(); }
});

test('a failed side question reports the failure inside the panel', async () => {
  const view = await testRender(() => <SideQuestionPanel question="q" task={Promise.reject(new Error('Engine refused the request'))} onCancel={() => {}} onClose={() => {}} />, { width: 100, height: 30 });
  try {
    expect(await frameContaining(view, 'Engine refused the request')).toContain('Side question');
  } finally { view.renderer.destroy(); }
});

test('/btw without a question lists earlier side questions and rejects when there are none', async () => {
  const query = { initializationResult: async () => ({ claude_code_version: '2.1.301' }), askSideQuestion: async () => ({ response: 'ok', synthetic: false }) };
  const { log, execute } = harness({ query });
  await expect(execute('/btw')).rejects.toThrow('No side questions yet');
  await execute('/btw first one');
  await execute('/btw second one');
  await execute('/btw');
  expect(log.menus.at(-1)!.title).toBe('Earlier side questions');
  expect(log.menus.at(-1)!.items.map(item => item.title)).toEqual(['second one', 'first one']);
  await expect(execute('/btw ' + 'x'.repeat(4001))).rejects.toThrow('limited to 4000');
});

test('/cd forwards its argument to the controller and asks for a path when none is given', async () => {
  const { log, execute } = harness();
  await execute('/cd ../other project');
  expect(log.moved).toEqual(['../other project']);
  expect(log.closed).toBe(1);
  await execute('/cd');
  expect(log.forms[0].title).toBe('Change directory');
  await log.forms[0].submit({ path: 'sub' });
  expect(log.moved).toEqual(['../other project', 'sub']);
});

test('/vim toggles the editor mode and remembers it', async () => {
  setEditorMode('normal');
  const { log, execute } = harness();
  await execute('/vim');
  expect(editorMode()).toBe('vim');
  expect((await loadPreferences()).editorMode).toBe('vim');
  expect(log.notices.at(-1)).toContain('Vim mode on');
  await execute('/vim');
  expect(editorMode()).toBe('normal');
  expect((await loadPreferences()).editorMode).toBe('normal');
  setEditorMode('normal');
});

test('the keyboard reference is generated from the registered bindings', async () => {
  const { log, execute } = harness();
  await execute('/keymap');
  const sections = log.snapshots[0].value.sections as { title: string; rows: { label: string; value: string }[] }[];
  const titles = sections.map(section => section.title);
  expect(titles).toEqual(expect.arrayContaining(['Prompt', 'Session', 'Prompt editing', 'Kill ring']));
  expect(titles.some(title => title.startsWith('Vim mode'))).toBe(true);
  const rows = sections.flatMap(section => section.rows);
  for (const binding of KILL_BINDINGS) expect(rows.some(row => row.label === binding.chord && row.value === binding.description)).toBe(true);
  expect(rows.some(row => row.label.includes('ctrl+a') && row.value === 'Start of line')).toBe(true);
  expect(rows.some(row => row.label.includes('ctrl+-') && row.value === 'Undo')).toBe(true);
});

test('every textarea action and the composer overrides appear in the reference', () => {
  const rows = keymapSections({ 'ctrl+o': '/thinking' }).find(section => section.title === 'Prompt editing')!.rows;
  const effective = effectiveTextareaBindings();
  expect(new Set(effective.map(binding => binding.action)).size).toBe(rows.length);
  expect(effective.length).toBeGreaterThanOrEqual(defaultTextareaKeyBindings.length);
  const enter = effective.find(binding => binding.name === 'return' && !binding.ctrl && !binding.meta && !binding.shift && !binding.super);
  expect(enter?.action).toBe('submit');
  expect(effective.find(binding => binding.name === 'return' && binding.shift)?.action).toBe('newline');
  expect(keymapSections({ 'ctrl+o': '/thinking' }).find(section => section.title.startsWith('Your shortcuts'))!.rows)
    .toEqual([{ label: 'ctrl+o', value: '/thinking' }]);
});

test('session shortcuts listed in the reference are still registered in the source that handles them', () => {
  for (const shortcut of SESSION_SHORTCUTS) {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'tui', 'opencode', shortcut.file), 'utf8');
    expect(source.includes(shortcut.source), `${shortcut.chord} in ${shortcut.file}`).toBe(true);
  }
});

test('the tutorial opens as a structured reference', async () => {
  const { log, execute } = harness();
  await execute('/tutorial');
  expect(log.snapshots[0].title).toBe('Getting started');
  expect(log.snapshots[0].value.sections.length).toBeGreaterThanOrEqual(4);
});

test('native-only features open an honest explanation and are never forwarded to Claude Code', async () => {
  const { log, execute, controller } = harness();
  for (const command of ['/cloud', '/artifacts', '/ide', '/voice', '/passes']) await execute(command);
  expect(log.views).toHaveLength(5);
  for (const view of log.views) {
    expect(view.title).toContain('not available in Claudapter');
    expect(String(view.value)).toContain('native `claude`');
  }
  expect(log.sent).toEqual([]);
  expect(controller.state.commands.some((command: { name: string }) => command.name === 'cloud')).toBe(true);
  for (const command of ['/cloud', '/artifacts', '/ide', '/voice', '/passes']) expect(commandGroup(command)).toBe(NATIVE_ONLY_GROUP);
});

test('unsupported native dialogs stay cancelled instead of being handed to the native UI', () => {
  for (const kind of nativeDialogKinds) expect(/cloud|voice|artifact|teleport|ide_/.test(kind), kind).toBe(false);
  for (const dialogKind of ['cloud_environment_picker', 'artifact_selector', 'voice_setup', 'ide_onboarding', 'passes_offer']) {
    expect(describeNativeDialog({ dialogKind, payload: {} })).toBeUndefined();
  }
});

test('account pages open only after the user confirms and only the official URL', async () => {
  const opened: string[] = [];
  const { log, execute } = harness({}, { openBrowser: async (url: string) => { opened.push(url); } });
  await execute('/privacy');
  await execute('/upgrade');
  expect(opened).toEqual([]);
  expect(log.confirms.map(confirm => confirm.title)).toEqual(['Open Privacy settings?', 'Open Plan and upgrade?']);
  expect(log.confirms[0].description).toContain('https://claude.ai/settings/data-privacy-controls');
  await log.confirms[0].action();
  expect(opened).toEqual(['https://claude.ai/settings/data-privacy-controls']);
  expect(log.notices.at(-1)).toContain('claude.ai');
  expect(log.closed).toBe(1);
});

test('the palette lists the new commands under their groups and the composer offers them', () => {
  const { commands } = harness();
  const names = commands().map(command => command.name);
  for (const name of ['/btw', '/cd', '/vim', '/keymap', '/tutorial', '/account', '/privacy', '/upgrade', '/cloud', '/artifacts', '/ide', '/voice', '/passes']) expect(names).toContain(name);
  expect(commandGroup('/btw')).toBe('Session');
  expect(commandGroup('/keymap')).toBe('View');
  expect(commandGroup('/privacy')).toBe('Account');
  expect(names.filter(name => name === '/cloud')).toHaveLength(1);
});

test('checkpoint actions offer a confirmed, honest summary that sends a focused /compact', async () => {
  const query = { rewindFiles: async () => ({ canRewind: true }) };
  const { log, execute, controller } = harness({ query, state: { commands: [], models: [], entries: [{ id: 'u1', kind: 'user', text: 'Fix the login bug' }], tasks: {}, agents: [], busy: false } });
  await execute('/rewind');
  await log.menus[0].items[0].run();
  const summarize = log.menus.at(-1)!.items.find(item => item.title === 'Summarize from here');
  expect(summarize.description).toContain('whole conversation');
  summarize.run();
  expect(log.confirms.at(-1)!.description).toContain('condenses the earlier part');
  expect(log.sent).toEqual([]);
  await log.confirms.at(-1)!.action();
  expect(log.sent).toHaveLength(1);
  expect(log.sent[0].startsWith('/compact ')).toBe(true);
  expect(log.sent[0]).toContain('Fix the login bug');
  controller.state.busy = true;
  expect(() => log.confirms.at(-1)!.action()).toThrow('Wait for the turn');
});

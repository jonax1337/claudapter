import { test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { SessionPicker, type SessionPickerActions } from '../src/tui/opencode/sessions';
import { Menu, type MenuItem } from '../src/tui/opencode/menu';
import { createActions, type ActionDialogs } from '../src/tui/opencode/actions';
import { fuzzyScore, rankItems, toRows } from '../src/tui/opencode/list-model';
import {
  groupSessions, latestOtherSession, relativeTime, resolveSession, searchSessions, sessionGroup, sessionTitle,
} from '../src/tui/opencode/sessions-model';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 17, 10, 0, 0).getTime();
const midnight = new Date(2026, 9, 17, 0, 0, 0).getTime();

function session(id: string, overrides: Partial<SDKSessionInfo> = {}): SDKSessionInfo {
  return { sessionId: id, summary: 'Session ' + id, lastModified: NOW - MINUTE, ...overrides };
}

const FIXTURES: SDKSessionInfo[] = [
  session('aaaa1111-0000-4000-8000-000000000001', { summary: 'Fix login redirect', lastModified: NOW - 12 * MINUTE, gitBranch: 'feature/login', firstPrompt: 'The login redirect loops forever', fileSize: 12_000 }),
  session('bbbb2222-0000-4000-8000-000000000002', { summary: 'Refactor billing', customTitle: 'Billing cleanup', lastModified: midnight - HOUR, gitBranch: 'main' }),
  session('cccc3333-0000-4000-8000-000000000003', { summary: 'Write release notes', lastModified: NOW - 3 * DAY, tag: 'docs' }),
  session('dddd4444-0000-4000-8000-000000000004', { summary: 'Old experiment', lastModified: NOW - 40 * DAY }),
];

async function settle(view: Awaited<ReturnType<typeof testRender>>) {
  await new Promise(resolve => setTimeout(resolve, 30));
  await view.renderOnce();
  return view.captureCharFrame();
}

function fakeActions(overrides: Partial<SessionPickerActions> = {}) {
  const calls: string[] = [];
  const actions: SessionPickerActions = {
    load: async () => FIXTURES,
    resume: async picked => { calls.push('resume:' + picked.sessionId.slice(0, 4)); },
    remove: async picked => { calls.push('remove:' + picked.sessionId.slice(0, 4)); },
    rename: async (picked, title) => { calls.push('rename:' + picked.sessionId.slice(0, 4) + ':' + title); },
    fork: async picked => { calls.push('fork:' + picked.sessionId.slice(0, 4)); },
    ...overrides,
  };
  return { actions, calls };
}

async function renderPicker(actions: SessionPickerActions, size = { width: 100, height: 30 }, onClose = () => {}) {
  const view = await testRender(() => <SessionPicker actions={actions} currentId={FIXTURES[0].sessionId} now={() => NOW} onClose={onClose} />, size);
  await settle(view);
  return view;
}

test('relativeTime uses compact units and clamps the future', () => {
  expect(relativeTime(NOW - 30_000, NOW)).toBe('just now');
  expect(relativeTime(NOW + HOUR, NOW)).toBe('just now');
  expect(relativeTime(NOW - 12 * MINUTE, NOW)).toBe('12m ago');
  expect(relativeTime(NOW - 59 * MINUTE, NOW)).toBe('59m ago');
  expect(relativeTime(NOW - HOUR, NOW)).toBe('1h ago');
  expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe('23h ago');
  expect(relativeTime(NOW - 2 * DAY, NOW)).toBe('2d ago');
  expect(relativeTime(NOW - 7 * DAY, NOW)).toBe('1w ago');
  expect(relativeTime(NOW - 45 * DAY, NOW)).toBe('1mo ago');
  expect(relativeTime(NOW - 400 * DAY, NOW)).toBe('1y ago');
});

test('sessions are grouped by local calendar day boundaries', () => {
  expect(sessionGroup(midnight, NOW)).toBe('Today');
  expect(sessionGroup(midnight - 1, NOW)).toBe('Yesterday');
  expect(sessionGroup(midnight - DAY, NOW)).toBe('Yesterday');
  expect(sessionGroup(midnight - DAY - 1, NOW)).toBe('This week');
  expect(sessionGroup(midnight - 6 * DAY, NOW)).toBe('This week');
  expect(sessionGroup(midnight - 6 * DAY - 1, NOW)).toBe('Older');
  expect(sessionGroup(NOW + DAY, NOW)).toBe('Today');
  const groups = groupSessions([...FIXTURES].reverse(), NOW);
  expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday', 'This week', 'Older']);
  expect(groups[0].items[0].summary).toBe('Fix login redirect');
});

test('title falls back from custom title to summary to first prompt to id', () => {
  expect(sessionTitle(session('x', { customTitle: 'Mine', summary: 'Auto' }))).toBe('Mine');
  expect(sessionTitle(session('x', { summary: '' , firstPrompt: 'line one\nline two' }))).toBe('line one line two');
  expect(sessionTitle(session('abcdef123456', { summary: '' }))).toBe('abcdef12');
});

test('fuzzy scoring prefers substrings, word starts and tighter matches', () => {
  expect(fuzzyScore('zzz', 'login')).toBeUndefined();
  expect(fuzzyScore('', 'anything')).toBe(0);
  const substring = fuzzyScore('log', 'login')!;
  const subsequence = fuzzyScore('lgn', 'login')!;
  expect(substring).toBeGreaterThan(subsequence);
  expect(fuzzyScore('log', 'login')!).toBeGreaterThan(fuzzyScore('log', 'the catalog')!);
  expect(fuzzyScore('fix log', 'Fix login redirect')).toBeDefined();
  expect(fuzzyScore('fix zzz', 'Fix login redirect')).toBeUndefined();
  const ranked = rankItems(['restore files', 'resume', 'rename'], 're', item => [[item, 1]]);
  expect(ranked).toEqual(['restore files', 'resume', 'rename']);
  expect(rankItems(['b-session', 'a-login'], 'login', item => [[item, 1]])).toEqual(['a-login']);
});

test('session search ranks title above prompt and matches branch, tag and id prefix', () => {
  expect(searchSessions(FIXTURES, '').map(item => item.sessionId.slice(0, 4))).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd']);
  expect(searchSessions(FIXTURES, 'login')[0].sessionId).toBe(FIXTURES[0].sessionId);
  expect(searchSessions(FIXTURES, 'billing')[0].sessionId).toBe(FIXTURES[1].sessionId);
  expect(searchSessions(FIXTURES, 'docs').map(item => item.tag)).toEqual(['docs']);
  expect(searchSessions(FIXTURES, 'main').map(item => item.gitBranch)).toEqual(['main']);
  expect(searchSessions(FIXTURES, 'cccc3').map(item => item.sessionId.slice(0, 4))).toEqual(['cccc']);
  expect(searchSessions(FIXTURES, 'nothing-like-this')).toEqual([]);
});

test('session references resolve by id, id prefix or unique title prefix', () => {
  expect(resolveSession(FIXTURES, FIXTURES[2].sessionId).summary).toBe('Write release notes');
  expect(resolveSession(FIXTURES, 'bbbb').customTitle).toBe('Billing cleanup');
  expect(resolveSession(FIXTURES, 'billing c').customTitle).toBe('Billing cleanup');
  expect(() => resolveSession(FIXTURES, 'nope')).toThrow('No saved session matches');
  const twins = [session('same-1', { summary: 'Twin' }), session('same-2', { summary: 'Twin' })];
  expect(() => resolveSession(twins, 'twin')).toThrow('2 saved sessions match');
  expect(latestOtherSession(FIXTURES, FIXTURES[0].sessionId).sessionId).toBe(FIXTURES[1].sessionId);
  expect(() => latestOtherSession([FIXTURES[0]], FIXTURES[0].sessionId)).toThrow('No other saved session');
});

test('picker lists recency groups, relative times, branches and marks the open session', async () => {
  const { actions } = fakeActions();
  const view = await renderPicker(actions);
  try {
    const frame = view.captureCharFrame();
    for (const label of ['Today', 'Yesterday', 'This week', 'Older']) expect(frame).toContain(label);
    expect(frame).toContain('● Fix login redirect');
    expect(frame).toContain('12m ago');
    expect(frame).toContain('feature/login');
    expect(frame).toContain('Billing cleanup');
    expect(frame).toContain('The login redirect loops forever');
    expect(frame).toContain(FIXTURES[0].sessionId);
  } finally { view.renderer.destroy(); }
});

test('typing filters live, arrows move, and enter resumes the highlighted session', async () => {
  const { actions, calls } = fakeActions();
  let closed = 0;
  const view = await renderPicker(actions, { width: 100, height: 30 }, () => { closed++; });
  try {
    await view.mockInput.typeText('b');
    await settle(view);
    expect(view.captureCharFrame()).not.toContain('Write release notes');
    await view.mockInput.typeText('illing');
    const filtered = await settle(view);
    expect(filtered).toContain('Billing cleanup');
    expect(filtered).not.toContain('Fix login redirect');
    expect(filtered).not.toContain('Yesterday');
    view.mockInput.pressEnter();
    await settle(view);
    expect(calls).toEqual(['resume:bbbb']);
    expect(closed).toBe(1);
  } finally { view.renderer.destroy(); }
});

test('arrow keys, end and home move the selection through grouped rows', async () => {
  const { actions, calls } = fakeActions();
  const view = await renderPicker(actions);
  try {
    view.mockInput.pressArrow('down');
    view.mockInput.pressArrow('down');
    await settle(view);
    view.mockInput.pressEnter();
    await settle(view);
    expect(calls).toEqual(['resume:cccc']);
  } finally { view.renderer.destroy(); }
  const second = fakeActions();
  const again = await renderPicker(second.actions);
  try {
    again.mockInput.pressKey('END');
    await settle(again);
    again.mockInput.pressEnter();
    await settle(again);
    expect(second.calls).toEqual(['resume:dddd']);
  } finally { again.renderer.destroy(); }
});

test('ctrl+d asks for confirmation before deleting and escape backs out', async () => {
  const { actions, calls } = fakeActions();
  const view = await renderPicker(actions);
  try {
    view.mockInput.pressKey('d', { ctrl: true });
    const confirming = await settle(view);
    expect(confirming).toContain('Delete “Fix login redirect”?');
    expect(calls).toEqual([]);
    view.mockInput.pressEscape();
    const cancelled = await settle(view);
    expect(cancelled).not.toContain('Delete “');
    expect(calls).toEqual([]);
    view.mockInput.pressKey('d', { ctrl: true });
    await settle(view);
    view.mockInput.pressEnter();
    const afterDelete = await settle(view);
    expect(calls).toEqual(['remove:aaaa']);
    expect(afterDelete).not.toContain('Fix login redirect');
    expect(afterDelete).toContain('Billing cleanup');
  } finally { view.renderer.destroy(); }
});

test('delete failures stay in the picker as an error', async () => {
  const { actions } = fakeActions({ remove: async () => { throw new Error('Close the current session before deleting it.'); } });
  const view = await renderPicker(actions);
  try {
    view.mockInput.pressKey('d', { ctrl: true });
    await settle(view);
    view.mockInput.pressEnter();
    const frame = await settle(view);
    expect(frame).toContain('Close the current session before deleting it.');
    expect(frame).toContain('Fix login redirect');
  } finally { view.renderer.destroy(); }
});

test('ctrl+r renames inline and ctrl+f forks', async () => {
  const { actions, calls } = fakeActions();
  let closed = 0;
  const view = await renderPicker(actions, { width: 100, height: 30 }, () => { closed++; });
  try {
    view.mockInput.pressKey('r', { ctrl: true });
    await settle(view);
    await view.mockInput.typeText('!');
    view.mockInput.pressEnter();
    const renamed = await settle(view);
    expect(calls).toEqual(['rename:aaaa:Fix login redirect!']);
    expect(renamed).toContain('Fix login redirect!');
    view.mockInput.pressKey('f', { ctrl: true });
    await settle(view);
    expect(calls).toEqual(['rename:aaaa:Fix login redirect!', 'fork:aaaa']);
    expect(closed).toBe(1);
  } finally { view.renderer.destroy(); }
});

test('resuming shows progress until the controller is ready and surfaces errors', async () => {
  let finish = () => {};
  const { actions } = fakeActions({ resume: () => new Promise<void>(resolve => { finish = resolve; }) });
  let closed = 0;
  const view = await renderPicker(actions, { width: 100, height: 30 }, () => { closed++; });
  try {
    view.mockInput.pressEnter();
    const progress = await settle(view);
    expect(progress).toContain('Resuming “Fix login redirect”');
    expect(closed).toBe(0);
    finish();
    await settle(view);
    expect(closed).toBe(1);
  } finally { view.renderer.destroy(); }
  const failing = fakeActions({ resume: async () => { throw new Error('Claude Code failed to start.'); } });
  const second = await renderPicker(failing.actions);
  try {
    second.mockInput.pressEnter();
    const frame = await settle(second);
    expect(frame).toContain('Claude Code failed to start.');
    expect(frame).toContain('Fix login redirect');
  } finally { second.renderer.destroy(); }
});

test('picker shows loading, empty and failed states', async () => {
  const loading = await renderPicker(fakeActions({ load: () => new Promise(() => {}) }).actions);
  try { expect(loading.captureCharFrame()).toContain('Loading sessions'); } finally { loading.renderer.destroy(); }
  const empty = await renderPicker(fakeActions({ load: async () => [] }).actions);
  try { expect(empty.captureCharFrame()).toContain('No saved sessions in this directory'); } finally { empty.renderer.destroy(); }
  let attempts = 0;
  const failing = await renderPicker(fakeActions({ load: async () => { if (attempts++ === 0) throw new Error('Disk unavailable.'); return FIXTURES; } }).actions);
  try {
    expect(failing.captureCharFrame()).toContain('Disk unavailable.');
    failing.mockInput.pressEnter();
    expect(await settle(failing)).toContain('Fix login redirect');
  } finally { failing.renderer.destroy(); }
  const noMatch = await renderPicker(fakeActions().actions);
  try {
    await noMatch.mockInput.typeText('qqqq');
    expect(await settle(noMatch)).toContain('No sessions match “qqqq”');
  } finally { noMatch.renderer.destroy(); }
});

test('picker stays usable at 44 columns', async () => {
  const { actions, calls } = fakeActions();
  const view = await renderPicker(actions, { width: 44, height: 24 });
  try {
    const frame = view.captureCharFrame();
    expect(frame).toContain('Fix login redirect');
    expect(frame).toContain('12m ago');
    expect(frame).toContain('^d delete');
    expect(frame).toContain('enter resume');
    for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(44);
    view.mockInput.pressEnter();
    await settle(view);
    expect(calls).toEqual(['resume:aaaa']);
  } finally { view.renderer.destroy(); }
});

test('grouped menu shows headings, keeps order and filters across groups with shortcuts', async () => {
  const picked: string[] = [];
  const items: MenuItem[] = [
    { title: '/resume', description: 'Pick a session', group: 'Session', run: () => { picked.push('resume'); } },
    { title: '/mode', description: 'Cycle permission mode', group: 'Model & Mode', hint: 'shift+tab', run: () => { picked.push('mode'); } },
    { title: '/review', description: 'Skill', group: 'Skills & Commands', run: () => { picked.push('review'); } },
  ];
  const view = await testRender(() => <Menu title="Commands" items={items} onClose={() => {}} />, { width: 80, height: 24 });
  try {
    const frame = await settle(view);
    for (const heading of ['Session', 'Model & Mode', 'Skills & Commands']) expect(frame).toContain(heading);
    expect(frame).toContain('shift+tab');
    await view.mockInput.typeText('mde');
    const filtered = await settle(view);
    expect(filtered).not.toContain('Session');
    expect(filtered).toContain('/mode');
    view.mockInput.pressEnter();
    expect(picked).toEqual(['mode']);
  } finally { view.renderer.destroy(); }
  expect(toRows([{ label: 'A', items: [1, 2] }, { label: 'Empty', items: [] }, { label: 'B', items: [3] }]).map(row => row.kind === 'header' ? row.label : row.index))
    .toEqual(['A', 0, 1, 'B', 2]);
});

type Recorded = { menus: { title: string; items: MenuItem[] }[]; recalled: string[]; sent: string[]; notices: string[]; panels: number };

function actionHarness(commands: object[], overrides: Record<string, unknown> = {}) {
  const recorded: Recorded = { menus: [], recalled: [], sent: [], notices: [], panels: 0 };
  const controller = {
    state: { commands, models: [], entries: [], tasks: {}, agents: [], permissionMode: 'default', sessionId: FIXTURES[0].sessionId },
    cwd: '.', send: (text: string) => recorded.sent.push(text), notice: (text: string) => recorded.notices.push(text),
    changed() {}, sessions: async () => FIXTURES, resume: async (id: string) => { recorded.sent.push('resume:' + id.slice(0, 4)); },
    ...overrides,
  };
  const dialogs: ActionDialogs = {
    menu: (title, items) => recorded.menus.push({ title, items }), view() {}, form() {}, confirm() {}, close() {},
    recall: text => recorded.recalled.push(text), appearance() {}, toggle() {},
  };
  return { ...createActions(controller as any, dialogs, async () => {}), recorded, controller, dialogs };
}

test('palette lists built-ins and Claude Code skills by group and inserts commands that need arguments', async () => {
  const harness = actionHarness([
    { name: 'review', description: 'Review a pull request', argumentHint: '<pr>' },
    { name: 'init', description: 'Create CLAUDE.md' },
  ]);
  await harness.execute('/help');
  const [{ title, items }] = harness.recorded.menus;
  expect(title).toBe('Commands');
  const groups = [...new Set(items.map(item => item.group))];
  expect(groups.slice(0, 3)).toEqual(['Session', 'Model & Mode', 'View']);
  expect(groups.at(-1)).toBe('Skills & Commands');
  expect(items.find(item => item.title === '/tasks')?.hint).toBe('ctrl+t');
  expect(items.find(item => item.title === '/mode')?.hint).toBe('shift+tab');
  const review = items.find(item => item.title === '/review')!;
  expect(review.description).toBe('<pr>  Review a pull request');
  await review.run();
  expect(harness.recorded.recalled).toEqual(['/review ']);
  await items.find(item => item.title === '/init')!.run();
  expect(harness.recorded.sent).toEqual(['/init']);
});

test('slash commands forward skills, report unknown names and accept arguments', async () => {
  const harness = actionHarness([{ name: 'review', description: 'Review' }, { name: 'plan', description: 'Plan' }]);
  await harness.execute('/review 42');
  await harness.execute('/plan build the importer');
  expect(harness.recorded.sent).toEqual(['/review 42', '/plan build the importer']);
  await expect(harness.execute('/rewiev')).rejects.toThrow('Unknown command: /rewiev');
  await expect(harness.execute('/usage now')).rejects.toThrow('/usage takes no arguments');
  await harness.execute('/resume bbbb');
  expect(harness.recorded.sent.at(-1)).toBe('resume:bbbb');
  await harness.execute('/continue');
  expect(harness.recorded.sent.at(-1)).toBe('resume:bbbb');
  await expect(harness.execute('/resume zzz')).rejects.toThrow('No saved session matches');
});

test('/mode cycles through the controller when it supports it and lists modes otherwise', async () => {
  let cycled = 0;
  const cycling = actionHarness([], { cyclePermissionMode: () => { cycled++; } });
  await cycling.execute('/mode');
  expect(cycled).toBe(1);
  expect(cycling.recorded.notices).toEqual(['Permission mode: default']);
  const plain = actionHarness([]);
  await plain.execute('/mode');
  expect(plain.recorded.menus[0].items.map(item => item.title)).toEqual(['default', 'acceptEdits', 'plan']);
  await expect(plain.execute('/mode bypassPermissions')).rejects.toThrow('Unknown mode');
});

test('/tasks opens the task panel when wired and /sessions opens the picker panel', async () => {
  const harness = actionHarness([]);
  let tasks = 0;
  let panels = 0;
  harness.dialogs.tasks = () => { tasks++; };
  harness.dialogs.panel = () => { panels++; };
  await harness.execute('/tasks');
  await harness.execute('/sessions');
  await harness.execute('/resume bbbb');
  expect([tasks, panels]).toEqual([1, 2]);
});

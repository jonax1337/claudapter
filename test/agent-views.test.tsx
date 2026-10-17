import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { App } from '../src/tui/opencode/app';
import {
  MAIN_VIEW, RELAY_NOTES, ViewHistory, addresseeOf, agentSummary, agentTabs, cycleView, relayLine, routeLabel,
  type AgentRouteMap, type AgentStreamMap,
} from '../src/tui/opencode/agent-model';
import type { TaskMap, TaskView } from '../src/tui/opencode/tasks-model';
import type { TranscriptEntry } from '../src/tui/opencode/transcript';

// Fixture state shaped like the controller's; mock data, not a live session.
const FRAME_WAIT_MS = 2000;
const NOW = Date.now();

function task(id: string, fields: Partial<TaskView> = {}): TaskView {
  return { id, kind: 'agent', title: id, status: 'running', startedAt: NOW - 5000, ...fields };
}

const TASKS: TaskMap = {
  'agent-a': task('agent-a', { title: 'Search code', subagentType: 'Explore', totalTokens: 1200, background: true, startedAt: NOW - 9000 }),
  'agent-b': task('agent-b', { title: 'Run tests', subagentType: 'general-purpose', status: 'failed', endedAt: NOW - 1000, startedAt: NOW - 8000 }),
  shell: { id: 'shell', kind: 'shell', title: 'npm test', status: 'running', startedAt: NOW - 7000 },
};
const STREAMS: AgentStreamMap = {
  'agent-a': { id: 'agent-a', revision: 3, entries: 1, lastAction: 'Read src/a.ts' },
  'agent-b': { id: 'agent-b', revision: 2, entries: 1 },
};
const ROUTES: AgentRouteMap = {
  'agent-a': { requested: 'gpt-6-sol', actual: 'gpt-6-sol', provider: 'chatgpt' },
  'agent-b': { requested: 'gpt-6-sol', actual: 'glm-5.3', provider: 'zai', reason: 'rate_limit' },
};
const AGENT_TEXT: Record<string, TranscriptEntry[]> = {
  'agent-a': [{ id: 'block:a1:0', kind: 'assistant', text: 'Agent A found the bug in parser.ts' }],
  'agent-b': [{ id: 'block:b1:0', kind: 'assistant', text: 'Agent B could not run the suite' }],
};

function fixtureController(messaging = true) {
  const sentToAgents: [string, string][] = [];
  const sentToMain: string[] = [];
  const controller = {
    state: { ready: true, busy: false, model: 'opus', status: 'Ready', pending: [], tasks: TASKS, agentStreams: STREAMS, agentRoutes: ROUTES, agentMessaging: messaging,
      entries: [
        { id: 'block:m1:0', kind: 'assistant', text: 'Main agent delegates the work.' },
        { id: 'tool:call-a', kind: 'tool', text: 'Agent', toolName: 'Agent', status: 'done', taskId: 'agent-a', input: { description: 'Search code', subagent_type: 'Explore', prompt: 'Find it' } },
        { id: 'tool:call-b', kind: 'tool', text: 'Agent', toolName: 'Agent', status: 'done', taskId: 'agent-b', input: { description: 'Run tests', prompt: 'Run' } },
      ] },
    subscribe: () => () => {}, answer() {}, cancelDialog() {},
    send: (text: string) => { sentToMain.push(text); },
    agentEntries: (id: string) => AGENT_TEXT[id] ?? [],
    sendToAgent: (id: string, text: string) => { sentToAgents.push([id, text]); },
  };
  return { controller, sentToAgents, sentToMain };
}

async function renderApp(messaging = true) {
  const fixture = fixtureController(messaging);
  const view = await testRender(() => <App controller={fixture.controller} />, { width: 120, height: 30 });
  return { view, ...fixture };
}

async function frameContaining(view: Awaited<ReturnType<typeof testRender>>, text: string) {
  const deadline = Date.now() + FRAME_WAIT_MS;
  await view.renderOnce();
  while (!view.captureCharFrame().includes(text) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    await view.renderOnce();
  }
  return view.captureCharFrame();
}

describe('agent model', () => {
  test('tabs list main first, then agents oldest first; shells and housekeeping get no tab', () => {
    const tabs = agentTabs({ ...TASKS, quiet: task('quiet', { hidden: true }) }, { ...STREAMS, orphan: { id: 'orphan', revision: 1, entries: 1 } });
    expect(tabs.map(tab => tab.id)).toEqual([MAIN_VIEW, 'agent-a', 'agent-b', 'orphan']);
    expect(tabs.map(tab => tab.label)).toEqual(['main', 'Explore', 'general-purpose', 'orphan']);
    expect(tabs[2].status).toBe('failed');
  });

  test('cycling wraps in both directions and falls back to main for a vanished view', () => {
    const tabs = agentTabs(TASKS, STREAMS);
    expect(cycleView(MAIN_VIEW, tabs, 1)).toBe('agent-a');
    expect(cycleView(MAIN_VIEW, tabs, -1)).toBe('agent-b');
    expect(cycleView('agent-b', tabs, 1)).toBe(MAIN_VIEW);
    expect(cycleView('gone', tabs, 1)).toBe(MAIN_VIEW);
  });

  test('view history returns to the previous view and forgets views that no longer exist', () => {
    const history = new ViewHistory();
    history.open('agent-a'); history.open('agent-b');
    history.back();
    expect(history.view).toBe('agent-a');
    history.open('agent-b');
    history.retain(id => id !== 'agent-b');
    expect(history.view).toBe('agent-a');
    history.back();
    expect(history.view).toBe(MAIN_VIEW);
  });

  test('the composer addressee states how a message travels or why it cannot', () => {
    expect(addresseeOf('agent-a', TASKS['agent-a'], true)).toEqual({ label: '→ Explore', canSend: true, note: RELAY_NOTES.running });
    expect(addresseeOf('agent-a', { ...TASKS['agent-a'], background: false }, true).note).toBe(RELAY_NOTES.foreground);
    expect(addresseeOf('agent-b', TASKS['agent-b'], true).note).toBe(RELAY_NOTES.finished);
    expect(addresseeOf('agent-b', { ...TASKS['agent-b'], status: 'stopped' }, true).note).toBe(RELAY_NOTES.stopped);
    expect(addresseeOf('agent-a', TASKS['agent-a'], false)).toMatchObject({ canSend: false, note: RELAY_NOTES.unavailable });
  });

  test('summary rows show the routed model, fallback, tokens and the live action; history launches use the tool input', () => {
    expect(routeLabel(ROUTES['agent-b'])).toBe('glm-5.3 · zai ↪ gpt-6-sol rate limit');
    expect(routeLabel({ requested: 'opus', actual: 'glm-5.3', provider: 'zai' })).toBe('glm-5.3 · zai ↪ opus');
    const live = agentSummary({ status: 'done' }, { task: TASKS['agent-a'], stream: STREAMS['agent-a'], route: ROUTES['agent-a'] }, NOW);
    expect(live).toMatchObject({ title: 'Search code', type: 'Explore', status: 'running', elapsedMs: 9000, tokens: 1200, route: 'gpt-6-sol · chatgpt', hint: 'Read src/a.ts' });
    const history = agentSummary({ status: 'error', input: { description: 'Old run', subagent_type: 'Plan' } }, {}, NOW);
    expect(history).toMatchObject({ title: 'Old run', type: 'Plan', status: 'failed' });
    expect(relayLine({ status: 'delivered', text: 'x', detail: 'Message queued', at: 0 })).toBe('Delivered: Message queued');
  });
});

describe('agent views', () => {
  test('the main transcript shows one summary row per agent and the tab strip, never agent stream text', async () => {
    const { view } = await renderApp();
    try {
      const frame = await frameContaining(view, 'Main agent delegates the work.');
      expect(frame).toContain('Search code');
      expect(frame).toContain('Explore');
      expect(frame).toContain('gpt-6-sol');
      expect(frame).toContain('glm-5.3');
      expect(frame).toContain('1.2K tok');
      expect(frame).toMatch(/main · .*Explore · .*general-purpose/);
      expect(frame).not.toContain('Agent A found the bug');
      expect(frame).not.toContain('Agent B could not run');
    } finally { view.renderer.destroy(); }
  });

  test('alt+→ opens the next agent view, esc returns to main', async () => {
    const { view } = await renderApp();
    try {
      await frameContaining(view, 'Search code');
      view.mockInput.pressArrow('right', { meta: true });
      let frame = await frameContaining(view, 'Agent A found the bug');
      expect(frame).toContain('→ Explore');
      expect(frame).not.toContain('Main agent delegates the work.');
      view.mockInput.pressArrow('right', { meta: true });
      frame = await frameContaining(view, 'Agent B could not run');
      expect(frame).toContain('glm-5.3');
      view.mockInput.pressEscape();
      frame = await frameContaining(view, 'Agent A found the bug');
      view.mockInput.pressEscape();
      frame = await frameContaining(view, 'Main agent delegates the work.');
      expect(frame).not.toContain('Agent A found the bug');
    } finally { view.renderer.destroy(); }
  });

  test('the composer of an agent view sends to that agent, not to the main agent', async () => {
    const { view, sentToAgents, sentToMain } = await renderApp();
    try {
      await frameContaining(view, 'Search code');
      view.mockInput.pressArrow('right', { meta: true });
      await frameContaining(view, 'Agent A found the bug');
      await view.mockInput.typeText('steer toward the lexer');
      view.mockInput.pressEnter();
      await frameContaining(view, '→ Explore');
      expect(sentToAgents).toEqual([['agent-a', 'steer toward the lexer']]);
      expect(sentToMain).toEqual([]);
    } finally { view.renderer.destroy(); }
  });

  test('without SendMessage the agent composer is disabled and says why', async () => {
    const { view, sentToAgents } = await renderApp(false);
    try {
      await frameContaining(view, 'Search code');
      view.mockInput.pressArrow('right', { meta: true });
      const frame = await frameContaining(view, 'no SendMessage tool');
      expect(frame).toContain('Agent A found the bug');
      await view.mockInput.typeText('ignored');
      view.mockInput.pressEnter();
      expect(sentToAgents).toEqual([]);
    } finally { view.renderer.destroy(); }
  });

  test('clicking a summary row opens that agent view', async () => {
    const { view } = await renderApp();
    try {
      const frame = await frameContaining(view, 'Run tests');
      const row = frame.split('\n').findIndex(line => line.includes('Run tests') && line.includes('general-purpose'));
      expect(row).toBeGreaterThanOrEqual(0);
      await view.mockMouse.click(frame.split('\n')[row].indexOf('Run tests') + 2, row);
      const opened = await frameContaining(view, 'Agent B could not run');
      expect(opened).toContain('→ general-purpose');
    } finally { view.renderer.destroy(); }
  });
});

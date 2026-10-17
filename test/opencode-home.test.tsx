import { test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import { Home } from '../src/tui/opencode/home';
import { Composer } from '../src/tui/opencode/composer';
import { App } from '../src/tui/opencode/app';
import { DecisionDialog } from '../src/tui/opencode/decision';
import { createActions } from '../src/tui/opencode/actions';
import { UsagePanel } from '../src/tui/opencode/usage-view';
import { ContextPanel } from '../src/tui/opencode/context-view';
import { WorkspaceDiffPanel } from '../src/tui/opencode/workspace-diff';
import { SettingsPanel } from '../src/tui/opencode/settings';
import { SnapshotPanel } from '../src/tui/opencode/snapshot-view';
import { Menu } from '../src/tui/opencode/menu';
import { toolSummary } from '../src/tui/opencode/transcript';
import { Spinner, StatusBar, formatReset, meterCells } from '../src/tui/opencode/status';
import { fitSegments } from '../src/tui/opencode/layout';
import { activeTickers } from '../src/tui/opencode/clock';
import { shortcutGroups } from '../src/tui/opencode/shortcuts';

const FRAME_WAIT_MS = 2000;

/** Markdown parses off the render thread, so a frame may need several passes to show new text. */
async function frameContaining(view: Awaited<ReturnType<typeof testRender>>, text: string) {
  const deadline = Date.now() + FRAME_WAIT_MS;
  await view.renderOnce();
  while (!view.captureCharFrame().includes(text) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    await view.renderOnce();
  }
  return view.captureCharFrame();
}

test('tool calls show a one-line summary and expandable details', async () => {
  const entry = { id: 'tool:t1', kind: 'tool', text: 'Read', toolName: 'Read', status: 'done', details: '{"file_path":"src/a.ts"}\n\nresult body' };
  const controller = { state: { ready: true, busy: false, model: 'fixture', status: 'Ready', entries: [entry], pending: [] },
    subscribe: () => () => {}, send() {}, answer() {}, cancelDialog() {} };
  const view = await testRender(() => <App controller={controller} />, { width: 100, height: 24 });
  try {
    const frame = await frameContaining(view, 'Read src/a.ts');
    expect(frame).toContain('→ Read src/a.ts');
    expect(frame).not.toContain('result body');
  } finally {view.renderer.destroy();}
  expect(toolSummary('{"command":"npm   test\\n--silent"}\n\nout')).toBe('npm test --silent');
  expect(toolSummary('not json')).toBe('');
});

test('command dispatch rejects unknown commands and preserves literal prompts', async () => {
  const sent: string[] = [];
  const controller = {state:{commands:[],models:[],entries:[],tasks:{},agents:[]},send:(text:string)=>sent.push(text)};
  const dialogs = {menu(){},view(){},form(){},confirm(){},close(){},recall(){},appearance(){},toggle(){}};
  const { execute } = createActions(controller as any,dialogs,async()=>{});
  await expect(execute('/not-a-command')).rejects.toThrow('not sent to a model');
  expect(sent).toHaveLength(0);
  await execute('ordinary prompt');
  expect(sent).toEqual(['ordinary prompt']);
});

test('menu filters and selects without executing unrelated actions', async () => {
  const selected:string[]=[];
  const view=await testRender(()=><Menu title="Commands" items={[
    {title:'/model',run:()=>{selected.push('model');}},
    {title:'/usage',run:()=>{selected.push('usage');}},
  ]} onClose={()=>{}}/>,{width:80,height:24});
  try {
    await view.renderOnce();
    await view.mockInput.typeText('usage');
    await view.renderOnce();
    view.mockInput.pressEnter();
    expect(selected).toEqual(['usage']);
  } finally {view.renderer.destroy();}
});

test('adopted decision preserves deny default and explicit approval navigation', async () => {
  const answers: unknown[] = [];
  const decision = { id: 'permission', title: 'Run tool?', description: 'Fixture command', fields: [],
    choices: [{label:'Deny',value:false},{label:'Allow',value:true}], defaultIndex: 0 };
  const view = await testRender(() => <DecisionDialog decision={decision} onAnswer={value => answers.push(value)} onCancel={() => answers.push('cancel')} />, {width:80,height:24});
  try {
    await view.renderOnce();
    view.mockInput.pressEnter();
    expect(answers).toEqual([false]);
    await Promise.resolve();
    view.mockInput.pressArrow('right');
    view.mockInput.pressEnter();
    expect(answers).toEqual([false,true]);
    await Promise.resolve();
    view.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(answers).toEqual([false,true,'cancel']);
  } finally { view.renderer.destroy(); }
});

test('dialog fields preserve arbitrary keys and keep secrets masked', async () => {
  const answers: unknown[] = [];
  const decision = { id:'form', title:'Question', description:'Fixture only',
    fields:[{key:'__proto__',label:'Answer',required:true},{key:'token',label:'Secret',secret:true}],
    choices:[{label:'Cancel',value:null},{label:'Submit',value:'submit'}],defaultIndex:0 };
  const view = await testRender(() => <DecisionDialog decision={decision}
    onAnswer={(value,fields) => answers.push({value,fields})} onCancel={() => {}} />, {width:80,height:24});
  try {
    await view.renderOnce();
    view.mockInput.pressTab();
    await view.mockInput.typeText('choice');
    view.mockInput.pressTab();
    await view.mockInput.typeText('fixture-secret');
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain('fixture-secret');
    view.mockInput.pressTab();
    view.mockInput.pressArrow('right');
    view.mockInput.pressEnter();
    expect(answers).toHaveLength(1);
    expect((answers[0] as any).fields.__proto__).toBe('choice');
    expect((answers[0] as any).fields.token).toBe('fixture-secret');
  } finally {view.renderer.destroy();}
});

test('snapshot panel renders sections and record lists without raw JSON', async () => {
  const sections = { sections: [{ title: 'Session', rows: [{ label: 'Version', value: '2.1.302' }, { label: 'cwd', value: 'E:\\demo' }] }] };
  const servers = { servers: [
    { name: 'plugin:discovery', status: 'connected', source: 'plugin', tools: [{ name: 'discovery' }] },
    { name: 'broken', status: 'failed', description: 'Could not start the server process.' },
  ] };
  const first = await testRender(() => <SnapshotPanel title="status" snapshot={sections} onClose={() => {}} />, { width: 100, height: 30 });
  try {
    const frame = await frameContaining(first, 'Version');
    expect(frame).toContain('SESSION');
    expect(frame).toContain('2.1.302');
    expect(frame).not.toContain('"rows"');
  } finally { first.renderer.destroy(); }
  const second = await testRender(() => <SnapshotPanel title="mcp" snapshot={servers} onClose={() => {}} />, { width: 100, height: 30 });
  try {
    const frame = await frameContaining(second, 'broken');
    expect(frame).toContain('SERVERS');
    expect(frame).toContain('plugin:discovery · connected');
    expect(frame).toContain('broken · failed');
    expect(frame).toContain('Could not start the server process.');
    expect(frame).not.toMatch(/name\s+plugin:discovery/);
    expect(frame).not.toContain('{');
  } finally { second.renderer.destroy(); }
});

test('settings panel groups rows and runs the selected entry on enter', async () => {
  const runs: string[] = [];
  const view = await testRender(() => <SettingsPanel groups={[
    { title: 'Defaults', entries: [{ label: 'Default model', value: 'glm-5.3', run: () => runs.push('model') }] },
    { title: 'Fallback rules', entries: [
      { label: 'claude-sonnet-5-5 → glm-5.3', value: 'enabled · main', run: () => runs.push('rule') },
      { label: 'New fallback rule', run: () => runs.push('new') },
    ] },
  ]} onClose={() => runs.push('close')} />, { width: 100, height: 30 });
  try {
    const frame = await frameContaining(view, 'New fallback rule');
    for (const label of ['DEFAULTS', 'Default model', 'glm-5.3', 'FALLBACK RULES', 'claude-sonnet-5-5 → glm-5.3', 'enabled · main']) expect(frame).toContain(label);
    view.mockInput.pressEnter();
    expect(runs).toEqual(['model']);
    view.mockInput.pressArrow('down');
    view.mockInput.pressEnter();
    expect(runs).toEqual(['model', 'rule']);
    view.mockInput.pressEscape();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(runs).toEqual(['model', 'rule', 'close']);
  } finally { view.renderer.destroy(); }
});

test('form fields prefill from their initial values', async () => {
  const answers: unknown[] = [];
  const decision = { id: 'prefill', title: 'Edit rule', description: 'Fixture',
    fields: [{ key: 'from', label: 'When model', required: true, initial: 'claude-sonnet-5-5' }],
    choices: [{ label: 'Cancel', value: false }, { label: 'Submit', value: true }], defaultIndex: 0 };
  const view = await testRender(() => <DecisionDialog decision={decision}
    onAnswer={(value, fields) => answers.push({ value, fields })} onCancel={() => {}} />, { width: 80, height: 24 });
  try {
    const frame = await frameContaining(view, 'claude-sonnet-5-5');
    expect(frame).toContain('When model');
    view.mockInput.pressArrow('right');
    view.mockInput.pressEnter();
    await Promise.resolve();
    expect(answers).toEqual([{ value: true, fields: { from: 'claude-sonnet-5-5' } }]);
  } finally { view.renderer.destroy(); }
});

test('session view follows controller updates without sending inference', async () => {
  let change = () => {};
  const controller = {
    state: { ready: true, busy: true, model: 'fixture', status: 'Working', entries: [] as {id:string;kind:string;text:string}[], pending: [] },
    subscribe(listener: () => void) { change = listener; return () => { change = () => {}; }; },
    send() { throw new Error('No inference in render tests'); },
    answer() { throw new Error('No decisions in this render test'); },
    cancelDialog() { throw new Error('No decisions in this render test'); },
  };
  const view = await testRender(() => <App controller={controller} />, { width: 100, height: 30 });
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Your choice of models');
    controller.state.entries.push({ id: 'a', kind: 'assistant', text: 'Stream fragment' });
    change();
    expect(await frameContaining(view, 'Stream fragment')).toContain('Stream fragment');
    controller.state.entries[0].text += ' completed';
    change();
    expect(await frameContaining(view, 'Stream fragment completed')).toContain('Stream fragment completed');
  } finally {
    view.renderer.destroy();
  }
});

test('transcript paging scrolls while the composer remains editable', async () => {
  const controller={state:{ready:true,busy:false,model:'fixture',status:'Ready',pending:[],
    entries:Array.from({length:80},(_,index)=>({id:String(index),kind:'user',text:'History row '+index}))},
    subscribe:()=>()=>{},send:()=>{},answer:()=>{},cancelDialog:()=>{}};
  const view=await testRender(()=><App controller={controller}/>,{width:80,height:24});
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('History row 79');
    await view.mockInput.pressKeys(['\x1b[5~']);
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain('History row 79');
    await view.mockInput.typeText('draft stays editable');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('draft stays editable');
  } finally {view.renderer.destroy();}
});

test('adopted composer sends Unicode input once and clears it', async () => {
  const sent: string[] = [];
  const view = await testRender(() => <Composer disabled={false} model="fixture" onSubmit={text => sent.push(text)} />, { width: 100, height: 24 });
  try {
    await view.renderOnce();
    await view.mockInput.typeText('Hello 界');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['Hello 界']);
    view.mockInput.pressEnter();
    expect(sent).toHaveLength(1);
  } finally {
    view.renderer.destroy();
  }
});
test('composer completes slash commands from the suggestion list', async () => {
  const sent: string[] = [];
  const commands = [{ name: '/model', description: 'Switch the model' }, { name: '/usage', description: 'Provider usage' }];
  const view = await testRender(() => <Composer disabled={false} model="fixture" commands={commands} onSubmit={text => sent.push(text)} />, { width: 100, height: 24 });
  try {
    await view.mockInput.typeText('/mo');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Switch the model');
    expect(view.captureCharFrame()).not.toContain('Provider usage');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['/model ']);
  } finally { view.renderer.destroy(); }
});

test('composer recalls earlier prompts with the arrow keys', async () => {
  const sent: string[] = [];
  const view = await testRender(() => <Composer disabled={false} model="fixture" history={['first prompt', 'second prompt']}
    onSubmit={text => sent.push(text)} />, { width: 100, height: 24 });
  try {
    await view.renderOnce();
    view.mockInput.pressArrow('up');
    view.mockInput.pressArrow('up');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('first prompt');
    view.mockInput.pressArrow('down');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('second prompt');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['second prompt']);
  } finally { view.renderer.destroy(); }
});

test('menus open as a centered dialog instead of filling the screen', async () => {
  const view = await testRender(() => <Menu title="Commands" items={[{ title: '/model', run() {} }]} onClose={() => {}} />, { width: 140, height: 40 });
  try {
    await view.renderOnce();
    const row = view.captureCharFrame().split('\n').find(line => line.includes('Commands'))!;
    const left = row.indexOf('Commands');
    expect(left).toBeGreaterThan(30);
    expect(row.indexOf('esc') - left).toBeLessThan(60);
  } finally { view.renderer.destroy(); }
});

test('status bar shows turn progress, interrupt hint and context usage', async () => {
  const controller = { state: { ready: true, busy: true, model: 'fixture', status: 'Working', pending: [],
    context: { totalTokens: 50_000, maxTokens: 200_000 }, entries: [{ id: 'u', kind: 'user', text: 'Question' }] },
    subscribe: () => () => {}, send() {}, answer() {}, cancelDialog() {} };
  const view = await testRender(() => <App controller={controller} />, { width: 120, height: 24 });
  try {
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain('esc interrupt');
    expect(frame).toContain('50K / 200K 25%');
  } finally { view.renderer.destroy(); }
});


test('live agents and workflows appear in the strip above the composer and the status chip', async () => {
  const now = Date.now();
  const controller = { state: { ready: true, busy: true, model: 'fixture', status: 'Working', pending: [],
    context: { totalTokens: 10_000, maxTokens: 200_000 },
    entries: [{ id: 'u', kind: 'user', text: 'Run the review' }],
    tasks: {
      w1: { id: 'w1', kind: 'workflow', title: 'spec', workflowName: 'spec', status: 'running', startedAt: now },
      a1: { id: 'a1', kind: 'agent', title: 'Review code', subagentType: 'reviewer', parentId: 'w1', status: 'running', startedAt: now },
    } },
    subscribe: () => () => {}, send() {}, answer() {}, cancelDialog() {} };
  const view = await testRender(() => <App controller={controller} />, { width: 120, height: 24 });
  try {
    const frame = await frameContaining(view, '1 agent · 1 workflow');
    expect(frame).toContain('⛓ spec');
    expect(frame).toContain('◉ Review code');
  } finally { view.renderer.destroy(); }
});
test('usage panel renders quota meters, totals and refreshes on r', async () => {
  const refreshed: number[] = [];
  const inTwelveHours = new Date(Date.now() + 12 * 3600_000).toISOString();
  const snapshot = {
    since: '2026-10-17T08:00:00Z', scope: 'gateway session', attempts: [{ outcome: 'pending' }],
    totals: [
      { provider: 'chatgpt', actualModel: 'gpt-6.1-sol', agent: 'gpt-reviewer', attempts: 2, completed: 2, unknown: 0, interrupted: 0,
        tokens: { input: 12000, output: 3400, cacheRead: 500, cacheCreate: null, reasoning: 900 } },
      { provider: 'anthropic', actualModel: 'sonnet-5-5', attempts: 1, completed: 0, unknown: 1, interrupted: 0, tokens: null },
    ],
    providers: [
      { provider: 'anthropic', state: 'available', source: 'Claude SDK', stale: false,
        windows: [{ id: 'session', label: 'Session', usedPercent: 62, resetsAt: inTwelveHours }, { id: 'weekly', usedPercent: null, resetsAt: null }] },
      { provider: 'chatgpt', state: 'available', source: 'Codex CLI', stale: false,
        windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 97, resetsAt: inTwelveHours }] },
    ],
  };
  const view = await testRender(() => <UsagePanel snapshot={snapshot} refresh={async () => { refreshed.push(1); }} onClose={() => {}} />,
    { width: 100, height: 30 });
    const frame = await frameContaining(view, 'REQUEST TOKENS');
    for (const label of ['● Claude', '● ChatGPT', 'Session', '62% used', 'resets in', 'usage unknown', '97% used']) expect(frame).toContain(label);
    expect(frame).toContain('━');
    view.mockInput.pressKey('END');
    await view.renderOnce();
    const tail = view.captureCharFrame();
    expect(tail).toContain('ChatGPT / gpt-6.1-sol · agent gpt-reviewer');
    expect(tail).toContain('Input 12K · Output 3.4K');
    expect(tail).toContain('2/2 completed');
    expect(tail).toContain('Tokens unknown');
    expect(tail).toContain('1 request in progress');
    view.mockInput.typeText('r');
    await view.renderOnce();
    expect(refreshed).toHaveLength(1);
});

test('context panel meters the active window and lists categories, memory and MCP', async () => {
  const usage = { model: 'glm-5.3', totalTokens: 150_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
    categories: [
      { name: 'System prompt', tokens: 20_000, kind: 'used' },
      { name: 'Messages', tokens: 80_000, kind: 'used' },
      { name: 'Free space', tokens: 850_000, kind: 'free' },
      { name: 'Auto-compact buffer', tokens: 50_000, kind: 'buffer' },
    ],
    memoryFiles: [{ path: 'CLAUDE.md', tokens: 1200 }],
    mcpTools: [{ name: 'atlas_search', serverName: 'projectatlas', tokens: 3400 }] };
  const view = await testRender(() => <ContextPanel usage={usage}
    model={{ label: 'GLM-5.3', provider: 'zai', maxContext: 1_000_000, contextSource: 'provider configuration' }} onClose={() => {}} />,
    { width: 100, height: 30 });
  try {
    const frame = await frameContaining(view, 'MEMORY FILES');
    expect(frame).toContain('GLM-5.3');
    expect(frame).toContain('Catalog capacity 1M tokens · provider configuration');
    expect(frame).toContain('Active window 1M tokens · used 150K');
    expect(frame).toContain('15%');
    expect(frame).toContain('System prompt · 20K');
    expect(frame).toContain('Auto-compact buffer · 50K · compaction reserve');
    expect(frame).toContain('Free space · 850K · remaining');
    expect(frame).toContain('CLAUDE.md · 1.2K');
    expect(frame).toContain('projectatlas · atlas_search · 3.4K');
    expect(frame).toContain('█');
  } finally { view.renderer.destroy(); }
});

test('workspace diff lists files and reviews one file on enter', async () => {
  const data = { diff: [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,2 +1,2 @@',
    ' old line',
    '-removed line',
    '+replacement line',
  ].join('\n'), untracked: ['notes.txt'], truncated: false, staged: false };
  const view = await testRender(() => <WorkspaceDiffPanel data={data} onClose={() => {}} />, { width: 100, height: 30 });
  try {
    const frame = await frameContaining(view, 'notes.txt');
    expect(frame).toContain('1 file · +1 / -1');
    expect(frame).toContain('src/app.ts');
    expect(frame).toContain('Untracked · 1');
    view.mockInput.pressEnter();
    await view.renderOnce();
    const detail = await frameContaining(view, 'replacement line');
    expect(detail).toContain('- removed line');
  } finally { view.renderer.destroy(); }
});

import { createRoot } from 'solid-js';
import { useControllerState } from '../src/tui/opencode/bridge';

 test('controller bridge snapshots mutable updates and unsubscribes on disposal', () => {
  let listener: (() => void) | undefined;
  const controller = {
    state: { entries: [{ text: 'first' }] },
    subscribe(callback: () => void) {
      listener = callback;
      return () => { listener = undefined; };
    },
  };
  createRoot(dispose => {
    const state = useControllerState(controller);
    controller.state.entries[0].text = 'streamed';
    expect(state().entries[0].text).toBe('first');
    listener!();
    expect(state().entries[0].text).toBe('streamed');
    dispose();
    expect(listener).toBeUndefined();
  });
});

test('adopted home renders branding, composer and footer at terminal widths', async () => {
  for (const width of [36, 100]) {
    const view = await testRender(() => (
      <box width="100%" height="100%" flexDirection="column">
        <Home logo={<text>CLAUDAPTER</text>} prompt={<text>Ask anything</text>} footer={<text>Ready</text>} />
      </box>
    ), { width, height: 24 });
    try {
      await view.renderOnce();
      const frame = view.captureCharFrame();
      expect(frame).toContain('CLAUDAPTER');
      expect(frame).toContain('Ask anything');
      expect(frame).toContain('Ready');
    } finally {
      view.renderer.destroy();
    }
  }
});


async function settled(view: Awaited<ReturnType<typeof testRender>>) {
  await new Promise(resolve => setTimeout(resolve, 40));
  await view.renderOnce();
  return view.captureCharFrame();
}

function idleController(overrides: Record<string, unknown> = {}) {
  return { state: { ready: true, busy: false, model: 'fixture', status: 'Ready', entries: [], pending: [], ...overrides },
    subscribe: () => () => {}, send() {}, answer() {}, cancelDialog() {} };
}

test('home shows provider identity and recent sessions without moving the prompt while they load', async () => {
  let release: (sessions: any[]) => void = () => {};
  const pending = new Promise<any[]>(resolve => { release = resolve; });
  const now = Date.now();
  const controller = { ...idleController({ model: 'opus', models: [
    { id: 'opus', label: 'Opus', provider: 'anthropic', auth: 'unknown' },
    { id: 'gpt-6.1-sol', label: 'GPT 6.1', provider: 'chatgpt', auth: 'authenticated' },
    { id: 'glm-5.3', label: 'GLM 5.3', provider: 'zai', auth: 'missing' },
  ] }), sessions: () => pending };
  const view = await testRender(() => <App controller={controller} />, { width: 100, height: 40 });
  try {
    const before = await settled(view);
    expect(before).toContain('● Claude');
    expect(before).toContain('● ChatGPT');
    expect(before).toContain('○ Z.ai · sign in');
    expect(before).not.toContain('anthropic');
    const promptRow = (frame: string) => frame.split('\n').findIndex(line => line.includes('Ask anything'));
    release([{ sessionId: 's1', summary: 'Fix flaky gateway test', lastModified: now - 2 * 3_600_000 }]);
    const after = await settled(view);
    expect(after).toContain('Fix flaky gateway test');
    expect(after).toContain('2h ago');
    expect(promptRow(after)).toBe(promptRow(before));
  } finally { view.renderer.destroy(); }
});

test('question mark on an empty prompt opens the shortcuts overlay and escape closes it', async () => {
  const view = await testRender(() => <App controller={idleController()} preferences={{ thinking: false, theme: 'midnight',
    keybindings: { 'ctrl+p': '/help', f4: '/usage' } }} />, { width: 100, height: 40 });
  try {
    await settled(view);
    view.mockInput.pressKey('?');
    let frame = await settled(view);
    expect(frame).toContain('Keyboard shortcuts');
    expect(frame).toContain('Command palette');
    expect(frame).toContain('Command shortcuts');
    view.mockInput.pressEscape();
    frame = await settled(view);
    expect(frame).not.toContain('Keyboard shortcuts');
    expect(frame).toContain('Ask anything');
  } finally { view.renderer.destroy(); }
});

test('escape closes the top-most overlay first and interrupts the turn only afterwards', async () => {
  const interrupts: string[] = [];
  const controller = { ...idleController({ busy: true, status: 'Working', entries: [{ id: 'u', kind: 'user', text: 'Question' }] }),
    interrupt: async () => { interrupts.push('interrupt'); } };
  const view = await testRender(() => <App controller={controller} />, { width: 100, height: 30 });
  try {
    await settled(view);
    view.mockInput.pressKey('?');
    expect(await settled(view)).toContain('Keyboard shortcuts');
    view.mockInput.pressEscape();
    expect(await settled(view)).not.toContain('Keyboard shortcuts');
    expect(interrupts).toEqual([]);
    view.mockInput.pressEscape();
    await settled(view);
    expect(interrupts).toEqual(['interrupt']);
  } finally { view.renderer.destroy(); }
});

test('status bar keeps a compact context meter when the full one does not fit', async () => {
  const context = { totalTokens: 50_000, maxTokens: 200_000 };
  for (const [width, full] of [[120, true], [30, false]] as const) {
    const view = await testRender(() => <StatusBar busy={false} status="Ready" context={context} hints={[]} width={width} />,
      { width: 130, height: 3 });
    try {
      await view.renderOnce();
      const frame = view.captureCharFrame();
      expect(frame).toContain('25%');
      expect(frame.includes('50K / 200K')).toBe(full);
    } finally { view.renderer.destroy(); }
  }
});

test('segments shrink to their compact form before they are dropped', () => {
  const segments = [
    { id: 'context', width: 30, compactWidth: 8, priority: 1 },
    { id: 'hints', width: 20, priority: 2 },
  ];
  expect(fitSegments(segments, 60).map(segment => [segment.id, segment.compact])).toEqual([['context', false], ['hints', false]]);
  expect(fitSegments(segments, 40).map(segment => [segment.id, segment.compact])).toEqual([['context', false]]);
  expect(fitSegments(segments, 20).map(segment => [segment.id, segment.compact])).toEqual([['context', true]]);
  expect(fitSegments(segments, 4)).toEqual([]);
});

test('meters fill at half-cell resolution and reset countdowns never show sixty minutes', () => {
  expect(meterCells(0, 4)).toEqual({ filled: '', empty: '━━━━' });
  expect(meterCells(0.5, 4)).toEqual({ filled: '━━', empty: '━━' });
  expect(meterCells(0.125, 4)).toEqual({ filled: '╸', empty: '━━━' });
  expect(meterCells(2, 4)).toEqual({ filled: '━━━━', empty: '' });
  expect(formatReset(11 * 3_600_000 + 59.6 * 60_000)).toBe('12h');
  expect(formatReset(90 * 60_000)).toBe('1h 30m');
});

test('reduced motion freezes spinners without starting a timer', async () => {
  const previous = process.env.CLAUDAPTER_REDUCED_MOTION;
  process.env.CLAUDAPTER_REDUCED_MOTION = '1';
  const view = await testRender(() => <Spinner color="#ffffff" />, { width: 10, height: 2 });
  try {
    await view.renderOnce();
    expect(activeTickers()).toBe(0);
  } finally {
    view.renderer.destroy();
    if (previous === undefined) delete process.env.CLAUDAPTER_REDUCED_MOTION;
    else process.env.CLAUDAPTER_REDUCED_MOTION = previous;
  }
});

test('spinners share one timer per frame rate and release it on unmount', async () => {
  const view = await testRender(() => <box><Spinner color="#ffffff" /><Spinner color="#ffffff" /><Spinner color="#ffffff" /></box>,
    { width: 10, height: 2 });
  try {
    await view.renderOnce();
    expect(activeTickers()).toBe(1);
  } finally { view.renderer.destroy(); }
  expect(activeTickers()).toBe(0);
});

test('shortcut overview lists bound commands that are not built in', () => {
  const groups = shortcutGroups({ 'ctrl+p': '/help', f2: '/model', f10: '/usage' });
  expect(groups.map(group => group.title)).toEqual(['General', 'Prompt', 'Transcript', 'Command shortcuts']);
  expect(groups.at(-1)!.keys).toEqual([['f2', '/model'], ['f10', '/usage']]);
  expect(shortcutGroups({}).map(group => group.title)).not.toContain('Command shortcuts');
});

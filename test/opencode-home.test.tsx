import { test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import { Home } from '../src/tui/opencode/home';
import { Composer } from '../src/tui/opencode/composer';
import { App } from '../src/tui/opencode/app';
import { DecisionDialog } from '../src/tui/opencode/decision';
import { createActions } from '../src/tui/opencode/actions';
import { Menu } from '../src/tui/opencode/menu';
import { toolSummary } from '../src/tui/opencode/transcript';

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
    expect(frame).toContain('✓ Read src/a.ts');
    expect(frame).not.toContain('result body');
  } finally {view.renderer.destroy();}
  expect(toolSummary('{"command":"npm   test\\n--silent"}\n\nout')).toBe('npm test --silent');
  expect(toolSummary('not json')).toBe('');
});

test('command dispatch rejects unknown commands and preserves literal prompts', async () => {
  const sent: string[] = [];
  const controller = {state:{commands:[],models:[],entries:[],tasks:{},agents:[]},send:(text:string)=>sent.push(text)};
  const dialogs = {menu(){},view(){},form(){},confirm(){},close(){},recall(){},appearance(){},toggle(){}};
  const execute = createActions(controller as any,dialogs,async()=>{});
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
    expect(view.captureCharFrame()).toContain('YOUR WORKSPACE');
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

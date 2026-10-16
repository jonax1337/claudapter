import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { App } from '../dist/tui/app.js';

class FakeController extends EventEmitter {
  revision = 0;
  calls = [];
  state = { ready: true, busy: false, sessionId: 'fixture', model: 'fixture-model', permissionMode: 'default', status: 'Ready',
    entries: [], models: [], commands: [], agents: [], tasks: {}, context: null, pending: [] };
  subscribe = listener => { this.on('change', listener); return () => this.off('change', listener); };
  changed() { this.revision++; this.emit('change'); }
  send(text) { this.calls.push(['send', text]); if (!this.state.ready) throw Error('Session is still starting.'); }
  async interrupt() { this.calls.push(['interrupt']); }
  answer(id, value, fields) { this.calls.push(['answer', id, value, fields]); this.state.pending = this.state.pending.filter(d => d.id !== id); this.changed(); }
  cancelDialog(id) { this.calls.push(['cancel', id]); this.state.pending = this.state.pending.filter(d => d.id !== id); this.changed(); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
async function setup(t, controller = new FakeController()) {
  const view = render(React.createElement(App, { controller, preferences: { theme: 'midnight', thinking: false, favorites: [] }, onClose() {} }));
  t.after(() => view.unmount());
  await tick();
  return { controller, view, async key(value) { view.stdin.write(value); await tick(); } };
}
const approval = fields => ({ id: 'approval', title: 'Permission required: Write', description: 'Modify fixture.txt', fields: fields ?? [],
  choices: [{ label: 'Deny', value: 'deny' }, { label: 'Allow once', value: 'allow' }], defaultIndex: 0 });

test('permission prompt defaults to deny; approval requires deliberate navigation', async t => {
  const controller = new FakeController(); controller.state.pending = [approval()];
  const ui = await setup(t, controller);
  await ui.key('\r');
  assert.equal(controller.calls[0][2], 'deny');
  controller.state.pending = [{ ...approval(), id: 'second' }]; controller.changed(); await tick();
  await ui.key('\u001b[C'); await ui.key('\r');
  assert.equal(controller.calls[1][2], 'allow');
});

test('question property names remain ordinary editable data in the renderer',async t=>{
  const controller=new FakeController();controller.state.pending=[{...approval([{key:'__proto__',label:'Question',required:true}]),choices:[{label:'Cancel',value:null},{label:'Submit',value:'submit'}]}];
  const ui=await setup(t,controller);
  await ui.key('\t');await ui.key('Ocean');await ui.key('\r');await ui.key('\u001b[B');await ui.key('\r');
  const call=controller.calls.find(call=>call[0]==='answer');
  assert.equal(call[2],'submit');assert.equal(Object.hasOwn(call[3],'__proto__'),true);assert.equal(call[3].__proto__,'Ocean');
});

test('a pending approval supersedes an open palette; Escape declines and restores the palette', async t => {
  const ui = await setup(t);
  await ui.key('\u0010');
  assert.match(ui.view.lastFrame(), /COMMAND PALETTE/);
  ui.controller.state.pending = [approval()]; ui.controller.changed(); await tick();
  assert.match(ui.view.lastFrame(), /Permission required/);
  await ui.key('\u001b');
  assert.deepEqual(ui.controller.calls[0], ['cancel', 'approval']);
  assert.match(ui.view.lastFrame(), /COMMAND PALETTE/);
});

test('rejected submission retains the unsent composer text', async t => {
  const controller = new FakeController(); controller.state.ready = false;
  const ui = await setup(t, controller);
  await ui.key('preserve this unsent task'); await ui.key('\r');
  assert.match(ui.view.lastFrame(), /preserve this unsent task/);
  assert.match(ui.view.lastFrame(), /still starting/);
});

test('unknown slash commands do not become paid model prompts', async t => {
  const ui = await setup(t);
  await ui.key('/definitely-not-a-command'); await ui.key('\r');
  assert.equal(ui.controller.calls.filter(c => c[0] === 'send').length, 0);
  assert.match(ui.view.lastFrame(), /unknown|unsupported|unavailable|not available/i);
});

test('Ctrl+C interrupts a running turn even while a command overlay is open', async t => {
  const controller = new FakeController(); controller.state.busy = true;
  const ui = await setup(t, controller);
  await ui.key('\u0010'); await ui.key('\u0003');
  assert.equal(controller.calls.filter(c => c[0] === 'interrupt').length, 1);
});

test('pending secret fields never render their plaintext value', async t => {
  const controller = new FakeController(); controller.state.pending = [approval([{ key: 'secret', label: 'Secret value', secret: true }])];
  const ui = await setup(t, controller);
  await ui.key('\t'); await ui.key('fixture-sensitive-value');
  assert.doesNotMatch(ui.view.lastFrame(), /fixture-sensitive-value/);
  assert.match(ui.view.lastFrame(), /[•*]/);
});

test('resize respects a terminal smaller than the preferred layout', async t => {
  const ui = await setup(t);
  Object.defineProperty(ui.view.stdout, 'columns', { get: () => 30 });
  Object.defineProperty(ui.view.stdout, 'rows', { get: () => 12 });
  ui.view.stdout.emit('resize'); await tick();
  const lines = ui.view.lastFrame().split('\n');
  assert.ok(lines.length <= 12, `Rendered ${lines.length} rows for a 12-row terminal.`);
  assert.ok(lines.every(line => stringWidth(line) <= 30), 'Rendered text outside terminal width.');
});

test('upstream question labels and options cannot emit terminal control sequences', async t => {
  const controller = new FakeController();
  controller.state.pending = [approval([{ key: 'choice', label: 'Question\u001b]52;c;Zml4dHVyZQ==\u0007', options: ['one\u001b[2J', 'two'] }])];
  const ui = await setup(t, controller);
  assert.doesNotMatch(ui.view.lastFrame(), /\u001b\]52|\u001b\[2J/);
});

test('advertised Ctrl+J inserts a newline instead of submitting the draft', async t => {
  const ui = await setup(t);
  await ui.key('line one'); await ui.key('\n');
  assert.equal(ui.controller.calls.filter(c => c[0] === 'send').length, 0);
  await ui.key('line two'); await ui.key('\r');
  assert.equal(ui.controller.calls.find(c => c[0] === 'send')?.[1], 'line one\nline two');
});

test('large pending forms keep consent controls visible within the terminal', async t => {
  const controller = new FakeController();
  controller.state.pending = [approval(Array.from({ length: 12 }, (_, i) => ({ key: `field-${i}`, label: `Question ${i + 1}`, required: true })))];
  const ui = await setup(t, controller);
  Object.defineProperty(ui.view.stdout, 'rows', { get: () => 24 });
  ui.view.stdout.emit('resize'); await tick();
  const output = ui.view.lastFrame();
  assert.ok(output.split('\n').length <= 24, 'Pending form exceeds the terminal viewport.');
  assert.match(output, /Deny/);
  assert.match(output, /Allow once/);
});

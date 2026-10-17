import { test, expect, afterEach } from 'bun:test';
import { testRender } from '@opentui/solid';
import { App } from '../src/tui/opencode/app';
import { Composer } from '../src/tui/opencode/composer';
import { setEditorMode } from '../src/tui/opencode/editor-mode';

afterEach(() => setEditorMode('normal'));

type View = Awaited<ReturnType<typeof testRender>>;
interface Editor { plainText: string; logicalCursor: { row: number; col: number }; editorView: { hasSelection(): boolean; getSelection(): { start: number; end: number } | null } }
const editor = (view: View) => view.renderer.currentFocusedRenderable as unknown as Editor;

/** A lone ESC is held back until the parser rules out an escape sequence. */
async function escape(view: View) {
  view.mockInput.pressEscape();
  await new Promise(resolve => setTimeout(resolve, 80));
  await view.renderOnce();
}

async function mount(extra: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const view = await testRender(() => <Composer disabled={false} model="fixture" onSubmit={text => { sent.push(text); }} {...extra} />, { width: 100, height: 24 });
  await view.renderOnce();
  return { view, sent };
}

test('vim mode is off by default and typing is plain insertion', async () => {
  const { view, sent } = await mount();
  try {
    await view.mockInput.typeText('hello');
    await escape(view);
    await view.renderOnce();
    expect(editor(view).plainText).toBe('hello');
    expect(view.captureCharFrame()).not.toContain('NORMAL');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['hello']);
  } finally { view.renderer.destroy(); }
});

test('vim mode starts in insert, Escape enters normal and operators edit the prompt', async () => {
  setEditorMode('vim');
  const { view, sent } = await mount();
  try {
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('INSERT');
    await view.mockInput.typeText('hello world');
    await escape(view);
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('NORMAL');
    await view.mockInput.typeText('0dw');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('world');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['world']);
  } finally { view.renderer.destroy(); }
});

test('normal-mode keys never type text and u / ctrl+r use the editor history', async () => {
  setEditorMode('vim');
  const { view } = await mount();
  try {
    await view.mockInput.typeText('abc');
    await escape(view);
    await view.mockInput.typeText('zqx');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('ab');
    await view.mockInput.typeText('u');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('abc');
    view.mockInput.pressKey('r', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('ab');
  } finally { view.renderer.destroy(); }
});

test('insert commands, text objects, find and dot repeat work through real key events', async () => {
  setEditorMode('vim');
  const { view } = await mount();
  try {
    await view.mockInput.typeText('foo bar baz');
    await escape(view);
    await view.mockInput.typeText('0wciwXY');
    await escape(view);
    await view.renderOnce();
    expect(editor(view).plainText).toBe('foo XY baz');
    await view.mockInput.typeText('w.');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('foo XY XY');
    await view.mockInput.typeText('0foa!');
    await escape(view);
    await view.renderOnce();
    expect(editor(view).plainText).toBe('fo!o XY XY');
  } finally { view.renderer.destroy(); }
});

test('visual mode highlights the selection and operators act on it', async () => {
  setEditorMode('vim');
  const { view } = await mount();
  try {
    await view.mockInput.typeText('hello world');
    await escape(view);
    await view.mockInput.typeText('0vee');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('VISUAL');
    expect(editor(view).editorView.hasSelection()).toBe(true);
    await view.mockInput.typeText('d');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('');
    expect(editor(view).editorView.hasSelection()).toBe(false);
  } finally { view.renderer.destroy(); }
});

test('visual selection covers exactly the characters between the anchor and the cursor', async () => {
  setEditorMode('vim');
  const { view } = await mount();
  try {
    await view.mockInput.typeText('abcdef');
    await escape(view);
    await view.mockInput.typeText('0lvll');
    await view.renderOnce();
    const range = editor(view).editorView.getSelection();
    expect([range?.start, range?.end]).toEqual([1, 4]);
  } finally { view.renderer.destroy(); }
});

test('slash suggestions only appear while typing in insert mode', async () => {
  setEditorMode('vim');
  const { view } = await mount({ commands: [{ name: '/model', description: 'Switch the model' }] });
  try {
    await view.mockInput.typeText('/mo');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Switch the model');
  } finally { view.renderer.destroy(); }
});

test('kill ring: ctrl+w and ctrl+k save text that ctrl+y and alt+y bring back', async () => {
  const { view } = await mount();
  try {
    await view.mockInput.typeText('one two three');
    view.mockInput.pressKey('w', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('one two ');
    view.mockInput.pressKey('w', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('one ');
    view.mockInput.pressKey('y', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('one two three');
  } finally { view.renderer.destroy(); }
});

test('kill ring: separate kills are cycled with alt+y', async () => {
  const { view } = await mount();
  try {
    await view.mockInput.typeText('alpha');
    view.mockInput.pressKey('u', { ctrl: true });
    await view.mockInput.typeText('beta');
    view.mockInput.pressKey('u', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('');
    view.mockInput.pressKey('y', { ctrl: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('beta');
    view.mockInput.pressKey('y', { meta: true });
    await view.renderOnce();
    expect(editor(view).plainText).toBe('alpha');
  } finally { view.renderer.destroy(); }
});

test('bracketed multi-line paste is inserted once with normalized line endings', async () => {
  const { view } = await mount();
  try {
    await view.mockInput.pasteBracketedText('first\r\nsecond\rthird\u001b[31m');
    await view.renderOnce();
    expect(editor(view).plainText).toBe('first\nsecond\nthird');
  } finally { view.renderer.destroy(); }
});

test('long pastes still collapse and expand on submit', async () => {
  const { view, sent } = await mount();
  const lines = Array.from({ length: 30 }, (_, index) => 'line ' + index).join('\n');
  try {
    await view.mockInput.pasteBracketedText(lines);
    await view.renderOnce();
    expect(editor(view).plainText).toBe('[pasted 30 lines]');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual([lines]);
  } finally { view.renderer.destroy(); }
});

test('while a turn runs the prompt stays editable but only /btw side questions are sent', async () => {
  const { view, sent } = await mount({ busy: true });
  try {
    expect(view.captureCharFrame()).toContain('/btw');
    await view.mockInput.typeText('next prompt');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual([]);
    expect(view.captureCharFrame()).toContain('Claude is working');
    expect(editor(view).plainText).toBe('next prompt');
    for (let index = 0; index < 'next prompt'.length; index++) view.mockInput.pressBackspace();
    await view.mockInput.typeText('/btw what is a monad?');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(sent).toEqual(['/btw what is a monad?']);
  } finally { view.renderer.destroy(); }
});

async function mountApp(editorMode: 'normal' | 'vim') {
  const interrupts: number[] = [];
  const controller = {
    state: { ready: true, busy: true, model: 'fixture', status: 'Working', entries: [{ id: 'u1', kind: 'user', text: 'earlier prompt' }], pending: [] },
    subscribe: () => () => {}, send() {}, answer() {}, cancelDialog() {}, interrupt: async () => { interrupts.push(1); },
  };
  const preferences = { thinking: false, theme: 'midnight', keybindings: {}, editorMode };
  const view = await testRender(() => <App controller={controller as any} preferences={preferences} />, { width: 100, height: 24 });
  await view.renderOnce();
  return { view, interrupts };
}

test('busy turn: Esc in Vim INSERT only leaves INSERT, a second Esc in NORMAL interrupts', async () => {
  const { view, interrupts } = await mountApp('vim');
  try {
    expect(view.captureCharFrame()).toContain('INSERT');
    await escape(view);
    expect(view.captureCharFrame()).toContain('NORMAL');
    expect(interrupts).toHaveLength(0);
    await escape(view);
    expect(interrupts).toHaveLength(1);
  } finally { view.renderer.destroy(); }
});

test('busy turn: Esc leaving VISUAL does not interrupt either', async () => {
  const { view, interrupts } = await mountApp('vim');
  try {
    await view.mockInput.typeText('abc');
    await escape(view);
    await view.mockInput.typeText('v');
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('VISUAL');
    await escape(view);
    expect(view.captureCharFrame()).toContain('NORMAL');
    expect(interrupts).toHaveLength(0);
  } finally { view.renderer.destroy(); }
});

test('busy turn: with Vim off Esc interrupts as before', async () => {
  const { view, interrupts } = await mountApp('normal');
  try {
    await escape(view);
    expect(interrupts).toHaveLength(1);
  } finally { view.renderer.destroy(); }
});

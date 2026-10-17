import test from 'node:test';
import assert from 'node:assert/strict';
import { initialVimState, noteInsert, vimKey, visualSelection } from '../dist/tui/vim.js';

const NAMED = ['Escape', 'Return', 'Backspace', 'ctrl+r', 'ctrl+['];

/** Plays keys like the composer does: unhandled insert keys are typed into the document by the "editor". */
function play(text, cursor, keys, mode = 'normal') {
  let state = initialVimState(mode);
  let doc = { text, cursor };
  const results = [];
  const tokens = typeof keys === 'string' ? keys.split(' ').flatMap(token => NAMED.includes(token) ? [token] : token === '' ? [] : Array.from(token)) : keys;
  for (const key of tokens) {
    const result = vimKey(state, doc, key);
    state = result.state;
    doc = result.doc;
    results.push(result);
    if (!result.handled && key.length === 1) {
      doc = { text: doc.text.slice(0, doc.cursor) + key + doc.text.slice(doc.cursor), cursor: doc.cursor + 1 };
      state = noteInsert(state, key);
    }
  }
  return { state, doc, results };
}
const edit = (text, cursor, keys) => { const { doc } = play(text, cursor, keys); return [doc.text, doc.cursor]; };

test('starts in insert mode where typing is left to the editor and Escape returns to normal', () => {
  const typed = vimKey(initialVimState(), { text: '', cursor: 0 }, 'x');
  assert.equal(typed.handled, false);
  const escaped = play('abc', 3, ['Escape'], 'insert');
  assert.equal(escaped.state.mode, 'normal');
  assert.equal(escaped.doc.cursor, 2);
});

test('basic motions stay on characters and clamp at line ends', () => {
  assert.equal(play('hello world', 0, 'l l l').doc.cursor, 3);
  assert.equal(play('hello', 4, 'l').doc.cursor, 4);
  assert.equal(play('hello world', 0, '$').doc.cursor, 10);
  assert.equal(play('  hello', 6, '^').doc.cursor, 2);
  assert.equal(play('hello world', 8, '0').doc.cursor, 0);
  assert.equal(play('one two three', 0, 'w').doc.cursor, 4);
  assert.equal(play('one two three', 0, '2w').doc.cursor, 8);
  assert.equal(play('one two three', 12, 'b').doc.cursor, 8);
  assert.equal(play('one two three', 0, 'e').doc.cursor, 2);
  assert.equal(play('a.b c', 0, 'w').doc.cursor, 1);
  assert.equal(play('a.b c', 0, 'W').doc.cursor, 4);
});

test('j and k keep the column and G/gg jump to the last and first line', () => {
  assert.equal(play('abcd\nef\nghij', 3, 'j').doc.cursor, 6);
  assert.equal(play('abcd\nef\nghij', 3, 'j j').doc.cursor, 11);
  assert.equal(play('abcd\nef\nghij', 9, 'k k').doc.cursor, 1);
  assert.equal(play('a\nb\nc', 0, 'G').doc.cursor, 4);
  assert.equal(play('a\nb\nc', 4, 'g g').doc.cursor, 0);
  assert.equal(play('a\nb\nc', 0, '2G').doc.cursor, 2);
});

test('find motions, repeats and operators with find', () => {
  assert.equal(play('a,b,c', 0, 'f ,').doc.cursor, 1);
  assert.equal(play('a,b,c', 0, 'f , ;').doc.cursor, 3);
  assert.equal(play('a,b,c', 4, 'F ,').doc.cursor, 3);
  assert.equal(play('a,b,c', 0, 't ,').doc.cursor, 0);
  assert.equal(play('xa,b,c', 0, 't , ;').doc.cursor, 3);
  assert.deepEqual(edit('a,b,c', 0, 'd f ,'), ['b,c', 0]);
  assert.deepEqual(edit('a,b,c', 0, 'd t ,'), [',b,c', 0]);
  assert.equal(play('abc', 0, 'f z').doc.cursor, 0);
});

test('delete, change and yank with motions and counts', () => {
  assert.deepEqual(edit('one two three', 0, 'd w'), ['two three', 0]);
  assert.deepEqual(edit('one two three', 0, 'd 2 w'), ['three', 0]);
  assert.deepEqual(edit('one two three', 0, '2 d w'), ['three', 0]);
  assert.deepEqual(edit('one two three', 4, 'd e'), ['one  three', 4]);
  assert.deepEqual(edit('one two three', 8, 'd b'), ['one three', 4]);
  assert.deepEqual(edit('hello world', 6, 'd $'), ['hello ', 5]);
  assert.deepEqual(edit('hello world', 6, 'D'), ['hello ', 5]);
  assert.deepEqual(edit('hello world', 6, 'd 0'), ['world', 0]);
  assert.deepEqual(edit('one\ntwo', 0, 'd w'), ['\ntwo', 0]);
});

test('linewise operators remove, change and yank whole lines', () => {
  assert.deepEqual(edit('a\nb\nc', 2, 'd d'), ['a\nc', 2]);
  assert.deepEqual(edit('a\nb\nc', 4, 'd d'), ['a\nb', 2]);
  assert.deepEqual(edit('a\nb\nc', 0, '2 d d'), ['c', 0]);
  assert.deepEqual(edit('only', 2, 'd d'), ['', 0]);
  assert.deepEqual(edit('a\nb\nc', 0, 'd j'), ['c', 0]);
  assert.deepEqual(edit('a\nb\nc', 4, 'd k'), ['a', 0]);
  assert.deepEqual(edit('a\nb\nc', 2, 'd G'), ['a', 0]);
  const changed = play('a\nbcd\nc', 3, 'c c');
  assert.equal(changed.doc.text, 'a\n\nc');
  assert.equal(changed.state.mode, 'insert');
  assert.deepEqual(edit('a\nb\nc', 0, 'y y j p'), ['a\nb\na\nc', 4]);
  assert.deepEqual(edit('a\nb\nc', 2, 'y y P'), ['a\nb\nb\nc', 2]);
});

test('cw changes to the end of the word and yanked text is pasted', () => {
  const changed = play('foo bar', 0, 'c w');
  assert.equal(changed.doc.text, ' bar');
  assert.equal(changed.state.mode, 'insert');
  const retyped = play('foo bar', 0, ['c', 'w', 'x', 'y', 'Escape']);
  assert.equal(retyped.doc.text, 'xy bar');
  assert.equal(retyped.state.mode, 'normal');
  assert.deepEqual(edit('foo bar', 0, 'y w $ p'), ['foo barfoo ', 10]);
  assert.deepEqual(edit('foo bar', 0, 'd w P'), ['foo bar', 3]);
  assert.deepEqual(edit('ab', 0, 'x p'), ['ba', 1]);
});

test('character edits: x, X, s, r, J, tilde', () => {
  assert.deepEqual(edit('abcd', 1, 'x'), ['acd', 1]);
  assert.deepEqual(edit('abcd', 1, '2 x'), ['ad', 1]);
  assert.deepEqual(edit('abcd', 3, 'x'), ['abc', 2]);
  assert.deepEqual(edit('abcd', 2, 'X'), ['acd', 1]);
  assert.deepEqual(edit('abcd', 1, 'r z'), ['azcd', 1]);
  assert.deepEqual(edit('abcd', 1, '2 r z'), ['azzd', 2]);
  assert.deepEqual(edit('ab', 1, '3 r z'), ['ab', 1]);
  assert.deepEqual(edit('abc\n  def', 0, 'J'), ['abc def', 3]);
  assert.deepEqual(edit('aBc', 0, '~ ~'), ['Abc', 2]);
  const substituted = play('abc', 1, ['s', 'Z', 'Escape']);
  assert.equal(substituted.doc.text, 'aZc');
});

test('insert commands position the cursor', () => {
  assert.equal(play('  ab', 3, 'I').doc.cursor, 2);
  assert.equal(play('ab', 0, 'A').doc.cursor, 2);
  assert.equal(play('ab', 0, 'a').doc.cursor, 1);
  assert.deepEqual(edit('a\nb', 0, 'o'), ['a\n\nb', 2]);
  assert.deepEqual(edit('a\nb', 2, 'O'), ['a\n\nb', 2]);
  assert.equal(play('ab', 0, 'i').state.mode, 'insert');
});

test('text objects iw and aw work with operators and in visual mode', () => {
  assert.deepEqual(edit('foo bar baz', 5, 'd i w'), ['foo  baz', 4]);
  assert.deepEqual(edit('foo bar baz', 5, 'd a w'), ['foo baz', 4]);
  assert.deepEqual(edit('foo bar', 5, 'd a w'), ['foo', 2]);
  const selected = play('foo bar baz', 5, 'v i w');
  assert.deepEqual(visualSelection(selected.state, selected.doc), { start: 4, end: 7, linewise: false });
});

test('visual and visual-line modes select and operate', () => {
  const chars = play('hello world', 0, 'v l l');
  assert.equal(chars.state.mode, 'visual');
  assert.deepEqual(visualSelection(chars.state, chars.doc), { start: 0, end: 3, linewise: false });
  assert.deepEqual(edit('hello world', 0, 'v l l d'), ['lo world', 0]);
  assert.deepEqual(edit('hello world', 0, 'v e y $ p'), ['hello worldhello', 15]);
  assert.deepEqual(edit('a\nb\nc', 0, 'V j d'), ['c', 0]);
  const lines = play('a\nb\nc', 0, 'V j');
  assert.deepEqual(visualSelection(lines.state, lines.doc), { start: 0, end: 3, linewise: true });
  assert.equal(play('abc', 0, 'v Escape').state.mode, 'normal');
  assert.equal(play('abc', 0, 'v v').state.mode, 'normal');
  assert.equal(play('abc', 0, 'v V').state.mode, 'visual-line');
  const swapped = play('abcd', 0, 'v l l o');
  assert.equal(swapped.doc.cursor, 0);
  assert.equal(swapped.state.anchor, 2);
  const changed = play('abcd', 1, ['v', 'l', 'c', 'Z', 'Escape']);
  assert.equal(changed.doc.text, 'aZd');
});

test('dot repeats the last change including typed text', () => {
  assert.deepEqual(edit('a b c d', 0, 'd w .'), ['c d', 0]);
  assert.deepEqual(edit('abcdef', 0, 'x .'), ['cdef', 0]);
  assert.deepEqual(edit('a\nb\nc\nd', 0, 'd d .'), ['c\nd', 0]);
  const repeatedInsert = play('', 0, ['i', 'a', 'b', 'Escape', '.']);
  assert.equal(repeatedInsert.doc.text, 'aabb');
  const repeatedChange = play('one two three', 0, ['c', 'w', 'X', 'Escape', 'w', '.']);
  assert.equal(repeatedChange.doc.text, 'X X three');
  const repeatedAppend = play('a b', 0, ['A', '!', 'Escape', '0', '.']);
  assert.equal(repeatedAppend.doc.text, 'a b!!');
  assert.deepEqual(edit('abc', 0, '.'), ['abc', 0]);
  const afterYank = play('abc abc', 0, 'x y l .');
  assert.equal(afterYank.doc.text, 'c abc');
});

test('undo and redo are delegated to the editor history', () => {
  const undo = play('abc', 0, 'u');
  assert.equal(undo.results.at(-1).history, 'undo');
  assert.equal(play('abc', 0, ['ctrl+r']).results.at(-1).history, 'redo');
});

test('Return submits from normal mode and unknown keys are swallowed', () => {
  assert.equal(play('abc', 0, ['Return']).results.at(-1).submit, true);
  assert.deepEqual(edit('abc', 0, 'z q'), ['abc', 0]);
  assert.equal(vimKey(initialVimState('normal'), { text: 'abc', cursor: 0 }, 'ArrowLeft').handled, false);
});

test('Escape clears a pending operator, count and find without touching text', () => {
  const state = play('abc def', 0, 'd Escape');
  assert.equal(state.doc.text, 'abc def');
  assert.equal(state.state.operator, undefined);
  assert.deepEqual(edit('abc def', 0, '3 Escape x'), ['bc def', 0]);
});

test('surrogate pairs are never split', () => {
  assert.deepEqual(edit('a😀b', 1, 'x'), ['ab', 1]);
  assert.equal(play('a😀b', 0, 'l').doc.cursor, 1);
  assert.equal(play('a😀b', 0, 'l l').doc.cursor, 3);
});

test('every entry of the Vim reference shown to users is an executable example', async () => {
  const { VIM_REFERENCE } = await import('../dist/tui/vim-reference.js');
  const entries = VIM_REFERENCE.flatMap(group => group.entries);
  assert.ok(entries.length >= 25);
  for (const { keys, example } of entries) {
    const { doc, results } = play(example.text, example.cursor, example.play);
    assert.equal(doc.text, example.result, `${keys}: text`);
    if (example.resultCursor !== undefined) assert.equal(doc.cursor, example.resultCursor, `${keys}: cursor`);
    if (example.submits) assert.equal(results.at(-1).submit, true, `${keys}: submits`);
  }
});

test('j and k aim for the remembered column across short lines and forget it after other commands', () => {
  assert.equal(play('abcdef\nab\nabcdef', 5, 'j j').doc.cursor, 15);
  assert.equal(play('abcdef\nab\nabcdef', 5, 'j h j').doc.cursor, 10);
});

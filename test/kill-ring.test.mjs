import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyKillRing, kill, KILL_RING_LIMIT, yank, yankPop } from '../dist/tui/kill-ring.js';

const killed = (text, cursor, kind, ring = emptyKillRing(), continuing = false) => kill(ring, { text, cursor }, kind, continuing);

test('line kills save the removed text and join lines at the line end', () => {
  const toEnd = killed('hello world', 5, 'line-end');
  assert.deepEqual(toEnd.doc, { text: 'hello', cursor: 5 });
  assert.deepEqual(toEnd.ring.entries, [' world']);
  const joined = killed('ab\ncd', 2, 'line-end');
  assert.deepEqual(joined.doc, { text: 'abcd', cursor: 2 });
  assert.deepEqual(joined.ring.entries, ['\n']);
  assert.equal(killed('ab', 2, 'line-end'), undefined);
  const toStart = killed('ab\ncd ef', 6, 'line-start');
  assert.deepEqual(toStart.doc, { text: 'ab\nef', cursor: 3 });
  assert.deepEqual(toStart.ring.entries, ['cd ']);
  assert.equal(killed('ab\ncd', 3, 'line-start'), undefined);
});

test('word kills respect word classes and whitespace-delimited shell words', () => {
  assert.deepEqual(killed('foo bar.baz', 11, 'word-back').doc, { text: 'foo bar.', cursor: 8 });
  assert.deepEqual(killed('foo bar.baz', 11, 'shell-word-back').doc, { text: 'foo ', cursor: 4 });
  assert.deepEqual(killed('foo bar', 0, 'word-forward').doc, { text: ' bar', cursor: 0 });
  assert.deepEqual(killed('foo bar', 3, 'word-forward').doc, { text: 'foo', cursor: 3 });
  assert.equal(killed('foo', 0, 'word-back'), undefined);
});

test('consecutive kills extend the newest entry in the direction of the kill', () => {
  const first = killed('one two three', 13, 'word-back');
  const second = killed(first.doc.text, first.doc.cursor, 'word-back', first.ring, true);
  assert.deepEqual(second.ring.entries, ['two three']);
  const forward = killed('a b c', 0, 'word-forward');
  const joined = killed(forward.doc.text, forward.doc.cursor, 'word-forward', forward.ring, true);
  assert.deepEqual(joined.ring.entries, ['a b']);
  const separate = killed('a b c', 0, 'word-forward', forward.ring, false);
  assert.deepEqual(separate.ring.entries, ['a', 'a']);
});

test('yank inserts the newest kill and yank-pop cycles through older entries', () => {
  let ring = emptyKillRing();
  for (const word of ['one', 'two', 'three']) ring = kill(ring, { text: word, cursor: 0 }, 'line-end', false).ring;
  assert.deepEqual(ring.entries, ['three', 'two', 'one']);
  const yanked = yank(ring, { text: 'x', cursor: 1 });
  assert.deepEqual(yanked.doc, { text: 'xthree', cursor: 6 });
  const popped = yankPop(yanked.ring, yanked.doc);
  assert.deepEqual(popped.doc, { text: 'xtwo', cursor: 4 });
  const wrapped = yankPop(yankPop(popped.ring, popped.doc).ring, yankPop(popped.ring, popped.doc).doc);
  assert.equal(wrapped.doc.text, 'xthree');
  assert.equal(yank(emptyKillRing(), { text: '', cursor: 0 }), undefined);
});

test('yank-pop only works directly after a yank of unchanged text', () => {
  const ring = kill(kill(emptyKillRing(), { text: 'a', cursor: 0 }, 'line-end', false).ring, { text: 'b', cursor: 0 }, 'line-end', false).ring;
  const yanked = yank(ring, { text: '', cursor: 0 });
  assert.equal(yankPop(ring, yanked.doc), undefined);
  assert.equal(yankPop(yanked.ring, { text: 'edited', cursor: 6 }), undefined);
});

test('the ring keeps a bounded number of entries', () => {
  let ring = emptyKillRing();
  for (let index = 0; index < KILL_RING_LIMIT + 10; index++) ring = kill(ring, { text: String(index), cursor: 0 }, 'line-end', false).ring;
  assert.equal(ring.entries.length, KILL_RING_LIMIT);
  assert.equal(ring.entries[0], String(KILL_RING_LIMIT + 9));
});

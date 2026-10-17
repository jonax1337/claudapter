import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import {safeText,wrapText} from '../dist/tui/editor.js';

test('terminal text removes escape commands, clipboard OSC and control strings', () => {
  const unsafe='\x1b[31mred\x1b[0m\x1b]52;c;secret\x07!\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\'+
    '\x1bPsecret\x1b\\\x9d52;c;hidden\x9c\x00\b\x7f\u202etext\r\n\tend';
  assert.equal(safeText(unsafe),'red!linktext\n\tend');
  assert.equal(safeText('visible\x1b]52;c;unterminated'),'visible');
});

test('wrapping counts display cells, preserves graphemes and expands tab stops', () => {
  assert.deepEqual(wrapText('a界👩🏽‍💻é',3),['a界','👩🏽‍💻é']);
  assert.deepEqual(wrapText('a\tb\n\n',4),['a   ','b','','']);
  assert.deepEqual(wrapText('',5),['']);
  assert.deepEqual(wrapText('界',1),['界']);
  assert.deepEqual(wrapText('\x1b[31mhello\x1b[0m',3),['hel','lo']);
  for(const line of wrapText('界👩🏽‍💻 hello\tworld',5)) assert.ok(stringWidth(line)<=5);
  for(const width of [0,-1,1.5,Infinity]) assert.throws(()=>wrapText('x',width),RangeError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import {editDraft,safeText,wrapText} from '../dist/tui/editor.js';

test('editor moves and deletes whole combining characters and emoji sequences', () => {
  const emoji='👩🏽‍💻', text='Ae\u0301'+emoji+'界';
  let draft={text,cursor:text.length};
  draft=editDraft(draft,'',{leftArrow:true});
  assert.equal(draft.cursor,text.length-1);
  draft=editDraft(draft,'',{backspace:true});
  assert.deepEqual(draft,{text:'Ae\u0301界',cursor:3});
  draft=editDraft(draft,'',{leftArrow:true});
  assert.equal(draft.cursor,1);
  draft=editDraft(draft,'',{delete:true});
  assert.deepEqual(draft,{text:'A界',cursor:1});
  assert.equal(editDraft({text:emoji,cursor:2},'',{rightArrow:true}).cursor,emoji.length);
  assert.deepEqual(editDraft({text:'e',cursor:1},'\u0301'),{text:'e\u0301',cursor:2});
});

test('multiline paste and line editing preserve text and keep Enter parent-controlled', () => {
  let draft=editDraft({text:'ab',cursor:1},'界\r\nhello\rworld');
  assert.deepEqual(draft,{text:'a界\nhello\nworldb',cursor:14});
  assert.deepEqual(editDraft(draft,'\n',{return:true}),draft);
  draft=editDraft(draft,'',{home:true});
  assert.equal(draft.cursor,9);
  draft=editDraft(draft,'k',{ctrl:true});
  assert.deepEqual(draft,{text:'a界\nhello\n',cursor:9});
  draft=editDraft(draft,'',{backspace:true});
  draft=editDraft(draft,'a',{ctrl:true});
  draft=editDraft(draft,'',{end:true});
  draft=editDraft(draft,'u',{ctrl:true});
  assert.deepEqual(draft,{text:'a界\n',cursor:3});
  assert.deepEqual(editDraft({text:'a\nb',cursor:1},'k',{ctrl:true}),{text:'ab',cursor:1});
});

test('vertical navigation uses terminal columns across CJK, emoji and tabs', () => {
  const text='界x\na💡b\n\tz';
  const up=editDraft({text,cursor:7},'',{upArrow:true});
  assert.equal(up.cursor,2);
  const down=editDraft({text,cursor:2},'',{downArrow:true});
  assert.equal(down.cursor,6);
  assert.equal(editDraft(down,'',{downArrow:true}).cursor,8);
  assert.equal(editDraft({text,cursor:7},'',{downArrow:true}).cursor,9);
  assert.equal(editDraft({text,cursor:0},'',{upArrow:true}).cursor,0);
});

test('word navigation and deletion use whitespace boundaries without splitting Unicode', () => {
  const text='one  👩🏽‍💻界 three';
  let draft=editDraft({text,cursor:0},'',{ctrl:true,rightArrow:true});
  assert.equal(draft.cursor,5);
  draft=editDraft(draft,'',{ctrl:true,rightArrow:true});
  assert.equal(text.slice(draft.cursor),'three');
  draft=editDraft(draft,'w',{ctrl:true});
  assert.deepEqual(draft,{text:'one  three',cursor:5});
  assert.equal(editDraft(draft,'',{ctrl:true,leftArrow:true}).cursor,0);
  assert.equal(editDraft(draft,'e',{ctrl:true}).cursor,draft.text.length);
  assert.deepEqual(editDraft(draft,'c',{ctrl:true}),draft);
});

test('terminal text removes escape commands, clipboard OSC and control strings', () => {
  const unsafe='\x1b[31mred\x1b[0m\x1b]52;c;secret\x07!\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\'+
    '\x1bPsecret\x1b\\\x9d52;c;hidden\x9c\x00\b\x7f\u202etext\r\n\tend';
  assert.equal(safeText(unsafe),'red!linktext\n\tend');
  assert.equal(safeText('visible\x1b]52;c;unterminated'),'visible');
  assert.deepEqual(editDraft({text:'',cursor:0},unsafe),{text:'red!linktext\n\tend',cursor:17});
});

test('wrapping counts display cells, preserves graphemes and expands tab stops', () => {
  assert.deepEqual(wrapText('a界👩🏽‍💻e\u0301',3),['a界','👩🏽‍💻e\u0301']);
  assert.deepEqual(wrapText('a\tb\n\n',4),['a   ','b','','']);
  assert.deepEqual(wrapText('',5),['']);
  assert.deepEqual(wrapText('界',1),['界']);
  assert.deepEqual(wrapText('\x1b[31mhello\x1b[0m',3),['hel','lo']);
  for(const line of wrapText('界👩🏽‍💻 hello\tworld',5)) assert.ok(stringWidth(line)<=5);
  for(const width of [0,-1,1.5,Infinity]) assert.throws(()=>wrapText('x',width),RangeError);
});

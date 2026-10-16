import test from 'node:test';
import assert from 'node:assert/strict';
import {copyText} from '../dist/tui/clipboard.js';

test('oversized clipboard exports are refused before touching the operating system',async()=>{
  await assert.rejects(copyText('x'.repeat(2*1024*1024+1)),/limited to 2 MiB/);
});

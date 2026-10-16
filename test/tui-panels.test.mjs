import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { transcriptLines, TranscriptView, UsagePanel, ContextPanel } from '../dist/tui/panels.js';

const size = { width: 72, height: 35, accent: '#9caeff' };
const snapshot = {
  since: '2026-10-16T12:00:00.000Z', scope: 'Gateway lifetime only.', attempts: [], totals: [],
  providers: [{ provider: 'chatgpt', state: 'unknown', source: 'Fixture quota adapter', stale: true,
    reason: 'Quota API unavailable.', windows: [], money: { status: 'unknown', amount: null, note: 'Subscription billing is not reported per request.' } }],
};
async function frame(Component, props) {
  const view = render(React.createElement(Component, { ...size, ...props }));
  await new Promise(resolve => setImmediate(resolve));
  const output = view.lastFrame();
  view.unmount();
  return output;
}

test('transcript rows preserve fenced code, strip control sequences and fit cell widths', () => {
  const entries = [{ id: '1', kind: 'assistant', text: '# Heading\n```ts\n  const answer = 42;\n```\n界界🙂é\u001b[2J' },
    { id: '2', kind: 'tool', toolName: 'Read', text: 'README.md', details: 'one\ntwo', status: 'done' }];
  for (const width of [1, 2, 12, 40]) {
    const lines = transcriptLines(entries, width);
    assert.ok(lines.every(line => stringWidth(line.text) <= width), `width ${width}`);
    assert.ok(lines.every(line => !line.text.includes('\u001b')));
  }
  const text = transcriptLines(entries, 72).map(l => l.text).join('\n');
  assert.match(text, /│   const answer = 42;/);
  assert.match(text, /Read  ·  DONE/);
  assert.doesNotMatch(text, /```/);
});

test('thinking is opt-in and scroll is measured from the transcript bottom', async () => {
  const entries = [{ id: 'secret', kind: 'thinking', text: 'hidden reasoning' },
    ...Array.from({ length: 15 }, (_, i) => ({ id: String(i), kind: 'assistant', text: `answer-${String(i).padStart(2, '0')}` }))];
  assert.doesNotMatch(transcriptLines(entries, 60).map(l => l.text).join('\n'), /hidden reasoning/);
  assert.match(transcriptLines(entries, 60, true).map(l => l.text).join('\n'), /hidden reasoning/);
  const bottom = await frame(TranscriptView, { entries, width: 60, height: 8, scroll: 0 });
  assert.match(bottom, /answer-14/);
  assert.doesNotMatch(bottom, /answer-00/);
  assert.ok(bottom.split('\n').length <= 8);
  const top = await frame(TranscriptView, { entries, width: 60, height: 8, scroll: 10000 });
  assert.match(top, /answer-00/);
  assert.doesNotMatch(top, /answer-14/);
  assert.match(top, /newer/);
  assert.ok(top.split('\n').length <= 8);
});

test('usage shows unknown quotas and billing without fabricated zero percentages or prices', async () => {
  const output = await frame(UsagePanel, { snapshot });
  assert.match(output, /STALE/);
  assert.match(output, /Quota remaining · unknown/);
  assert.match(output, /Cost · unknown/);
  assert.match(output, /Quota API unavailable/);
  assert.doesNotMatch(output, /0%|\$0|Cost[^\n]*0\.00/);
});

test('usage separates reported quotas, routed token totals and unknown attempts', async () => {
  const data = structuredClone(snapshot);
  data.providers[0].state = 'available'; data.providers[0].stale = false;
  data.providers[0].windows = [{ id: 'weekly', usedPercent: 25, resetsAt: null, windowSeconds: 604800 }];
  data.totals = [{ provider: 'chatgpt', actualModel: 'gpt-fixture', agent: 'reviewer', attempts: 2, completed: 1, unknown: 1, interrupted: 1,
    tokens: { input: 1200, output: 80, cacheRead: 200, cacheCreate: null, reasoning: null } }];
  const output = await frame(UsagePanel, { snapshot: data });
  assert.match(output, /25% used/);
  assert.match(output, /chatgpt \/ gpt-fixture · agent reviewer/);
  assert.match(output, /Input 1,200 · Output 80/);
  assert.match(output, /1 unmeasured · 1 interrupted/);
  assert.match(output, /Cache write unknown/);
});

test('context distinguishes catalog maximum, engine window and estimates', async () => {
  const model = { id: 'gpt-fixture', label: 'GPT fixture', context: 872000, maxContext: 872000, contextSource: 'max_context_window' };
  const context = { model: 'gpt-fixture', rawMaxTokens: 872000, maxTokens: 800000, autoCompactThreshold: 767000, totalTokens: 12000,
    categories: [{ name: 'System prompt', tokens: 1000, kind: 'used' }] };
  const output = await frame(ContextPanel, { model, context });
  assert.match(output, /Catalog capacity · 872,000/);
  assert.match(output, /Active context window · 800,000/);
  assert.match(output, /Auto-compact threshold · 767,000/);
  assert.match(output, /12,000 tokens \(engine estimate\)/);
  assert.match(output, /1\.5%/);
});

test('empty context remains unknown and narrow panels stay inside their viewport', async () => {
  const unknown = await frame(ContextPanel, {});
  assert.match(unknown, /Engine capacity · unknown/);
  assert.doesNotMatch(unknown, /0\.0%/);
  for (const Component of [UsagePanel, ContextPanel, TranscriptView]) {
    const output = await frame(Component, { snapshot, entries: [{ id: 'narrow', kind: 'user', text: '界界🙂 hello '.repeat(20) }], width: 18, height: 6 });
    assert.ok(output.split('\n').length <= 6, Component.name);
    assert.ok(output.split('\n').every(line => stringWidth(line) <= 18), Component.name);
  }
});

test('usage can scroll to providers and accounting beyond the first viewport', async()=>{
  const data=structuredClone(snapshot);
  data.providers=Array.from({length:8},(_,i)=>({...data.providers[0],provider:'fixture-'+i}));
  const first=await frame(UsagePanel,{snapshot:data,width:70,height:10});
  const last=await frame(UsagePanel,{snapshot:data,width:70,height:10,scroll:10000});
  assert.match(first,/FIXTURE-0/);assert.doesNotMatch(first,/REQUEST TOKENS/);
  assert.match(last,/REQUEST TOKENS/);assert.match(last,/PgUp\/PgDn/);
});

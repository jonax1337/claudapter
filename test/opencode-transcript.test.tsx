import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import { Transcript, isRenderable, type TranscriptEntry } from '../src/tui/opencode/transcript';
import { countChanges, fileDiffFor, lineDiff, numberRows, patchRows, splitLines, trimContext, unifiedDiff, visibleRows } from '../src/tui/opencode/diff';
import { exitCodeOf, formatElapsed, headLines, rowSuffix, tailLines, toolInput, toolOutput } from '../src/tui/opencode/tool-views';

const FRAME_WAIT_MS = 2000;

async function frameContaining(view: Awaited<ReturnType<typeof testRender>>, text: string) {
  const deadline = Date.now() + FRAME_WAIT_MS;
  await view.renderOnce();
  while (!view.captureCharFrame().includes(text) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    await view.renderOnce();
  }
  return view.captureCharFrame();
}

async function renderEntries(entries: TranscriptEntry[], options: { width?: number; height?: number; thinking?: boolean; details?: boolean } = {}) {
  const view = await testRender(() => (
    <box width="100%" height="100%" flexDirection="column">
      <Transcript entries={entries} busy={false} thinking={options.thinking ?? true} details={options.details ?? false} />
    </box>
  ), { width: options.width ?? 100, height: options.height ?? 40 });
  await view.renderOnce();
  return view;
}

function tool(toolName: string, input: Record<string, unknown>, extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { id: 'tool:' + toolName, kind: 'tool', text: toolName, toolName, status: 'done', input, ...extra };
}

describe('line diff', () => {
  const kinds = (rows: { kind: string }[]) => rows.map(row => row.kind[0]).join('');

  test('empty and identical inputs produce no changes', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(countChanges(lineDiff('a\nb\n', 'a\nb\n'))).toEqual({ added: 0, removed: 0 });
    expect(trimContext(lineDiff('a\nb', 'a\nb'))).toEqual([]);
    expect(fileDiffFor('Edit', { file_path: 'x', old_string: 'same', new_string: 'same' })).toBeUndefined();
  });

  test('pure additions and removals', () => {
    expect(kinds(lineDiff('', 'a\nb'))).toBe('aa');
    expect(kinds(lineDiff('a\nb', ''))).toBe('rr');
  });

  test('replaces a single line between untouched neighbours', () => {
    const rows = lineDiff('a\nb\nc', 'a\nX\nc');
    expect(rows.map(row => `${row.kind[0]}:${row.text}`)).toEqual(['c:a', 'r:b', 'a:X', 'c:c']);
  });

  test('multi-hunk diff keeps three context lines and collapses the rest into a gap', () => {
    const before = Array.from({ length: 20 }, (_, index) => 'line' + index);
    const after = [...before];
    after[1] = 'changed1';
    after[17] = 'changed17';
    const rows = trimContext(lineDiff(before.join('\n'), after.join('\n')));
    expect(rows.filter(row => row.kind === 'gap')).toHaveLength(1);
    expect(rows.find(row => row.kind === 'gap')!.text).toContain('unchanged');
    expect(countChanges(rows)).toEqual({ added: 2, removed: 2 });
    expect(rows[0].text).toBe('line0');
    expect(rows[rows.length - 1].text).toBe('line19');
    expect(rows.some(row => row.text === 'line9')).toBe(false);
  });

  test('moved and reordered lines stay minimal', () => {
    const rows = lineDiff('a\nb\nc\nd', 'a\nc\nd\nb');
    expect(countChanges(rows)).toEqual({ added: 1, removed: 1 });
  });

  test('oversized middles degrade to a replace block instead of a huge table', () => {
    const before = Array.from({ length: 1500 }, (_, index) => 'old' + index).join('\n');
    const after = Array.from({ length: 1500 }, (_, index) => 'new' + index).join('\n');
    expect(countChanges(lineDiff(before, after))).toEqual({ added: 1500, removed: 1500 });
  });

  test('splitLines ignores one trailing newline', () => {
    expect(splitLines('a\n')).toEqual(['a']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });

  test('structuredPatch hunks become numbered rows with a gap between hunks', () => {
    const rows = patchRows([
      { oldStart: 2, oldLines: 2, newStart: 2, newLines: 2, lines: [' keep', '-old', '+new'] },
      { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1, lines: ['-x', '+y', '\\ No newline at end of file'] },
    ]);
    expect(rows.map(row => row.kind[0])).toEqual(['c', 'r', 'a', 'g', 'r', 'a']);
    expect(rows[1].lineNumber).toBe(3);
    expect(rows[2].lineNumber).toBe(3);
    expect(rows[4].lineNumber).toBe(20);
    expect(patchRows(undefined)).toEqual([]);
  });

  test('numberRows numbers removals by old position and the rest by new position', () => {
    const rows = numberRows(lineDiff('a\nb', 'a\nc'), 10, 20);
    expect(rows.map(row => row.lineNumber)).toEqual([20, 11, 21]);
  });
});

describe('edit tool diffs', () => {
  test('Edit prefers structuredPatch over the computed diff', () => {
    const diff = fileDiffFor('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
      { structuredPatch: [{ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ['-p', '+q'] }] })!;
    expect(diff.rows.map(row => row.text)).toEqual(['p', 'q']);
    expect(diff.rows[0].lineNumber).toBe(5);
  });

  test('MultiEdit joins every edit and Write shows all lines as added', () => {
    const multi = fileDiffFor('MultiEdit', { file_path: 'm.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })!;
    expect(countChanges(multi.rows)).toEqual({ added: 2, removed: 2 });
    expect(multi.rows.some(row => row.kind === 'gap')).toBe(true);
    const write = fileDiffFor('Write', { file_path: 'w.ts', content: 'one\ntwo\nthree\n' }, { type: 'create', structuredPatch: [] })!;
    expect(countChanges(write.rows)).toEqual({ added: 3, removed: 0 });
    expect(write.rows.map(row => row.lineNumber)).toEqual([1, 2, 3]);
  });

  test('NotebookEdit shows new_source and ignores deletions', () => {
    expect(fileDiffFor('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 'print(1)' })!.added).toBe(1);
    expect(fileDiffFor('NotebookEdit', { notebook_path: 'n.ipynb', edit_mode: 'delete', new_source: 'x' })).toBeUndefined();
  });

  test('long diffs collapse after 40 rows unless expanded', () => {
    const rows = lineDiff('', Array.from({ length: 100 }, (_, index) => 'l' + index).join('\n'));
    expect(visibleRows(rows, false)).toMatchObject({ hidden: 60 });
    expect(visibleRows(rows, false).shown).toHaveLength(40);
    expect(visibleRows(rows, true).hidden).toBe(0);
  });
});

describe('tool helpers', () => {
  test('input and output fall back to the legacy details string', () => {
    const entry = { id: 'x', kind: 'tool', text: 'Read', details: '{"file_path":"a.ts"}\n\nline1\nline2' };
    expect(toolInput(entry)).toEqual({ file_path: 'a.ts' });
    expect(toolOutput(entry)).toBe('line1\nline2');
    expect(toolOutput({ ...entry, output: 'structured' })).toBe('structured');
  });

  test('tail and head truncation report hidden lines', () => {
    const text = Array.from({ length: 20 }, (_, index) => 'r' + index).join('\n');
    expect(tailLines(text, 12)).toMatchObject({ hidden: 8, shown: expect.arrayContaining(['r19']) });
    expect(tailLines(text, 12, true).hidden).toBe(0);
    expect(headLines(text, 5).shown).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  test('row suffix combines counts, exit status and elapsed time', () => {
    expect(rowSuffix(tool('Read', {}, { output: 'a\nb\nc' }))).toBe(' · 3 lines');
    expect(rowSuffix(tool('Grep', { output_mode: 'content' }, { output: 'a:1\nb:2' }))).toBe(' · 2 matches');
    expect(rowSuffix(tool('Glob', {}, { output: 'No files found' }))).toBe(' · 0 files');
    expect(rowSuffix(tool('Bash', {}, { status: 'error', output: 'Exit code 2\nboom', elapsedMs: 2300 }))).toBe(' · exit 2 · 2.3s');
    expect(exitCodeOf('Exit code 127\nx')).toBe(127);
    expect(formatElapsed(250)).toBe('250ms');
    expect(rowSuffix(tool('Read', {}, { status: 'running' }))).toBe('');
  });

  test('empty assistant entries and hidden thinking are not renderable', () => {
    expect(isRenderable({ id: 'a', kind: 'assistant', text: '  ' }, true)).toBe(false);
    expect(isRenderable({ id: 't', kind: 'thinking', text: 'x' }, false)).toBe(false);
    expect(isRenderable({ id: 't', kind: 'thinking', text: '' }, true)).toBe(true);
  });
});

describe('transcript rendering', () => {
  test('thinking: text, redacted and toggled off', async () => {
    const entries: TranscriptEntry[] = [
      { id: 'u', kind: 'user', text: 'Question' },
      { id: 't1', kind: 'thinking', text: 'Weighing options carefully', thinkingTokens: 120 },
      { id: 't2', kind: 'thinking', text: '', thinkingTokens: 2400 },
      { id: 'a', kind: 'assistant', text: 'Answer' },
    ];
    const on = await renderEntries(entries, { thinking: true });
    try {
      const frame = await frameContaining(on, 'Answer');
      expect(frame).toContain('Thinking · ~120 tokens');
      expect(frame).toContain('Weighing options carefully');
      expect(frame).toContain('◌ Thought · ~2.4K tokens (content not provided by the model)');
    } finally { on.renderer.destroy(); }
    const off = await renderEntries(entries, { thinking: false });
    try {
      const frame = await frameContaining(off, 'Answer');
      expect(frame).not.toContain('Thinking');
      expect(frame).not.toContain('Thought');
      const rows = frame.split('\n');
      const question = rows.findIndex(row => row.includes('Question'));
      const answer = rows.findIndex(row => row.includes('Answer'));
      expect(answer - question).toBeLessThanOrEqual(3);
    } finally { off.renderer.destroy(); }
  });

  test('redacted thought without a token count omits the number', async () => {
    const view = await renderEntries([{ id: 't', kind: 'thinking', text: '', redacted: true }]);
    try {
      expect(view.captureCharFrame()).toContain('◌ Thought (content not provided by the model)');
    } finally { view.renderer.destroy(); }
  });

  test('Edit renders a diff with counts and line numbers, collapsed beneath the row', async () => {
    const entry = tool('Edit', { file_path: 'src/a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' },
      { result: { structuredPatch: [{ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: ['-const a = 1;', '+const a = 2;'] }] } });
    const view = await renderEntries([entry]);
    try {
      const frame = await frameContaining(view, 'const a = 2;');
      expect(frame).toContain('← Edit src/a.ts');
      expect(frame).toContain('+1');
      expect(frame).toContain('−1');
      expect(frame).toContain('7 - const a = 1;');
      expect(frame).toContain('7 + const a = 2;');
    } finally { view.renderer.destroy(); }
  });

  test('long Write diffs show the expand hint and expand fully', async () => {
    const entry = tool('Write', { file_path: 'big.txt', content: Array.from({ length: 60 }, (_, index) => 'row' + index).join('\n') });
    const collapsed = await renderEntries([entry], { height: 80 });
    try {
      const frame = await frameContaining(collapsed, 'more lines');
      expect(frame).toContain('… 20 more lines (ctrl+o to expand)');
      expect(frame).not.toContain('row59');
    } finally { collapsed.renderer.destroy(); }
    const expanded = await renderEntries([entry], { height: 80, details: true });
    try {
      const frame = await frameContaining(expanded, 'row59');
      expect(frame).toContain('row59');
      expect(frame).not.toContain('more lines');
    } finally { expanded.renderer.destroy(); }
  });

  test('Bash shows tail-truncated output with elapsed time', async () => {
    const output = Array.from({ length: 30 }, (_, index) => 'out' + index).join('\n');
    const view = await renderEntries([tool('Bash', { command: 'npm test' }, { output, elapsedMs: 2300 })], { height: 60 });
    try {
      const frame = await frameContaining(view, 'out29');
      expect(frame).toContain('$ Bash npm test · 2.3s');
      expect(frame).toContain('… 18 more lines');
      expect(frame).toContain('out29');
      expect(frame).not.toContain('out0\n');
    } finally { view.renderer.destroy(); }
  });

  test('failed tools show the first output lines in an error block', async () => {
    const view = await renderEntries([tool('Bash', { command: 'false' }, { status: 'error', isError: true, output: 'Exit code 1\nboom happened' })]);
    try {
      const frame = await frameContaining(view, 'boom happened');
      expect(frame).toContain('✗ Bash false · exit 1');
      expect(frame).toContain('Exit code 1');
    } finally { view.renderer.destroy(); }
  });

  test('Read, Grep, WebFetch and TodoWrite use their dedicated views', async () => {
    const view = await renderEntries([
      tool('Read', { file_path: 'src/a.ts' }, { id: 'r', output: 'l1\nl2\nl3' }),
      tool('Grep', { pattern: 'foo' }, { id: 'g', output: Array.from({ length: 9 }, (_, index) => 'hit' + index + '.ts').join('\n') }),
      tool('WebFetch', { url: 'https://example.com' }, { id: 'w', output: '\nExample Domain page text\nmore' }),
      tool('TodoWrite', { todos: [
        { content: 'Done thing', status: 'completed', activeForm: 'Doing done thing' },
        { content: 'Active thing', status: 'in_progress', activeForm: 'Working on active thing' },
        { content: 'Later thing', status: 'pending', activeForm: 'x' },
      ] }, { id: 'd' }),
    ], { height: 60 });
    try {
      const frame = await frameContaining(view, 'Later thing');
      expect(frame).toContain('→ Read src/a.ts · 3 lines');
      expect(frame).not.toContain('l2');
      expect(frame).toContain('✱ Grep foo · 9 files');
      expect(frame).toContain('hit4.ts');
      expect(frame).not.toContain('hit5.ts');
      expect(frame).toContain('… 4 more lines');
      expect(frame).toContain('└ Example Domain page text');
      expect(frame).toContain('☑ Done thing');
      expect(frame).toContain('◐ Working on active thing');
      expect(frame).toContain('☐ Later thing');
    } finally { view.renderer.destroy(); }
  });

  test('sub-agent launches render as a task card with prompt and status', async () => {
    const entry = tool('Agent', { subagent_type: 'Explore', description: 'Find auth code', prompt: 'Look at login flow\nsecond line' }, { taskId: 'task-1' });
    const view = await renderEntries([entry, { ...entry, id: 'wf', toolName: 'Workflow', input: { workflow: 'release', description: 'Cut it' }, status: 'error', taskId: undefined }]);
    try {
      const frame = await frameContaining(view, 'Cut it');
      expect(frame).toContain('◉ Explore — Find auth code ✓');
      expect(frame).toContain('Look at login flow');
      expect(frame).not.toContain('second line');
      expect(frame).toContain('◉ release — Cut it ✗');
    } finally { view.renderer.destroy(); }
  });

  test('unknown tools keep the generic row and expand to details', async () => {
    const entry: TranscriptEntry = { id: 'x', kind: 'tool', text: 'Custom', toolName: 'Custom', status: 'done', details: '{"query":"abc"}\n\nraw result' };
    const collapsed = await renderEntries([entry]);
    try {
      const frame = await frameContaining(collapsed, 'Custom');
      expect(frame).toContain('⚙ Custom abc');
      expect(frame).not.toContain('raw result');
    } finally { collapsed.renderer.destroy(); }
    const expanded = await renderEntries([entry], { details: true });
    try {
      expect(await frameContaining(expanded, 'raw result')).toContain('raw result');
    } finally { expanded.renderer.destroy(); }
  });

  test('sub-agent output is labelled once per run and notices are centered', async () => {
    const view = await renderEntries([
      { id: 'n', kind: 'notice', text: '12 earlier messages hidden' },
      { id: 's1', kind: 'assistant', text: 'Sub finding', agent: 'reviewer' },
      tool('Read', { file_path: 'b.ts' }, { id: 's2', agent: 'reviewer', output: 'x' }),
      { id: 'm', kind: 'assistant', text: 'Main answer' },
    ], { width: 60 });
    try {
      const frame = await frameContaining(view, 'Sub finding');
      expect(frame.split('reviewer').length - 1).toBe(1);
      expect(frame).toContain('│');
      const notice = frame.split('\n').find(row => row.includes('12 earlier messages hidden'))!;
      expect(notice.indexOf('12 earlier')).toBeGreaterThan(10);
    } finally { view.renderer.destroy(); }
  });

  test('stays readable at 44 columns', async () => {
    const view = await renderEntries([
      tool('Edit', { file_path: 'src/very/long/path/to/some/component.tsx', old_string: 'a', new_string: 'a very long replacement line that must wrap rather than overflow the terminal' }),
      tool('Bash', { command: 'echo ' + 'x'.repeat(120) }, { output: 'wide output ' + 'y'.repeat(80) }),
      tool('Agent', { subagent_type: 'Explore', description: 'Investigate a really long description of the work' }),
    ], { width: 44, height: 60 });
    try {
      const frame = await frameContaining(view, 'Explore');
      for (const row of frame.split('\n')) expect(row.length).toBeLessThanOrEqual(44);
      expect(frame).toContain('replacement line');
      expect(frame).toContain('Explore');
    } finally { view.renderer.destroy(); }
  });
});

describe('unified workspace diff', () => {
  const patch = [
    'diff --git a/src/one.ts b/src/one.ts',
    'index 111..222 100644',
    '--- a/src/one.ts',
    '+++ b/src/one.ts',
    '@@ -2,2 +2,3 @@',
    ' keep',
    '-old',
    '+new',
    '+added',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-everything',
    '\\ No newline at end of file',
  ].join('\n');

  test('splits per file, names deletions from the old side and drops markers', () => {
    const files = unifiedDiff(patch);
    expect(files.map(file => file.path)).toEqual(['src/one.ts', 'gone.txt']);
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[1]).toMatchObject({ added: 0, removed: 1 });
    expect(files[1].rows.map(row => row.text)).toEqual(['everything']);
    expect(files.every(file => !file.rows.some(row => row.text.includes('No newline') || row.text.startsWith('a/')))).toBe(true);
  });

  test('hunk headers number old and new lines separately', () => {
    const [one] = unifiedDiff(patch);
    expect(one.rows.map(row => [row.kind, row.lineNumber])).toEqual([
      ['context', 2], ['remove', 3], ['add', 3], ['add', 4],
    ]);
  });
});

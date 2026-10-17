import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import { Transcript, isRenderable, type TranscriptEntry, type TranscriptSlots } from '../src/tui/opencode/transcript';
import { SPLIT_MIN_WIDTH, countChanges, fileDiffFor, lineDiff, numberRows, patchRows, splitLines, toUnifiedPatch, trimContext, unifiedDiff, visibleRows } from '../src/tui/opencode/diff';
import { exitCodeOf, formatElapsed, headLines, rowSuffix, tailLines, todoProgress, toolInput, toolOutput, toolState } from '../src/tui/opencode/tool-views';
import { formatBytes, imageLabel, permissionDetails, permissionLine, type PermissionRecord } from '../src/tui/opencode/block-model';
import { fetchMeta, sourceLabel, webSources } from '../src/tui/opencode/block-web';
import { ImageList, type ImageActions } from '../src/tui/opencode/block-image';
import { CodeBlock } from '../src/tui/opencode/block-code';
import { splitFences } from '../src/tui/opencode/markdown-blocks';
import { copyImageCommand, imageExtension, openImageCommand } from '../src/tui/opencode/clipboard-image';
import { IMAGE_DATA_LIMIT, describeImageBlock, imageBlocks, imageDimensions } from '../src/tui/image-info';
import { historyEntries, permissionEntry, permissionOutcome, suggestionRules, toolResultEntry } from '../src/tui/transcript-model';

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

const THEME_FREE_WIDTH = 100;

function locate(frame: string, text: string) {
  const rows = frame.split('\n');
  const y = rows.findIndex(row => row.includes(text));
  return { x: rows[y]?.indexOf(text) ?? -1, y };
}

async function clickText(view: Awaited<ReturnType<typeof testRender>>, text: string) {
  const { x, y } = locate(view.captureCharFrame(), text);
  expect(y).toBeGreaterThanOrEqual(0);
  view.renderer.clearSelection();
  await view.mockMouse.click(x + 1, y);
  await view.renderOnce();
}

async function renderWith(entries: TranscriptEntry[], slots: TranscriptSlots | undefined, options: { width?: number; height?: number } = {}) {
  const view = await testRender(() => (
    <box width="100%" height="100%" flexDirection="column">
      <Transcript entries={entries} busy={false} thinking={false} details={false} slots={slots} />
    </box>
  ), { width: options.width ?? THEME_FREE_WIDTH, height: options.height ?? 40 });
  await view.renderOnce();
  return view;
}

function pngHeader(width: number, height: number) {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const imageBlock = (bytes: Buffer, mediaType = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } });

describe('unified patch for the native diff renderer', () => {
  test('hunk headers carry both line positions and gaps start a new hunk', () => {
    const rows = patchRows([
      { oldStart: 7, oldLines: 3, newStart: 7, newLines: 3, lines: [' keep', '-old', '+new', ' tail'] },
      { oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: [' x', '+y'] },
    ]);
    expect(toUnifiedPatch('a.ts', rows).split('\n')).toEqual([
      '--- a/a.ts', '+++ b/a.ts', '@@ -7,3 +7,3 @@', ' keep', '-old', '+new', ' tail', '@@ -40,1 +40,2 @@', ' x', '+y',
    ]);
  });

  test('pure additions start at line zero on the old side; unnumbered rows fall back to line one', () => {
    const write = fileDiffFor('Write', { file_path: 'w.ts', content: 'a\nb' })!;
    expect(toUnifiedPatch('w.ts', write.rows)).toContain('@@ -0,0 +1,2 @@');
    const edit = fileDiffFor('Edit', { file_path: 'e.ts', old_string: 'a', new_string: 'b' })!;
    expect(toUnifiedPatch('e.ts', edit.rows)).toContain('@@ -1,1 +1,1 @@');
    expect(edit.rows.every(row => row.lineNumber === undefined)).toBe(true);
  });

  test('rows keep their positions on each side and tabs become spaces', () => {
    const rows = numberRows(lineDiff('a\nb', 'a\nc'), 10, 20);
    expect(rows.map(row => [row.oldLine, row.newLine])).toEqual([[10, 20], [11, undefined], [undefined, 21]]);
    expect(toUnifiedPatch('t', [{ kind: 'add', text: '\tx' }])).toContain('+  x');
    const [file] = unifiedDiff('--- a/f\n+++ b/f\n@@ -3,1 +3,1 @@\n-a\n+b');
    expect(file.rows.map(row => [row.oldLine, row.newLine])).toEqual([[3, undefined], [undefined, 3]]);
  });
});

describe('diff block rendering', () => {
  const entry = tool('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' },
    { result: { structuredPatch: [{ oldStart: 7, oldLines: 2, newStart: 7, newLines: 2, lines: [' export {};', '-const a = 1;', '+const a = 2;'] }] } });

  test('narrow terminals stack the sides, wide terminals show them side by side', async () => {
    const narrow = await renderEntries([entry], { width: 100 });
    try {
      const frame = await frameContaining(narrow, 'const a = 2;');
      expect(locate(frame, 'const a = 1;').y).not.toBe(locate(frame, 'const a = 2;').y);
    } finally { narrow.renderer.destroy(); }
    const wide = await renderEntries([entry], { width: SPLIT_MIN_WIDTH + 20 });
    try {
      const frame = await frameContaining(wide, 'const a = 2;');
      expect(locate(frame, 'const a = 1;').y).toBe(locate(frame, 'const a = 2;').y);
      expect(frame).toContain('src/a.ts +1 −1');
    } finally { wide.renderer.destroy(); }
  });

  test('writes of new files stay unified even on wide terminals', async () => {
    const view = await renderEntries([tool('Write', { file_path: 'n.txt', content: 'one\ntwo' })], { width: SPLIT_MIN_WIDTH + 20 });
    try {
      const frame = await frameContaining(view, 'two');
      expect(locate(frame, 'one').y).not.toBe(locate(frame, 'two').y);
    } finally { view.renderer.destroy(); }
  });

  test('clicking the header expands a collapsed diff and the hint collapses it again', async () => {
    const entryWithLongContent = tool('Write', { file_path: 'big.txt', content: Array.from({ length: 60 }, (_, index) => 'row' + index).join('\n') });
    const view = await renderEntries([entryWithLongContent], { height: 90 });
    try {
      expect(await frameContaining(view, 'more lines')).not.toContain('row59');
      await clickText(view, 'big.txt +60');
      expect(await frameContaining(view, 'row59')).toContain('row59');
      await clickText(view, 'big.txt +60');
      expect(await frameContaining(view, 'more lines')).not.toContain('row59');
    } finally { view.renderer.destroy(); }
  });

  test('MultiEdit and NotebookEdit render their blocks with counts', async () => {
    const view = await renderEntries([
      tool('MultiEdit', { file_path: 'm.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, { id: 'm' }),
      tool('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 'print(1)' }, { id: 'n' }),
    ], { height: 40 });
    try {
      const frame = await frameContaining(view, 'print(1)');
      expect(frame).toContain('m.ts +2 −2');
      expect(frame).toContain('n.ipynb +1 −0');
    } finally { view.renderer.destroy(); }
  });
});

describe('tool blocks', () => {
  test('one state per tool: running, succeeded, failed', () => {
    expect(toolState(tool('Bash', {}, { status: 'running' }))).toBe('running');
    expect(toolState(tool('Bash', {}, { status: 'done' }))).toBe('succeeded');
    expect(toolState(tool('Bash', {}, { status: 'done', isError: true }))).toBe('failed');
    expect(toolState(tool('Bash', {}, { status: 'error' }))).toBe('failed');
    expect(toolState({ id: 'x', kind: 'tool', text: 'X' })).toBe('running');
  });

  test('clicking a Bash row expands output and shows the whole command', async () => {
    const output = Array.from({ length: 30 }, (_, index) => 'out' + index).join('\n');
    const view = await renderEntries([tool('Bash', { command: 'npm test\nnpm run lint' }, { output, elapsedMs: 1200 })], { height: 70 });
    try {
      expect(await frameContaining(view, 'out29')).not.toContain('out0\n');
      await clickText(view, '$ Bash');
      const frame = await frameContaining(view, 'npm run lint');
      expect(frame).toContain('$ npm test');
      expect(frame).toContain('out0');
      expect(frame).not.toContain('more lines');
    } finally { view.renderer.destroy(); }
  });

  test('WebSearch lists its sources and counts them; WebFetch shows status and size', async () => {
    const output = 'Links: [{"title":"OpenTUI","url":"https://opentui.com/docs"},{"title":"Repo","url":"https://github.com/sst/opentui"},'
      + '{"title":"Third","url":"https://a.dev/x"},{"title":"Fourth","url":"https://b.dev/y"}]\n\nSummary text';
    const view = await renderEntries([
      tool('WebSearch', { query: 'opentui' }, { id: 's', output }),
      tool('WebFetch', { url: 'https://example.com' }, { id: 'f', output: 'Example Domain', result: { code: 200, codeText: 'OK', bytes: 12700 } }),
    ], { height: 40 });
    try {
      const frame = await frameContaining(view, 'Example Domain');
      expect(frame).toContain('◈ WebSearch opentui · 4 sources');
      expect(frame).toContain('• opentui.com/docs — OpenTUI');
      expect(frame).toContain('• a.dev/x — Third');
      expect(frame).toContain('… 1 more source');
      expect(frame).not.toContain('b.dev/y');
      expect(frame).toContain('% WebFetch https://example.com · 200 OK · 12.4 KB');
    } finally { view.renderer.destroy(); }
  });

  test('web sources come from the structured result first, then JSON links, then bare URLs, without duplicates', () => {
    const structured = { results: [{ tool_use_id: 'a', content: [{ title: 'One', url: 'https://one.dev/a' }, { title: 'Dup', url: 'https://one.dev/a' }] }, 'text'] };
    expect(webSources('ignored https://other.dev', structured)).toEqual([{ url: 'https://one.dev/a', title: 'One' }]);
    expect(webSources('{"url":"https://x.dev/p","title":"Reversed"}', undefined)).toEqual([{ url: 'https://x.dev/p', title: 'Reversed' }]);
    expect(webSources('See https://a.dev/page, and https://a.dev/page. Also https://b.dev', undefined).map(source => source.url)).toEqual(['https://a.dev/page', 'https://b.dev']);
    expect(webSources('nothing here', undefined)).toEqual([]);
    expect(sourceLabel({ url: 'https://a.dev/' })).toBe('a.dev');
    expect(sourceLabel({ url: 'not a url' })).toBe('not a url');
    expect(fetchMeta({ code: 404, codeText: 'Not Found', bytes: 5 })).toEqual({ code: 404, codeText: 'Not Found', bytes: 5 });
    expect(fetchMeta('nope')).toEqual({});
  });

  test('TodoWrite shows progress in its row and the live checklist beneath', async () => {
    expect(todoProgress([{ status: 'completed' }, { status: 'pending' }, { status: 'completed' }])).toBe('2/3 done');
    const view = await renderEntries([tool('TodoWrite', { todos: [
      { content: 'First', status: 'completed' }, { content: 'Second', status: 'in_progress', activeForm: 'Doing second' }, { content: 'Third', status: 'pending' },
    ] })]);
    try {
      const frame = await frameContaining(view, 'Third');
      expect(frame).toContain('☐ TodoWrite 1/3 done');
      expect(frame).toContain('◐ Doing second');
    } finally { view.renderer.destroy(); }
  });
});

describe('inline permission rows', () => {
  const record = (permission: PermissionRecord, input: Record<string, unknown> = { command: 'npm test' }, toolName = 'Bash') =>
    ({ id: 'permission:' + toolName + permission.decision, kind: 'permission', text: toolName, toolName, input, permission }) as TranscriptEntry;

  test('describes each decision and who made it', () => {
    expect(permissionLine({ decision: 'pending' })).toMatchObject({ glyph: '?', tone: 'pending', by: 'waiting for your decision' });
    expect(permissionLine({ decision: 'allow-once', decidedBy: 'user' })).toMatchObject({ headline: 'Allowed once', tone: 'allowed', by: 'by you' });
    expect(permissionLine({ decision: 'allow-session', decidedBy: 'user' }).headline).toBe('Allowed for this session');
    expect(permissionLine({ decision: 'deny', decidedBy: 'user' })).toMatchObject({ glyph: '✗', tone: 'denied' });
    expect(permissionLine({ decision: 'cancelled', decidedBy: 'engine' })).toMatchObject({ tone: 'cancelled', by: 'ended before a decision' });
    expect(permissionDetails({ decision: 'allow-session', agentId: 'ag', blockedPath: '/p', rules: ['Bash(npm:*)', 'Edit'] }))
      .toEqual(['agent ag', 'path /p', 'rules Bash(npm:*), Edit']);
    expect(permissionDetails({ decision: 'allow-once', rules: ['Bash'] })).toEqual([]);
  });

  test('stays in the transcript after the decision, with request context', async () => {
    const view = await renderEntries([
      record({ decision: 'pending' }),
      record({ decision: 'allow-session', decidedBy: 'user', agentId: 'agent-7', rules: ['Bash(npm test:*)'] }),
      record({ decision: 'deny', decidedBy: 'user' }, { file_path: 'a.txt' }, 'Write'),
      record({ decision: 'cancelled', decidedBy: 'engine' }, { file_path: 'b.txt' }, 'Edit'),
    ], { height: 30 });
    try {
      const frame = await frameContaining(view, 'Request ended');
      expect(frame).toContain('? Permission requested · Bash npm test · waiting for your decision');
      expect(frame).toContain('✓ Allowed for this session · Bash npm test · by you');
      expect(frame).toContain('agent agent-7');
      expect(frame).toContain('rules Bash(npm test:*)');
      expect(frame).toContain('✗ Denied · Write a.txt · by you');
      expect(frame).toContain('∅ Request ended · Edit b.txt · ended before a decision');
    } finally { view.renderer.destroy(); }
  });

  test('entries without a record render nothing', () => {
    expect(isRenderable({ id: 'p', kind: 'permission', text: 'Bash' }, false)).toBe(false);
  });

  test('controller helpers key the row by request id, clip long inputs and map answers to decisions', () => {
    const entry = permissionEntry('req-1', 'Write', { file_path: 'a.ts', content: 'x'.repeat(2000) }, { decision: 'pending' });
    expect(entry).toMatchObject({ id: 'permission:req-1', kind: 'permission', toolName: 'Write' });
    expect((entry.input!.content as string).length).toBe(301);
    expect(permissionOutcome('allow', false)).toEqual({ decision: 'allow-once', decidedBy: 'user' });
    expect(permissionOutcome('session', false)).toEqual({ decision: 'allow-session', decidedBy: 'user' });
    expect(permissionOutcome('deny', false)).toEqual({ decision: 'deny', decidedBy: 'user' });
    expect(permissionOutcome('allow', true)).toEqual({ decision: 'cancelled', decidedBy: 'engine' });
    expect(suggestionRules([{ rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }, { toolName: 'Read' }] }, null])).toEqual(['Bash(npm test:*)', 'Read']);
  });
});

describe('images', () => {
  test('reads dimensions from PNG, JPEG, GIF and WebP headers', () => {
    expect(imageDimensions(pngHeader(1200, 800))).toEqual({ width: 1200, height: 800 });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]), Buffer.alloc(20)]);
    expect(imageDimensions(jpeg)).toEqual({ width: 640, height: 480 });
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x01, 0xc8, 0x00]), Buffer.alloc(8)]);
    expect(imageDimensions(gif)).toEqual({ width: 320, height: 200 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBP', 8, 'latin1');
    webp.write('VP8X', 12, 'latin1');
    webp.writeUIntLE(99, 24, 3);
    webp.writeUIntLE(49, 27, 3);
    expect(imageDimensions(webp)).toEqual({ width: 100, height: 50 });
    expect(imageDimensions(Buffer.from('not an image at all, just text'))).toBeUndefined();
  });

  test('describes image blocks, keeps small payloads and ignores other blocks', () => {
    const png = pngHeader(10, 20);
    expect(describeImageBlock(imageBlock(png))).toEqual({ mediaType: 'image/png', bytes: 33, width: 10, height: 20, data: png.toString('base64') });
    expect(describeImageBlock({ type: 'text', text: 'x' })).toBeUndefined();
    expect(describeImageBlock({ type: 'image', source: { type: 'url', url: 'x' } })).toBeUndefined();
    const huge = describeImageBlock({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngHeader(1, 1).toString('base64') + 'A'.repeat(IMAGE_DATA_LIMIT * 4 / 3) } })!;
    expect(huge.data).toBeUndefined();
    expect(huge.bytes).toBeGreaterThan(IMAGE_DATA_LIMIT);
    expect(imageBlocks([{ type: 'text', text: 'a' }, imageBlock(png), imageBlock(png, 'image/jpeg')])).toHaveLength(2);
    expect(imageBlocks('plain string')).toEqual([]);
  });

  test('tool results and saved prompts carry their images; the flat output still names them', () => {
    const png = pngHeader(64, 32);
    const result = toolResultEntry({ tool_use_id: 't1', content: [{ type: 'text', text: 'shot' }, imageBlock(png)] }, {});
    expect(result.output).toBe('shot\n[image]');
    expect(result.images).toEqual([expect.objectContaining({ width: 64, height: 32 })]);
    expect(toolResultEntry({ tool_use_id: 't2', content: 'plain' }, {}).images).toBeUndefined();
    const { entries } = historyEntries([{ type: 'user', uuid: 'u1', message: { content: [{ type: 'text', text: 'see' }, imageBlock(png)] } }]);
    expect(entries[0]).toMatchObject({ kind: 'user', text: 'see', images: [expect.objectContaining({ width: 64 })] });
    const imageOnly = historyEntries([{ type: 'user', uuid: 'u2', message: { content: [imageBlock(png)] } }]).entries;
    expect(imageOnly[0]).toMatchObject({ kind: 'user', text: '' });
  });

  test('placeholders show type, size and bytes with open and copy actions', async () => {
    const view = await renderEntries([
      { id: 'u', kind: 'user', text: 'Look', images: [{ mediaType: 'image/png', bytes: 123456, width: 1200, height: 800, data: 'AA==' }, { mediaType: 'image/jpeg', bytes: 9000000 }] },
      tool('Read', { file_path: 'shot.png' }, { id: 'r', output: '[image]', images: [{ mediaType: 'image/gif', bytes: 512, width: 4, height: 4, data: 'AA==' }] }),
    ], { height: 20 });
    try {
      const frame = await frameContaining(view, 'image/gif');
      expect(frame).toContain('▣ Image 1 · image/png · 1200×800 · 120.6 KB [open] [copy]');
      expect(frame).toContain('▣ Image 2 · image/jpeg · 8.6 MB (content not kept)');
      expect(frame).toContain('image/gif · 4×4 · 512 B');
    } finally { view.renderer.destroy(); }
    expect(imageLabel({ mediaType: 'image/webp', bytes: 2048 })).toBe('image/webp · 2.0 KB');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('open and copy report their outcome in the row, including failures', async () => {
    const calls: string[] = [];
    const actions: ImageActions = {
      open: async () => { calls.push('open'); return '/tmp/image.png'; },
      copy: async image => { calls.push('copy'); if (image.mediaType === 'image/webp') return { copied: 'path', path: '/tmp/image.webp' }; throw new Error('no clipboard'); },
    };
    const view = await testRender(() => (
      <box width="100%" flexDirection="column">
        <ImageList actions={actions} images={[{ mediaType: 'image/png', bytes: 10, data: 'AA==' }, { mediaType: 'image/webp', bytes: 10, data: 'AA==' }]} />
      </box>
    ), { width: 100, height: 6 });
    try {
      await view.renderOnce();
      await clickText(view, '[open]');
      expect(await frameContaining(view, 'opened /tmp/image.png')).toContain('opened /tmp/image.png');
      await clickText(view, '[copy]');
      expect(await frameContaining(view, 'failed: no clipboard')).toContain('failed: no clipboard');
      const rows = view.captureCharFrame().split('\n');
      const webpRow = rows.findIndex(row => row.includes('Image 2'));
      await view.mockMouse.click(rows[webpRow].lastIndexOf('[copy]') + 1, webpRow);
      expect(await frameContaining(view, 'file path copied')).toContain('format not supported by the clipboard; file path copied');
      expect(calls).toEqual(['open', 'copy', 'copy']);
    } finally { view.renderer.destroy(); }
  });

  test('platform commands avoid shells and pass paths through the environment, argument or stdin', () => {
    expect(openImageCommand('win32')).toMatchObject({ command: 'powershell.exe', path: 'env' });
    expect(openImageCommand('win32').args.join(' ')).toContain('Start-Process -LiteralPath $env:CLAUDAPTER_CLIPBOARD_IMAGE');
    expect(openImageCommand('darwin')).toEqual({ command: 'open', path: 'argument', args: [] });
    expect(openImageCommand('linux')).toEqual({ command: 'xdg-open', path: 'argument', args: [] });
    expect(copyImageCommand('win32', 'image/jpeg')).toMatchObject({ command: 'powershell.exe', path: 'env' });
    expect(copyImageCommand('darwin', 'image/png')).toMatchObject({ command: 'osascript' });
    expect(copyImageCommand('darwin', 'image/jpeg')).toBeUndefined();
    expect(copyImageCommand('linux', 'image/png', {})).toEqual({ command: 'xclip', path: 'stdin', args: ['-selection', 'clipboard', '-t', 'image/png', '-i'] });
    expect(copyImageCommand('linux', 'image/gif', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual({ command: 'wl-copy', path: 'stdin', args: ['--type', 'image/gif'] });
    expect(imageExtension('image/jpeg')).toBe('jpg');
    expect(imageExtension('image/x-unknown')).toBe('img');
  });
});

describe('Markdown fidelity', () => {
  const sample = [
    '# Heading', '', 'Text with **bold**, `code` and a [link](https://example.com/docs).', '',
    '- one', '  - nested', '    - deeper', '- two', '', '> quoted line', '', '| Name | 说明 |', '| --- | --- |', '| alpha | 日本語のテキスト |', '',
    '```ts', 'const x: number = 1;', '```', '', 'After code.',
  ].join('\n');

  test('splits top-level fences from the Markdown around them', () => {
    expect(splitFences('before\n\n```python title\nprint(1)\n```\n\nafter\n- item')).toEqual([
      { kind: 'markdown', text: 'before' },
      { kind: 'code', text: 'print(1)', language: 'python' },
      { kind: 'markdown', text: 'after\n- item' },
    ]);
    expect(splitFences('plain text')).toEqual([{ kind: 'markdown', text: 'plain text' }]);
    expect(splitFences('')).toEqual([]);
    expect(splitFences('    indented code')).toEqual([{ kind: 'markdown', text: '    indented code' }]);
  });

  test('an unterminated fence while streaming is still a code block', () => {
    expect(splitFences('intro\n\n```js\nlet a =')).toEqual([
      { kind: 'markdown', text: 'intro' },
      { kind: 'code', text: 'let a =', language: 'js' },
    ]);
  });

  test('renders headings, nested lists, quotes, tables with wide characters and labelled code', async () => {
    const view = await renderEntries([{ id: 'a', kind: 'assistant', text: sample }], { width: 60, height: 40 });
    try {
      const frame = await frameContaining(view, 'After code.');
      expect(frame).toContain('Heading');
      expect(frame).toContain('Text with bold, code and a link.');
      const indentOf = (word: string) => locate(frame, word).x;
      expect(indentOf('nested')).toBeGreaterThan(indentOf('one'));
      expect(indentOf('deeper')).toBeGreaterThan(indentOf('nested'));
      expect(frame).toContain('│ quoted line');
      expect(frame).toContain('日本語のテキスト');
      expect(frame).toMatch(/┌─+┬─+┐/);
      const label = frame.split('\n').find(row => row.includes('ts') && row.includes('copy'))!;
      expect(label).toBeDefined();
      expect(frame).toContain('const x: number = 1;');
    } finally { view.renderer.destroy(); }
  });

  test('long wide-character text wraps without losing or clipping characters', async () => {
    const text = '日本語のテキスト'.repeat(8) + ' end';
    const view = await renderEntries([{ id: 'a', kind: 'assistant', text }], { width: 30, height: 20 });
    try {
      const frame = await frameContaining(view, 'end');
      expect(frame.replace(/\s+/g, '')).toContain(text.replace(/\s+/g, ''));
    } finally { view.renderer.destroy(); }
  });

  test('stays within 44 columns, wrapping code lines instead of overflowing', async () => {
    const view = await renderEntries([{ id: 'a', kind: 'assistant', text: '```sh\n' + 'echo ' + 'word '.repeat(20) + '\n```' }], { width: 44, height: 20 });
    try {
      const frame = await frameContaining(view, 'echo');
      for (const row of frame.split('\n')) expect(row.length).toBeLessThanOrEqual(44);
      expect(frame.replace(/\s+/g, '')).toContain(('echo ' + 'word '.repeat(20)).replace(/\s+/g, ''));
    } finally { view.renderer.destroy(); }
  });

  test('the copy action copies the exact code and reports success or failure', async () => {
    const copied: string[] = [];
    let failing = false;
    const copy = async (text: string) => { if (failing) throw new Error('nope'); copied.push(text); };
    const view = await testRender(() => (
      <box width="100%" flexDirection="column"><CodeBlock code={'line 1\nline 2'} language="ts" streaming={false} copy={copy} /></box>
    ), { width: 60, height: 10 });
    try {
      await view.renderOnce();
      await clickText(view, 'copy');
      expect(await frameContaining(view, 'copied')).toContain('copied');
      expect(copied).toEqual(['line 1\nline 2']);
      failing = true;
      await new Promise(resolve => setTimeout(resolve, 1600));
      await view.renderOnce();
      await clickText(view, 'copy');
      expect(await frameContaining(view, 'copy failed')).toContain('copy failed');
    } finally { view.renderer.destroy(); }
  });

  test('streaming code blocks offer no copy action until they are complete', async () => {
    const view = await testRender(() => (
      <box width="100%" flexDirection="column"><CodeBlock code="let a =" language="js" streaming /></box>
    ), { width: 40, height: 6 });
    try {
      const frame = await frameContaining(view, 'let a =');
      expect(frame).toContain('js');
      expect(frame).not.toContain('copy');
    } finally { view.renderer.destroy(); }
  });
});

describe('transcript extension points', () => {
  test('entryFooter renders under an entry, taskCall replaces the launch card, hide removes entries', async () => {
    const launch = tool('Agent', { subagent_type: 'Explore', description: 'Find auth' }, { id: 'agent', taskId: 't1' });
    const view = await renderWith([
      { id: 'a', kind: 'assistant', text: 'Main answer' },
      launch,
      { id: 'sub', kind: 'assistant', text: 'Sub stream content', agent: 'tool-use-1' },
    ], {
      entryFooter: entry => entry.kind === 'assistant' && !entry.agent ? <text>ROUTE-BADGE</text> : undefined,
      taskCall: entry => <text>{'COMPACT ' + entry.id}</text>,
      hide: entry => !!entry.agent,
    });
    try {
      await frameContaining(view, 'Main answer');
      const frame = await frameContaining(view, 'COMPACT agent');
      const rows = frame.split('\n');
      expect(rows.findIndex(row => row.includes('ROUTE-BADGE'))).toBe(rows.findIndex(row => row.includes('Main answer')) + 1);
      expect(frame).toContain('COMPACT agent');
      expect(frame).not.toContain('◉ Explore');
      expect(frame).not.toContain('Sub stream content');
    } finally { view.renderer.destroy(); }
  });

  test('without slots the default rendering is unchanged', async () => {
    const view = await renderWith([{ id: 'a', kind: 'assistant', text: 'Plain answer' }], undefined);
    try {
      const frame = await frameContaining(view, 'Plain answer');
      expect(frame).not.toContain('ROUTE-BADGE');
    } finally { view.renderer.destroy(); }
  });
});

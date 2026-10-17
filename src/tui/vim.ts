// Vim key interpreter for the composer: a pure state machine from (state, document, key) to the next state and document.
import {
  characterSpan, changeSpan, charSpan, joinLines, lineSpan, openLine, putRegister, removeSpan, replaceCharacters, toggleCase, yankSpan,
  type Register, type Span, type VimDoc,
} from './vim-edits.js';
import {
  backward, clampNormal, findCharacter, firstNonBlank, forward, lastCharacter, lineEnd, lineIndexOf, lineStart, lineStartOf, lineTotal,
  nextWordStart, previousWordStart, repeatTimes, runEnd, wordEnd, wordObject, type FindKind, type Motion,
} from './vim-motions.js';

export type VimMode = 'insert' | 'normal' | 'visual' | 'visual-line';
export type { VimDoc } from './vim-edits.js';
type Operator = 'd' | 'c' | 'y';

interface RecordedChange {
  keys: string[];
  /** Text typed in the insert session that ended the change. */
  inserted: string;
}

export interface VimState {
  mode: VimMode;
  /** Digits typed before a command. */
  count: string;
  operator?: Operator;
  operatorCount: number;
  /** Key waiting for its argument: `g`, `f`, `F`, `t`, `T`, `r`, or a text-object prefix `i` / `a`. */
  pending: string;
  anchor: number;
  /** Column `j` and `k` aim for while a run of vertical moves crosses shorter lines. */
  desiredColumn?: number;
  register?: Register;
  lastFind?: { kind: FindKind; character: string };
  recording: string[];
  lastChange?: RecordedChange;
  /** An insert session that belongs to a repeatable change is open. */
  changing: boolean;
  inserted: string;
}

export interface VimResult {
  state: VimState;
  doc: VimDoc;
  /** Enter in normal mode sends the prompt. */
  submit: boolean;
  /** Ask the editor to undo or redo; the interpreter does not own the history. */
  history?: 'undo' | 'redo';
  /** False when the key should keep its ordinary editing meaning (insert mode typing, arrow keys). */
  handled: boolean;
}

const ESCAPE_KEYS = ['Escape', 'ctrl+['];
const INSERT_STARTERS = new Set(['i', 'a', 'I', 'A', 'o', 'O']);
const SIMPLE_MOTIONS = new Set(['h', 'l', 'j', 'k', '0', '^', '$', 'w', 'W', 'b', 'B', 'e', 'E', 'G', ';', ',', 'Backspace', ' ']);
const FIND_KEYS = new Set(['f', 'F', 't', 'T']);
const OPERATORS = new Set(['d', 'c', 'y']);
const isDigit = (key: string) => /^[0-9]$/.test(key);
const isPrintable = (key: string) => Array.from(key).length === 1;

export function initialVimState(mode: VimMode = 'insert'): VimState {
  return { mode, count: '', operatorCount: 1, pending: '', anchor: 0, recording: [], changing: false, inserted: '' };
}

/** Interprets one key. Named keys are `Escape`, `Backspace`, `Return` and `ctrl+<letter>`; everything else is the typed character. */
export function vimKey(state: VimState, doc: VimDoc, key: string): VimResult {
  const engine = new Engine({ ...state, recording: [...state.recording] }, doc);
  return engine.press(key);
}

/** Records text typed in insert mode so `.` can repeat it; typing itself is left to the editor. */
export function noteInsert(state: VimState, typed: string): VimState {
  if (state.mode !== 'insert' || !state.changing) return state;
  return { ...state, inserted: typed === 'Backspace' ? state.inserted.slice(0, -1) : state.inserted + typed };
}

/** Selected span of a visual mode (end exclusive), for highlighting. */
export function visualSelection(state: VimState, doc: VimDoc): Span | undefined {
  if (state.mode === 'visual') return inclusiveSpan(doc.text, state.anchor, doc.cursor);
  if (state.mode === 'visual-line') return lineSpan(doc.text, state.anchor, doc.cursor);
  return undefined;
}

function inclusiveSpan(text: string, anchor: number, cursor: number): Span {
  const start = Math.min(anchor, cursor);
  return charSpan(start, forward(text, Math.max(anchor, cursor)));
}

class Engine {
  private submit = false;
  private history?: 'undo' | 'redo';
  private handled = true;
  private replaying = false;

  constructor(private readonly s: VimState, private d: VimDoc) {}

  press(key: string): VimResult {
    if (this.s.mode === 'insert') this.insertKey(key);
    else this.commandKey(key);
    return { state: this.s, doc: this.d, submit: this.submit, history: this.history, handled: this.handled };
  }

  // Insert mode ------------------------------------------------------------

  private insertKey(key: string) {
    if (!ESCAPE_KEYS.includes(key)) { this.handled = false; return; }
    this.leaveInsert();
  }

  private leaveInsert() {
    const s = this.s;
    if (s.changing && !this.replaying) s.lastChange = { keys: [...s.recording], inserted: s.inserted };
    s.recording = [];
    s.changing = false;
    s.inserted = '';
    s.mode = 'normal';
    const { text, cursor } = this.d;
    this.d = { text, cursor: cursor > lineStart(text, cursor) ? backward(text, cursor) : cursor };
  }

  private enterInsert(repeatable: boolean) {
    this.resetCommand();
    this.s.mode = 'insert';
    this.s.inserted = '';
    this.s.changing = repeatable && !this.replaying;
    if (!this.s.changing) this.s.recording = [];
  }

  // Normal and visual mode ---------------------------------------------------

  private commandKey(key: string) {
    if (ESCAPE_KEYS.includes(key)) { this.cancel(); return; }
    if (!isPrintable(key) && !['Return', 'Backspace', 'ctrl+r'].includes(key)) { this.handled = false; return; }
    if (!this.replaying) this.s.recording.push(key);
    if (this.s.pending) this.completePending(key);
    else if (isDigit(key) && (key !== '0' || this.s.count)) this.s.count += key;
    else {
      if (key !== 'j' && key !== 'k') this.s.desiredColumn = undefined;
      if (this.s.operator) this.operatorTarget(key); else this.command(key);
    }
  }

  private cancel() {
    if (this.s.mode === 'visual' || this.s.mode === 'visual-line') this.s.mode = 'normal';
    this.resetCommand();
    this.s.recording = [];
    this.d = { text: this.d.text, cursor: clampNormal(this.d.text, this.d.cursor) };
  }

  private resetCommand() {
    this.s.count = '';
    this.s.operator = undefined;
    this.s.operatorCount = 1;
    this.s.pending = '';
  }

  private repeat(): number {
    return (parseInt(this.s.count, 10) || 1) * this.s.operatorCount;
  }

  private get visual(): boolean {
    return this.s.mode === 'visual' || this.s.mode === 'visual-line';
  }

  private command(key: string) {
    if (key === 'Return') { this.submit = true; this.cancel(); return; }
    if (SIMPLE_MOTIONS.has(key)) this.moveTo(key);
    else if (key === 'g' || FIND_KEYS.has(key) || key === 'r' && !this.visual) this.s.pending = key;
    else if (OPERATORS.has(key)) this.visual ? this.operateOn(key as Operator, this.selectionSpan()) : this.startOperator(key as Operator);
    else if ((key === 'i' || key === 'a') && this.visual) this.s.pending = key;
    else if (this.visual) this.visualCommand(key);
    else this.normalCommand(key);
  }

  private moveTo(key: string) {
    const { text, cursor } = this.d;
    if (key === 'j' || key === 'k') this.s.desiredColumn ??= cursor - lineStart(text, cursor);
    this.move(this.motion(key));
  }

  private startOperator(operator: Operator) {
    this.s.operator = operator;
    this.s.operatorCount = this.repeat();
    this.s.count = '';
  }

  private visualCommand(key: string) {
    const actions: Record<string, () => void> = {
      x: () => this.operateOn('d', this.selectionSpan()),
      s: () => this.operateOn('c', this.selectionSpan()),
      v: () => this.toggleVisual('visual'),
      V: () => this.toggleVisual('visual-line'),
      o: () => this.swapVisualEnds(),
    };
    const action = actions[key];
    if (action) action(); else this.resetCommand();
  }

  private toggleVisual(mode: 'visual' | 'visual-line') {
    this.s.mode = this.s.mode === mode ? 'normal' : mode;
    this.resetCommand();
    this.s.recording = [];
  }

  private swapVisualEnds() {
    const previous = this.d.cursor;
    this.d = { text: this.d.text, cursor: this.s.anchor };
    this.s.anchor = previous;
    this.resetCommand();
    this.s.recording = [];
  }

  private normalCommand(key: string) {
    const actions: Record<string, () => void> = {
      v: () => this.startVisual('visual'), V: () => this.startVisual('visual-line'),
      x: () => this.deleteCharacters(false), X: () => this.deleteCharacters(true),
      s: () => this.substitute(), S: () => this.changeLines(),
      D: () => this.operateOn('d', charSpan(this.d.cursor, lineEnd(this.d.text, this.d.cursor))),
      C: () => this.operateOn('c', charSpan(this.d.cursor, lineEnd(this.d.text, this.d.cursor))),
      Y: () => this.operateOn('y', this.linesFromCursor()),
      p: () => this.put(false), P: () => this.put(true),
      J: () => this.edit(joinLines(this.d, this.repeat())),
      '~': () => this.edit(toggleCase(this.d, this.repeat())),
      u: () => this.requestHistory('undo'),
      '.': () => this.repeatLastChange(),
    };
    if (key === 'ctrl+r') { this.requestHistory('redo'); return; }
    if (INSERT_STARTERS.has(key)) { this.startInsertAt(key); return; }
    const action = actions[key];
    if (action) action(); else this.resetCommand();
  }

  private startVisual(mode: 'visual' | 'visual-line') {
    this.s.mode = mode;
    this.s.anchor = this.d.cursor;
    this.resetCommand();
    this.s.recording = [];
  }

  private requestHistory(direction: 'undo' | 'redo') {
    this.history = direction;
    this.resetCommand();
    this.s.recording = [];
  }

  // Arguments of two-key commands ----------------------------------------------

  private completePending(key: string) {
    const kind = this.s.pending;
    this.s.pending = '';
    if (kind === 'g') { if (key === 'g') this.applyMotion(this.motion('gg')); else this.cancel(); }
    else if (FIND_KEYS.has(kind)) this.find(kind as FindKind, key);
    else if (kind === 'r') this.replace(key);
    else this.textObject(kind === 'a', key);
  }

  private find(kind: FindKind, character: string) {
    this.s.lastFind = { kind, character };
    this.applyMotion(this.motion('find'));
  }

  private replace(character: string) {
    const replaced = replaceCharacters(this.d, character, this.repeat());
    if (replaced) this.edit(replaced); else this.cancel();
  }

  private textObject(around: boolean, key: string) {
    const range = key === 'w' ? wordObject(this.d.text, this.d.cursor, around) : undefined;
    if (!range) { this.cancel(); return; }
    if (this.visual) { this.s.anchor = range.start; this.d = { text: this.d.text, cursor: backward(this.d.text, range.end) }; this.resetCommand(); this.s.recording = []; }
    else this.operateOn(this.s.operator!, charSpan(range.start, range.end));
  }

  // Motions ----------------------------------------------------------------------

  private operatorTarget(key: string) {
    if (key === this.s.operator) { this.operateOn(this.s.operator, this.linesFromCursor()); return; }
    if (key === 'g' || FIND_KEYS.has(key)) { this.s.pending = key; return; }
    if (key === 'i' || key === 'a') { this.s.pending = key; return; }
    if (SIMPLE_MOTIONS.has(key)) this.applyMotion(this.motion(key)); else this.cancel();
  }

  private applyMotion(motion: Motion | undefined) {
    if (!motion) { this.cancel(); return; }
    if (this.s.operator) this.operateOn(this.s.operator, this.spanOf(motion));
    else this.move(motion);
  }

  private move(motion: Motion | undefined) {
    if (!motion) { this.cancel(); return; }
    const { text } = this.d;
    this.d = { text, cursor: clampNormal(text, motion.target) };
    this.resetCommand();
    this.s.recording = [];
  }

  private spanOf(motion: Motion): Span {
    const { text, cursor } = this.d;
    if (motion.linewise) return lineSpan(text, cursor, motion.target);
    const start = Math.min(cursor, motion.target);
    const end = Math.max(cursor, motion.target);
    return charSpan(start, motion.inclusive ? forward(text, end) : end);
  }

  private motion(key: string): Motion | undefined {
    const { text, cursor } = this.d;
    const count = this.repeat();
    const exclusive = (target: number): Motion => ({ target, inclusive: false, linewise: false });
    const linewise = (line: number): Motion => ({ target: this.onLine(line), inclusive: false, linewise: true });
    switch (key) {
      case 'h': case 'Backspace': return exclusive(repeatTimes(count, index => index > lineStart(text, index) ? backward(text, index) : index, cursor));
      case 'l': case ' ': return exclusive(repeatTimes(count, index => index < lineEnd(text, index) ? forward(text, index) : index, cursor));
      case 'j': return linewise(Math.min(lineTotal(text) - 1, lineIndexOf(text, cursor) + count));
      case 'k': return linewise(Math.max(0, lineIndexOf(text, cursor) - count));
      case 'G': return linewise(this.s.count ? Math.min(lineTotal(text), parseInt(this.s.count, 10)) - 1 : lineTotal(text) - 1);
      case 'gg': return linewise(this.s.count ? Math.min(lineTotal(text), parseInt(this.s.count, 10)) - 1 : 0);
      case '0': return exclusive(lineStart(text, cursor));
      case '^': return exclusive(firstNonBlank(text, cursor));
      case '$': return { target: lastCharacter(text, cursor), inclusive: true, linewise: false };
      case 'w': case 'W': return this.wordForward(key === 'W', count);
      case 'b': case 'B': return exclusive(repeatTimes(count, index => previousWordStart(text, index, key === 'B'), cursor));
      case 'e': case 'E': return { target: repeatTimes(count, index => wordEnd(text, index, key === 'E'), cursor), inclusive: true, linewise: false };
      case 'find': return this.findMotion(this.s.lastFind, count);
      case ';': return this.findMotion(this.s.lastFind, count, true);
      case ',': return this.findMotion(this.s.lastFind && { ...this.s.lastFind, kind: reverse(this.s.lastFind.kind) }, count, true);
      default: return undefined;
    }
  }

  /** Cursor position on `line`, keeping the current column where the line is long enough. */
  private onLine(line: number): number {
    const { text, cursor } = this.d;
    const start = lineStartOf(text, line);
    return Math.min(start + (this.s.desiredColumn ?? cursor - lineStart(text, cursor)), lineEnd(text, start));
  }

  private wordForward(bigWord: boolean, count: number): Motion {
    const { text, cursor } = this.d;
    if (this.s.operator === 'c' && /\S/.test(text[cursor] ?? ' ')) return this.changeWordEnd(bigWord, count);
    const before = repeatTimes(count - 1, index => nextWordStart(text, index, bigWord), cursor);
    const reached = nextWordStart(text, before, bigWord);
    const target = this.s.operator && reached > lineEnd(text, before) ? lineEnd(text, before) : reached;
    return { target, inclusive: false, linewise: false };
  }

  /** `cw` changes up to the end of the word instead of the start of the next one. */
  private changeWordEnd(bigWord: boolean, count: number): Motion {
    const { text, cursor } = this.d;
    return { target: repeatTimes(count - 1, index => wordEnd(text, index, bigWord), runEnd(text, cursor, bigWord)), inclusive: true, linewise: false };
  }

  private findMotion(find: VimState['lastFind'], count: number, repeating = false): Motion | undefined {
    if (!find) return undefined;
    const { text, cursor } = this.d;
    const adjacent = find.kind === 't' ? forward(text, cursor) : find.kind === 'T' ? backward(text, cursor) : -1;
    const from = repeating && adjacent >= 0 && text.slice(adjacent, forward(text, adjacent)) === find.character ? adjacent : cursor;
    const target = findCharacter(text, from, find.kind, find.character, count);
    return target === undefined ? undefined : { target, inclusive: find.kind === 'f' || find.kind === 't', linewise: false };
  }

  // Edits ----------------------------------------------------------------------------

  private linesFromCursor(): Span {
    const { text, cursor } = this.d;
    const last = Math.min(lineTotal(text) - 1, lineIndexOf(text, cursor) + this.repeat() - 1);
    return lineSpan(text, cursor, lineStartOf(text, last));
  }

  private selectionSpan(): Span {
    const { text, cursor } = this.d;
    return this.s.mode === 'visual-line' ? lineSpan(text, this.s.anchor, cursor) : charSpan(Math.min(this.s.anchor, cursor), forward(text, Math.max(this.s.anchor, cursor)));
  }

  private operateOn(operator: Operator, span: Span) {
    const repeatable = !this.visual;
    const result = operator === 'y' ? yankSpan(this.d, span) : operator === 'd' ? removeSpan(this.d, span) : changeSpan(this.d, span);
    this.d = result.doc;
    this.s.register = result.register ?? this.s.register;
    if (this.visual) this.s.mode = 'normal';
    if (operator === 'c') this.enterInsert(repeatable); else this.completeChange(operator !== 'y' && repeatable);
  }

  private deleteCharacters(before: boolean) {
    const span = characterSpan(this.d.text, this.d.cursor, this.repeat(), before);
    if (span) this.operateOn('d', span); else this.cancel();
  }

  private substitute() {
    const span = characterSpan(this.d.text, this.d.cursor, this.repeat(), false) ?? charSpan(this.d.cursor, this.d.cursor);
    this.operateOn('c', span);
  }

  private changeLines() {
    const span = this.linesFromCursor();
    this.operateOn('c', span);
  }

  private put(before: boolean) {
    this.edit(putRegister(this.d, this.s.register, before, this.repeat()));
  }

  private startInsertAt(key: string) {
    const { text, cursor } = this.d;
    if (key === 'o' || key === 'O') this.d = openLine(this.d, key === 'O');
    else if (key === 'a') this.d = { text, cursor: Math.min(forward(text, cursor), lineEnd(text, cursor)) };
    else if (key === 'A') this.d = { text, cursor: lineEnd(text, cursor) };
    else if (key === 'I') this.d = { text, cursor: firstNonBlank(text, cursor) };
    this.enterInsert(true);
  }

  private edit(doc: VimDoc) {
    this.d = doc;
    this.completeChange(true);
  }

  private completeChange(repeatable: boolean) {
    if (repeatable && !this.replaying) this.s.lastChange = { keys: [...this.s.recording], inserted: '' };
    this.s.recording = [];
    this.resetCommand();
  }

  private repeatLastChange() {
    const change = this.s.lastChange;
    this.resetCommand();
    this.s.recording = [];
    if (!change || this.replaying) return;
    this.replaying = true;
    for (const key of change.keys) this.press(key);
    if (this.s.mode === 'insert') this.typeRecorded(change.inserted);
    this.replaying = false;
    this.s.recording = [];
  }

  private typeRecorded(text: string) {
    const { text: current, cursor } = this.d;
    this.d = { text: current.slice(0, cursor) + text + current.slice(cursor), cursor: cursor + text.length };
    this.leaveInsert();
  }
}

const reverse = (kind: FindKind): FindKind => ({ f: 'F', F: 'f', t: 'T', T: 't' } as const)[kind];

// What the composer's Vim mode supports. Every entry carries an example the test suite replays through the interpreter,
// so the reference shown to users cannot drift from the behavior.

export interface VimReferenceEntry {
  keys: string;
  description: string;
  example: {
    text: string;
    cursor: number;
    /** Space-separated keys, played in normal mode. */
    play: string;
    result: string;
    resultCursor?: number;
    /** The last key sends the prompt. */
    submits?: boolean;
  };
}

export interface VimReferenceGroup {
  title: string;
  entries: VimReferenceEntry[];
}

const entry = (keys: string, description: string, text: string, cursor: number, play: string, result: string, resultCursor?: number): VimReferenceEntry =>
  ({ keys, description, example: { text, cursor, play, result, resultCursor } });

export const VIM_REFERENCE: readonly VimReferenceGroup[] = [
  { title: 'Motions', entries: [
    entry('h l', 'Left and right within the line', 'abc', 0, 'l', 'abc', 1),
    entry('j k', 'Down and up, keeping the column', 'abcd\nef\nghij', 3, 'j j', 'abcd\nef\nghij', 11),
    entry('0 ^ $', 'Line start, first non-blank, line end', '  ab', 3, '0', '  ab', 0),
    entry('w W', 'Next word start (W: whitespace-delimited)', 'one two', 0, 'w', 'one two', 4),
    entry('b B', 'Previous word start', 'one two', 6, 'b', 'one two', 4),
    entry('e E', 'End of word', 'one two', 0, 'e', 'one two', 2),
    entry('gg G', 'First line, last line (2G: line 2)', 'a\nb\nc', 0, 'G', 'a\nb\nc', 4),
    entry('f F t T {char}', 'Find a character on the line; ; and , repeat', 'a,b,c', 0, 'f ,', 'a,b,c', 1),
  ] },
  { title: 'Operators', entries: [
    entry('d{motion}', 'Delete', 'one two', 0, 'd w', 'two', 0),
    entry('c{motion}', 'Change: delete and type', 'one two', 0, 'c w Z Escape', 'Z two', 0),
    entry('y{motion}', 'Yank without deleting', 'one two', 0, 'y w $ p', 'one twoone ', 10),
    entry('dd cc yy', 'Whole lines; 2dd takes a count', 'a\nb\nc', 0, 'd d', 'b\nc', 0),
    entry('D C Y', 'To end of line, or the line for Y', 'hello world', 6, 'D', 'hello ', 5),
    entry('iw aw', 'Word text objects: diw, caw, viw', 'foo bar baz', 5, 'd i w', 'foo  baz', 4),
  ] },
  { title: 'Editing', entries: [
    entry('x X', 'Delete the character under or before the cursor', 'abcd', 1, 'x', 'acd', 1),
    entry('s S', 'Substitute a character or a line', 'abc', 1, 's Z Escape', 'aZc', 1),
    entry('r{char}', 'Replace characters', 'abcd', 1, 'r z', 'azcd', 1),
    entry('p P', 'Paste after or before the cursor', 'ab', 0, 'x p', 'ba', 1),
    entry('J', 'Join lines', 'abc\n  def', 0, 'J', 'abc def', 3),
    entry('~', 'Toggle case', 'aB', 0, '~ ~', 'Ab', 1),
    entry('.', 'Repeat the last change, including typed text', 'a b c', 0, 'd w .', 'c', 0),
    entry('u ctrl+r', 'Undo and redo (the editor history)', 'abc', 0, 'u', 'abc', 0),
  ] },
  { title: 'Insert and visual', entries: [
    entry('i a I A', 'Insert at, after, line start, line end', 'ab', 0, 'A Z Escape', 'abZ', 2),
    entry('o O', 'Open a line below or above', 'a\nb', 0, 'o Z Escape', 'a\nZ\nb', 2),
    entry('v V', 'Visual selection by character or line', 'abcd', 0, 'v l d', 'cd', 0),
    entry('Escape', 'Leave insert or visual mode', 'ab', 2, 'Escape', 'ab', 1),
    { keys: 'Enter', description: 'Send the prompt (normal mode)', example: { text: 'ab', cursor: 0, play: 'Return', result: 'ab', submits: true } },
  ] },
];

import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter(undefined, {granularity:'grapheme'});

export function safeText(text: string): string {
  return stripVTControlCharacters(text
    .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, '')
    .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

export function wrapText(text: string, width: number): string[] {
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError('Text width must be a positive integer.');
  const lines: string[] = [];
  for (const paragraph of safeText(text).split('\n')) {
    let line = '', column = 0;
    const append = (segment: string) => {
      const cells = stringWidth(segment);
      if (column > 0 && column+cells > width) {lines.push(line);line='';column=0;}
      // shortcut: an indivisible wide grapheme can exceed width 1; clip in a renderer that requires single-cell rows.
      line += segment;
      column += cells;
    };
    for (const {segment} of graphemes.segment(paragraph)) {
      if (segment === '\t') for (let spaces=4-column%4; spaces>0; spaces--) append(' ');
      else append(segment);
    }
    lines.push(line);
  }
  return lines;
}

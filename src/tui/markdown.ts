import { marked, type Token, type Tokens } from 'marked';
import stringWidth from 'string-width';
import { safeText } from './editor.js';

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean };
export type MarkdownLine = { text: string; spans: Span[] };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function inline(tokens: Token[] = [], style: Omit<Span, 'text'> = {}): Span[] {
  return tokens.flatMap((token): Span[] => {
    switch (token.type) {
      case 'strong': return inline(token.tokens, { ...style, bold: true });
      case 'em': return inline(token.tokens, { ...style, italic: true });
      case 'del': return inline(token.tokens, { ...style, strike: true });
      case 'codespan': return [{ ...style, text: token.text, code: true }];
      case 'br': return [{ ...style, text: '\n' }];
      case 'link': return [...inline(token.tokens, style), { ...style, text: token.href === token.text ? '' : ` (${safeText(token.href)})` }];
      case 'image': return [{ ...style, text: `[Image: ${safeText(token.text)}]` }];
      case 'text': return token.tokens ? inline(token.tokens, style) : [{ ...style, text: token.text }];
      default: return [{ ...style, text: 'text' in token ? String(token.text) : token.raw }];
    }
  });
}

export function wrapSpans(spans: Span[], width: number): MarkdownLine[] {
  const columns = Math.max(1, width);
  const lines: MarkdownLine[] = [];
  let row: Span[] = [], cells = 0;
  const flush = () => { lines.push({ text: row.map(span => span.text).join(''), spans: row }); row = []; cells = 0; };
  for (const span of spans) {
    for (const { segment } of graphemes.segment(safeText(span.text))) {
      if (segment === '\n') { flush(); continue; }
      const text = segment === '\t' ? ' '.repeat(4 - cells % 4) : stringWidth(segment) > columns ? '?' : segment;
      for (const { segment: part } of graphemes.segment(text)) {
        const size = stringWidth(part);
        if (cells + size > columns) flush();
        const last = row.at(-1);
        if (last && last.bold === span.bold && last.italic === span.italic && last.code === span.code && last.strike === span.strike) last.text += part;
        else row.push({ ...span, text: part });
        cells += size;
      }
    }
  }
  flush();
  return lines;
}

function blocks(tokens: Token[], width: number): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  const add = (spans: Span[]) => lines.push(...wrapSpans(spans, width));
  const nested = (tokens: Token[], prefix: string) => {
    const lead = stringWidth(prefix) < width ? prefix : '';
    for (const line of blocks(tokens, Math.max(1, width - stringWidth(lead)))) add([{ text: lead }, ...line.spans]);
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': add(inline(token.tokens, { bold: true })); break;
      case 'paragraph': case 'text': add(token.tokens ? inline(token.tokens) : [{ text: token.text }]); break;
      case 'space': add([{ text: '' }]); break;
      case 'hr': add([{ text: '─'.repeat(Math.min(width, 40)) }]); break;
      case 'code':
        add([{ text: `┌ ${token.lang || 'code'}` }]);
        for (const line of token.text.split('\n')) add([{ text: width > 3 ? '│ ' : '', code: true }, { text: line, code: true }]);
        add([{ text: '└' }]); break;
      case 'blockquote': nested(token.tokens ?? [], '│ '); break;
      case 'list':
        token.items.forEach((item: Tokens.ListItem, index: number) => {
          const bullet = token.ordered ? `${Number(token.start) + index}. ` : '• ';
          nested(item.tokens, bullet + (item.task ? item.checked ? '[x] ' : '[ ] ' : ''));
        }); break;
      case 'table': {
        const headers = token.header.map((cell: { tokens: Token[] }) => inline(cell.tokens).map(span => span.text).join(''));
        const rows: Span[][][] = token.rows.map((row: { tokens: Token[] }[]) => row.map(cell => inline(cell.tokens)));
        const widths = headers.map((header: string, i: number) => Math.max(stringWidth(header), ...rows.map(row => stringWidth(row[i].map(span => span.text).join('')))));
        const total = widths.reduce((sum: number, value: number) => sum + value, 0) + 3 * (headers.length - 1);
        const tableRow = (cells: Span[][]) => cells.flatMap((cell, i) => [
          ...(i ? [{ text: ' │ ' }] : []), ...cell,
          { text: ' '.repeat(Math.max(0, widths[i] - stringWidth(cell.map(span => span.text).join('')))) }
        ]);
        if (total <= width) {
          add(tableRow(headers.map((text: string) => [{ text, bold: true }])));
          add([{ text: widths.map((size: number) => '─'.repeat(size)).join('─┼─') }]);
          rows.forEach(row => add(tableRow(row)));
        } else {
          for (const row of rows) {
            row.forEach((cell, i) => add([{ text: `${headers[i]}: `, bold: true }, ...cell]));
            add([{ text: '' }]);
          }
        }
        break;
      }
      case 'def': break;
      default: add([{ text: token.raw }]);
    }
  }
  return lines;
}

export function markdownLines(text: string, width: number): MarkdownLine[] {
  return blocks(marked.lexer(safeText(text), { gfm: true }), Math.max(1, width));
}

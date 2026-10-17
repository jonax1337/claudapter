import { marked } from 'marked';

export type MarkdownBlock = { kind: 'markdown'; text: string } | { kind: 'code'; text: string; language: string };

/**
 * Splits assistant text at top-level fenced code blocks. Code fences become their own block (rendered with a
 * language label and a copy action); everything between them stays Markdown, so lists, tables and quotes keep
 * their native rendering. An unterminated fence, as seen while streaming, is a code block up to the end.
 */
export function splitFences(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let pending = '';
  const flush = () => {
    if (pending.trim()) blocks.push({ kind: 'markdown', text: pending.replace(/^\n+|\s+$/g, '') });
    pending = '';
  };
  for (const token of marked.lexer(source, { gfm: true })) {
    if (token.type === 'code' && token.codeBlockStyle !== 'indented') {
      flush();
      blocks.push({ kind: 'code', text: token.text, language: (token.lang ?? '').trim().split(/\s+/)[0] });
    } else pending += token.raw;
  }
  flush();
  return blocks;
}

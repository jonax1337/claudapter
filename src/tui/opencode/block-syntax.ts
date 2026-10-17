import { SyntaxStyle } from '@opentui/core';
import { useRenderer } from '@opentui/solid';
import { createMemo, type Accessor } from 'solid-js';
import { useTheme, type Theme } from './theme';

export type StyleRecord = Record<string, { fg?: string; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean }>;

/** Filetypes with a bundled tree-sitter parser in `@opentui/core`; other languages render unhighlighted. */
const FILETYPE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  md: 'markdown', markdown: 'markdown', zig: 'zig',
};

const FILETYPE_BY_FENCE: Record<string, string> = {
  ts: 'typescript', typescript: 'typescript', tsx: 'typescriptreact', js: 'javascript', javascript: 'javascript',
  jsx: 'javascript', md: 'markdown', markdown: 'markdown', zig: 'zig',
};

export function filetypeForPath(path: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? FILETYPE_BY_EXTENSION[extension] : undefined;
}

export function filetypeForFence(language: string | undefined): string | undefined {
  return language ? FILETYPE_BY_FENCE[language.trim().toLowerCase()] : undefined;
}

/** Code token colors derived from the base palette, so every theme highlights consistently. */
export function codeStyles(theme: Theme): StyleRecord {
  return {
    keyword: { fg: theme.accent, bold: true },
    string: { fg: theme.success },
    comment: { fg: theme.muted, italic: true },
    number: { fg: theme.warning },
    constant: { fg: theme.warning },
    boolean: { fg: theme.warning },
    function: { fg: theme.secondary },
    'function.method': { fg: theme.secondary },
    type: { fg: theme.secondary },
    constructor: { fg: theme.secondary },
    property: { fg: theme.text },
    variable: { fg: theme.text },
    operator: { fg: theme.muted },
    punctuation: { fg: theme.muted },
  };
}

/** Markdown styles on top of the code token colors; `base` is the default foreground. */
export function markdownStyles(theme: Theme, base: string): StyleRecord {
  return {
    default: { fg: base },
    ...codeStyles(theme),
    'markup.heading': { fg: theme.accent, bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.strikethrough': { dim: true },
    'markup.raw': { fg: theme.secondary },
    'markup.raw.block': { fg: theme.secondary },
    'markup.link': { fg: theme.secondary },
    'markup.link.label': { fg: theme.secondary, underline: true },
    'markup.link.url': { fg: theme.muted, underline: true },
    'markup.quote': { fg: theme.muted, italic: true },
    'markup.list': { fg: theme.accent },
  };
}

const stylesByScene = new WeakMap<object, Map<string, SyntaxStyle>>();

/**
 * Syntax style for the active theme, shared by every block of one renderer. `base` picks the default text
 * color; entries live as long as the renderer's native scene, so repeated blocks never allocate native styles.
 */
export function useSyntaxStyle(base: 'text' | 'muted' = 'text'): Accessor<SyntaxStyle> {
  const renderer = useRenderer();
  const theme = useTheme();
  return createMemo(() => {
    const scene = renderer.nativeScene as object;
    const perScene = stylesByScene.get(scene) ?? new Map<string, SyntaxStyle>();
    stylesByScene.set(scene, perScene);
    const key = JSON.stringify([theme(), base]);
    const known = perScene.get(key);
    if (known) return known;
    const created = SyntaxStyle.fromStyles(markdownStyles(theme(), theme()[base]), renderer.nativeScene);
    perScene.set(key, created);
    return created;
  });
}

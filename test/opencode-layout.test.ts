import { test, expect, describe } from 'bun:test';
import { padToWidth, textWidth, truncate } from '../src/tui/opencode/layout';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** True when `text` contains a surrogate code unit that is not part of a complete pair. */
function hasLoneSurrogate(text: string): boolean {
  return [...graphemes.segment(text)].some(({ segment }) =>
    segment.length === 1 && segment.charCodeAt(0) >= 0xD800 && segment.charCodeAt(0) <= 0xDFFF);
}

const MIXED_TEXTS = [
  'plain ascii title',
  '日本語のセッションタイトル',
  'Emoji 😀 mixed with 文字',
  'family 👨‍👩‍👧‍👦 and skin tone 👍🏽',
  'combining é accent and ñ',
];

describe('textWidth counts terminal cells', () => {
  test('wide CJK characters and emoji take two cells, combining marks none', () => {
    expect(textWidth('ab')).toBe(2);
    expect(textWidth('日本')).toBe(4);
    expect(textWidth('😀')).toBe(2);
    expect(textWidth('é')).toBe(1);
  });
});

describe('truncate stays inside the cell budget', () => {
  test('short text is returned unchanged', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  test('a zero or negative budget yields the empty string', () => {
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -1)).toBe('');
  });

  test.each(MIXED_TEXTS)('never exceeds the budget and never splits a grapheme (%s)', text => {
    for (const width of [60, 10, 4, 1]) {
      const truncated = truncate(text, width);
      expect(textWidth(truncated)).toBeLessThanOrEqual(width);
      expect(hasLoneSurrogate(truncated)).toBe(false);
    }
  });

  test('truncation marks the cut with an ellipsis and keeps whole characters', () => {
    expect(truncate('日本語タイトル', 7)).toBe('日本語…');
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
  });
});

describe('padToWidth aligns the next column', () => {
  test('narrow text is padded with spaces up to the cell count', () => {
    expect(padToWidth('ab', 5)).toBe('ab   ');
  });

  test('wide characters are padded by cells, not by characters', () => {
    expect(padToWidth('日本', 5)).toBe('日本 ');
    expect(textWidth(padToWidth('日本', 5))).toBe(5);
  });

  test('text wider than the target is returned unchanged rather than cut', () => {
    expect(padToWidth('abcdef', 3)).toBe('abcdef');
  });
});

describe('a composed session row keeps its columns', () => {
  test('CJK title and branch truncate and pad into their budgets without overflow', () => {
    const titleBudget = 30;
    const branchBudget = 8;
    const row = padToWidth(truncate('日本語のセッションタイトルがとても長い場合の表示', titleBudget), titleBudget)
      + padToWidth(truncate('feature/幅広いブランチ名', branchBudget), branchBudget);
    expect(textWidth(row)).toBe(titleBudget + branchBudget);
    expect(hasLoneSurrogate(row)).toBe(false);
  });
});

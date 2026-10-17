import { test, expect, describe } from 'bun:test';
import { colorDepth, contrastRatio, degrade, mix } from '../src/tui/opencode/color';
import {
  THEME_NAMES, allThemes, degradeTheme, paletteNamed, providerColor, providerLabel, themeNamed, type Theme,
} from '../src/tui/opencode/theme';
import { THEME_NAMES as PERSISTED_NAMES } from '../src/tui/theme-names';

const AA_TEXT = 4.5;
const AAA_TEXT = 7;
const UI_COMPONENT = 3;
const SURFACES = ['background', 'panel', 'element'] as const;
const SIGNAL_TOKENS = ['accent', 'secondary', 'success', 'warning', 'error', 'providerClaude', 'providerChatgpt', 'providerZai'] as const;
const MIN_PROVIDER_DISTANCE = 60;

type Pair = { foreground: keyof Theme; background: keyof Theme; minimum: number };

/** Every foreground/surface combination the UI draws, with the WCAG ratio it must reach. */
function requiredPairs(strict: boolean): Pair[] {
  const body = strict ? AAA_TEXT : AA_TEXT;
  return [
    ...SURFACES.map(background => ({ foreground: 'text' as const, background, minimum: AAA_TEXT })),
    ...SURFACES.map(background => ({ foreground: 'muted' as const, background, minimum: body })),
    ...SIGNAL_TOKENS.flatMap(foreground => (['background', 'panel'] as const).map(background => ({ foreground, background, minimum: body }))),
    { foreground: 'selectionText', background: 'selection', minimum: body },
    { foreground: 'diffAdded', background: 'diffAddedBg', minimum: AA_TEXT },
    { foreground: 'diffRemoved', background: 'diffRemovedBg', minimum: AA_TEXT },
    { foreground: 'text', background: 'diffAddedBg', minimum: AA_TEXT },
    { foreground: 'text', background: 'diffRemovedBg', minimum: AA_TEXT },
    { foreground: 'lineNumber', background: 'background', minimum: UI_COMPONENT },
  ];
}

function failures(theme: Theme, strict: boolean): string[] {
  return requiredPairs(strict)
    .map(pair => ({ ...pair, ratio: contrastRatio(theme[pair.foreground], theme[pair.background]) }))
    .filter(pair => pair.ratio < pair.minimum)
    .map(pair => pair.foreground + ' on ' + pair.background + ' = ' + pair.ratio.toFixed(2) + ' < ' + pair.minimum);
}

function distance(first: string, second: string) {
  const channels = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const [a, b] = [channels(first), channels(second)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('WCAG contrast of every theme token pair', () => {
  for (const [name, theme] of Object.entries(allThemes())) {
    test(name + ' truecolor', () => {
      expect(failures(theme, name === 'contrast')).toEqual([]);
    });
  }
  for (const name of THEME_NAMES) {
    test(name + ' degraded to 256 colors', () => {
      expect(failures(degradeTheme(paletteNamed(name), 'ansi256'), name === 'contrast')).toEqual([]);
    });
  }
});

test('provider identity colors stay distinguishable in every color theme', () => {
  const colorful = Object.entries(allThemes()).filter(([name]) => name !== 'monochrome');
  for (const [name, theme] of colorful) {
    const [claude, chatgpt, zai] = [theme.providerClaude, theme.providerChatgpt, theme.providerZai];
    const closest = Math.min(distance(claude, chatgpt), distance(claude, zai), distance(chatgpt, zai));
    expect({ name, distinct: closest >= MIN_PROVIDER_DISTANCE }).toEqual({ name, distinct: true });
  }
});

test('contrast ratio matches the WCAG reference values', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  expect(contrastRatio('#123456', '#123456')).toBe(1);
});

test('mix blends channels linearly', () => {
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
});

describe('terminal adaptation', () => {
  test('color depth follows FORCE_COLOR, COLORTERM and TERM', () => {
    expect(colorDepth({})).toBe('truecolor');
    expect(colorDepth({ COLORTERM: 'truecolor', TERM: 'xterm' })).toBe('truecolor');
    expect(colorDepth({ TERM: 'xterm-256color' })).toBe('ansi256');
    expect(colorDepth({ TERM: 'xterm' })).toBe('ansi256');
    expect(colorDepth({ TERM: 'linux' })).toBe('ansi16');
    expect(colorDepth({ TERM: 'dumb', WT_SESSION: 'x' })).toBe('truecolor');
    expect(colorDepth({ FORCE_COLOR: '1', COLORTERM: 'truecolor' })).toBe('ansi16');
  });

  test('degrading snaps to the xterm palettes', () => {
    expect(degrade('#a78bfa', 'truecolor')).toBe('#a78bfa');
    expect(degrade('#a78bfa', 'ansi256')).toBe('#af87ff');
    expect(degrade('#f01010', 'ansi16')).toBe('#ff0000');
  });

  test('NO_COLOR wins over every theme and depth', () => {
    const monochrome = themeNamed('ember', { NO_COLOR: '1', COLORTERM: 'truecolor' });
    const hues = Object.values(monochrome).filter(color => !/^#(..)\1\1$/.test(color));
    expect(hues).toEqual([]);
  });

  test('an empty NO_COLOR does not disable color', () => {
    expect(themeNamed('ember', { NO_COLOR: '', COLORTERM: 'truecolor' })).toEqual(paletteNamed('ember'));
  });

  test('sixteen-color terminals get the ANSI theme regardless of the chosen name', () => {
    expect(themeNamed('daylight', { TERM: 'linux' })).toEqual(allThemes().ansi16);
  });

  test('unknown names fall back to the default palette', () => {
    expect(themeNamed('not-a-theme', {})).toEqual(paletteNamed('midnight'));
  });
});

test('every persisted theme name has a palette, and the lists agree', () => {
  expect([...THEME_NAMES]).toEqual([...PERSISTED_NAMES]);
  for (const name of THEME_NAMES) expect(paletteNamed(name)).toBe(allThemes()[name]);
});

test('providers map to their identity tokens and readable labels', () => {
  const theme = paletteNamed('midnight');
  expect(providerColor(theme, 'anthropic')).toBe(theme.providerClaude);
  expect(providerColor(theme, 'chatgpt')).toBe(theme.providerChatgpt);
  expect(providerColor(theme, 'zai')).toBe(theme.providerZai);
  expect(providerColor(theme, 'custom')).toBe(theme.secondary);
  expect([providerLabel('anthropic'), providerLabel('chatgpt'), providerLabel('zai'), providerLabel('custom')])
    .toEqual(['Claude', 'ChatGPT', 'Z.ai', 'custom']);
});

import { createContext, useContext, type Accessor } from 'solid-js';
import { THEME_NAMES as PERSISTED_THEME_NAMES, isThemeName, type ThemeName } from '../theme-names';
import { ANSI16, colorDepth, degrade, mix, mostReadable, relativeLuminance, type ColorDepth } from './color';

export { mix } from './color';

export interface Theme {
  background: string;
  panel: string;
  element: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  /** Background of the highlighted row in lists and menus. */
  selection: string;
  /** Text drawn on `selection`. */
  selectionText: string;
  /** Identity colors of the three first-class providers; other providers use `secondary`. */
  providerClaude: string;
  providerChatgpt: string;
  providerZai: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  diffContext: string;
  lineNumber: string;
}

type Palette = Omit<Theme, 'selection' | 'selectionText' | 'diffAdded' | 'diffRemoved' | 'diffAddedBg' | 'diffRemovedBg' | 'diffContext' | 'lineNumber'>;
type Environment = Record<string, string | undefined>;

const DARK_DIFF_TINT = 0.18;
/** Light surfaces show a tint more strongly, so they take less of it to keep diff text readable. */
const LIGHT_DIFF_TINT = 0.1;
const LIGHT_SURFACE_LUMINANCE = 0.5;
const LINE_NUMBER_FADE = 0.3;

/** Derives selection and diff colors from the palette so every theme stays consistent and readable. */
function complete(palette: Palette): Theme {
  const tint = relativeLuminance(palette.background) > LIGHT_SURFACE_LUMINANCE ? LIGHT_DIFF_TINT : DARK_DIFF_TINT;
  return {
    ...palette,
    selection: palette.accent,
    selectionText: mostReadable(palette.accent, [palette.background, palette.text]),
    diffAdded: palette.success,
    diffRemoved: palette.error,
    diffAddedBg: mix(palette.background, palette.success, tint),
    diffRemovedBg: mix(palette.background, palette.error, tint),
    diffContext: palette.muted,
    lineNumber: mix(palette.muted, palette.background, LINE_NUMBER_FADE),
  };
}

const THEMES: Record<ThemeName, Theme> = {
  midnight: complete({ background: '#0f0f14', panel: '#17171f', element: '#21212b', border: '#2e2e3b', text: '#e8e8f0',
    muted: '#8e8e9e', accent: '#a78bfa', secondary: '#67e8f9', success: '#7ee787', warning: '#e5c07b', error: '#ff7b72',
    providerClaude: '#e8956f', providerChatgpt: '#4fd1a5', providerZai: '#7fa2ff' }),
  ocean: complete({ background: '#0b1220', panel: '#101a2b', element: '#17243a', border: '#24344f', text: '#e2e8f0',
    muted: '#8d9db6', accent: '#38bdf8', secondary: '#a5b4fc', success: '#6ee7b7', warning: '#fcd34d', error: '#fb7185',
    providerClaude: '#f09a76', providerChatgpt: '#5ad8ab', providerZai: '#8eaaff' }),
  ember: complete({ background: '#15100d', panel: '#1d1713', element: '#28201a', border: '#3d3129', text: '#f3e9e0',
    muted: '#a8978a', accent: '#ff9a5c', secondary: '#7fd1c7', success: '#a6d98a', warning: '#f6c96b', error: '#ff7a6b',
    providerClaude: '#ffab7a', providerChatgpt: '#6fd6ad', providerZai: '#94b2ff' }),
  daylight: complete({ background: '#fbfaf7', panel: '#f1efe9', element: '#e6e3da', border: '#cbc6b8', text: '#1d1b16',
    muted: '#5c5a52', accent: '#5b2fc0', secondary: '#0e6e8a', success: '#156b33', warning: '#8a5a00', error: '#b42318',
    providerClaude: '#963c18', providerChatgpt: '#0b7356', providerZai: '#2f54c4' }),
  terminal: complete({ background: '#0c0c0c', panel: '#151515', element: '#1f1f1f', border: '#303030', text: '#e5e5e5',
    muted: '#8f8f8f', accent: '#2dd4bf', secondary: '#a3e635', success: '#4ade80', warning: '#facc15', error: '#f87171',
    providerClaude: '#f0a070', providerChatgpt: '#34d399', providerZai: '#8fa8ff' }),
  contrast: complete({ background: '#000000', panel: '#0d0d0d', element: '#1c1c1c', border: '#6b6b6b', text: '#ffffff',
    muted: '#cfcfcf', accent: '#ffd400', secondary: '#00e5ff', success: '#00ff7f', warning: '#ffd400', error: '#ff8080',
    providerClaude: '#ffae85', providerChatgpt: '#3dffb0', providerZai: '#a8c0ff' }),
};

/** Built only from the 16 ANSI slots, so it survives terminals without 256 colors. */
const ANSI16_THEME = complete({ background: ANSI16[0], panel: ANSI16[0], element: ANSI16[0], border: ANSI16[8], text: ANSI16[15],
  muted: ANSI16[7], accent: ANSI16[14], secondary: ANSI16[13], success: ANSI16[10], warning: ANSI16[11], error: ANSI16[9],
  providerClaude: ANSI16[11], providerChatgpt: ANSI16[10], providerZai: ANSI16[13] });

/** Hue-free palette for `NO_COLOR`: state is carried by glyphs (●, ✗, ■) and brightness only. */
const MONOCHROME_THEME = complete({ background: '#000000', panel: '#121212', element: '#262626', border: '#4e4e4e', text: '#eeeeee',
  muted: '#a8a8a8', accent: '#ffffff', secondary: '#d0d0d0', success: '#eeeeee', warning: '#eeeeee', error: '#ffffff',
  providerClaude: '#eeeeee', providerChatgpt: '#eeeeee', providerZai: '#eeeeee' });

/** Typed as plain strings so callers can validate arbitrary input with `includes`. */
export const THEME_NAMES: readonly string[] = PERSISTED_THEME_NAMES;
const DEFAULT_THEME: ThemeName = 'midnight';

const THEME_DESCRIPTIONS: Record<ThemeName, string> = {
  midnight: 'Violet on ink · default',
  ocean: 'Cool blues',
  ember: 'Warm glow on charcoal',
  daylight: 'Light background',
  terminal: 'Neutral greys, teal accent',
  contrast: 'Maximum contrast',
};

export function themeDescription(name: ThemeName): string {
  return THEME_DESCRIPTIONS[name];
}

/** The palette a theme name stands for, before terminal adaptation; unknown names fall back to the default. */
export function paletteNamed(name: string | undefined): Theme {
  return THEMES[isThemeName(name) ? name : DEFAULT_THEME];
}

/**
 * The theme to draw with: honors `NO_COLOR`, then degrades to what the terminal's color depth can show.
 * Sixteen-color terminals always get the ANSI theme because no tuned truecolor palette survives that depth.
 */
export function themeNamed(name: string | undefined, env: Environment = process.env): Theme {
  if (env.NO_COLOR) return MONOCHROME_THEME;
  const depth = colorDepth(env);
  if (depth === 'ansi16') return ANSI16_THEME;
  return degradeTheme(paletteNamed(name), depth);
}

export function degradeTheme(theme: Theme, depth: ColorDepth): Theme {
  if (depth === 'truecolor') return theme;
  return Object.fromEntries(Object.entries(theme).map(([token, color]) => [token, degrade(color, depth)])) as unknown as Theme;
}

const PROVIDER_TOKENS: Record<string, keyof Theme> = { anthropic: 'providerClaude', chatgpt: 'providerChatgpt', zai: 'providerZai' };
const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Claude', chatgpt: 'ChatGPT', zai: 'Z.ai', ollama: 'Ollama' };

/** Identity color of a provider id such as `anthropic`, `chatgpt` or `zai`. */
export function providerColor(theme: Theme, provider: string): string {
  return theme[PROVIDER_TOKENS[provider] ?? 'secondary'];
}

/** Display name of a provider id; configured providers keep their id. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

const ThemeContext = createContext<Accessor<Theme>>(() => THEMES[DEFAULT_THEME]);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Accessor<Theme> {
  return useContext(ThemeContext);
}

/** Every concrete theme including the terminal fallbacks; for contrast verification. */
export function allThemes(): Record<string, Theme> {
  return { ...THEMES, ansi16: ANSI16_THEME, monochrome: MONOCHROME_THEME };
}

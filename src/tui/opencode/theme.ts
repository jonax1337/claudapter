import { createContext, useContext, type Accessor } from 'solid-js';

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
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  diffContext: string;
  lineNumber: string;
}

type BaseTheme = Omit<Theme, 'diffAdded' | 'diffRemoved' | 'diffAddedBg' | 'diffRemovedBg' | 'diffContext' | 'lineNumber'>;

const DIFF_BACKGROUND_TINT = 0.18;

/** Derives the diff palette from the base colors so every theme stays consistent. */
function withDiffColors(base: BaseTheme): Theme {
  return {
    ...base,
    diffAdded: base.success,
    diffRemoved: base.error,
    diffAddedBg: mix(base.background, base.success, DIFF_BACKGROUND_TINT),
    diffRemovedBg: mix(base.background, base.error, DIFF_BACKGROUND_TINT),
    diffContext: base.muted,
    lineNumber: mix(base.muted, base.background, 0.35),
  };
}

const THEMES: Record<string, Theme> = {
  midnight: withDiffColors({ background: '#0f0f14', panel: '#17171f', element: '#21212b', border: '#2e2e3b', text: '#e8e8f0',
    muted: '#80808f', accent: '#a78bfa', secondary: '#67e8f9', success: '#7ee787', warning: '#e5c07b', error: '#ff7b72' }),
  ocean: withDiffColors({ background: '#0b1220', panel: '#101a2b', element: '#17243a', border: '#24344f', text: '#e2e8f0',
    muted: '#7b8ba3', accent: '#38bdf8', secondary: '#a5b4fc', success: '#6ee7b7', warning: '#fcd34d', error: '#fb7185' }),
  terminal: withDiffColors({ background: '#0c0c0c', panel: '#151515', element: '#1f1f1f', border: '#303030', text: '#e5e5e5',
    muted: '#8a8a8a', accent: '#2dd4bf', secondary: '#a3e635', success: '#4ade80', warning: '#facc15', error: '#f87171' }),
  contrast: withDiffColors({ background: '#000000', panel: '#0d0d0d', element: '#1c1c1c', border: '#6b6b6b', text: '#ffffff',
    muted: '#c8c8c8', accent: '#ffd400', secondary: '#00e5ff', success: '#00ff7f', warning: '#ffd400', error: '#ff4d4d' }),
};

export const THEME_NAMES = Object.keys(THEMES);

export function themeNamed(name: string | undefined): Theme {
  return THEMES[name ?? ''] ?? THEMES.midnight;
}

/** Linear blend of two `#rrggbb` colors; `amount` 0 returns `from`, 1 returns `to`. */
export function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const blended = [0, 1, 2].map(index => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount));
  return '#' + blended.map(value => value.toString(16).padStart(2, '0')).join('');
}

const ThemeContext = createContext<Accessor<Theme>>(() => THEMES.midnight);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Accessor<Theme> {
  return useContext(ThemeContext);
}

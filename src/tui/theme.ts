import { createContext, useContext } from 'react';
import { defaultTheme, extendTheme } from '@inkjs/ui';
import type { ThemeName } from './theme-names.js';

export interface Palette {
  accent: string;
  muted: string;
  border: string;
  error: string;
  warning: string;
  success: string;
  code: string;
}

export const themes: Record<ThemeName, Palette> = {
  midnight: { accent: '#A78BFA', muted: '#9295AA', border: '#45415C', error: '#F08A91', warning: '#E9BD78', success: '#91C9A5', code: '#B9C9DD' },
  ocean: { accent: '#38BDF8', muted: '#8BA7B8', border: '#334C60', error: '#F08A91', warning: '#E9BD78', success: '#91C9A5', code: '#B9DDEB' },
  ember: { accent: '#FF9A5C', muted: '#A8978A', border: '#3D3129', error: '#FF7A6B', warning: '#F6C96B', success: '#A6D98A', code: '#F3D9C4' },
  daylight: { accent: '#5B2FC0', muted: '#5C5A52', border: '#CBC6B8', error: '#B42318', warning: '#8A5A00', success: '#156B33', code: '#0E6E8A' },
  terminal: { accent: 'cyan', muted: 'gray', border: 'gray', error: 'red', warning: 'yellow', success: 'green', code: 'cyan' },
  contrast: { accent: 'yellow', muted: 'white', border: 'white', error: 'redBright', warning: 'yellowBright', success: 'greenBright', code: 'cyanBright' },
};

export const PaletteContext = createContext<Palette>(themes.midnight);
export const usePalette = () => useContext(PaletteContext);
export const componentThemes = Object.fromEntries(Object.entries(themes).map(([name, palette]) => [name,
  extendTheme(defaultTheme, { components: { Spinner: { styles: { frame: () => ({ color: palette.accent }) } } } }),
]));

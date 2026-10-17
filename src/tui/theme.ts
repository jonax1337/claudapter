import { createContext, useContext } from 'react';
import { defaultTheme, extendTheme } from '@inkjs/ui';

export interface Palette {
  accent: string;
  muted: string;
  border: string;
  error: string;
  warning: string;
  success: string;
  code: string;
}

export const themes: Record<'midnight' | 'ocean' | 'terminal' | 'contrast', Palette> = {
  midnight: { accent: '#A78BFA', muted: '#9295AA', border: '#45415C', error: '#F08A91', warning: '#E9BD78', success: '#91C9A5', code: '#B9C9DD' },
  ocean: { accent: '#38BDF8', muted: '#8BA7B8', border: '#334C60', error: '#F08A91', warning: '#E9BD78', success: '#91C9A5', code: '#B9DDEB' },
  terminal: { accent: 'cyan', muted: 'gray', border: 'gray', error: 'red', warning: 'yellow', success: 'green', code: 'cyan' },
  contrast: { accent: 'yellow', muted: 'white', border: 'white', error: 'redBright', warning: 'yellowBright', success: 'greenBright', code: 'cyanBright' },
};

export const PaletteContext = createContext<Palette>(themes.midnight);
export const usePalette = () => useContext(PaletteContext);
export const componentThemes = Object.fromEntries(Object.entries(themes).map(([name, palette]) => [name,
  extendTheme(defaultTheme, { components: { Spinner: { styles: { frame: () => ({ color: palette.accent }) } } } }),
]));

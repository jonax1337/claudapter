// Pure color math for themes: blending, WCAG contrast and terminal color-depth degradation.

export type ColorDepth = 'truecolor' | 'ansi256' | 'ansi16';

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const GRAY_RAMP_START = 8;
const GRAY_RAMP_STEP = 10;
const GRAY_RAMP_SIZE = 24;
/** The xterm defaults of the 16 ANSI colors; terminals remap them, so this only fixes which slot a token takes. */
export const ANSI16 = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
];
const TRUECOLOR_TERMINALS = ['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'Hyper', 'Tabby', 'rio'];
const FORCE_COLOR_DEPTH: Record<string, ColorDepth> = { 1: 'ansi16', 2: 'ansi256', 3: 'truecolor' };
/** Terminal types that cannot show more than the 16 ANSI colors. Plain `xterm`/`screen` usually can, so they count as 256. */
const LIMITED_TERMINALS = /^(dumb|linux|vt\d+|ansi|cygwin|cons25)$/;

/** Linear blend of two `#rrggbb` colors; `amount` 0 returns `from`, 1 returns `to`. */
export function mix(from: string, to: string, amount: number): string {
  const start = channels(from);
  const end = channels(to);
  return toHex(start.map((value, index) => value + (end[index] - value) * amount));
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(value => linearize(value / 255));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Of `candidates`, the color that reads best on `background`. */
export function mostReadable(background: string, candidates: string[]): string {
  return candidates.reduce((best, next) => contrastRatio(next, background) > contrastRatio(best, background) ? next : best);
}

/**
 * Color depth the terminal advertises. `FORCE_COLOR` (1–3) wins; unknown terminals count as truecolor
 * because the supported Windows terminals and current Unix emulators render 24-bit colors. OpenTUI maps
 * truecolor to the 256-color palette itself when the terminal reports no RGB support.
 */
export function colorDepth(env: Record<string, string | undefined>): ColorDepth {
  const forced = FORCE_COLOR_DEPTH[env.FORCE_COLOR ?? ''];
  if (forced) return forced;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (env.WT_SESSION || TRUECOLOR_TERMINALS.includes(env.TERM_PROGRAM ?? '')) return 'truecolor';
  const term = env.TERM ?? '';
  if (LIMITED_TERMINALS.test(term)) return 'ansi16';
  if (/^(xterm|screen|tmux|rxvt)/.test(term)) return 'ansi256';
  return 'truecolor';
}

/** The closest color a terminal of `depth` can show, still as `#rrggbb`. */
export function degrade(hex: string, depth: ColorDepth): string {
  if (depth === 'truecolor') return hex;
  return nearest(hex, depth === 'ansi256' ? XTERM_256 : ANSI16);
}

const XTERM_256 = [
  ...ANSI16,
  ...CUBE_LEVELS.flatMap(red => CUBE_LEVELS.flatMap(green => CUBE_LEVELS.map(blue => toHex([red, green, blue])))),
  ...Array.from({ length: GRAY_RAMP_SIZE }, (_, step) => toHex(Array(3).fill(GRAY_RAMP_START + step * GRAY_RAMP_STEP))),
];

function nearest(hex: string, palette: string[]): string {
  const target = channels(hex);
  const distance = (candidate: string) => channels(candidate).reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0);
  return palette.reduce((best, next) => distance(next) < distance(best) ? next : best);
}

function channels(hex: string): number[] {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function toHex(values: number[]): string {
  return '#' + values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');
}

function linearize(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

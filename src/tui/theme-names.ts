/** Persistable Claudapter UI theme names; shared by preferences validation and both interfaces. */
export const THEME_NAMES = ['midnight', 'ocean', 'ember', 'daylight', 'terminal', 'contrast'] as const;

export type ThemeName = typeof THEME_NAMES[number];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

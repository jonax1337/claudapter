// Items of the /theme picker: live preview while browsing, restore on dismissal, persist on choice.
import type { MenuItem } from './menu';
import { THEME_NAMES } from '../theme-names';
import { themeDescription } from './theme';

export interface ThemeMenuActions {
  /** The persisted theme; the picker opens on it and restores it when dismissed. */
  active: string;
  /** Applies a theme to the running interface without saving it. */
  preview(name: string): void;
  /** Saves the theme and closes the picker. */
  apply(name: string): void | Promise<void>;
}

export function themeMenuItems(actions: ThemeMenuActions): MenuItem[] {
  return THEME_NAMES.map(name => ({
    title: name,
    description: themeDescription(name),
    current: name === actions.active,
    preview: () => actions.preview(name),
    run: () => actions.apply(name),
  }));
}

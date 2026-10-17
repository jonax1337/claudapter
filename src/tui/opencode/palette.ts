// Grouping and shortcut labels of the command palette (/help, ctrl+p).
import type { MenuItem } from './menu';

export const SKILLS_GROUP = 'Skills & Commands';
const DEFAULT_GROUP = 'Setup';
export const NATIVE_ONLY_GROUP = 'Native only';
const GROUP_ORDER = ['Session', 'Model & Mode', 'View', 'Agents & Tasks', 'Workspace', DEFAULT_GROUP, 'Account', NATIVE_ONLY_GROUP, SKILLS_GROUP];

const GROUP_COMMANDS: Record<string, string[]> = {
  Session: ['/resume', '/sessions', '/continue', '/clear', '/fork', '/rename', '/export', '/rewind', '/history', '/btw', '/cd', '/exit'],
  'Model & Mode': ['/model', '/favorite', '/effort', '/plan', '/mode', '/fallback'],
  View: ['/help', '/theme', '/thinking', '/details', '/usage', '/context', '/output-style', '/vim', '/keymap', '/tutorial'],
  'Agents & Tasks': ['/agents', '/agent', '/tasks'],
  Account: ['/account', '/privacy', '/upgrade'],
  [NATIVE_ONLY_GROUP]: ['/cloud', '/artifacts', '/ide', '/voice', '/passes'],
  Workspace: ['/diff', '/copy', '/attach', '/attachments', '/add-dir'],
};

/** Shortcuts that run a command; listed only where the key is bound. */
const KEY_HINTS: Record<string, string> = { '/help': 'ctrl+p', '/tasks': 'ctrl+t', '/agent': 'alt+←→', '/mode': 'shift+tab', '/history': '↑' };

export function commandGroup(name: string): string {
  return GROUP_ORDER.find(group => GROUP_COMMANDS[group]?.includes(name)) ?? DEFAULT_GROUP;
}

export function keyHint(name: string): string | undefined {
  return KEY_HINTS[name];
}

/** Palette order: by group, then alphabetically; the dialog shows one heading per group. */
export function sortPaletteItems(items: MenuItem[]): MenuItem[] {
  const rank = (item: MenuItem) => GROUP_ORDER.indexOf(item.group ?? DEFAULT_GROUP);
  return [...items].sort((left, right) => rank(left) - rank(right) || left.title.localeCompare(right.title));
}

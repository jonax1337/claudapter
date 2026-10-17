// Grouping and shortcut labels of the command palette (/help, ctrl+p).
import type { MenuItem } from './menu';

export const SKILLS_GROUP = 'Skills & Commands';
const DEFAULT_GROUP = 'Setup';
const GROUP_ORDER = ['Session', 'Model & Mode', 'View', 'Agents & Tasks', 'Workspace', DEFAULT_GROUP, SKILLS_GROUP];

const GROUP_COMMANDS: Record<string, string[]> = {
  Session: ['/resume', '/sessions', '/continue', '/clear', '/fork', '/rename', '/export', '/rewind', '/history', '/exit'],
  'Model & Mode': ['/model', '/favorite', '/effort', '/plan', '/mode', '/fallback'],
  View: ['/help', '/theme', '/thinking', '/details', '/usage', '/context', '/output-style'],
  'Agents & Tasks': ['/agents', '/tasks'],
  Workspace: ['/diff', '/copy', '/attach', '/attachments', '/add-dir'],
};

/** Shortcuts that run a command; listed only where the key is bound. */
const KEY_HINTS: Record<string, string> = { '/help': 'ctrl+p', '/tasks': 'ctrl+t', '/mode': 'shift+tab', '/history': '↑' };

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

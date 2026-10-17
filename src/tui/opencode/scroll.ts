export type ScrollAction = 'top' | 'bottom' | 'halfUp' | 'halfDown' | 'previousUser' | 'nextUser';

export interface ScrollKey { name: string; ctrl?: boolean; meta?: boolean; option?: boolean; shift?: boolean }

/**
 * Maps a key press to a transcript scroll. Keys that also edit text (Home, End, Ctrl+U, Ctrl+D)
 * only scroll while the composer is empty so they keep their editing meaning otherwise.
 */
export function scrollAction(key: ScrollKey, composerEmpty: boolean): ScrollAction | undefined {
  const alt = Boolean(key.meta || key.option);
  if (alt && key.name === 'up') return 'previousUser';
  if (alt && key.name === 'down') return 'nextUser';
  if (key.ctrl && key.name === 'home') return 'top';
  if (key.ctrl && key.name === 'end') return 'bottom';
  if (!composerEmpty) return undefined;
  if (!key.ctrl && key.name === 'home') return 'top';
  if (!key.ctrl && key.name === 'end') return 'bottom';
  if (key.ctrl && key.name === 'u') return 'halfUp';
  if (key.ctrl && key.name === 'd') return 'halfDown';
  return undefined;
}

/** Offset of the last anchor strictly above `scrollTop`, or `undefined` when there is none. */
export function anchorBefore(offsets: number[], scrollTop: number): number | undefined {
  return offsets.filter(offset => offset < scrollTop).at(-1);
}

/** Offset of the first anchor strictly below `scrollTop`, or `undefined` when there is none. */
export function anchorAfter(offsets: number[], scrollTop: number): number | undefined {
  return offsets.find(offset => offset > scrollTop);
}

/** Whether the entry list was swapped out (resume, new session) instead of appended to. */
export function entriesReplaced(previous: { firstId?: string; count: number; sessionId?: string }, next: { firstId?: string; count: number; sessionId?: string }) {
  return next.count > 0 && (next.firstId !== previous.firstId || next.count < previous.count || next.sessionId !== previous.sessionId);
}

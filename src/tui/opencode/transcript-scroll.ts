import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { ScrollBoxRenderable } from '@opentui/core';
import { anchorAfter, anchorBefore, entriesReplaced, type ScrollAction } from './scroll';

/** Layout settles over a few frames after content changes, so jumping to the end is retried once. */
const SETTLE_DELAYS_MS = [0, 120];
const UNREAD_POLL_MS = 200;

export interface TranscriptScrollInput {
  entries: Accessor<{ id: string; kind: string }[]>;
  sessionId: Accessor<string | undefined>;
  showsThinking: Accessor<boolean>;
}

/**
 * Scroll behaviour of the session transcript: jump to the end after a resume or session switch,
 * count messages that arrive while the user reads earlier ones, and navigate by user message.
 */
export function useTranscriptScroll(input: TranscriptScrollInput) {
  let box: ScrollBoxRenderable | undefined;
  const [unread, setUnread] = createSignal(0);
  const settleTimers = new Set<ReturnType<typeof setTimeout>>();
  onCleanup(() => settleTimers.forEach(clearTimeout));

  const alive = () => (box && !box.isDestroyed ? box : undefined);
  const atBottom = () => {
    const scroll = alive();
    return !scroll || scroll.scrollTop + scroll.viewport.height >= scroll.scrollHeight - 1;
  };

  function jumpToBottom() {
    setUnread(0);
    const toEnd = () => { const scroll = alive(); scroll?.scrollTo(scroll.scrollHeight); };
    toEnd();
    for (const delay of SETTLE_DELAYS_MS) {
      const timer = setTimeout(() => { settleTimers.delete(timer); toEnd(); }, delay);
      settleTimers.add(timer);
    }
  }

  let previous: { firstId?: string; count: number; sessionId?: string } = { count: 0 };
  createEffect(() => {
    const entries = input.entries();
    const next = { firstId: entries[0]?.id, count: entries.length, sessionId: input.sessionId() };
    if (entriesReplaced(previous, next)) jumpToBottom();
    else if (next.count === 0) setUnread(0);
    else if (next.count > previous.count) setUnread(count => atBottom() ? 0 : count + next.count - previous.count);
    previous = next;
  });

  createEffect(() => {
    if (unread() === 0) return;
    const timer = setInterval(() => { if (atBottom()) setUnread(0); }, UNREAD_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  /** Vertical offsets of the user messages, or none when the transcript layout is not one row per entry. */
  function userMessageOffsets(scroll: ScrollBoxRenderable): number[] {
    const visible = input.entries().filter(entry => input.showsThinking() || entry.kind !== 'thinking');
    let rows = scroll.content.getChildren();
    while (rows.length === 1 && rows[0].getChildren().length > 1) rows = rows[0].getChildren();
    if (rows.length !== visible.length) return [];
    return visible.flatMap((entry, index) => entry.kind === 'user' ? [rows[index].y - scroll.content.y] : []);
  }

  function perform(action: ScrollAction) {
    const scroll = alive();
    if (!scroll) return;
    const half = Math.max(1, Math.floor(scroll.viewport.height / 2));
    if (action === 'top') scroll.scrollTo(0);
    else if (action === 'bottom') jumpToBottom();
    else if (action === 'halfUp') scroll.scrollBy(-half);
    else if (action === 'halfDown') scroll.scrollBy(half);
    else if (action === 'previousUser') scroll.scrollTo(anchorBefore(userMessageOffsets(scroll), scroll.scrollTop) ?? 0);
    else {
      const target = anchorAfter(userMessageOffsets(scroll), scroll.scrollTop);
      if (target === undefined) jumpToBottom(); else scroll.scrollTo(target);
    }
  }

  return {
    ref: (element: ScrollBoxRenderable | undefined) => { box = element; },
    unread,
    jumpToBottom,
    perform,
    scrollBy: (rows: number) => alive()?.scrollBy(rows),
  };
}

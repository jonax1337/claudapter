// Keyboard paging over a precomputed list of rows, shared by the read-only panels (usage, context, shortcuts).
import { createSignal, type Accessor } from 'solid-js';

export interface PagedRows<T> {
  visible: Accessor<T[]>;
  /** `3–12 of 40`, or empty when every row fits. */
  rangeLabel: Accessor<string>;
  /** Moves the window for up/down/pageup/pagedown/home/end; false for any other key. */
  handleKey(name: string): boolean;
}

export function usePagedRows<T>(rows: Accessor<T[]>, height: Accessor<number>): PagedRows<T> {
  const [offset, setOffset] = createSignal(0);
  const clamp = (next: number) => Math.max(0, Math.min(next, Math.max(0, rows().length - height())));
  const moves: Record<string, (current: number) => number> = {
    up: current => current - 1,
    down: current => current + 1,
    pageup: current => current - height(),
    pagedown: current => current + height(),
    home: () => 0,
    end: () => rows().length,
  };
  return {
    visible: () => rows().slice(clamp(offset()), clamp(offset()) + height()),
    rangeLabel: () => rows().length > height()
      ? (clamp(offset()) + 1) + '–' + Math.min(rows().length, clamp(offset()) + height()) + ' of ' + rows().length : '',
    handleKey(name) {
      const move = moves[name];
      if (!move) return false;
      setOffset(current => clamp(move(clamp(current))));
      return true;
    },
  };
}

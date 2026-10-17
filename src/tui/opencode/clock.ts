import { createSignal, onCleanup, type Accessor } from 'solid-js';

const CLOCK_MS = 1000;

/** One interval per period, shared by every subscriber and stopped with the last one. */
const tickers = new Map<number, { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> }>();

function subscribe(periodMs: number, listener: () => void) {
  let ticker = tickers.get(periodMs);
  if (!ticker) {
    const listeners = new Set<() => void>();
    ticker = { listeners, timer: setInterval(() => listeners.forEach(notify => notify()), periodMs) };
    tickers.set(periodMs, ticker);
  }
  ticker.listeners.add(listener);
  return () => {
    const current = tickers.get(periodMs);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) { clearInterval(current.timer); tickers.delete(periodMs); }
  };
}

/** A counter that advances every `periodMs`; components animating at the same rate share one timer and stay in phase. */
export function useTicker(periodMs: number): Accessor<number> {
  const [tick, setTick] = createSignal(0);
  onCleanup(subscribe(periodMs, () => setTick(value => value + 1)));
  return tick;
}

/** Wall-clock time that refreshes every second; all callers share one interval, which stops with the last caller. */
export function useClock(): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  onCleanup(subscribe(CLOCK_MS, () => setNow(Date.now())));
  return now;
}

export function activeTickers() {
  return tickers.size;
}

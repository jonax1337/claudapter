import { createSignal, onCleanup, type Accessor } from 'solid-js';

const CLOCK_MS = 1000;

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  subscribers.add(listener);
  timer ??= setInterval(() => subscribers.forEach(notify => notify()), CLOCK_MS);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && timer) { clearInterval(timer); timer = undefined; }
  };
}

/** Wall-clock time that refreshes every second; all callers share one interval, which stops with the last caller. */
export function useClock(): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  onCleanup(subscribe(() => setNow(Date.now())));
  return now;
}

export function activeClockSubscribers() {
  return subscribers.size;
}

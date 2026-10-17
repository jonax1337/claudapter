import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { useTicker } from './clock';

type Environment = Record<string, string | undefined>;

const FADE_MS = 120;
const FADE_FRAME_MS = 30;

/** `CLAUDAPTER_REDUCED_MOTION=1` freezes spinners, scanners and fades on their resting frame. */
export function prefersReducedMotion(env: Environment = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.CLAUDAPTER_REDUCED_MOTION ?? '');
}

/** Frame counter for looping animations; stays at 0 when motion is reduced, so no timer runs at all. */
export function useAnimationFrame(periodMs: number): Accessor<number> {
  if (prefersReducedMotion()) return () => 0;
  return useTicker(periodMs);
}

/** Eases from 0 to 1 over a short, fixed time after mount; immediately 1 when motion is reduced. */
export function useFadeIn(durationMs: number = FADE_MS): Accessor<number> {
  if (prefersReducedMotion()) return () => 1;
  const startedAt = performance.now();
  const [progress, setProgress] = createSignal(0);
  const timer = setInterval(() => {
    const next = Math.min(1, (performance.now() - startedAt) / durationMs);
    setProgress(next);
    if (next === 1) clearInterval(timer);
  }, FADE_FRAME_MS);
  onCleanup(() => clearInterval(timer));
  return progress;
}

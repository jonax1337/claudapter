import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { RouteOffer, RouteToast } from '../../../dist/tui/route-model.js';
import { ROUTE_COMMAND, offerForKey, offerHints } from './route-offers';
import { useTheme } from './theme';

/** Long enough to read a fallback notice twice; repeats restart it instead of stacking toasts. */
export const ROUTE_TOAST_MS = 7000;
const TOAST_WIDTH = 64;

export interface RouteLayerState { routeToast?: RouteToast; routeOffers?: RouteOffer[] }

export interface RouteLayerProps {
  state: RouteLayerState;
  /** False while a dialog or decision owns the keyboard. */
  enabled: boolean;
  onCommand(text: string): void;
}

/**
 * Non-blocking route notices: a toast in the corner that never takes focus, and `alt+<key>` for the
 * recovery offers it lists. Offers stay reachable after the toast fades, also through `/route`.
 */
export function RouteLayer(props: RouteLayerProps) {
  const theme = useTheme();
  const [visible, setVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    const toast = props.state.routeToast;
    if (!toast) return;
    // Reading both fields subscribes the effect, so a coalesced repeat (same object, new count) restarts the timer.
    void toast.at; void toast.count;
    setVisible(true);
    clearTimeout(timer);
    timer = setTimeout(() => setVisible(false), ROUTE_TOAST_MS);
  });
  const offers = () => props.state.routeOffers ?? [];
  useKeyboard(event => {
    if (!props.enabled) return;
    const offer = offerForKey(offers(), event);
    if (!offer) return;
    event.preventDefault();
    setVisible(false);
    props.onCommand(ROUTE_COMMAND + ' ' + offer.action);
  });
  const toneColor = () => theme()[props.state.routeToast?.tone === 'info' ? 'accent' : props.state.routeToast?.tone ?? 'warning'];
  return (
    <Show when={visible() && props.state.routeToast}>
      <box position="absolute" bottom={4} right={2} zIndex={3900} maxWidth={TOAST_WIDTH} backgroundColor={theme().panel}
        border={['left']} borderColor={toneColor()} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}
        onMouseUp={() => setVisible(false)}>
        <text fg={theme().text}>{props.state.routeToast!.text}</text>
        <For each={offerHints(offers())}>{([key, label]) =>
          <text fg={theme().muted} wrapMode="none"><span style={{ fg: theme().text }}>{key}</span> {label}</text>
        }</For>
      </box>
    </Show>
  );
}

import { Show, type JSX } from 'solid-js';
import type { RouteMarker } from '../../../dist/tui/route-model.js';
import { useClock } from './clock';
import { formatCountdown } from './status';
import { providerColor, useTheme } from './theme';
import type { TranscriptEntry } from './transcript';

/** Kinds whose model actually answered or failed; the badge shows it in its provider color. */
const BADGED_KINDS = new Set<RouteMarker['kind']>(['switched', 'routed', 'interrupted']);

export type RouteEntry = TranscriptEntry & { route: RouteMarker };

export function isRouteEntry(entry: TranscriptEntry): entry is RouteEntry {
  return (entry as Partial<RouteEntry>).route !== undefined;
}

/** `Transcript` footer slot: the route badge under a route marker; other entries get nothing. */
export function routeEntryFooter(entry: TranscriptEntry): JSX.Element | undefined {
  if (!isRouteEntry(entry) || !BADGED_KINDS.has(entry.route.kind)) return undefined;
  return <RouteBadge marker={entry.route} />;
}

/** Remaining cooldown as `back in 4m` / `back in 42s`; empty once the requested model is back. */
export function cooldownNote(marker: RouteMarker, now: number): string {
  const remaining = (marker.cooldownUntil ?? 0) - now;
  if (remaining <= 0) return '';
  return 'back in ' + formatCountdown(remaining);
}

/** `● gpt-6-astra · chatgpt · back in 4m`, centered under the marker text. */
function RouteBadge(props: { marker: RouteMarker }) {
  const theme = useTheme();
  const now = useClock();
  const note = () => cooldownNote(props.marker, now());
  return (
    <box width="100%" alignItems="center" flexShrink={0}>
      <text wrapMode="none">
        <span style={{ fg: providerColor(theme(), props.marker.provider ?? '') }}>{'● ' + props.marker.actual}</span>
        <span style={{ fg: theme().muted }}>{' · ' + (props.marker.provider ?? 'unknown provider')}</span>
        <Show when={note()}><span style={{ fg: theme().muted }}>{' · ' + note()}</span></Show>
      </text>
    </box>
  );
}

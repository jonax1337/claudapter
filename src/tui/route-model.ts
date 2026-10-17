import type { FallbackRule } from '../config.js';
import { humanDuration } from '../fallback-presets.js';
import type { RouteNotice, RouteScope, SwitchReason } from '../route-events.js';

/** The model actually answering a scope, with the cooldown that keeps it there. */
export interface RouteView {
  requested: string; actual: string; provider: string;
  reason?: SwitchReason; cooldownUntil?: number;
}
/**
 * One persistent transcript line per turn, scope and notice kind; repeats raise `count`.
 * `routed` is the badge of a later turn that a running cooldown still serves on the replacement.
 */
export interface RouteMarker {
  id: string; kind: RouteNotice['kind'] | 'routed'; agent?: string; requested: string; at: number;
  actual?: string; provider?: string; reason?: SwitchReason; cooldownUntil?: number; chain?: string[];
  count: number; text: string;
}
/** A recovery step the user may trigger explicitly; nothing here runs on its own. */
export type RouteOffer =
  | { action: 'retry'; session: string; requested: string; target?: string }
  | { action: 'back'; session: string; requested: string }
  | { action: 'pin'; model: string }
  | { action: 'setup' };
export type RouteAction = RouteOffer['action'];
export interface RouteToast { key: string; text: string; tone: 'info' | 'warning' | 'error'; count: number; at: number }
/** The slice of a gateway route event (`request` or `fallback`) that names the routed model of a scope. */
export interface RoutedRequest { event: string; agent?: string; requestClass?: string; requested: string; actual: string; provider: string }

/** Sent as an ordinary user prompt; the model sees the interrupted turn and its tool results in history. */
export const RETRY_PROMPT = 'Retry your previous reply. It was interrupted before completion and was not replayed automatically. '
  + 'Check the conversation for tool calls that already ran and do not repeat completed actions.';
const TOAST_COALESCE_MS = 8000;
const NO_TURN = 'session';

const SWITCH_PHRASES: Record<SwitchReason, (requested: string, actual: string) => string> = {
  rate_limit: (requested, actual) => 'rate limit on ' + requested + ' · continued on ' + actual,
  unavailable: (requested, actual) => requested + ' unavailable · continued on ' + actual,
  quota_preemption: (requested, actual) => requested + ' quota almost used · started on ' + actual,
  user_retry: (_, actual) => 'continuing on ' + actual + ' as you chose',
};
const LIMIT_PHRASES: Record<SwitchReason, string> = {
  rate_limit: 'rate limit', unavailable: 'outage', quota_preemption: 'quota limit', user_retry: 'retry',
};

/** Plain transcript text of a marker; renderers without route support show exactly this. */
export function markerText(marker: Omit<RouteMarker, 'text'>): string {
  const prefix = marker.agent ? 'agent ' + marker.agent + ' · ' : '';
  const repeat = marker.count > 1 ? ' ×' + marker.count : '';
  return prefix + markerBody(marker) + repeat;
}

function markerBody(marker: Omit<RouteMarker, 'text'>): string {
  switch (marker.kind) {
    case 'switched': return SWITCH_PHRASES[marker.reason!](marker.requested, marker.actual!)
      + ' · for ' + humanDuration(marker.cooldownUntil! - marker.at);
    case 'interrupted': return 'reply from ' + marker.actual + ' interrupted mid-stream · not replayed';
    case 'exhausted': return 'every fallback target failed (' + marker.chain!.join(' → ') + ') · nothing was replayed';
    case 'unprotected': return LIMIT_PHRASES[marker.reason!] + ' on ' + marker.requested + ' · no fallback rule covers this conversation';
    case 'recovered': return 'back on ' + marker.requested;
    case 'routed': return 'via ' + marker.actual + ' · fallback for ' + marker.requested;
  }
}

/**
 * Turns gateway route notices into calm UI state: one marker per turn and kind, one coalesced toast,
 * a live route per scope and the recovery offers of the main conversation.
 */
export class RouteTracker {
  main?: RouteView;
  readonly agents: Record<string, RouteView> = {};
  offers: RouteOffer[] = [];
  toast?: RouteToast;
  private turn = NO_TURN;
  private readonly markers = new Map<string, RouteMarker>();
  private readonly providers = new Map<string, string>();

  constructor(private readonly rules: FallbackRule[] = []) {}

  /** A new user prompt ends the previous turn's retry offers; cooldown offers stay while the cooldown runs. */
  startTurn(turn: string) {
    this.turn = turn;
    this.offers = this.offers.filter(offer => offer.action === 'back' || offer.action === 'pin');
  }

  /** Tracks the routed model per scope and returns the turn's route badge when a cooldown reroutes a new main turn. */
  observeRequest(request: RoutedRequest): RouteMarker | undefined {
    if (request.requested === request.actual) this.providers.set(request.actual, request.provider);
    const previous = this.viewOf(request.agent);
    const keepsCooldown = previous?.cooldownUntil && previous.actual === request.actual && previous.requested === request.requested;
    const view = keepsCooldown ? previous : { requested: request.requested, actual: request.actual, provider: request.provider };
    if (request.agent) { this.agents[request.agent] = view; return; }
    if (request.requestClass !== 'main') return;
    this.main = view;
    if (request.event === 'request' && request.requested !== request.actual) return this.badge(request);
  }

  private badge(request: RoutedRequest): RouteMarker | undefined {
    const prefix = 'route:' + this.turn + ':main:';
    if (this.markers.has(prefix + 'switched') || this.markers.has(prefix + 'routed')) return;
    const draft = { id: prefix + 'routed', kind: 'routed' as const, requested: request.requested, actual: request.actual,
      provider: request.provider, at: Date.now(), count: 1 };
    const marker = { ...draft, text: markerText(draft) };
    this.markers.set(marker.id, marker);
    return marker;
  }

  /** Records the notice and returns the transcript marker it created or updated, if any. */
  apply(notice: RouteNotice): RouteMarker | undefined {
    this.updateView(notice);
    if (!notice.scope.agent) this.updateOffers(notice);
    if (notice.kind === 'recovered' && notice.cause === 'superseded') return;
    this.raiseToast(notice);
    return this.mark(notice);
  }

  private viewOf(agent: string | undefined) { return agent ? this.agents[agent] : this.main; }

  private updateView(notice: RouteNotice) {
    const agent = notice.scope.agent;
    const view = notice.kind === 'switched'
      ? { requested: notice.requested, actual: notice.actual, provider: notice.provider, reason: notice.reason, cooldownUntil: notice.cooldownUntil }
      : notice.kind === 'recovered'
        ? { requested: notice.requested, actual: notice.requested, provider: this.providers.get(notice.requested) ?? '' }
        : undefined;
    if (!view) return;
    if (agent) this.agents[agent] = view; else this.main = view;
  }

  private updateOffers(notice: RouteNotice) {
    const session = notice.scope.session;
    if (notice.kind === 'switched')
      this.offers = [{ action: 'back', session, requested: notice.requested }, { action: 'pin', model: notice.actual }];
    else if (notice.kind === 'recovered') this.offers = [];
    else if (notice.kind === 'interrupted')
      this.offers = [{ action: 'retry', session, requested: notice.requested, target: this.nextTarget(notice.requested, notice.actual) },
        ...this.offers.filter(offer => offer.action !== 'retry')];
    else if (notice.kind === 'exhausted') this.offers = [{ action: 'retry', session, requested: notice.requested }];
    else if (notice.kind === 'unprotected') this.offers = [{ action: 'setup' }];
  }

  /** The chain entry after the model that failed; undefined retries on the same route. */
  private nextTarget(requested: string, failed: string): string | undefined {
    const rule = this.rules.find(candidate => candidate.enabled && candidate.from === requested && candidate.scopes.includes('main'));
    if (!rule) return;
    const position = [rule.from, ...rule.targets].indexOf(failed);
    return position < 0 ? undefined : rule.targets[position];
  }

  private raiseToast(notice: RouteNotice) {
    const marker = this.draft(notice, 1);
    const key = notice.kind + ':' + scopeKey(notice.scope) + ':' + notice.requested + ':' + (marker.actual ?? '');
    const repeated = this.toast?.key === key && notice.at - this.toast.at < TOAST_COALESCE_MS;
    const count = repeated ? this.toast!.count + 1 : 1;
    this.toast = { key, text: markerText({ ...marker, count }), tone: toneOf(notice), count, at: notice.at };
  }

  private mark(notice: RouteNotice): RouteMarker {
    const id = 'route:' + this.turn + ':' + scopeKey(notice.scope) + ':' + notice.kind;
    const marker = this.draft(notice, (this.markers.get(id)?.count ?? 0) + 1, id);
    const complete = { ...marker, text: markerText(marker) };
    this.markers.set(id, complete);
    return complete;
  }

  private draft(notice: RouteNotice, count: number, id = ''): Omit<RouteMarker, 'text'> {
    return { id, kind: notice.kind, requested: notice.requested, at: notice.at, count, ...(notice.scope.agent ? { agent: notice.scope.agent } : {}),
      ...('actual' in notice ? { actual: notice.actual } : {}), ...('provider' in notice ? { provider: notice.provider } : {}),
      ...('reason' in notice ? { reason: notice.reason } : {}), ...('cooldownUntil' in notice ? { cooldownUntil: notice.cooldownUntil } : {}),
      ...('chain' in notice ? { chain: notice.chain } : {}) };
  }
}

function scopeKey(scope: RouteScope): string { return scope.agent ?? 'main'; }

function toneOf(notice: RouteNotice): RouteToast['tone'] {
  if (notice.kind === 'exhausted' || notice.kind === 'interrupted') return 'error';
  if (notice.kind === 'recovered') return 'info';
  return 'warning';
}

/**
 * Typed routing notices from the gateway's fallback policy to user interfaces.
 * Notices name models, providers, reasons and the attributed conversation/agent only:
 * never credentials, headers, prompts or response bodies.
 */

/** Why a scope runs on another model. `user_retry` marks an explicit user recovery choice. */
export type SwitchReason = 'rate_limit' | 'unavailable' | 'quota_preemption' | 'user_retry';
export type RecoveryCause = 'cooldown_ended' | 'reset' | 'superseded';

/** The conversation a notice belongs to; requests without `agent` belong to the main session. */
export interface RouteScope { session: string; agent?: string }

interface NoticeBase { scope: RouteScope; requested: string; at: number }

export interface SwitchedNotice extends NoticeBase {
  kind: 'switched'; actual: string; provider: string; reason: SwitchReason;
  cooldownUntil: number; retryAfterMs?: number;
}
export interface RecoveredNotice extends NoticeBase { kind: 'recovered'; previous: string; cause: RecoveryCause }
/** Every model of the policy chain failed or was skipped for quota; the turn ended without a reply. */
export interface ExhaustedNotice extends NoticeBase { kind: 'exhausted'; chain: string[]; reason: SwitchReason }
/** Output had started when the upstream failed; the gateway did not and will not replay the request. */
export interface InterruptedNotice extends NoticeBase { kind: 'interrupted'; actual: string; provider: string }
/** An eligible limit or outage hit a scope that has no enabled fallback rule. */
export interface UnprotectedNotice extends NoticeBase {
  kind: 'unprotected'; provider: string; reason: SwitchReason; retryAfterMs?: number;
}

export type RouteNotice = SwitchedNotice | RecoveredNotice | ExhaustedNotice | InterruptedNotice | UnprotectedNotice;
export type RouteNoticeListener = (notice: RouteNotice) => void;

const GATEWAY_REASONS: Record<string, SwitchReason> = {
  rate_limit: 'rate_limit', unavailable: 'unavailable', quota_near_limit: 'quota_preemption', user_retry: 'user_retry',
};

/** Maps the gateway's internal failure label (`quota_near_limit` & co) to the public reason. */
export function switchReason(gatewayReason: string): SwitchReason {
  const reason = GATEWAY_REASONS[gatewayReason];
  if (!reason) throw new Error('Unknown fallback reason: ' + gatewayReason);
  return reason;
}

export class RouteNoticeBus {
  private readonly listeners = new Set<RouteNoticeListener>();
  subscribe = (listener: RouteNoticeListener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  publish(notice: RouteNotice) {
    for (const listener of this.listeners) listener(structuredClone(notice));
  }
}

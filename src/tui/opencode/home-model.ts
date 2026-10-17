// Pure logic of the home screen overview: which providers are usable, and which saved sessions to offer.
import type { SessionInfo } from './sessions-model';

/**
 * `needsSignIn` only when every model of the provider reports missing or expired credentials; providers whose sign-in
 * another program owns (Claude Code for Claude) report `unknown` and count as usable.
 */
export interface ProviderSummary { provider: string; needsSignIn: boolean }

interface ModelAuth { provider: string; auth?: string }

const FIRST_CLASS_ORDER = ['anthropic', 'chatgpt', 'zai'];
const MISSING_CREDENTIALS = new Set(['missing', 'expired']);
export const RECENT_SESSION_LIMIT = 3;

/** One entry per provider in the model catalog, first-class providers first, then the rest alphabetically. */
export function providerSummaries(models: ModelAuth[]): ProviderSummary[] {
  const byProvider = new Map<string, ModelAuth[]>();
  for (const model of models) byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  return [...byProvider]
    .map(([provider, members]) => ({ provider, needsSignIn: members.every(needsSignIn) }))
    .sort((left, right) => providerRank(left.provider) - providerRank(right.provider) || left.provider.localeCompare(right.provider));
}

/** The most recently used sessions other than the open one. */
export function recentSessions(sessions: SessionInfo[], currentId: string | undefined, limit = RECENT_SESSION_LIMIT): SessionInfo[] {
  return sessions.filter(session => session.sessionId !== currentId)
    .sort((left, right) => right.lastModified - left.lastModified)
    .slice(0, limit);
}

function needsSignIn(model: ModelAuth): boolean {
  return MISSING_CREDENTIALS.has(model.auth ?? '');
}

function providerRank(provider: string): number {
  const rank = FIRST_CLASS_ORDER.indexOf(provider);
  return rank < 0 ? FIRST_CLASS_ORDER.length : rank;
}

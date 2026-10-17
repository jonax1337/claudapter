// Pure logic of the session picker: titles, recency groups, relative times, search and reference lookup.
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { rankItems, type ListGroup } from './list-model';

export type SessionInfo = SDKSessionInfo;
export const SESSION_GROUP_LABELS = ['Today', 'Yesterday', 'This week', 'Older'] as const;
type SessionGroupLabel = typeof SESSION_GROUP_LABELS[number];

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;
const MIN_ID_PREFIX_QUERY = 2;
const KIB = 1024;

/** Display title: the user's title, else the generated summary, else the first prompt. */
export function sessionTitle(session: SessionInfo): string {
  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);
  return title.replace(/\s+/g, ' ').trim();
}

/** Compact age such as `12m ago`; timestamps in the future count as just now. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return Math.floor(elapsed / MINUTE_MS) + 'm ago';
  if (elapsed < DAY_MS) return Math.floor(elapsed / HOUR_MS) + 'h ago';
  const days = Math.floor(elapsed / DAY_MS);
  if (days < WEEK_DAYS) return days + 'd ago';
  if (days < MONTH_DAYS) return Math.floor(days / WEEK_DAYS) + 'w ago';
  if (days < YEAR_DAYS) return Math.floor(days / MONTH_DAYS) + 'mo ago';
  return Math.floor(days / YEAR_DAYS) + 'y ago';
}

/** Recency bucket by local calendar day, so "Yesterday" starts at midnight rather than 24 hours back. */
export function sessionGroup(timestamp: number, now: number = Date.now()): SessionGroupLabel {
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return days < WEEK_DAYS ? 'This week' : 'Older';
}

/** Non-empty recency groups, newest session first inside each. */
export function groupSessions(sessions: SessionInfo[], now: number = Date.now()): ListGroup<SessionInfo>[] {
  const newestFirst = [...sessions].sort((left, right) => right.lastModified - left.lastModified);
  return SESSION_GROUP_LABELS
    .map(label => ({ label, items: newestFirst.filter(session => sessionGroup(session.lastModified, now) === label) }))
    .filter(group => group.items.length > 0);
}

/** Sessions best match first over title, first prompt, branch, tag and id prefix. */
export function searchSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const needle = query.trim().toLowerCase();
  const newestFirst = [...sessions].sort((left, right) => right.lastModified - left.lastModified);
  return rankItems(newestFirst, query, session => [
    [sessionTitle(session), 3],
    [session.gitBranch, 2],
    [session.tag, 2],
    [session.firstPrompt, 1],
    [needle.length >= MIN_ID_PREFIX_QUERY && session.sessionId.startsWith(needle) ? needle : undefined, 4],
  ]);
}

/** Looks a session up by full id, unique id prefix or unique title prefix; throws a descriptive error otherwise. */
export function resolveSession(sessions: SessionInfo[], reference: string): SessionInfo {
  const wanted = reference.trim().toLowerCase();
  const exact = sessions.find(session => session.sessionId === wanted);
  if (exact) return exact;
  const byId = sessions.filter(session => session.sessionId.startsWith(wanted));
  const matches = byId.length ? byId : sessions.filter(session => sessionTitle(session).toLowerCase().startsWith(wanted));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error('No saved session matches "' + reference.trim() + '".');
  throw new Error(matches.length + ' saved sessions match "' + reference.trim() + '"; use more characters of the title or id.');
}

/** The most recently modified session other than the one that is open. */
export function latestOtherSession(sessions: SessionInfo[], currentId: string | undefined): SessionInfo {
  const latest = [...sessions].filter(session => session.sessionId !== currentId)
    .sort((left, right) => right.lastModified - left.lastModified)[0];
  if (!latest) throw new Error('No other saved session in this directory.');
  return latest;
}

export function formatSize(bytes: number): string {
  if (bytes < KIB) return bytes + ' B';
  if (bytes < KIB * KIB) return Math.round(bytes / KIB) + ' KB';
  return (bytes / (KIB * KIB)).toFixed(1) + ' MB';
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

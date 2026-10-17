import { validateConfig, type Config, type FallbackRule } from './config.js';
import { assertCompatible } from './fallback.js';
import type { Model } from './models.js';

/** A ready-made fallback chain for the guided setup; nothing is saved until the user confirms. */
export interface FallbackPreset { id: string; title: string; rule: FallbackRule; warnings: string[] }

const MAX_TARGETS = 3;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Assumed primary window when its context is not reported: a long Claude conversation. */
const PRIMARY_PROBE_CONTEXT = 200_000;
/** Claude Code reserves this much output on ordinary turns. */
const PROBE_OUTPUT_TOKENS = 32_000;
/** Moves on to the next target at once; quota pre-emption avoids most limit hits anyway. */
const PRESET_DEFAULTS = { enabled: true, scopes: ['main'], errors: ['rate_limit', 'unavailable'] as FallbackRule['errors'],
  retries: 0, timeoutMs: 60_000, cooldownMs: 5 * MINUTE_MS };
const PROVIDER_ORDER = ['chatgpt'];

/**
 * Presets for `primary` built only from authenticated models of other providers:
 * one single-target chain per provider, then the combined chain when several providers are signed in.
 */
export function fallbackPresets(models: Model[], primary: string): FallbackPreset[] {
  const from = models.find(model => model.id === primary);
  if (!from) return [];
  const targets = bestTargetPerProvider(models, from);
  const chains = targets.map(target => [target]);
  if (targets.length > 1) chains.push(targets.slice(0, MAX_TARGETS));
  return chains.map(chain => preset(from, chain));
}

function bestTargetPerProvider(models: Model[], from: Model): Model[] {
  const best = new Map<string, Model>();
  for (const model of models)
    if (model.auth === 'authenticated' && model.provider !== from.provider && !best.has(model.provider)) best.set(model.provider, model);
  return [...best.values()].sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || a.provider.localeCompare(b.provider));
}

function providerRank(provider: string): number {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index < 0 ? PROVIDER_ORDER.length : index;
}

function preset(from: Model, chain: Model[]): FallbackPreset {
  const rule: FallbackRule = { ...PRESET_DEFAULTS, scopes: [...PRESET_DEFAULTS.scopes], errors: [...PRESET_DEFAULTS.errors],
    from: from.id, targets: chain.map(model => model.id) };
  return { id: rule.targets.join('+'), title: [from.id, ...rule.targets].join(' → '), rule,
    warnings: chain.flatMap(target => capabilityWarnings(from, target)) };
}

/** What the gateway's own compatibility check would refuse for this target, probed with typical turns. */
export function capabilityWarnings(from: Model, target: Model): string[] {
  const probes = [
    { name: 'tools', body: { tools: [{ name: 'probe' }], messages: [] } },
    { name: 'images', body: { messages: [{ role: 'user', content: [{ type: 'image' }] }] } },
    { name: 'context', body: { messages: [{ role: 'user', content: 'x'.repeat(from.context ?? PRIMARY_PROBE_CONTEXT) }], max_tokens: PROBE_OUTPUT_TOKENS } },
  ];
  return probes.flatMap(probe => {
    try { assertCompatible(probe.body, target); return []; }
    catch (error) { return [target.id + ' · ' + probe.name + ': ' + (error as Error).message]; }
  });
}

/**
 * The saved rule list with `rule` replacing any rule for the same model and scopes.
 * Throws when a model is unknown, a target is not signed in, or the configuration would be invalid.
 */
export function applyPreset(config: Config, models: Model[], rule: FallbackRule): FallbackRule[] {
  for (const id of [rule.from, ...rule.targets]) if (!models.some(model => model.id === id)) throw new Error('Unknown model in fallback chain: ' + id);
  const unauthenticated = rule.targets.find(id => models.find(model => model.id === id)!.auth !== 'authenticated');
  if (unauthenticated) throw new Error('Fallback target is not signed in: ' + unauthenticated);
  const overlaps = (other: FallbackRule) => other.from === rule.from && other.scopes.some(scope => rule.scopes.includes(scope));
  return validateConfig({ ...config, fallback: [...config.fallback.filter(other => !overlaps(other)), rule] }).fallback;
}

/** A plain-language dry run of the rule: what happens near the quota limit, on failures and afterwards. */
export function explainRule(rule: FallbackRule, models: Model[], preemptPercent: number): string[] {
  const provider = (id: string) => models.find(model => model.id === id)?.provider ?? 'unknown provider';
  const [first] = rule.targets;
  const errors = rule.errors.map(error => error === 'rate_limit' ? 'a rate limit' : 'an outage').join(' or ');
  const retries = rule.retries ? rule.retries + (rule.retries === 1 ? ' retry' : ' retries') + ' on ' + rule.from + ', then ' : '';
  return [
    'Normal turns use ' + rule.from + '. Nothing changes until a limit is reached.',
    'At ' + preemptPercent + '% of a fresh ' + provider(rule.from) + ' quota window, the next turn starts on ' + first
      + ' without contacting ' + rule.from + ' (quota pre-emption). The last target is always attempted.',
    'On ' + errors + ': ' + retries + rule.targets.join(', then ') + '.',
    'The conversation stays on the replacement for ' + humanDuration(rule.cooldownMs) + ', then returns to ' + rule.from
      + '. You can switch back earlier or pin the replacement.',
    'A reply that already started streaming is never replayed automatically; you decide whether to retry it.',
    'Data routing: this conversation, its system prompt and tool results may be sent to '
      + [...new Set(rule.targets.map(provider))].join(', ') + ' (' + rule.scopes.join(', ') + ' scope).',
  ];
}

export function humanDuration(milliseconds: number): string {
  if (milliseconds < MINUTE_MS) return Math.max(1, Math.round(milliseconds / 1000)) + 's';
  if (milliseconds < HOUR_MS) return Math.round(milliseconds / MINUTE_MS) + 'm';
  const hours = Math.floor(milliseconds / HOUR_MS), minutes = Math.round((milliseconds % HOUR_MS) / MINUTE_MS);
  return minutes ? hours + 'h ' + minutes + 'm' : hours + 'h';
}

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { configHome, PROFILE_NAME } from './config.js';
import { CodexAuth, type AuthState } from './auth.js';

/** A profile is a named account slot: its own native Claude home and optionally its own Codex home. */
export interface ProfileRecord { name: string; created: string; codex: boolean }

export const profilesRoot = () => join(configHome(), 'profiles');
export const profileClaudeHome = (name: string) => join(profilesRoot(), name, 'claude');
export const profileCodexHome = (name: string) => join(profilesRoot(), name, 'codex');
/** Provider id for Claude models routed through a profile's account, e.g. `anthropic@work`. */
export const accountProvider = (name: string) => 'anthropic@' + name;
export const isAccountProvider = (provider: string) => provider.startsWith('anthropic@');
export const providerAccount = (provider: string) => provider.slice('anthropic@'.length);

export async function readProfile(name: string): Promise<ProfileRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(join(profilesRoot(), name, 'profile.json'), 'utf8'));
    if (record.name !== name || typeof record.codex !== 'boolean') throw new Error();
    return record;
  } catch (e: any) { if (e.code === 'ENOENT') return; throw new Error('Profile "' + name + '" is damaged; remove and recreate it.'); }
}
export async function requireProfile(name: string): Promise<ProfileRecord> {
  const record = await readProfile(name);
  if (record) return record;
  const existing = (await listProfiles().catch(() => [])).map(p => p.name);
  throw new Error('Unknown profile: ' + name + (existing.length ? '. Available: ' + existing.join(', ') + '.' : '. Create one with `claudapter profile add ' + name + '`.'));
}
export async function listProfiles(): Promise<ProfileRecord[]> {
  const entries = await readdir(profilesRoot(), { withFileTypes: true }).catch(() => []);
  const records: ProfileRecord[] = [];
  for (const entry of entries) if (entry.isDirectory()) { const record = await readProfile(entry.name); if (record) records.push(record); }
  return records;
}
export async function addProfile(name: string, codex: boolean): Promise<ProfileRecord> {
  if (name === 'none' || !PROFILE_NAME.test(name)) throw new Error('Profile names are lowercase slugs of letters, digits and dashes; "none" is reserved.');
  if (await readProfile(name)) throw new Error('Profile "' + name + '" already exists.');
  const record: ProfileRecord = { name, created: new Date().toISOString(), codex };
  await mkdir(profileClaudeHome(name), { recursive: true, mode: 0o700 });
  if (codex) await mkdir(profileCodexHome(name), { recursive: true, mode: 0o700 });
  await writeFile(join(profilesRoot(), name, 'profile.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  return record;
}
export async function removeProfile(name: string): Promise<void> {
  await requireProfile(name);
  await rm(join(profilesRoot(), name), { recursive: true, force: true });
}

/** Points this process and every child (native Claude, Codex readers, gateway) at the profile's homes.
 *  Existing explicit environment homes are a conflict, never silently overwritten. */
export async function activateProfile(name: string): Promise<void> {
  const record = await requireProfile(name);
  const claimedClaude = process.env.CLAUDE_CONFIG_DIR;
  if (claimedClaude && resolve(claimedClaude) !== resolve(profileClaudeHome(name)))
    throw new Error('CLAUDE_CONFIG_DIR is already set to ' + claimedClaude + '. Unset it or start without --profile; Claudapter never switches accounts silently.');
  if (record.codex) {
    const claimedCodex = process.env.CODEX_HOME;
    if (claimedCodex && resolve(claimedCodex) !== resolve(profileCodexHome(name)))
      throw new Error('CODEX_HOME is already set to ' + claimedCodex + '. Unset it, or recreate the profile without its own Codex home.');
    process.env.CODEX_HOME = profileCodexHome(name);
  }
  process.env.CLAUDE_CONFIG_DIR = profileClaudeHome(name);
  process.env.CLAUDAPTER_PROFILE = name;
}

/** Read-only Claude OAuth credentials of a native home; the official CLI alone owns refresh. */
export class ClaudeAccountAuth {
  constructor(readonly home: string) {}
  async accessToken(): Promise<string> {
    let credentials;
    try { credentials = JSON.parse(await readFile(join(this.home, '.credentials.json'), 'utf8')); }
    catch { throw new Error('No Claude login in this home. Run `claudapter profile login` for the profile, or `claude auth login`.'); }
    const oauth = credentials.claudeAiOauth;
    if (!oauth?.accessToken) throw new Error('Claude credentials exist without a usable OAuth token (keyring-only or API-key mode). Log in again through the official CLI.');
    const expiresAt = Date.parse(oauth.expiresAt ?? '');
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000)
      throw new Error('Claude account token expired or of unknown expiry. Refresh with the official CLI; Claudapter never rotates account tokens.');
    return oauth.accessToken;
  }
  async status(): Promise<'authenticated' | 'missing' | 'expired'> {
    try { await this.accessToken(); return 'authenticated'; }
    catch (e) { return (e as Error).message.includes('expired') ? 'expired' : 'missing'; }
  }
}

export interface ProfileOverview { profile: string; default?: true; claude: AuthState; chatgpt: AuthState | 'shared' }
export async function profileOverview(defaultName?: string): Promise<ProfileOverview[]> {
  const overviews: ProfileOverview[] = [];
  for (const record of await listProfiles()) {
    const claude = await new ClaudeAccountAuth(profileClaudeHome(record.name)).status();
    const chatgpt = record.codex ? await new CodexAuth(profileCodexHome(record.name)).status() : 'shared' as const;
    overviews.push({ profile: record.name, ...(defaultName === record.name ? { default: true as const } : {}), claude, chatgpt });
  }
  return overviews;
}

/** `sonnet@work` addresses a Claude model through the named profile's account. */
export function splitAccountModel(id: string): { base: string; profile: string } | undefined {
  const at = id.lastIndexOf('@');
  if (at <= 0) return;
  const profile = id.slice(at + 1);
  return PROFILE_NAME.test(profile) ? { base: id.slice(0, at), profile } : undefined;
}

/** Extracts `--profile <name>` before the first `--` so native arguments keep their own flags. */
export function extractProfileFlag(argv: string[]): { args: string[]; profile?: string } {
  const boundary = argv.indexOf('--');
  const scope = boundary === -1 ? argv : argv.slice(0, boundary);
  const rest = boundary === -1 ? [] : argv.slice(boundary);
  const args: string[] = []; let profile: string | undefined;
  for (let i = 0; i < scope.length; i++) {
    const value = scope[i];
    if (value === '--profile') { const name = scope[i + 1]; if (!name) throw new Error('--profile requires a profile name (or none).'); profile = name; i++; }
    else if (value.startsWith('--profile=')) profile = value.slice(10);
    else args.push(value);
  }
  if (profile !== undefined && profile !== 'none' && !PROFILE_NAME.test(profile))
    throw new Error('Profile names are lowercase slugs of letters, digits and dashes.');
  return { args: [...args, ...rest], profile };
}

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, win32 } from 'node:path';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

export const compatVersions = { sdk: '0.3.301', claude: '2.1.301' } as const;
const require = createRequire(import.meta.url);
const installedSdkVersion: string = JSON.parse(readFileSync(join(dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')).version;
export const compatReadMethods = [
  'getSettings', 'getHooksListing', 'listPermissionRules', 'getMemoryDialog',
  'getSkillsDialog', 'getStatus', 'getSandboxDialog', 'getPlan', 'getChromeDialog', 'getChromeBrowsers',
  'exportConversation', 'getTaskOutput',
] as const;
export const compatMutationMethods = ['setCwd', 'selectChromeBrowser', 'mcpAuthenticate', 'mcpClearAuth',
  'mcpSubmitOAuthCallbackUrl', 'claudeAuthenticate', 'claudeOAuthCallback', 'claudeOAuthWaitForCompletion', 'enableRemoteControl'] as const;
export type CompatMethod = typeof compatReadMethods[number] | typeof compatMutationMethods[number];
const challenges = new WeakMap<object, { path: string; directory: string }>();
const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const plainPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 32768 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const absolutePath = (value: unknown): value is string => plainPath(value) && (posix.isAbsolute(value) || win32.isAbsolute(value)) && !value.startsWith('\\\\') && !value.startsWith('//');
const stringValue = (value: unknown, max = 8192): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
function webUrl(value: unknown): boolean {
  if (!stringValue(value, 16384)) return false;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function mutationArgs(args: unknown, keys: string[]): asserts args is Record<string, unknown> {
  if (!isRecord(args) || args.confirmed !== true || Object.keys(args).some(key => key !== 'confirmed' && !keys.includes(key))) throw new Error('This native operation requires explicit confirmation and valid arguments.');
}

/** Private SDK support is deliberately disabled on every unverified SDK/CLI pair. */
export function assertCompatVersion(claudeVersion: unknown): void {
  if (installedSdkVersion !== compatVersions.sdk || claudeVersion !== compatVersions.claude) {
    throw new Error(`Native dialog compatibility requires SDK ${compatVersions.sdk} and Claude Code ${compatVersions.claude}; installed ${installedSdkVersion} / ${String(claudeVersion ?? 'unknown')}.`);
  }
}

/** Check assertCompatVersion against the installed binary before constructing the query. */
export function launchWorkspaceTrust(directory: string, accepted: boolean): { workspaceTrust?: { accepted: true; directory: string } } {
  if (installedSdkVersion !== compatVersions.sdk) throw new Error('Workspace trust requires the verified Agent SDK version.');
  if (typeof accepted !== 'boolean') throw new Error('Workspace trust requires an explicit user decision.');
  if (!accepted) return {};
  if (!absolutePath(directory)) throw new Error('Workspace trust requires the exact absolute local directory shown to the user.');
  // Native initialize owns canonicalization, policy checks, locking and persistence; never edit .claude.json here.
  return { workspaceTrust: { accepted: true, directory } };
}

function validResult(method: CompatMethod, value: unknown): boolean {
  if (['mcpClearAuth', 'mcpSubmitOAuthCallbackUrl'].includes(method)) return value === undefined || isRecord(value);
  if (method === 'enableRemoteControl' && value === undefined) return true;
  if (!isRecord(value)) return false;
  switch (method) {
    case 'getSettings': return isRecord(value.effective) && Array.isArray(value.sources);
    case 'getHooksListing': return Array.isArray(value.events) && Array.isArray(value.hooks) && isRecord(value.policy);
    case 'listPermissionRules': return isRecord(value.state) && Array.isArray(value.state.rules) && Array.isArray(value.state.workspaceDirectories) && typeof value.state.managedOnly === 'boolean';
    case 'getMemoryDialog': return Array.isArray(value.files) && Array.isArray(value.folders) && isRecord(value.auto_memory) && isRecord(value.auto_dream);
    case 'getSkillsDialog': return Array.isArray(value.skills);
    case 'getStatus': return Array.isArray(value.sections);
    case 'getSandboxDialog': return typeof value.supported === 'boolean' && typeof value.enabled === 'boolean';
    case 'getPlan': return typeof value.exists === 'boolean';
    case 'getChromeDialog': return typeof value.allowed === 'boolean' && typeof value.connected === 'boolean';
    case 'getChromeBrowsers': return Array.isArray(value.browsers) && value.browsers.every((browser: unknown) => isRecord(browser) && stringValue(browser.device_id) && typeof browser.name === 'string' && typeof browser.current === 'boolean');
    case 'selectChromeBrowser': return value.name === undefined || typeof value.name === 'string';
    case 'mcpAuthenticate': return typeof value.requiresUserAction === 'boolean' && typeof value.callbackExpected === 'boolean' && (!value.requiresUserAction || webUrl(value.authUrl));
    case 'claudeAuthenticate': return webUrl(value.manualUrl) && webUrl(value.automaticUrl);
    case 'claudeOAuthCallback': case 'claudeOAuthWaitForCompletion': return isRecord(value.account);
    case 'enableRemoteControl': return webUrl(value.session_url) && webUrl(value.connect_url) && stringValue(value.bridge_session_id);
    case 'exportConversation': return typeof value.text === 'string' && typeof value.default_filename === 'string';
    case 'getTaskOutput': return typeof value.output === 'string' && Number.isSafeInteger(value.total_bytes) && value.total_bytes >= 0 && typeof value.truncated === 'boolean';
    case 'setCwd': return value.status === 'needs_trust' ? absolutePath(value.directory)
      : value.status === 'ok' ? absolutePath(value.cwd) && typeof value.changed === 'boolean'
      : value.status === 'rejected' && typeof value.reason === 'string' && typeof value.message === 'string';
    default: return false;
  }
}

/** Narrow facade: explicit consent for mutations; no arbitrary controls, redirect targets, tokens or paid login modes. */
export async function invokeCompat(query: Query, method: CompatMethod, args?: Record<string, unknown>): Promise<any> {
  if (!(compatReadMethods as readonly string[]).includes(method) && !(compatMutationMethods as readonly string[]).includes(method)) throw new Error('Unsupported native compatibility method.');
  const initialized = await query.initializationResult();
  assertCompatVersion(initialized.claude_code_version);
  const operation = (query as unknown as Record<string, unknown>)[method];
  if (typeof operation !== 'function') throw new Error(`The verified native method ${method} is unavailable.`);
  let result: unknown;
  if (method === 'setCwd') {
    if (!isRecord(args) || !plainPath(args.path) || Object.keys(args).some(key => !['path', 'trustAccepted', 'trustedDirectory', 'confirmed'].includes(key))) throw new Error('Invalid working-directory request.');
    if (args.trustAccepted !== undefined && args.trustAccepted !== true) throw new Error('Only an explicit trust acceptance may be sent.');
    if (args.trustAccepted === true) {
      const challenge = challenges.get(query);
      if (args.confirmed !== true || !challenge || args.path !== challenge.path || args.trustedDirectory !== challenge.directory) throw new Error('Trust acceptance must answer this session\'s exact needs_trust directory after explicit user confirmation.');
      challenges.delete(query);
      result = await operation.call(query, args.path, { trustAccepted: true, trustedDirectory: challenge.directory });
    } else {
      if (args.confirmed !== undefined || args.trustedDirectory !== undefined) throw new Error('Unexpected trust fields.');
      challenges.delete(query);
      result = await operation.call(query, args.path);
    }
    if (isRecord(result) && result.status === 'needs_trust' && absolutePath(result.directory)) challenges.set(query, { path: args.path, directory: result.directory });
  } else if (method === 'selectChromeBrowser') {
    mutationArgs(args, ['deviceId']);
    if (!stringValue(args.deviceId, 512)) throw new Error('Invalid browser device ID.');
    result = await operation.call(query, args.deviceId);
  } else if (method === 'mcpAuthenticate' || method === 'mcpClearAuth') {
    mutationArgs(args, ['serverName']);
    if (!stringValue(args.serverName, 512)) throw new Error('Invalid MCP server name.');
    result = await operation.call(query, args.serverName);
  } else if (method === 'mcpSubmitOAuthCallbackUrl') {
    mutationArgs(args, ['serverName', 'callbackUrl']);
    if (!stringValue(args.serverName, 512) || !webUrl(args.callbackUrl)) throw new Error('Invalid MCP callback input.');
    const url = new URL(args.callbackUrl as string);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.searchParams.has('state') || !(url.searchParams.has('code') || url.searchParams.has('error'))) throw new Error('Paste the complete loopback redirect URL from this MCP sign-in attempt.');
    result = await operation.call(query, args.serverName, args.callbackUrl);
  } else if (method === 'claudeAuthenticate') {
    mutationArgs(args, []);
    result = await operation.call(query, true);
  } else if (method === 'claudeOAuthCallback') {
    mutationArgs(args, ['authorizationCode', 'state']);
    if (!stringValue(args.authorizationCode) || !stringValue(args.state)) throw new Error('Invalid OAuth callback input.');
    result = await operation.call(query, args.authorizationCode, args.state);
  } else if (method === 'claudeOAuthWaitForCompletion') {
    mutationArgs(args, []);
    result = await operation.call(query);
  } else if (method === 'enableRemoteControl') {
    mutationArgs(args, ['enabled', 'name']);
    if (typeof args.enabled !== 'boolean' || args.name !== undefined && !stringValue(args.name, 200)) throw new Error('Invalid Remote Control request.');
    result = await operation.call(query, args.enabled, args.name);
    if (args.enabled && result === undefined) throw new Error('Remote Control did not return a session connection.');
  } else if (method === 'getTaskOutput') {
    if (!isRecord(args) || Object.keys(args).length !== 1 || typeof args.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(args.taskId)) throw new Error('Invalid background task ID.');
    result = await operation.call(query, args.taskId);
  } else {
    if (args !== undefined) throw new Error('This read-only native method accepts no arguments.');
    result = await operation.call(query);
  }
  if (!validResult(method, result)) throw new Error(`Unexpected native ${method} response; compatibility disabled for this operation.`);
  return result;
}

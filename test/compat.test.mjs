import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCompatVersion, launchWorkspaceTrust, invokeCompat, compatReadMethods } from '../dist/tui/compat.js';

const fake = extra => ({ initializationResult: async () => ({ claude_code_version: '2.1.301' }), ...extra });

test('private compatibility rejects unverified engine versions and unknown methods before dispatch', async () => {
  assert.doesNotThrow(() => assertCompatVersion('2.1.301'));
  for (const version of ['2.1.300', '2.1.302', undefined]) assert.throws(() => assertCompatVersion(version), /requires/);
  let called = false;
  await assert.rejects(invokeCompat(fake({ request() { called = true; } }), 'request'), /Unsupported/);
  await assert.rejects(invokeCompat(fake({ initializationResult: async () => ({ claude_code_version: '2.1.302' }), getSettings() { called = true; } }), 'getSettings'), /requires/);
  assert.equal(called, false);
});

test('read-only native getters preserve exact data and reject malformed payloads', async () => {
  const result = { effective: { permissions: { deny: ['Bash(blocked)'] } }, sources: [], applied: { model: 'fixture' } };
  assert.equal(await invokeCompat(fake({ getSettings: async () => result }), 'getSettings'), result);
  await assert.rejects(invokeCompat(fake({ getSettings: async () => ({}) }), 'getSettings'), /Unexpected native/);
  await assert.rejects(invokeCompat(fake({ getSettings: async () => result }), 'getSettings', { mutate: true }), /no arguments/);
  await assert.rejects(invokeCompat(fake({}), 'getHooksListing'), /unavailable/);
  assert.ok(compatReadMethods.includes('getMemoryDialog'));
  assert.ok(!compatReadMethods.includes('request'));
});

test('launch trust requires a deliberate decision and never rewrites native files itself', () => {
  assert.deepEqual(launchWorkspaceTrust('C:/fixture', false), {});
  assert.deepEqual(launchWorkspaceTrust('C:/fixture', true), { workspaceTrust: { accepted: true, directory: 'C:/fixture' } });
  assert.throws(() => launchWorkspaceTrust('relative', true), /absolute/);
  assert.throws(() => launchWorkspaceTrust('C:/fixture\u001b', true), /absolute/);
  assert.throws(() => launchWorkspaceTrust('\\\\server\\share', true), /absolute/);
  assert.throws(() => launchWorkspaceTrust('C:/fixture', undefined), /explicit/);
});

test('native directory trust answers only the exact challenge and cannot be replayed', async () => {
  const calls = [];
  const q = fake({ setCwd: async (path, consent) => {
    calls.push({ path, consent });
    return consent ? { status: 'ok', cwd: 'C:/canonical', changed: true } : { status: 'needs_trust', directory: 'C:/canonical', trust_root: 'C:/canonical' };
  } });
  const consent = { path: 'C:/alias', trustAccepted: true, trustedDirectory: 'C:/canonical', confirmed: true };
  await assert.rejects(invokeCompat(q, 'setCwd', consent), /exact needs_trust/);
  assert.equal(calls.length, 0);
  assert.equal((await invokeCompat(q, 'setCwd', { path: 'C:/alias' })).status, 'needs_trust');
  await assert.rejects(invokeCompat(q, 'setCwd', { ...consent, trustedDirectory: 'C:/other' }), /exact needs_trust/);
  await assert.rejects(invokeCompat(q, 'setCwd', { ...consent, confirmed: false }), /exact needs_trust/);
  assert.equal((await invokeCompat(q, 'setCwd', consent)).status, 'ok');
  assert.deepEqual(calls[1], { path: 'C:/alias', consent: { trustAccepted: true, trustedDirectory: 'C:/canonical' } });
  await assert.rejects(invokeCompat(q, 'setCwd', consent), /exact needs_trust/);
});

test('task output uses a scoped ID and retains truncation metadata', async () => {
  const q = fake({ getTaskOutput: async taskId => ({ output: taskId, total_bytes: 123, truncated: true }) });
  assert.deepEqual(await invokeCompat(q, 'getTaskOutput', { taskId: 'task_123' }), { output: 'task_123', total_bytes: 123, truncated: true });
  await assert.rejects(invokeCompat(q, 'getTaskOutput', { taskId: '../other' }), /Invalid/);
});

test('native authentication requires explicit consent and cannot select paid login or redirects', async () => {
  const calls = [];
  const q = fake({ claudeAuthenticate: async paid => { calls.push(paid); return { manualUrl: 'https://claude.ai/oauth/authorize', automaticUrl: 'https://claude.ai/oauth/authorize' }; },
    mcpAuthenticate: async server => ({ requiresUserAction: true, callbackExpected: true, authUrl: 'https://fixture.example/auth', server }) });
  await assert.rejects(invokeCompat(q, 'claudeAuthenticate'), /confirmation/);
  await assert.rejects(invokeCompat(q, 'claudeAuthenticate', { confirmed: true, loginWithClaudeAi: false }), /valid arguments/);
  await invokeCompat(q, 'claudeAuthenticate', { confirmed: true });
  assert.deepEqual(calls, [true]);
  await assert.rejects(invokeCompat(q, 'mcpAuthenticate', { confirmed: true, serverName: 'fixture', redirectUri: 'https://external.example' }), /valid arguments/);
  assert.equal((await invokeCompat(q, 'mcpAuthenticate', { confirmed: true, serverName: 'fixture' })).callbackExpected, true);
});

test('OAuth callbacks validate inputs without disclosing their contents in errors', async () => {
  const calls = [];
  const q = fake({ mcpSubmitOAuthCallbackUrl: async (...args) => { calls.push(args); }, claudeOAuthCallback: async () => ({ account: {} }) });
  const args = { confirmed: true, serverName: 'fixture', callbackUrl: 'http://localhost:1234/callback?code=fixture-secret&state=fixture-state' };
  await invokeCompat(q, 'mcpSubmitOAuthCallbackUrl', args);
  assert.deepEqual(calls[0], ['fixture', args.callbackUrl]);
  await assert.rejects(invokeCompat(q, 'mcpSubmitOAuthCallbackUrl', { ...args, callbackUrl: 'https://external.example/callback?code=fixture-secret&state=s' }), error => !error.message.includes('fixture-secret'));
  await assert.rejects(invokeCompat(q, 'claudeOAuthCallback', { confirmed: true, authorizationCode: 'fixture-secret\n', state: 'state' }), error => !error.message.includes('fixture-secret'));
});

test('browser selection and Remote Control do not activate without explicit confirmation', async () => {
  const calls = [];
  const q = fake({ getChromeBrowsers: async () => ({ browsers: [{ device_id: 'fixture', name: 'Fixture browser', current: true }] }),
    selectChromeBrowser: async id => { calls.push(['browser', id]); return { name: 'Fixture browser' }; },
    enableRemoteControl: async enabled => { calls.push(['remote', enabled]); return enabled ? { session_url: 'https://claude.ai/code/s', connect_url: 'https://claude.ai/code/connect', bridge_session_id: 'fixture' } : undefined; } });
  assert.equal((await invokeCompat(q, 'getChromeBrowsers')).browsers[0].current, true);
  await assert.rejects(invokeCompat(q, 'selectChromeBrowser', { deviceId: 'fixture' }), /confirmation/);
  await assert.rejects(invokeCompat(q, 'enableRemoteControl', { enabled: true }), /confirmation/);
  await invokeCompat(q, 'selectChromeBrowser', { confirmed: true, deviceId: 'fixture' });
  await invokeCompat(q, 'enableRemoteControl', { confirmed: true, enabled: false });
  await invokeCompat(q, 'enableRemoteControl', { confirmed: true, enabled: true, name: 'Fixture' });
  assert.deepEqual(calls, [['browser', 'fixture'], ['remote', false], ['remote', true]]);
});

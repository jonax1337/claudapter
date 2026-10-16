import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { launchWorkspaceTrust, assertCompatVersion, invokeCompat } from '../dist/tui/compat.js';

test('native home-directory consent remains usable in its original query without persistent trust',
  { skip: !process.env.CLAUDAPTER_NATIVE_TEST, timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'claudapter-home-trust-'));
    const home = join(root, 'Home With Spaces'), config = join(home, '.claude');
    await mkdir(config, { recursive: true });
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const cwd = await realpath(home);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ANTHROPIC_|CLAUDE_|CODEX_|CLAUDAPTER_|OPENAI_)/.test(key)));
    Object.assign(env, { HOME: cwd, USERPROFILE: cwd, CLAUDE_CONFIG_DIR: config,
      APPDATA: join(cwd, 'AppData', 'Roaming'), LOCALAPPDATA: join(cwd, 'AppData', 'Local'),
      ANTHROPIC_API_KEY: 'fixture-only-not-a-real-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const q = query({ prompt: (async function* () { await held; })(), options: {
      cwd, env, pathToClaudeCodeExecutable: process.env.CLAUDAPTER_NATIVE_TEST === '1' ? 'claude' : process.env.CLAUDAPTER_NATIVE_TEST,
      settingSources: [], plugins: [], mcpServers: {}, strictMcpConfig: true, persistSession: false,
      ...launchWorkspaceTrust(cwd, true),
    } });
    try {
      const initialized = await q.initializationResult();
      assertCompatVersion(initialized.claude_code_version);
      assert.equal(initialized.workspace_trust_recorded, false, 'Home trust must not be reported as durable.');
      const status = await invokeCompat(q, 'getStatus');
      assert.ok(status.sections.some(section => section.rows.some(row => row.label === 'cwd' && row.value === cwd)));
      assert.ok((await q.getContextUsage({ detail: 'summary' })).maxTokens > 0, 'The consenting query must remain usable.');
      const native = JSON.parse(await readFile(join(config, '.claude.json'), 'utf8'));
      const accepted = Object.entries(native.projects ?? {}).filter(([, value]) => value?.hasTrustDialogAccepted === true);
      assert.deepEqual(accepted, [], 'No persistent home or ancestor trust should be created.');
    } finally { release(); q.close(); }
  });

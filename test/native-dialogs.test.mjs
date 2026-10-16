import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDialogKinds, describeNativeDialog } from '../dist/tui/native-dialogs.js';

const fixtures = {
  refusal_fallback_prompt: { originalModel: 'claude', fallbackModel: 'gpt', guidanceText: 'Rewrite your request.' },
  fable_overage_consent_prompt: { overagesEnabled: true, balanceCents: 250, currency: 'USD' },
  goal_proposal: { condition: 'All tests pass' },
  chrome_install_upsell: {},
  chrome_install_setup: { phase: 'stalled', installPageOpened: true },
  remote_callout: {},
  it2_setup: { tmuxAvailable: false },
  left_arrow_confirm: { summary: 'Leave?', carryOverCount: 1, monitorParkCount: 0, workflowAgents: { running: 1, finished: 2, rerun: 0 } },
  lsp_recommendation: { pluginName: 'typescript', marketplaceName: 'fixture', fileExtension: '.ts' },
  plugin_hint: { pluginName: 'formatter', marketplaceName: 'fixture', sourceCommand: 'format' },
  sandbox_network_access: { host: 'example.com', port: 443 },
  auto_mode_setup_review: { environment: [], allow: ['Read'], soft_deny: [], hard_deny: ['Bash(rm *)'], remove_from_permissions_allow: ['Bash(*)'], notes: [], mode: 'replace' },
  auto_mode_flagged_allow: { flagged: ['Bash(*)'], runId: 'fixture' },
  device_mcp_consent: { v: 1, machine_name: 'fixture', reconsent: false, servers: [{ name: 'fixture', scope: 'local', transport: 'stdio', tool_count: 1, tool_names: ['read'], tool_names_truncated: false }] },
  unattended_serving_consent: { machineName: 'fixture', title: 'Enable?', body: 'Serve while away.', detail: 'Other devices can connect.', terms: 'Explicit consent required.', version: 1 },
};

test('every declared native dialog has a verified mapping and a declining default', () => {
  assert.deepEqual([...nativeDialogKinds].sort(), Object.keys(fixtures).sort());
  for (const dialogKind of nativeDialogKinds) {
    const d = describeNativeDialog({ dialogKind, payload: fixtures[dialogKind] });
    assert.ok(d?.title && d.description, dialogKind);
    assert.equal(d.defaultIndex, 0, dialogKind);
    const result = d.choices[d.defaultIndex].result;
    assert.ok(['cancelled', 'not_now', 'dismiss', 'skip', 'stay', 'no', 'decline'].includes(result)
      || result?.approved === false || result?.allow === false, dialogKind);
  }
});

test('unknown, native JSX and malformed dialog payloads fail closed', () => {
  for (const dialogKind of ['unknown', '', 'local_jsx', 'computer_use_approval', 'permission_prompt']) {
    assert.equal(describeNativeDialog({ dialogKind, payload: {} }), undefined);
    assert.ok(!nativeDialogKinds.includes(dialogKind));
  }
  for (const dialogKind of nativeDialogKinds.filter(k => !['chrome_install_upsell', 'remote_callout'].includes(k))) {
    assert.equal(describeNativeDialog({ dialogKind, payload: {} }), undefined, dialogKind);
  }
  assert.equal(describeNativeDialog({ dialogKind: 'sandbox_network_access', payload: { host: 'example.com', port: 65536 } }), undefined);
  assert.equal(describeNativeDialog({ dialogKind: 'goal_proposal', payload: null }), undefined);
});

test('consent explains charges and network approval never persists implicitly', () => {
  const overage = describeNativeDialog({ dialogKind: 'fable_overage_consent_prompt', payload: fixtures.fable_overage_consent_prompt });
  assert.match(overage.description, /charges/);
  assert.match(overage.description, /2\.50 USD/);
  assert.equal(overage.choices.at(-1).result, 'consent');
  const network = describeNativeDialog({ dialogKind: 'sandbox_network_access', payload: fixtures.sandbox_network_access });
  assert.deepEqual(network.choices.at(-1).result, { allow: true, persistToSettings: false });
});

test('sensitive consent descriptions retain all rules, tool names and terms', () => {
  const auto = describeNativeDialog({ dialogKind: 'auto_mode_setup_review', payload: fixtures.auto_mode_setup_review });
  assert.match(auto.description, /hard_deny:\n  Bash\(rm \*\)/);
  assert.match(auto.description, /remove_from_permissions_allow:\n  Bash\(\*\)/);
  const serving = describeNativeDialog({ dialogKind: 'unattended_serving_consent', payload: fixtures.unattended_serving_consent });
  assert.match(serving.description, /Explicit consent required/);
  const mcp = describeNativeDialog({ dialogKind: 'device_mcp_consent', payload: fixtures.device_mcp_consent });
  assert.match(mcp.description, /1 tools: read/);
});

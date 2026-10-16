export interface NativeDialogDescription {
  title: string;
  description: string;
  choices: { label: string; result: unknown }[];
  fields?: { key: string; label: string; type: 'text' | 'boolean' | 'number' | 'json'; required?: boolean }[];
  defaultIndex: number;
}

// These internal schemas were checked against Claude Code 2.1.301; reject unfamiliar payloads.
export const nativeDialogKinds = [
  'refusal_fallback_prompt', 'fable_overage_consent_prompt', 'goal_proposal',
  'chrome_install_upsell', 'chrome_install_setup', 'remote_callout', 'it2_setup',
  'left_arrow_confirm', 'lsp_recommendation', 'plugin_hint', 'sandbox_network_access',
  'auto_mode_setup_review', 'auto_mode_flagged_allow', 'device_mcp_consent',
  'unattended_serving_consent',
];

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const choice = (label: string, result: unknown) => ({ label, result });
function dialog(title: string, description: string, choices: NativeDialogDescription['choices']): NativeDialogDescription {
  return { title, description, choices, defaultIndex: 0 };
}

export function describeNativeDialog(request: { dialogKind: string; payload: Record<string, unknown> }): NativeDialogDescription | undefined {
  const p = request.payload;
  if (!record(p)) return undefined;
  const cancel = choice('Cancel', 'cancelled');
  switch (request.dialogKind) {
    case 'refusal_fallback_prompt':
      if (!text(p.originalModel) || !text(p.fallbackModel)) return undefined;
      return dialog('Model response needs your decision',
        `${p.originalModel} declined the request. Proposed alternative: ${p.fallbackModel}.\n${typeof p.guidanceText === 'string' ? p.guidanceText : 'Edit your request or cancel.'}`,
        [cancel, choice('Edit my request', 'edit_prompt'), choice(`Explicitly retry with ${p.fallbackModel}`, 'retry_fallback')]);
    case 'fable_overage_consent_prompt':
      if (typeof p.overagesEnabled !== 'boolean') return undefined;
      return dialog('Usage credit consent',
        `${text(p.modelName) ? p.modelName : text(p.model) ? p.model : 'This model'} may require paid usage credits. Approval can incur charges.\nUsage credits enabled: ${p.overagesEnabled ? 'yes' : 'no'}.${typeof p.balanceCents === 'number' && Number.isFinite(p.balanceCents) ? `\nReported balance: ${(p.balanceCents / 100).toFixed(2)} ${text(p.currency) ? p.currency : '(currency unavailable)'}.` : ''}`,
        [cancel, choice('Switch to the default model', 'switch_default'), choice('I explicitly consent to usage-credit charges', 'consent')]);
    case 'goal_proposal':
      if (!text(p.condition)) return undefined;
      return dialog('Continue until this goal is complete?', p.condition,
        [choice('Decline', { approved: false }), choice('Approve this goal', { approved: true, explicit: true })]);
    case 'chrome_install_upsell':
      return dialog('Claude in Chrome', 'Install the browser extension and connect it to this session?',
        [choice('Not now', 'not_now'), choice('Open extension installation', 'install'), choice('Do not ask again', 'dont_ask_again')]);
    case 'chrome_install_setup':
      if (!['waiting_install', 'connecting', 'stalled', 'connected', 'failed'].includes(String(p.phase)) || typeof p.installPageOpened !== 'boolean') return undefined;
      return dialog('Browser connection', `State: ${p.phase}. Installation page opened: ${p.installPageOpened ? 'yes' : 'no'}.`,
        [choice('Skip', 'skip'), choice('Continue', 'continue'), choice('Keep waiting', 'keep_waiting')]);
    case 'remote_callout':
      return dialog('Remote Control', 'Make this session accessible through Claude Remote Control?',
        [choice('Dismiss', 'dismiss'), choice('Enable Remote Control', 'enable')]);
    case 'it2_setup':
      if (typeof p.tmuxAvailable !== 'boolean') return undefined;
      return dialog('Terminal integration', 'Confirm an existing terminal setup. Claudapter does not install terminal software from this dialog.',
        [cancel, choice('I have installed iTerm2 integration', 'installed'), ...(p.tmuxAvailable ? [choice('Use available tmux', 'use-tmux')] : [])]);
    case 'left_arrow_confirm': {
      const agents = p.workflowAgents;
      if (!text(p.summary) || !count(p.carryOverCount) || !count(p.monitorParkCount) || !record(agents) || !['running', 'finished', 'rerun'].every(k => count(agents[k]))) return undefined;
      return dialog('Leave the current session view?', `${p.summary}\nCarry-over tasks: ${p.carryOverCount}; parked monitors: ${p.monitorParkCount}.\nWorkflow agents: ${agents.running} running, ${agents.finished} finished, ${agents.rerun} to rerun.`,
        [choice('Stay here', 'stay'), choice('Confirm transition', 'confirm')]);
    }
    case 'lsp_recommendation':
    case 'plugin_hint':
      if (!text(p.pluginName) || !text(p.marketplaceName) || !text(p[request.dialogKind === 'lsp_recommendation' ? 'fileExtension' : 'sourceCommand'])) return undefined;
      return dialog('Plugin recommendation', `${p.pluginName} from ${p.marketplaceName}\n${typeof p.pluginDescription === 'string' ? p.pluginDescription : ''}\nSource: ${p.fileExtension ?? p.sourceCommand}. Installing a plugin can execute its code.`,
        [choice('Not now', 'no'), choice('Install this plugin', 'yes'), choice('Disable these recommendations', 'disable')]);
    case 'sandbox_network_access':
      if (!text(p.host) || (p.port !== undefined && (!count(p.port) || p.port > 65535))) return undefined;
      return dialog('Sandbox network access', `Allow a connection to ${p.host}${p.port === undefined ? '' : `:${p.port}`}?${text(p.workerName) ? `\nRequested by worker: ${p.workerName}` : ''}\nThis choice does not create a persistent allow rule.`,
        [choice('Deny', { allow: false, persistToSettings: false }), choice('Allow once', { allow: true, persistToSettings: false })]);
    case 'auto_mode_setup_review': {
      const keys = ['environment', 'allow', 'soft_deny', 'hard_deny', 'remove_from_permissions_allow', 'notes'];
      if (!keys.every(k => strings(p[k])) || !['append', 'replace'].includes(String(p.mode))) return undefined;
      return dialog('Review auto-mode settings', `Save mode: ${p.mode}. This changes saved permission classifier settings.\n${keys.map(k => `${k}:\n${(p[k] as string[]).map(v => `  ${v}`).join('\n') || '  (none)'}`).join('\n')}`,
        [choice('Decline changes', 'decline'), choice('Accept these exact settings changes', 'accept')]);
    }
    case 'auto_mode_flagged_allow':
      if (!strings(p.flagged) || !text(p.runId)) return undefined;
      return dialog('Flagged allow rules', `These rules were flagged for review:\n${p.flagged.map(v => `  ${v}`).join('\n')}`,
        [cancel, choice('Remove all listed rules', { toRemove: p.flagged }), choice('Keep all listed rules', { toRemove: [] })]);
    case 'device_mcp_consent': {
      if (p.v !== 1 || !text(p.machine_name) || typeof p.reconsent !== 'boolean' || !Array.isArray(p.servers) || p.servers.length === 0) return undefined;
      const servers = p.servers;
      if (!servers.every(s => record(s) && text(s.name) && ['user', 'local', 'plugin'].includes(String(s.scope)) && ['stdio', 'http', 'sse', 'ws'].includes(String(s.transport)) && count(s.tool_count) && strings(s.tool_names) && typeof s.tool_names_truncated === 'boolean')) return undefined;
      return dialog('Share device MCP tools', `Machine: ${p.machine_name}. ${p.reconsent ? 'Review changed access.' : 'Review new access.'}\n${servers.map(s => `${s.name} [${s.scope}/${s.transport}] — ${s.tool_count} tools: ${s.tool_names.join(', ')}${s.tool_names_truncated ? ' (list truncated)' : ''}`).join('\n')}`,
        [choice('Not now', 'not_now'), choice('Deny', 'deny'), choice('Allow these device tools', 'allow')]);
    }
    case 'unattended_serving_consent':
      if (!['machineName', 'title', 'body', 'detail', 'terms'].every(k => text(p[k])) || !count(p.version)) return undefined;
      return dialog(String(p.title), `Machine: ${p.machineName}\n${p.body}\n${p.detail}\nTerms (version ${p.version}):\n${p.terms}`,
        [choice('Not now', 'not_now'), choice('Decline', 'decline'), choice('Accept these terms and enable unattended serving', 'accept')]);
    default:
      return undefined;
  }
}

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, lstat, mkdtemp, writeFile, rename, link, unlink, rmdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { resolveSettings, HOOK_EVENTS, type Query, type Settings } from '@anthropic-ai/claude-agent-sdk';
import { safeText } from './editor.js';
import { assertCompatVersion, isCompatVersion, invokeCompat, type CompatMethod } from './compat.js';

export type AdminKind = 'status' | 'config' | 'permissions' | 'mcp' | 'plugins' | 'skills' | 'hooks' | 'memory' | 'doctor' | 'auth' | 'keybindings' | 'sandbox';
export interface AdminAction { id: string; label: string; description: string; fields?: {key: string; label: string; secret?: boolean; required?: boolean}[]; confirm?: boolean }
interface ExecOptions { cwd: string; timeout: number; onOutput?: (text: string) => void; signal?: AbortSignal; input?: string; env?: NodeJS.ProcessEnv }
export interface AdminContext {
  query: Query; cwd: string; claudePath: string;
  exec?: (file: string, args: string[], options: ExecOptions) => Promise<{stdout: string; stderr: string}>;
  resolveSettings?: typeof resolveSettings;
  onOutput?: (text: string) => void;
  signal?: AbortSignal;
  keybindings?: Record<string,string>;
  initialSettings?: Record<string,unknown>;
  /** Explicit environment supplied by the host, also used to isolate native integration tests. */
  env?: NodeJS.ProcessEnv;
}
const overlays = new WeakMap<Query,Record<string,any>>();
const field=(key:string,label:string,required=true)=>({key,label,required});
const scopeField=field('scope','Scope: local, project or user (explicit persistent change)');
export const adminActions: Record<AdminKind,AdminAction[]> = {
  status:[],
  config:[{id:'config-session',label:'Change session setting',description:'Apply one supported setting to this session only. No settings file is rewritten.',fields:[field('key','Setting: language, outputStyle, effortLevel or alwaysThinkingEnabled'),field('value','Value (boolean: true/false)')],confirm:true},
    {id:'config-overlay',label:'Apply session JSON settings',description:'Validate and merge a JSON settings object into session flags. Native policy still applies. Gateway/auth overrides, bypass modes and replacing required hooks are blocked.',fields:[field('json','Settings JSON object')],confirm:true}],
  permissions:[{id:'permission-mode',label:'Session permission mode',description:'Use default prompts, plan mode or explicit edit acceptance. Existing policy restrictions remain enforced.',fields:[field('mode','Mode: default, plan or acceptEdits')],confirm:true},
    ...['add','remove'].map(operation=>({id:'permission-'+operation,label:operation==='add'?'Add session rule':'Remove session rule',description:'Session only. File/managed rules are preserved; use the separate saved-rule action to change a file source.',fields:[field('behavior','Behavior: allow, deny or ask'),field('rule','Exact native rule, e.g. Bash(npm test)')],confirm:true})),
    {id:'permission-saved-add',label:'Add saved rule',description:'Use the native settings writer to add one rule in the explicit file scope. Managed policy remains authoritative.',fields:[field('behavior','Behavior: allow, deny or ask'),field('rule','Exact native permission rule'),scopeField],confirm:true},
    {id:'permission-saved-remove',label:'Remove saved rule',description:'Remove the exact editable rule identified by the current listing. Native writer refuses changed, ambiguous or policy-controlled rules.',fields:[field('ruleId','Rule ID from the permissions listing'),scopeField],confirm:true}],
  mcp:[
    {id:'mcp-reconnect',label:'Reconnect server',description:'Reconnect an existing server in the running session.',fields:[field('name','Server name')]},
    {id:'mcp-enable',label:'Enable server',description:'Enable an existing server in the running session.',fields:[field('name','Server name')],confirm:true},
    {id:'mcp-disable',label:'Disable server',description:'Disable an existing server in the running session.',fields:[field('name','Server name')],confirm:true},
    {id:'mcp-list',label:'List saved servers',description:'Read configured server status using the native CLI.'},
    {id:'mcp-login',label:'Sign in to MCP server',description:'Start the official browser OAuth flow for an existing server. This explicitly stores native MCP credentials. Reconnect the server afterward.',fields:[field('name','Server name')],confirm:true},
    {id:'mcp-submit-callback',label:'Complete MCP browser login',description:'Submit the exact browser redirect URL to this session\'s pending MCP OAuth flow.',fields:[field('name','Server name'),{key:'callbackUrl',label:'Browser callback URL',secret:true}],confirm:true},
    {id:'mcp-clear-auth',label:'Clear MCP authentication',description:'Explicitly clear the selected server\'s stored native OAuth credentials.',fields:[field('name','Server name')],confirm:true},
    {id:'mcp-add-http',label:'Add HTTP server',description:'Save one HTTP server at the explicit scope. Restart this session to load it. Credentials in URLs are not accepted.',fields:[field('name','New server name'),field('url','HTTP(S) URL'),scopeField],confirm:true},
    {id:'mcp-add-stdio',label:'Add stdio server',description:'Save a program and JSON argument array at the explicit scope. The program executes when Claude connects; enter only a trusted program. Restart to load it.',fields:[field('name','New server name'),field('command','Executable'),field('args','Arguments as JSON array, e.g. ["server.js"]'),scopeField],confirm:true},
    {id:'mcp-remove',label:'Remove saved server',description:'Remove one server from the explicit scope. The current session may retain its existing connection until restart.',fields:[field('name','Server name'),scopeField],confirm:true},
  ],
  plugins:[
    {id:'plugins-reload',label:'Reload plugins',description:'Refresh the running session. Holds changes if they would invalidate the tool prompt cache.'},
    {id:'plugins-reload-force',label:'Apply held plugin reload',description:'Apply the plugin reload even if its tool changes invalidate the prompt cache.',confirm:true},
    ...['install','uninstall','enable','disable','update'].map(operation=>({id:'plugin-'+operation,label:operation[0].toUpperCase()+operation.slice(1)+' plugin',description:operation==='uninstall'?'Remove the plugin from the chosen scope and preserve its saved data. Reload or restart to apply.':'Change the chosen scope explicitly. Plugin code may execute when loaded. Reload or restart to apply. Command-based installation approvals are not bypassed.',fields:[field('plugin','Plugin name or name@marketplace'),scopeField],confirm:true})),
    {id:'marketplace-list',label:'List marketplaces',description:'Read configured marketplaces.'},
    {id:'marketplace-add',label:'Add marketplace',description:'Save an explicit marketplace source at the chosen scope. This can download repository content.',fields:[field('source','GitHub owner/repo, HTTPS URL or local path'),scopeField],confirm:true},
    {id:'marketplace-remove',label:'Remove marketplace',description:'Remove only the declaration in the explicitly selected scope.',fields:[field('name','Marketplace name'),scopeField],confirm:true},
    {id:'marketplace-update',label:'Update marketplace',description:'Refresh one named marketplace cache. This can download repository content; settings scope is unchanged.',fields:[field('name','Marketplace name')],confirm:true},
  ],
  skills:[{id:'skills-reload',label:'Reload skills',description:'Re-read skill definitions for this session.'},
    {id:'skill-saved-state',label:'Change saved skill state',description:'The native writer changes local settings only, preserves other overrides, and refuses plugin/author/policy-locked skills.',fields:[field('name','Exact skill name'),field('state','State: on, name-only, user-invocable-only or off'),field('scope','Scope: local (the only native writer destination)')],confirm:true}],
  hooks:[{id:'hooks-overlay',label:'Add session hooks',description:'Append explicit hook definitions to session settings, preserving existing hooks. Hooks execute your chosen code; review the exact JSON before confirming.',fields:[field('json','Hooks JSON object keyed by hook event')],confirm:true},
    {id:'hook-saved-add',label:'Add saved hook',description:'Write one hook with native validation at the explicit scope. Review the exact code/URL/prompt; it can execute on the chosen event.',fields:[field('event','Hook event'),field('matcher','Matcher (empty for none)',false),field('hook','Hook JSON object'),scopeField],confirm:true},
    {id:'hook-saved-replace',label:'Replace saved hook',description:'Replace an exact current editable hook using native compare/validation. Omitted HTTP headers keep stored values.',fields:[field('hookId','Hook ID from listing'),field('event','New hook event'),field('matcher','New matcher (empty for none)',false),field('hook','Replacement hook JSON object'),scopeField],confirm:true},
    {id:'hook-saved-remove',label:'Remove saved hook',description:'Remove an exact current editable hook. The native writer detects stale or ambiguous targets.',fields:[field('hookId','Hook ID from listing'),scopeField],confirm:true}],
  memory:[{id:'memory-preview',label:'Preview Markdown file',description:'Read the exact Markdown file you choose, up to 64 KiB, and obtain its edit hash. Nothing is loaded as instructions.',fields:[field('path','Markdown file path')]},
    {id:'memory-edit',label:'Save Markdown edit',description:'Replace an explicitly previewed Markdown file only if its SHA-256 still matches. Keeps a recoverable original backup and refuses symlinks, shared hard links or truncated previews.',fields:[field('path','Markdown file path'),field('expectedHash','SHA-256 from the preview'),field('content','Complete new Markdown content',false)],confirm:true},
    {id:'memory-saved-setting',label:'Change automatic memory setting',description:'Explicitly write this account-wide user setting using the native memory writer. No memory content is deleted.',fields:[field('key','Setting: autoMemoryEnabled or autoDreamEnabled'),field('value','Value: true or false'),field('scope','Scope: user (the only native writer destination)')],confirm:true}],
  doctor:[{id:'doctor-run',label:'Run diagnostics',description:'Run the read-only native CLI doctor without opening its interactive dialog.'}],
  auth:[
    {id:'auth-status',label:'Refresh authentication status',description:'Read official CLI authentication status.'},
    {id:'auth-login',label:'Sign in with Claude',description:'Start the official browser login. This explicitly changes native Claude authentication. Browser progress appears here; no paid API-key sign-in is selected.',confirm:true},
    {id:'auth-complete',label:'Finish browser sign-in',description:'Wait for this session\'s pending native Claude OAuth browser callback.',confirm:true},
    {id:'auth-submit-code',label:'Complete manual sign-in',description:'Submit the authorization code and matching state from the pending official sign-in flow.',fields:[{key:'authorizationCode',label:'Authorization code',secret:true},{key:'state',label:'OAuth state',secret:true}],confirm:true},
  ],
  keybindings:[],
  sandbox:[
    {id:'sandbox-saved-mode',label:'Change sandbox mode',description:'Use the native writer for local sandbox settings. Unsupported platforms and managed restrictions refuse changes. Disabled mode removes sandbox isolation.',fields:[field('mode','Mode: regular, auto-allow or disabled'),field('scope','Scope: local')],confirm:true},
    {id:'sandbox-saved-fallback',label:'Change unsandboxed fallback',description:'Explicitly allow or forbid unsandboxed command fallback in local settings. Native trusted-tier restrictions remain authoritative.',fields:[field('value','Allow unsandboxed commands: true or false'),field('scope','Scope: local')],confirm:true},
  ],
};

const sensitiveKey=/(?:^env$|^command$|^args$|^processWrapper$|headers?|authorization|credential|password|secret|token(?!Source)|api.?key(?!Source)|access.?key)/i;
function text(value:string):string {
  let result=safeText(value).replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [redacted]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g,'[redacted]')
    .replace(/((?:access_token|refresh_token|id_token|api[-_]key|client_secret|password|authorization|secret|token)["']?\s*[=:]\s*["']?)[^\s"'&,}]+/gi,'$1[redacted]')
    .replace(/([?&](?:code|token|access_token|refresh_token|id_token|secret)=)[^&\s]+/gi,'$1[redacted]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,'$1[redacted]@');
  for(const [key,value] of Object.entries(process.env)) if(sensitiveKey.test(key)&&value&&value.length>=6) result=result.split(value).join('[redacted]');
  return result.slice(0,64*1024);
}
function redact(value:unknown,depth=0):unknown {
  if(depth>12)return '[nested value omitted]';
  if(typeof value==='string')return text(value);
  if(Array.isArray(value))return value.slice(0,1000).map(item=>redact(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[text(key),sensitiveKey.test(key)?'[redacted]':redact(v,depth+1)]));
  return value;
}
const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
// SDK 0.3.301 exports Settings types, not its runtime schema; reject unknown keys before native validation.
const stringSettings = ['$schema','apiKeyHelper','proxyAuthHelper','awsCredentialExport','awsAuthRefresh','gcpAuthRefresh','processWrapper','model','prUrlTemplate','forceLoginGatewayUrl','otelHeadersHelper','outputStyle','language','agent','minimumVersion','requiredMinimumVersion','requiredMaximumVersion','plansDirectory','timeFormat','timeZone','autoMemoryDirectory','claudeMd','pluginTrustMessage','theme'] satisfies (keyof Settings)[];
const numberSettings = ['cleanupPeriodDays','desktopSessionCleanupPeriodDays','skillListingMaxDescChars','skillListingBudgetFraction','bashOutputMaxChars','taskOutputMaxChars','feedbackSurveyRate','maxProseWidth','autoCompactWindow'] satisfies (keyof Settings)[];
const booleanSettings = ['respectGitignore','syncClaudeAiSkills','syncClaudeAiPlugins','wslInheritsWindowsSettings','includeCoAuthoredBy','includeGitInstructions','enforceAvailableModels','enableAllProjectMcpServers','disableClaudeAiConnectors','disableBundledSkills','disableAllHooks','disableAgentView','disableRemoteControl','disableWorkflows','disableArtifact','enableArtifact','enableWorkflows','workflowKeywordTriggerEnabled','disableSkillShellExecution','bashEditDiffEnabled','respondToBashCommands','allowManagedHooksOnly','allowManagedPermissionRulesOnly','allowManagedMcpServersOnly','allowAllClaudeAiMcps','allowClaudeInChromeWithManagedMcp','disableCommandPluginSources','disableSideloadFlags','forceRemoteSettingsRefresh','skipWebFetchPreflight','spinnerTipsEnabled','syntaxHighlightingDisabled','terminalTitleFromRename','alwaysThinkingEnabled','ultracode','fastMode','fastModePerSessionOptIn','promptSuggestionEnabled','emojiCompletionEnabled','showClearContextOnPlanAccept','channelsEnabled','prefersReducedMotion','autoMemoryEnabled','autoDreamEnabled','showThinkingSummaries','skipDangerousModePermissionPrompt','verbose','autoCompactEnabled','precomputeCompactionEnabled','idleCompaction','switchModelsOnFlag','autoContinueAtUsageLimit','autoScrollEnabled','wheelScrollAccelerationEnabled','fileCheckpointingEnabled','showTurnDuration','showMessageTimestamps','terminalProgressBarEnabled','todoFeatureEnabled','remoteControlAtStartup','isolatePeerMachines','autoUploadSessions','inputNeededNotifEnabled','agentPushNotifEnabled','voiceEnabled'] satisfies (keyof Settings)[];
const structuredSettings = ['policyHelper','fileSuggestion','env','attribution','permissions','fallbackModel','availableModels','availableModelsMatch','deniedModels','modelOverrides','modelPicker','modelPricing','enabledMcpjsonServers','disabledMcpjsonServers','skillOverrides','managedMcpServers','allowedMcpServers','deniedMcpServers','hooks','worktree','workflowSizeGuideline','defaultShell','allowedHttpHookUrls','httpHookAllowedEnvVars','strictPluginOnlyCustomization','statusLine','footerLinksRegexes','subagentStatusLine','enabledPlugins','prependPlugins','appendPlugins','extraKnownMarketplaces','additionalMarketplaces','strictKnownMarketplaces','allowedMarketplaces','blockedMarketplaces','pluginSuggestionMarketplaces','forceLoginMethod','gatewayInternalNetworks','parentSettingsBehavior','managedSourcesBehavior','forceLoginOrgUUID','allowedProviders','viewMode','sandbox','feedbackDrafts','spinnerVerbs','spinnerTipsOverride','spellcheck','promptCacheTtl','subagentPromptCacheTtl','effortLevel','maxEffortLevel','modelSettings','advisorModel','askUserQuestionTimeout','dialogExpiry','companyAnnouncements','pluginConfigs','remote','autoUpdatesChannel','tui','voice','allowedChannelPlugins','disableAutoMode','sshConfigs','claudeMdExcludes','editorMode','keybindingFlavor','vimInsertModeRemaps','preferredNotifChannel','teammateMode','daemonColdStart','crossSessionInbound','disableDeepLinkRegistration','defaultView'] satisfies (keyof Settings)[];
const settingsKeys=new Set<string>([...stringSettings,...numberSettings,...booleanSettings,...structuredSettings]);
const reservedSettings=new Set(['apiKeyHelper','proxyAuthHelper','awsCredentialExport','awsAuthRefresh','gcpAuthRefresh','policyHelper','forceLoginGatewayUrl','forceLoginMethod','forceLoginOrgUUID','gatewayInternalNetworks','allowedProviders','fallbackModel','hooks','disableAllHooks','skipDangerousModePermissionPrompt']);
function jsonObject(value:string|undefined):Record<string,any> {
  if(!value||Buffer.byteLength(value)>64*1024)throw Error('Expected a JSON object up to 64 KiB.');
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw Error('Invalid JSON.');}
  if(!record(parsed))throw Error('Expected a JSON object.');
  const inspect=(value:unknown,depth:number)=>{
    if(depth>16)throw Error('JSON nesting exceeds 16 levels.');
    if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe JSON property.');inspect(item,depth+1);
    }
  };inspect(parsed,0);return parsed;
}
function validateOverlay(overlay:Record<string,any>) {
  for(const [key,value] of Object.entries(overlay)) {
    if(!settingsKeys.has(key))throw Error('Unknown setting: '+key);
    if(reservedSettings.has(key))throw Error('Reserved gateway/auth/hook setting: '+key);
    if(value===null)throw Error('Clearing settings through this overlay is unsupported; use an explicit administration action.');
    if((stringSettings as string[]).includes(key)&&typeof value!=='string'||(numberSettings as string[]).includes(key)&&(typeof value!=='number'||!Number.isFinite(value)||value<0)||(booleanSettings as string[]).includes(key)&&typeof value!=='boolean')throw Error('Invalid value type for setting: '+key);
  }
  if(overlay.env!==undefined) {
    if(!record(overlay.env)||Object.entries(overlay.env).some(([key,value])=>typeof value!=='string'||/^(?:ANTHROPIC_|CLAUDAPTER_|CODEX_|CLAUDE_|OPENAI_)/i.test(key)))throw Error('Environment overlay contains invalid values or reserved gateway/auth variables.');
  }
  if(overlay.permissions!==undefined) {
    if(!record(overlay.permissions))throw Error('permissions must be an object.');
    if(overlay.permissions.defaultMode!==undefined&&!['default','plan','acceptEdits'].includes(overlay.permissions.defaultMode))throw Error('Permission bypass/escalation modes are not exposed.');
    for(const behavior of ['allow','deny','ask'])if(overlay.permissions[behavior]!==undefined&&(!Array.isArray(overlay.permissions[behavior])||!overlay.permissions[behavior].every(validRule)))throw Error('Invalid permission rules.');
  }
  if(overlay.effortLevel!==undefined&&!['low','medium','high','xhigh','max'].includes(overlay.effortLevel))throw Error('Unsupported effort level.');
}
function validRule(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)&&/^(?:[A-Za-z_][\w:.*-]*|\*)(?:\([^\r\n]*\))?$/.test(value);
}
function mergeSettings(previous:Record<string,any>,next:Record<string,any>):Record<string,any> {
  const result={...previous};for(const [key,value]of Object.entries(next))result[key]=record(value)&&record(previous[key])?mergeSettings(previous[key],value):structuredClone(value);return result;
}
function currentOverlay(context:AdminContext) { return overlays.get(context.query)??structuredClone(context.initialSettings??{}); }
async function applyOverlay(context:AdminContext,patch:Record<string,any>) {
  const next=mergeSettings(currentOverlay(context),patch);
  // applyFlagSettings shallow-merges top-level keys; send the complete changed subtrees.
  await context.query.applyFlagSettings(Object.fromEntries(Object.keys(patch).map(key=>[key,next[key]])));
  overlays.set(context.query,next);
}
async function settings(context:AdminContext) {
  const resolved=await(context.resolveSettings??resolveSettings)({cwd:context.cwd});
  const effective=resolved.effective;
  return {note:'Resolved file settings, not a runtime permission decision. Session-only overlays and policyHelper output may differ.',
    effective:pick(effective,['model','effortLevel','language','outputStyle','alwaysThinkingEnabled','permissions','disableAllHooks','enabledPlugins']),
    environmentNames:Object.keys(effective.env??{}),hookEvents:Object.entries(effective.hooks??{}).map(([event,matchers])=>({event,matchers:Array.isArray(matchers)?matchers.length:0})),
    sessionOverlay:redact({...currentOverlay(context),hooks:Object.entries(currentOverlay(context).hooks??{}).map(([event,matchers])=>({event,matchers:Array.isArray(matchers)?matchers.length:0}))}),provenance:resolved.provenance,sources:resolved.sources.map(s=>({source:s.source,path:s.path,keys:Object.keys(s.settings)}))};
}
function servers(value:Awaited<ReturnType<Query['mcpServerStatus']>>) {
  return value.map(server=>({name:server.name,status:server.status,scope:server.scope,source:server.source,serverInfo:server.serverInfo,
    tools:server.tools?.map(tool=>({name:tool.name,annotations:tool.annotations})),error:server.error?'Connection error; inspect the server locally.':undefined}));
}
const rowId=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,24);
function hookPreview(hook:any):string|undefined {
  if(!record(hook.editable?.config))return undefined;
  const preview=pick(hook.editable.config,['type','command','prompt','url','args','server','tool','if','timeout']);
  if(Array.isArray(preview.args))preview.args=preview.args.map((value:unknown,index:number,args:unknown[])=>{
    const previous=args[index-1];
    if(typeof previous==='string'&&previous.startsWith('-')&&!previous.includes('=')&&sensitiveKey.test(previous))return '[redacted]';
    if(typeof value==='string'&&value.startsWith('-')&&value.includes('=')&&sensitiveKey.test(value.split('=')[0]))return value.split('=')[0]+'=[redacted]';
    return value;
  });
  return text(JSON.stringify(preview,null,2));
}
async function nativeRead(context:AdminContext,method:CompatMethod):Promise<any|undefined> {
  const initialized=await context.query.initializationResult();
  if(!isCompatVersion(initialized.claude_code_version)||typeof(context.query as any)[method]!=='function')return undefined;
  return invokeCompat(context.query,method);
}
async function snapshot(kind:AdminKind,context:AdminContext):Promise<unknown> {
  const q=context.query;
  switch(kind) {
    case 'status': {
      const native=await nativeRead(context,'getStatus');if(native)return native;
      const result=await q.initializationResult();
      return {cwd:context.cwd,claudePath:context.claudePath,...pick(result,['claude_code_version','output_style','available_output_styles','hooks_applied','plugins_applied']),account:await q.accountInfo(),mcp:servers(await q.mcpServerStatus())};
    }
    case 'config': {
      const native=await nativeRead(context,'getSettings');return native?{...native,trackedSessionOverlay:currentOverlay(context)}:settings(context);
    }
    case 'permissions': {
      const native=await nativeRead(context,'listPermissionRules');return native?{...native,state:{...native.state,rules:native.state.rules.map((rule:any)=>({...rule,id:rowId(rule)}))}}:settings(context);
    }
    case 'hooks': {
      const native=await nativeRead(context,'getHooksListing');return native?{...native,hooks:native.hooks.map((hook:any)=>({...hook,id:rowId(hook),executionPreview:hookPreview(hook)}))}:settings(context);
    }
    case 'mcp':return {servers:servers(await q.mcpServerStatus())};
    case 'plugins':return cli(context,['plugin','list','--json']);
    case 'skills':return await nativeRead(context,'getSkillsDialog')??{commands:await q.supportedCommands()};
    case 'memory':return await nativeRead(context,'getMemoryDialog')??{cwd:context.cwd,note:'Choose an exact Markdown file to preview. Native Claude owns instruction loading and automatic memory; no memory files are scanned or changed here.'};
    case 'sandbox':return await nativeRead(context,'getSandboxDialog')??{available:false,note:'The native sandbox dialog requires the verified SDK/CLI pair. No unsupported sandbox state is inferred.'};
    case 'doctor':return cli(context,['doctor']);
    case 'auth':return {account:await q.accountInfo(),native:await cli(context,['auth','status','--json'])};
    case 'keybindings':return {bindings:context.keybindings??{},note:'Claudapter owns these frontend bindings. Native Claude keybinding files are preserved and are not automatically applied to this renderer.'};
    default:throw Error('Unsupported administration dialog.');
  }
}
export async function adminSnapshot(kind:AdminKind,context:AdminContext):Promise<unknown> {
  try{return redact(await snapshot(kind,context));}catch(error){throw Error(text(error instanceof Error?error.message:'Administration query failed.'));}
}

function required(input:Record<string,string>,key:string,max=512):string {
  const value=input[key]?.trim();
  if(!value||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid '+key+'.');
  return value;
}
function name(input:Record<string,string>,key='name') {
  const value=required(input,key,128);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/.test(value))throw Error('Invalid '+key+'.');
  return value;
}
function scope(input:Record<string,string>) {
  const value=required(input,'scope');if(!['local','project','user'].includes(value))throw Error('Choose local, project or user scope explicitly.');return value;
}
async function cli(context:AdminContext,args:string[],timeout=30_000):Promise<unknown> {
  const result=await(context.exec??execute)(context.claudePath,args,{cwd:context.cwd,timeout,signal:context.signal,env:context.env,
    onOutput:['auth','mcp'].includes(args[0])&&args[1]==='login'?chunk=>context.onOutput?.(text(chunk)):undefined});
  let output:unknown=result.stdout;
  try{output=JSON.parse(result.stdout);}catch{/* Human CLI diagnostics remain text. */}
  return {output,diagnostics:result.stderr||undefined};
}
const nativeSource=(input:Record<string,string>)=>({local:'localSettings',project:'projectSettings',user:'userSettings'}[scope(input)]!);
async function nativeWrite(context:AdminContext,command:'edit-permission-rules'|'edit-memory-settings'|'edit-hook'|'edit-skill-overrides'|'edit-sandbox-settings',body:Record<string,unknown>) {
  assertCompatVersion((await context.query.initializationResult()).claude_code_version);
  const run=context.exec??execute;
  const version=await run(context.claudePath,['--version'],{cwd:context.cwd,timeout:10_000,env:context.env,signal:context.signal});
  const versionMatch=version.stdout.match(/^([\d.]+)\s+\(Claude Code\)\s*$/);
  assertCompatVersion(versionMatch?.[1]);
  const result=await run(context.claudePath,[command,'--json'],{cwd:context.cwd,timeout:30_000,input:JSON.stringify(body),env:context.env,signal:context.signal});
  let output:any;try{output=JSON.parse(result.stdout);}catch{throw Error('Native settings writer returned an unrecognized response.');}
  if(!record(output)||output.ok!==true)throw Error('Native settings writer did not confirm the edit.');
  return {scope:'persistent',...output,note:'Saved through the native writer. The current session observes its settings watcher; refresh this dialog to inspect the live state.'};
}
async function action(id:string,input:Record<string,string>,context:AdminContext):Promise<unknown> {
  const definition=Object.values(adminActions).flat().find(item=>item.id===id);
  if(!definition)throw Error('Unsupported administration action: '+id);
  if(definition.confirm&&input.confirm!=='yes')throw Error('Explicit confirmation is required for '+definition.label+'.');
  const q=context.query;
  switch(id) {
    case 'config-session': {
      const key=required(input,'key'),value=required(input,'value');
      if(key==='effortLevel') {
        if(!['low','medium','high','xhigh','max'].includes(value))throw Error('Unsupported effort level.');
        await applyOverlay(context,{effortLevel:value});
      } else if(key==='alwaysThinkingEnabled') {
        if(!['true','false'].includes(value))throw Error('Expected true or false.');await applyOverlay(context,{alwaysThinkingEnabled:value==='true'});
      } else if(key==='language'||key==='outputStyle') await applyOverlay(context,{[key]:value});
      else throw Error('This setting cannot be changed by this dialog.');
      return {applied:true,scope:'session',key,value};
    }
    case 'config-overlay': {
      const patch=jsonObject(input.json);validateOverlay(patch);
      if(patch.permissions)for(const behavior of ['allow','deny','ask'])if(patch.permissions[behavior])patch.permissions[behavior]=[...new Set([...(currentOverlay(context).permissions?.[behavior]??[]),...patch.permissions[behavior]])];
      await applyOverlay(context,patch);return {applied:true,scope:'session',settings:patch,note:'Native settings schema and managed policy remain authoritative; some startup-only settings require a new session.'};
    }
    case 'permission-mode': {
      const mode=required(input,'mode');if(!['default','plan','acceptEdits'].includes(mode))throw Error('Only default, plan and acceptEdits modes are exposed.');
      await q.setPermissionMode(mode as 'default'|'plan'|'acceptEdits');
      overlays.set(q,mergeSettings(currentOverlay(context),{permissions:{defaultMode:mode}}));
      return {applied:true,scope:'session',mode};
    }
    case 'permission-add':case 'permission-remove': {
      const behavior=required(input,'behavior'),rule=required(input,'rule',4096);
      if(!['allow','deny','ask'].includes(behavior)||!validRule(rule))throw Error('Choose allow, deny or ask and a valid native rule.');
      const previous=currentOverlay(context).permissions?.[behavior]??[];
      if(id==='permission-remove') {
        const resolved=await(context.resolveSettings??resolveSettings)({cwd:context.cwd});
        if((resolved.effective.permissions?.[behavior as 'allow'|'deny'|'ask']??[]).includes(rule))throw Error('Inherited file/managed rules cannot be removed by this session-only SDK control. Edit their source explicitly.');
        if(!previous.includes(rule))throw Error('Rule is not present in the tracked session overlay. Native dynamic approvals are not exposed for removal by this SDK.');
      }
      const rules=id==='permission-add'?[...new Set([...previous,rule])]:previous.filter((value:string)=>value!==rule);
      await applyOverlay(context,{permissions:{[behavior]:rules}});return {applied:true,scope:'session',behavior,rules};
    }
    case 'permission-saved-add': {
      const behavior=required(input,'behavior'),rule=required(input,'rule',4096);
      if(!['allow','deny','ask'].includes(behavior)||!validRule(rule))throw Error('Choose allow, deny or ask and a valid native rule.');
      return nativeWrite(context,'edit-permission-rules',{op:'add',rules:[rule],behavior,destination:nativeSource(input)});
    }
    case 'permission-saved-remove': {
      const listing=await invokeCompat(q,'listPermissionRules'),source=nativeSource(input),id=required(input,'ruleId',24);
      const row=listing.state.rules.find((rule:any)=>rowId(rule)===id);
      if(!row||row.editability!=='persistent'||row.notInEffect||row.source!==source)throw Error('Rule is stale, not editable, or belongs to another scope. Refresh permissions.');
      return nativeWrite(context,'edit-permission-rules',{op:'remove',rule:row.rule,behavior:row.behavior,source});
    }
    case 'mcp-reconnect':await q.reconnectMcpServer(name(input));return {servers:servers(await q.mcpServerStatus())};
    case 'mcp-enable':case 'mcp-disable':await q.toggleMcpServer(name(input),id==='mcp-enable');return {servers:servers(await q.mcpServerStatus())};
    case 'mcp-list':return cli(context,['mcp','list']);
    case 'mcp-login': {
      const initialized=await q.initializationResult();
      if(isCompatVersion(initialized.claude_code_version)&&typeof(q as any).mcpAuthenticate==='function')return invokeCompat(q,'mcpAuthenticate',{serverName:name(input),confirmed:true});
      return cli(context,['mcp','login',name(input)],180_000);
    }
    case 'mcp-submit-callback':return invokeCompat(q,'mcpSubmitOAuthCallbackUrl',{serverName:name(input),callbackUrl:required(input,'callbackUrl',16384),confirmed:true});
    case 'mcp-clear-auth':return invokeCompat(q,'mcpClearAuth',{serverName:name(input),confirmed:true});
    case 'mcp-add-http': {
      const server=name(input),destination=new URL(required(input,'url',2048));
      if(!['http:','https:'].includes(destination.protocol)||destination.username||destination.password||destination.search||destination.hash)throw Error('Use an HTTP(S) URL without credentials, query or fragment.');
      return cli(context,['mcp','add','--scope',scope(input),'--transport','http',server,destination.href]);
    }
    case 'mcp-add-stdio': {
      const server=name(input),command=required(input,'command',1024);if(command.startsWith('-'))throw Error('Executable cannot start with a dash.');
      let args:unknown;try{args=JSON.parse(input.args||'[]');}catch{throw Error('Arguments must be a JSON string array.');}
      if(!Array.isArray(args)||args.length>128||!args.every(v=>typeof v==='string'&&v.length<4096&&!v.includes('\0')))throw Error('Arguments must be a bounded JSON string array.');
      return cli(context,['mcp','add','--scope',scope(input),'--transport','stdio',server,'--',command,...args]);
    }
    case 'mcp-remove':return cli(context,['mcp','remove','--scope',scope(input),name(input)]);
    case 'plugins-reload':case 'plugins-reload-force': {
      const result=await q.reloadPlugins({holdOnCacheImpact:id==='plugins-reload'});
      return {...pick(result,['plugins','commands','agents','error_count','held','cache_impact']),mcpServers:servers(result.mcpServers)};
    }
    case 'skills-reload':return q.reloadSkills();
    case 'skill-saved-state': {
      if(scope(input)!=='local')throw Error('The native skill state writer only changes local settings.');
      const state=required(input,'state');if(!['on','name-only','user-invocable-only','off'].includes(state))throw Error('Unsupported skill state.');
      return nativeWrite(context,'edit-skill-overrides',{name:required(input,'name',500),state});
    }
    case 'memory-saved-setting': {
      if(scope(input)!=='user')throw Error('The native automatic memory writer only changes user settings.');
      const key=required(input,'key'),value=required(input,'value');
      if(!['autoMemoryEnabled','autoDreamEnabled'].includes(key)||!['true','false'].includes(value))throw Error('Choose an automatic memory boolean setting.');
      return nativeWrite(context,'edit-memory-settings',{[key]:value==='true'});
    }
    case 'sandbox-saved-mode':case 'sandbox-saved-fallback': {
      if(scope(input)!=='local')throw Error('This sandbox writer action changes local settings only.');
      const state=await invokeCompat(q,'getSandboxDialog');
      if(!state.supported)throw Error('Sandboxing is not available on this platform.');
      if(state.locked)throw Error('Sandbox settings are locked by policy.');
      if(id==='sandbox-saved-mode') {
        const mode=required(input,'mode');if(!['regular','auto-allow','disabled'].includes(mode))throw Error('Unsupported sandbox mode.');
        return nativeWrite(context,'edit-sandbox-settings',{mode});
      }
      const value=required(input,'value');if(!['true','false'].includes(value))throw Error('Expected true or false.');
      return nativeWrite(context,'edit-sandbox-settings',{allowUnsandboxedCommands:value==='true'});
    }
    case 'hook-saved-add':case 'hook-saved-replace':case 'hook-saved-remove': {
      const source=nativeSource(input),op=id.slice('hook-saved-'.length);let target:any;
      if(op!=='add') {
        const listing=await invokeCompat(q,'getHooksListing'),hookId=required(input,'hookId',24),row=listing.hooks.find((hook:any)=>rowId(hook)===hookId);
        if(!row||!row.editable||row.source!==source||listing.policy.disabledByPolicy||listing.policy.managedOnly||listing.policy.pluginOnly||listing.policy.policyUnreadable)throw Error('Hook is stale, policy-locked, not editable or belongs to another scope. Refresh hooks.');
        target={event:row.event,matcher:row.editable.matcher,hook:row.editable.config};
      }
      const event=op==='remove'?target.event:required(input,'event'),matcher=op==='remove'?target.matcher:input.matcher??'';
      if(!(HOOK_EVENTS as readonly string[]).includes(event)||matcher.length>10000||matcher.includes('\0'))throw Error('Invalid hook event or matcher.');
      const hook=op==='remove'?undefined:jsonObject(input.hook);
      return nativeWrite(context,'edit-hook',{op,source,event,matcher,...(hook?{hook}:{}),...(target?{target}:{})});
    }
    case 'hooks-overlay': {
      const incoming=jsonObject(input.json),previous=currentOverlay(context).hooks??{},hooks={...previous};
      for(const [event,matchers]of Object.entries(incoming)) {
        if(!(HOOK_EVENTS as readonly string[]).includes(event)||!Array.isArray(matchers))throw Error('Unknown hook event or invalid matcher list.');
        for(const matcher of matchers) {
          if(!record(matcher)||matcher.matcher!==undefined&&typeof matcher.matcher!=='string'||!Array.isArray(matcher.hooks))throw Error('Invalid hook matcher.');
          for(const hook of matcher.hooks) {
            if(!record(hook)||!['command','prompt','agent','http','mcp_tool'].includes(hook.type))throw Error('Unsupported hook type.');
            const content=hook.type==='command'?hook.command:hook.type==='http'?hook.url:hook.type==='mcp_tool'?hook.server:hook.prompt;
            if(typeof content!=='string'||!content.trim()||content.includes('\0'))throw Error('Hook needs an explicit command, prompt or URL.');
            if(hook.type==='mcp_tool'&&(typeof hook.tool!=='string'||!hook.tool.trim()))throw Error('MCP hook needs an explicit tool.');
            if(hook.args!==undefined&&(!Array.isArray(hook.args)||!hook.args.every((arg:unknown)=>typeof arg==='string'&&!arg.includes('\0'))))throw Error('Hook args must be strings.');
          }
        }
        hooks[event]=[...(previous[event]??[]),...matchers];
      }
      await applyOverlay(context,{hooks});return {applied:true,scope:'session',events:Object.keys(incoming),note:'Existing native file and session hooks remain loaded. Native schema/policy may restrict hook behavior.'};
    }
    case 'marketplace-list':return cli(context,['plugin','marketplace','list','--json']);
    case 'marketplace-add': {
      const source=required(input,'source',4096);if(source.startsWith('-'))throw Error('Marketplace source cannot begin with a dash.');
      if(/^[a-z][\w+.-]*:\/\//i.test(source)){
        const url=new URL(source);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use an HTTPS marketplace URL without credentials, query or fragment.');
      }
      return cli(context,['plugin','marketplace','add','--scope',scope(input),'--json',source],120_000);
    }
    case 'marketplace-remove':return cli(context,['plugin','marketplace','remove','--scope',scope(input),'--json',name(input)],120_000);
    case 'marketplace-update':return cli(context,['plugin','marketplace','update','--json',name(input)],120_000);
    case 'doctor-run':return cli(context,['doctor']);
    case 'auth-status':return cli(context,['auth','status','--json']);
    case 'auth-login': {
      const initialized=await q.initializationResult();
      if(isCompatVersion(initialized.claude_code_version)&&typeof(q as any).claudeAuthenticate==='function')return invokeCompat(q,'claudeAuthenticate',{confirmed:true});
      return cli(context,['auth','login','--claudeai'],180_000);
    }
    case 'auth-complete':return invokeCompat(q,'claudeOAuthWaitForCompletion',{confirmed:true});
    case 'auth-submit-code':return invokeCompat(q,'claudeOAuthCallback',{authorizationCode:required(input,'authorizationCode',16384),state:required(input,'state',4096),confirmed:true});
    case 'memory-preview': {
      const path=memoryPath(input,context);
      const file=await open(path,'r');
      try {
        const stat=await file.stat();if(!stat.isFile())throw Error('Choose a regular Markdown file.');
        const buffer=Buffer.alloc(64*1024);const {bytesRead}=await file.read(buffer,0,buffer.length,0);
        return {path,text:buffer.subarray(0,bytesRead).toString('utf8'),truncated:stat.size>buffer.length,expectedHash:stat.size<=buffer.length?digest(buffer.subarray(0,bytesRead)):undefined};
      }finally{await file.close();}
    }
    case 'memory-edit':return editMemory(input,context);
    default: {
      const operation=id.slice('plugin-'.length);
      if(!id.startsWith('plugin-')||!['install','uninstall','enable','disable','update'].includes(operation))throw Error('Unsupported action.');
      return cli(context,['plugin',operation,'--scope',scope(input),'--json',...(operation==='uninstall'?['--keep-data']:[]),name(input,'plugin')],120_000);
    }
  }
}
export async function runAdminAction(id:string,input:Record<string,string>,context:AdminContext):Promise<unknown> {
  try{return redact(await action(id,input,context));}catch(error){throw Error(text(error instanceof Error?error.message:'Administration action failed.'));}
}

const digest=(buffer:Uint8Array)=>createHash('sha256').update(buffer).digest('hex');
async function memoryBytes(path:string) {
  const file=await open(path,'r');
  try{
    const buffer=Buffer.alloc(64*1024+1);let total=0;
    while(total<buffer.length){const {bytesRead}=await file.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}
    if(total>64*1024)throw Error('Markdown file exceeds the editable 64 KiB limit.');return buffer.subarray(0,total);
  }finally{await file.close();}
}
function memoryPath(input:Record<string,string>,context:AdminContext) {
  const path=resolve(context.cwd,required(input,'path',4096));
  if(extname(path).toLowerCase()!=='.md')throw Error('Only an explicitly selected Markdown file can be used.');return path;
}
async function editMemory(input:Record<string,string>,context:AdminContext) {
  const path=memoryPath(input,context),expected=required(input,'expectedHash',64),content=input.content;
  if(!/^[0-9a-f]{64}$/.test(expected))throw Error('Use the SHA-256 hash from an untruncated preview.');
  if(typeof content!=='string'||Buffer.byteLength(content)>64*1024||content.includes('\0'))throw Error('Replacement must be Markdown text up to 64 KiB.');
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024)throw Error('Editing requires a regular unshared Markdown file up to 64 KiB.');
  if(digest(await memoryBytes(path))!==expected)throw Error('File changed since preview; no edit was applied. Preview it again.');
  const folder=await mkdtemp(join(dirname(path),'.claudapter-memory-')),draft=join(folder,'replacement.md'),backup=join(folder,'original.md');
  let moved=false,installed=false;
  try {
    await writeFile(draft,content,{flag:'wx',mode:stat.mode});
    const latest=await lstat(path);
    if(latest.ino!==stat.ino||latest.dev!==stat.dev||!latest.isFile()||latest.nlink!==1||digest(await memoryBytes(path))!==expected)throw Error('File changed since preview; no edit was applied.');
    // Capture then validate the exact old file; exclusive link never overwrites a concurrent replacement.
    await rename(path,backup);moved=true;
    const captured=await lstat(backup);
    if(!captured.isFile()||captured.isSymbolicLink()||captured.nlink!==1||captured.size>64*1024||digest(await memoryBytes(backup))!==expected)throw Error('Concurrent file change detected.');
    await link(draft,path);installed=true;
    return {saved:true,path,expectedHash:digest(Buffer.from(content)),backup,note:'Original preserved as a recovery backup; native instruction reload follows Claude Code behavior.'};
  }catch(error){
    if(moved&&!installed) {
      try{await link(backup,path);}catch{/* A concurrent writer owns the path; its file is never replaced. */}
      throw Error('Edit stopped. Original data preserved at '+backup+'. '+(error instanceof Error?error.message:'File operation failed.'));
    }
    throw error;
  }finally{
    await unlink(draft).catch(()=>{});
    if(!moved)await rmdir(folder).catch(()=>{});
  }
}

function execute(file:string,args:string[],options:ExecOptions):Promise<{stdout:string;stderr:string}> {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:options.cwd,env:options.env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],signal:options.signal});
    child.stdin.on('error',()=>{});child.stdin.end(options.input);
    let stdout='',stderr='',stdoutPending='',stderrPending='',tooLarge=false;
    const timer=setTimeout(()=>child.kill(),options.timeout);
    const receive=(chunk:Buffer,error:boolean)=>{
      if(error)stderr+=chunk.toString('utf8');else stdout+=chunk.toString('utf8');
      if(stdout.length+stderr.length>1024*1024){tooLarge=true;child.kill();return;}
      if(error)stderrPending+=chunk.toString('utf8');else stdoutPending+=chunk.toString('utf8');
      let pending=error?stderrPending:stdoutPending;
      const newline=pending.lastIndexOf('\n');
      if(newline>=0){options.onOutput?.(pending.slice(0,newline+1));pending=pending.slice(newline+1);}
      if(error)stderrPending=pending;else stdoutPending=pending;
    };
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>receive(chunk,false));child.stderr.on('data',chunk=>receive(chunk,true));
    child.on('error',error=>{clearTimeout(timer);reject(Error('Cannot start native CLI: '+error.message));});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(stdoutPending)options.onOutput?.(stdoutPending);if(stderrPending)options.onOutput?.(stderrPending);
      if(tooLarge)reject(Error('Native CLI output exceeded the safety limit.'));
      else if(code!==0) {
        let diagnostic:unknown=stderr||stdout||'No diagnostic output.';
        try{diagnostic=JSON.parse(String(diagnostic));}catch{/* Plain diagnostics are sanitized as text. */}
        const safe=redact(diagnostic);
        reject(Error('Native CLI failed ('+(signal??code)+'): '+(typeof safe==='string'?safe:JSON.stringify(safe))));
      }
      else resolve({stdout,stderr});
    });
  });
}

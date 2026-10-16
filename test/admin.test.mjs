import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminActions,adminSnapshot,runAdminAction } from '../dist/tui/admin.js';

function fixture() {
  const calls=[];
  const query={
    initializationResult:async()=>({claude_code_version:'fixture',output_style:'default',available_output_styles:['default'],hooks_applied:true}),
    accountInfo:async()=>({subscriptionType:'fixture',tokenSource:'native',access_token:'fixture-private-token'}),
    mcpServerStatus:async()=>[{name:'fixture',status:'connected',scope:'local',config:{headers:{authorization:'Bearer fixture-private-header'},env:{ARBITRARY:'fixture-private-env'}},tools:[{name:'read',annotations:{readOnly:true}}]}],
    supportedCommands:async()=>[{name:'fixture-skill',description:'Fixture',argumentHint:''}],
    applyFlagSettings:async settings=>calls.push(['settings',settings]),setPermissionMode:async mode=>calls.push(['permissions',mode]),
    reconnectMcpServer:async name=>calls.push(['reconnect',name]),toggleMcpServer:async(name,enabled)=>calls.push(['toggle',name,enabled]),
    reloadSkills:async()=>({skills:[{name:'fixture-skill'}]}),
    reloadPlugins:async options=>{calls.push(['reload',options]);return {plugins:[],commands:[],agents:[],mcpServers:[],error_count:0,held:options.holdOnCacheImpact};},
  };
  const context={query,cwd:process.cwd(),claudePath:'fixture-native-cli',exec:async(file,args,options)=>{calls.push(['exec',file,args,{cwd:options.cwd,timeout:options.timeout}]);return{stdout:'{"ok":true,"access_token":"fixture-private-token","headers":{"key":"fixture-private-header"}}',stderr:''};},
    resolveSettings:async()=>({effective:{model:'fixture',env:{ARBITRARY:'fixture-private-env'},hooks:{PreToolUse:[{hooks:[{command:'echo fixture-private-command'}]}]},permissions:{deny:['Bash(rm *)']}},provenance:{model:{source:'user'}},sources:[{source:'user',path:'fixture-settings.json',settings:{env:{ARBITRARY:'fixture-private-env'}}}]})};
  return {calls,context};
}

test('administration snapshots use SDK and redact credential-bearing fields without exposing hook commands',async()=>{
  const {context}=fixture();
  for(const kind of ['status','config','permissions','mcp','plugins','skills','hooks','memory','doctor','auth','keybindings']) {
    const snapshot=JSON.stringify(await adminSnapshot(kind,context));assert.ok(!snapshot.includes('fixture-private'),kind);
  }
  const config=await adminSnapshot('config',context);assert.deepEqual(config.environmentNames,['ARBITRARY']);assert.equal(config.hookEvents[0].event,'PreToolUse');
  const mcp=await adminSnapshot('mcp',context);assert.equal(mcp.servers[0].name,'fixture');assert.equal(mcp.servers[0].config,undefined);
});

test('all persistent and permission-changing actions require exact confirmation before any effect',async()=>{
  const {context,calls}=fixture();
  for(const action of Object.values(adminActions).flat().filter(a=>a.confirm)) await assert.rejects(runAdminAction(action.id,{},context),/confirmation/);
  assert.equal(calls.length,0);await assert.rejects(runAdminAction('invented',{},context),/Unsupported/);
});

test('session settings and permission changes do not write global files or accept bypass modes',async()=>{
  const {context,calls}=fixture();
  await runAdminAction('config-session',{key:'language',value:'English',confirm:'yes'},context);
  await runAdminAction('config-session',{key:'effortLevel',value:'high',confirm:'yes'},context);
  await runAdminAction('permission-mode',{mode:'plan',confirm:'yes'},context);
  assert.deepEqual(calls,[['settings',{language:'English'}],['settings',{effortLevel:'high'}],['permissions','plan']]);
  for(const mode of ['bypassPermissions','auto','dontAsk'])await assert.rejects(runAdminAction('permission-mode',{mode,confirm:'yes'},context),/Only/);
  for(const key of ['env','permissions','disableAllHooks'])await assert.rejects(runAdminAction('config-session',{key,value:'true',confirm:'yes'},context),/cannot be changed/);
});

test('MCP lifecycle controls remain session scoped and persisted commands use explicit validated argv',async()=>{
  const {context,calls}=fixture();
  await runAdminAction('mcp-reconnect',{name:'fixture'},context);
  await runAdminAction('mcp-disable',{name:'fixture',confirm:'yes'},context);
  await runAdminAction('mcp-add-http',{name:'new-server',url:'https://example.test/mcp',scope:'local',confirm:'yes'},context);
  await runAdminAction('mcp-add-stdio',{name:'stdio',command:'fixture-program',args:'["a b","$(echo x)","--flag"]',scope:'project',confirm:'yes'},context);
  assert.deepEqual(calls[0],['reconnect','fixture']);assert.deepEqual(calls[1],['toggle','fixture',false]);
  assert.deepEqual(calls[2][2],['mcp','add','--scope','local','--transport','http','new-server','https://example.test/mcp']);
  assert.deepEqual(calls[3][2],['mcp','add','--scope','project','--transport','stdio','stdio','--','fixture-program','a b','$(echo x)','--flag']);
  for(const url of ['file:///secret','https://name:password@example.test','https://example.test/?token=private'])await assert.rejects(runAdminAction('mcp-add-http',{name:'bad',url,scope:'local',confirm:'yes'},context),/HTTP/);
  await assert.rejects(runAdminAction('mcp-add-stdio',{name:'bad',command:'node',args:'{"args":[]}',scope:'local',confirm:'yes'},context),/array/);
  await assert.rejects(runAdminAction('mcp-remove',{name:'--all',scope:'local',confirm:'yes'},context),/Invalid name/);
  await assert.rejects(runAdminAction('mcp-remove',{name:'fixture',scope:'managed',confirm:'yes'},context),/scope/);
});

test('plugin actions preserve data and command approval; reload checks cache impact',async()=>{
  const {context,calls}=fixture();
  await runAdminAction('plugin-uninstall',{plugin:'fixture@marketplace',scope:'user',confirm:'yes'},context);
  await runAdminAction('plugin-install',{plugin:'fixture@marketplace',scope:'local',confirm:'yes'},context);
  assert.deepEqual(calls[0][2],['plugin','uninstall','--scope','user','--json','--keep-data','fixture@marketplace']);
  assert.ok(!calls[1][2].includes('-y'));
  assert.equal((await runAdminAction('plugins-reload',{},context)).held,true);
  assert.equal((await runAdminAction('plugins-reload-force',{confirm:'yes'},context)).held,false);
});

test('auth actions are explicit official CLI calls with safe streamed login output and no real login',async()=>{
  const {context,calls}=fixture();const output=[];context.onOutput=chunk=>output.push(chunk);
  const exec=context.exec;context.exec=async(file,args,options)=>{options.onOutput?.('Open https://claude.ai/oauth/authorize?client_id=fixture\naccess_token=fixture-secret\n');return exec(file,args,options);};
  await runAdminAction('auth-login',{confirm:'yes'},context);
  assert.deepEqual(calls[0][2],['auth','login','--claudeai']);assert.match(output[0],/https:\/\/claude.ai/);assert.ok(!output[0].includes('fixture-secret'));
  assert.equal(calls[0][3].timeout,180000);
  context.exec=async()=>{throw Error('Authorization: Bearer fixture-secret');};
  await assert.rejects(runAdminAction('auth-status',{},context),error=>!error.message.includes('fixture-secret'));
});

test('only explicitly selected Markdown is previewed, with a bounded read and no writes',async t=>{
  const home=await mkdtemp(join(tmpdir(),'claudapter-admin-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const {context}=fixture();context.cwd=home;await writeFile(join(home,'CLAUDE.md'),'x'.repeat(70000));
  const result=await runAdminAction('memory-preview',{path:'CLAUDE.md'},context);assert.equal(result.truncated,true);assert.equal(result.text.length,65536);
  await assert.rejects(runAdminAction('memory-preview',{path:'.credentials.json'},context),/Markdown/);
});

test('permission additions and removals preserve initial and previous session subtrees',async()=>{
  const {context,calls}=fixture();context.initialSettings={permissions:{allow:['Read'],ask:['Bash(git *)'],additionalDirectories:['fixture-dir']},env:{KEEP:'fixture'},hooks:{SessionStart:[]}};
  await runAdminAction('permission-add',{behavior:'deny',rule:'Bash(curl *)',confirm:'yes'},context);
  await runAdminAction('permission-add',{behavior:'allow',rule:'Bash(npm test)',confirm:'yes'},context);
  await runAdminAction('permission-remove',{behavior:'allow',rule:'Read',confirm:'yes'},context);
  assert.deepEqual(calls.at(-1),['settings',{permissions:{allow:['Bash(npm test)'],ask:['Bash(git *)'],additionalDirectories:['fixture-dir'],deny:['Bash(curl *)']}}]);
  await assert.rejects(runAdminAction('permission-remove',{behavior:'deny',rule:'Bash(rm *)',confirm:'yes'},context),/Inherited/);
  await assert.rejects(runAdminAction('permission-remove',{behavior:'allow',rule:'Unknown',confirm:'yes'},context),/not present/);
  assert.equal((await adminSnapshot('permissions',context)).sessionOverlay.permissions.allow[0],'Bash(npm test)');
  const other=fixture();assert.equal((await adminSnapshot('permissions',other.context)).sessionOverlay.permissions,undefined);
});

test('session JSON settings preserve prior subtrees, validate types, and block reserved routing/auth and bypass',async()=>{
  const {context,calls}=fixture();context.initialSettings={permissions:{allow:['Read'],deny:['Bash(rm *)']},env:{KEEP:'original'}};
  await runAdminAction('config-overlay',{json:JSON.stringify({language:'English',env:{ADDED:'yes'},permissions:{ask:['Bash(npm *)']},autoCompactWindow:500000}),confirm:'yes'},context);
  assert.deepEqual(calls[0][1].env,{KEEP:'original',ADDED:'yes'});assert.deepEqual(calls[0][1].permissions,{allow:['Read'],deny:['Bash(rm *)'],ask:['Bash(npm *)']});
  for(const json of ['{"unknownSetting":true}','{"env":{"ANTHROPIC_BASE_URL":"https://bad.test"}}','{"env":{"CLAUDAPTER_TOKEN":"private"}}','{"permissions":{"defaultMode":"bypassPermissions"}}','{"alwaysThinkingEnabled":"false"}','{"permissions":{"allow":[12]}}','{"hooks":{}}','{"disableAllHooks":true}','{"__proto__":{"x":1}}','{"language":null}'])await assert.rejects(runAdminAction('config-overlay',{json,confirm:'yes'},context));
  const before=await adminSnapshot('config',context);context.query.applyFlagSettings=async()=>{throw Error('Native schema rejected value');};
  await assert.rejects(runAdminAction('config-overlay',{json:'{"language":"invalid"}',confirm:'yes'},context),/rejected/);
  assert.equal((await adminSnapshot('config',context)).sessionOverlay.language,before.sessionOverlay.language);
});

test('hook overlays append to existing session hooks and preserve other events without exposing commands',async()=>{
  const {context,calls}=fixture();const initial={matcher:'',hooks:[{type:'command',command:'original-private-command'}]};
  context.initialSettings={hooks:{PreToolUse:[initial],SessionStart:[initial]}};
  const incoming={PreToolUse:[{matcher:'Read',hooks:[{type:'command',command:'fixture-program',args:['a b']}]}]};
  await runAdminAction('hooks-overlay',{json:JSON.stringify(incoming),confirm:'yes'},context);
  assert.equal(calls[0][1].hooks.PreToolUse.length,2);assert.equal(calls[0][1].hooks.SessionStart.length,1);
  assert.ok(!JSON.stringify(await adminSnapshot('hooks',context)).includes('original-private-command'));
  await assert.rejects(runAdminAction('hooks-overlay',{json:'{"UnknownEvent":[]}',confirm:'yes'},context),/Unknown/);
  await assert.rejects(runAdminAction('hooks-overlay',{json:'{"PreToolUse":[{"hooks":[{"type":"command"}]}]}',confirm:'yes'},context),/explicit/);
});

test('marketplace and MCP OAuth actions use explicit native arguments without executing real account changes',async()=>{
  const {context,calls}=fixture();
  await runAdminAction('marketplace-list',{},context);
  await runAdminAction('marketplace-add',{source:'owner/repo',scope:'project',confirm:'yes'},context);
  await runAdminAction('marketplace-remove',{name:'fixture-market',scope:'local',confirm:'yes'},context);
  await runAdminAction('marketplace-update',{name:'fixture-market',confirm:'yes'},context);
  await runAdminAction('mcp-login',{name:'fixture',confirm:'yes'},context);
  assert.deepEqual(calls.map(c=>c[2]),[
    ['plugin','marketplace','list','--json'],['plugin','marketplace','add','--scope','project','--json','owner/repo'],
    ['plugin','marketplace','remove','--scope','local','--json','fixture-market'],['plugin','marketplace','update','--json','fixture-market'],['mcp','login','fixture']]);
  await assert.rejects(runAdminAction('marketplace-update',{confirm:'yes'},context),/name/);
  await assert.rejects(runAdminAction('marketplace-add',{source:'https://user:private@example.test',scope:'local',confirm:'yes'},context),/without credentials/);
});

test('Markdown edits require the preview hash, preserve a recovery backup and reject concurrent changes/shared files',async t=>{
  const home=await mkdtemp(join(tmpdir(),'claudapter-memory-edit-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const {context}=fixture();context.cwd=home;const path=join(home,'CLAUDE.md');await writeFile(path,'original\n');
  const preview=await runAdminAction('memory-preview',{path:'CLAUDE.md'},context);assert.match(preview.expectedHash,/^[0-9a-f]{64}$/);
  await writeFile(path,'concurrent\n');
  await assert.rejects(runAdminAction('memory-edit',{path:'CLAUDE.md',expectedHash:preview.expectedHash,content:'new',confirm:'yes'},context),/changed/);
  assert.equal(await readFile(path,'utf8'),'concurrent\n');
  const fresh=await runAdminAction('memory-preview',{path:'CLAUDE.md'},context);
  const saved=await runAdminAction('memory-edit',{path:'CLAUDE.md',expectedHash:fresh.expectedHash,content:'saved\n',confirm:'yes'},context);
  assert.equal(await readFile(path,'utf8'),'saved\n');assert.equal(await readFile(saved.backup,'utf8'),'concurrent\n');assert.notEqual(saved.expectedHash,fresh.expectedHash);
  await link(path,join(home,'shared.md'));
  await assert.rejects(runAdminAction('memory-edit',{path:'CLAUDE.md',expectedHash:saved.expectedHash,content:'bad',confirm:'yes'},context),/unshared/);
});

test('verified native getters expose live state with stable rule/hook identities and reject malformed replies',async()=>{
  const {context}=fixture();context.query.initializationResult=async()=>({claude_code_version:'2.1.301'});
  context.query.getSettings=async()=>({effective:{language:'live',env:{TOKEN:'fixture-private-token'}},sources:[],applied:{}});
  context.query.listPermissionRules=async()=>({state:{rules:[{rule:'Read',behavior:'allow',source:'userSettings',editability:'persistent'}],workspaceDirectories:[],managedOnly:false}});
  context.query.getHooksListing=async()=>({events:[],hooks:[{event:'Stop',source:'localSettings',editable:{matcher:'',config:{type:'command',command:'fixture',args:['--password','fixture-private-password','argument'],headers:{Authorization:'fixture-private-header'}}}}],policy:{}});
  context.query.getMemoryDialog=async()=>({files:['fixture.md'],folders:[],auto_memory:{enabled:true},auto_dream:{enabled:false}});
  context.query.getSkillsDialog=async()=>({skills:[{name:'native'}]});
  context.query.getStatus=async()=>({sections:[{title:'native'}]});
  context.query.getSandboxDialog=async()=>({supported:false,enabled:false});
  assert.equal((await adminSnapshot('config',context)).effective.language,'live');
  assert.ok(!JSON.stringify(await adminSnapshot('config',context)).includes('fixture-private-token'));
  const first=await adminSnapshot('permissions',context);assert.match(first.state.rules[0].id,/^[a-f0-9]{24}$/);
  assert.equal(first.state.rules[0].id,(await adminSnapshot('permissions',context)).state.rules[0].id);
  assert.match((await adminSnapshot('hooks',context)).hooks[0].id,/^[a-f0-9]{24}$/);
  const hooks=await adminSnapshot('hooks',context);assert.match(hooks.hooks[0].executionPreview,/fixture/);assert.match(hooks.hooks[0].executionPreview,/argument/);
  assert.ok(!JSON.stringify(hooks).includes('fixture-private'));
  assert.equal((await adminSnapshot('memory',context)).files[0],'fixture.md');assert.equal((await adminSnapshot('skills',context)).skills[0].name,'native');
  assert.equal((await adminSnapshot('status',context)).sections[0].title,'native');assert.equal((await adminSnapshot('sandbox',context)).supported,false);
  context.query.listPermissionRules=async()=>({state:{}});await assert.rejects(adminSnapshot('permissions',context),/Unexpected/);
});

test('private writers require the exact running and executable version before receiving stdin',async()=>{
  const {context,calls}=fixture();context.query.initializationResult=async()=>({claude_code_version:'2.1.301'});
  context.exec=async(file,args,options)=>{calls.push([args,options.input]);return {stdout:args[0]==='--version'?'2.1.301 (Claude Code)\n':'{"ok":true}',stderr:''};};
  await runAdminAction('permission-saved-add',{behavior:'ask',rule:'Read(fixture.md)',scope:'project',confirm:'yes'},context);
  assert.deepEqual(calls[0],[['--version'],undefined]);assert.deepEqual(JSON.parse(calls[1][1]),{op:'add',rules:['Read(fixture.md)'],behavior:'ask',destination:'projectSettings'});
  context.exec=async()=>({stdout:'2.1.999 (Claude Code)\n',stderr:''});
  await assert.rejects(runAdminAction('memory-saved-setting',{key:'autoMemoryEnabled',value:'false',scope:'user',confirm:'yes'},context),/compatibility requires/);
  await assert.rejects(runAdminAction('memory-saved-setting',{key:'autoMemoryEnabled',value:'false',scope:'local',confirm:'yes'},context),/only changes user/);
});

test('query-owned authentication stays in own dialogs and unsupported sandbox does not write',async()=>{
  const {context,calls}=fixture();context.query.initializationResult=async()=>({claude_code_version:'2.1.301'});
  context.query.claudeAuthenticate=async subscription=>{calls.push(['auth',subscription]);return {manualUrl:'https://claude.ai/oauth/authorize?state=fixture&code_challenge=challenge',automaticUrl:'https://claude.ai/oauth/authorize?state=fixture&code_challenge=challenge'};};
  context.query.mcpAuthenticate=async server=>{calls.push(['mcpAuth',server]);return {authUrl:'https://example.test/authorize?state=fixture',requiresUserAction:true,callbackExpected:true};};
  context.query.getSandboxDialog=async()=>({supported:false,enabled:false});
  const login=await runAdminAction('auth-login',{confirm:'yes'},context);assert.match(login.automaticUrl,/state=fixture&code_challenge=challenge/);
  assert.equal((await runAdminAction('mcp-login',{name:'fixture',confirm:'yes'},context)).requiresUserAction,true);
  assert.deepEqual(calls,[['auth',true],['mcpAuth','fixture']]);
  await assert.rejects(runAdminAction('sandbox-saved-mode',{mode:'regular',scope:'local',confirm:'yes'},context),/not available/);
  assert.equal(calls.length,2);
  const cliFixture=fixture();cliFixture.context.exec=async()=>({stdout:'https://localhost/callback?code=fixture-private-code&state=fixture',stderr:''});
  const callbackOutput=JSON.stringify(await runAdminAction('auth-status',{},cliFixture.context));assert.ok(!callbackOutput.includes('fixture-private-code'));assert.match(callbackOutput,/state=fixture/);
});

test('installed native writers edit only isolated settings and preserve unrelated entries',{skip:process.env.CLAUDAPTER_NATIVE_TEST!=='1',timeout:90000},async t=>{
  const home=await mkdtemp(join(tmpdir(),'claudapter-native-admin-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const cwd=join(home,'project'),claudeHome=join(home,'claude');await mkdir(join(cwd,'.claude'),{recursive:true});await mkdir(claudeHome);
  const localPath=join(cwd,'.claude','settings.local.json'),userPath=join(claudeHome,'settings.json');
  await writeFile(localPath,JSON.stringify({language:'English',permissions:{deny:['Bash(rm *)']}}));await writeFile(userPath,JSON.stringify({language:'German'}));
  const env={...process.env};for(const key of Object.keys(env))if(/^(?:ANTHROPIC_|CLAUDE_|CODEX_|CLAUDAPTER_)/.test(key)||key==='CLAUDECODE')delete env[key];
  Object.assign(env,{HOME:home,USERPROFILE:home,CLAUDE_CONFIG_DIR:claudeHome,CODEX_HOME:join(home,'codex'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'});
  const {context}=fixture();Object.assign(context,{cwd,claudePath:'claude',env,exec:undefined});
  context.query.initializationResult=async()=>({claude_code_version:'2.1.301'});
  const local=async()=>JSON.parse(await readFile(localPath,'utf8'));
  context.query.listPermissionRules=async()=>({state:{rules:Object.entries((await local()).permissions??{}).flatMap(([behavior,rules])=>rules.map(rule=>({behavior,rule,source:'localSettings',editability:'persistent'}))),workspaceDirectories:[],managedOnly:false}});
  context.query.getHooksListing=async()=>({events:[],eventCatalog:[],policy:{},hooks:Object.entries((await local()).hooks??{}).flatMap(([event,matchers])=>matchers.flatMap(matcher=>matcher.hooks.map(config=>({event,source:'localSettings',editable:{matcher:matcher.matcher??'',config}}))))});
  await runAdminAction('permission-saved-add',{behavior:'ask',rule:'Read(fixture.md)',scope:'local',confirm:'yes'},context);
  const permissions=await adminSnapshot('permissions',context);const rule=permissions.state.rules.find(row=>row.behavior==='ask');
  await runAdminAction('permission-saved-remove',{ruleId:rule.id,scope:'local',confirm:'yes'},context);
  assert.deepEqual((await local()).permissions.deny,['Bash(rm *)']);assert.ok(!(await local()).permissions.ask?.length);
  await runAdminAction('memory-saved-setting',{key:'autoMemoryEnabled',value:'false',scope:'user',confirm:'yes'},context);
  assert.deepEqual(JSON.parse(await readFile(userPath,'utf8')),{language:'German',autoMemoryEnabled:false});
  await runAdminAction('skill-saved-state',{name:'fixture-skill',state:'off',scope:'local',confirm:'yes'},context);
  assert.equal((await local()).skillOverrides['fixture-skill'],'off');
  const hook={type:'command',command:'node',args:['-e','process.exit(0)']};
  await runAdminAction('hook-saved-add',{event:'Stop',matcher:'',hook:JSON.stringify(hook),scope:'local',confirm:'yes'},context);
  const hooks=await adminSnapshot('hooks',context);assert.equal(hooks.hooks.length,1);
  await runAdminAction('hook-saved-replace',{hookId:hooks.hooks[0].id,event:'Stop',matcher:'',hook:JSON.stringify({...hook,timeout:5}),scope:'local',confirm:'yes'},context);
  await assert.rejects(runAdminAction('hook-saved-remove',{hookId:hooks.hooks[0].id,scope:'local',confirm:'yes'},context),/stale/);
  const fresh=await adminSnapshot('hooks',context);await runAdminAction('hook-saved-remove',{hookId:fresh.hooks[0].id,scope:'local',confirm:'yes'},context);
  assert.equal((await adminSnapshot('hooks',context)).hooks.length,0);assert.equal((await local()).language,'English');
  if(process.platform==='win32') {
    context.query.getSandboxDialog=async()=>({supported:true,enabled:false});
    await assert.rejects(runAdminAction('sandbox-saved-mode',{mode:'regular',scope:'local',confirm:'yes'},context),/Sandboxing is not available/);
    assert.equal((await local()).sandbox,undefined,'the native writer must refuse unsupported Windows sandboxing without writing');
  }
});

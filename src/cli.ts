#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CodexAuth } from './auth.js';
import { buildRegistry } from './models.js';
import { loadConfig, saveConfig, configHome } from './config.js';
import { launch } from './launcher.js';
import { TOKEN_HEADER } from './gateway.js';
import { VERSION } from './version.js';

async function main() {
  const args=process.argv.slice(2); const config=await loadConfig();
  if(args[0]==='tui'){const {runTui}=await import('./tui/app.js');process.exitCode=await runTui(args.slice(1)[0]==='--'?args.slice(2):args.slice(1),config);return;}
  if(args[0]==='usage'){const {readUsage,formatUsage}=await import('./usage-client.js');const usage=await readUsage(config,args.includes('--refresh'));console.log(args.includes('--json')?JSON.stringify(usage,null,2):formatUsage(usage));return;}
  if(args[0]==='--') {process.exitCode=await launch(args.slice(1),config);return;}
  const auth=new CodexAuth();
  if(args[0]==='--version') {console.log(VERSION);return;}
  if(args[0]==='--help'||args[0]==='help') {
    console.log('Claudapter — Your Claude Code. Your choice of models.\n\nclaudapter [-- <native Claude arguments>]\nclaudapter tui [-- <Claude arguments>]\nclaudapter usage [--refresh] [--json]\nclaudapter setup\nclaudapter models | providers | doctor\nclaudapter provider add\nclaudapter agents enable <ChatGPT model ID>\nclaudapter fallback show\nclaudapter fallback reset <session runtime ID> [conversation ID] [agent ID]\nclaudapter sessions\n\nFallback is off by default. Edit trusted '+join(configHome(),'config.json')+' to enable explicit rules.\nUse /model then s in native mode; the custom TUI model picker is session-only.');return;
  }
  // PowerShell's npm .ps1 shim can consume the boundary; native flags remain unambiguous.
  if(args[0]?.startsWith('-')) {process.exitCode=await launch(args,config);return;}
  if(['models','providers','doctor','setup'].includes(args[0])) {
    const registry=await buildRegistry(config,auth);
    if(args[0]==='models') {console.log(JSON.stringify(registry.list(),null,2));return;}
    if(args[0]==='providers') {console.log(JSON.stringify({claude:{enabled:config.claude,auth:'Managed by Claude Code'},chatgpt:{enabled:config.chatgpt,auth:await auth.status(),storage:'Read-only file; official Codex owns refresh'},compatible:config.providers.map(p=>({id:p.id,baseUrl:p.baseUrl,auth:process.env[p.keyEnv]?'configured':'missing'}))},null,2));return;}
    let claude:any={installed:false};
    try {const version=await promisify(execFile)('claude',['--version'],{windowsHide:true});const status=JSON.parse((await promisify(execFile)('claude',['auth','status'],{windowsHide:true})).stdout);claude={version:version.stdout.trim(),authenticated:status.loggedIn,method:status.authMethod};} catch {}
    console.log(JSON.stringify({node:process.version,claude,chatgpt:await auth.status(),models:registry.list().length,config:join(configHome(),'config.json'),fallbackRules:config.fallback.filter(r=>r.enabled).length,agents:config.agents,
      notes:['ChatGPT keyring-only storage unsupported. Claudapter never refreshes or writes shared tokens.','Maximum model context is applied through temporary per-model native settings. Catalog entries are not live availability proof.','Use claudapter usage or TUI /usage for actual-provider accounting; native cost estimates are not invoices.']},null,2));
    if(args[0]==='setup') {await saveConfig(config);console.log('Configuration ready. If needed, use official `claude auth login` and `codex login`. No global Claude settings were changed.');}
    return;
  }
  if(args[0]==='agents'&&args[1]==='enable') {
    const registry=await buildRegistry(config,auth);const model=registry.resolve(args[2]??'');
    if(model.provider!=='chatgpt') throw new Error('Choose an explicit ChatGPT model from `claudapter models`.');
    config.agents={...config.agents,'gpt-implementer':model.id,'gpt-reviewer':model.id};await saveConfig(config);console.log('Enabled session-scoped claudapter:gpt-implementer and claudapter:gpt-reviewer. Delegation still requires an explicit user request.');return;
  }
  if(args[0]==='provider'&&args[1]==='add') {
    if(!stdin.isTTY) throw new Error('provider add needs an interactive terminal; alternatively edit the documented config schema.');
    const rl=createInterface({input:stdin,output:stdout});
    try {
      const id=await rl.question('Provider ID: ');const baseUrl=await rl.question('Anthropic-compatible HTTPS base URL: ');
      const keyEnv=await rl.question('Environment variable containing its key (not the key itself): ');
      const model=await rl.question('Model ID: ');const context=Number(await rl.question('Documented context capacity in tokens: '));
      const tools=(await rl.question('Supports tools? [yes/no]: '))==='yes';const vision=(await rl.question('Supports image input? [yes/no]: '))==='yes';
      config.providers.push({id,baseUrl,keyEnv,models:[{id:model,context,tools,vision}]});await saveConfig(config);
      console.log('Provider configured. No credentials were stored and no inference was requested.');
    } finally{rl.close();}return;
  }
  if(args[0]==='fallback'&&args[1]==='show') {console.log(JSON.stringify(config.fallback,null,2));return;}
  if(args[0]==='sessions') {
    const files=await readdir(join(configHome(),'run')).catch(()=>[]);
    for(const file of files) {const run=JSON.parse(await readFile(join(configHome(),'run',file),'utf8'));console.log(JSON.stringify({id:run.id,pid:run.pid}));}return;
  }
  if(args[0]==='fallback'&&args[1]==='reset') {
    if(!/^[a-f0-9-]{36}$/.test(args[2]??'')) throw new Error('Use a runtime ID from `claudapter sessions`.');
    const run=JSON.parse(await readFile(join(configHome(),'run',args[2]+'.json'),'utf8'));
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(run.baseUrl)) throw new Error('Invalid runtime endpoint.');
    const response=await fetch(run.baseUrl+'/reset',{method:'POST',headers:{[TOKEN_HEADER]:run.token},body:JSON.stringify({session:args[3],agent:args[4]}),signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error('Reset failed.');console.log('Fallback cooldown and interrupted-turn state reset for the selected scope.');return;
  }
  if(args.length) throw new Error('Unknown Claudapter command. Put native Claude arguments after --.');
  process.exitCode=await launch([],config);
}
main().catch(e=>{console.error('Claudapter: '+e.message);process.exitCode=1;});

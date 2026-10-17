#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CodexAuth } from './auth.js';
import { buildRegistry } from './models.js';
import { loadConfig, saveConfig, configHome, PROFILE_NAME } from './config.js';
import { activateProfile, addProfile, extractProfileFlag, profileClaudeHome, profileCodexHome, profileOverview, readProfile, removeProfile, requireProfile } from './profiles.js';
import { launch } from './launcher.js';
import { TOKEN_HEADER } from './gateway.js';
import { mergePreset, presetFor, PROVIDER_PRESETS } from './provider-presets.js';
import { VERSION } from './version.js';

/** Runs an official interactive login with the profile's home; the official CLI alone owns refresh. */
async function runLogin(command: string, loginArgs: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const code=await new Promise<number>((resolve,reject)=>{
    const child=spawn(command,loginArgs,{stdio:'inherit',env,shell:process.platform==='win32'});
    child.once('error',reject); child.once('exit',c=>resolve(c??1));
  });
  if(code!==0) throw new Error(command+' login exited with '+code+'.');
}
async function loginProfile(name: string): Promise<void> {
  const record=await requireProfile(name);
  console.log('Starting the Claude login for profile "'+name+'"; finish it in the opened flow.');
  await runLogin('claude',['auth','login'],{...process.env,CLAUDE_CONFIG_DIR:profileClaudeHome(name)});
  if(record.codex) {
    console.log('Starting the ChatGPT/Codex login for profile "'+name+'".');
    await runLogin('codex',['login'],{...process.env,CODEX_HOME:profileCodexHome(name)});
  }
  console.log('Profile "'+name+'" is ready. Use it with: claudapter --profile '+name);
}

async function main() {
  const {args,profile:flagged}=extractProfileFlag(process.argv.slice(2)); const config=await loadConfig();
  // Profile management must stay usable when a configured default profile is broken or being removed.
  if(args[0]!=='profile') {
    const profile=flagged!==undefined?(flagged==='none'?undefined:flagged):config.profile;
    if(profile!==undefined) await activateProfile(profile);
  }
  if(args[0]==='tui'){const {runTui}=await import('./tui/launch.js');process.exitCode=await runTui(args.slice(1)[0]==='--'?args.slice(2):args.slice(1));return;}
  if(args[0]==='usage'){const {readUsage,formatUsage}=await import('./usage-client.js');const usage=await readUsage(config,args.includes('--refresh'));console.log(args.includes('--json')?JSON.stringify(usage,null,2):formatUsage(usage));return;}
  if(args[0]==='--') {process.exitCode=await launch(args.slice(1),config);return;}
  const auth=new CodexAuth();
  if(args[0]==='--version') {console.log(VERSION);return;}
  if(args[0]==='--help'||args[0]==='help') {
    console.log('Claudapter — Your Claude Code. Your choice of models.\n\nclaudapter [--profile <name>|none] [-- <native Claude arguments>]\nclaudapter tui [--profile <name>|none] [-- <Claude arguments>]\nclaudapter usage [--refresh] [--json]\nclaudapter setup\nclaudapter models | providers | doctor\nclaudapter profile add|login|list|remove|default <name>\nclaudapter provider add ['+PROVIDER_PRESETS.map(p=>p.id).join('|')+']\nclaudapter agents enable <ChatGPT model ID>\nclaudapter fallback show\nclaudapter fallback reset <session runtime ID> [conversation ID] [agent ID]\nclaudapter sessions\n\nA profile is a second Claude (and optionally ChatGPT) account under '+join(configHome(),'profiles')+'.\nModel ids like sonnet@<profile> route a Claude model through that account, in /model or as a fallback target.\nFallback is off by default. Edit trusted '+join(configHome(),'config.json')+' to enable explicit rules.\nUse /model then s in native mode; the custom TUI model picker is session-only.');return;
  }
  // PowerShell's npm .ps1 shim can consume the boundary; native flags remain unambiguous.
  if(args[0]?.startsWith('-')) {process.exitCode=await launch(args,config);return;}
  if(['models','providers','doctor','setup'].includes(args[0])) {
    const registry=await buildRegistry(config,auth);
    if(args[0]==='models') {console.log(JSON.stringify(registry.list(),null,2));return;}
    if(args[0]==='providers') {console.log(JSON.stringify({claude:{enabled:config.claude,auth:'Managed by Claude Code'},chatgpt:{enabled:config.chatgpt,auth:await auth.status(),storage:'Read-only file; official Codex owns refresh'},compatible:config.providers.map(p=>({id:p.id,baseUrl:p.baseUrl,auth:process.env[p.keyEnv]?'configured':'missing'}))},null,2));return;}
    let claude:any={installed:false};
    try {const version=await promisify(execFile)('claude',['--version'],{windowsHide:true});const status=JSON.parse((await promisify(execFile)('claude',['auth','status'],{windowsHide:true})).stdout);claude={version:version.stdout.trim(),authenticated:status.loggedIn,method:status.authMethod};} catch {}
    console.log(JSON.stringify({node:process.version,claude,chatgpt:await auth.status(),activeProfile:process.env.CLAUDAPTER_PROFILE??'native',profiles:await profileOverview(config.profile),models:registry.list().length,config:join(configHome(),'config.json'),fallbackRules:config.fallback.filter(r=>r.enabled).length,agents:config.agents,
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
      const preset=args[2]?presetFor(args[2]):undefined;
      if(args[2]&&!preset) throw new Error('Unknown provider preset: '+args[2]+'. Available: '+PROVIDER_PRESETS.map(p=>p.id).join(', ')+'.');
      if(preset) {
        console.log(preset.label+'\nBase URL: '+preset.baseUrl+'\nSet the key before use: '+preset.keyEnv);
        preset.models.forEach((m,i)=>console.log('  '+(i+1)+'. '+m.id+' · '+m.context+' tokens'+(m.vision?' · vision':'')));
        const selection=await rl.question('Models to enable (comma numbers or all): ');
        const ids=selection.trim().toLowerCase()==='all'?preset.models.map(m=>m.id):
          selection.split(',').map(n=>preset.models[Number(n.trim())-1]?.id).filter(Boolean);
        await saveConfig(mergePreset(config,preset,ids));
        console.log('Provider "'+preset.id+'" configured with '+ids.length+' model(s). No credentials were stored and no inference was requested.');
        return;
      }
      console.log('Presets: '+PROVIDER_PRESETS.map(p=>p.id+' ('+p.baseUrl+')').join(', ')+'\nEmpty input below starts the manual wizard.');
      const id=await rl.question('Provider ID: ');const baseUrl=await rl.question('Anthropic-compatible HTTPS base URL: ');
      const keyEnv=await rl.question('Environment variable containing its key (not the key itself): ');
      const model=await rl.question('Model ID: ');const context=Number(await rl.question('Documented context capacity in tokens: '));
      const tools=(await rl.question('Supports tools? [yes/no]: '))==='yes';const vision=(await rl.question('Supports image input? [yes/no]: '))==='yes';
      config.providers.push({id,baseUrl,keyEnv,models:[{id:model,context,tools,vision}]});await saveConfig(config);
      console.log('Provider configured. No credentials were stored and no inference was requested.');
    } finally{rl.close();}return;
  }
  if(args[0]==='fallback'&&args[1]==='show') {console.log(JSON.stringify(config.fallback,null,2));return;}
  if(args[0]==='profile') {
    const action=args[1]; const name=args[2];
    if(action==='list') {const overviews=await profileOverview(config.profile);
      console.log(overviews.length?JSON.stringify(overviews,null,2):'No profiles yet. Create one with: claudapter profile add <name>');return;}
    if(action==='default') {
      if(!name||name==='--clear') {delete config.profile;await saveConfig(config);console.log('Default profile cleared. Claudapter uses the native homes again.');return;}
      await requireProfile(name);config.profile=name;await saveConfig(config);
      console.log('Profile "'+name+'" is the default. Override per launch with --profile <name> or --profile none.');return;
    }
    if(!name||name==='none'||!PROFILE_NAME.test(name)) throw new Error('Profile names are lowercase slugs of letters, digits and dashes; "none" is reserved.');
    if(action==='add') {
      if(!stdin.isTTY) throw new Error('profile add needs an interactive terminal.');
      const rl=createInterface({input:stdin,output:stdout});
      try {
        if(await readProfile(name)) throw new Error('Profile "'+name+'" already exists; remove it first or pick another name.');
        console.log('A profile keeps its own Claude login, sessions and settings under '+join(configHome(),'profiles',name)+'.');
        const codex=(await rl.question('Also use a separate ChatGPT/Codex login for this profile? [yes/no]: '))==='yes';
        await addProfile(name,codex);
        console.log('Profile "'+name+'" created.');
        if((await rl.question('Start its Claude login now? [yes/no]: '))==='yes') await loginProfile(name);
        else console.log('Log in later with: claudapter profile login '+name);
      } finally {rl.close();}
      return;
    }
    if(action==='login') {if(!stdin.isTTY) throw new Error('profile login needs an interactive terminal.');await loginProfile(name);return;}
    if(action==='remove') {
      if(!stdin.isTTY) throw new Error('profile remove needs an interactive terminal; it deletes the profile home.');
      await requireProfile(name);
      const rl=createInterface({input:stdin,output:stdout});
      let confirmed=false;
      try {confirmed=(await rl.question('Delete profile "'+name+'" including its logins and sessions? [yes/no]: '))==='yes';} finally {rl.close();}
      if(!confirmed) {console.log('Cancelled.');return;}
      await removeProfile(name);
      if(config.profile===name) {delete config.profile;await saveConfig(config);}
      console.log('Profile "'+name+'" removed.');return;
    }
    throw new Error('Usage: claudapter profile add|login|list|remove|default <name>');
  }
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

import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CodexAuth } from './auth.js';
import { buildRegistry, nativeContextSettings, type Registry } from './models.js';
import { startGateway, TOKEN_HEADER, type RouteEvent } from './gateway.js';
import { configHome, type Config } from './config.js';
import { VERSION } from './version.js';

async function readSettings(path: string) { try{return JSON.parse(await readFile(path,'utf8'));}catch(e:any){if(e.code==='ENOENT')return {};throw new Error('Cannot parse settings: '+path);} }
export async function prepareSettings(args: string[], registry: Registry, config: Config, cwd=process.cwd()) {
  const nativeHome=process.env.CLAUDE_CONFIG_DIR ?? join(homedir(),'.claude');
  const user=await readSettings(join(nativeHome,'settings.json'));
  let explicit: any={}; const forwarded: string[]=[];
  for(let i=0;i<args.length;i++) {
    const value=args[i];
    if(value==='--'){forwarded.push(...args.slice(i));break;}
    if(value==='--settings' || value.startsWith('--settings=')) {
      const input=value==='--settings'?args[++i]:value.slice(11);
      if(!input) throw new Error('--settings requires a file or JSON.');
      explicit=input.trim().startsWith('{')?JSON.parse(input):await readSettings(resolve(cwd,input));
    } else forwarded.push(value);
  }
  const project=await readSettings(join(cwd,'.claude','settings.json')),local=await readSettings(join(cwd,'.claude','settings.local.json'));
  const nativeSources=[user,project,local,explicit];
  for(let i=0;i<forwarded.length;i++) {
    if(forwarded[i]==='--agents' && Object.keys(JSON.parse(forwarded[i+1]??'{}')).some(name=>name.startsWith('claudapter:')))
      throw new Error('Explicit agents collide with the reserved claudapter plugin namespace.');
    if(forwarded[i]==='--plugin-dir' && forwarded[i+1]) {
      const path=resolve(cwd,forwarded[i+1]);
      if((await stat(path).catch(()=>undefined))?.isDirectory()) {
        const manifest=await readSettings(join(path,'.claude-plugin','plugin.json'));
        if(manifest.name==='claudapter')throw new Error('An explicit plugin already uses the claudapter namespace.');
      }
    }
  }
  for(const source of nativeSources) {
    if(source.env && Object.keys(source.env).some(k=>/^(ANTHROPIC_BASE_URL|ANTHROPIC_CUSTOM_HEADERS|CLAUDAPTER_|CLAUDE_CODE_USE_|CLAUDE_CODE_SUBAGENT_MODEL)/.test(k)))
      throw new Error('Native settings contain a conflicting gateway/provider/agent environment override. Resolve it explicitly.');
    if(Object.entries(source.enabledPlugins??{}).some(([k,v])=>v===true&&(k==='claudapter'||k.startsWith('claudapter@')))) throw new Error('A claudapter plugin is already enabled; avoid duplicate session integration.');
  }
  const enabled=config.fallback.some(r=>r.enabled);
  if(enabled && (args.some(a=>a.startsWith('--fallback-model')) || nativeSources.some(s=>s.fallbackModel?.length)))
    throw new Error('Native fallback and Claudapter fallback cannot own the same launch. Remove the native fallback chain or disable Claudapter rules.');
  const picker=explicit.modelPicker??user.modelPicker??{};
  const options=[...(picker.options??[])];
  for(const m of registry.list().filter(m=>m.provider!=='anthropic')) if(!options.some(o=>o.model===m.id)) options.push({model:m.id,label:m.label,description:m.provider+'; catalog entry, not guaranteed availability'});
  const context=nativeContextSettings(registry);
  const modelSettings={...explicit.modelSettings};
  for(const [id,window] of Object.entries(context.modelSettings)) modelSettings[id]={...user.modelSettings?.[id],...project.modelSettings?.[id],...local.modelSettings?.[id],...explicit.modelSettings?.[id],...window};
  return {args:forwarded,settings:{...explicit,env:{...explicit.env,...context.env},modelSettings,modelPicker:{...picker,options,replaceBuiltInOptions:config.claude?picker.replaceBuiltInOptions??false:true},...(enabled?{fallbackModel:[]}: {})}};
}

export interface SessionDependencies {fetch?: typeof fetch; onEvent?: (event: RouteEvent)=>void; quiet?: boolean}

/** Native stderr routing notices: quiet sessions stay silent, route deviations (fallback,
 *  interrupted output) always log, routine per-request routing only with CLAUDAPTER_ROUTE_LOG=1
 *  (or CLAUDAPTER_TRACE=1, which subsumes it for diagnostics). Returns the line, or nothing to log. */
export function nativeRouteLogger(quiet: boolean): (event: RouteEvent) => string | undefined {
  if (quiet) return () => undefined;
  const routine = process.env.CLAUDAPTER_ROUTE_LOG === '1' || process.env.CLAUDAPTER_TRACE === '1';
  return event => {
    if (event.event !== 'fallback' && event.event !== 'interrupted' && !(routine && event.event === 'request')) return;
    return '[Claudapter] '+(event.agent?'agent '+event.agent:'main')+': '+event.requested+' -> '+event.provider+'/'+event.actual+(event.reason?' ('+event.reason+')':'')+'\n';
  };
}

export async function prepareSession(args: string[], config: Config, dependencies: SessionDependencies = {}) {
  const version=(await promisify(execFile)('claude',['--version'],{windowsHide:true})).stdout.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!version || Number(version[1])<2 || (Number(version[1])===2 && (Number(version[2])<1 || Number(version[2])===1 && Number(version[3])<301)))
    throw new Error('Claudapter requires Claude Code 2.1.301 or newer for tested attribution and session integration.');
  for(const key of ['ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_USE_MANTLE'])
    if(process.env[key]) throw new Error(key+' conflicts with the Claudapter gateway.');
  if(process.env.CLAUDE_CODE_SUBAGENT_MODEL && Object.keys(config.agents).length) throw new Error('CLAUDE_CODE_SUBAGENT_MODEL would override configured agents; unset it explicitly.');
  if(process.env.ANTHROPIC_CUSTOM_HEADERS?.toLowerCase().includes(TOKEN_HEADER)) throw new Error('Reserved Claudapter authentication header already exists.');
  const auth=new CodexAuth(); const registry=await buildRegistry(config,auth);
  const prepared=await prepareSettings(args,registry,config);
  const dir=await mkdtemp(join(tmpdir(),'claudapter-'));
  const runtimeId=randomUUID();
  const runtimeFile=join(configHome(),'run',runtimeId+'.json');
  const routeLog=nativeRouteLogger(dependencies.quiet??false);
  const trace=!dependencies.quiet&&process.env.CLAUDAPTER_TRACE==='1';
  const gateway=await startGateway({registry,auth,config,fetch:dependencies.fetch,
    onEvent:e=>{
      dependencies.onEvent?.(e);
      const line=routeLog(e);if(line)process.stderr.write(line);
      if(trace)process.stderr.write('[Claudapter trace] '+JSON.stringify(e)+'\n');
    },
    refresh:async()=>{
      const fresh=await buildRegistry(config,auth);
      for(const old of registry.list()) if(old.provider==='chatgpt'&&!fresh.entries.has(old.id)) registry.entries.delete(old.id);
      for(const model of fresh.list()) {const old=registry.entries.get(model.id);registry.entries.set(model.id,{...model,verifiedAt:old?.verifiedAt,availability:old?.availability,unavailableUntil:old?.unavailableUntil,
        ...(old?.availability==='auth_failed'?{auth:old.auth}:{}),...(model.auth!=='authenticated'&&model.provider==='chatgpt'?{availability:'auth_failed',verifiedAt:undefined}:{})});}
    }});
  try {
    await mkdir(dirname(runtimeFile),{recursive:true,mode:0o700});
    await writeFile(runtimeFile,JSON.stringify({id:runtimeId,pid:process.pid,baseUrl:gateway.baseUrl,token:gateway.token}),{mode:0o600});
    const plugin=join(dir,'plugin'); await mkdir(join(plugin,'.claude-plugin'),{recursive:true});
    await mkdir(join(plugin,'hooks')); await mkdir(join(plugin,'agents'));
    await writeFile(join(plugin,'.claude-plugin','plugin.json'),JSON.stringify({name:'claudapter',version:VERSION,description:'Session-scoped model discovery and opt-in agents'}));
    const integration=fileURLToPath(new URL('./integration.js',import.meta.url));
    const command=(process.platform==='win32'?'& ':'')+'"'+process.execPath.replaceAll('\\','/')+'" "'+integration.replaceAll('\\','/')+'" hook';
    const hook={type:'command',command,timeout:10,...(process.platform==='win32'?{shell:'powershell'}:{})};
    await writeFile(join(plugin,'hooks','hooks.json'),JSON.stringify({hooks:Object.fromEntries(['SessionStart','UserPromptSubmit','SubagentStart','PostToolUse'].map(event=>[event,[{hooks:[hook]}]]))}));
    await writeFile(join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{discovery:{command:process.execPath,args:[integration]}}}));
    for(const [name,model] of Object.entries(config.agents)) await writeFile(join(plugin,'agents',name+'.md'),
      '---\nname: '+name+'\ndescription: '+(name.includes('review')?'Review':'Implement')+' only when the user explicitly requests this agent.\nmodel: '+model+'\n---\nUse the requested backend '+model+'. Complete only the assigned task. Preserve permissions. Return concrete evidence and limitations. Do not delegate further.\n');
    const settings=join(dir,'settings.json'); await writeFile(settings,JSON.stringify(prepared.settings));
    const childEnv={...process.env,...nativeContextSettings(registry).env,ANTHROPIC_BASE_URL:gateway.baseUrl,
      ANTHROPIC_CUSTOM_HEADERS:[process.env.ANTHROPIC_CUSTOM_HEADERS,TOKEN_HEADER+': '+gateway.token].filter(Boolean).join('\n'),
      CLAUDE_CODE_GATEWAY_HINT_HEADERS:'1',CLAUDAPTER_GATEWAY_URL:gateway.baseUrl,CLAUDAPTER_GATEWAY_TOKEN:gateway.token};
    if(!config.claude) Object.assign(childEnv,{ANTHROPIC_AUTH_TOKEN:'claudapter-local-only'});
    let disposed=false;
    return {gateway,registry,auth,config,runtimeId,plugin,settings,settingsObject:prepared.settings,args:prepared.args,env:childEnv,claudeVersion:version[0],
      async close() {
        if(disposed)return;disposed=true;
        try {
          const usage=gateway.manifest().usage;
          if(usage.attempts.length) {
            const history=join(configHome(),'usage');await mkdir(history,{recursive:true,mode:0o700});
            await writeFile(join(history,runtimeId+'.json'),JSON.stringify(usage),{mode:0o600});
          }
        } finally {await gateway.close();await rm(runtimeFile,{force:true});await rm(dir,{recursive:true,force:true});}
      }};
  } catch(error) {await gateway.close();await rm(runtimeFile,{force:true});await rm(dir,{recursive:true,force:true});throw error;}
}

export type PreparedSession = Awaited<ReturnType<typeof prepareSession>>;

export async function installedClaudePath(): Promise<string> {
  const result=await promisify(execFile)(process.platform==='win32'?'where.exe':'which',['claude'],{windowsHide:true});
  const paths=result.stdout.trim().split(/\r?\n/);
  return (process.platform==='win32'?paths.find(path=>path.toLowerCase().endsWith('.exe')):paths[0])??'claude';
}

export async function launch(args: string[], config: Config, dependencies: SessionDependencies = {}): Promise<number> {
  const session=await prepareSession(args,config,dependencies);
  try {
    if(!dependencies.quiet)process.stderr.write('Claudapter session '+session.runtimeId+'. /model: press s to switch without saving your default.\n');
    const child=spawn('claude',[...session.args,'--settings',session.settings,'--plugin-dir',session.plugin],{stdio:'inherit',shell:false,windowsHide:true,env:session.env});
    const stop=()=>{child.kill('SIGTERM');};
    process.on('SIGTERM',stop);
    // The attached terminal delivers Ctrl+C to Claude too; allow its native turn cancellation.
    const interrupt=()=>{}; process.on('SIGINT',interrupt);
    try {return await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal==='SIGINT'?130:1)));});}
    finally{process.off('SIGTERM',stop);process.off('SIGINT',interrupt);}
  } finally {await session.close();}
}

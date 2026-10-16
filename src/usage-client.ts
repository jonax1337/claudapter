import { readFile,readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { configHome,type Config } from './config.js';
import { CodexAuth } from './auth.js';
import { QuotaReader,type UsageSnapshot } from './usage.js';
import { TOKEN_HEADER } from './gateway.js';

export async function readUsage(config:Config,refresh=false){
  const active:{id:string;usage:UsageSnapshot}[]=[];
  for(const file of await readdir(join(configHome(),'run')).catch(()=>[])){
    if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
    try{
      const run=JSON.parse(await readFile(join(configHome(),'run',file),'utf8'));
      if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(run.baseUrl)||typeof run.token!=='string')continue;
      const response=await fetch(run.baseUrl+(refresh?'/usage/refresh':'/usage'),{method:refresh?'POST':'GET',headers:{[TOKEN_HEADER]:run.token},signal:AbortSignal.timeout(15000)});
      if(response.ok)active.push({id:run.id,usage:await response.json() as UsageSnapshot});
    }catch{/* Stale runtime records are not active sessions. */}
  }
  const history=join(configHome(),'usage');
  const files=await readdir(history).catch(()=>[]);
  const candidates=await Promise.all(files.filter(file=>/^[a-f0-9-]{36}\.json$/.test(file)&&!active.some(a=>a.id+'.json'===file)).map(async file=>({file,time:(await stat(join(history,file))).mtimeMs})));
  candidates.sort((a,b)=>b.time-a.time);
  const saved:{id:string;usage:UsageSnapshot}[]=[];
  for(const {file} of candidates.slice(0,10))try{saved.push({id:file.slice(0,-5),usage:JSON.parse(await readFile(join(history,file),'utf8'))});}catch{}
  const reader=new QuotaReader(config,new CodexAuth());
  if(refresh&&!active.length)await reader.refresh();
  return {scope:'Claudapter traffic only; last 10 closed gateway sessions and currently running gateways. Account quota windows have provider-defined scope.',active,saved,
    providers:active.length?active[0].usage.providers:reader.snapshot()};
}

export function formatUsage(report:Awaited<ReturnType<typeof readUsage>>):string{
  const lines=['Claudapter usage',report.scope,''];
  for(const provider of report.providers){
    lines.push(provider.provider+': '+provider.state+(provider.stale?' (stale)':''));
    for(const window of provider.windows)lines.push('  '+(window.label??window.id)+': '+(window.usedPercent===null?'unknown':window.usedPercent+'% used')+(window.resetsAt?' · resets '+window.resetsAt:''));
    if(provider.reason)lines.push('  '+provider.reason);
  }
  for(const session of [...report.active,...report.saved]){
    lines.push('','Session '+session.id+' · '+session.usage.since);
    for(const total of session.usage.totals)lines.push('  '+total.provider+'/'+total.actualModel+' ['+(total.agent??total.requestClass??'main')+']: '+(total.tokens?(total.tokens.input??'unknown')+' input · '+(total.tokens.output??'unknown')+' output':'usage unknown')+(total.unknown?' · '+total.unknown+' unmeasured attempts':'')+(total.interrupted?' · '+total.interrupted+' interrupted':''));
  }
  lines.push('','Dollar amounts are unavailable unless reported authoritatively; subscription token counts are not invoices.');return lines.join('\n');
}

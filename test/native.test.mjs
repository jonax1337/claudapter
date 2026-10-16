import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startGateway,TOKEN_HEADER } from '../dist/gateway.js';
import { Registry } from '../dist/models.js';
import { defaults } from '../dist/config.js';

test('installed Claude cannot replay a truncated tool stream (fixture accounts only)',{skip:process.env.CLAUDAPTER_NATIVE_TEST!=='1',timeout:100000},async t=>{
  const dir=join(process.env.CLAUDE_CONFIG_DIR,'native project');await mkdir(dir,{recursive:true});
  await writeFile(join(process.env.CLAUDE_CONFIG_DIR,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true}));
  await writeFile(join(dir,'increment.mjs'),'import{appendFileSync}from"node:fs";appendFileSync("counter.txt","x");');
  let calls=0;
  const registry=new Registry([{id:'gpt-test',upstream:'gpt-test',provider:'chatgpt',label:'fixture',tools:true,vision:false,efforts:[],context:500000,source:'fixture',auth:'authenticated'}]);
  const gateway=await startGateway({registry,auth:{status:async()=>'authenticated',credentials:async()=>({accessToken:'fixture',accountId:'fixture'})},fetch:async()=>{
    calls++;return new Response('data: '+JSON.stringify({type:'response.output_item.done',item:{type:'function_call',call_id:'call_once',name:'Bash',arguments:JSON.stringify({command:'node increment.mjs',description:'fixture counter'})}})+'\n\n', {headers:{'content-type':'text/event-stream'}});
  }});t.after(()=>gateway.close());
  const child=spawn('claude',['-p','Call Bash to run node increment.mjs once.','--model','gpt-test','--output-format','json','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--allowedTools','Bash(node *)','--permission-mode','dontAsk'],{
    cwd:dir,windowsHide:true,env:{...process.env,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_BASE_URL:gateway.baseUrl,ANTHROPIC_AUTH_TOKEN:'fixture',ANTHROPIC_CUSTOM_HEADERS:TOKEN_HEADER+': '+gateway.token,CLAUDE_CODE_GATEWAY_HINT_HEADERS:'1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();
  t.after(()=>child.kill());const timer=setTimeout(()=>child.kill(),90000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  assert.notEqual(code,0);assert.equal(calls,1);const counter=await readFile(join(dir,'counter.txt'),'utf8').catch(()=>'');assert.ok(counter.length<=1,'tool side effect must never execute twice');
  assert.match(output,/interrupted|replay|stream/i);
});

test('installed native and gateway fallback have separate bounded owners',{skip:process.env.CLAUDAPTER_NATIVE_TEST!=='1',timeout:190000},async t=>{
  for(const ownPolicy of [false,true]) {
  const dir=join(process.env.CLAUDE_CONFIG_DIR,'native fallback');await mkdir(dir,{recursive:true});
  const calls=[];
  const registry=new Registry([{id:'gpt-test',upstream:'gpt-test',provider:'chatgpt',label:'fixture',tools:true,vision:false,efforts:[],context:500000,source:'fixture',auth:'authenticated'}]);
  const config={...defaults(),fallback:ownPolicy?[{enabled:true,from:'claude-sonnet-5-5',targets:['gpt-test'],scopes:['main'],errors:['unavailable'],retries:0,timeoutMs:10000,cooldownMs:1000}]:[]};
  const gateway=await startGateway({registry,config,auth:{status:async()=>'authenticated',credentials:async()=>({accessToken:'fixture',accountId:'fixture'})},fetch:async(url,init)=>{
    const body=JSON.parse(init.body);calls.push(body.model);
    if(body.model.startsWith('claude-')||ownPolicy)return Response.json({type:'error',error:{type:'overloaded_error',message:'SIMULATED outage'}},{status:529});
    return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'NATIVE_FALLBACK_OK'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{model:'gpt-test',usage:{input_tokens:1,output_tokens:1}}})+'\n\n');
  }});t.after(()=>gateway.close());
  const child=spawn('claude',['-p','Reply OK.','--model','sonnet',...(!ownPolicy?['--fallback-model','gpt-test']:[]),'--tools','','--output-format','json','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'],{
    cwd:dir,windowsHide:true,env:{...process.env,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_BASE_URL:gateway.baseUrl,ANTHROPIC_AUTH_TOKEN:'fixture',ANTHROPIC_CUSTOM_HEADERS:TOKEN_HEADER+': '+gateway.token,CLAUDE_CODE_GATEWAY_HINT_HEADERS:'1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();t.after(()=>child.kill());
  const timer=setTimeout(()=>child.kill(),90000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  if(ownPolicy) {assert.notEqual(code,0);assert.equal(calls.length,2,JSON.stringify(calls));assert.match(output,/exhausted|replay/i);}
  else {assert.equal(code,0);assert.match(output,/NATIVE_FALLBACK_OK/);assert.equal(calls.length,4,JSON.stringify(calls));assert.ok(calls.slice(0,3).every(m=>m.startsWith('claude-')));assert.equal(calls[3],'gpt-test');}
  }
});

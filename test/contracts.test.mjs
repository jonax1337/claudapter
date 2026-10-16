import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexAuth } from '../dist/auth.js';
import { validateConfig,defaults } from '../dist/config.js';
import { Registry,chatgptModels } from '../dist/models.js';
import { FallbackState,classify,assertCompatible,retryDelay } from '../dist/fallback.js';
import { prepareSettings } from '../dist/launcher.js';
import { toResponsesRequest,TurnTranslator,readServerSentEvents } from '../dist/translate.js';
const rule={enabled:true,from:'a',targets:['b'],scopes:['main'],errors:['rate_limit'],retries:0,timeoutMs:1000,cooldownMs:1000};
const jwt=exp=>'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.fixture';

test('credentials are reread without writes, account changes refused, expired tokens rejected',async()=>{
  await mkdir(process.env.CODEX_HOME,{recursive:true});const path=join(process.env.CODEX_HOME,'auth.json');
  const save=async(account,exp)=>writeFile(path,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt(exp),account_id:account}}));
  await save('fixture',Date.now()/1000+300);const auth=new CodexAuth();const before=await readFile(path,'utf8');await auth.credentials();assert.equal(await readFile(path,'utf8'),before);
  await save('fixture',Date.now()/1000+500);assert.notEqual((await auth.credentials()).accessToken,JSON.parse(before).tokens.access_token);
  await save('other',Date.now()/1000+500);await assert.rejects(auth.credentials(),/account changed/);
  await save('fixture',1);assert.equal(await auth.status(),'expired');
});
test('unsupported storage is reported without accessing a keychain or inventing login',async()=>{
  const auth=new CodexAuth(join(process.env.CODEX_HOME,'absent'));assert.equal(await auth.status(),'missing');
});
test('strict config rejects unknown fields, unbounded retry loops, unsafe URLs and credential reuse',()=>{
  for(const change of [{secret:'no'},{fallback:[{...rule,retries:100}]},{fallback:[{...rule,targets:['a']}]},{fallback:[{...rule,scopes:['unknown-agent']}]}])assert.throws(()=>validateConfig({...defaults(),...change}));
  const p={id:'vendor',baseUrl:'http://localhost',keyEnv:'VENDOR_KEY',models:[{id:'vendor-model',context:5000,tools:true,vision:false}]};
  assert.throws(()=>validateConfig({...defaults(),providers:[p]}),/HTTPS/);
  assert.throws(()=>validateConfig({...defaults(),providers:[{...p,baseUrl:'https://example.com',keyEnv:'ANTHROPIC_API_KEY'}]}),/credentials/);
  assert.throws(()=>validateConfig({...defaults(),fallback:[rule,rule]}),/Overlapping/);
});
test('model registry detects collisions and never routes unknown non-Claude IDs',()=>{
  const m={id:'fixture',provider:'chatgpt'};assert.throws(()=>new Registry([m,m]),/Duplicate/);assert.throws(()=>new Registry().resolve('typo'),/Unknown/);
  assert.throws(()=>new Registry([{id:'claude-sonnet-5-5',provider:'vendor'}]),/reserved/);
});
test('catalog carries freshness, does not advertise hidden rows or claim live verification',async()=>{
  await mkdir(process.env.CODEX_HOME,{recursive:true});await writeFile(join(process.env.CODEX_HOME,'models_cache.json'),JSON.stringify({fetched_at:'2020-01-01',models:[{slug:'visible',context_window:12345},{slug:'hidden',visibility:'hide'}]}));
  const models=await chatgptModels('expired');assert.equal(models.length,1);assert.equal(models[0].auth,'expired');assert.equal(models[0].verifiedAt,undefined);assert.equal(models[0].fetchedAt,'2020-01-01');
});
test('cooldown expires, explicit selection resets route, new prompts release interrupted turn',()=>{
  const state=new FallbackState([rule]);const main={session:'s',requestClass:'main',prompt:'p'};
  state.set(main,'a','b',1000,'rate_limit');assert.equal(state.route(main,'a'),'b');assert.equal(state.route(main,'a',Date.now()+2000),'a');
  state.set(main,'a','b',1000,'rate_limit');assert.equal(state.route(main,'c'),'c');assert.equal(state.routes.size,0);
  state.block(main);assert.equal(state.isBlocked(main),true);assert.equal(state.isBlocked({...main,prompt:'new'}),false);
});
test('revoked fallback authorization immediately releases cooldown but keeps the replay guard',()=>{
  const rules=[structuredClone(rule)],state=new FallbackState(rules),main={session:'s',requestClass:'main',prompt:'p'};
  state.set(main,'a','b',10000,'rate_limit');state.block(main);rules[0].enabled=false;
  assert.equal(state.route(main,'a'),'a');assert.equal(state.isBlocked(main),true);
  rules[0].enabled=true;state.set(main,'a','b',10000,'rate_limit');rules[0].targets=['c'];
  assert.equal(state.route(main,'a'),'a');assert.equal(state.isBlocked(main),true);
});
test('classification excludes billing and respects Retry-After, context bounds never truncate',()=>{
  assert.equal(classify(429,{error:{type:'billing_error'}}),undefined);assert.equal(classify(429,{error:{type:'rate_limit_error'}}),'rate_limit');assert.equal(classify(503,{error:{type:'api_error'}}),'unavailable');
  assert.equal(classify(429,{error:{type:'rate_limit_error',message:'This credential is only authorized for Claude Code'}}),undefined);
  assert.equal(retryDelay('2'),2000);assert.equal(retryDelay(new Date(10000).toUTCString(),5000),5000);
  const body={messages:[{role:'user',content:'a'.repeat(10000)}],max_tokens:100};assert.throws(()=>assertCompatible(body,{context:1000}),/capacity/);
  assert.throws(()=>assertCompatible({tools:[{}]},{context:500000,tools:false}),/tools/);
  assert.throws(()=>assertCompatible({messages:[{type:'image'}]},{context:500000,vision:true}),/multimodal/);
});
test('explicit settings and picker rows survive composition without writing native files',async()=>{
  await mkdir(process.env.CLAUDE_CONFIG_DIR,{recursive:true});const path=join(process.env.CLAUDE_CONFIG_DIR,'settings.json');
  await writeFile(path,JSON.stringify({modelPicker:{options:[{model:'existing',label:'Keep'}]},permissions:{deny:['Bash']},hooks:{Stop:[]}}));const before=await readFile(path,'utf8');
  const registry=new Registry([{id:'gpt-test',label:'GPT',provider:'chatgpt',context:500000}]);
  const explicit={permissions:{allow:['Read']},hooks:{Stop:[{hooks:[]}]},mcp:{keep:true}};
  const prepared=await prepareSettings(['--resume','session','--settings',JSON.stringify(explicit)],registry,defaults());
  assert.deepEqual(prepared.args,['--resume','session']);assert.deepEqual(prepared.settings.permissions,explicit.permissions);assert.deepEqual(prepared.settings.hooks,explicit.hooks);
  assert.deepEqual(prepared.settings.modelPicker.options.map(o=>o.model),['existing','gpt-test']);assert.equal(await readFile(path,'utf8'),before);
  await assert.rejects(prepareSettings(['--fallback-model','sonnet'],registry,{...defaults(),fallback:[rule]}),/cannot own/);
  await assert.rejects(prepareSettings(['--agents','{"claudapter:gpt-reviewer":{}}'],registry,defaults()),/collide/);
  const plugin=join(process.env.CLAUDE_CONFIG_DIR,'plugin');await mkdir(join(plugin,'.claude-plugin'),{recursive:true});await writeFile(join(plugin,'.claude-plugin','plugin.json'),'{"name":"claudapter"}');
  await assert.rejects(prepareSettings(['--plugin-dir',plugin],registry,defaults()),/namespace/);
});
test('tool choice, prior thinking, error tool results and unsupported blocks are explicit',()=>{
  const opts={model:'fixture',sessionId:'fixture'};
  const req={messages:[{role:'assistant',content:[{type:'thinking',thinking:'check arithmetic'}]}],tools:[{name:'Read'}],tool_choice:{type:'tool',name:'Read'},output_config:{effort:'high'}};
  const result=toResponsesRequest(req,opts);assert.equal(result.tool_choice.name,'Read');assert.equal(result.reasoning.effort,'high');assert.match(result.input[0].content[0].text,/check arithmetic/);
  const failure=toResponsesRequest({messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'call',is_error:true,content:'Permission denied'}]}]},opts);
  assert.match(failure.input[0].output,/Tool execution failed: Permission denied/);
  for(const type of ['document','redacted_thinking','server_tool_use','future_block'])assert.throws(()=>toResponsesRequest({messages:[{role:'user',content:[{type}]}]},opts),/Unsupported/);
  assert.throws(()=>toResponsesRequest({...req,tool_choice:{type:'tool',name:'Missing'}},opts),/not available/);
  assert.throws(()=>toResponsesRequest({...req,output_config:{format:{type:'json_schema'}}},opts),/Structured/);
  const translator=new TurnTranslator('fixture');assert.throws(()=>translator.handle({type:'response.output_item.done',item:{type:'function_call',call_id:'c',name:'Write',arguments:'{broken'}}));
  assert.throws(()=>new TurnTranslator('fixture').handle({type:'response.completed',response:{usage:{}}}),/token usage/);
});
test('SSE handles split CRLF, multiple data lines and rejects malformed or truncated frames',async()=>{
  const stream=(chunks)=>new ReadableStream({start(c){for(const s of chunks)c.enqueue(new TextEncoder().encode(s));c.close();}});
  const items=[];for await(const item of readServerSentEvents(stream(['data: {"type":\r','\ndata: "ok"}\r\n\r','\n'])))items.push(item);assert.deepEqual(items,[{type:'ok'}]);
  for(const bad of ['data: {bad}\n\n','data: {"unfinished":'])await assert.rejects(async()=>{for await(const _ of readServerSentEvents(stream([bad]))){};});
});

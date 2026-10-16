import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startGateway,TOKEN_HEADER } from '../dist/gateway.js';
import { Registry } from '../dist/models.js';
import { defaults } from '../dist/config.js';
const model={id:'gpt-test',upstream:'gpt-test',provider:'chatgpt',label:'fixture',context:500000,tools:true,vision:true,efforts:['medium'],source:'fixture',auth:'authenticated'};
const rule={enabled:true,from:'claude-sonnet-test',targets:['gpt-test'],scopes:['main','gpt-reviewer'],errors:['rate_limit','unavailable'],retries:0,timeoutMs:3000,cooldownMs:60000};
const auth={credentials:async()=>({accessToken:'fixture-codex-secret',accountId:'fixture-account'}),status:async()=>'authenticated'};
const frame=(value)=>'data: '+JSON.stringify(value)+'\n\n';
const completion=()=>frame({type:'response.output_text.delta',delta:'OK'})+frame({type:'response.completed',response:{model:'gpt-test',usage:{input_tokens:12,output_tokens:2,input_tokens_details:{cached_tokens:5}}}});
async function fixture(t,{fallback=[],handler,models=[{...model}],config={},options={}}={}) {
  const requests=[];
  const upstream=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({headers:req.headers,body:JSON.parse(raw),url:req.url});
    if(handler)return handler(req,res,requests);
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(completion());});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const registry=new Registry(models);
  const gateway=await startGateway({registry,auth,config:{...defaults(),agents:{'gpt-reviewer':'gpt-test'},fallback,...config},fetch:(url,init)=>fetch('http://127.0.0.1:'+upstream.address().port+new URL(url).pathname,init),...options});
  t.after(async()=>{await gateway.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
  const send=(body={},headers={})=>fetch(gateway.baseUrl+'/v1/messages',{method:'POST',headers:{[TOKEN_HEADER]:gateway.token,'x-claude-code-session-id':'session-a','x-claude-code-request-class':'main','x-claude-code-prompt-id':'prompt-a',authorization:'Bearer fixture-claude-secret',...headers},body:JSON.stringify({model:'gpt-test',messages:[{role:'user',content:'test'}],max_tokens:128,...body})});
  return {gateway,requests,send,registry};
}
const fail=(res,status=429,type='rate_limit_error')=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{type,message:'fixture rejection'}}));};

test('local authentication happens before parsing or spending credentials',async t=>{
  const f=await fixture(t);const r=await f.send({}, {[TOKEN_HEADER]:'wrong'});assert.equal(r.status,401);assert.equal(f.requests.length,0);
});
test('unknown models, invalid JSON and unsupported routes fail locally',async t=>{
  const f=await fixture(t);assert.equal((await f.send({model:'foreign-unknown'})).status,400);
  const r=await fetch(f.gateway.baseUrl+'/v1/messages',{method:'POST',headers:{[TOKEN_HEADER]:f.gateway.token},body:'{'});assert.equal(r.status,400);
  assert.equal((await fetch(f.gateway.baseUrl+'/admin',{headers:{[TOKEN_HEADER]:f.gateway.token}})).status,404);assert.equal(f.requests.length,0);
});
test('GPT uses only its credential; usage is non-cached input plus cached input',async t=>{
  const f=await fixture(t);const response=await (await f.send()).json();assert.equal(response.content[0].text,'OK');
  assert.deepEqual(response.usage,{input_tokens:7,output_tokens:2,cache_read_input_tokens:5});
  const h=f.requests[0].headers;assert.equal(h.authorization,'Bearer fixture-codex-secret');assert.equal(h[TOKEN_HEADER],undefined);assert.equal(h['x-api-key'],undefined);
  assert.ok(!JSON.stringify(f.gateway.manifest()).includes('fixture-codex-secret'));
});
test('Claude passthrough preserves body and OAuth beta while dropping local/foreign headers',async t=>{
  const f=await fixture(t,{handler:(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"content":[]}');}});
  const body={model:'claude-sonnet-test',system:[{type:'text',text:'attribution'}],thinking:{type:'adaptive'},extra_field:{keep:true}};
  await (await f.send(body,{'anthropic-beta':'oauth-beta,unknown-beta','x-foreign-secret':'never','x-app':'cli'})).text();
  assert.equal(f.requests[0].headers.authorization,'Bearer fixture-claude-secret');assert.equal(f.requests[0].headers['anthropic-beta'],'oauth-beta,unknown-beta');assert.equal(f.requests[0].headers['x-foreign-secret'],undefined);
  for(const [key,value]of Object.entries(body))assert.deepEqual(f.requests[0].body[key],value);
  assert.equal(f.requests[0].headers['x-app'],'cli');
});
test('fallback disabled returns the original rejection without switching',async t=>{
  const f=await fixture(t,{handler:(_,res)=>fail(res)});const r=await f.send({model:'claude-sonnet-test'});assert.equal(r.status,429);assert.equal(r.headers.get('x-should-retry'),'false');assert.equal(f.requests.length,1);
});
test('eligible rejection switches, holds cooldown, isolates agents and supports scoped reset',async t=>{
  const f=await fixture(t,{fallback:[rule],config:{agents:{'gpt-reviewer':'claude-sonnet-test'}},handler:(_,res,requests)=>requests.at(-1).body.model.startsWith('claude')?fail(res):res.end(completion())});
  assert.equal((await f.send({model:'claude-sonnet-test'})).status,200);
  const initialCooldown={...f.gateway.state.routes.get('session-a/main')};
  await (await f.send({model:'claude-sonnet-test'})).text();assert.equal(f.requests.filter(r=>r.body.model.startsWith('claude')).length,1);
  assert.deepEqual(f.gateway.state.routes.get('session-a/main'),initialCooldown,'successful cooldown requests must not postpone recovery or erase the reason');
  assert.equal((await f.send({model:'claude-sonnet-test'},{'x-claude-code-agent-id':'other','x-claude-code-request-class':'subagent'})).status,429);
  f.gateway.state.register('session-a','reviewer','gpt-reviewer');
  assert.equal((await f.send({model:'claude-sonnet-test'},{'x-claude-code-agent-id':'reviewer','x-claude-code-request-class':'subagent'})).status,200);
  assert.equal(f.gateway.state.routes.size,2);f.gateway.state.reset('session-a','reviewer');assert.equal(f.gateway.state.routes.size,1);
  assert.ok(f.gateway.events.some(e=>e.event==='fallback'&&e.reason==='rate_limit'&&e.actual==='gpt-test'));
});
test('no attribution and auxiliary requests never inherit main fallback',async t=>{
  const f=await fixture(t,{fallback:[rule],handler:(_,res)=>fail(res)});
  for(const headers of [{'x-claude-code-session-id':''},{'x-claude-code-request-class':'auxiliary'}])assert.equal((await f.send({model:'claude-sonnet-test'},headers)).status,429);
  assert.equal(f.requests.length,2);
});
test('auth, billing, policy and invalid request failures never fall back',async t=>{
  for(const [status,type] of [[401,'authentication_error'],[403,'permission_error'],[429,'billing_error'],[400,'invalid_request_error'],[503,'policy_denial']]) {
    const f=await fixture(t,{fallback:[rule],handler:(_,res)=>fail(res,status,type)});assert.equal((await f.send({model:'claude-sonnet-test'})).status,status);assert.equal(f.requests.length,1);
  }
});
test('exhausted chain is bounded and incompatible target never receives history',async t=>{
  const f=await fixture(t,{fallback:[rule],handler:(_,res)=>fail(res)});assert.equal((await f.send({model:'claude-sonnet-test'})).status,429);assert.equal(f.requests.length,2);
  const g=await fixture(t,{fallback:[rule],models:[{...model,context:100}],handler:(_,res)=>fail(res)});assert.equal((await g.send({model:'claude-sonnet-test'})).status,400);assert.equal(g.requests.length,1);
});
test('partial text cannot trigger fallback or replay under another model in the same prompt',async t=>{
  const f=await fixture(t,{fallback:[{...rule,from:'gpt-test',targets:['claude-sonnet-test']}],handler:(_,res)=>res.end(frame({type:'response.output_text.delta',delta:'partial'}))});
  const first=await(await f.send({stream:true})).text();assert.match(first,/Interrupted upstream/);
  assert.equal((await f.send({model:'claude-sonnet-test',stream:true})).status,400);assert.equal(f.requests.length,1);
  assert.ok(f.gateway.events.some(e=>e.event==='interrupted'));
});
test('tool call followed by a truncated stream is never replayed',async t=>{
  const f=await fixture(t,{handler:(_,res)=>res.end(frame({type:'response.output_item.done',item:{type:'function_call',call_id:'call1',name:'Write',arguments:'{"path":"test"}'}}))});
  const first=await(await f.send({stream:true})).text();assert.match(first,/tool_use/);assert.match(first,/Interrupted/);
  assert.equal((await f.send({stream:true})).status,400);assert.equal(f.requests.length,1);
});
test('malformed stream before output fails without invented success',async t=>{
  const f=await fixture(t,{handler:(_,res)=>res.end('data: {broken}\n\n')});const r=await f.send();assert.equal(r.status,400);assert.equal(f.requests.length,1);
});
test('compatible provider replaces credentials and cannot receive OAuth/local headers',async t=>{
  process.env.FIXTURE_PROVIDER_KEY='fixture-compatible-secret';t.after(()=>delete process.env.FIXTURE_PROVIDER_KEY);
  const f=await fixture(t,{models:[{...model,id:'other-model',upstream:'vendor-model',provider:'vendor'}],config:{providers:[{id:'vendor',baseUrl:'https://vendor.invalid/anthropic',keyEnv:'FIXTURE_PROVIDER_KEY',models:[]}]},handler:(_,res)=>res.end('{"content":[]}')});
  await(await f.send({model:'other-model'},{'anthropic-beta':'oauth-2025,tools-beta','x-api-key':'claude-key'})).text();
  assert.equal(f.requests[0].body.model,'vendor-model');assert.equal(f.requests[0].headers.authorization,'Bearer fixture-compatible-secret');assert.equal(f.requests[0].headers['x-api-key'],undefined);assert.equal(f.requests[0].headers['anthropic-beta'],'tools-beta');
});
test('two simultaneous gateways cannot cross route state or local authorization',async t=>{
  const a=await fixture(t),b=await fixture(t);
  const responses=await Promise.all([a.send(),b.send()]);assert.ok(responses.every(r=>r.status===200));
  assert.notEqual(a.gateway.token,b.gateway.token);assert.equal((await a.send({}, {[TOKEN_HEADER]:b.gateway.token})).status,401);
});
test('oversized input is rejected before an upstream request',async t=>{
  const f=await fixture(t);const r=await f.send({messages:[{role:'user',content:'x'.repeat(17*1024*1024)}]});assert.equal(r.status,413);assert.equal(f.requests.length,0);
});
test('upstream timeout stops the request without fallback',async t=>{
  const f=await fixture(t,{options:{timeoutMs:50},handler:()=>{}});const r=await f.send();assert.equal(r.status,400);assert.equal(f.requests.length,1);
});
test('client cancellation aborts upstream work and gateway shutdown releases its port',async t=>{
  let aborted=false;
  const f=await fixture(t,{options:{fetch:async(url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Aborted'));},{once:true}))}});
  const controller=new AbortController();const pending=fetch(f.gateway.baseUrl+'/v1/messages',{method:'POST',headers:{[TOKEN_HEADER]:f.gateway.token},body:JSON.stringify({model:'gpt-test',messages:[]}),signal:controller.signal}).catch(()=>{});
  await new Promise(r=>setTimeout(r,30));controller.abort();await pending;await new Promise(r=>setTimeout(r,30));assert.equal(aborted,true);
});
test('failed auth invalidates availability and registered agents cannot silently use another model',async t=>{
  const f=await fixture(t,{options:{auth:{status:async()=>'expired'}}});assert.equal((await f.send()).status,401);assert.equal(f.registry.resolve('gpt-test').availability,'auth_failed');assert.equal(f.requests.length,0);
  f.gateway.state.register('session-a','reviewer','gpt-reviewer');assert.equal((await f.send({model:'claude-sonnet-test'},{'x-claude-code-agent-id':'reviewer','x-claude-code-request-class':'subagent'})).status,409);
});
test('read-only discovery refresh exposes state without credential material',async t=>{
  let refreshed=false;const f=await fixture(t,{options:{refresh:async()=>{refreshed=true;}}});
  const r=await fetch(f.gateway.baseUrl+'/refresh',{method:'POST',headers:{[TOKEN_HEADER]:f.gateway.token}});const body=await r.text();assert.equal(refreshed,true);assert.ok(!body.includes('fixture-codex-secret'));assert.match(body,/Only delegate/);
});
test('bounded retries cannot multiply and long Retry-After skips the exhausted primary',async t=>{
  const f=await fixture(t,{fallback:[{...rule,retries:2}],handler:(_,res)=>fail(res)});
  assert.equal((await f.send({model:'claude-sonnet-test'})).status,429);assert.equal(f.requests.length,6);
  assert.equal((await f.send({model:'claude-sonnet-test'})).status,400);assert.equal(f.requests.length,6,'native retries must not multiply the exhausted gateway chain');
  const g=await fixture(t,{fallback:[{...rule,retries:2}],handler:(_,res,requests)=>{
    if(requests.at(-1).body.model.startsWith('claude')){res.setHeader('retry-after','3600');fail(res);}else res.end(completion());
  }});
  assert.equal((await g.send({model:'claude-sonnet-test'})).status,200);assert.equal(g.requests.length,2);
  assert.ok(g.gateway.state.routes.get('session-a/main').until>Date.now()+3500000);
});
test('content refusal remains a response, not an availability fallback trigger',async t=>{
  const f=await fixture(t,{fallback:[{...rule,from:'gpt-test',targets:['claude-sonnet-test']}],handler:(_,res)=>res.end(frame({type:'response.refusal.delta',delta:'Cannot assist with that request.'})+frame({type:'response.completed',response:{model:'gpt-test',usage:{input_tokens:1,output_tokens:1}}}))});
  const result=await(await f.send()).json();assert.equal(result.content[0].text,'Cannot assist with that request.');assert.equal(f.requests.length,1);assert.equal(f.gateway.events.filter(e=>e.event==='fallback').length,0);
});

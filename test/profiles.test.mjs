import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway,TOKEN_HEADER } from '../dist/gateway.js';
import { Registry,buildRegistry,nativeContextSettings } from '../dist/models.js';
import { defaults,validateConfig } from '../dist/config.js';
import { ClaudeAccountAuth,activateProfile,addProfile,extractProfileFlag,listProfiles,profileClaudeHome,readProfile,removeProfile,requireProfile,splitAccountModel } from '../dist/profiles.js';

async function isolatedHome(t) {
  const home=await mkdtemp(join(tmpdir(),'claudapter-profiles-'));
  process.env.CLAUDAPTER_HOME=home;
  t.after(async()=>{for(const key of ['CLAUDAPTER_HOME','CLAUDE_CONFIG_DIR','CODEX_HOME','CLAUDAPTER_PROFILE'])delete process.env[key];
    await rm(home,{recursive:true,force:true});});
  return home;
}
const loginFixture=async(name,expiresAt=new Date(Date.now()+3600_000).toISOString())=>{
  await mkdir(profileClaudeHome(name),{recursive:true});
  await writeFile(join(profileClaudeHome(name),'.credentials.json'),
    JSON.stringify({claudeAiOauth:{accessToken:'fixture-account-'+name+'-secret',expiresAt}}));
};
const anthropicModel=id=>({id,upstream:id,provider:'anthropic',label:id,tools:true,vision:true,efforts:[],source:'fixture',auth:'unknown'});
const accountModel=id=>({id,upstream:id.slice(0,id.lastIndexOf('@')),provider:'anthropic@'+id.slice(id.lastIndexOf('@')+1),
  label:id,tools:true,vision:true,efforts:[],source:'fixture',auth:'unknown'});

test('profile lifecycle: add, list, duplicate and reserved names, remove',async t=>{
  await isolatedHome(t);
  await addProfile('work',false);
  assert.equal((await readProfile('work')).codex,false);
  await assert.rejects(()=>addProfile('work',true),/already exists/);
  await assert.rejects(()=>addProfile('none',false),/reserved/);
  await assert.rejects(()=>addProfile('Bad_Name',false),/slugs/);
  assert.deepEqual((await listProfiles()).map(p=>p.name),['work']);
  await removeProfile('work');
  assert.deepEqual(await listProfiles(),[]);
  await assert.rejects(()=>requireProfile('work'),/Unknown profile: work/);
});

test('activateProfile points the process at the profile homes and refuses foreign env homes',async t=>{
  await isolatedHome(t);
  await addProfile('work',true);
  await activateProfile('work');
  assert.equal(process.env.CLAUDE_CONFIG_DIR,profileClaudeHome('work'));
  assert.equal(process.env.CODEX_HOME,join(process.env.CLAUDAPTER_HOME,'profiles','work','codex'));
  assert.equal(process.env.CLAUDAPTER_PROFILE,'work');
  process.env.CLAUDE_CONFIG_DIR=join(tmpdir(),'elsewhere');
  await assert.rejects(()=>activateProfile('work'),/never switches accounts silently/);
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CODEX_HOME=join(tmpdir(),'elsewhere');
  await assert.rejects(()=>activateProfile('work'),/CODEX_HOME is already set/);
});

test('ClaudeAccountAuth reads only unexpired file credentials',async t=>{
  await isolatedHome(t);
  await addProfile('work',false);
  const auth=new ClaudeAccountAuth(profileClaudeHome('work'));
  assert.equal(await auth.status(),'missing');
  await loginFixture('work');
  assert.equal(await auth.accessToken(),'fixture-account-work-secret');
  assert.equal(await auth.status(),'authenticated');
  await loginFixture('work',new Date(Date.now()-1000).toISOString());
  assert.equal(await auth.status(),'expired');
});

test('model@profile ids split, resolve and stay reserved to Claude bases',async t=>{
  await isolatedHome(t);
  assert.deepEqual(splitAccountModel('sonnet@work'),{base:'sonnet',profile:'work'});
  assert.equal(splitAccountModel('plain-model'),undefined);
  assert.equal(splitAccountModel('model@NotAProfile'),undefined);
  const registry=new Registry([anthropicModel('sonnet'),{id:'gpt-test',upstream:'gpt-test',provider:'chatgpt',label:'fixture',context:500000,tools:true,vision:true,efforts:[],source:'fixture',auth:'authenticated'}]);
  const routed=registry.resolve('sonnet@work');
  assert.equal(routed.provider,'anthropic@work');
  assert.equal(routed.upstream,'sonnet');
  assert.equal(routed.label,'sonnet · work');
  const versioned=registry.resolve('claude-sonnet-5-5@work');
  assert.equal(versioned.provider,'anthropic@work');
  assert.equal(versioned.upstream,'claude-sonnet-5-5');
  assert.throws(()=>registry.resolve('gpt-test@work'),/only to Claude models/);
});

test('buildRegistry registers account aliases with their login status',async t=>{
  await isolatedHome(t);
  await addProfile('work',false);
  const offline=await buildRegistry({...defaults(),chatgpt:false,claude:true},{status:async()=>'missing',home:'/nonexistent'});
  assert.equal(offline.resolve('sonnet@work').auth,'missing');
  await loginFixture('work');
  const online=await buildRegistry({...defaults(),chatgpt:false,claude:true},{status:async()=>'missing',home:'/nonexistent'});
  assert.equal(online.resolve('sonnet@work').auth,'authenticated');
  const claudeOff=await buildRegistry({...defaults(),chatgpt:false,claude:false},{status:async()=>'missing',home:'/nonexistent'});
  assert.throws(()=>claudeOff.resolve('sonnet'),/Unknown model/);
});

test('account models keep native context handling and pass the config validation',async t=>{
  await isolatedHome(t);
  await addProfile('work',false);
  const registry=await buildRegistry({...defaults(),chatgpt:false,claude:true},{status:async()=>'missing',home:'/nonexistent'});
  const external=nativeContextSettings(registry);
  assert.equal(external.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,undefined,'account models must not fake an external ceiling');
  assert.ok(validateConfig({...defaults(),profile:'work'}));
  assert.throws(()=>validateConfig({...defaults(),profile:'Not Ok'}),/slug/);
});

test('extractProfileFlag strips the flag before the native boundary only',async t=>{
  assert.deepEqual(extractProfileFlag(['--profile','work','--','--model','x']),{args:['--','--model','x'],profile:'work'});
  assert.deepEqual(extractProfileFlag(['tui','--profile=work','--resume','id']),{args:['tui','--resume','id'],profile:'work'});
  assert.deepEqual(extractProfileFlag(['--','--profile','work']),{args:['--','--profile','work'],profile:undefined});
  assert.deepEqual(extractProfileFlag(['--profile','none']),{args:[],profile:'none'});
  assert.throws(()=>extractProfileFlag(['--profile']),/requires a profile name/);
  assert.throws(()=>extractProfileFlag(['--profile','NOPE']),/slugs/);
});

function accountFixture(models,fallback=[]) {
  return async t=>{
    await isolatedHome(t);
    await addProfile('work',false);
    await loginFixture('work');
    const requests=[];
    const upstream=createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      if(req.url.includes('/usage')){res.writeHead(200,{'content-type':'application/json'});return res.end('{}');}
      const body=JSON.parse(raw);requests.push({headers:req.headers,body});
      if(body.model.startsWith('claude-sonnet-x')) {
        res.writeHead(429,{'content-type':'application/json'});
        return res.end(JSON.stringify({error:{type:'rate_limit_error',message:'fixture limit'}}));
      }
      res.writeHead(200,{'content-type':'application/json'});res.end('{"content":[],"model":"'+body.model+'"}');
    });
    upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
    const registry=new Registry(models);
    const gateway=await startGateway({registry,auth:{credentials:async()=>{throw new Error('unused');},status:async()=>'authenticated'},
      config:{...defaults(),fallback},fetch:(url,init)=>fetch('http://127.0.0.1:'+upstream.address().port+new URL(url).pathname,init)});
    t.after(async()=>{await gateway.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
    const send=(model,headers={})=>fetch(gateway.baseUrl+'/v1/messages',{method:'POST',
      headers:{[TOKEN_HEADER]:gateway.token,'x-claude-code-session-id':'session-a','x-claude-code-request-class':'main',
        authorization:'Bearer fixture-native-claude-secret','anthropic-beta':'oauth-2025-04-20',...headers},
      body:JSON.stringify({model,messages:[{role:'user',content:'long '.repeat(20000)}],max_tokens:128})});
    return {requests,send,gateway};
  };
}

test('a profile account speaks with its own token while keeping native Claude headers',async t=>{
  const f=await (accountFixture([anthropicModel('claude-sonnet-x'),accountModel('sonnet@work')]))(t);
  const response=await f.send('sonnet@work');
  assert.equal(response.status,200);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].headers.authorization,'Bearer fixture-account-work-secret');
  assert.equal(f.requests[0].headers['anthropic-beta'],'oauth-2025-04-20');
  assert.equal(f.requests[0].body.model,'sonnet','the upstream sees the base Claude model id');
  assert.ok(!JSON.stringify(f.gateway.manifest()).includes('fixture-account-work-secret'));
  assert.ok(!JSON.stringify(f.gateway.manifest()).includes('fixture-native-claude-secret'));
});

test('rate-limited Claude falls back onto the profile account and reset restores the native account',async t=>{
  const rule={enabled:true,from:'claude-sonnet-x',targets:['sonnet@work'],scopes:['main'],errors:['rate_limit','unavailable'],retries:0,timeoutMs:3000,cooldownMs:60000};
  const f=await (accountFixture([anthropicModel('claude-sonnet-x'),accountModel('sonnet@work')],[rule]))(t);
  assert.equal((await f.send('claude-sonnet-x')).status,200);
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].headers.authorization,'Bearer fixture-native-claude-secret');
  assert.equal(f.requests[1].headers.authorization,'Bearer fixture-account-work-secret');
  assert.ok(f.gateway.events.some(e=>e.event==='fallback'&&e.actual==='sonnet@work'&&e.reason==='rate_limit'));
  f.gateway.state.reset('session-a');
  await (await f.send('claude-sonnet-x')).text();
  assert.equal(f.requests.filter(r=>r.body.model==='claude-sonnet-x').length,2,'reset restores the native account');
});

test('missing or expired account credentials stop with an explicit recovery hint',async t=>{
  const f=await (accountFixture([accountModel('sonnet@work')]))(t);
  await rm(join(profileClaudeHome('work'),'.credentials.json'),{force:true});
  const missing=await f.send('sonnet@work');
  assert.equal(missing.status,401);
  assert.match((await missing.json()).error.message,/claudapter profile login work/);
  await loginFixture('work',new Date(Date.now()-1000).toISOString());
  const expired=await f.send('sonnet@work');
  assert.equal(expired.status,401);
  assert.match((await expired.json()).error.message,/claudapter profile login work/);
  assert.equal(f.requests.length,0,'no request ever leaves without valid account credentials');
});

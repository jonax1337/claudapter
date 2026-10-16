import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLedger, normalizeUsage, QuotaReader, quotaWindows } from '../dist/usage.js';
import { defaults } from '../dist/config.js';

const scope={provider:'chatgpt',requestedModel:'claude-test',actualModel:'gpt-test',upstreamModel:'gpt-test',session:'s',agent:'a',requestClass:'subagent'};
const raw={input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:10}};
const auth={credentials:async()=>({accessToken:'fixture-codex',accountId:'fixture-account'})};
const quota={rate_limit:{primary_window:{used_percent:37,reset_at:1800000000,limit_window_seconds:18000}},
  additional_rate_limits:[{limit_name:'Special model',metered_feature:'special',rate_limit:{secondary_window:{used_percent:0,reset_at:1800000001,limit_window_seconds:604800}}}]};

test('normalization preserves total input and nested counts without double-counting cache or reasoning',()=>{
  assert.deepEqual(normalizeUsage('chatgpt',raw),{input:100,output:20,cacheRead:80,cacheCreate:null,reasoning:10});
  assert.deepEqual(normalizeUsage('anthropic',{input_tokens:10,output_tokens:20,cache_read_input_tokens:80,cache_creation_input_tokens:5}),{input:95,output:20,cacheRead:80,cacheCreate:5,reasoning:null});
  for(const bad of [{}, {...raw,input_tokens:-1}, {...raw,input_tokens_details:{cached_tokens:101}}, {...raw,output_tokens_details:{reasoning_tokens:21}}, {...raw,input_tokens_details:{cached_tokens:'80'}}]) assert.equal(normalizeUsage('chatgpt',bad),null);
  assert.equal(normalizeUsage('anthropic',{input_tokens:10,output_tokens:1,cache_read_input_tokens:-1}),null);
});

test('attempt completion is idempotent, fallback attributes actual provider and incomplete usage remains unknown',()=>{
  const ledger=new UsageLedger();const a=ledger.begin(scope);
  ledger.finish(a,'completed',raw,'gpt-test');ledger.finish(a,'completed',raw);ledger.finish(a,'interrupted');
  ledger.finish(ledger.begin({...scope,provider:'anthropic',actualModel:'claude-test'}),'rejected');
  ledger.finish(ledger.begin({...scope,agent:'b'}),'interrupted',raw);
  const snapshot=ledger.snapshot();assert.equal(snapshot.attempts.length,3);assert.equal(new Set(snapshot.attempts.map(a=>a.id)).size,3);
  assert.equal(snapshot.totals[0].tokens.input,100);assert.equal(snapshot.totals[0].attempts,1);
  assert.equal(snapshot.totals[1].unknown,1);assert.equal(snapshot.totals[1].tokens,null);
  assert.equal(snapshot.totals[2].interrupted,1);assert.equal(snapshot.totals[2].tokens,null);
  snapshot.totals[0].tokens.input=1;assert.equal(ledger.snapshot().totals[0].tokens.input,100);
});

test('bounded recent attempts retain lifetime totals and missing token breakdown stays unknown',()=>{
  const ledger=new UsageLedger();
  for(let n=0;n<205;n++) ledger.finish(ledger.begin(scope),'completed',n?raw:{input_tokens:100,output_tokens:20});
  const snapshot=ledger.snapshot();assert.equal(snapshot.attempts.length,200);assert.equal(snapshot.totals[0].attempts,205);
  assert.equal(snapshot.totals[0].tokens.input,20500);assert.equal(snapshot.totals[0].tokens.cacheRead,null);
});

test('quota parsing uses only recognized windows and never treats null limits as unlimited',()=>{
  assert.equal(quotaWindows('chatgpt',quota).length,2);
  assert.equal(quotaWindows('chatgpt',quota)[0].usedPercent,37);
  assert.equal(quotaWindows('chatgpt',quota)[1].id,'special/secondary_window');
  assert.deepEqual(quotaWindows('chatgpt',{rate_limit:null}),[]);
  assert.deepEqual(quotaWindows('anthropic',{five_hour:{utilization:42,resets_at:'2026-10-16T20:00:00Z'},seven_day:null}),[
    {id:'five_hour',usedPercent:42,resetsAt:'2026-10-16T20:00:00.000Z',windowSeconds:null}]);
});

test('quota refresh is read-only, credential-isolated, coalesced and cached; all configured providers visible',async()=>{
  const calls=[];const reader=new QuotaReader({...defaults(),providers:[{id:'vendor'}]},auth,async(url,init)=>{
    calls.push({url,init});return Response.json(url.includes('chatgpt')?quota:{five_hour:{utilization:12,resets_at:'2026-10-16T20:00:00Z'}});
  });
  reader.observeClaudeAuthorization('Bearer fixture-claude');
  await Promise.all([reader.refresh(),reader.refresh()]);await reader.refresh();assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.init.method==='GET'&&c.init.redirect==='error'));
  assert.equal(calls.find(c=>c.url.includes('chatgpt')).init.headers.authorization,'Bearer fixture-codex');
  assert.equal(calls.find(c=>c.url.includes('anthropic')).init.headers.authorization,'Bearer fixture-claude');
  assert.equal(calls.find(c=>c.url.includes('anthropic')).init.headers['chatgpt-account-id'],undefined);
  const snapshot=reader.snapshot();assert.equal(snapshot.length,3);assert.equal(snapshot.find(p=>p.provider==='vendor').state,'unknown');
  assert.ok(snapshot.every(p=>p.money.amount===null));assert.ok(!JSON.stringify(snapshot).includes('fixture-'));
});

test('quota failures and unavailable credentials never leak errors, retry auth, or invent remaining usage',async()=>{
  let calls=0;const reader=new QuotaReader(defaults(),auth,async()=>{calls++;return new Response('private details',{status:401});});
  await reader.refresh();assert.equal(calls,1);
  const snapshot=reader.snapshot();assert.equal(snapshot.find(p=>p.provider==='anthropic').state,'unknown');
  assert.equal(snapshot.find(p=>p.provider==='chatgpt').state,'unavailable');assert.ok(!JSON.stringify(snapshot).includes('private details'));
  const malformed=new QuotaReader({...defaults(),claude:false},auth,async()=>Response.json({rate_limit:null}));
  await malformed.refresh();assert.equal(malformed.snapshot()[0].state,'unknown');
});

test('SDK quota ingestion excludes its model usage/cost estimates and supports scoped model limits',async()=>{
  const reader=new QuotaReader({...defaults(),chatgpt:false},auth,async()=>{throw Error('No network expected');});
  reader.ingestClaudeSdkUsage({session:{total_cost_usd:99,model_usage:{secret:'not imported'}},rate_limits_available:true,
    rate_limits:{five_hour:{utilization:12,resets_at:null},model_scoped:[{display_name:'Scoped',utilization:34,resets_at:null}]}});
  await reader.refresh();const snapshot=reader.snapshot();assert.equal(snapshot[0].state,'available');assert.equal(snapshot[0].windows.length,2);
  assert.equal(snapshot[0].money.amount,null);assert.ok(!JSON.stringify(snapshot).includes('not imported'));
  reader.ingestClaudeSdkUsage({rate_limits_available:false,rate_limits:null});assert.equal(reader.snapshot()[0].state,'unknown');
  assert.equal(quotaWindows('anthropic',{limits:[{kind:'weekly_scoped',percent:55,resets_at:null,scope:{model:{display_name:'Scoped'}}}],seven_day:{utilization:10}}).length,1);
});

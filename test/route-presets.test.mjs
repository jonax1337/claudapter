import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackPresets, applyPreset, explainRule, capabilityWarnings } from '../dist/fallback-presets.js';
import { defaults } from '../dist/config.js';

const model=(id,provider,extra={})=>({id,upstream:id,provider,label:id,tools:true,vision:true,efforts:[],source:'fixture',auth:'authenticated',...extra});
const models=[model('sonnet','anthropic',{auth:'unknown'}),model('gpt-6-astra','chatgpt',{context:872000}),model('gpt-6-luna','chatgpt',{context:872000}),
  model('glm-5.3','zai',{context:1000000,vision:false}),model('kimi-9','moonshot',{context:128000,auth:'missing'})];

test('presets use only authenticated targets, one per provider, plus the combined Claude → GPT → GLM chain',()=>{
  const presets=fallbackPresets(models,'sonnet');
  assert.deepEqual(presets.map(p=>p.title),['sonnet → gpt-6-astra','sonnet → glm-5.3','sonnet → gpt-6-astra → glm-5.3']);
  assert.ok(presets.every(p=>p.rule.enabled&&p.rule.scopes.join()==='main'),'the preset is what the user explicitly confirms; it is not saved by itself');
  assert.deepEqual(fallbackPresets(models,'unknown-model'),[]);
});

test('capability warnings come from the gateway compatibility check',()=>{
  const glm=capabilityWarnings(models[0],models[3]);
  assert.ok(glm.some(w=>/glm-5.3 · images: .*cannot accept this visual content/.test(w)));
  assert.ok(capabilityWarnings(models[0],model('tiny','x',{context:50000,tools:false})).some(w=>/tools: .*does not support tools/.test(w)));
  assert.ok(capabilityWarnings(models[0],model('tiny','x',{context:50000})).some(w=>/context: /.test(w)));
  assert.ok(!capabilityWarnings(models[0],models[1]).some(w=>/context|tools/.test(w)));
});

test('applying a preset validates the configuration and replaces the overlapping rule only',()=>{
  const [single,,combined]=fallbackPresets(models,'sonnet');
  const other={...single.rule,from:'opus',enabled:false};
  const config={...defaults(),fallback:[{...single.rule,enabled:false},other]};
  const rules=applyPreset(config,[...models,model('opus','anthropic')],combined.rule);
  assert.deepEqual(rules.map(r=>r.from+':'+r.targets.join('+')),['opus:gpt-6-astra','sonnet:gpt-6-astra+glm-5.3']);
  assert.throws(()=>applyPreset(defaults(),models,{...combined.rule,targets:['kimi-9']}),/not signed in: kimi-9/);
  assert.throws(()=>applyPreset(defaults(),models,{...combined.rule,targets:['nope']}),/Unknown model/);
  assert.throws(()=>applyPreset(defaults(),models,{...combined.rule,targets:['gpt-6-astra','gpt-6-astra']}),/distinct/);
});

test('the dry run explains pre-emption, order, cooldown, no replay and data routing',()=>{
  const [,,combined]=fallbackPresets(models,'sonnet');
  const text=explainRule(combined.rule,models,95).join('\n');
  assert.match(text,/At 95% of a fresh anthropic quota window, the next turn starts on gpt-6-astra without contacting sonnet/);
  assert.match(text,/On a rate limit or an outage: gpt-6-astra, then glm-5.3\./);
  assert.match(text,/for 5m, then returns to sonnet/);
  assert.match(text,/never replayed automatically/);
  assert.match(text,/may be sent to chatgpt, zai \(main scope\)/);
});

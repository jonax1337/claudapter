import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteTracker, RETRY_PROMPT } from '../dist/tui/route-model.js';
import { TuiController } from '../dist/tui/controller.js';
import { FallbackState } from '../dist/fallback.js';
import { Registry } from '../dist/models.js';
import { defaults } from '../dist/config.js';

const rule={enabled:true,from:'sonnet',targets:['gpt-6-astra','glm-5.3'],scopes:['main'],errors:['rate_limit','unavailable'],retries:0,timeoutMs:60000,cooldownMs:300000};
const main={session:'s1'};
const switched=(at,extra={})=>({kind:'switched',scope:main,requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',reason:'rate_limit',cooldownUntil:at+300000,at,...extra});

test('a switch yields a per-turn marker, a status route with cooldown and back/pin offers',()=>{
  const tracker=new RouteTracker([rule]);tracker.startTurn('turn-1');
  const marker=tracker.apply(switched(1000));
  assert.equal(marker.id,'route:turn-1:main:switched');
  assert.equal(marker.text,'rate limit on sonnet · continued on gpt-6-astra · for 5m');
  assert.deepEqual(tracker.main,{requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',reason:'rate_limit',cooldownUntil:301000});
  assert.deepEqual(tracker.offers.map(o=>o.action),['back','pin']);
});

test('request events inside the cooldown keep the countdown instead of erasing it',()=>{
  const tracker=new RouteTracker([rule]);tracker.apply(switched(1000));
  tracker.observeRequest({requestClass:'main',requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt'});
  assert.equal(tracker.main.cooldownUntil,301000);
});

test('repeated notices coalesce into one marker and one toast with a count',()=>{
  const tracker=new RouteTracker([rule]);tracker.startTurn('turn-1');
  const interrupted=at=>({kind:'interrupted',scope:main,requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',at});
  tracker.apply(interrupted(1000));const second=tracker.apply(interrupted(2000));
  assert.equal(second.count,2);assert.match(second.text,/×2$/);
  assert.equal(tracker.toast.count,2);
  tracker.apply(interrupted(20000));
  assert.equal(tracker.toast.count,1,'toasts only coalesce within a short window');
});

test('mid-stream interruption offers a retry on the next chain target; exhaustion offers a plain retry',()=>{
  const tracker=new RouteTracker([rule]);
  tracker.apply({kind:'interrupted',scope:main,requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',at:1});
  assert.deepEqual(tracker.offers[0],{action:'retry',session:'s1',requested:'sonnet',target:'glm-5.3'});
  tracker.apply({kind:'interrupted',scope:main,requested:'sonnet',actual:'glm-5.3',provider:'zai',at:2});
  assert.equal(tracker.offers[0].target,undefined,'the last target retries on the same route');
  const marker=tracker.apply({kind:'exhausted',scope:main,requested:'sonnet',chain:['sonnet','gpt-6-astra','glm-5.3'],reason:'unavailable',at:3});
  assert.deepEqual(tracker.offers,[{action:'retry',session:'s1',requested:'sonnet'}]);
  assert.match(marker.text,/every fallback target failed \(sonnet → gpt-6-astra → glm-5.3\)/);
  assert.equal(tracker.toast.tone,'error');
});

test('a new turn drops stale retry offers but keeps the cooldown offers',()=>{
  const tracker=new RouteTracker([rule]);tracker.apply(switched(1));
  tracker.apply({kind:'interrupted',scope:main,requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',at:2});
  tracker.startTurn('turn-2');
  assert.deepEqual(tracker.offers.map(o=>o.action),['back','pin']);
});

test('recovery restores the requested route; superseded routes leave no marker',()=>{
  const tracker=new RouteTracker([rule]);
  tracker.observeRequest({requestClass:'main',requested:'sonnet',actual:'sonnet',provider:'anthropic'});
  tracker.apply(switched(1));
  const marker=tracker.apply({kind:'recovered',scope:main,requested:'sonnet',previous:'gpt-6-astra',cause:'cooldown_ended',at:2});
  assert.equal(marker.text,'back on sonnet');
  assert.deepEqual(tracker.main,{requested:'sonnet',actual:'sonnet',provider:'anthropic'});
  assert.deepEqual(tracker.offers,[]);
  assert.equal(tracker.apply({kind:'recovered',scope:main,requested:'sonnet',previous:'x',cause:'superseded',at:3}),undefined);
});

test('sub-agent notices stay per agent and never touch the main route or offers',()=>{
  const tracker=new RouteTracker([rule]);
  const marker=tracker.apply(switched(1,{scope:{session:'s1',agent:'agent-7'}}));
  assert.equal(tracker.main,undefined);assert.deepEqual(tracker.offers,[]);
  assert.equal(tracker.agents['agent-7'].actual,'gpt-6-astra');
  assert.match(marker.text,/^agent agent-7 · /);
  tracker.observeRequest({agent:'agent-9',requestClass:'subagent',requested:'gpt-6.1-sol',actual:'gpt-6.1-sol',provider:'chatgpt'});
  assert.equal(tracker.agents['agent-9'].actual,'gpt-6.1-sol');
});

test('an unprotected limit offers the guided fallback setup',()=>{
  const tracker=new RouteTracker([]);
  const marker=tracker.apply({kind:'unprotected',scope:main,requested:'sonnet',provider:'anthropic',reason:'rate_limit',at:1});
  assert.equal(marker.text,'rate limit on sonnet · no fallback rule covers this conversation');
  assert.deepEqual(tracker.offers,[{action:'setup'}]);
});

function liveController(rules=[rule]) {
  const config={...defaults(),fallback:rules};
  const c=new TuiController([],config);
  const registry=new Registry([{id:'glm-5.3',upstream:'glm-5.3',provider:'zai',label:'GLM',context:1000000,tools:true,vision:false,efforts:[],source:'fixture',auth:'authenticated'},
    {id:'gpt-6-astra',upstream:'gpt-6-astra',provider:'chatgpt',label:'GPT',context:872000,tools:true,vision:true,efforts:[],source:'fixture',auth:'authenticated'}]);
  const state=new FallbackState(rules);state.notices.subscribe(notice=>c['receiveRoute'](notice));
  const sent=[];
  c.session={gateway:{state},registry};c.query={};c.state.ready=true;c['input']={push:message=>sent.push(message.message.content)};
  c['routes']=new RouteTracker(rules);
  return {c,state,sent};
}

test('controller: notices become transcript markers and state for the status bar',()=>{
  const {c,state}=liveController();
  state.set({session:'s1',requestClass:'main'},{requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',cooldownMs:240000,reason:'quota_near_limit'});
  const marker=c.state.entries.find(entry=>entry.route);
  assert.equal(marker.kind,'notice');assert.equal(marker.route.reason,'quota_preemption');
  assert.match(marker.text,/sonnet quota almost used · started on gpt-6-astra · for 4m/);
  assert.equal(c.state.lastRoute.actual,'gpt-6-astra');assert.ok(c.state.lastRoute.cooldownUntil>Date.now());
  assert.equal(c.state.routeToast.tone,'warning');
});

test('controller: retry is an explicit visible prompt on the next target, never a replay',async()=>{
  const {c,state,sent}=liveController();
  await assert.rejects(c.runRouteOffer('retry'),/No retry option/);
  state.notices.publish({kind:'interrupted',scope:{session:'s1'},requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',at:Date.now()});
  c.state.busy=false;
  await c.runRouteOffer('retry');
  assert.deepEqual(sent,[RETRY_PROMPT]);
  assert.equal(state.route({session:'s1',requestClass:'main'},'sonnet'),'glm-5.3');
  assert.equal(state.routes.get('s1/main').reason,'user_retry');
  assert.equal(c.state.entries.filter(entry=>entry.kind==='user').at(-1).text,RETRY_PROMPT);
});

test('controller: switching back resets only the main scope and clears the offers',async()=>{
  const {c,state}=liveController();
  state.set({session:'s1',requestClass:'main'},{requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt',cooldownMs:60000,reason:'rate_limit'});
  await c.runRouteOffer('back');
  assert.equal(state.routes.size,0);assert.deepEqual(c.state.routeOffers,[]);
  assert.equal(c.state.entries.at(-1).text,'back on sonnet');
});

test('a later turn still served by the cooldown gets one route badge; the switching turn does not',()=>{
  const tracker=new RouteTracker([rule]);tracker.startTurn('turn-1');tracker.apply(switched(1));
  const routed={event:'request',requestClass:'main',requested:'sonnet',actual:'gpt-6-astra',provider:'chatgpt'};
  assert.equal(tracker.observeRequest(routed),undefined,'the switch marker already names the model');
  tracker.startTurn('turn-2');
  const badge=tracker.observeRequest(routed);
  assert.equal(badge.id,'route:turn-2:main:routed');assert.equal(badge.text,'via gpt-6-astra · fallback for sonnet');
  assert.equal(tracker.observeRequest(routed),undefined,'tool-loop requests of the same turn add no badge');
  assert.equal(tracker.observeRequest({...routed,event:'fallback'}),undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import {TuiController} from '../dist/tui/controller.js';
import {defaults} from '../dist/config.js';

const controller=()=>new TuiController([],defaults());
const dialog=(id='permission')=>({id,title:'Permission',description:'Fixture',fields:[],choices:[{label:'Deny',value:'deny'},{label:'Allow',value:'allow'}],defaultIndex:0});
const stream=(parent,event)=>({type:'stream_event',session_id:'fixture-session',parent_tool_use_id:parent,event});

test('native skill refresh replaces command availability and hook events retain safe names',()=>{
  const c=controller();
  c.receive({type:'system',subtype:'commands_changed',commands:[{name:'fixture-skill',description:'Updated'}]});
  c.receive({type:'system',subtype:'hook_response',hook_name:'fixture\u001b[2J',outcome:'success'});
  assert.equal(c.state.commands[0].name,'fixture-skill');
  assert.match(c.state.entries[0].text,/fixture: success/);
  assert.doesNotMatch(c.state.entries[0].text,/\u001b/);
});

test('streamed and completed assistant blocks reconcile once with independent agent streams',()=>{
  const c=controller();
  c.receive(stream(null,{type:'message_start',message:{id:'main-message'}}));
  c.receive(stream(null,{type:'content_block_start',index:0,content_block:{type:'text',text:''}}));
  c.receive(stream(null,{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Hello'}}));
  c.receive(stream('agent-tool',{type:'message_start',message:{id:'agent-message'}}));
  c.receive(stream('agent-tool',{type:'content_block_start',index:0,content_block:{type:'text',text:'Agent'}}));
  c.receive({type:'assistant',parent_tool_use_id:null,message:{id:'main-message',content:[{type:'text',text:'Hello world'}]}});
  assert.equal(c.state.entries.filter(entry=>entry.kind==='assistant').length,2);
  assert.equal(c.state.entries.find(entry=>entry.id==='block:main-message:0').text,'Hello world');
  assert.equal(c.state.entries.find(entry=>entry.id==='block:agent-message:0').agent,'agent-tool');
  assert.equal(c.state.sessionId,'fixture-session');
});

test('replayed user history is visible once and repeated tool results never append duplicate output',()=>{
  const c=controller();
  const user={type:'user',uuid:'user-1',message:{role:'user',content:'Please review this.'}};
  c.receive(user);c.receive(user);
  assert.equal(c.state.entries.filter(entry=>entry.kind==='user').length,1);
  assert.equal(c.state.entries.find(entry=>entry.kind==='user').text,'Please review this.');
  const tool={type:'assistant',message:{id:'assistant-1',content:[{type:'tool_use',id:'read-1',name:'Read',input:{file_path:'fixture.txt'}}]}};
  c.receive(tool);
  const result={type:'user',uuid:'tool-result-1',message:{role:'user',content:[{type:'tool_result',tool_use_id:'read-1',content:'Fixture output'}]}};
  c.receive(result);
  const before=c.state.entries.find(entry=>entry.id==='tool:read-1').details;
  c.receive(result);
  assert.equal(c.state.entries.find(entry=>entry.id==='tool:read-1').details,before);
  c.receive(tool);
  assert.equal(c.state.entries.find(entry=>entry.id==='tool:read-1').status,'done');
});

test('raw streaming block content cannot inject terminal commands before completion',()=>{
  const c=controller();
  c.receive(stream(null,{type:'message_start',message:{id:'unsafe'}}));
  c.receive(stream(null,{type:'content_block_start',index:0,content_block:{type:'text',text:'safe\x1b]52;c;clipboard\x07'}}));
  assert.equal(c.state.entries[0].text,'safe');
});

test('permission dialog duplicates share one decision and abort resolves cancellation once',async()=>{
  const c=controller(), abort=new AbortController();
  const first=c.ask(dialog(),abort.signal,'deny');
  const second=c.ask(dialog(),abort.signal,'deny');
  assert.equal(first,second);
  assert.equal(c.state.pending.length,1);
  abort.abort();
  assert.equal(await first,'deny');assert.equal(await second,'deny');
  assert.equal(c.state.pending.length,0);
  c.answer('permission','allow');
  assert.equal(c.state.pending.length,0);
  const alreadyAborted=new AbortController();alreadyAborted.abort();
  assert.equal(await c.ask(dialog('already-aborted'),alreadyAborted.signal,'deny'),'deny');
  assert.equal(c.state.pending.length,0);
});

test('permission approval cannot survive engine shutdown and stale ready/busy states clear',async()=>{
  const c=controller();let queryClosed=0,sessionClosed=0;
  c.query={close(){queryClosed++;}};
  c.session={async close(){sessionClosed++;}};
  c.state.ready=true;c.state.busy=true;
  const pending=c.ask(dialog(),undefined,'deny');
  await c.close();
  assert.equal(await pending,'deny');
  assert.equal(queryClosed,1);assert.equal(sessionClosed,1);
  assert.equal(c.state.ready,false);assert.equal(c.state.busy,false);
  assert.equal(c.state.pending.length,0);
  assert.throws(()=>c.send('Do not queue after close.'),/starting|closed|stopped/i);
});

test('failed model switch retains actual selected model and busy state blocks switching',async()=>{
  const c=controller();let calls=0;
  c.state.model='original';
  c.query={async setModel(){calls++;throw new Error('Fixture model unavailable');}};
  await assert.rejects(c.setModel('unavailable'),/unavailable/);
  assert.equal(c.state.model,'original');assert.equal(calls,1);
  c.state.busy=true;
  await assert.rejects(c.setModel('other'),/Wait/);
  assert.equal(calls,1);
});

test('stopped engine no longer advertises readiness or accepts queued work',async()=>{
  const c=controller();c.state.ready=true;c.state.busy=true;
  const empty={async *[Symbol.asyncIterator](){}};
  c.query=empty;
  await c.consume(empty,0);
  assert.equal(c.state.ready,false);assert.equal(c.state.busy,false);
  assert.throws(()=>c.send('Cannot run.'),/starting|closed|stopped/i);
});

test('invalid numeric dialog answers cannot resolve an approval form',async()=>{
  const c=controller();
  const form={...dialog('form'),fields:[{key:'count',label:'Count',type:'number',required:true}],choices:[{label:'Cancel',value:null},{label:'Submit',value:'submit'}]};
  const pending=c.ask(form,undefined,null);
  assert.throws(()=>c.answer('form','submit',{count:'not a number'}),/number|finite|invalid/i);
  assert.equal(c.state.pending.length,1);
  c.answer('form','submit',{count:'3'});
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{fields:{count:3}});
});

test('AskUserQuestion returns selected and custom answers through the native allow result',async()=>{
  const c=controller();
  const input={questions:[
    {question:'Which approach?',header:'Approach',options:[{label:'Small change',description:'Keep scope narrow'},{label:'Rewrite',description:'Replace it'}],multiSelect:false},
    {question:'What checks?',header:'Checks',options:[{label:'Unit tests',description:'Fast'},{label:'Live flow',description:'Real engine'}],multiSelect:true},
  ]};
  const pending=c.permission('AskUserQuestion',input,{requestId:'question-positive',toolUseID:'question-tool',signal:new AbortController().signal});
  assert.equal(c.state.pending.length,1);
  assert.deepEqual(c.state.pending[0].fields[0].options,['Small change','Rewrite']);
  assert.equal(c.state.pending[0].fields[1].multi,true);
  c.answer('question-positive','submit',{'Which approach?':'An even smaller custom approach','What checks?':'Unit tests, Live flow'});
  const decision=await pending;
  assert.equal(decision.behavior,'allow');
  assert.deepEqual(JSON.parse(JSON.stringify(decision.updatedInput)),{...input,answers:{'Which approach?':'An even smaller custom approach','What checks?':'Unit tests, Live flow'}});
  assert.equal(c.state.pending.length,0);
});

test('question cancellation denies execution and arbitrary property names stay data',async()=>{
  const c=controller(),abort=new AbortController();
  const cancelled=c.permission('AskUserQuestion',{questions:[{question:'Continue?',options:[]}]},{requestId:'question-cancel',signal:abort.signal});
  abort.abort();assert.equal((await cancelled).behavior,'deny');
  const pending=c.permission('AskUserQuestion',{questions:[{question:'__proto__',options:[]}]},{requestId:'question-key'});
  c.answer('question-key','submit',JSON.parse('{"__proto__":"Literal answer"}'));
  const result=await pending;
  assert.equal(Object.hasOwn(result.updatedInput.answers,'__proto__'),true);
  assert.equal(result.updatedInput.answers.__proto__,'Literal answer');
});

test('session permission approval preserves scoped allow rules and never promotes a suggested mode',async()=>{
  const c=controller(),input={command:'node fixture.mjs'};
  const suggestions=[{type:'addRules',behavior:'allow',rules:[{toolName:'Bash',ruleContent:'node fixture.mjs'}],destination:'userSettings'}];
  const pending=c.permission('Bash',input,{requestId:'permission-session',toolUseID:'tool-session',suggestions});
  assert.ok(c.state.pending[0].description.includes('Optional session rules'));
  assert.ok(c.state.pending[0].choices.some(choice=>choice.value==='session'));
  c.answer('permission-session','session');
  assert.deepEqual(await pending,{behavior:'allow',updatedInput:input,toolUseID:'tool-session',updatedPermissions:[{...suggestions[0],destination:'session'}]});
  const unsafe=c.permission('Bash',input,{requestId:'permission-mode',suggestions:[{type:'setMode',mode:'bypassPermissions',destination:'session'}]});
  assert.ok(!c.state.pending[0].choices.some(choice=>choice.value==='session'));
  c.cancelDialog('permission-mode');assert.equal((await unsafe).behavior,'deny');
});

test('MCP form submission omits optional blank fields and rejects malformed supplied JSON',async()=>{
  const c=controller();
  const request={mode:'form',message:'Fixture form',requestedSchema:{type:'object',required:['name'],properties:{
    name:{type:'string'},count:{type:'number'},enabled:{type:'boolean'},items:{type:'array'},details:{type:'object'},
  }}};
  const pending=c.elicitation(request,{requestId:'form-optional'});
  assert.throws(()=>c.answer('form-optional','submit',{name:'Fixture',count:'bad'}),/finite number/);
  assert.throws(()=>c.answer('form-optional','submit',{name:'Fixture',items:'{broken'}));
  assert.equal(c.state.pending.length,1);
  c.answer('form-optional','submit',{name:'Fixture'});
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{action:'accept',content:{name:'Fixture'}});
});

async function startupFixture(t,args=[],overrides={}) {
  const id=randomUUID(), symbol=Symbol.for('claudapter-controller-test-'+id);
  const h={queries:[],prepared:[],restored:[],trusted:true,...overrides};
  h.query=({prompt,options})=>{
    let end,rejectInit;
    const ended=new Promise(resolve=>{end=resolve;});
    const q={prompt,options,closed:false,
      initializationResult:()=>options.workspaceTrust&&h.deferTrust?new Promise((_,reject)=>{rejectInit=reject;}):Promise.resolve({commands:[],workspace_trust_recorded:!h.home&&!!options.workspaceTrust}),
      supportedAgents:async()=>{h.agentsRequested?.();if(h.agentsWait)await h.agentsWait;return [];},
      getContextUsage:async()=>({maxTokens:872000,rawMaxTokens:872000}),
      close(){this.closed=true;end();rejectInit?.(new Error('Fixture query closed'));},
      async *[Symbol.asyncIterator](){await ended;},
    };
    h.queries.push(q);h.queryCreated?.(q);return q;
  };
  h.prepareSession=async sessionArgs=>{
    const session={args:sessionArgs,env:{FIXTURE:'only'},settings:'fixture-settings-with-hooks.json',claudeVersion:'2.1.301',
      plugin:'fixture-plugin',registry:{list:()=>[]},gateway:{manifest:()=>({usage:undefined})},closed:false,
      async close(){this.closed=true;}};
    h.prepared.push(session);return session;
  };
  globalThis[symbol]=h;
  const source='const h=globalThis[Symbol.for('+JSON.stringify(Symbol.keyFor(symbol))+')];';
  const data=text=>'data:text/javascript,'+encodeURIComponent(source+text);
  const modules={
    '@anthropic-ai/claude-agent-sdk':data('export const query=x=>h.query(x),listSessions=async()=>[],getSessionMessages=async id=>{h.restored.push(id);return[];},renameSession=async()=>{},forkSession=async()=>({sessionId:"fork"}),deleteSession=async()=>{};'),
    '../launcher.js':data('export const prepareSession=(...a)=>h.prepareSession(...a),installedClaudePath=async()=>"fixture-claude";'),
    './trust.js':data('export const trustDirectory=async cwd=>{h.trustRequested?.();if(h.trustWait)await h.trustWait;return cwd;},isWorkspaceTrusted=async()=>h.trusted,isHomeDirectory=async()=>h.home===true;'),
  };
  const path=import.meta.resolve('../dist/tui/controller.js')+'?startupFixture='+id;
  const hook=registerHooks({resolve(specifier,context,next){
    if(context.parentURL===path&&modules[specifier])return{url:modules[specifier],shortCircuit:true};
    return next(specifier,context);
  }});
  const {TuiController:FixtureController}=await import(path);
  const c=new FixtureController(args,defaults());
  t.after(async()=>{await c.close();for(const q of h.queries)q.close();hook.deregister();delete globalThis[symbol];});
  return {c,h};
}

test('startup prompt is sent once; clear and explicit resume cannot replay launch history or session ID',async t=>{
  const args=['--resume','original-session','--session-id','12345678-1234-1234-1234-123456789abc','--fork-session',
    '--resume-session-at','original-turn','--resume-drops-turn','original-dropped-turn','--model','gpt-fixture','--','Run this exactly once'];
  const {c,h}=await startupFixture(t,args);
  await c.start();
  assert.equal(h.queries[0].options.resume,'original-session');
  assert.equal(h.queries[0].options.resumeSessionAt,'original-turn');
  assert.equal((await h.queries[0].prompt[Symbol.asyncIterator]().next()).value.message.content,'Run this exactly once');
  await c.newSession();
  assert.equal(h.queries[1].options.resume,undefined);
  assert.equal(h.queries[1].options.continue,undefined);
  assert.equal(h.queries[1].options.sessionId,undefined);
  assert.equal(h.queries[1].options.resumeSessionAt,undefined);
  assert.equal(h.queries[1].options.resumeDropsTurn,undefined);
  assert.ok(!c.state.entries.some(entry=>entry.kind==='user'));
  await c.resume('chosen-session');
  assert.equal(h.queries[2].options.resume,'chosen-session');
  assert.equal(h.queries[2].options.sessionId,undefined);
  assert.equal(h.queries[2].options.forkSession,undefined);
  assert.equal(h.queries[2].options.resumeSessionAt,undefined);
  assert.equal(h.queries[2].options.resumeDropsTurn,undefined);
  assert.ok(!c.state.entries.some(entry=>entry.kind==='user'));
  assert.deepEqual(h.restored,['original-session','chosen-session']);
});

test('workspace trust probe strips user agent prompts, hooks, permissions and extra CLI controls',async t=>{
  const agents={fixture:{description:'Fixture',prompt:'fixture',initialPrompt:'Must never auto-run in trust probe'}};
  const {c,h}=await startupFixture(t,['--agent','fixture','--agents',JSON.stringify(agents),'--dangerously-skip-permissions','--verbose','--system-prompt','Custom'],{trusted:false});
  const pending=new Promise(resolve=>c.on('change',()=>{if(c.state.pending.some(dialog=>dialog.id.startsWith('workspace-trust:')))resolve();}));
  const start=c.start();await pending;
  c.answer(c.state.pending[0].id,true);await start;
  assert.equal(h.queries.length,2);
  const probe=h.queries[0].options;
  assert.equal(probe.workspaceTrust.accepted,true);
  for(const key of ['settings','agent','agents','permissionMode','allowDangerouslySkipPermissions','extraArgs','systemPrompt','resume','sessionId'])assert.equal(probe[key],undefined,key);
  assert.deepEqual(probe.settingSources,[]);assert.deepEqual(probe.plugins,[]);assert.deepEqual(probe.mcpServers,{});
  assert.equal(probe.strictMcpConfig,true);assert.equal(probe.persistSession,false);assert.equal(h.queries[0].closed,true);
  assert.equal(h.queries[1].options.agent,'fixture');
  assert.deepEqual(h.queries[1].options.agents,agents);
});

test('home consent stays on the actual live query without requiring a persisted trust record',async t=>{
  const {c,h}=await startupFixture(t,[],{home:true,trusted:false});
  const pending=new Promise(resolve=>c.on('change',()=>{if(c.state.pending.length)resolve();}));
  const start=c.start();await pending;
  assert.match(c.state.pending[0].title,/home directory/i);assert.match(c.state.pending[0].description,/never saved/i);
  c.answer(c.state.pending[0].id,true);await start;
  assert.equal(h.queries.length,1);assert.equal(h.queries[0].closed,false);assert.equal(h.queries[0].options.workspaceTrust.accepted,true);assert.equal(c.state.ready,true);
  await c.newSession();assert.equal(h.queries.length,2);assert.equal(h.queries[1].options.workspaceTrust.accepted,true);
  assert.equal(c.state.pending.length,0);assert.equal(c.state.ready,true);
});

test('closing while native trust acknowledgement is pending closes that probe',async t=>{
  let probeReady;const probeStarted=new Promise(resolve=>{probeReady=resolve;});
  const {c,h}=await startupFixture(t,[],{trusted:false,deferTrust:true,queryCreated:q=>{if(q.options.workspaceTrust)probeReady();}});
  const pending=new Promise(resolve=>c.on('change',()=>{if(c.state.pending.length)resolve();}));
  const start=c.start();await pending;c.answer(c.state.pending[0].id,true);await probeStarted;
  await c.close();await start;
  assert.equal(h.queries.length,1);assert.equal(h.queries[0].closed,true);assert.equal(c.state.ready,false);
  assert.ok(h.prepared.every(session=>session.closed));
});

test('closing during late startup discovery cannot resurrect a ready session',async t=>{
  let releaseAgents,agentsRequested;const agentsWait=new Promise(resolve=>{releaseAgents=resolve;});
  const requested=new Promise(resolve=>{agentsRequested=resolve;});
  const {c}=await startupFixture(t,[],{agentsWait,agentsRequested});
  const start=c.start();await requested;await c.close();releaseAgents();await start;
  assert.equal(c.state.ready,false);assert.equal(c.state.status,'Closed');assert.equal(c.query,undefined);
});

test('declining workspace trust starts no engine or agent and releases the prepared gateway',async t=>{
  const {c,h}=await startupFixture(t,['--','Do not run without trust'],{trusted:false});
  const pending=new Promise(resolve=>c.on('change',()=>{if(c.state.pending.length)resolve();}));
  const start=c.start();await pending;c.answer(c.state.pending[0].id,false);await start;
  assert.equal(h.queries.length,0);assert.ok(h.prepared.every(session=>session.closed));
  assert.equal(c.state.ready,false);assert.equal(c.session,undefined);assert.match(c.state.status,/declined/i);
  assert.ok(!c.state.entries.some(entry=>entry.kind==='user'));
});

test('closing during trust root discovery cannot create an unanswerable dialog after shutdown',async t=>{
  let releaseTrust,trustRequested;
  const trustWait=new Promise(resolve=>{releaseTrust=resolve;});
  const requested=new Promise(resolve=>{trustRequested=resolve;});
  const {c,h}=await startupFixture(t,[],{trusted:false,trustWait,trustRequested});
  const start=c.start();t.after(()=>start);
  await requested;await c.close();releaseTrust();await new Promise(setImmediate);
  assert.equal(c.state.pending.length,0);await start;
  assert.equal(h.queries.length,0);assert.equal(c.state.ready,false);assert.equal(c.state.status,'Closed');
});

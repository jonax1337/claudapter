import test from 'node:test';
import assert from 'node:assert/strict';
import {TuiController} from '../dist/tui/controller.js';
import {defaults} from '../dist/config.js';
import {historyEntries,flattenToolResult} from '../dist/tui/transcript-model.js';

const controller=()=>new TuiController([],defaults());
const system=(subtype,fields)=>({type:'system',subtype,session_id:'fixture-session',uuid:subtype,...fields});
const stream=(event,parent=null)=>({type:'stream_event',session_id:'fixture-session',parent_tool_use_id:parent,event});
const toolUse=(id,name='Read',input={file_path:'a.txt'})=>({type:'assistant',uuid:'use-'+id,message:{id:'msg-'+id,content:[{type:'tool_use',id,name,input}]}});
const toolResult=(id,content,extra={})=>({type:'user',uuid:'result-'+id,message:{role:'user',content:[{type:'tool_result',tool_use_id:id,content}]},...extra});
const entryOf=(c,id)=>c.state.entries.find(entry=>entry.id===id);

test('task lifecycle keeps one normalized task across started, progress, updated and notification',()=>{
  const c=controller();
  c.receive(system('task_started',{task_id:'t1',tool_use_id:'tool-1',description:'Review code',task_type:'local_agent',subagent_type:'reviewer',spawn_depth:1,is_backgrounded:false,prompt:'Look at \x1b[31mthis'}));
  const started=c.state.tasks.t1;
  assert.deepEqual([started.kind,started.status,started.title,started.subagentType,started.depth,started.background],['agent','running','Review code','reviewer',1,false]);
  assert.equal(started.prompt,'Look at this');
  c.receive(system('task_progress',{task_id:'t1',description:'Review code',usage:{total_tokens:900,tool_uses:3,duration_ms:4000},last_tool_name:'Grep',summary:'Reading files'}));
  assert.deepEqual([c.state.tasks.t1.totalTokens,c.state.tasks.t1.toolUses,c.state.tasks.t1.lastTool,c.state.tasks.t1.summary],[900,3,'Grep','Reading files']);
  c.receive(system('task_updated',{task_id:'t1',patch:{status:'paused'}}));
  assert.equal(c.state.tasks.t1.status,'paused');
  assert.equal(c.state.tasks.t1.title,'Review code');
  c.receive(system('task_updated',{task_id:'t1',patch:{status:'killed',end_time:1234,error:'cancelled'}}));
  assert.deepEqual([c.state.tasks.t1.status,c.state.tasks.t1.endedAt,c.state.tasks.t1.error],['stopped',1234,'cancelled']);
  c.receive(system('task_notification',{task_id:'t1',status:'completed',summary:'Done',usage:{total_tokens:1500,tool_uses:5,duration_ms:9000}}));
  const done=c.state.tasks.t1;
  assert.deepEqual([done.status,done.summary,done.totalTokens,done.toolUses,done.durationMs,done.startedAt===started.startedAt],['completed','Done',1500,5,9000,true]);
  assert.equal(Object.keys(c.state.tasks).length,1);
});

test('task kinds, workflow names, parents and housekeeping flags are normalized',()=>{
  const c=controller();
  for(const [id,task_type] of [['a','local_agent'],['w','local_workflow'],['s','local_bash'],['m','monitor'],['x','mcp_task']])
    c.receive(system('task_started',{task_id:id,description:id,task_type,...(id==='w'?{workflow_name:'spec'}:{}),...(id==='s'?{parent_task_id:'a',skip_transcript:true,ambient:true}:{})}));
  assert.deepEqual(['a','w','s','m','x'].map(id=>c.state.tasks[id].kind),['agent','workflow','shell','monitor','other']);
  assert.equal(c.state.tasks.w.workflowName,'spec');
  assert.deepEqual([c.state.tasks.s.parentId,c.state.tasks.s.hidden,c.state.tasks.s.ambient],['a',true,true]);
  c.receive(system('task_notification',{task_id:'s',status:'failed',summary:'exit 1'}));
  assert.equal(c.state.tasks.s.status,'failed');
  c.receive(system('task_started',{task_id:'s',description:'again',task_type:'local_bash'}));
  assert.deepEqual([c.state.tasks.s.status,c.state.tasks.s.endedAt,c.state.tasks.s.summary],['running',undefined,undefined]);
});

test('task prompts are bounded and never reach entries or notices',()=>{
  const c=controller();
  c.receive(system('task_started',{task_id:'t',description:'Long',task_type:'local_agent',prompt:'x'.repeat(5000)}));
  assert.equal(c.state.tasks.t.prompt.length,2000);
  assert.equal(c.state.entries.length,0);
});

test('background task level replaces the live set and stops background tasks that lost their bookend',()=>{
  const c=controller();
  c.receive(system('background_tasks_changed',{tasks:[{task_id:'b1',task_type:'local_bash',description:'Server'},{task_id:'b2',task_type:'monitor',description:'Watch',ambient:true}]}));
  assert.deepEqual([c.state.tasks.b1.status,c.state.tasks.b1.kind,c.state.tasks.b1.background,c.state.tasks.b2.ambient],['running','shell',true,true]);
  c.receive(system('task_started',{task_id:'fg',description:'Foreground agent',task_type:'local_agent',is_backgrounded:false}));
  c.receive(system('background_tasks_changed',{tasks:[{task_id:'b2',task_type:'monitor',description:'Watch'}]}));
  assert.equal(c.state.tasks.b1.status,'stopped');
  assert.equal(c.state.tasks.b2.status,'running');
  assert.equal(c.state.tasks.fg.status,'running');
});

test('a tool call is linked to its task whichever side arrives first',()=>{
  const c=controller();
  c.receive(toolUse('agent-call','Agent',{description:'Do work'}));
  c.receive(system('task_started',{task_id:'t1',tool_use_id:'agent-call',description:'Do work',task_type:'local_agent'}));
  assert.equal(entryOf(c,'tool:agent-call').taskId,'t1');
  c.receive(system('task_started',{task_id:'t2',tool_use_id:'late-call',description:'Late',task_type:'local_agent'}));
  c.receive(toolUse('late-call','Agent',{}));
  assert.equal(entryOf(c,'tool:late-call').taskId,'t2');
});

test('redacted thinking keeps its token estimate and never turns into an assistant entry',()=>{
  const c=controller();
  c.receive(stream({type:'message_start',message:{id:'m1'}}));
  c.receive(stream({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}));
  assert.equal(entryOf(c,'block:m1:0').redacted,undefined);
  c.receive(system('thinking_tokens',{estimated_tokens:64,estimated_tokens_delta:64}));
  c.receive(system('thinking_tokens',{estimated_tokens:180,estimated_tokens_delta:116}));
  c.receive(stream({type:'content_block_stop',index:0}));
  const thinking=entryOf(c,'block:m1:0');
  assert.deepEqual([thinking.kind,thinking.text,thinking.thinkingTokens,thinking.redacted],['thinking','',180,true]);
  c.receive(stream({type:'content_block_start',index:1,content_block:{type:'redacted_thinking',data:'opaque'}}));
  assert.deepEqual([entryOf(c,'block:m1:1').kind,entryOf(c,'block:m1:1').redacted],['thinking',true]);
});

test('split assistant blocks of one API message reconcile with their streamed entries without collisions',()=>{
  const c=controller();
  c.receive(stream({type:'message_start',message:{id:'m2'}}));
  c.receive(stream({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}));
  c.receive(stream({type:'content_block_start',index:1,content_block:{type:'text',text:''}}));
  c.receive(stream({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Streamed'}}));
  c.receive({type:'assistant',uuid:'u-think',message:{id:'m2',content:[{type:'thinking',thinking:'',signature:'sig'}]}});
  c.receive({type:'assistant',uuid:'u-text',message:{id:'m2',content:[{type:'text',text:'Final answer'}]}});
  c.receive({type:'assistant',uuid:'u-text',message:{id:'m2',content:[{type:'text',text:'Final answer'}]}});
  const blocks=c.state.entries.filter(entry=>entry.id.startsWith('block:'));
  assert.deepEqual(blocks.map(entry=>[entry.id,entry.kind,entry.text]),[['block:m2:0','thinking',''],['block:m2:1','assistant','Final answer']]);
  assert.equal(blocks[0].redacted,true);
});

test('tool entries carry parsed input, flattened output, error state, elapsed time and small structured results',()=>{
  const c=controller();
  c.receive(toolUse('edit-1','Edit',{file_path:'a.ts',old_string:'a',new_string:'b'}));
  const running=entryOf(c,'tool:edit-1');
  assert.deepEqual([running.status,running.input.file_path],['running','a.ts']);
  assert.match(running.details,/old_string/);
  const patch={structuredPatch:[{oldStart:1,lines:['-a','+b']}]};
  c.receive(toolResult('edit-1',[{type:'text',text:'Edited'},{type:'text',text:'a.ts'}],{tool_use_result:patch}));
  const done=entryOf(c,'tool:edit-1');
  assert.deepEqual([done.status,done.output,done.isError,done.result],['done','Edited\na.ts',false,patch]);
  assert.ok(done.elapsedMs>=0);
  assert.equal(done.input.new_string,'b');
  assert.match(done.details,/Edited\na\.ts$/);
  c.receive(toolUse('big-1','Write'));
  c.receive(toolResult('big-1','ok',{tool_use_result:{content:'x'.repeat(20000)}}));
  assert.equal(entryOf(c,'tool:big-1').result,undefined);
  c.receive(toolUse('bad-1','Bash',{command:'false'}));
  c.receive(toolResult('bad-1','failed\x1b[2J'));
  c.receive({type:'user',uuid:'err',message:{content:[{type:'tool_result',tool_use_id:'bad-2',content:'boom',is_error:true}]}});
  assert.equal(entryOf(c,'tool:bad-2').isError,true);
  assert.equal(entryOf(c,'tool:bad-2').status,'error');
  assert.equal(entryOf(c,'tool:bad-1').output,'failed');
});

test('tool result block arrays are flattened as text, not JSON',()=>{
  assert.equal(flattenToolResult([{type:'text',text:'one'},{type:'image',source:{}},{type:'text',text:'two'}]),'one\n[image]\ntwo');
  assert.equal(flattenToolResult('plain'),'plain');
});

test('engine-injected user messages never appear as prompts',()=>{
  const c=controller();
  c.receive({type:'user',uuid:'r1',message:{content:'<system-reminder>Todo list changed</system-reminder>'}});
  c.receive({type:'user',uuid:'r2',message:{content:[{type:'text',text:'<command-name>/compact</command-name>'},{type:'text',text:'Real question'},{type:'text',text:'<system-reminder>x</system-reminder>'}]}});
  c.receive({type:'user',uuid:'r3',isMeta:true,message:{content:'Caveat: generated locally'}});
  c.receive({type:'user',uuid:'r4',message:{content:'<local-command-stdout>ok</local-command-stdout>'}});
  assert.deepEqual(c.state.entries.map(entry=>entry.text),['Real question']);
});

test('history conversion closes dangling tool calls and shows compaction as a notice',()=>{
  const message=(type,i,body,extra={})=>({type,uuid:'u'+i,parent_tool_use_id:null,message:body,...extra});
  const {entries}=historyEntries([
    message('user',1,{content:'Summary of earlier work'},{isCompactSummary:true,is_meta:true}),
    message('assistant',2,{id:'a',content:[{type:'tool_use',id:'x',name:'Bash',input:{command:'sleep 9'}}]}),
  ]);
  assert.deepEqual(entries.map(entry=>[entry.kind,entry.status]),[['notice',undefined],['tool','done']]);
  assert.match(entries[0].text,/compacted/i);
  assert.match(entries[1].output,/No result recorded/);
  assert.equal(entries[1].isError,false);
});

test('permission modes switch through the query and can never reach a bypass mode',async()=>{
  const c=controller();const calls=[];
  await assert.rejects(c.setPermissionMode('plan'),/starting/);
  c.query={async setPermissionMode(mode){calls.push(mode);}};
  await c.setPermissionMode('acceptEdits');
  assert.deepEqual([c.state.permissionMode,calls],['acceptEdits',['acceptEdits']]);
  await assert.rejects(c.setPermissionMode('bypassPermissions'),/cannot be selected/);
  await assert.rejects(c.setPermissionMode('auto'),/cannot be selected/);
  assert.deepEqual(calls,['acceptEdits']);
  const sequence=[];for(let i=0;i<4;i++)sequence.push(await c.cyclePermissionMode());
  assert.deepEqual(sequence,['plan','default','acceptEdits','plan']);
  c.state.permissionMode='bypassPermissions';
  assert.equal(await c.cyclePermissionMode(),'default');
});

test('conversation reset clears entries, tasks and reconciliation state',()=>{
  const c=controller();
  c.receive(toolUse('t','Read'));c.receive(system('task_started',{task_id:'k',description:'Task',task_type:'local_agent'}));
  c.receive(system('conversation_reset',{}));
  assert.deepEqual([c.state.entries.length,Object.keys(c.state.tasks).length],[0,0]);
});

test('default model and per-model effort persist through validated config', async () => {
  const c = controller();
  await c.updateDefaultModel('glm-5.3');
  assert.equal(c.config.model, 'glm-5.3');
  await c.updateModelEffort('glm-5.3', 'max');
  assert.deepEqual(c.config.modelEffort, { 'glm-5.3': 'max' });
  await assert.rejects(c.updateModelEffort('glm-5.3', 'warp'), /effort/);
  await c.updateModelEffort('glm-5.3', undefined);
  assert.equal(c.config.modelEffort, undefined);
  await c.updateDefaultModel(undefined);
  assert.equal(c.config.model, undefined);
});

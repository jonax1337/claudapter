import test from 'node:test';
import assert from 'node:assert/strict';
import {TuiController} from '../dist/tui/controller.js';
import {defaults} from '../dist/config.js';
import {historyEntries,isSubagentMessage,reportedAgentId} from '../dist/tui/transcript-model.js';
import {relayOutcome,relayPrompt,relayTarget} from '../dist/tui/agent-relay.js';

// Recorded-style fixture frames shaped like SDK 0.3.301 output: sub-agent frames carry parent_tool_use_id,
// complete sub-agent messages also carry agent_id (= task_id). Mock data, not a live session.
const SESSION='fixture-session';
const controller=()=>new TuiController([],defaults());
const system=(subtype,fields)=>({type:'system',subtype,session_id:SESSION,uuid:subtype+':'+(fields.task_id??''),...fields});
const stream=(parent,event)=>({type:'stream_event',session_id:SESSION,parent_tool_use_id:parent,event});
const assistant=(parent,agent,id,content)=>({type:'assistant',session_id:SESSION,uuid:'u-'+id+':'+content[0].type,parent_tool_use_id:parent,...(agent?{agent_id:agent}:{}),message:{id,content}});
const result=(parent,agent,toolUseId,content,extra={})=>({type:'user',session_id:SESSION,uuid:'r-'+toolUseId,parent_tool_use_id:parent,...(agent?{agent_id:agent}:{}),message:{role:'user',content:[{type:'tool_result',tool_use_id:toolUseId,content,...extra}]}});
const agentCall=(id,description,subagent_type)=>({type:'tool_use',id,name:'Agent',input:{description,prompt:'Do it',subagent_type}});
const started=(task_id,tool_use_id,extra={})=>system('task_started',{task_id,tool_use_id,description:task_id,task_type:'local_agent',subagent_type:'Explore',is_backgrounded:true,...extra});
const ids=entries=>entries.map(entry=>entry.id);

/** Main thread plus two parallel agents, a nested agent, a failing agent and a resumed agent, interleaved. */
function interleavedSession(c){
  c.receive(system('init',{model:'opus',tools:['Agent','Read','SendMessage'],permissionMode:'default'}));
  c.receive(stream(null,{type:'message_start',message:{id:'m1'}}));
  c.receive(stream(null,{type:'content_block_start',index:0,content_block:{type:'text',text:''}}));
  c.receive(stream(null,{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Starting two agents.'}}));
  c.receive(assistant(null,undefined,'m1',[{type:'text',text:'Starting two agents.'}]));
  c.receive(assistant(null,undefined,'m1',[agentCall('call-a','Search code','Explore')]));
  c.receive(assistant(null,undefined,'m1',[agentCall('call-b','Run tests','general-purpose')]));
  c.receive(started('agent-a','call-a'));
  c.receive(started('agent-b','call-b',{subagent_type:'general-purpose'}));
  c.receive(stream('call-a',{type:'message_start',message:{id:'a1'}}));
  c.receive(stream('call-a',{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}));
  c.receive(stream('call-b',{type:'message_start',message:{id:'b1'}}));
  c.receive(stream('call-a',{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'Where is it?'}}));
  c.receive(stream('call-b',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}));
  c.receive(stream('call-b',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Running the suite.'}}));
  c.receive(stream('call-a',{type:'content_block_stop',index:0}));
  c.receive(assistant('call-a','agent-a','a1',[{type:'thinking',thinking:'Where is it?',signature:'s'}]));
  c.receive(assistant('call-b','agent-b','b1',[{type:'text',text:'Running the suite.'}]));
  c.receive(assistant('call-a','agent-a','a1',[{type:'tool_use',id:'read-1',name:'Read',input:{file_path:'src/a.ts'}}]));
  c.receive(system('task_progress',{task_id:'agent-a',usage:{total_tokens:1200,tool_uses:1,duration_ms:900},last_tool_name:'Read'}));
  c.receive(result('call-a','agent-a','read-1','file body'));
  c.receive(assistant('call-a','agent-a','a2',[agentCall('call-n','Dig deeper','Explore')]));
  c.receive(started('agent-n','call-n',{parent_task_id:'agent-a',spawn_depth:2}));
  c.receive(stream('call-n',{type:'message_start',message:{id:'n1'}}));
  c.receive(assistant('call-n','agent-n','n1',[{type:'text',text:'Nested finding.'}]));
  c.receive(assistant('call-b','agent-b','b2',[{type:'tool_use',id:'bash-1',name:'Bash',input:{command:'npm test'}}]));
  c.receive(result('call-b','agent-b','bash-1','exit 1',{is_error:true}));
  c.receive(system('task_notification',{task_id:'agent-b',status:'failed',summary:'Tests failed'}));
  c.receive(stream(null,{type:'message_start',message:{id:'m2'}}));
  c.receive(assistant(null,undefined,'m2',[{type:'text',text:'Agents are running.'}]));
  c.receive(system('task_notification',{task_id:'agent-a',status:'completed',summary:'Found it'}));
  c.receive(started('agent-a','send-1'));
  c.receive(stream('send-1',{type:'message_start',message:{id:'a3'}}));
  c.receive(assistant('send-1','agent-a','a3',[{type:'text',text:'Resumed with your message.'}]));
}

test('sub-agent frames never reach the main transcript model',()=>{
  const c=controller();interleavedSession(c);
  assert.deepEqual(ids(c.state.entries),['block:m1:0','tool:call-a','tool:call-b','block:m2:f0']);
  assert.ok(c.state.entries.every(entry=>entry.agent===undefined));
  const mainText=JSON.stringify(c.state.entries);
  for(const leaked of ['Where is it?','Running the suite.','read-1','Nested finding.','npm test','Resumed with your message.'])assert.ok(!mainText.includes(leaked),leaked);
});

test('every agent keeps its own complete thread, including nested, failed and resumed runs',()=>{
  const c=controller();interleavedSession(c);
  const a=c.agentEntries('agent-a'),b=c.agentEntries('agent-b'),n=c.agentEntries('agent-n');
  assert.deepEqual(a.map(entry=>[entry.kind,entry.text]),[['thinking','Where is it?'],['tool','Read'],['tool','Agent'],['assistant','Resumed with your message.']]);
  assert.equal(a.find(entry=>entry.id==='tool:read-1').status,'done');
  assert.equal(a.find(entry=>entry.id==='tool:call-n').taskId,'agent-n');
  assert.deepEqual(n.map(entry=>entry.text),['Nested finding.']);
  assert.deepEqual(b.map(entry=>[entry.kind,entry.status??'']),[['assistant',''],['tool','error']]);
  assert.equal(c.state.tasks['agent-b'].status,'failed');
  assert.ok(a.every(entry=>entry.agent===undefined));
  assert.deepEqual(Object.keys(c.state.agentStreams).sort(),['agent-a','agent-b','agent-n']);
  assert.equal(c.state.agentStreams['agent-a'].entries,4);
  assert.equal(c.state.agentStreams['agent-a'].lastAction,'Agent Dig deeper');
  assert.equal(c.state.agentStreams['agent-b'].lastAction,'Bash npm test');
});

test('the main transcript links each launch row to its agent; nested launches link inside the parent thread',()=>{
  const c=controller();interleavedSession(c);
  assert.equal(c.state.entries.find(entry=>entry.id==='tool:call-a').taskId,'agent-a');
  assert.equal(c.state.entries.find(entry=>entry.id==='tool:call-b').taskId,'agent-b');
  assert.equal(c.state.entries.find(entry=>entry.id==='tool:call-n'),undefined);
});

test('frames that arrive before their agent is known are adopted once the agent id is learned',()=>{
  const c=controller();
  c.receive(stream('call-early',{type:'message_start',message:{id:'e1'}}));
  c.receive(stream('call-early',{type:'content_block_start',index:0,content_block:{type:'text',text:'Early'}}));
  assert.deepEqual(Object.keys(c.state.agentStreams),['call-early']);
  c.receive(started('agent-e','call-early'));
  assert.deepEqual(Object.keys(c.state.agentStreams),['agent-e']);
  c.receive(assistant('call-early','agent-e','e1',[{type:'text',text:'Early done'}]));
  assert.deepEqual(c.agentEntries('agent-e').map(entry=>entry.text),['Early done']);
  assert.equal(c.state.entries.length,0);
});

function relaySession(){
  const c=controller();interleavedSession(c);
  const stops=[];
  c.state.ready=true;c.query={stopTask:async id=>{stops.push(id);}};
  return {c,pushed:()=>c.input.values,stops};
}

test('a message to an agent is relayed through the main agent and follows the SendMessage call to its result',()=>{
  const {c,pushed}=relaySession();
  c.sendToAgent('agent-b','Please retry with --verbose');
  const [sent]=pushed();
  assert.equal(sent.parent_tool_use_id,null);
  assert.match(sent.message.content,/to: "agent-b"/);
  assert.match(sent.message.content,/Please retry with --verbose/);
  assert.equal(c.state.entries.at(-1).text,'→ general-purpose: Please retry with --verbose');
  assert.equal(c.agentEntries('agent-b').at(-1).text,'Please retry with --verbose');
  assert.equal(c.state.agentStreams['agent-b'].relay.status,'queued');
  c.receive({type:'user',session_id:SESSION,uuid:sent.uuid,parent_tool_use_id:null,message:sent.message});
  assert.equal(c.state.entries.find(entry=>entry.id===sent.uuid).text,'→ general-purpose: Please retry with --verbose');
  c.receive(assistant(null,undefined,'m3',[{type:'tool_use',id:'send-b',name:'SendMessage',input:{to:'agent-b',message:'Please retry with --verbose'}}]));
  assert.equal(c.state.agentStreams['agent-b'].relay.status,'sent');
  c.receive({...result(null,undefined,'send-b','Message queued'),tool_use_result:{success:true,message:'Message queued for delivery to agent-b at its next tool round.'}});
  assert.deepEqual([c.state.agentStreams['agent-b'].relay.status,c.state.agentStreams['agent-b'].relay.detail],['delivered','Message queued for delivery to agent-b at its next tool round.']);
});

test('a refused SendMessage marks the relay failed with the engine reason',()=>{
  const {c}=relaySession();
  c.sendToAgent('agent-a','Continue');
  c.receive(assistant(null,undefined,'m4',[{type:'tool_use',id:'send-a',name:'SendMessage',input:{to:'agent-a',message:'Continue'}}]));
  c.receive({...result(null,undefined,'send-a','not reachable'),tool_use_result:{success:false,message:'agent-a is not reachable'}});
  assert.deepEqual([c.state.agentStreams['agent-a'].relay.status,c.state.agentStreams['agent-a'].relay.detail],['failed','agent-a is not reachable']);
});

test('agents the user stopped, and sessions without SendMessage, refuse messages instead of faking delivery',async()=>{
  const {c,pushed,stops}=relaySession();
  await c.stopTask('agent-a');
  assert.deepEqual(stops,['agent-a']);
  assert.throws(()=>c.sendToAgent('agent-a','More'),/agent you stopped/);
  c.state.agentMessaging=false;
  assert.throws(()=>c.sendToAgent('agent-b','More'),/no SendMessage tool/);
  assert.equal(pushed().length,0);
});

test('conversation reset clears every agent thread and route',()=>{
  const c=controller();interleavedSession(c);
  c.receive(system('conversation_reset',{}));
  assert.deepEqual(Object.keys(c.state.agentStreams),[]);
  assert.deepEqual(c.agentEntries('agent-a'),[]);
});

test('resumed history keeps sub-agent frames out of the main transcript and links agent launches to their agent',()=>{
  const at='2026-10-17T10:00:00.000Z';
  const messages=[
    {type:'assistant',uuid:'h1',timestamp:at,parent_tool_use_id:null,message:{id:'hm1',content:[agentCall('call-h','History agent','Explore')]}},
    {type:'assistant',uuid:'h2',timestamp:at,parent_tool_use_id:'call-h',message:{id:'hm2',content:[{type:'text',text:'Sub-agent text'}]}},
    {type:'user',uuid:'h3',timestamp:at,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:'call-h',content:'Done.\nagentId: a1b2c3 (use SendMessage to continue)'}]}},
  ];
  const {entries}=historyEntries(messages.filter(message=>!isSubagentMessage(message)));
  assert.deepEqual(entries.map(entry=>[entry.id,entry.taskId]),[['tool:call-h','a1b2c3']]);
  assert.equal(reportedAgentId('Read',undefined,'agentId: x'),undefined);
  assert.equal(reportedAgentId('Agent',{agentId:'structured'},'agentId: text'),'structured');
});

test('relay prompt and SendMessage outcome helpers',()=>{
  assert.match(relayPrompt('agent-x','Explore','hi'),/exactly once with to: "agent-x"/);
  assert.equal(relayTarget({id:'t',kind:'tool',text:'SendMessage',toolName:'SendMessage',input:{to:'agent-x'}}),'agent-x');
  assert.equal(relayTarget({id:'t',kind:'tool',text:'Read',toolName:'Read',input:{to:'agent-x'}}),undefined);
  assert.deepEqual(relayOutcome({id:'t',kind:'tool',text:'',status:'running'}),{status:'sent'});
  assert.equal(relayOutcome({id:'t',kind:'tool',text:'',status:'error',isError:true,output:'boom'}).status,'failed');
});

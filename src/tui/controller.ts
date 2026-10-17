import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join,resolve,extname } from 'node:path';
import { query,listSessions,getSessionInfo,getSessionMessages,getSubagentMessages,renameSession,forkSession,deleteSession, type Query,type Options,type SDKUserMessage,type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { prepareSession,installedClaudePath,type PreparedSession } from '../launcher.js';
import { nativeContextSettings,type Model } from '../models.js';
import { validateConfig,saveConfig,configHome,type Config } from '../config.js';
import { nativeDialogKinds,describeNativeDialog } from './native-dialogs.js';
import { safeText } from './editor.js';
import { tuiOptions } from './options.js';
import { trustDirectory,isWorkspaceTrusted,isHomeDirectory } from './trust.js';
import { assertCompatVersion,launchWorkspaceTrust,invokeCompat } from './compat.js';
import { cleanupSavedImages } from './opencode/clipboard-image.js';
import { TOKEN_HEADER } from '../gateway.js';
import type { TranscriptEntry } from './transcript-model.js';
import { applyTaskMessage,applyBackgroundTasks,type TaskView } from './task-model.js';
import { AgentStreams,type AgentStreamView } from './agent-streams.js';
import { SEND_MESSAGE_TOOL,relayOutcome,relayPrompt,relayTarget } from './agent-relay.js';
import { isSubagentMessage } from './transcript-model.js';
import { changeWorkingDirectory,trustDirectoryPrompt } from './working-directory.js';
import { StreamTrace } from './stream-trace.js';
import { contentBlockEntry,historyEntries,isMetaMessage,permissionEntry,permissionOutcome,promptText,sanitizeEntry,suggestionRules,toolResultEntry,toolStartEntry,type PermissionRecord } from './transcript-model.js';
import { imageBlocks } from './image-info.js';
import type { UsageSnapshot } from '../usage.js';
import type { RouteNotice } from '../route-events.js';
import { RouteTracker,RETRY_PROMPT,type RouteMarker,type RouteOffer,type RouteToast,type RouteView } from './route-model.js';

export interface FormField {key:string;label:string;type?:'text'|'number'|'boolean'|'json';required?:boolean;options?:string[];multi?:boolean;secret?:boolean}
export type { TaskKind,TaskStatus,TaskView } from './task-model.js';
export type UserPermissionMode='default'|'acceptEdits'|'plan';
/** Modes the user can switch to from the TUI. None of them skips permission prompts. */
const PERMISSION_CYCLE:readonly UserPermissionMode[]=['default','acceptEdits','plan'];
const SESSION_TITLE_LIMIT=80;
const AGENT_TRANSCRIPT_TAIL=400;
export interface PendingDialog {
  id:string;title:string;description:string;fields:FormField[];
  choices:{label:string;value:unknown}[];defaultIndex:number;
}
export interface TuiState {
  ready:boolean;busy:boolean;sessionId:string;model:string;permissionMode:string;status:string;
  entries:TranscriptEntry[];models:Model[];commands:any[];agents:any[];tasks:Record<string,TaskView>;sessionTitle?:string;
  hookActivity:{id:string;name:string;outcome:string}[];
  context:any;usage?:UsageSnapshot;pending:PendingDialog[];lastRoute?:RouteView;
  /** Actual routed model per gateway agent id; agent ids equal local_agent task ids. */
  agentRoutes?:Record<string,RouteView>;routeOffers?:RouteOffer[];routeToast?:RouteToast;
  /** Per sub-agent: revision of its own transcript, last action and relay state. */
  agentStreams?:Record<string,AgentStreamView>;
  /** Whether the engine offers SendMessage, the only path for a message to reach a sub-agent; unknown before init. */
  agentMessaging?:boolean;
}
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private values:SDKUserMessage[]=[];private nextValue?: (value:IteratorResult<SDKUserMessage>)=>void;private ended=false;
  push(value:SDKUserMessage) {if(this.ended)throw new Error('Session is closed.');if(this.nextValue){const next=this.nextValue;this.nextValue=undefined;next({value,done:false});}else this.values.push(value);}
  close(){this.ended=true;this.values=[];this.nextValue?.({value:undefined,done:true});this.nextValue=undefined;}
  [Symbol.asyncIterator](){return {next:async():Promise<IteratorResult<SDKUserMessage>>=>this.values.length?{value:this.values.shift()!,done:false}:this.ended?{value:undefined,done:true}:new Promise(resolve=>{this.nextValue=resolve;})};}
}

export class TuiController extends EventEmitter {
  revision=0;
  readonly state:TuiState={ready:false,busy:false,sessionId:'',model:'default',permissionMode:'default',status:'Starting Claude Code…',entries:[],models:[],commands:[],agents:[],tasks:{},hookActivity:[],context:null,pending:[]};
  session?:PreparedSession;query?:Query;claudePath='claude';
  private routes=new RouteTracker();
  private input=new InputQueue();private closing=false;private generation=0;private streamIds=new Map<string,string>();
  private trace=new StreamTrace();private thinking:{entryId?:string;pendingTokens?:number}={};
  private decisions=new Map<string,{promise:Promise<any>;resolve:(value:any)=>void;cancel:unknown}>();
  private timer?:ReturnType<typeof setInterval>;private initialPromptConsumed=false;private trustQuery?:Query;private homeTrustAccepted=false;
  cwd=process.cwd();
  private readonly agents=new AgentStreams({changed:()=>this.changed(),taskOfTool:id=>this.taskOfTool(id)});
  private readonly stoppedAgents=new Set<string>();private readonly relayIds=new Set<string>();
  constructor(readonly args:string[],readonly config:Config){super();this.state.agentStreams=this.agents.views;}
  subscribe=(listener:()=>void)=>{this.on('change',listener);return()=>{this.off('change',listener);};};
  changed(){this.revision++;this.emit('change');}
  notice(text:string,error=false){this.upsert({id:randomUUID(),kind:error?'error':'notice',text:safeText(text)});}
  private upsert(entry:TranscriptEntry){
    entry=sanitizeEntry(entry);
    const i=this.state.entries.findIndex(e=>e.id===entry.id);
    if(i<0)this.state.entries.push(entry);else this.state.entries[i]={...this.state.entries[i],...entry};
    if(this.state.entries.length>3000)this.state.entries.splice(0,this.state.entries.length-3000);
    this.changed();
  }
  private entry(id:string){return this.state.entries.find(e=>e.id===id);}
  private patchEntry(id:string,patch:Partial<TranscriptEntry>){const i=this.state.entries.findIndex(e=>e.id===id);if(i>=0){this.state.entries[i]={...this.state.entries[i],...patch};this.changed();}}
  private resetTranscript(){this.state.entries=[];this.state.tasks={};this.trace.reset();this.thinking={};this.agents.reset();this.stoppedAgents.clear();this.relayIds.clear();}
  private updateUsage(){if(this.session)this.state.usage=this.session.gateway.manifest().usage;this.changed();}

  async start(resume?:string,fresh=false){
    const generation=++this.generation;
    this.closing=false;this.input=new InputQueue();this.state.hookActivity=[];this.state.ready=false;this.state.status='Connecting to installed Claude Code…';this.changed();
    let prepared:PreparedSession|undefined;let activeQuery:Query|undefined;
    try {
    this.claudePath=await installedClaudePath();if(generation!==this.generation)return;
    this.routes=new RouteTracker(this.config.fallback);this.showRoutes();
    prepared=await prepareSession(this.args,this.config,{quiet:true,onEvent:e=>{
      if(generation!==this.generation)return;
      if(e.event==='request'||e.event==='fallback'){const badge=this.routes.observeRequest(e);if(badge)this.showMarker(badge);this.showRoutes();}
      this.updateUsage();
    }});
    if(generation!==this.generation){await prepared.close();return;}this.session=prepared;
    prepared.gateway.subscribeRoutes(notice=>{if(generation===this.generation)this.receiveRoute(notice);});
    const parsed=await tuiOptions(this.session.args,this.cwd);
    const options:Options={...parsed.options,cwd:this.cwd,pathToClaudeCodeExecutable:this.claudePath,
      env:{...this.session.env,...parsed.options.env},settings:this.session.settings,
      systemPrompt:parsed.options.systemPrompt??{type:'preset',preset:'claude_code'},
      settingSources:parsed.options.settingSources??['user','project','local'],
      plugins:[...(parsed.options.plugins??[]),{type:'local',path:this.session.plugin}],
      includePartialMessages:true,forwardSubagentText:true,includeHookEvents:true,enableFileCheckpointing:true,
      perTaskStopAffordance:true,agentProgressSummaries:true,
      canUseTool:(name,input,meta)=>this.permission(name,input,meta),
      onElicitation:(request,meta)=>this.elicitation(request,meta),
      supportedDialogKinds:nativeDialogKinds,
      onUserDialog:async(request,meta)=>{
        const spec=describeNativeDialog(request);if(!spec)return {behavior:'cancelled'};
        const choice=await this.ask({id:meta.requestId,title:spec.title,description:spec.description,fields:spec.fields??[],choices:spec.choices.map(c=>({label:c.label,value:c.result})),defaultIndex:spec.defaultIndex},meta.signal,null);
        return choice===null?{behavior:'cancelled'}:{behavior:'completed',result:choice};
      },
      stderr:chunk=>{const text=safeText(chunk).trim();if(text&&!text.includes('unrecognized_model'))this.notice(text.slice(0,2000));}
    };
    if(fresh||resume){delete options.resume;delete options.continue;delete options.sessionId;delete options.forkSession;delete options.resumeSessionAt;delete options.resumeDropsTurn;}
    if(fresh){options.model=this.config.model??(this.state.model==='default'?undefined:this.state.model);
      if(options.model){const effort=this.config.modelEffort?.[options.model];if(effort)options.effort=effort as 'low'|'medium'|'high'|'xhigh'|'max';}}
    if(resume)options.resume=resume;
    if(options.continue&&!options.resume){const sessions=await listSessions({dir:this.cwd,limit:1});if(sessions[0]){options.resume=sessions[0].sessionId;delete options.continue;}}
    this.state.model=options.model??'default';
    if(options.resume){this.state.sessionId=options.resume;await this.restore(options.resume);}
    if(generation!==this.generation){await prepared.close();return;}
    const directory=await trustDirectory(this.cwd);
    const homeWorkspace=await isHomeDirectory(directory);
    const trusted=homeWorkspace?this.homeTrustAccepted:await isWorkspaceTrusted(directory);if(generation!==this.generation)return;
    if(!trusted){
      const accepted=await this.ask({id:'workspace-trust:'+generation,title:homeWorkspace?'Trust your home directory for this session?':'Do you trust this project?',description:directory+'\n\nTrust allows this project’s configured tools, hooks, plugins and permission allow rules to load. Only trust code you own or have reviewed. '+(homeWorkspace?'Home-directory consent lasts only while this TUI is open; it is never saved as permanent workspace trust.':'Claude Code itself will record your explicit choice; Claudapter never rewrites its config file.'),fields:[],choices:[{label:'Cancel session startup',value:false},{label:homeWorkspace?'Trust for this session':'Trust this project',value:true}],defaultIndex:0},undefined,false);
      if(generation!==this.generation){await prepared.close();return;}
      if(accepted){
        assertCompatVersion(prepared.claudeVersion);
        if(homeWorkspace){this.homeTrustAccepted=true;this.notice('Home directory trusted for this TUI session only.');}
        else{
        // Claude Code only records trust when cwd and the trusted directory match exactly, including Windows path case.
        const trustQuery=query({prompt:new InputQueue(),options:{cwd:directory,pathToClaudeCodeExecutable:this.claudePath,env:this.session.env,persistSession:false,settingSources:[],plugins:[],mcpServers:{},strictMcpConfig:true,...launchWorkspaceTrust(directory,true)}});this.trustQuery=trustQuery;
        try{const handshake=await trustQuery.initializationResult();if(!(handshake as any).workspace_trust_recorded&&!await isWorkspaceTrusted(directory))throw new Error('Claude Code did not acknowledge workspace trust.');}
        finally{trustQuery.close();if(this.trustQuery===trustQuery)this.trustQuery=undefined;}
        this.notice('Project trust recorded by Claude Code. Loading trusted configuration.');
        }
      }else{await prepared.close();this.session=undefined;this.state.status='Project trust declined — exit or start a new session';this.changed();return;}
    }
    if(homeWorkspace&&this.homeTrustAccepted){assertCompatVersion(prepared.claudeVersion);Object.assign(options,launchWorkspaceTrust(directory,true));}
    if(generation!==this.generation){await prepared.close();return;}
    activeQuery=query({prompt:this.input,options});this.query=activeQuery;
    void this.consume(activeQuery,generation);
    const initialized=await activeQuery.initializationResult();
    if(generation!==this.generation){activeQuery.close();await prepared.close();return;}
    this.state.commands=initialized.commands??[];this.state.models=this.session.registry.list();
    const agents=await activeQuery.supportedAgents();if(generation!==this.generation)return;this.state.agents=agents;
    this.state.ready=true;this.state.status='Ready';await this.refreshContext();if(generation!==this.generation)return;
    this.timer=setInterval(()=>this.updateUsage(),1500);this.timer.unref();this.changed();
    if(parsed.showResumePicker&&!fresh&&!resume)this.emit('resume-picker');
    if(parsed.initialPrompt&&!resume&&!fresh&&!this.initialPromptConsumed){this.initialPromptConsumed=true;this.send(parsed.initialPrompt);}
    }catch(error){activeQuery?.close();await prepared?.close();if(generation===this.generation){this.query=undefined;this.session=undefined;this.state.ready=false;this.state.busy=false;this.changed();throw error;}}
  }

  private async consume(q:Query,generation:number){
    try{for await(const message of q){if(generation!==this.generation)break;this.receive(message);}}
    catch(error){if(!this.closing&&generation===this.generation)this.notice((error as Error).message,true);}
    finally{if(generation===this.generation){this.state.ready=false;this.state.busy=false;this.state.status=this.closing?'Closed':'Session stopped';this.changed();}}
  }

  receive(message:any){
    if(message.session_id)this.state.sessionId=message.session_id;
    if(isSubagentMessage(message)){this.receiveAgentMessage(message);return;}
    if(message.type==='user'&&this.relayIds.has(message.uuid))return;
    const parent=message.parent_tool_use_id??'main';
    if(message.type==='stream_event')return this.receiveStream(message.event,parent);
    if(message.type==='assistant')this.receiveAssistant(message,parent);
    else if(message.type==='user')this.receiveUser(message);
    else if(message.type==='result'){
      this.state.busy=false;this.state.status=message.is_error?'Turn failed':'Ready';
      if(message.is_error)this.notice(message.result??(message.errors??[]).join('\n')??'Turn failed.',true);
      void this.refreshContext().catch(()=>{});this.updateUsage();
    }else if(message.type==='system')this.receiveSystem(message);
    this.trackRelays(message);
    this.changed();
  }

  private receiveStream(event:any,parent:string){
    if(event.type==='message_start')this.streamIds.set(parent,event.message.id);
    const messageId=this.streamIds.get(parent)??'stream';const key='block:'+messageId+':'+event.index;
    const agent=parent==='main'?undefined:parent;
    if(event.type==='content_block_start')this.startStreamBlock(messageId,key,event.content_block,agent);
    else if(event.type==='content_block_delta'){
      const entry=this.entry(key);
      if(entry){entry.text+=safeText(event.delta.text??event.delta.thinking??'');this.changed();}
    }
    else if(event.type==='content_block_stop')this.stopStreamBlock(key);
    else if(event.type==='message_stop')this.thinking.entryId=undefined;
  }
  private startStreamBlock(messageId:string,key:string,block:any,agent:string|undefined){
    if(block.type==='tool_use'){this.upsertTool(block,agent);return;}
    const entry=contentBlockEntry(key,block,agent,true);if(!entry)return;
    this.trace.streamedBlock(messageId,key);
    if(entry.kind==='thinking'){entry.thinkingTokens=this.thinking.pendingTokens;this.thinking={entryId:key};}
    this.upsert(entry);
  }
  private stopStreamBlock(key:string){
    if(this.thinking.entryId!==key)return;
    this.thinking.entryId=undefined;
    if(!this.entry(key)?.text)this.patchEntry(key,{redacted:true});
  }
  /** Thinking progress arrives as a token estimate while the model hides the thinking text. */
  private updateThinkingTokens(tokens:unknown){
    if(typeof tokens!=='number'||!Number.isFinite(tokens))return;
    const id=this.thinking.entryId;
    if(!id){this.thinking.pendingTokens=tokens;return;}
    this.patchEntry(id,{thinkingTokens:tokens,...(this.entry(id)?.text?{}:{redacted:true})});
  }

  private receiveAssistant(message:any,parent:string){
    const agent=parent==='main'?undefined:parent;
    for(const [index,block] of (message.message?.content??[]).entries()){
      if(block.type==='tool_use')this.upsertTool(block,agent);
      else{
        const kind=block.type==='text'?'assistant':'thinking';
        const entry=contentBlockEntry(this.trace.finalBlockId(message,index,kind,id=>this.entry(id)?.kind),block,agent);
        if(entry)this.upsert(entry);
      }
    }
  }
  private upsertTool(block:any,agent:string|undefined){
    const previous=this.entry('tool:'+block.id);const finished=previous?.status==='done'||previous?.status==='error';
    const start=toolStartEntry(block,agent);
    this.trace.toolStarted(block.id);
    this.upsert({...start,status:previous?.status??'running',details:finished?previous.details:start.details,taskId:this.taskOfTool(block.id)});
  }
  private taskOfTool(toolUseId:string){return Object.values(this.state.tasks).find(task=>task.toolUseId===toolUseId)?.id;}

  private receiveUser(message:any){
    const content=message.message?.content;
    const text=isMetaMessage(message)?'':promptText(content);
    if(text)this.upsert({id:message.uuid??message.message?.id??randomUUID(),kind:'user',text});
    const results=(Array.isArray(content)?content:[]).filter((block:any)=>block.type==='tool_result');
    for(const block of results){
      const existing=this.entry('tool:'+block.tool_use_id);
      if(existing?.status==='done'||existing?.status==='error')continue;
      this.trace.rememberAgent(block.tool_use_id,message.tool_use_result?.agentId);
      this.upsert(toolResultEntry(block,{existing,elapsedMs:this.trace.toolElapsedMs(block.tool_use_id),result:results.length===1?message.tool_use_result:undefined}));
    }
  }

  private receiveSystem(message:any){
    if(message.subtype==='init'){this.state.model=message.model??this.state.model;this.state.permissionMode=message.permissionMode??this.state.permissionMode;}
    if(message.subtype==='init'&&Array.isArray(message.tools))this.state.agentMessaging=message.tools.includes(SEND_MESSAGE_TOOL);
    if(message.subtype==='commands_changed'&&Array.isArray(message.commands))this.state.commands=message.commands;
    if(message.subtype==='thinking_tokens')this.updateThinkingTokens(message.estimated_tokens);
    if(message.subtype==='hook_started'||message.subtype==='hook_response')this.receiveHook(message);
    if(message.subtype?.startsWith('task_')){applyTaskMessage(this.state.tasks,message);this.linkTaskToTool(this.state.tasks[message.task_id]);}
    if(message.subtype==='background_tasks_changed'&&Array.isArray(message.tasks))applyBackgroundTasks(this.state.tasks,message.tasks);
    if(message.subtype==='informational'&&(message.level==='warning'||message.level==='suggestion'||message.halt))this.notice(message.content??'Engine warning',Boolean(message.halt));
    if(message.subtype==='local_command_output')this.notice(message.content??message.output??JSON.stringify(message));
    if(['notification','compact_boundary','permission_denied','api_retry','model_refusal_fallback'].includes(message.subtype))this.notice(message.message??message.content??message.description??message.subtype,message.subtype==='permission_denied');
    if(message.subtype==='conversation_reset')this.resetTranscript();
  }
  private receiveHook(message:any){
    const id=message.hook_id??message.uuid??randomUUID();
    const activity={id,name:safeText(message.hook_name??message.hook_event??'Hook'),outcome:safeText(message.subtype==='hook_started'?'running':message.outcome??'completed')};
    const previous=this.state.hookActivity.findIndex(hook=>hook.id===id);
    if(previous<0)this.state.hookActivity.push(activity);else this.state.hookActivity[previous]=activity;
    if(this.state.hookActivity.length>100)this.state.hookActivity.splice(0,this.state.hookActivity.length-100);
    if(['error','failed','failure','blocked','cancelled'].includes(activity.outcome)||message.exit_code>0)
      this.upsert({id:'hook-error:'+id,kind:'error',text:'Hook '+activity.name+': '+activity.outcome+((message.stderr||message.output)?'\n'+safeText(message.stderr||message.output).slice(0,2000):'')});
  }
  /** Ties a task to the tool call that started it, in the main transcript or the spawning agent's own, and to its agent stream. */
  private linkTaskToTool(task:TaskView|undefined){
    if(!task?.toolUseId)return;
    if(task.kind==='agent')this.agents.learn(task.toolUseId,task.id);
    const tool=this.entry('tool:'+task.toolUseId);
    if(tool&&tool.taskId!==task.id)this.patchEntry(tool.id,{taskId:task.id});
    this.agents.linkTask(task.toolUseId,task.id);
  }

  // Sub-agents: own transcripts, relayed messages, stop and backgrounding. Routed models live in state.agentRoutes.
  private receiveAgentMessage(message:any){this.agents.receive(message);}
  /** Follows the main agent's SendMessage calls to agents with a pending relay, from the call to its own result. */
  private trackRelays(message:any){
    if(message.type!=='assistant'&&message.type!=='user')return;
    const content=Array.isArray(message.message?.content)?message.message.content:[];
    for(const block of content){
      const id=block.type==='tool_use'?block.id:block.type==='tool_result'?block.tool_use_id:undefined;
      const tool=id?this.entry('tool:'+id):undefined;
      const agentId=tool&&relayTarget(tool);
      const relay=agentId?this.state.agentStreams?.[agentId]?.relay:undefined;
      if(!relay||relay.status==='delivered'||relay.status==='failed')continue;
      this.agents.setRelay(agentId!,{...relay,...relayOutcome(tool!),at:Date.now()});
    }
  }
  /** A copy of the live transcript of a sub-agent; empty until its first frame arrives. */
  agentEntries(agentId:string):TranscriptEntry[]{return this.agents.entries(agentId);}
  /**
   * Sends the user's text to a sub-agent. The engine has no host path into a sub-agent's conversation, so the
   * main agent is asked to call SendMessage; the relay state follows that call (see agent-relay.ts).
   */
  sendToAgent(agentId:string,text:string){
    const message=text.trim();if(!message)return;
    if(!this.state.ready||!this.query)throw new Error('Claude Code is still starting.');
    if(this.state.agentMessaging===false)throw new Error('This Claude Code session has no SendMessage tool, so no sub-agent can receive messages.');
    if(this.stoppedAgents.has(agentId))throw new Error('Claude Code does not deliver messages to an agent you stopped.');
    const task=this.state.tasks[agentId];const label=task?.subagentType??task?.title??agentId;const uuid=randomUUID();
    this.relayIds.add(uuid);
    this.agents.add(agentId,{id:uuid,kind:'user',text:message});
    this.agents.setRelay(agentId,{status:'queued',text:safeText(message),at:Date.now()});
    this.upsert({id:uuid,kind:'user',text:'→ '+label+': '+message});
    this.state.busy=true;this.state.status='Working';
    this.input.push({type:'user',uuid,session_id:this.state.sessionId,parent_tool_use_id:null,message:{role:'user',content:relayPrompt(agentId,label,message)}});this.changed();
  }
  /** Moves a foreground agent to the background so the main agent can continue (and relay messages to it). */
  async backgroundAgent(agentId:string){
    const toolUseId=this.state.tasks[agentId]?.toolUseId;
    if(!toolUseId||!this.query)throw new Error('This agent has no running tool call to move to the background.');
    if(!await this.query.backgroundTasks(toolUseId))throw new Error('The agent is not running in the foreground.');
  }

  send(text:string,attachments:any[]=[]){
    if(!this.state.ready||!this.query)throw new Error('Claude Code is still starting.');
    if(!text.trim()&&!attachments.length)return;
    const uuid=randomUUID();this.routes.startTurn(uuid);const images=imageBlocks(attachments),files=attachments.length-images.length;this.upsert({id:uuid,kind:'user',text:text+(files?'\n['+files+' attachment(s)]':''),...(images.length?{images}:{})});
    this.state.sessionTitle??=safeText(text).trim().replace(/\s+/g,' ').slice(0,SESSION_TITLE_LIMIT)||undefined;
    this.state.busy=true;this.state.status='Working';
    this.input.push({type:'user',uuid,session_id:this.state.sessionId,parent_tool_use_id:null,message:{role:'user',content:attachments.length?[{type:'text',text},...attachments]:text}});this.changed();
  }
  async attach(path:string){
    const full=resolve(this.cwd,path);const data=await readFile(full);if(data.length>8*1024*1024)throw new Error('Attachments are limited to 8 MiB.');
    const ext=extname(full).toLowerCase();const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
    return mime[ext]?{type:'image',source:{type:'base64',media_type:mime[ext],data:data.toString('base64')}}:{type:'text',text:'Attached file '+full+':\n'+data.toString('utf8')};
  }
  async interrupt(){await this.query?.interrupt();this.state.busy=false;this.state.status='Interrupted';this.notice('Turn interrupted. Tools already completed are not undone.');}
  async setModel(id:string){if(this.state.busy)throw new Error('Wait for the turn or interrupt before switching models.');await this.query!.setModel(id);this.state.model=id;await this.refreshContext();
    const effort=this.config.modelEffort?.[id];if(effort)await this.query!.applyFlagSettings({effortLevel:effort as 'low'|'medium'|'high'|'xhigh'|'max'});
    this.notice('Model selected for this session: '+id+(effort?' · effort '+effort:''));}
  private receiveRoute(notice:RouteNotice){
    const marker=this.routes.apply(notice);
    if(marker)this.showMarker(marker);
    this.showRoutes();
  }
  /** A notice entry, so renderers without route support still show the plain marker text. */
  private showMarker(marker:RouteMarker){this.upsert({id:marker.id,kind:'notice',text:marker.text,route:marker} as TranscriptEntry);}
  private showRoutes(){
    this.state.lastRoute=this.routes.main;this.state.agentRoutes={...this.routes.agents};
    this.state.routeOffers=[...this.routes.offers];this.state.routeToast=this.routes.toast;this.changed();
  }
  /** Runs a recovery step the user picked. A retry is a new, visible prompt: the gateway never replays the failed request. */
  async runRouteOffer(action:'retry'|'back'|'pin'){
    const offer=this.routes.offers.find(candidate=>candidate.action===action);
    if(!offer||offer.action==='setup')throw new Error('No '+action+' option is available for the current route.');
    const session=this.session;if(!session)throw new Error('Claude Code is still starting.');
    if(offer.action==='pin'){await this.setModel(offer.model);return;}
    if(offer.action==='back'){session.gateway.state.reset(offer.session);return;}
    if(offer.target)session.gateway.state.steer({session:offer.session,requestClass:'main'},offer.requested,session.registry.resolve(offer.target));
    this.send(RETRY_PROMPT);
  }
  async refreshContext(){const q=this.query;if(!q)return;const context=await q.getContextUsage({detail:'summary'});if(q!==this.query)return;this.state.context=context;this.changed();}
  async refreshModels(){
    if(this.state.busy)throw new Error('Refresh model bindings between turns.');if(!this.session||!this.query)return;
    const response=await fetch(this.session.gateway.baseUrl+'/refresh',{method:'POST',headers:{[TOKEN_HEADER]:this.session.gateway.token}});
    if(!response.ok)throw new Error('Model catalog refresh failed.');
    const generated=nativeContextSettings(this.session.registry);
    const effective=(await invokeCompat(this.query,'getSettings')).effective;
    const modelSettings={...effective.modelSettings};
    for(const [id,window]of Object.entries(generated.modelSettings))modelSettings[id]={...modelSettings[id],...window};
    await this.query.applyFlagSettings({env:{...effective.env,...generated.env},modelSettings});
    this.state.models=this.session.registry.list();await this.refreshContext();this.notice('Model catalog and maximum context bindings refreshed.');
  }
  async refreshUsage(){
    if(!this.session)return;
    if(this.query){try{this.session.gateway.quotas.ingestClaudeSdkUsage(await this.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true}));}catch{this.session.gateway.quotas.ingestClaudeSdkUsage(null);}}
    await this.session.gateway.quotas.refresh();this.updateUsage();
  }
  /** Saved sessions of this directory with the full SDK metadata (title, branch, first prompt, size, tag). */
  async sessions():Promise<SDKSessionInfo[]>{return listSessions({dir:this.cwd,limit:100});}
  async resume(id:string){await this.stopEngine();this.resetTranscript();this.state.sessionTitle=undefined;await this.start(id);}
  async newSession(){await this.stopEngine();this.resetTranscript();this.state.sessionId='';this.state.sessionTitle=undefined;await this.start(undefined,true);}
  async rename(title:string){if(!this.state.sessionId)throw new Error('Send a message first.');await renameSession(this.state.sessionId,title,{dir:this.cwd});this.state.sessionTitle=safeText(title);this.notice('Session renamed: '+title);}
  async fork(){if(!this.state.sessionId)throw new Error('Send a message first.');const result=await forkSession(this.state.sessionId,{dir:this.cwd});await this.resume(result.sessionId);}
  async removeSession(id:string){if(id===this.state.sessionId)throw new Error('Close the current session before deleting it.');await deleteSession(id,{dir:this.cwd});}
  async stopTask(id:string){
    await this.query!.stopTask(id);this.stoppedAgents.add(id);this.notice('Stop requested for '+id);
    if(this.state.agentStreams?.[id])this.agents.add(id,{id:'notice:stop:'+randomUUID(),kind:'notice',text:'Stop requested by you'});
  }
  async exportTranscript(path:string){const result=await invokeCompat(this.query!,'exportConversation');await writeFile(resolve(this.cwd,path),result.text,{flag:'wx',mode:0o600});}
  async branchAt(messageId:string,restoreFiles=false){
    if(this.state.busy)throw new Error('Interrupt or finish the current turn first.');
    if(restoreFiles){const result=await this.query!.rewindFiles(messageId);if(!result.canRewind)throw new Error(result.error??'Files could not be restored.');}
    const result=await forkSession(this.state.sessionId,{dir:this.cwd,upToMessageId:messageId});await this.resume(result.sessionId);
  }
  async updateFallback(rules:unknown){
    const candidate=validateConfig({...this.config,fallback:rules});
    for(const rule of candidate.fallback.filter(r=>r.enabled)){this.session!.registry.resolve(rule.from);for(const id of rule.targets){const model=this.session!.registry.resolve(id);if(model.auth!=='authenticated')throw new Error('Fallback target is not signed in: '+id);}}
    await saveConfig(candidate);this.config.fallback.splice(0,this.config.fallback.length,...candidate.fallback);this.notice('Fallback rules saved and applied to this launcher.');this.changed();
  }
  async updateDefaultModel(model:string|undefined){
    if(model&&this.session)this.session.registry.resolve(model);
    const candidate=validateConfig(model?{...this.config,model}:{...this.config,model:undefined});
    await saveConfig(candidate);this.config.model=candidate.model;
    if(model&&this.query)await this.setModel(model);
    else this.notice(model?'Default model saved; it applies to new sessions.':'Default model cleared; new sessions use the native default.');
    this.changed();
  }
  async updateModelEffort(model:string,effort:string|undefined){
    const modelEffort={...this.config.modelEffort};
    if(effort)modelEffort[model]=effort;else delete modelEffort[model];
    const candidate=validateConfig({...this.config,modelEffort:Object.keys(modelEffort).length?modelEffort:undefined});
    await saveConfig(candidate);this.config.modelEffort=candidate.modelEffort;
    if(effort&&this.state.model===model)await this.query?.applyFlagSettings({effortLevel:effort as 'low'|'medium'|'high'|'xhigh'|'max'});
    this.notice(effort?'Default effort for '+model+': '+effort:'Default effort for '+model+' cleared.');this.changed();
  }
  /** Rebuild the transcript of a saved session: its newest entries only, with tool calls closed. */
  async restore(id:string){
    const history=historyEntries((await getSessionMessages(id,{dir:this.cwd}) as any[]).filter(message=>!isSubagentMessage(message)));
    this.state.entries=history.entries.map(sanitizeEntry);
    this.state.sessionTitle=await this.savedSessionTitle(id);
    this.notice('Resumed '+id+'. Existing native history retained.');
  }
  private async savedSessionTitle(id:string){
    const info=await getSessionInfo(id,{dir:this.cwd}).catch(()=>undefined);
    const title=info?.customTitle||info?.summary||info?.firstPrompt;
    return title?safeText(title).trim().replace(/\s+/g,' ').slice(0,SESSION_TITLE_LIMIT):undefined;
  }
  /**
   * Messages of a sub-agent as transcript entries. A local_agent task id is the agent id that names the
   * transcript file (agent-<id>.jsonl); the Agent tool result also reports an `agentId`, tried second.
   * Tasks without a transcript of their own (shells, monitors, workflow members) yield [].
   */
  async agentTranscript(taskId:string):Promise<TranscriptEntry[]>{
    if(!this.state.sessionId)return [];
    const toolUseId=this.state.tasks[taskId]?.toolUseId;
    const reported=this.trace.agentOf(toolUseId)??this.agents.reportedAgent(toolUseId);
    for(const agentId of new Set([taskId,reported])){
      if(!agentId)continue;
      const messages=await getSubagentMessages(this.state.sessionId,agentId,{dir:this.cwd}).catch(()=>[]);
      if(messages.length)return historyEntries(messages as any[],AGENT_TRANSCRIPT_TAIL).entries.map(sanitizeEntry);
    }
    return [];
  }

  async setPermissionMode(mode:UserPermissionMode){
    if(!PERMISSION_CYCLE.includes(mode))throw new Error('Permission mode cannot be selected here: '+mode);
    if(!this.query)throw new Error('Claude Code is still starting.');
    await this.query.setPermissionMode(mode);this.state.permissionMode=mode;this.changed();
  }
  /** default → acceptEdits → plan → default. Any other current mode returns to default. */
  async cyclePermissionMode(){
    const current=PERMISSION_CYCLE.indexOf(this.state.permissionMode as UserPermissionMode);
    const next=PERMISSION_CYCLE[(current+1)%PERMISSION_CYCLE.length];
    await this.setPermissionMode(next);return next;
  }

  /** `/cd`: moves the live session to another project after revalidating its settings and renewing trust. */
  async changeDirectory(input:string):Promise<string>{
    if(this.state.busy)throw new Error('Interrupt or finish the current turn before changing directory.');
    const query=this.query,session=this.session;
    if(!query||!session||!this.state.ready)throw new Error('Claude Code is still starting.');
    const change=await changeWorkingDirectory({cwd:this.cwd,query,args:this.args,config:this.config,registry:session.registry,
      confirmTrust:directory=>this.ask({id:'directory-trust:'+randomUUID(),title:'Do you trust this project?',description:trustDirectoryPrompt(directory),fields:[],
        choices:[{label:'Stay in the current directory',value:false},{label:'Trust and switch',value:true}],defaultIndex:0},undefined,false)},input);
    if(!change.changed){this.notice('Already working in '+change.cwd);return change.cwd;}
    process.chdir(change.cwd);this.cwd=change.cwd;
    if(query===this.query){this.state.agents=await query.supportedAgents();this.state.commands=await query.supportedCommands();await this.refreshContext();}
    this.notice('Working directory changed to '+change.cwd+'. Saved sessions now list the conversations of this directory.');this.changed();
    return change.cwd;
  }

  ask(dialog:PendingDialog,signal:AbortSignal|undefined,cancel:unknown):Promise<any>{
    const duplicate=this.decisions.get(dialog.id);if(duplicate)return duplicate.promise;
    let settle!:(value:any)=>void;const promise=new Promise(resolve=>{settle=resolve;});
    const resolve=(value:any)=>{signal?.removeEventListener('abort',abort);this.decisions.delete(dialog.id);this.state.pending=this.state.pending.filter(d=>d.id!==dialog.id);settle(value);this.changed();};
    const abort=()=>resolve(cancel);
    this.decisions.set(dialog.id,{promise,resolve,cancel});
    if(signal?.aborted){abort();return promise;}
    signal?.addEventListener('abort',abort,{once:true});this.state.pending.push(dialog);this.changed();return promise;
  }
  answer(id:string,value:unknown,fields:Record<string,string>={}){
    const pending=this.state.pending.find(d=>d.id===id);if(!pending)return;
    const decision=this.decisions.get(id);if(!decision)return;
    const output:Record<string,unknown>=Object.create(null);
    if(value==='submit')for(const field of pending.fields){
      const text=Object.hasOwn(fields,field.key)?fields[field.key]:'';if(typeof text!=='string')throw new Error('Invalid form field value.');if(field.required&&!text.trim())throw new Error(field.label+' is required.');
      if(!field.required&&!text.trim())continue;
      if(field.type==='number'&&(!text.trim()||!Number.isFinite(Number(text))))throw new Error(field.label+' must be a finite number.');
      if(field.type==='boolean'&&!['true','false'].includes(text))throw new Error(field.label+' must be true or false.');
      output[field.key]=field.type==='boolean'?text==='true':field.type==='number'?Number(text):field.type==='json'?JSON.parse(text||'null'):text;
    }
    decision.resolve(value==='submit'?{fields:output}:value);
  }
  cancelDialog(id:string){const d=this.decisions.get(id);d?.resolve(d.cancel);}

  private async permission(name:string,input:Record<string,unknown>,meta:any):Promise<any>{
    if(name==='AskUserQuestion'){
      const questions=Array.isArray(input.questions)?input.questions as any[]:[];
      const result=await this.ask({id:meta.requestId,title:'Claude has a question',description:'Choose an answer or enter your own. Multi-select answers can be comma-separated.',fields:questions.map(q=>({key:q.question,label:q.question,required:true,options:(q.options??[]).map((o:any)=>o.label),multi:q.multiSelect})),choices:[{label:'Cancel',value:null},{label:'Submit answers',value:'submit'}],defaultIndex:0},meta.signal,null);
      return result?{behavior:'allow',updatedInput:{...input,answers:result.fields}}:{behavior:'deny',message:'User cancelled the questions.'};
    }
    const choices:{label:string;value:unknown}[]=[{label:'Deny',value:'deny'},{label:'Allow once',value:'allow'}];
    const sessionSuggestions=Array.isArray(meta.suggestions)&&meta.suggestions.every((s:any)=>s.type==='addRules'&&s.behavior==='allow')?meta.suggestions:[];
    const record=(permission:PermissionRecord)=>this.upsert(permissionEntry(meta.requestId,name,input,{agentId:meta.agentID,blockedPath:meta.blockedPath,...permission}));
    record({decision:'pending'});
    if(!meta.suppressAlwaysAllowRule&&sessionSuggestions.length)choices.push({label:'Allow shown rules for this session',value:'session'});
    const answer=await this.ask({id:meta.requestId,title:meta.title??'Permission required: '+name,
      description:[meta.description,meta.decisionReason,meta.agentID?'Agent: '+meta.agentID:'',meta.blockedPath?'Path: '+meta.blockedPath:'',JSON.stringify(input,null,2),!meta.suppressAlwaysAllowRule&&sessionSuggestions.length?'Optional session rules:\n'+JSON.stringify(sessionSuggestions.map((s:any)=>({...s,destination:'session'})),null,2):''].filter(Boolean).join('\n'),fields:[],choices,defaultIndex:0},meta.signal,'deny');
    record({...permissionOutcome(answer,Boolean(meta.signal?.aborted)),...(answer==='session'?{rules:suggestionRules(sessionSuggestions)}:{})});
    if(answer==='allow'||answer==='session')return {behavior:'allow',updatedInput:input,toolUseID:meta.toolUseID,...(answer==='session'?{updatedPermissions:sessionSuggestions.map((s:any)=>({...s,destination:'session'}))}:{})};
    return {behavior:'deny',message:'Denied by the user in Claudapter.',toolUseID:meta.toolUseID};
  }
  private async elicitation(request:any,meta:any):Promise<any>{
    const requestId=meta.requestId??randomUUID();
    if(request.mode==='url'){
      const answer=await this.ask({id:requestId,title:'MCP authentication',description:(request.message??'')+'\n'+(request.url??''),fields:[],choices:[{label:'Cancel',value:'cancel'},{label:'I completed the browser step',value:'accept'}],defaultIndex:0},meta.signal,'cancel');
      return {action:answer};
    }
    const schema=request.requestedSchema??{};
    const result=await this.ask({id:requestId,title:'MCP requests information',description:request.message??'',fields:Object.entries(schema.properties??{}).map(([key,value]:[string,any])=>({key,label:value.title??key,type:['number','boolean'].includes(value.type)?value.type:['array','object'].includes(value.type)?'json':'text',required:schema.required?.includes(key),options:value.enum?.map(String)})),choices:[{label:'Decline',value:null},{label:'Submit',value:'submit'}],defaultIndex:0},meta.signal,null);
    return result?{action:'accept',content:result.fields}:{action:'decline'};
  }
  private async stopEngine(){
    this.closing=true;this.generation++;if(this.timer)clearInterval(this.timer);
    for(const decision of [...this.decisions.values()])decision.resolve(decision.cancel);
    this.input.close();this.trustQuery?.close();this.trustQuery=undefined;this.query?.close();this.query=undefined;const session=this.session;this.session=undefined;
    this.state.ready=false;this.state.busy=false;this.state.status='Closed';this.state.context=null;delete this.state.lastRoute;this.changed();await session?.close();
  }
  async close(){this.homeTrustAccepted=false;await this.stopEngine();await cleanupSavedImages();this.removeAllListeners();}
}

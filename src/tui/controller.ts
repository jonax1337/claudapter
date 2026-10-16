import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join,resolve,extname } from 'node:path';
import { query,listSessions,getSessionMessages,renameSession,forkSession,deleteSession, type Query,type Options,type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { prepareSession,installedClaudePath,type PreparedSession } from '../launcher.js';
import { nativeContextSettings,type Model } from '../models.js';
import { validateConfig,saveConfig,configHome,type Config } from '../config.js';
import { nativeDialogKinds,describeNativeDialog } from './native-dialogs.js';
import { safeText } from './editor.js';
import { tuiOptions } from './options.js';
import { trustDirectory,isWorkspaceTrusted,isHomeDirectory } from './trust.js';
import { assertCompatVersion,launchWorkspaceTrust,invokeCompat } from './compat.js';
import { TOKEN_HEADER } from '../gateway.js';
import type { TranscriptEntry } from './panels.js';
import type { UsageSnapshot } from '../usage.js';

export interface FormField {key:string;label:string;type?:'text'|'number'|'boolean'|'json';required?:boolean;options?:string[];multi?:boolean;secret?:boolean}
export interface PendingDialog {
  id:string;title:string;description:string;fields:FormField[];
  choices:{label:string;value:unknown}[];defaultIndex:number;
}
export interface TuiState {
  ready:boolean;busy:boolean;sessionId:string;model:string;permissionMode:string;status:string;
  entries:TranscriptEntry[];models:Model[];commands:any[];agents:any[];tasks:Record<string,any>;
  context:any;usage?:UsageSnapshot;pending:PendingDialog[];lastRoute?:{requested:string;actual:string;provider:string};
}
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private values:SDKUserMessage[]=[];private nextValue?: (value:IteratorResult<SDKUserMessage>)=>void;private ended=false;
  push(value:SDKUserMessage) {if(this.ended)throw new Error('Session is closed.');if(this.nextValue){const next=this.nextValue;this.nextValue=undefined;next({value,done:false});}else this.values.push(value);}
  close(){this.ended=true;this.values=[];this.nextValue?.({value:undefined,done:true});this.nextValue=undefined;}
  [Symbol.asyncIterator](){return {next:async():Promise<IteratorResult<SDKUserMessage>>=>this.values.length?{value:this.values.shift()!,done:false}:this.ended?{value:undefined,done:true}:new Promise(resolve=>{this.nextValue=resolve;})};}
}

export class TuiController extends EventEmitter {
  revision=0;
  readonly state:TuiState={ready:false,busy:false,sessionId:'',model:'default',permissionMode:'default',status:'Starting Claude Code…',entries:[],models:[],commands:[],agents:[],tasks:{},context:null,pending:[]};
  session?:PreparedSession;query?:Query;claudePath='claude';
  private input=new InputQueue();private closing=false;private generation=0;private streamIds=new Map<string,string>();
  private decisions=new Map<string,{promise:Promise<any>;resolve:(value:any)=>void;cancel:unknown}>();
  private timer?:ReturnType<typeof setInterval>;private initialPromptConsumed=false;private trustQuery?:Query;private homeTrustAccepted=false;
  readonly cwd=process.cwd();
  constructor(readonly args:string[],readonly config:Config){super();}
  subscribe=(listener:()=>void)=>{this.on('change',listener);return()=>{this.off('change',listener);};};
  changed(){this.revision++;this.emit('change');}
  notice(text:string,error=false){this.upsert({id:randomUUID(),kind:error?'error':'notice',text:safeText(text)});}
  private upsert(entry:TranscriptEntry){entry={...entry,text:safeText(entry.text),...(entry.details!==undefined?{details:safeText(entry.details)}:{})};const i=this.state.entries.findIndex(e=>e.id===entry.id);if(i<0)this.state.entries.push(entry);else this.state.entries[i]={...this.state.entries[i],...entry};if(this.state.entries.length>3000)this.state.entries.splice(0,this.state.entries.length-3000);this.changed();}
  private updateUsage(){if(this.session)this.state.usage=this.session.gateway.manifest().usage;this.changed();}

  async start(resume?:string,fresh=false){
    const generation=++this.generation;
    this.closing=false;this.input=new InputQueue();this.state.ready=false;this.state.status='Connecting to installed Claude Code…';this.changed();
    let prepared:PreparedSession|undefined;let activeQuery:Query|undefined;
    try {
    this.claudePath=await installedClaudePath();if(generation!==this.generation)return;
    prepared=await prepareSession(this.args,this.config,{quiet:true,onEvent:e=>{
      if(generation!==this.generation)return;
      if(e.event==='request'||e.event==='fallback'){if(!e.agent&&e.requestClass==='main')this.state.lastRoute={requested:e.requested,actual:e.actual,provider:e.provider};if(e.event==='fallback')this.notice((e.agent?'Agent '+e.agent:'Main')+': '+e.requested+' → '+e.actual+' ('+e.reason+')');}
      this.updateUsage();
    }});
    if(generation!==this.generation){await prepared.close();return;}this.session=prepared;
    const parsed=await tuiOptions(this.session.args,this.cwd);
    const options:Options={...parsed.options,cwd:this.cwd,pathToClaudeCodeExecutable:this.claudePath,
      env:{...this.session.env,...parsed.options.env},settings:this.session.settings,
      systemPrompt:parsed.options.systemPrompt??{type:'preset',preset:'claude_code'},
      settingSources:parsed.options.settingSources??['user','project','local'],
      plugins:[...(parsed.options.plugins??[]),{type:'local',path:this.session.plugin}],
      includePartialMessages:true,forwardSubagentText:true,includeHookEvents:true,enableFileCheckpointing:true,
      perTaskStopAffordance:true,
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
    if(fresh)options.model=this.state.model==='default'?undefined:this.state.model;
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
        const trustQuery=query({prompt:new InputQueue(),options:{cwd:this.cwd,pathToClaudeCodeExecutable:this.claudePath,env:this.session.env,persistSession:false,settingSources:[],plugins:[],mcpServers:{},strictMcpConfig:true,...launchWorkspaceTrust(directory,true)}});this.trustQuery=trustQuery;
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
    const parent=message.parent_tool_use_id??'main';
    if(message.type==='stream_event'){
      const event=message.event;
      if(event.type==='message_start')this.streamIds.set(parent,event.message.id);
      const id=this.streamIds.get(parent)??'stream';const key='block:'+id+':'+event.index;
      if(event.type==='content_block_start'){
        const block=event.content_block;
        this.upsert({id:block.type==='tool_use'?'tool:'+block.id:key,kind:block.type==='thinking'?'thinking':block.type==='tool_use'?'tool':'assistant',text:block.text??block.thinking??'',toolName:block.name,status:block.type==='tool_use'?'running':undefined,agent:parent==='main'?undefined:parent,details:block.type==='tool_use'?JSON.stringify(block.input,null,2):undefined});
      }
      if(event.type==='content_block_delta'){
        const delta=event.delta;const entry=this.state.entries.find(e=>e.id===key);
        if(entry){entry.text+=safeText(delta.text??delta.thinking??'');this.changed();}
      }
      return;
    }
    if(message.type==='assistant'){
      for(const [i,block] of (message.message?.content??[]).entries()){
        if(block.type==='tool_use'){
          const previous=this.state.entries.find(e=>e.id==='tool:'+block.id);
          this.upsert({id:'tool:'+block.id,kind:'tool',text:block.name,toolName:block.name,details:previous?.status==='done'||previous?.status==='error'?previous.details:safeText(JSON.stringify(block.input,null,2)),status:previous?.status??'running',agent:parent==='main'?undefined:parent});
        }
        else if(block.type==='text'||block.type==='thinking')this.upsert({id:'block:'+message.message.id+':'+i,kind:block.type==='thinking'?'thinking':'assistant',text:safeText(block.text??block.thinking??''),agent:parent==='main'?undefined:parent});
      }
    }else if(message.type==='user'){
      const content=message.message?.content;
      const userText=typeof content==='string'?content:Array.isArray(content)?content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'):'';
      if(userText)this.upsert({id:message.uuid??message.message?.id??randomUUID(),kind:'user',text:userText});
      for(const block of Array.isArray(message.message?.content)?message.message.content:[]){
        if(block.type==='tool_result'){
          const existing=this.state.entries.find(e=>e.id==='tool:'+block.tool_use_id);
          const result=typeof block.content==='string'?block.content:JSON.stringify(block.content,null,2);
          if(existing?.status==='done'||existing?.status==='error')continue;
          this.upsert({id:'tool:'+block.tool_use_id,kind:'tool',text:existing?.toolName??'Tool result',toolName:existing?.toolName,status:block.is_error?'error':'done',details:(existing?.details??'')+'\n\n'+safeText(result??'').slice(0,16000),agent:existing?.agent});
        }
      }
    }else if(message.type==='result'){
      this.state.busy=false;this.state.status=message.is_error?'Turn failed':'Ready';
      if(message.is_error)this.notice(message.result??(message.errors??[]).join('\n')??'Turn failed.',true);
      void this.refreshContext().catch(()=>{});this.updateUsage();
    }else if(message.type==='system'){
      if(message.subtype==='init'){this.state.model=message.model??this.state.model;this.state.permissionMode=message.permissionMode??this.state.permissionMode;}
      if(message.subtype==='commands_changed'&&Array.isArray(message.commands))this.state.commands=message.commands;
      if(message.subtype==='hook_started'||message.subtype==='hook_response')this.notice('Hook '+(message.hook_name??message.hook_event??'')+': '+(message.subtype==='hook_started'?'started':message.outcome??'completed'));
      if(message.subtype?.startsWith('task_')||message.subtype==='background_tasks_changed'){
        if(message.task_id)this.state.tasks[message.task_id]={...this.state.tasks[message.task_id],...message};
        if(message.tasks)for(const task of message.tasks)this.state.tasks[task.task_id??task.id]=task;
      }
      if(message.subtype==='local_command_output')this.notice(message.content??message.output??JSON.stringify(message));
      if(['notification','compact_boundary','permission_denied','api_retry','model_refusal_fallback'].includes(message.subtype))this.notice(message.message??message.content??message.description??message.subtype,message.subtype==='permission_denied');
      if(message.subtype==='conversation_reset'){this.state.entries=[];this.state.tasks={};}
    }
    this.changed();
  }

  send(text:string,attachments:any[]=[]){
    if(!this.state.ready||!this.query)throw new Error('Claude Code is still starting.');
    if(!text.trim()&&!attachments.length)return;
    const uuid=randomUUID();this.upsert({id:uuid,kind:'user',text:text+(attachments.length?'\n['+attachments.length+' attachment(s)]':'')});
    this.state.busy=true;this.state.status='Working';
    this.input.push({type:'user',uuid,session_id:this.state.sessionId,parent_tool_use_id:null,message:{role:'user',content:attachments.length?[{type:'text',text},...attachments]:text}});this.changed();
  }
  async attach(path:string){
    const full=resolve(this.cwd,path);const data=await readFile(full);if(data.length>8*1024*1024)throw new Error('Attachments are limited to 8 MiB.');
    const ext=extname(full).toLowerCase();const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
    return mime[ext]?{type:'image',source:{type:'base64',media_type:mime[ext],data:data.toString('base64')}}:{type:'text',text:'Attached file '+full+':\n'+data.toString('utf8')};
  }
  async interrupt(){await this.query?.interrupt();this.state.busy=false;this.state.status='Interrupted';this.notice('Turn interrupted. Tools already completed are not undone.');}
  async setModel(id:string){if(this.state.busy)throw new Error('Wait for the turn or interrupt before switching models.');await this.query!.setModel(id);this.state.model=id;await this.refreshContext();this.notice('Model selected for this session: '+id);}
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
  async sessions(){return listSessions({dir:this.cwd,limit:100});}
  async resume(id:string){await this.stopEngine();this.state.entries=[];this.state.tasks={};await this.start(id);}
  async newSession(){await this.stopEngine();this.state.entries=[];this.state.sessionId='';this.state.tasks={};await this.start(undefined,true);}
  async rename(title:string){if(!this.state.sessionId)throw new Error('Send a message first.');await renameSession(this.state.sessionId,title,{dir:this.cwd});this.notice('Session renamed: '+title);}
  async fork(){if(!this.state.sessionId)throw new Error('Send a message first.');const result=await forkSession(this.state.sessionId,{dir:this.cwd});await this.resume(result.sessionId);}
  async removeSession(id:string){if(id===this.state.sessionId)throw new Error('Close the current session before deleting it.');await deleteSession(id,{dir:this.cwd});}
  async stopTask(id:string){await this.query!.stopTask(id);this.notice('Stop requested for '+id);}
  async exportTranscript(path:string){const result=await invokeCompat(this.query!,'exportConversation');await writeFile(resolve(this.cwd,path),result.text,{flag:'wx',mode:0o600});}
  async branchAt(messageId:string,restoreFiles=false){
    if(this.state.busy)throw new Error('Interrupt or finish the current turn first.');
    if(restoreFiles){const result=await this.query!.rewindFiles(messageId);if(!result.canRewind)throw new Error(result.error??'Files could not be restored.');}
    const result=await forkSession(this.state.sessionId,{dir:this.cwd,upToMessageId:messageId});await this.resume(result.sessionId);
  }
  async updateFallback(rules:unknown){
    const candidate=validateConfig({...this.config,fallback:rules});
    for(const rule of candidate.fallback.filter(r=>r.enabled)){this.session!.registry.resolve(rule.from);for(const id of rule.targets)this.session!.registry.resolve(id);}
    await saveConfig(candidate);this.config.fallback.splice(0,this.config.fallback.length,...candidate.fallback);this.notice('Fallback rules saved and applied to this launcher.');this.changed();
  }
  async restore(id:string){
    const messages=await getSessionMessages(id,{dir:this.cwd,limit:200});
    for(const message of messages as any[])this.receive({type:message.type,message:message.message,uuid:message.uuid,parent_tool_use_id:message.parent_tool_use_id,session_id:id});
    this.notice('Resumed '+id+'. Existing native history retained.');
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
    if(!meta.suppressAlwaysAllowRule&&sessionSuggestions.length)choices.push({label:'Allow shown rules for this session',value:'session'});
    const answer=await this.ask({id:meta.requestId,title:meta.title??'Permission required: '+name,
      description:[meta.description,meta.decisionReason,meta.agentID?'Agent: '+meta.agentID:'',meta.blockedPath?'Path: '+meta.blockedPath:'',JSON.stringify(input,null,2),!meta.suppressAlwaysAllowRule&&sessionSuggestions.length?'Optional session rules:\n'+JSON.stringify(sessionSuggestions.map((s:any)=>({...s,destination:'session'})),null,2):''].filter(Boolean).join('\n'),fields:[],choices,defaultIndex:0},meta.signal,'deny');
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
  async close(){this.homeTrustAccepted=false;await this.stopEngine();this.removeAllListeners();}
}

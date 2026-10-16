import React,{useState,useEffect,useSyncExternalStore} from 'react';
import { Box,Text,render,useInput,useWindowSize,useStdin } from 'ink';
import { Badge,Spinner } from '@inkjs/ui';
import type { Config } from '../config.js';
import { VERSION } from '../version.js';
import { TuiController,type FormField,type PendingDialog } from './controller.js';
import { TranscriptView,UsagePanel,ContextPanel } from './panels.js';
import { safeText,wrapText,editDraft,type Draft } from './editor.js';
import { adminActions,adminSnapshot,runAdminAction,type AdminKind } from './admin.js';
import { defaultPreferences,loadPreferences,savePreferences,keyChord,type Preferences } from './preferences.js';
import { copyText } from './clipboard.js';
import { invokeCompat } from './compat.js';
import { workspaceDiff,addWorkspaceDirectory,outputStyles,setOutputStyle } from './workspace.js';

export const themes={midnight:{accent:'#A78BFA',muted:'#9295AA',border:'#45415C'},ocean:{accent:'#38BDF8',muted:'#8BA7B8',border:'#334C60'},terminal:{accent:'cyan',muted:'gray',border:'gray'},contrast:{accent:'yellow',muted:'white',border:'white'}};
type ThemeName=keyof typeof themes;
interface MenuItem {label:string;detail?:string;run:()=>void|Promise<void>}
type Overlay={type:'menu';title:string;items:MenuItem[];filter:string;selected:number}|{type:'view';title:string;text:string;scroll:number}|{type:'confirm';title:string;description:string;selected:number;scroll:number;action:()=>void|Promise<void>}|{type:'form';title:string;description:string;fields:FormField[];values:Record<string,string>;field:number;cursor:number;submit:(values:Record<string,string>)=>void|Promise<void>}|null;
export const commands=[
  ['/model','Choose a model'],['/usage','All provider usage and quota'],['/context','Effective context and model maximum'],['/agents','Launch or follow up with an agent'],['/tasks','Inspect and stop background tasks'],
  ['/resume','Resume a session'],['/clear','Start a fresh session'],['/compact','Compact this conversation'],['/rewind','Preview and restore file checkpoints'],['/rename','Rename this session'],['/fork','Fork this session'],['/export','Export the transcript'],
  ['/theme','Choose your accent and palette'],['/thinking','Show or hide reasoning summaries'],['/fallback','Inspect and edit explicit fallback rules'],['/config','Session configuration'],['/permissions','Permission rules and mode'],
  ['/mcp','MCP servers and management'],['/plugins','Plugin management'],['/skills','Installed skills and commands'],['/hooks','Hook sources'],['/memory','Native instruction and memory files'],['/status','Session and account status'],['/doctor','Native diagnostics'],['/login','Official authentication'],['/keybindings','Keyboard shortcuts'],
  ['/plan','Inspect plan and planning mode'],['/diff','Review workspace changes'],['/add-dir','Grant access to an additional directory'],['/output-style','Choose response style'],['/sandbox','Native sandbox status'],['/chrome','Browser integration'],['/remote-control','Remote control'],['/history','Recall a previous prompt'],['/effort','Change reasoning effort'],['/attach','Attach an image or text file'],['/attachments','Review and remove queued attachments'],['/copy','Copy the last assistant response'],['/favorite','Toggle a model favorite'],['/help','Command palette'],['/exit','Close this session']
];
const bindings={'Enter':'Send / select','Shift+Enter / Ctrl+J':'New line','Tab':'Command completion / next field','Ctrl+P':'Command palette','Ctrl+O':'Toggle reasoning summaries','PageUp / PageDown':'Scroll transcript or dialog','Esc':'Close / decline dialog','Ctrl+C':'Interrupt; twice while idle to exit','/model':'Models','/usage':'Provider usage','/theme':'Theme picker'};

export function App({controller,preferences,onClose}:{controller:TuiController;preferences:Preferences;onClose:()=>void}){
  useSyncExternalStore(controller.subscribe,()=>controller.revision);
  const state=controller.state;
  const {stdin}=useStdin();
  const {columns,rows}=useWindowSize();const width=Math.max(1,columns||110),height=Math.max(1,rows||32);
  const [theme,setTheme]=useState<ThemeName>(preferences.theme),[thinking,setThinking]=useState(preferences.thinking);
  const [draft,setDraft]=useState<Draft>({text:'',cursor:0}),[scroll,setScroll]=useState(0),[panel,setPanel]=useState<'chat'|'usage'|'context'>('chat');
  const [overlay,setOverlay]=useState<Overlay>(null),[toast,setToast]=useState(''),[exitAt,setExitAt]=useState(0),[attachments,setAttachments]=useState<any[]>([]);
  const [decision,setDecision]=useState({id:'',choice:0,field:-1,values:Object.create(null) as Record<string,string>,cursor:0,scroll:0,option:0});
  const palette=themes[theme];const pending=state.pending[0];
  const dialogDecision=decision.id===pending?.id?decision:{id:pending?.id??'',choice:pending?.defaultIndex??0,field:-1,values:Object.create(null) as Record<string,string>,cursor:0,scroll:0,option:0};
  const run=(operation:()=>void|Promise<void>)=>{void Promise.resolve().then(operation).catch(error=>setToast(safeText((error as Error).message)));};
  const menu=(title:string,items:MenuItem[])=>setOverlay({type:'menu',title,items,filter:'',selected:0});
  const form=(title:string,description:string,fields:FormField[],submit:(values:Record<string,string>)=>void|Promise<void>,values:Record<string,string>={})=>setOverlay({type:'form',title,description,fields,submit,values,field:0,cursor:(values[fields[0]?.key]??'').length});
  const view=(title:string,value:unknown)=>setOverlay({type:'view',title,text:safeText(typeof value==='string'?value:JSON.stringify(value,null,2)),scroll:0});
  const persist=async(next:Partial<Preferences>)=>{await savePreferences({...defaultPreferences(),...preferences,...next});Object.assign(preferences,await loadPreferences());};
  const confirm=(title:string,description:string,action:()=>void|Promise<void>)=>setOverlay({type:'confirm',title,description,selected:0,scroll:0,action});
  const adminContext=()=>({query:controller.query!,cwd:controller.cwd,claudePath:controller.claudePath,keybindings:bindings,initialSettings:controller.session?.settingsObject,onOutput:(text:string)=>controller.notice(text)});

  async function administration(kind:AdminKind){
    if(!controller.query)throw new Error('Session is still starting.');
    const actions=adminActions[kind];
    menu(kind.toUpperCase(),[
      {label:'Inspect current '+kind,run:async()=>view(kind.toUpperCase(),await adminSnapshot(kind,adminContext()))},
      ...actions.map(action=>({label:action.label,detail:action.description,run:()=>{
        const execute=async(values:Record<string,string>)=>{const result=await runAdminAction(action.id,values,adminContext());if(action.id==='permission-mode'){state.permissionMode=values.mode;controller.changed();}view(action.label,result);};
        const submit=(values:Record<string,string>)=>action.confirm?confirm(action.label,action.description+'\n\n'+Object.entries(values).map(([key,value])=>key+': '+(action.fields?.find(f=>f.key===key)?.secret?'[hidden]':value)).join('\n'),()=>execute({...values,confirm:'yes'})):execute(values);
        if(action.fields?.length)form(action.label,action.description,action.fields.map(f=>({...f,required:f.required??true})),submit);
        else return submit({});
      }}))
    ]);
  }

  async function execute(text:string){
    if(!text.trim()&&!attachments.length)return;
    setToast('');const [command,...parts]=text.trim().split(/\s+/);const argument=parts.join(' ');
    if(command==='/help'){menu('COMMAND PALETTE',[...commands.map(([name,description])=>({label:name,detail:description,run:()=>execute(name)})),...state.commands.filter(c=>!commands.some(([n])=>n==='/'+c.name)).map(c=>({label:'/'+c.name,detail:c.description,run:()=>{setOverlay(null);setDraft({text:'/'+c.name+' ',cursor:c.name.length+2});}}))]);return;}
    if(command==='/model'){
      if(argument){await controller.setModel(argument);return;}
      menu('MODEL LIBRARY',[{label:'Refresh account model catalog',detail:'Re-read the local catalog and update maximum context bindings.',run:async()=>{await controller.refreshModels();await execute('/model');}},...state.models.map(model=>({label:(preferences.favorites.includes(model.id)?'★ ':'')+model.label,detail:model.provider+' · '+(model.context?Math.round(model.context/1000)+'K maximum':'native context')+' · '+model.auth,
        run:async()=>{await controller.setModel(model.id);setOverlay(null);setPanel('chat');}}))]);return;
    }
    if(command==='/usage'||command==='/cost'){setOverlay(null);setScroll(0);setPanel('usage');setToast('Refreshing provider quotas…');await controller.refreshUsage();setToast('Provider usage refreshed. Unknown amounts are not zero.');return;}
    if(command==='/context'){setOverlay(null);setScroll(0);setPanel('context');await controller.refreshContext();return;}
    if(command==='/history'){menu('PROMPT HISTORY',[...state.entries].reverse().filter(entry=>entry.kind==='user').map(entry=>({label:entry.text.slice(0,120),detail:'Recall into the composer without sending',run:()=>{setDraft({text:entry.text,cursor:entry.text.length});setOverlay(null);}})));return;}
    if(command==='/diff'){menu('WORKSPACE CHANGES',[false,true].map(staged=>({label:staged?'Staged changes':'Unstaged changes',run:async()=>{const result=await workspaceDiff(controller.cwd,staged);view(staged?'STAGED DIFF':'WORKSPACE DIFF',(result.diff||'No tracked changes.')+'\n\nUntracked files:\n'+result.untracked.join('\n')+(result.truncated?'\n[Output truncated at 2 MiB]':''));}})));return;}
    if(command==='/add-dir'){form('Additional directory','This grants this session access to the selected directory without changing its working directory.',[{key:'path',label:'Directory path',required:true}],v=>confirm('Grant directory access?',v.path,async()=>view('WORKSPACE ACCESS',await addWorkspaceDirectory(controller.query!,controller.cwd,v.path,true))));return;}
    if(command==='/output-style'){const result=await outputStyles(controller.query!);menu('OUTPUT STYLE',result.styles.map(style=>({label:style+(result.current===style?' · active':''),run:async()=>{await setOutputStyle(controller.query!,style);setOverlay(null);controller.notice('Output style: '+style);}})));return;}
    if(command==='/theme'){
      menu('APPEARANCE',Object.keys(themes).map(name=>({label:name[0].toUpperCase()+name.slice(1),detail:name==='terminal'?'Follow your terminal palette':'Claudapter-only preset; native settings stay intact',run:async()=>{setTheme(name as ThemeName);await persist({theme:name as ThemeName});setOverlay(null);}})));return;
    }
    if(command==='/keybindings'){
      menu('KEYBOARD SHORTCUTS',[
        {label:'View current bindings',run:()=>view('KEYBOARD',preferences.keybindings??defaultPreferences().keybindings)},
        {label:'Bind a shortcut',detail:'Approval navigation and Ctrl+C are reserved.',run:()=>form('Bind shortcut','Use a Ctrl/Alt combination or F1–F12. The target is a slash command.',[{key:'chord',label:'Shortcut, for example ctrl+k',required:true},{key:'command',label:'Command, for example /model',required:true}],async v=>{await persist({keybindings:{...(preferences.keybindings??defaultPreferences().keybindings),[v.chord]:v.command}});setOverlay(null);setToast('Shortcut saved.');})},
        {label:'Restore default shortcuts',run:()=>confirm('Restore Claudapter shortcuts?','Native Claude keybindings are untouched.',async()=>{await persist({keybindings:defaultPreferences().keybindings});setOverlay(null);})}
      ]);return;
    }
    if(command==='/favorite'){
      const toggle=async(id:string)=>{await persist({favorites:preferences.favorites.includes(id)?preferences.favorites.filter(value=>value!==id):[...preferences.favorites,id]});setOverlay(null);setToast('Model favorite updated.');};
      if(argument){if(!state.models.some(model=>model.id===argument))throw new Error('Choose a configured model.');await toggle(argument);}else menu('MODEL FAVORITES',state.models.map(model=>({label:(preferences.favorites.includes(model.id)?'★ ':'')+model.label,run:()=>toggle(model.id)})));return;
    }
    if(command==='/copy'){const last=[...state.entries].reverse().find(entry=>entry.kind==='assistant'&&!entry.agent);if(!last)throw new Error('No assistant response to copy.');await copyText(last.text);setToast('Assistant response copied.');setOverlay(null);return;}
    if(command==='/thinking'){setThinking(!thinking);await persist({thinking:!thinking});setOverlay(null);return;}
    if(command==='/agents'){
      const live=controller.session?[...controller.session.gateway.state.agents].filter(([scope])=>scope.startsWith(state.sessionId+'/')):[];
      menu('AGENTS — EXPLICIT DELEGATION',[
        ...state.agents.map(a=>({label:'Start '+(a.name??a.agentType),detail:a.description,run:()=>form('Delegate to '+(a.name??a.agentType),'This explicitly asks Claude to launch the selected native agent.',[{key:'task',label:'Task',required:true}],values=>{setOverlay(null);controller.send('Explicitly use '+(a.name??a.agentType)+' for this task: '+values.task);})})),
        ...live.map(([scope,name])=>({label:'Follow up: '+name,detail:scope.split('/').at(-1),run:()=>form('Resume '+name,'Send a follow-up to the same native agent.',[{key:'task',label:'Follow-up',required:true}],values=>{setOverlay(null);controller.send('Explicitly use SendMessage to resume agent '+scope.split('/').at(-1)+' with: '+values.task+'. Do not create a new agent.');})}))
      ]);return;
    }
    if(command==='/tasks'){
      menu('BACKGROUND TASKS',Object.entries(state.tasks).map(([id,task])=>({label:task.description??task.name??id,detail:task.status??task.subtype,run:()=>menu(task.description??id,[{label:'Inspect',run:()=>view('TASK',task)},{label:'Read task output',run:async()=>view('TASK OUTPUT',await invokeCompat(controller.query!,'getTaskOutput',{taskId:id}))},{label:'Stop task',run:()=>confirm('Stop this task?',id,()=>controller.stopTask(id))}])})));return;
    }
    if(command==='/resume'){
      if(argument){await controller.resume(argument);setAttachments([]);setOverlay(null);setPanel('chat');setScroll(0);return;}
      const sessions=await controller.sessions();menu('SESSIONS',sessions.map(session=>({label:session.summary??session.sessionId,detail:session.sessionId,
        run:()=>menu(session.summary??'Session',[{label:'Resume',run:async()=>{setOverlay(null);await controller.resume(session.sessionId);setAttachments([]);setPanel('chat');setScroll(0);}},{label:'Delete saved session',run:()=>confirm('Delete this saved session?',session.sessionId,async()=>{await controller.removeSession(session.sessionId);setOverlay(null);})}])})));return;
    }
    if(command==='/clear'){confirm('Start a new session?','The current conversation stays saved. Queued attachments are removed.',async()=>{await controller.newSession();setAttachments([]);setPanel('chat');});return;}
    if(command==='/rename'){form('Rename session','Saved in Claude Code session metadata.',[{key:'name',label:'Session name',required:true}],async v=>{await controller.rename(v.name);setOverlay(null);});return;}
    if(command==='/fork'){confirm('Fork conversation?','Create a separate native session with this conversation history.',async()=>{await controller.fork();setOverlay(null);});return;}
    if(command==='/export'){form('Export conversation','Creates a new Markdown file; existing files are never overwritten.',[{key:'path',label:'File path',required:true}],async v=>{await controller.exportTranscript(v.path);setOverlay(null);setToast('Transcript exported.');});return;}
    if(command==='/rewind'){
      menu('FILE CHECKPOINTS',state.entries.filter(e=>e.kind==='user').map(entry=>({label:entry.text.slice(0,90),detail:entry.id,run:async()=>{
        const preview=await controller.query!.rewindFiles(entry.id,{dryRun:true});menu('REWIND PREVIEW',[{label:'Inspect file changes',run:()=>view('Rewind preview',preview)},{label:'Restore files only',run:()=>confirm('Restore files?',JSON.stringify(preview),async()=>{const result=await controller.query!.rewindFiles(entry.id);if(!result.canRewind)throw new Error(result.error??'Cannot rewind files.');setOverlay(null);controller.notice('Files rewound to checkpoint. Conversation history is retained.');})},{label:'Branch conversation at this message',run:()=>confirm('Branch conversation?',entry.text+'\nThe original session is preserved. External side effects are not undone.',async()=>{await controller.branchAt(entry.id);setOverlay(null);})},{label:'Restore files and branch conversation',run:()=>confirm('Restore files and branch?',JSON.stringify(preview)+'\nExternal side effects are not undone.',async()=>{await controller.branchAt(entry.id,true);setOverlay(null);})}]);
      }})));return;
    }
    if(command==='/fallback'){
      menu('AUTOMATIC FALLBACK',[
        {label:'Inspect rules and routes',run:()=>view('FALLBACK',{rules:controller.config.fallback,routes:[...controller.session!.gateway.state.routes]})},
        {label:'Edit explicit rules',detail:'Saved to Claudapter only; applying may authorize another provider to receive conversation data.',run:()=>form('Fallback rules','Edit the ordered policy array. Enabling a target explicitly authorizes data routing to it.',[{key:'rules',label:'Rules (JSON array)',type:'json',required:true}],v=>confirm('Save and activate these rules?',v.rules,async()=>{await controller.updateFallback(JSON.parse(v.rules));setOverlay(null);}),{rules:JSON.stringify(controller.config.fallback,null,2)})},
        {label:'Reset main cooldown',detail:'Also clears the interrupted-turn guard. Inspect tool side effects first.',run:()=>confirm('Reset main routing state?','This affects only the current main conversation.',()=>{controller.session!.gateway.state.reset(state.sessionId);setOverlay(null);controller.notice('Main fallback state reset.');})}
      ]);return;
    }
    if(command==='/plan'){menu('PLAN',[
      {label:'Read current plan',run:async()=>view('CURRENT PLAN',await invokeCompat(controller.query!,'getPlan'))},
      ...['plan','default'].map(mode=>({label:mode==='plan'?'Enter plan mode':'Return to normal permission prompts',run:async()=>{await controller.query!.setPermissionMode(mode as 'plan'|'default');state.permissionMode=mode;controller.changed();setOverlay(null);}}))
    ]);return;}
    if(command==='/chrome'){
      menu('BROWSER INTEGRATION',[
        {label:'Connection and setup',run:async()=>view('BROWSER INTEGRATION',await invokeCompat(controller.query!,'getChromeDialog'))},
        {label:'Choose connected browser',run:async()=>{const result=await invokeCompat(controller.query!,'getChromeBrowsers');menu('CONNECTED BROWSERS',result.browsers.map((browser:any)=>({label:browser.name+(browser.current?' · active':''),run:()=>confirm('Use this browser?',browser.name+'\nBrowser tools remain subject to native permissions.',async()=>{await invokeCompat(controller.query!,'selectChromeBrowser',{deviceId:browser.device_id,confirmed:true});setOverlay(null);})})));}}
      ]);return;
    }
    if(command==='/remote-control'){
      menu('REMOTE CONTROL',[
        {label:'Connection status',run:async()=>view('STATUS',await invokeCompat(controller.query!,'getStatus'))},
        {label:'Enable remote connection',detail:'Expose this session through your authenticated Claude account.',run:()=>confirm('Enable Remote Control?','Your Claude account can remotely control this session. Native account and policy requirements still apply.',async()=>view('REMOTE CONNECTION',await invokeCompat(controller.query!,'enableRemoteControl',{enabled:true,confirmed:true})))},
        {label:'Disable remote connection',run:()=>confirm('Disable Remote Control?','Disconnect remote access to this session.',async()=>{await invokeCompat(controller.query!,'enableRemoteControl',{enabled:false,confirmed:true});setOverlay(null);setToast('Remote Control disabled.');})}
      ]);return;
    }
    if(command==='/effort'){
      menu('REASONING EFFORT',['low','medium','high','xhigh','max'].map(effort=>({label:effort,run:async()=>{await controller.query!.applyFlagSettings({effortLevel:effort as any});setOverlay(null);controller.notice('Session effort: '+effort);}})));return;
    }
    if(command==='/attach'){
      const add=async(path:string)=>{const content=await controller.attach(path);setAttachments(a=>[...a,content]);setOverlay(null);setToast('Attachment queued. It will be sent with your next message.');};
      if(argument)await add(argument);else form('Attach a file','Choose an image or text file (up to 8 MiB). Sending the next prompt shares it with the selected provider.',[{key:'path',label:'File path',required:true}],v=>add(v.path));return;
    }
    if(command==='/attachments'){menu('QUEUED ATTACHMENTS',attachments.map((attachment,index)=>({label:(index+1)+'. '+(attachment.type==='image'?'Image':'Text file'),detail:'Remove from the next message',run:()=>{setAttachments(items=>items.filter((_,i)=>i!==index));setOverlay(null);}})));return;}
    const kind=command==='/login'?'auth':command==='/terminal-setup'?'keybindings':command.slice(1);
    if(Object.hasOwn(adminActions,kind)){await administration(kind as AdminKind);return;}
    if(command==='/exit'){onClose();return;}
    if(command.startsWith('/')&&command!=='/compact'&&!state.commands.some(c=>'/'+c.name===command))throw new Error('Unknown or unavailable command: '+command+'. Open /help; it was not sent to a model.');
    setOverlay(null);setPanel('chat');setScroll(0);controller.send(text,attachments);setAttachments([]);
  }

  useEffect(()=>{const resume=()=>run(()=>execute('/resume'));controller.on('resume-picker',resume);return()=>{controller.off('resume-picker',resume);};},[controller]);
  useEffect(()=>{const listener=(data:Buffer|string)=>{if(pending||overlay)return;const chord=keyChord(String(data),{});if(chord&&/^f\d+$/.test(chord)){const command=(preferences.keybindings??defaultPreferences().keybindings)[chord];if(command)run(()=>execute(command));}};stdin.on('data',listener);return()=>{stdin.off('data',listener);};},[stdin,pending,overlay,preferences,controller]);

  useInput((input,key)=>{
    if(key.eventType==='release')return;
    if(pending){
      const next={...dialogDecision,values:Object.assign(Object.create(null),dialogDecision.values) as Record<string,string>};
      if(key.escape||(key.ctrl&&input==='c')){controller.cancelDialog(pending.id);if(key.ctrl)run(()=>controller.interrupt());return;}
      if(key.pageUp||key.pageDown){next.scroll=Math.max(0,next.scroll+(key.pageDown?8:-8));setDecision(next);return;}
      if(key.tab){next.field=next.field+1>=pending.fields.length?-1:next.field+1;next.option=0;next.cursor=next.field>=0?(next.values[pending.fields[next.field].key]??'').length:0;setDecision(next);return;}
      if(next.field>=0){
        const field=pending.fields[next.field];
        if(field.options?.length&&(key.upArrow||key.downArrow)){next.option=(next.option+(key.downArrow?1:field.options.length-1))%field.options.length;setDecision(next);return;}
        if(field.options?.length&&(input===' '||key.return)&&!key.shift){
          const selected=field.options[next.option];
          if(field.multi){const values=(next.values[field.key]??'').split(', ').filter(Boolean);next.values[field.key]=values.includes(selected)?values.filter(value=>value!==selected).join(', '):[...values,selected].join(', ');}
          else if(!next.values[field.key]?.trim())next.values[field.key]=selected;
          next.cursor=(next.values[field.key]??'').length;if(!key.return){setDecision(next);return;}
        }
        if(key.return&&!key.shift){next.field=next.field+1>=pending.fields.length?-1:next.field+1;next.cursor=next.field>=0?(next.values[pending.fields[next.field].key]??'').length:0;setDecision(next);return;}
        const edited=editDraft({text:next.values[field.key]??'',cursor:next.cursor},key.return&&key.shift?'\n':input,key.return&&key.shift?{}:key);next.values[field.key]=edited.text;next.cursor=edited.cursor;setDecision(next);return;
      }
      if(key.upArrow||key.leftArrow)next.choice=(next.choice+pending.choices.length-1)%pending.choices.length;
      else if(key.downArrow||key.rightArrow)next.choice=(next.choice+1)%pending.choices.length;
      else if(key.return)run(()=>controller.answer(pending.id,pending.choices[next.choice].value,next.values));
      setDecision(next);return;
    }
    if(overlay){
      if(key.ctrl&&input==='c'){setOverlay(null);if(state.busy)run(()=>controller.interrupt());return;}
      if(key.escape){setOverlay(null);return;}
      if(overlay.type==='menu'){
        const items=overlay.items.filter(item=>(item.label+' '+(item.detail??'')).toLowerCase().includes(overlay.filter.toLowerCase()));
        if(key.upArrow)setOverlay({...overlay,selected:Math.max(0,overlay.selected-1)});
        else if(key.downArrow)setOverlay({...overlay,selected:Math.min(items.length-1,overlay.selected+1)});
        else if(key.return&&items[overlay.selected])run(items[overlay.selected].run);
        else if(key.backspace||key.delete)setOverlay({...overlay,filter:overlay.filter.slice(0,-1),selected:0});
        else if(input&&!key.ctrl&&!key.meta)setOverlay({...overlay,filter:overlay.filter+safeText(input),selected:0});
      }else if(overlay.type==='view'){
        if(key.upArrow||key.pageUp)setOverlay({...overlay,scroll:Math.max(0,overlay.scroll-(key.pageUp?10:1))});
        if(key.downArrow||key.pageDown)setOverlay({...overlay,scroll:overlay.scroll+(key.pageDown?10:1)});
      }else if(overlay.type==='confirm'){
        if(key.pageUp||key.pageDown)setOverlay({...overlay,scroll:Math.max(0,overlay.scroll+(key.pageDown?8:-8))});
        else if(key.leftArrow||key.rightArrow||key.upArrow||key.downArrow)setOverlay({...overlay,selected:1-overlay.selected});
        else if(key.return){setOverlay(null);if(overlay.selected===1)run(overlay.action);}
      }else{
        const field=overlay.fields[overlay.field];
        if(key.tab){const index=(overlay.field+1)%overlay.fields.length;setOverlay({...overlay,field:index,cursor:(overlay.values[overlay.fields[index].key]??'').length});return;}
        if(key.return&&!key.shift){
          if(overlay.field<overlay.fields.length-1){const index=overlay.field+1;setOverlay({...overlay,field:index,cursor:(overlay.values[overlay.fields[index].key]??'').length});}
          else run(async()=>{for(const f of overlay.fields)if(f.required&&!overlay.values[f.key]?.trim())throw new Error(f.label+' is required.');await overlay.submit(overlay.values);});return;
        }
        const edit=editDraft({text:overlay.values[field.key]??'',cursor:overlay.cursor},key.return&&key.shift?'\n':input,key.return&&key.shift?{}:key);setOverlay({...overlay,values:{...overlay.values,[field.key]:edit.text},cursor:edit.cursor});
      }
      return;
    }
    if(key.ctrl&&input==='c'){
      if(state.busy){run(()=>controller.interrupt());return;}
      if(draft.text){setDraft({text:'',cursor:0});return;}
      if(Date.now()-exitAt<2000){onClose();return;}setExitAt(Date.now());setToast('Press Ctrl+C again to exit.');return;
    }
    const chord=keyChord(input,key);const shortcut=chord?(preferences.keybindings??defaultPreferences().keybindings)[chord]:undefined;
    if(shortcut){run(()=>execute(shortcut));return;}
    if(key.escape){setPanel('chat');setScroll(0);return;}
    if(key.pageUp){setScroll(Math.max(0,scroll+(panel==='chat'?1:-1)*Math.max(5,height-12)));return;}
    if(key.pageDown){setScroll(Math.max(0,scroll+(panel==='chat'?-1:1)*Math.max(5,height-12)));return;}
    if(key.end&&!draft.text){setScroll(0);return;}
    if(key.tab&&draft.text.startsWith('/')){const match=commands.find(([name])=>name.startsWith(draft.text.trim()));if(match)setDraft({text:match[0]+' ',cursor:match[0].length+1});return;}
    if(key.return){if(key.shift)setDraft(editDraft(draft,'\n',{}));else{const text=draft.text;run(async()=>{await execute(text);setDraft(current=>current.text===text?{text:'',cursor:0}:current);});}return;}
    if(key.ctrl&&input==='j'){setDraft(editDraft(draft,'\n',{}));return;}
    setDraft(editDraft(draft,input,key));
  });

  if(width<48||height<18)return <Box width={width} height={height} flexDirection="column"><Text wrap="truncate" color={palette.accent}>Claudapter</Text><Text wrap="truncate">Resize to at least 48 × 18.</Text><Text wrap="truncate">Ctrl+C twice exits safely.</Text></Box>;
  const mainHeight=Math.max(6,height-10);
  const selection=overlay?.type==='menu'?overlay.items.filter(item=>(item.label+' '+(item.detail??'')).toLowerCase().includes(overlay.filter.toLowerCase())):[];
  const selectedStart=overlay?.type==='menu'?Math.max(0,overlay.selected-Math.floor((mainHeight-5)/2)):0;
  const autocomplete=draft.text.startsWith('/')&&!draft.text.includes(' ')?commands.filter(([name])=>name.startsWith(draft.text)).slice(0,3).map(([name])=>name).join('   '):'';
  const composerLines=wrapText(draft.text.slice(0,draft.cursor)+'▏'+draft.text.slice(draft.cursor),width-8);
  const caretLine=composerLines.findIndex(line=>line.includes('▏'));const composer=composerLines.slice(Math.max(0,caretLine-2),Math.max(3,caretLine+1)).join('\n');
  return <Box flexDirection="column" width={width} height={height} paddingX={1}>
    <Box justifyContent="space-between"><Text bold color={palette.accent}>◈ CLAUDAPTER <Text dimColor>/{VERSION}</Text></Text><Text color={palette.muted}>{state.ready?'CLAUDE CODE ENGINE':'CONNECTING'}</Text></Box>
    <Box gap={2}><Text color={palette.accent}>{state.model}</Text><Text dimColor>{state.lastRoute?state.lastRoute.provider+' / '+state.lastRoute.actual:'Awaiting first route'}</Text><Text color={palette.muted}>· {state.permissionMode}</Text></Box>
    <Box borderStyle="single" borderColor={palette.border} flexDirection="column" height={mainHeight} paddingX={1}>
      {pending?<>
        <Text bold color="yellow">{safeText(pending.title)}</Text>
        <Box flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="column"><Text>{wrapText(pending.description,width-8).slice(dialogDecision.scroll,dialogDecision.scroll+Math.max(1,mainHeight-8)).join('\n')}</Text>
        {pending.fields.length>0&&(()=>{const index=Math.max(0,dialogDecision.field),field=pending.fields[index];const value=dialogDecision.values[field.key]??'';return <Box flexDirection="column"><Text color={palette.accent} wrap="truncate">Field {index+1}/{pending.fields.length}: {safeText(field.label)}</Text>{field.options?.length?(mainHeight>15?<Box flexDirection="column">{field.options.slice(Math.max(0,dialogDecision.option-1),Math.max(3,dialogDecision.option+2)).map((option,i)=><Text key={option} color={dialogDecision.field>=0&&i+Math.max(0,dialogDecision.option-1)===dialogDecision.option?palette.accent:palette.muted} wrap="truncate">{value.split(', ').includes(option)?'●':'○'} {safeText(option)}</Text>)}</Box>:<Text dimColor wrap="truncate">{safeText(field.options.join(' / '))}</Text>):null}<Text wrap="truncate">{field.secret?'•'.repeat(value.length):safeText(value.slice(0,dialogDecision.cursor))}{dialogDecision.field>=0?'▏':''}{field.secret?'':safeText(value.slice(dialogDecision.cursor))}</Text></Box>;})()}</Box>
        <Box flexDirection="column" flexShrink={0}>{pending.choices.map((choice,i)=><Text key={i} wrap="truncate" inverse={dialogDecision.field<0&&dialogDecision.choice===i} color={i===0?'yellow':palette.accent}>{dialogDecision.field<0&&dialogDecision.choice===i?'› ':'  '}{safeText(choice.label)}</Text>)}</Box>
        <Box flexShrink={0}><Text dimColor wrap="truncate">Tab: fields · Arrows: choice · Enter: confirm · Esc: decline · PgUp/PgDn: details</Text></Box>
      </>:overlay?.type==='menu'?<>
        <Text bold color={palette.accent}>{safeText(overlay.title)}</Text><Text dimColor>Filter: {overlay.filter||'type to search'}</Text>
        {selection.slice(selectedStart,selectedStart+Math.max(1,Math.floor((mainHeight-5)/2))).map((item,i)=><Box key={selectedStart+i} flexDirection="column"><Text color={selectedStart+i===overlay.selected?palette.accent:undefined} bold={selectedStart+i===overlay.selected}>{selectedStart+i===overlay.selected?'› ':'  '}{safeText(item.label)}</Text><Text dimColor wrap="truncate">  {safeText(item.detail??'')}</Text></Box>)}
        {!selection.length&&<Text dimColor>No entries available.</Text>}<Text dimColor>↑↓ Select · Enter Open · Esc Close</Text>
      </>:overlay?.type==='view'?<><Text bold color={palette.accent}>{safeText(overlay.title)}</Text><Text>{wrapText(overlay.text,width-8).slice(overlay.scroll,overlay.scroll+mainHeight-4).join('\n')}</Text><Text dimColor>↑↓ / PgUp / PgDn Scroll · Esc Close</Text></>:overlay?.type==='confirm'?<><Text bold color="yellow">{safeText(overlay.title)}</Text><Box flexGrow={1} overflow="hidden"><Text>{wrapText(overlay.description,width-8).slice(overlay.scroll,overlay.scroll+mainHeight-5).join('\n')}</Text></Box><Box gap={3} flexShrink={0}><Text inverse={overlay.selected===0}>Cancel</Text><Text inverse={overlay.selected===1} color="yellow">Confirm</Text></Box><Text dimColor>PgUp/PgDn: full preview · Arrows: choice · Enter: confirm</Text></>:overlay?.type==='form'?<>
        <Text bold color={palette.accent}>{safeText(overlay.title)}</Text><Text dimColor>{wrapText(overlay.description,width-8).slice(0,3).join('\n')}</Text>
        {overlay.fields.map((field,i)=><Box key={field.key} flexDirection="column" marginTop={1}><Text color={i===overlay.field?palette.accent:palette.muted}>{field.label}</Text><Text>{wrapText(field.secret?'•'.repeat((overlay.values[field.key]??'').length):(overlay.values[field.key]??'')+(i===overlay.field?'▏':''),width-8).slice(-Math.max(2,Math.floor((mainHeight-7)/overlay.fields.length))).join('\n')}</Text></Box>)}
        <Text dimColor>Tab Next field · Enter Continue / submit · Shift+Enter New line · Esc Cancel</Text>
      </>:panel==='usage'?<UsagePanel snapshot={state.usage} scroll={scroll} width={width-6} height={mainHeight-2} accent={palette.accent}/>:panel==='context'?<ContextPanel context={state.context} scroll={scroll} model={state.models.find(m=>m.id===state.model)??state.model} width={width-6} height={mainHeight-2} accent={palette.accent}/>:state.entries.length?<TranscriptView entries={state.entries} width={width-6} height={mainHeight-2} scroll={scroll} showThinking={thinking} accent={palette.accent}/>:<Box flexDirection="column" paddingX={2} paddingTop={1}><Text bold color={palette.accent}>Your Claude Code. Your choice of models.</Text><Text> </Text><Text>Start a conversation, or open the command palette.</Text><Text dimColor>/model  /usage  /context  /agents  /theme</Text><Text> </Text><Text dimColor>Tools, policies, skills and plugins come from your existing Claude environment.</Text></Box>}
    </Box>
    <Box gap={1}>{state.busy?<Spinner label={state.status}/>:<Text color={state.ready?'green':palette.muted}>● {state.status}</Text>}{attachments.length>0&&<Badge color="cyan">{attachments.length} attached</Badge>}<Text color={toast?'yellow':palette.muted} wrap="truncate">{toast||autocomplete}</Text></Box>
    <Box borderStyle="round" borderColor={pending||overlay?palette.border:palette.accent} paddingX={1} minHeight={3}><Text color={palette.accent}>› </Text><Text>{composer}</Text></Box>
    <Text color={palette.muted}>Ctrl+P Commands · /model · /usage · /theme · PgUp History · Ctrl+C Interrupt</Text>
  </Box>;
}

export async function runTui(args:string[],config:Config):Promise<number>{
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('The Claudapter TUI needs an interactive terminal. Use native --print for scripts.');
  const preferences=await loadPreferences();
  const controller=new TuiController(args,config);let instance:ReturnType<typeof render>;let closing=false;
  const close=()=>{if(closing)return;closing=true;void controller.close().finally(()=>instance.unmount());};
  instance=render(<App controller={controller} preferences={preferences} onClose={close}/>,{alternateScreen:true,exitOnCtrlC:false,maxFps:25,patchConsole:false});
  process.once('SIGTERM',close);
  try{void controller.start().catch(error=>{controller.notice((error as Error).message,true);controller.state.status='Startup failed — Ctrl+C twice to exit';controller.changed();});await instance.waitUntilExit();return 0;}
  finally{process.off('SIGTERM',close);await controller.close();}
}

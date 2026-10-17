import type { TuiController } from '../../../dist/tui/controller.js';
import { adminActions, adminSnapshot, runAdminAction, type AdminKind } from '../../../dist/tui/admin.js';
import { invokeCompat } from '../../../dist/tui/compat.js';
import { loadPreferences, savePreferences } from '../../../dist/tui/preferences.js';
import { copyText } from '../../../dist/tui/clipboard.js';
import { workspaceDiff, addWorkspaceDirectory, outputStyles, setOutputStyle } from '../../../dist/tui/workspace.js';
import type { Decision } from './decision';
import type { MenuItem } from './menu';

export interface ActionDialogs {
  menu(title:string,items:MenuItem[]):void;
  view(title:string,value:unknown):void;
  form(title:string,description:string,fields:Decision['fields'],submit:(fields:Record<string,string>)=>Promise<void>|void):void;
  confirm(title:string,description:string,action:()=>Promise<void>|void):void;
  close():void;
  recall(text:string):void;
  appearance(name:string):void;
  toggle(kind:'thinking'|'details'):void;
}

export function createActions(controller:TuiController, dialogs:ActionDialogs, exit:()=>Promise<void>) {
  let attachments: Awaited<ReturnType<TuiController['attach']>>[] = [];
  const commands = new Map<string,()=>void|Promise<void>>();
  const register = (name:string,action:()=>void|Promise<void>) => commands.set(name,action);
  register('/theme',()=>dialogs.menu('Appearance',(['midnight','ocean','terminal','contrast'] as const).map(theme=>({title:theme,run:async()=>{const prefs=await loadPreferences();await savePreferences({...prefs,theme});dialogs.appearance(theme);dialogs.close();}}))));
  register('/thinking',async()=>{const prefs=await loadPreferences();await savePreferences({...prefs,thinking:!prefs.thinking});dialogs.toggle('thinking');});
  register('/details',()=>dialogs.toggle('details'));
  register('/history',()=>dialogs.menu('Prompt history',[...controller.state.entries].reverse().filter(entry=>entry.kind==='user').map(entry=>({title:entry.text.slice(0,100),run:()=>{dialogs.recall(entry.text);dialogs.close();}}))));
  register('/help',()=>dialogs.menu('Commands',[
    ...[...commands].map(([title,run])=>({title,run})),
    ...controller.state.commands.filter(command=>!commands.has('/'+command.name)).map(command=>({title:'/'+command.name,description:command.description,run:()=>{dialogs.recall('/'+command.name+' ');dialogs.close();}})),
  ]));
  register('/model',()=>dialogs.menu('Models',controller.state.models.map(model=>({title:model.label,
    description:model.provider+' · '+model.id,run:async()=>{await controller.setModel(model.id);dialogs.close();}}))));
  register('/usage',async()=>{await controller.refreshUsage();dialogs.view('Provider usage',controller.state.usage);});
  register('/context',async()=>{await controller.refreshContext();dialogs.view('Context',controller.state.context);});
  register('/resume',async()=>dialogs.menu('Sessions',(await controller.sessions()).map(session=>({title:session.summary??session.sessionId,
    description:session.sessionId,run:()=>dialogs.menu(session.summary??'Session',[
      {title:'Resume',run:async()=>{await controller.resume(session.sessionId);attachments=[];dialogs.close();}},
      {title:'Delete saved session',run:()=>dialogs.confirm('Delete saved session?',session.sessionId,async()=>{await controller.removeSession(session.sessionId);dialogs.close();})},
    ])}))));
  register('/clear',()=>dialogs.confirm('New session?','The current conversation remains saved.',async()=>{await controller.newSession();attachments=[];dialogs.close();}));
  register('/fork',()=>dialogs.confirm('Fork conversation?','Create a separate native session.',async()=>{await controller.fork();dialogs.close();}));
  register('/rename',()=>dialogs.form('Rename session','Native session metadata.',[{key:'title',label:'Title',required:true}],async fields=>{await controller.rename(fields.title);dialogs.close();}));
  register('/export',()=>dialogs.form('Export transcript','Create a new file; never overwrite.',[{key:'path',label:'Path',required:true}],async fields=>{await controller.exportTranscript(fields.path);dialogs.close();}));
  register('/tasks',()=>dialogs.menu('Tasks',Object.entries(controller.state.tasks).map(([id,task])=>({title:task.description??id,
    description:task.status,run:()=>dialogs.menu(task.description??id,[{title:'Inspect',run:()=>dialogs.view('Task',task)},
      {title:'Read output',run:async()=>dialogs.view('Task output',await invokeCompat(controller.query!,'getTaskOutput',{taskId:id}))},
      {title:'Stop',run:()=>dialogs.confirm('Stop task?',id,()=>controller.stopTask(id))}])}))));
  register('/favorite',()=>dialogs.menu('Model favorites',controller.state.models.map(model=>({title:model.label,run:async()=>{const prefs=await loadPreferences();await savePreferences({...prefs,favorites:prefs.favorites.includes(model.id)?prefs.favorites.filter(id=>id!==model.id):[...prefs.favorites,model.id]});dialogs.close();}}))));
  register('/rewind',()=>dialogs.menu('Checkpoints',controller.state.entries.filter(entry=>entry.kind==='user').map(entry=>({title:entry.text.slice(0,90),description:entry.id,run:async()=>{
    const preview=await controller.query!.rewindFiles(entry.id,{dryRun:true});
    dialogs.menu('Checkpoint actions',[
      {title:'Inspect changes',run:()=>dialogs.view('Rewind preview',preview)},
      {title:'Restore files',run:()=>dialogs.confirm('Restore files?',JSON.stringify(preview),async()=>{const result=await controller.query!.rewindFiles(entry.id);if(!result.canRewind)throw new Error(result.error??'Cannot rewind files.');dialogs.close();})},
      {title:'Branch conversation',run:()=>dialogs.confirm('Branch conversation?',entry.text,async()=>{await controller.branchAt(entry.id);dialogs.close();})},
      {title:'Restore and branch',run:()=>dialogs.confirm('Restore and branch?',JSON.stringify(preview),async()=>{await controller.branchAt(entry.id,true);dialogs.close();})},
    ]);
  }}))));
  register('/chrome',()=>dialogs.menu('Browser integration',[
    {title:'Connection and setup',run:async()=>dialogs.view('Browser',await invokeCompat(controller.query!,'getChromeDialog'))},
    {title:'Choose browser',run:async()=>{const result=await invokeCompat(controller.query!,'getChromeBrowsers');dialogs.menu('Browsers',result.browsers.map((browser:any)=>({title:browser.name,run:()=>dialogs.confirm('Use this browser?',browser.name,async()=>{await invokeCompat(controller.query!,'selectChromeBrowser',{deviceId:browser.device_id,confirmed:true});dialogs.close();})})));}},
  ]));
  register('/remote-control',()=>dialogs.menu('Remote Control',[
    {title:'Status',run:async()=>dialogs.view('Status',await invokeCompat(controller.query!,'getStatus'))},
    ...[false,true].map(enabled=>({title:enabled?'Enable remote connection':'Disable remote connection',run:()=>dialogs.confirm('Change Remote Control?',enabled?'Your authenticated account can remotely control this session.':'Disconnect remote access.',async()=>dialogs.view('Remote Control',await invokeCompat(controller.query!,'enableRemoteControl',{enabled,confirmed:true})))})),
  ]));
  register('/attach',()=>dialogs.form('Attach file','Shared with the selected provider on the next prompt.',[{key:'path',label:'Path',required:true}],async fields=>{attachments.push(await controller.attach(fields.path));dialogs.close();}));
  register('/attachments',()=>dialogs.menu('Queued attachments',attachments.map((attachment,index)=>({title:(index+1)+'. '+attachment.type,description:'Remove from next message',run:()=>{attachments.splice(index,1);dialogs.close();}}))));
  register('/copy',async()=>{const entry=[...controller.state.entries].reverse().find(entry=>entry.kind==='assistant'&&!entry.agent);if(!entry)throw new Error('No assistant response to copy.');await copyText(entry.text);dialogs.close();});
  register('/diff',()=>dialogs.menu('Workspace changes',[false,true].map(staged=>({title:staged?'Staged':'Unstaged',run:async()=>dialogs.view('Diff',await workspaceDiff(controller.cwd,staged))}))));
  register('/add-dir',()=>dialogs.form('Additional directory','Grant access to an additional directory.',[{key:'path',label:'Path',required:true}],fields=>dialogs.confirm('Grant access?',fields.path,async()=>dialogs.view('Directory access',await addWorkspaceDirectory(controller.query!,controller.cwd,fields.path,true)))));
  register('/output-style',async()=>{const result=await outputStyles(controller.query!);dialogs.menu('Output style',result.styles.map(style=>({title:style,run:async()=>{await setOutputStyle(controller.query!,style);dialogs.close();}})));});
  register('/effort',()=>dialogs.menu('Reasoning effort',['low','medium','high','xhigh','max'].map(effort=>({title:effort,run:async()=>{await controller.query!.applyFlagSettings({effortLevel:effort as any});dialogs.close();}}))));
  register('/plan',()=>dialogs.menu('Plan',[
    {title:'Read current plan',run:async()=>dialogs.view('Current plan',await invokeCompat(controller.query!,'getPlan'))},
    ...(['plan','default'] as const).map(mode=>({title:mode,run:async()=>{await controller.query!.setPermissionMode(mode);controller.state.permissionMode=mode;controller.changed();dialogs.close();}})),
  ]));
  register('/agents',()=>{
    const live=controller.session?[...controller.session.gateway.state.agents].filter(([scope])=>scope.startsWith(controller.state.sessionId+'/')):[];
    dialogs.menu('Explicit agent delegation',[
      ...controller.state.agents.map(agent=>({title:agent.name??agent.agentType,description:agent.description,
        run:()=>dialogs.form('Delegate task','Explicitly launch the selected native agent.',[{key:'task',label:'Task',required:true}],fields=>{controller.send('Explicitly use '+(agent.name??agent.agentType)+' for this task: '+fields.task);dialogs.close();})})),
      ...live.map(([scope,name])=>({title:'Follow up: '+name,description:scope.split('/').at(-1),run:()=>dialogs.form('Follow up','Resume the existing native agent.',[{key:'task',label:'Follow-up',required:true}],fields=>{controller.send('Explicitly use SendMessage to resume agent '+scope.split('/').at(-1)+' with: '+fields.task+'. Do not create a new agent.');dialogs.close();})})),
    ]);
  });
  register('/fallback',()=>dialogs.menu('Fallback',[
    {title:'Inspect rules',run:()=>dialogs.view('Fallback',controller.config.fallback)},
    {title:'Edit explicit rules',run:()=>dialogs.form('Fallback rules','Enabling targets authorizes them to receive conversation data.',[{key:'rules',label:'Rules JSON array',required:true}],fields=>dialogs.confirm('Save fallback rules?',fields.rules,async()=>{await controller.updateFallback(JSON.parse(fields.rules));dialogs.close();}))},
  ]));
  register('/exit',exit);
  for(const kind of Object.keys(adminActions) as AdminKind[]) register('/'+(kind==='auth'?'login':kind),()=>administration(kind));

  register('/keybindings',()=>dialogs.menu('Keyboard shortcuts',[
    {title:'Inspect',run:async()=>dialogs.view('Shortcuts',(await loadPreferences()).keybindings)},
    {title:'Bind shortcut',run:()=>dialogs.form('Bind shortcut','Reserved approval and interrupt keys remain protected.',[{key:'chord',label:'Chord',required:true},{key:'command',label:'Slash command',required:true}],async fields=>{const prefs=await loadPreferences();await savePreferences({...prefs,keybindings:{...prefs.keybindings,[fields.chord]:fields.command}});dialogs.view('Shortcut saved','Restart the TUI to load changed shortcuts.');})},
  ]));

  function administration(kind:AdminKind) {
    if(!controller.query)throw new Error('Session is not ready.');
    const context={query:controller.query,cwd:controller.cwd,claudePath:controller.claudePath,
      initialSettings:controller.session?.settingsObject,onOutput:(text:string)=>controller.notice(text)};
    dialogs.menu(kind.toUpperCase(),[
      {title:'Inspect '+kind,run:async()=>dialogs.view(kind,await adminSnapshot(kind,context))},
      ...adminActions[kind].map(action=>({title:action.label,description:action.description,run:()=>{
        const execute=async(fields:Record<string,string>)=>{
          const result=await runAdminAction(action.id,fields,context);
          if(action.id==='permission-mode'){controller.state.permissionMode=fields.mode;controller.changed();}
          dialogs.view(action.label,result);
        };
        const submit=(fields:Record<string,string>)=>action.confirm?
          dialogs.confirm(action.label,action.description+'\n'+Object.entries(fields).map(([key,value])=>key+': '+(action.fields?.find(field=>field.key===key)?.secret?'[hidden]':value)).join('\n'),()=>execute({...fields,confirm:'yes'})):execute(fields);
        if(action.fields?.length)dialogs.form(action.label,action.description,action.fields,submit);
        else return submit({});
      }})),
    ]);
  }

  return async (text:string) => {
    const name=text.trim();
    const command=commands.get(name);
    if(command){await command();return;}
    if(name.startsWith('/')) {
      const [command,...parts]=name.split(/\s+/);
      const argument=parts.join(' ');
      if(command==='/model'&&argument){await controller.setModel(argument);return;}
      if(command==='/resume'&&argument){await controller.resume(argument);attachments=[];dialogs.close();return;}
      if(command==='/attach'&&argument){attachments.push(await controller.attach(argument));return;}
      if(command!=='/compact'&&!controller.state.commands.some(item=>'/'+item.name===command))throw new Error('Unknown or not yet migrated command: '+command+'. It was not sent to a model.');
    }
    controller.send(text,attachments);
    attachments=[];
  };
}

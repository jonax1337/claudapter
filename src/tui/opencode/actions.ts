import { createComponent, type JSX } from 'solid-js';
import { forkSession, renameSession } from '@anthropic-ai/claude-agent-sdk';
import type { TuiController } from '../../../dist/tui/controller.js';
import { adminActions, adminSnapshot, runAdminAction, type AdminKind } from '../../../dist/tui/admin.js';
import { invokeCompat } from '../../../dist/tui/compat.js';
import { loadPreferences, savePreferences, type Preferences } from '../../../dist/tui/preferences.js';
import { copyText } from '../../../dist/tui/clipboard.js';
import { workspaceDiff, addWorkspaceDirectory, outputStyles, setOutputStyle } from '../../../dist/tui/workspace.js';
import type { CommandInfo } from './composer';
import type { Decision } from './decision';
import type { MenuItem } from './menu';
import { THEME_NAMES } from './theme';
import { commandGroup, keyHint, sortPaletteItems, SKILLS_GROUP } from './palette';
import { ProgressDialog, SessionPicker, type SessionPickerActions } from './sessions';
import { UsagePanel } from './usage-view';
import { ContextPanel } from './context-view';
import { WorkspaceDiffPanel } from './workspace-diff';
import { SettingsPanel, type SettingsGroup } from './settings';
import { latestOtherSession, relativeTime, resolveSession, sessionGroup, sessionTitle, type SessionInfo } from './sessions-model';

export interface CommandSet {
  execute(text:string):Promise<void>;
  commands():CommandInfo[];
}

export interface ActionDialogs {
  menu(title:string,items:MenuItem[]):void;
  view(title:string,value:unknown):void;
  form(title:string,description:string,fields:Decision['fields'],submit:(fields:Record<string,string>)=>Promise<void>|void):void;
  confirm(title:string,description:string,action:()=>Promise<void>|void):void;
  close():void;
  recall(text:string):void;
  appearance(name:string):void;
  toggle(kind:'thinking'|'details'):void;
  /** Opens the background task panel; without it `/tasks` falls back to a menu. */
  tasks?():void;
  /** Shows a custom dialog; `render` receives the function that dismisses it. */
  panel?(render:(close:()=>void)=>JSX.Element):void;
  /** Renders structured data graphically; without it `/mcp` & co fall back to the JSON view. */
  snapshot?(title:string,value:unknown):void;
}

interface Command {
  description:string;
  /** Whether `/name <argument>` is handled here instead of being forwarded to Claude Code. */
  takesArgument:boolean;
  run(argument:string):void|Promise<void>;
}

type NativeCommand = TuiController['state']['commands'][number] & {argumentHint?:string};
/** The mode cycle is owned by the controller; older controllers lack it. */
type ModeCycling = {cyclePermissionMode?():unknown};

const PERMISSION_MODES = [
  {mode:'default',description:'Ask before edits and commands'},
  {mode:'acceptEdits',description:'Apply file edits without asking'},
  {mode:'plan',description:'Plan first, change nothing'},
];
const EFFORT_LEVELS = ['low','medium','high','xhigh','max'];
const ARGUMENT_COMMANDS = new Set(['/model','/resume','/sessions','/rename','/export','/theme','/mode','/effort','/attach','/add-dir']);

export function createActions(controller:TuiController, dialogs:ActionDialogs, exit:()=>Promise<void>):CommandSet {
  let attachments: Awaited<ReturnType<TuiController['attach']>>[] = [];
  const commands = new Map<string,Command>();
  const register = (name:string,description:string,run:(argument:string)=>void|Promise<void>) =>
    commands.set(name,{description,run,takesArgument:ARGUMENT_COMMANDS.has(name)});
  const liveQuery = () => {
    if(!controller.query)throw new Error('Claude Code is still starting.');
    return controller.query;
  };
  const modelSummary = () => controller.state.models?.find(model => model.id === controller.state.model);
  const show = (title:string,value:unknown) => dialogs.snapshot?dialogs.snapshot(title,value):dialogs.view(title,value);

  async function applyTheme(theme:string) {
    if(!THEME_NAMES.includes(theme))throw new Error('Unknown theme "'+theme+'". Available: '+THEME_NAMES.join(', ')+'.');
    const prefs=await loadPreferences();
    await savePreferences({...prefs,theme:theme as Preferences['theme']});
    dialogs.appearance(theme);
    dialogs.close();
  }
  async function applyPermissionMode(mode:string) {
    if(!PERMISSION_MODES.some(item=>item.mode===mode))throw new Error('Unknown mode "'+mode+'". Available: '+PERMISSION_MODES.map(item=>item.mode).join(', ')+'.');
    await liveQuery().setPermissionMode(mode as Parameters<ReturnType<typeof liveQuery>['setPermissionMode']>[0]);
    controller.state.permissionMode=mode;
    controller.changed();
    dialogs.close();
  }
  async function applyEffort(effort:string) {
    if(!EFFORT_LEVELS.includes(effort))throw new Error('Unknown effort "'+effort+'". Available: '+EFFORT_LEVELS.join(', ')+'.');
    await liveQuery().applyFlagSettings({effortLevel:effort as any});
    dialogs.close();
  }
  async function showOrCyclePermissionMode(argument:string) {
    if(argument)return applyPermissionMode(argument);
    const cycle=(controller as ModeCycling).cyclePermissionMode;
    if(cycle){
      await cycle.call(controller);
      controller.notice('Permission mode: '+controller.state.permissionMode);
      return;
    }
    dialogs.menu('Permission mode',PERMISSION_MODES.map(({mode,description})=>({title:mode,
      description:description+(mode===controller.state.permissionMode?' (current)':''),run:()=>applyPermissionMode(mode)})));
  }
  function grantDirectoryAccess(path:string) {
    dialogs.confirm('Grant access?',path,async()=>show('Directory access',await addWorkspaceDirectory(liveQuery(),controller.cwd,path,true)));
  }
  function openRewindMenu() {
    const checkpoints=controller.state.entries.filter(entry=>entry.kind==='user');
    if(!checkpoints.length)throw new Error('No checkpoints yet: send a message first.');
    dialogs.menu('Checkpoints',checkpoints.map(entry=>({title:entry.text.slice(0,90),description:entry.id,run:async()=>{
      const preview=await liveQuery().rewindFiles(entry.id,{dryRun:true});
      dialogs.menu('Checkpoint actions',[
        {title:'Inspect changes',run:()=>show('Rewind preview',preview)},
        {title:'Restore files',run:()=>dialogs.confirm('Restore files?',JSON.stringify(preview),async()=>{const result=await liveQuery().rewindFiles(entry.id);if(!result.canRewind)throw new Error(result.error??'Cannot rewind files.');dialogs.close();})},
        {title:'Branch conversation',run:()=>dialogs.confirm('Branch conversation?',entry.text,async()=>{await controller.branchAt(entry.id);dialogs.close();})},
        {title:'Restore and branch',run:()=>dialogs.confirm('Restore and branch?',JSON.stringify(preview),async()=>{await controller.branchAt(entry.id,true);dialogs.close();})},
      ]);
    }})));
  }
  function openTasksMenu() {
    if(dialogs.tasks){dialogs.tasks();return;}
    dialogs.menu('Tasks',Object.entries(controller.state.tasks).map(([id,task])=>({title:task.title||id,
      description:task.status,run:()=>dialogs.menu(task.title||id,[{title:'Inspect',run:()=>show('Task',task)},
        {title:'Read output',run:async()=>show('Task output',await invokeCompat(liveQuery(),'getTaskOutput',{taskId:id}))},
        {title:'Stop',run:()=>dialogs.confirm('Stop task?',id,()=>controller.stopTask(id))}])})));
  }

  // Settings hub ---------------------------------------------------------
  function openSettings() {
    if(!dialogs.panel){dialogs.menu('Settings',settingsEntries().map(entry=>({title:entry.label,description:entry.value,run:entry.run})));return;}
    dialogs.panel(close=>createComponent(SettingsPanel,{groups:settingsGroups(),onClose:close}));
  }
  function settingsGroups():SettingsGroup[] {
    return [
      {title:'Defaults',entries:settingsEntries()},
      {title:'Fallback rules',entries:[
        ...controller.config.fallback.map((rule,index)=>({label:rule.from+' → '+rule.targets.join(', '),
          value:(rule.enabled?'enabled':'disabled')+' · '+rule.scopes.join(', '),run:()=>ruleMenu(index)})),
        {label:'New fallback rule',value:controller.config.fallback.length+' existing',run:()=>editFallbackRule()},
      ]},
    ];
  }
  function settingsEntries() {
    const efforts=Object.entries(controller.config.modelEffort??{}).map(([model,effort])=>model+': '+effort).join(' · ');
    return [
      {label:'Default model',value:controller.config.model??'native default',run:pickDefaultModel},
      {label:'Model efforts',value:efforts||'unset',run:pickEffortModel},
    ];
  }
  function pickDefaultModel() {
    dialogs.menu('Default model',[
      {title:'Native default',description:'New sessions use the Claude Code default',run:async()=>{await controller.updateDefaultModel(undefined);dialogs.close();}},
      ...controller.state.models.map(model=>({title:model.label,description:model.provider+' · '+model.id,
        run:async()=>{await controller.updateDefaultModel(model.id);dialogs.close();}})),
    ]);
  }
  function pickEffortModel() {
    dialogs.menu('Set effort for',controller.state.models.map(model=>({title:model.label,description:controller.config.modelEffort?.[model.id]??'unset',
      run:()=>dialogs.menu('Reasoning effort for '+model.label,[
        ...EFFORT_LEVELS.map(effort=>({title:effort,run:async()=>{await controller.updateModelEffort(model.id,effort);dialogs.close();}})),
        {title:'Clear',run:async()=>{await controller.updateModelEffort(model.id,undefined);dialogs.close();}},
      ])})));
  }
  function ruleMenu(index:number) {
    const rule=controller.config.fallback[index];
    dialogs.menu(rule.from+' → '+rule.targets.join(', '),[
      {title:'Edit',run:()=>editFallbackRule(index)},
      {title:rule.enabled?'Disable':'Enable',description:'Disabled rules never route',run:async()=>{await saveRule({...rule,enabled:!rule.enabled},index);dialogs.close();}},
      {title:'Delete',run:()=>dialogs.confirm('Delete this rule?',rule.from+' → '+rule.targets.join(', '),async()=>{await controller.updateFallback(controller.config.fallback.filter((_,position)=>position!==index));dialogs.close();})},
    ]);
  }
  async function saveRule(rule:unknown,index:number|undefined) {
    const rules=[...controller.config.fallback];
    if(index===undefined)rules.push(rule as never);else rules[index]=rule as never;
    await controller.updateFallback(rules);
  }
  function editFallbackRule(index?:number) {
    const existing=index===undefined?undefined:controller.config.fallback[index];
    const scopes=['main',...Object.keys(controller.config.agents)];
    const modelIds=controller.state.models.map(model=>model.id);
    dialogs.form(existing?'Edit fallback rule':'New fallback rule',
      'An enabled rule authorizes its targets to receive that scope\u2019s conversation, system prompt and tool results.',
      [
        {key:'from',label:'When model',required:true,options:modelIds,initial:existing?.from},
        {key:'targets',label:'Try targets (choose up to 3)',required:true,options:modelIds,multi:true,initial:existing?.targets.join(', ')},
        {key:'scopes',label:'Scopes',required:true,options:scopes,multi:true,initial:existing?.scopes.join(', ')},
        {key:'errors',label:'On errors',required:true,options:['rate_limit','unavailable'],multi:true,initial:(existing?.errors??['rate_limit','unavailable']).join(', ')},
        {key:'retries',label:'Retries per target (0-2)',type:'number',required:true,initial:String(existing?.retries??0)},
        {key:'timeoutMs',label:'Timeout ms (1000-300000)',type:'number',required:true,initial:String(existing?.timeoutMs??60000)},
        {key:'cooldownMs',label:'Cooldown ms (1000-86400000)',type:'number',required:true,initial:String(existing?.cooldownMs??300000)},
      ],values=>{
        const list=(value:string)=>value.split(',').map(part=>part.trim()).filter(Boolean);
        const rule={enabled:existing?.enabled??false,from:values.from,targets:list(values.targets),scopes:list(values.scopes),
          errors:list(values.errors),retries:Number(values.retries),timeoutMs:Number(values.timeoutMs),cooldownMs:Number(values.cooldownMs)};
        dialogs.confirm((rule.enabled?'Save enabled rule':'Save disabled rule')+'?',rule.from+' → '+rule.targets.join(', ')+' · scopes '+rule.scopes.join(', '),async()=>{
          await saveRule(rule,index);dialogs.close();});
      });
  }

  // Sessions -------------------------------------------------------------
  const sessionPickerActions = ():SessionPickerActions => ({
    load:()=>controller.sessions(),
    resume:session=>resumeSession(session.sessionId),
    remove:session=>controller.removeSession(session.sessionId),
    rename:async(session,title)=>{
      if(session.sessionId===controller.state.sessionId)await controller.rename(title);
      else await renameSession(session.sessionId,title,{dir:controller.cwd});
    },
    fork:async session=>{
      const {sessionId}=await forkSession(session.sessionId,{dir:controller.cwd});
      await resumeSession(sessionId);
    },
  });
  async function resumeSession(sessionId:string) {
    await controller.resume(sessionId);
    attachments=[];
  }
  /** Resumes behind a progress dialog so the switch is visible until Claude Code is ready again. */
  async function resumeWithProgress(session:SessionInfo) {
    const task=resumeSession(session.sessionId);
    if(!dialogs.panel){await task;dialogs.close();return;}
    dialogs.panel(close=>createComponent(ProgressDialog,{title:'Resume session',message:'Resuming “'+sessionTitle(session)+'”…',task,onClose:close}));
  }
  async function openSessionPicker() {
    if(dialogs.panel){
      dialogs.panel(close=>createComponent(SessionPicker,{actions:sessionPickerActions(),currentId:controller.state.sessionId,onClose:close}));
      return;
    }
    const sessions=await controller.sessions();
    dialogs.menu('Sessions',sessions.map(session=>({title:sessionTitle(session),group:sessionGroup(session.lastModified),
      description:relativeTime(session.lastModified)+' · '+session.sessionId,run:()=>resumeWithProgress(session)})));
  }
  async function resumeCommand(argument:string) {
    if(!argument)return openSessionPicker();
    await resumeWithProgress(resolveSession(await controller.sessions(),argument));
  }
  async function continueLatest() {
    await resumeWithProgress(latestOtherSession(await controller.sessions(),controller.state.sessionId));
  }

  register('/theme','Change the color theme',argument=>argument?applyTheme(argument):dialogs.menu('Appearance',THEME_NAMES.map(theme=>({title:theme,run:()=>applyTheme(theme)}))));
  register('/thinking','Show or hide model reasoning',async()=>{const prefs=await loadPreferences();await savePreferences({...prefs,thinking:!prefs.thinking});dialogs.toggle('thinking');});
  register('/details','Expand or collapse tool output',()=>dialogs.toggle('details'));
  register('/history','Recall an earlier prompt',()=>dialogs.menu('Prompt history',[...controller.state.entries].reverse().filter(entry=>entry.kind==='user').map(entry=>({title:entry.text.slice(0,100),run:()=>{dialogs.recall(entry.text);dialogs.close();}}))));
  register('/help','Browse all commands',()=>dialogs.menu('Commands',paletteItems()));
  register('/model','Switch the model for this session',argument=>argument?controller.setModel(argument):dialogs.menu('Models',controller.state.models.map(model=>({title:model.label,
    description:model.provider+' · '+model.id,run:async()=>{await controller.setModel(model.id);dialogs.close();}}))));
  register('/usage','Provider quotas and usage',async()=>{
    if(!dialogs.panel){await controller.refreshUsage();dialogs.view('Provider usage',controller.state.usage);return;}
    dialogs.panel(close=>createComponent(UsagePanel,
      {snapshot:controller.state.usage,refresh:()=>controller.refreshUsage(),onClose:close}));
  });
  register('/context','Context window usage',async()=>{
    await controller.refreshContext();
    if(!dialogs.panel){dialogs.view('Context',controller.state.context);return;}
    dialogs.panel(close=>createComponent(ContextPanel,{usage:controller.state.context,model:modelSummary(),onClose:close}));
  });
  register('/resume','Pick a saved session to resume',resumeCommand);
  register('/sessions','Pick a saved session to resume',resumeCommand);
  register('/continue','Resume the most recent other session',continueLatest);
  register('/clear','Start a new session',()=>dialogs.confirm('New session?','The current conversation remains saved.',async()=>{await controller.newSession();attachments=[];dialogs.close();}));
  register('/fork','Fork the conversation',()=>dialogs.confirm('Fork conversation?','Create a separate native session.',async()=>{await controller.fork();dialogs.close();}));
  register('/rename','Rename this session',argument=>argument?controller.rename(argument):dialogs.form('Rename session','Native session metadata.',[{key:'title',label:'Title',required:true}],async fields=>{await controller.rename(fields.title);dialogs.close();}));
  register('/export','Export the transcript to a file',async argument=>{
    const exportTo=async(path:string)=>{await controller.exportTranscript(path);controller.notice('Transcript exported: '+path);dialogs.close();};
    if(argument)await exportTo(argument);
    else dialogs.form('Export transcript','Create a new file; never overwrite.',[{key:'path',label:'Path',required:true}],fields=>exportTo(fields.path));
  });
  register('/tasks','Inspect background tasks',openTasksMenu);
  register('/mode','Show or cycle the permission mode',showOrCyclePermissionMode);
  register('/favorite','Pin or unpin favorite models',()=>dialogs.menu('Model favorites',controller.state.models.map(model=>({title:model.label,run:async()=>{const prefs=await loadPreferences();await savePreferences({...prefs,favorites:prefs.favorites.includes(model.id)?prefs.favorites.filter(id=>id!==model.id):[...prefs.favorites,model.id]});dialogs.close();}}))));
  register('/rewind','Restore files or branch at a checkpoint',openRewindMenu);
  register('/chrome','Browser integration',()=>dialogs.menu('Browser integration',[
    {title:'Connection and setup',run:async()=>show('Browser',await invokeCompat(liveQuery(),'getChromeDialog'))},
    {title:'Choose browser',run:async()=>{const result=await invokeCompat(liveQuery(),'getChromeBrowsers');dialogs.menu('Browsers',result.browsers.map((browser:any)=>({title:browser.name,run:()=>dialogs.confirm('Use this browser?',browser.name,async()=>{await invokeCompat(liveQuery(),'selectChromeBrowser',{deviceId:browser.device_id,confirmed:true});dialogs.close();})})));}},
  ]));
  register('/remote-control','Remote Control status and access',()=>dialogs.menu('Remote Control',[
    {title:'Status',run:async()=>show('Status',await invokeCompat(liveQuery(),'getStatus'))},
    ...[false,true].map(enabled=>({title:enabled?'Enable remote connection':'Disable remote connection',run:()=>dialogs.confirm('Change Remote Control?',enabled?'Your authenticated account can remotely control this session.':'Disconnect remote access.',async()=>show('Remote Control',await invokeCompat(liveQuery(),'enableRemoteControl',{enabled,confirmed:true})))})),
  ]));
  register('/attach','Attach a file to the next prompt',async argument=>{
    if(argument)attachments.push(await controller.attach(argument));
    else dialogs.form('Attach file','Shared with the selected provider on the next prompt.',[{key:'path',label:'Path',required:true}],async fields=>{attachments.push(await controller.attach(fields.path));dialogs.close();});
  });
  register('/attachments','Review queued attachments',()=>dialogs.menu('Queued attachments',attachments.map((attachment,index)=>({title:(index+1)+'. '+attachment.type,description:'Remove from next message',run:()=>{attachments.splice(index,1);dialogs.close();}}))));
  register('/copy','Copy the last response',async()=>{const entry=[...controller.state.entries].reverse().find(entry=>entry.kind==='assistant'&&!entry.agent);if(!entry)throw new Error('No assistant response to copy.');await copyText(entry.text);dialogs.close();});
  register('/diff','Show workspace changes',()=>dialogs.menu('Workspace changes',[false,true].map(staged=>({title:staged?'Staged':'Unstaged',run:async()=>{
    const data=await workspaceDiff(controller.cwd,staged);
    if(!dialogs.panel){dialogs.view('Diff',data);return;}
    dialogs.panel(close=>createComponent(WorkspaceDiffPanel,{data,onClose:close}));
  }}))));
  register('/add-dir','Grant access to another directory',argument=>argument?grantDirectoryAccess(argument):dialogs.form('Additional directory','Grant access to an additional directory.',[{key:'path',label:'Path',required:true}],fields=>grantDirectoryAccess(fields.path)));
  register('/output-style','Choose an output style',async()=>{const result=await outputStyles(liveQuery());dialogs.menu('Output style',result.styles.map(style=>({title:style,run:async()=>{await setOutputStyle(liveQuery(),style);dialogs.close();}})));});
  register('/effort','Set reasoning effort',argument=>argument?applyEffort(argument):dialogs.menu('Reasoning effort',EFFORT_LEVELS.map(effort=>({title:effort,run:()=>applyEffort(effort)}))));
  register('/plan','Plan mode and current plan',()=>dialogs.menu('Plan',[
    {title:'Read current plan',run:async()=>show('Current plan',await invokeCompat(liveQuery(),'getPlan'))},
    ...(['plan','default'] as const).map(mode=>({title:mode,run:()=>applyPermissionMode(mode)})),
  ]));
  register('/agents','Delegate to a native agent',()=>{
    const live=controller.session?[...controller.session.gateway.state.agents].filter(([scope])=>scope.startsWith(controller.state.sessionId+'/')):[];
    dialogs.menu('Explicit agent delegation',[
      ...controller.state.agents.map(agent=>({title:agent.name??agent.agentType,description:agent.description,
        run:()=>dialogs.form('Delegate task','Explicitly launch the selected native agent.',[{key:'task',label:'Task',required:true}],fields=>{controller.send('Explicitly use '+(agent.name??agent.agentType)+' for this task: '+fields.task);dialogs.close();})})),
      ...live.map(([scope,name])=>({title:'Follow up: '+name,description:scope.split('/').at(-1),run:()=>dialogs.form('Follow up','Resume the existing native agent.',[{key:'task',label:'Follow-up',required:true}],fields=>{controller.send('Explicitly use SendMessage to resume agent '+scope.split('/').at(-1)+' with: '+fields.task+'. Do not create a new agent.');dialogs.close();})})),
    ]);
  });
  register('/fallback','Inspect or edit fallback rules',()=>openSettings());
  register('/settings','Default model, per-model effort and fallback rules',()=>openSettings());
  register('/setup','Default model, per-model effort and fallback rules',()=>openSettings());
  register('/exit','Quit Claudapter',exit);
  for(const kind of Object.keys(adminActions) as AdminKind[]) register('/'+(kind==='auth'?'login':kind),'Manage '+kind,()=>administration(kind));

  register('/keybindings','Inspect or bind shortcuts',()=>dialogs.menu('Keyboard shortcuts',[
    {title:'Inspect',run:async()=>show('Shortcuts',(await loadPreferences()).keybindings)},
    {title:'Bind shortcut',run:()=>dialogs.form('Bind shortcut','Reserved approval and interrupt keys remain protected.',[{key:'chord',label:'Chord',required:true},{key:'command',label:'Slash command',required:true}],async fields=>{const prefs=await loadPreferences();await savePreferences({...prefs,keybindings:{...prefs.keybindings,[fields.chord]:fields.command}});dialogs.view('Shortcut saved','Restart the TUI to load changed shortcuts.');})},
  ]));

  function nativeCommands():NativeCommand[] {
    return controller.state.commands.filter(command=>!commands.has('/'+command.name));
  }
  const isNative = (name:string) => controller.state.commands.some(item=>'/'+item.name===name);

  /** Every command in palette order: built-ins by group, then Claude Code's commands and skills. */
  function paletteItems():MenuItem[] {
    const builtin=[...commands].map(([name,{description,run}])=>({title:name,description,group:commandGroup(name),hint:keyHint(name),run:()=>run('')}));
    const native=nativeCommands().map((command:NativeCommand)=>({title:'/'+command.name,group:SKILLS_GROUP,
      description:[command.argumentHint,command.description].filter(Boolean).join('  '),run:()=>runNativeFromPalette(command)}));
    return sortPaletteItems([...builtin,...native]);
  }
  /** Commands that expect an argument go to the composer; the others run right away. */
  async function runNativeFromPalette(command:NativeCommand) {
    const name='/'+command.name;
    if(command.argumentHint){dialogs.recall(name+' ');dialogs.close();return;}
    await execute(name);
    dialogs.close();
  }

  function administration(kind:AdminKind) {
    if(!controller.query)throw new Error('Session is not ready.');
    const context={query:controller.query,cwd:controller.cwd,claudePath:controller.claudePath,
      initialSettings:controller.session?.settingsObject,onOutput:(text:string)=>controller.notice(text)};
    dialogs.menu(kind.toUpperCase(),[
      {title:'Inspect '+kind,run:async()=>show(kind,await adminSnapshot(kind,context))},
      ...adminActions[kind].map(action=>({title:action.label,description:action.description,run:()=>{
        const execute=async(fields:Record<string,string>)=>{
          const result=await runAdminAction(action.id,fields,context);
          if(action.id==='permission-mode'){controller.state.permissionMode=fields.mode;controller.changed();}
          show(action.label,result);
        };
        const submit=(fields:Record<string,string>)=>action.confirm?
          dialogs.confirm(action.label,action.description+'\n'+Object.entries(fields).map(([key,value])=>key+': '+(action.fields?.find(field=>field.key===key)?.secret?'[hidden]':value)).join('\n'),()=>execute({...fields,confirm:'yes'})):execute(fields);
        if(action.fields?.length)dialogs.form(action.label,action.description,action.fields,submit);
        else return submit({});
      }})),
    ]);
  }

  const list = ():CommandInfo[] => [...[...commands].map(([name,{description}])=>({name,description})),
    ...nativeCommands().map(command=>({name:'/'+command.name,description:command.description}))];

  function unknownCommand(name:string):Error {
    const typed=name.slice(1).toLowerCase();
    const similar=list().find(command=>command.name.slice(1).toLowerCase().includes(typed));
    return new Error('Unknown command: '+name+'.'+(similar?' Did you mean '+similar.name+'?':'')+' Press ctrl+p to browse commands. It was not sent to a model.');
  }
  /** Runs a slash command here when it is built in; false means it belongs to Claude Code and is forwarded. */
  async function runSlashCommand(input:string):Promise<boolean> {
    const [name,...parts]=input.split(/\s+/);
    const argument=parts.join(' ');
    const builtin=commands.get(name);
    if(builtin&&(!argument||builtin.takesArgument)){await builtin.run(argument);return true;}
    if(isNative(name)||name==='/compact')return false;
    if(builtin)throw new Error(name+' takes no arguments.');
    throw unknownCommand(name);
  }
  async function execute(text:string) {
    const input=text.trim();
    if(input.startsWith('/')&&await runSlashCommand(input))return;
    controller.send(text,attachments);
    attachments=[];
  }
  return {execute,commands:list};
}

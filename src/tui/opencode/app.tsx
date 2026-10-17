import { Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { Transcript } from './transcript';
import { Menu, type MenuItem } from './menu';
import type { ActionDialogs, CommandSet } from './actions';
import { Home, Logo } from './home';
import { DecisionDialog, type Decision } from './decision';
import { Composer } from './composer';
import { StatusBar, StatusIndicator, type ContextUsage, type HookView, type RouteView, type UsageView } from './status';
import { KeyHints, type KeyHint } from './dialog';
import { ThemeProvider, themeNamed } from './theme';
import { useControllerState } from './bridge';
import { TasksPanel, TasksStrip } from './tasks';
import { SnapshotPanel } from './snapshot-view';
import type { TaskMap } from './tasks-model';
import type { TranscriptEntry } from './transcript';
import { scrollAction } from './scroll';
import { useTranscriptScroll } from './transcript-scroll';

type Overlay = {type:'menu';title:string;items:MenuItem[]} | {type:'panel';render:(close:()=>void)=>JSX.Element} | {type:'decision';decision:Decision;submit:(value:unknown,fields:Record<string,string>)=>void|Promise<void>} | undefined;
type Entry = { id: string; kind: string; text: string; details?: string };
type ModelSummary = { id: string; label: string; provider: string };

export interface ViewController {
  state: { ready: boolean; busy: boolean; model: string; status: string; entries: Entry[]; pending: Decision[];
    permissionMode?: string; context?: ContextUsage | null; models?: ModelSummary[];
    sessionId?: string; tasks?: TaskMap; usage?: UsageView; lastRoute?: RouteView; hookActivity?: HookView[] };
  cwd?: string;
  stopTask?(id: string): void | Promise<void>;
  agentTranscript?(taskId: string): TranscriptEntry[] | Promise<TranscriptEntry[]>;
  cyclePermissionMode?(): void | Promise<unknown>;
  subscribe(listener: () => void): () => void;
  send(text: string): void;
  answer(id: string, value: unknown, fields?: Record<string,string>): void;
  cancelDialog(id: string): void;
  interrupt?(): Promise<void>;
  on?(event:'resume-picker',listener:()=>void):unknown;
  off?(event:'resume-picker',listener:()=>void):unknown;
}

const TOAST_MS = 6000;
const COMPACT_WIDTH = 44;
const SESSION_HINTS: KeyHint[] = [['ctrl+p', 'commands'], ['ctrl+t', 'tasks']];
const TASKS_COMMAND = { name: '/tasks', description: 'Show agents and workflows' };
const HOME_HINTS: KeyHint[] = [['/', 'commands'], ['ctrl+p', 'palette'], ['↑', 'history']];

/** Replaces the home directory prefix with `~` for a compact location label. */
function displayPath(path: string) {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home && path.toLowerCase().startsWith(home.toLowerCase()) ? '~' + path.slice(home.length) : path;
}

export function App(props: { controller: ViewController; actions?:(dialogs:ActionDialogs)=>CommandSet; preferences?:{thinking:boolean;theme:string;keybindings:Record<string,string>} }) {
  const state = useControllerState(props.controller);
  const dimensions = useTerminalDimensions();
  const [overlay,setOverlay] = createSignal<Overlay>();
  const [recalled,setRecalled] = createSignal<{text:string}>();
  const [thinking,setThinking] = createSignal(props.preferences?.thinking??false);
  const [details,setDetails] = createSignal(false);
  const [theme,setTheme] = createSignal(themeNamed(props.preferences?.theme));
  const [toast,setToast] = createSignal('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(toastTimer));
  const showError = (error: Error) => {
    clearTimeout(toastTimer);
    setToast(error.message);
    toastTimer = setTimeout(() => setToast(''), TOAST_MS);
  };
  const close = () => setOverlay(undefined);
  const decision = (title:string,description:string,fields:Decision['fields'],submit:(value:unknown,fields:Record<string,string>)=>void|Promise<void>) =>
    setOverlay({type:'decision',decision:{id:crypto.randomUUID(),title,description,fields,choices:[{label:'Cancel',value:false},{label:'Confirm',value:true}],defaultIndex:0},submit});
  const dialogs:ActionDialogs={close,
    recall:text=>setRecalled({text}),
    appearance:name=>setTheme(themeNamed(name)),
    toggle:kind=>{if(kind==='thinking')setThinking(value=>!value);else setDetails(value=>!value);close();},
    menu:(title,items)=>setOverlay({type:'menu',title,items}),
    panel:render=>setOverlay({type:'panel',render}),
    snapshot:(title,value)=>setOverlay({type:'panel',render:onClose=><SnapshotPanel title={title} snapshot={value} onClose={onClose} />}),
    view:(title,value)=>decision(title,typeof value==='string'?value:JSON.stringify(value,null,2)??'Unavailable',[],close),
    confirm:(title,description,action)=>decision(title,description,[],async value=>{if(value)await action();else close();}),
    form:(title,description,fields,submit)=>decision(title,description,fields,async(value,values)=>{
      if(!value){close();return;}
      for(const field of fields)if(field.required&&!values[field.key]?.trim())throw new Error(field.label+' is required.');
      await submit(values);
    }),
  };
  const commandSet:CommandSet=props.actions?.(dialogs)??{commands:()=>[],execute:async text=>{
    if(text.trimStart().startsWith('/'))throw new Error('Command handler unavailable.');
    props.controller.send(text);
  }};
  const openTasks=()=>setOverlay({type:'panel',render:onClose=><TasksPanel tasks={state().tasks??{}} thinking={thinking()} details={details()}
    stopTask={props.controller.stopTask&&(id=>props.controller.stopTask!(id))}
    agentTranscript={props.controller.agentTranscript&&(id=>props.controller.agentTranscript!(id))} onClose={onClose} />});
  const execute=async(text:string)=>{if(text.trim()===TASKS_COMMAND.name)openTasks();else await commandSet.execute(text);};
  const commands=()=>{const registered=commandSet.commands();return registered.some(command=>command.name===TASKS_COMMAND.name)?registered:[...registered,TASKS_COMMAND];};
  const run=(command:string)=>{void execute(command).catch(showError);};
  const cycleMode=()=>{void Promise.resolve(props.controller.cyclePermissionMode?.()).catch(showError);};
  const resumePicker=()=>run('/resume');
  props.controller.on?.('resume-picker',resumePicker);
  onCleanup(()=>props.controller.off?.('resume-picker',resumePicker));
  const renderer = useRenderer();
  const scroll = useTranscriptScroll({entries:()=>state().entries,sessionId:()=>state().sessionId,showsThinking:thinking});
  const composerEmpty = () => !(renderer.currentFocusedRenderable as {plainText?:string}|null)?.plainText;
  const idle = () => !overlay() && !state().pending.length;
  useKeyboard(event=>{
    if(!idle()) return;
    if(event.ctrl&&event.name==='t') {
      event.preventDefault();openTasks();return;
    }
    if(event.shift&&event.name==='tab'&&props.controller.cyclePermissionMode) {
      event.preventDefault();cycleMode();return;
    }
    const action=scrollAction(event,composerEmpty());
    if(action) {
      event.preventDefault();scroll.perform(action);return;
    }
    if(event.name==='pageup'||event.name==='pagedown') {
      event.preventDefault();scroll.scrollBy((event.name==='pageup'?-1:1)*Math.max(1,dimensions().height-10));
    }
    if(event.name==='escape'&&state().busy&&props.controller.interrupt) {
      event.preventDefault();void props.controller.interrupt().catch(showError);
    }
    const chord=[...(event.ctrl?['ctrl']:[]),...(event.meta?['alt']:[]),...(event.shift?['shift']:[]),event.name].join('+');
    const command=props.preferences?.keybindings[chord]??(chord==='ctrl+p'?'/help':undefined);
    if(command){event.preventDefault();run(command);}
  });
  const activeModel = () => state().models?.find(model => model.id === state().model);
  const history = () => state().entries.filter(entry => entry.kind === 'user').map(entry => entry.text);
  const padding = () => dimensions().width < COMPACT_WIDTH ? 1 : 2;
  const composer = () => <Composer disabled={!state().ready || state().busy || state().pending.length > 0 || !!overlay()}
    model={activeModel()?.label ?? state().model} provider={activeModel()?.provider} mode={state().permissionMode}
    history={history()} commands={commandSet.commands()} recalled={recalled()} onSubmit={commandSet.execute} />;
  const homeFooter = () => (
    <box flexDirection="row" justifyContent="space-between" height={1} gap={2}>
      <text fg={theme().muted} wrapMode="none">{displayPath(props.controller.cwd ?? process.cwd())}</text>
      <StatusIndicator status={state().status} />
    </box>
  );
  return (
    <ThemeProvider value={theme}>
      <box width="100%" height="100%" flexDirection="column" backgroundColor={theme().background}>
        <Show when={state().entries.length > 0} fallback={
          <Home logo={<Logo />} footer={homeFooter()} prompt={<>
            {composer()}
            <box flexDirection="row" justifyContent="flex-end" paddingTop={1}><KeyHints hints={HOME_HINTS} /></box>
          </>} />
        }>
          {/* Session viewport structure adapted from OpenCode routes/session/index.tsx (MIT). */}
          <box flexGrow={1} minHeight={0} position="relative" overflow="hidden">
            <scrollbox ref={scroll.ref} stickyScroll stickyStart="bottom" flexGrow={1} minHeight={0}>
              <Transcript entries={state().entries} busy={state().busy} thinking={thinking()} details={details()} />
            </scrollbox>
          </box>
          <box height={1} flexShrink={0} />
          <TasksStrip tasks={state().tasks} />
          {composer()}
          <box paddingTop={1} flexShrink={0}>
            <StatusBar busy={state().busy} status={state().status} context={state().context ?? undefined} hints={SESSION_HINTS}
              tasks={state().tasks} mode={state().permissionMode} usage={state().usage} route={state().lastRoute}
              hooks={state().hookActivity} onTasks={openTasks} onCycleMode={cycleMode} />
          </box>
        </Show>
        <Show when={toast()}>
          <box position="absolute" top={1} right={2} zIndex={4000} maxWidth={60} backgroundColor={theme().panel}
            border={['left']} borderColor={theme().error} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}
            onMouseUp={() => setToast('')}>
            <text fg={theme().text}>{toast()}</text>
          </box>
        </Show>
        <Show when={!state().pending.length && overlay()} keyed>{current =>
          current.type==='menu' ? <Menu title={current.title} items={current.items} onClose={close} /> :
          current.type==='panel' ? current.render(close) :
          <DecisionDialog decision={current.decision} onAnswer={current.submit} onCancel={close} />
        }</Show>
        <Show when={state().pending[0]?.id} keyed>
          {id => <DecisionDialog decision={state().pending[0]}
            onAnswer={(value, fields) => props.controller.answer(id, value, fields)}
            onCancel={() => props.controller.cancelDialog(id)} />}
        </Show>
      </box>
    </ThemeProvider>
  );
}

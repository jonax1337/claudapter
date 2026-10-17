import { Show, createSignal, onCleanup } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { ScrollBoxRenderable } from '@opentui/core';
import { Transcript } from './transcript';
import { Menu, type MenuItem } from './menu';
import type { ActionDialogs } from './actions';

type Overlay = {type:'menu';title:string;items:MenuItem[]} | {type:'decision';decision:Decision;submit:(value:unknown,fields:Record<string,string>)=>void|Promise<void>} | undefined;
import { useTerminalDimensions } from '@opentui/solid';
import { Home, Logo } from './home';
import { DecisionDialog, type Decision } from './decision';
import { Composer } from './composer';
import { useControllerState } from './bridge';

type Entry = { id: string; kind: string; text: string; details?: string };
export interface ViewController {
  state: { ready: boolean; busy: boolean; model: string; status: string; entries: Entry[]; pending: Decision[] };
  subscribe(listener: () => void): () => void;
  send(text: string): void;
  answer(id: string, value: unknown, fields?: Record<string,string>): void;
  cancelDialog(id: string): void;
  on?(event:'resume-picker',listener:()=>void):unknown;
  off?(event:'resume-picker',listener:()=>void):unknown;
}

export function App(props: { controller: ViewController; actions?:(dialogs:ActionDialogs)=>(text:string)=>Promise<void>; preferences?:{thinking:boolean;theme:string;keybindings:Record<string,string>} }) {
  const state = useControllerState(props.controller);
  const dimensions = useTerminalDimensions();
  const [overlay,setOverlay] = createSignal<Overlay>();
  const [recalled,setRecalled] = createSignal<{text:string}>();
  const [thinking,setThinking] = createSignal(props.preferences?.thinking??false);
  const [details,setDetails] = createSignal(false);
  const themeAccent = (name:string) => ({midnight:'#a78bfa',ocean:'#38bdf8',terminal:'cyan',contrast:'yellow'} as Record<string,string>)[name]??'#a78bfa';
  const [accent,setAccent] = createSignal(themeAccent(props.preferences?.theme??'midnight'));
  const [actionError,setActionError] = createSignal('');
  const close = () => setOverlay(undefined);
  const decision = (title:string,description:string,fields:Decision['fields'],submit:(value:unknown,fields:Record<string,string>)=>void|Promise<void>) =>
    setOverlay({type:'decision',decision:{id:crypto.randomUUID(),title,description,fields,choices:[{label:'Cancel',value:false},{label:'Confirm',value:true}],defaultIndex:0},submit});
  const dialogs:ActionDialogs={close,
    recall:text=>setRecalled({text}),
    appearance:name=>setAccent(themeAccent(name)),
    toggle:kind=>{if(kind==='thinking')setThinking(value=>!value);else setDetails(value=>!value);close();},
    menu:(title,items)=>setOverlay({type:'menu',title,items}),
    view:(title,value)=>decision(title,typeof value==='string'?value:JSON.stringify(value,null,2)??'Unavailable',[],close),
    confirm:(title,description,action)=>decision(title,description,[],async value=>{if(value)await action();else close();}),
    form:(title,description,fields,submit)=>decision(title,description,fields,async(value,values)=>{
      if(!value){close();return;}
      for(const field of fields)if(field.required&&!values[field.key]?.trim())throw new Error(field.label+' is required.');
      await submit(values);
    }),
  };
  const execute=props.actions?.(dialogs)??(async(text:string)=>{
    if(text.trimStart().startsWith('/'))throw new Error('Command handler unavailable.');
    props.controller.send(text);
  });
  const resumePicker=()=>{void execute('/resume').catch(error=>setActionError(error.message));};
  props.controller.on?.('resume-picker',resumePicker);
  onCleanup(()=>props.controller.off?.('resume-picker',resumePicker));
  let transcript:ScrollBoxRenderable|undefined;
  useKeyboard(event=>{
    if(!overlay()&&!state().pending.length&&(event.name==='pageup'||event.name==='pagedown')) {
      event.preventDefault();transcript?.scrollBy((event.name==='pageup'?-1:1)*Math.max(1,dimensions().height-10));
    }
    if(!state().pending.length&&!overlay()) {
      const chord=[...(event.ctrl?['ctrl']:[]),...(event.meta?['alt']:[]),...(event.shift?['shift']:[]),event.name].join('+');
      const command=props.preferences?.keybindings[chord]??(chord==='ctrl+p'?'/help':undefined);
      if(command){event.preventDefault();void execute(command).catch(error=>setActionError(error.message));}
    }
  });
  const composer = () => <Composer disabled={!state().ready || state().busy || state().pending.length > 0 || !!overlay()}
    model={state().model} recalled={recalled()} onSubmit={execute} />;
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#141418">
      <Show when={state().entries.length > 0} fallback={
        <Home logo={<Logo />} prompt={composer()} footer={<text>{state().status}</text>} />
      }>
        {/* Session viewport structure adapted from OpenCode routes/session/index.tsx (MIT). */}
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingBottom={1}
            paddingLeft={dimensions().width < 44 ? 1 : 2} paddingRight={dimensions().width < 44 ? 1 : 2}>
            <box flexGrow={1} minHeight={0} position="relative" overflow="hidden">
              <scrollbox ref={transcript} stickyScroll stickyStart="bottom" flexGrow={1} minHeight={0}>
                <Transcript entries={state().entries} busy={state().busy} accent={accent()} thinking={thinking()} details={details()} />
              </scrollbox>
            </box>
            <box height={1} flexShrink={0}><text fg="#aaaaaa">{state().status}</text></box>
            {composer()}
          </box>
        </box>
      </Show>
      <text fg="#ff7777">{actionError()}</text>
      <Show when={!state().pending.length && overlay()} keyed>{current => current.type==='menu' ?
        <Menu title={current.title} items={current.items} onClose={close} /> :
        <DecisionDialog decision={current.decision} onAnswer={current.submit} onCancel={close} />
      }</Show>
      <Show when={state().pending[0]?.id} keyed>
        {id => <DecisionDialog decision={state().pending[0]}
          onAnswer={(value, fields) => props.controller.answer(id, value, fields)}
          onCancel={() => props.controller.cancelDialog(id)} />}
      </Show>
    </box>
  );
}

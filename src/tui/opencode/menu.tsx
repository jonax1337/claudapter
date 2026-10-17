// Adapted from OpenCode ui/dialog-select.tsx (MIT); see docs/opencode-provenance.md.
import { For, createMemo, createSignal, createEffect } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { ScrollBoxRenderable } from '@opentui/core';

export interface MenuItem { title: string; description?: string; run(): void | Promise<void> }
export function Menu(props: { title:string; items:MenuItem[]; onClose():void }) {
  const [filter,setFilter] = createSignal('');
  const [selected,setSelected] = createSignal(0);
  const [error,setError] = createSignal('');
  const [busy,setBusy] = createSignal(false);
  let scroll: ScrollBoxRenderable | undefined;
  const options = createMemo(() => props.items.filter(item => (item.title+' '+(item.description??'')).toLowerCase().includes(filter().toLowerCase())));
  createEffect(() => { options(); setSelected(0); });
  createEffect(() => { scroll?.scrollTo(selected()*2); });
  async function choose(item:MenuItem|undefined) {
    if (!item || busy()) return;
    setBusy(true);
    try { await item.run(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  useKeyboard(event => {
    if (event.name==='escape') { event.preventDefault(); if(!busy())props.onClose(); }
    if (event.name==='up'||event.name==='down') {
      event.preventDefault();
      setSelected(index => Math.max(0,Math.min(options().length-1,index+(event.name==='up'?-1:1))));
    }
    if(event.name==='return'){event.preventDefault();void choose(options()[selected()]);}
  });
  return <box position="absolute" left={2} right={2} top={2} bottom={2} zIndex={1000} padding={1} backgroundColor="#25252d">
    <text flexShrink={0} height={1} fg="#a78bfa">{props.title}</text>
    <input flexShrink={0} focused={!busy()} placeholder="Search" onInput={value=>setFilter(value)} />
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <For each={options()}>{(option,index)=><box flexShrink={0}
        backgroundColor={index()===selected()?'#57447c':undefined}
        onMouseMove={()=>setSelected(index())} onMouseUp={()=>void choose(option)}>
        <text fg="#eeeeee">{option.title}</text><text fg="#aaaaaa">{option.description??' '}</text>
      </box>}</For>
      <text>{options().length?'':'No results found'}</text>
    </scrollbox>
    <text fg="#ff7777">{error()}</text>
    <text fg="#aaaaaa">{busy()?'Working…':'↑ ↓ select · enter open · esc close'}</text>
  </box>;
}

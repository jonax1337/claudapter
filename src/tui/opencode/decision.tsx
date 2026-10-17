// Adapted from OpenCode ui/dialog-confirm.tsx (MIT); see docs/opencode-provenance.md.
import { For, createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { safeText } from '../../../dist/tui/editor.js';

export interface Decision {
  id: string;
  title: string;
  description: string;
  fields: {key:string;label:string;type?:string;required?:boolean;secret?:boolean;options?:string[];multi?:boolean}[];
  choices: { label: string; value: unknown }[];
  defaultIndex: number;
}

export function DecisionDialog(props: { decision: Decision; onAnswer(value: unknown, fields: Record<string,string>): void | Promise<void>; onCancel(): void }) {
  const [active, setActive] = createSignal(props.decision.defaultIndex);
  const [field, setField] = createSignal(-1);
  const [values, setValues] = createSignal<Record<string,string>>(Object.create(null));
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const choose = async (index: number) => {
    const choice = props.decision.choices[index];
    if (!choice || busy()) return;
    setBusy(true);
    try { await props.onAnswer(choice.value, {...values()}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid answer.'); }
    finally { setBusy(false); }
  };
  useKeyboard(event => {
    if (busy()) { event.preventDefault(); return; }
    if (event.name === 'escape') { event.preventDefault(); props.onCancel(); }
    if (event.name === 'tab') {
      event.preventDefault();
      setField(current => current + 1 >= props.decision.fields.length ? -1 : current + 1);
      return;
    }
    if (field() >= 0) {
      const spec = props.decision.fields[field()];
      if (spec.secret) {
        event.preventDefault();
        const previous = values()[spec.key] ?? '';
        const next = event.name === 'backspace' ? Array.from(previous).slice(0,-1).join('') :
          !event.ctrl && !event.meta && event.sequence && !/[\x00-\x1f\x7f]/.test(event.sequence) ? previous + event.sequence : previous;
        setValues(current => ({...current,[spec.key]:next}));
      }
      return;
    }
    if (event.name === 'left' || event.name === 'right') {
      event.preventDefault();
      const count = props.decision.choices.length;
      if (count) setActive(index => (index + (event.name === 'left' ? count - 1 : 1)) % count);
    }
    if (event.name === 'return') { event.preventDefault(); choose(active()); }
  });
  return (
    <box position="absolute" left={1} right={1} top={1} bottom={1} zIndex={2000}
      backgroundColor="#25252d" padding={2}>
      <text fg="#eeeeee">{safeText(props.decision.title)}</text>
      <scrollbox flexGrow={1}>
        <text fg="#cccccc">{safeText(props.decision.description)}</text>
        <For each={props.decision.fields}>{(spec,index) => <box marginTop={1} flexShrink={0}>
          <text fg={field() === index() ? '#a78bfa' : '#cccccc'}>{spec.label}{spec.required ? ' *' : ''}</text>
          <text fg="#aaaaaa">{spec.options?.join(spec.multi ? ' / (comma-separated) ' : ' / ') ?? spec.type ?? ''}</text>
          {spec.secret ? <text fg="#eeeeee">{'•'.repeat(Array.from(values()[spec.key] ?? '').length)}{field() === index() ? '▏' : ''}</text> :
            <input focused={field() === index()} value={values()[spec.key] ?? ''}
              onInput={value => setValues(current => ({...current,[spec.key]:value}))} />}
        </box>}</For>
      </scrollbox>
      <text fg="#ff7777">{error()}</text>
      <box flexDirection="row" justifyContent="flex-end">
        <For each={props.decision.choices}>
          {(choice, index) => <box paddingLeft={1} paddingRight={1}
            backgroundColor={index() === active() ? '#57447c' : undefined}
            onMouseUp={() => choose(index())}>
            <text fg="#eeeeee">{choice.label}</text>
          </box>}
        </For>
      </box>
      <text fg="#aaaaaa">tab fields/actions · ← → select · enter confirm · esc cancel</text>
    </box>
  );
}

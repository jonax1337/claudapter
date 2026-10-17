// Adapted from OpenCode ui/dialog-confirm.tsx (MIT); see docs/opencode-provenance.md.
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core';
import { safeText } from '../../../dist/tui/editor.js';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, wrappedRows, type DialogSize, type KeyHint } from './dialog';
import {
  NO_FIELD, chosenOptions, customAnswer, firstMissingField, hasOptions, isPermissionDecision, moveRow, nextField, numberKeyRow,
  optionRows, permissionShortcut, submitsForm, toggleOption, withCustomAnswer, type DecisionField,
} from './decision-model';
import { parsePermission, permissionRows, type PermissionSource } from './permission';
import { PermissionView, permissionRowCount } from './permission-view';
import { useTheme } from './theme';

export interface Decision {
  id: string;
  title: string;
  description: string;
  fields: DecisionField[];
  choices: { label: string; value: unknown }[];
  defaultIndex: number;
  /** Structured tool call behind a permission prompt; parsed from the description when absent. */
  tool?: PermissionSource['tool'];
}

type Values = Record<string, string>;

/** Descriptions above this many wrapped rows (JSON views, diffs) get the wide dialog. */
const LARGE_DESCRIPTION_ROWS = 12;
const ROWS_PER_FIELD = 3;
/** The allow shortcuts ignore keys typed before the user could have seen the request. */
const SHORTCUT_ARM_MS = 300;

export function DecisionDialog(props: { decision: Decision; onAnswer(value: unknown, fields: Record<string,string>): void | Promise<void>; onCancel(): void; shortcutDelayMs?: number }) {
  const theme = useTheme();
  const fields = props.decision.fields;
  const choices = props.decision.choices;
  const [active, setActive] = createSignal(props.decision.defaultIndex);
  const [field, setField] = createSignal(fields[0] && hasOptions(fields[0]) ? 0 : NO_FIELD);
  const [optionRow, setOptionRow] = createSignal(0);
  const [values, setValues] = createSignal<Values>(Object.assign(Object.create(null),
    Object.fromEntries(fields.flatMap(field => field.initial !== undefined ? [[field.key, field.initial] as const] : []))));
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [raw, setRaw] = createSignal(false);
  const [armed, setArmed] = createSignal(false);
  const armTimer = setTimeout(() => setArmed(true), props.shortcutDelayMs ?? SHORTCUT_ARM_MS);
  onCleanup(() => clearTimeout(armTimer));
  let scroller: ScrollBoxRenderable | undefined;

  const description = () => safeText(props.decision.description);
  const request = isPermissionDecision(props.decision) ?
    parsePermission({ title: props.decision.title, description: props.decision.description, tool: props.decision.tool }) : undefined;
  const structured = () => request !== undefined && !raw();
  const bodyRows = (width: number) => structured() ? permissionRowCount(permissionRows(request!), width) : wrappedRows(description(), width);
  const mediumWidth = useDialogContentWidth('medium');
  const size = (): DialogSize => bodyRows(mediumWidth()) > LARGE_DESCRIPTION_ROWS ? 'large' : 'medium';
  const contentWidth = useDialogContentWidth(size());
  const bodyLimit = useDialogBodyLimit();
  const reservedRows = fields.reduce((rows, spec) => rows + (hasOptions(spec) ? 1 : ROWS_PER_FIELD), 0) +
    Math.max(0, ...fields.filter(hasOptions).map(spec => optionRows(spec) + 2));
  const bodyHeight = () => Math.max(1, Math.min(bodyRows(contentWidth()), bodyLimit() - reservedRows));

  const focusField = (index: number) => {
    setField(index);
    const spec = fields[index];
    const chosen = spec && hasOptions(spec) ? spec.options!.indexOf(chosenOptions(values()[spec.key] ?? '', spec.options!, !!spec.multi)[0]) : 0;
    setOptionRow(Math.max(0, chosen));
  };
  const setValue = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }));

  const choose = async (index: number) => {
    const choice = choices[index];
    if (!choice || busy()) return;
    setError('');
    const missing = submitsForm(choice.value) ? firstMissingField(fields, values()) : NO_FIELD;
    if (missing !== NO_FIELD) { focusField(missing); setError(fields[missing].label + ' is required.'); return; }
    setBusy(true);
    try { await props.onAnswer(choice.value, {...values()}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid answer.'); }
    finally { setBusy(false); }
  };

  const pickRow = (spec: DecisionField, row: number) => {
    setOptionRow(row);
    if (row < spec.options!.length) setValue(spec.key, toggleOption(values()[spec.key] ?? '', spec.options![row], spec.options!, !!spec.multi));
  };
  const typeSecret = (event: KeyEvent, spec: DecisionField) => {
    event.preventDefault();
    const previous = values()[spec.key] ?? '';
    setValue(spec.key, event.name === 'backspace' ? Array.from(previous).slice(0,-1).join('') :
      !event.ctrl && !event.meta && event.sequence && !/[\x00-\x1f\x7f]/.test(event.sequence) ? previous + event.sequence : previous);
  };
  const handleOptionKey = (event: KeyEvent, spec: DecisionField) => {
    const rows = optionRows(spec);
    const onFreeTextRow = optionRow() === spec.options!.length;
    if (event.name === 'up' || event.name === 'down') { event.preventDefault(); setOptionRow(row => moveRow(row, event.name === 'up' ? -1 : 1, rows)); return; }
    if (event.name === 'return') {
      event.preventDefault();
      if (!spec.multi && !onFreeTextRow) pickRow(spec, optionRow());
      focusField(nextField(field(), fields.length, false));
      return;
    }
    if (onFreeTextRow || event.ctrl || event.meta) return;
    const digitRow = numberKeyRow(event.sequence || event.name, rows);
    if (digitRow !== undefined) { event.preventDefault(); pickRow(spec, digitRow); }
    else if (event.name === 'space') { event.preventDefault(); pickRow(spec, optionRow()); }
  };
  const handlePermissionKey = (event: KeyEvent) => {
    if (event.ctrl || event.meta) return false;
    if (event.sequence === '?') { event.preventDefault(); setRaw(value => !value); return true; }
    const answer = permissionShortcut(event.name, choices, armed());
    if (answer === undefined) return false;
    event.preventDefault();
    setActive(answer);
    void choose(answer);
    return true;
  };
  const handleChoiceKey = (event: KeyEvent) => {
    const count = choices.length;
    const step = event.name === 'left' || event.name === 'up' ? count - 1 : event.name === 'right' || event.name === 'down' ? 1 : 0;
    if (step && count) { event.preventDefault(); setActive(index => (index + step) % count); }
    else if (event.name === 'return') { event.preventDefault(); void choose(active()); }
    else if (request) handlePermissionKey(event);
  };
  const handleFieldKey = (event: KeyEvent) => {
    const spec = fields[field()];
    if (spec.secret) typeSecret(event, spec);
    else if (hasOptions(spec)) handleOptionKey(event, spec);
  };
  useKeyboard(event => {
    if (busy()) { event.preventDefault(); return; }
    if (event.name === 'escape') { event.preventDefault(); props.onCancel(); return; }
    if (event.name === 'pageup' || event.name === 'pagedown') { event.preventDefault(); scroller?.scrollBy((event.name === 'pageup' ? -1 : 1) * bodyHeight()); return; }
    if (event.name === 'tab') { event.preventDefault(); focusField(nextField(field(), fields.length, event.shift)); return; }
    if (field() >= 0) handleFieldKey(event);
    else handleChoiceKey(event);
  });

  const hints = (): KeyHint[] => {
    const spec = fields[field()];
    if (spec && hasOptions(spec)) return [['1-9', 'select'], [spec.multi ? 'space' : 'enter', spec.multi ? 'toggle' : 'select'], ['↑↓', 'move'], ['tab', 'next'], ['shift+tab', 'back']];
    if (fields.length) return [['tab', 'next field'], ['←→', 'choose'], ['enter', 'confirm']];
    if (!request) return [['←→', 'choose'], ['enter', 'confirm']];
    return [['y', 'allow once'], ['n', 'deny'], ...(permissionShortcut('s', choices, true) !== undefined ? [['s', 'session'] as KeyHint] : []),
      ['?', raw() ? 'summary' : 'raw input'], ['←→', 'choose'], ['enter', 'confirm']];
  };
  return (
    <Dialog title={safeText(props.decision.title)} size={size()} footer={<KeyHints hints={hints()} />}>
      <Show when={description()}>
        <Show when={structured()} fallback={
          <scrollbox ref={scroller} height={bodyHeight()} marginTop={1} flexShrink={0}>
            <text fg={theme().muted}>{description()}</text>
          </scrollbox>
        }>
          <PermissionView rows={permissionRows(request!)} height={bodyHeight()} scrollRef={box => { scroller = box; }} />
        </Show>
      </Show>
      <For each={fields}>{(spec, index) => hasOptions(spec) ?
        <OptionQuestion spec={spec} number={index() + 1} total={fields.length} focused={field() === index()} row={optionRow()} value={values()[spec.key] ?? ''}
          onPick={row => { setField(index()); pickRow(spec, row); }} onCustom={text => setValue(spec.key, withCustomAnswer(values()[spec.key] ?? '', text, spec.options!, !!spec.multi))} /> :
        <TextQuestion spec={spec} focused={field() === index()} value={values()[spec.key] ?? ''} onInput={value => setValue(spec.key, value)} />
      }</For>
      <Show when={error()}><text fg={theme().error} marginTop={1}>{error()}</text></Show>
      <box flexDirection="row" justifyContent="flex-end" gap={1} marginTop={1} flexShrink={0}>
        <For each={choices}>
          {(choice, index) => {
            const selected = () => index() === active() && field() < 0;
            return <box paddingLeft={1} paddingRight={1} flexShrink={0} backgroundColor={selected() ? theme().accent : theme().element}
              onMouseUp={() => choose(index())}>
              <text fg={selected() ? theme().background : theme().text} attributes={selected() ? TextAttributes.BOLD : undefined}
                wrapMode="none">{choice.label}</text>
            </box>;
          }}
        </For>
      </box>
    </Dialog>
  );
}

function TextQuestion(props: { spec: DecisionField; focused: boolean; value: string; onInput(value: string): void }) {
  const theme = useTheme();
  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={props.focused ? theme().accent : theme().text}>
        {safeText(props.spec.label)}{props.spec.required ? <span style={{ fg: theme().error }}> *</span> : ''}
        <span style={{ fg: theme().muted }}>{props.spec.type ? '  ' + props.spec.type : ''}</span>
      </text>
      <box backgroundColor={theme().element} paddingLeft={1} paddingRight={1} flexShrink={0}>
        {props.spec.secret ? <text fg={theme().text}>{'•'.repeat(Array.from(props.value).length)}{props.focused ? '▏' : ''}</text> :
          <input focused={props.focused} value={props.value} textColor={theme().text} focusedTextColor={theme().text}
            backgroundColor={theme().element} focusedBackgroundColor={theme().element} onInput={props.onInput} />}
      </box>
    </box>
  );
}

interface OptionQuestionProps {
  spec: DecisionField;
  number: number;
  total: number;
  focused: boolean;
  row: number;
  value: string;
  onPick(row: number): void;
  onCustom(text: string): void;
}

/** A multiple-choice question: numbered options plus a free-text row; collapsed to one line while unfocused. */
function OptionQuestion(props: OptionQuestionProps) {
  const theme = useTheme();
  const options = () => props.spec.options!;
  const chosen = () => chosenOptions(props.value, options(), !!props.spec.multi);
  const custom = () => customAnswer(props.value, options(), !!props.spec.multi);
  const answer = () => safeText([...chosen(), custom()].filter(Boolean).join(', '));
  const progress = () => props.total > 1 ? `Question ${props.number}/${props.total}  ` : '';
  const marker = (selected: boolean) => props.spec.multi ? (selected ? '[x]' : '[ ]') : (selected ? '(•)' : '( )');
  const label = createMemo(() => safeText(props.spec.label));
  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={props.focused ? theme().accent : theme().text} wrapMode={props.focused ? 'word' : 'none'}>
        <span style={{ fg: theme().muted }}>{progress()}</span>{label()}
        <Show when={!props.focused}><span style={{ fg: answer() ? theme().success : theme().muted }}>{answer() ? '  ' + answer() : props.spec.required ? '  unanswered' : ''}</span></Show>
      </text>
      <Show when={props.focused}>
        <For each={options()}>{(option, index) =>
          <box flexDirection="row" gap={1} height={1} onMouseUp={() => props.onPick(index())}>
            <text fg={props.row === index() ? theme().accent : theme().muted} wrapMode="none">{props.row === index() ? '›' : ' '}{index() < 9 ? index() + 1 : ' '}.</text>
            <text fg={chosen().includes(option) ? theme().success : theme().text} wrapMode="none">{marker(chosen().includes(option))} {safeText(option)}</text>
          </box>
        }</For>
        <box flexDirection="row" gap={1} height={1}>
          <text fg={props.row === options().length ? theme().accent : theme().muted} wrapMode="none">{props.row === options().length ? '›' : ' '}{options().length < 9 ? options().length + 1 : ' '}.</text>
          <text fg={theme().muted} wrapMode="none">Other:</text>
          <box flexGrow={1} backgroundColor={theme().element}>
            <input focused={props.row === options().length} value={custom()} textColor={theme().text} focusedTextColor={theme().text}
              backgroundColor={theme().element} focusedBackgroundColor={theme().element} onInput={props.onCustom} />
          </box>
        </box>
      </Show>
    </box>
  );
}

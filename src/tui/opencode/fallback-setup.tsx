import { TextAttributes } from '@opentui/core';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { FallbackRule } from '../../../dist/config.js';
import type { Model } from '../../../dist/models.js';
import { explainRule, fallbackPresets, type FallbackPreset } from '../../../dist/fallback-presets.js';
import { Dialog, KeyHints, useDialogContentWidth, type KeyHint } from './dialog';
import { truncate } from './layout';
import { useTheme } from './theme';

/** Cancel is first and preselected: nothing is saved without an explicit choice. */
const CHOICES = [
  { label: 'Cancel', enabled: undefined },
  { label: 'Save disabled', enabled: false },
  { label: 'Enable fallback', enabled: true },
] as const;
const PICK_HINTS: KeyHint[] = [['↑↓', 'preset'], ['←→', 'primary model'], ['enter', 'review'], ['esc', 'close']];
const REVIEW_HINTS: KeyHint[] = [['←→', 'choose'], ['enter', 'confirm'], ['esc', 'back']];

export interface FallbackSetupProps {
  models: Model[];
  primary: string;
  preemptPercent: number;
  onSave(rule: FallbackRule): Promise<void>;
  onClose(): void;
}

/**
 * Guided fallback setup: presets from signed-in models, the gateway's capability warnings,
 * a dry run of the policy and an explicit Cancel / Save disabled / Enable choice.
 */
export function FallbackSetup(props: FallbackSetupProps) {
  const [primary, setPrimary] = createSignal(props.primary);
  const [selected, setSelected] = createSignal(0);
  const [reviewing, setReviewing] = createSignal<FallbackPreset>();
  const [choice, setChoice] = createSignal(0);
  const [error, setError] = createSignal('');
  const presets = createMemo(() => fallbackPresets(props.models, primary()));
  const cyclePrimary = (step: number) => {
    const ids = props.models.map(model => model.id);
    setPrimary(ids[(ids.indexOf(primary()) + step + ids.length) % ids.length]);
    setSelected(0);
  };
  const confirm = async (preset: FallbackPreset) => {
    const { enabled } = CHOICES[choice()];
    if (enabled === undefined) { setReviewing(undefined); return; }
    try { await props.onSave({ ...preset.rule, enabled }); }
    catch (failure) { setError((failure as Error).message); }
  };

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const preset = reviewing();
    const actions: Record<string, () => void> = preset ? {
      left: () => setChoice(value => Math.max(0, value - 1)),
      right: () => setChoice(value => Math.min(CHOICES.length - 1, value + 1)),
      return: () => void confirm(preset),
      escape: () => setReviewing(undefined),
    } : {
      up: () => setSelected(value => Math.max(0, value - 1)),
      down: () => setSelected(value => Math.min(presets().length - 1, value + 1)),
      left: () => cyclePrimary(-1), right: () => cyclePrimary(1),
      return: () => { const chosen = presets()[selected()]; if (chosen) { setChoice(0); setError(''); setReviewing(chosen); } },
      escape: props.onClose,
    };
    const action = actions[event.name];
    if (action) { event.preventDefault(); action(); }
  });

  return (
    <Dialog title="Fallback setup" size="large" footer={<KeyHints hints={reviewing() ? REVIEW_HINTS : PICK_HINTS} />} onBackdrop={props.onClose}>
      <Switch>
        <Match when={reviewing()}>{preset =>
          <PresetReview preset={preset()} models={props.models} preemptPercent={props.preemptPercent} choice={choice()} error={error()} />}
        </Match>
        <Match when={true}>
          <PresetList primary={primary()} presets={presets()} selected={selected()} />
        </Match>
      </Switch>
    </Dialog>
  );
}

function PresetList(props: { primary: string; presets: FallbackPreset[]; selected: number }) {
  const theme = useTheme();
  const width = useDialogContentWidth('large');
  return (
    <box marginTop={1} flexDirection="column" flexShrink={0}>
      <text fg={theme().muted} wrapMode="none">{'When '}<span style={{ fg: theme().text }}>{props.primary}</span>{' hits a limit, continue on:'}</text>
      <Show when={props.presets.length} fallback={
        <text fg={theme().warning}>No other signed-in provider. Sign in to ChatGPT with the Codex CLI or add a provider, then reopen this setup.</text>
      }>
        <For each={props.presets}>{(preset, index) =>
          <box height={1} flexShrink={0} backgroundColor={index() === props.selected ? theme().selection : undefined}>
            <text wrapMode="none" fg={index() === props.selected ? theme().selectionText : theme().text}>
              {truncate(preset.title, width() - 16) + '  '}
              <span style={{ fg: index() === props.selected ? theme().selectionText : preset.warnings.length ? theme().warning : theme().success }}>
                {preset.warnings.length ? preset.warnings.length + ' warning(s)' : 'compatible'}
              </span>
            </text>
          </box>
        }</For>
      </Show>
    </box>
  );
}

function PresetReview(props: { preset: FallbackPreset; models: Model[]; preemptPercent: number; choice: number; error: string }) {
  const theme = useTheme();
  return (
    <box marginTop={1} flexDirection="column" flexShrink={0}>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>{props.preset.title}</text>
      <For each={explainRule(props.preset.rule, props.models, props.preemptPercent)}>{line => <text fg={theme().muted}>{'· ' + line}</text>}</For>
      <Show when={props.preset.warnings.length}>
        <text fg={theme().warning} marginTop={1}>Capability warnings (these turns fail instead of falling back):</text>
        <For each={props.preset.warnings}>{warning => <text fg={theme().warning}>{'! ' + warning}</text>}</For>
      </Show>
      <box flexDirection="row" gap={2} marginTop={1}>
        <For each={CHOICES}>{(option, index) =>
          <text fg={index() === props.choice ? theme().background : theme().text}
            bg={index() === props.choice ? (option.enabled ? theme().success : theme().accent) : undefined}>{' ' + option.label + ' '}</text>
        }</For>
      </box>
      <Show when={props.error}><text fg={theme().error}>{props.error}</text></Show>
    </box>
  );
}

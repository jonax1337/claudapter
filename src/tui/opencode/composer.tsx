// Adapted from OpenCode component/prompt/index.tsx (MIT); see docs/opencode-provenance.md.
import type { TextareaRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { createSignal, createEffect } from 'solid-js';

export interface ComposerProps {
  disabled: boolean;
  model: string;
  recalled?: {text:string};
  onSubmit(text: string): void | Promise<void>;
}

export function Composer(props: ComposerProps) {
  const dimensions = useTerminalDimensions();
  let input: TextareaRenderable | undefined;
  createEffect(() => { const recalled=props.recalled;if(recalled&&input)input.setText(recalled.text); });
  const [error, setError] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  async function submit() {
    if (props.disabled || submitting() || !input || !input.plainText.trim()) return;
    const submittedInput = input;
    const text = input.plainText;
    setSubmitting(true);
    try {
      await props.onSubmit(text);
      if (!submittedInput.isDestroyed && submittedInput.plainText === text) submittedInput.clear();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed.');
    } finally { setSubmitting(false); }
  }
  return (
    <box width="100%" flexShrink={0} border={['left']} borderColor="#a78bfa">
      <box
        paddingLeft={dimensions().width < 44 ? 1 : 2}
        paddingRight={dimensions().width < 44 ? 1 : 2}
        paddingTop={1}
        flexShrink={0}
        backgroundColor="#1e1e24"
        flexGrow={1}
        width="100%"
      >
        <textarea
          ref={input}
          width="100%"
          placeholder="Ask anything"
          textColor="#eeeeee"
          focusedTextColor="#eeeeee"
          minHeight={1}
          maxHeight={6}
          focused={!props.disabled && !submitting()}
          keyBindings={[{ name: 'return', action: 'submit' }, { name: 'return', shift: true, action: 'newline' }]}
          onSubmit={submit}
          onKeyDown={event => { if (props.disabled) event.preventDefault(); }}
        />
        <text fg="#ff7777">{error()}</text>
        <box flexDirection="row" flexShrink={0} paddingTop={1} paddingBottom={1} justifyContent="space-between">
          <text fg="#a78bfa">{props.model}</text>
          <text fg="#aaaaaa">enter send · shift+enter newline</text>
        </box>
      </box>
    </box>
  );
}

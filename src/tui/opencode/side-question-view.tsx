// Answer panel for /btw side questions; the question and answer are never added to the conversation.
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes } from '@opentui/core';
import { wrapText } from '../../../dist/tui/editor.js';
import type { SideAnswer } from '../../../dist/tui/side-question.js';
import { Dialog, KeyHints, useDialogBodyLimit, useDialogContentWidth, type KeyHint } from './dialog';
import { Spinner } from './status';
import { useTheme } from './theme';

const PENDING_HINTS: KeyHint[] = [['esc', 'cancel']];
const DONE_HINTS: KeyHint[] = [['↑↓', 'scroll'], ['esc', 'close']];
const QUESTION_LINES = 2;
const EMPTY_ANSWER = 'The model returned no answer.';
const FALLBACK_NOTE = (model: string) => `Answered by ${model} after the requested model declined.`;

type Outcome = { status: 'pending' } | { status: 'done'; answer: SideAnswer | undefined } | { status: 'failed'; message: string };

export interface SideQuestionPanelProps {
  question: string;
  task: Promise<SideAnswer | undefined>;
  /** Aborts the engine request; called when the panel is dismissed before the answer arrived. */
  onCancel(): void;
  onClose(): void;
}

export function SideQuestionPanel(props: SideQuestionPanelProps) {
  const theme = useTheme();
  const bodyLimit = useDialogBodyLimit();
  const width = useDialogContentWidth('large');
  const [outcome, setOutcome] = createSignal<Outcome>({ status: 'pending' });
  const [offset, setOffset] = createSignal(0);
  onMount(() => void props.task.then(
    answer => setOutcome({ status: 'done', answer }),
    cause => setOutcome({ status: 'failed', message: cause instanceof Error ? cause.message : 'The side question failed.' }),
  ));
  const questionLines = createMemo(() => wrapText(props.question, width()).slice(0, QUESTION_LINES));
  const answerLines = createMemo(() => {
    const current = outcome();
    return current.status === 'done' ? wrapText(current.answer?.text || EMPTY_ANSWER, width()) : [];
  });
  const height = () => Math.max(1, bodyLimit() - questionLines().length - 3);
  const clamp = (next: number) => Math.max(0, Math.min(next, Math.max(0, answerLines().length - height())));
  const note = () => {
    const current = outcome();
    return current.status === 'done' && current.answer?.fallbackModel ? FALLBACK_NOTE(current.answer.fallbackModel) : '';
  };

  useKeyboard(event => {
    if (event.ctrl || event.meta) return;
    const moves: Record<string, () => void> = {
      up: () => setOffset(value => clamp(value - 1)), down: () => setOffset(value => clamp(value + 1)),
      pageup: () => setOffset(value => clamp(value - height())), pagedown: () => setOffset(value => clamp(value + height())),
    };
    if (event.name === 'escape') { event.preventDefault(); if (outcome().status === 'pending') props.onCancel(); props.onClose(); }
    else if (moves[event.name]) { event.preventDefault(); moves[event.name](); }
  });

  return (
    <Dialog title="Side question" size="large" onBackdrop={props.onClose}
      footer={<KeyHints hints={outcome().status === 'pending' ? PENDING_HINTS : DONE_HINTS} />}>
      <box marginTop={1} flexShrink={0}>
        <For each={questionLines()}>{line => <text fg={theme().accent} attributes={TextAttributes.BOLD}>{line}</text>}</For>
      </box>
      <box marginTop={1} flexShrink={0}>
        <Show when={outcome().status !== 'pending'} fallback={
          <box flexDirection="row" gap={1}><Spinner color={theme().accent} /><text fg={theme().muted}>Asking without interrupting the main turn…</text></box>
        }>
          <Show when={outcome().status !== 'failed'} fallback={<text fg={theme().error}>{(outcome() as { message: string }).message}</text>}>
            <For each={answerLines().slice(offset(), offset() + height())}>{line => <text fg={theme().text}>{line}</text>}</For>
          </Show>
        </Show>
      </box>
      <Show when={note()}><text fg={theme().warning} marginTop={1}>{note()}</text></Show>
      <text fg={theme().muted} marginTop={1}>Not saved to the conversation.</text>
    </Dialog>
  );
}

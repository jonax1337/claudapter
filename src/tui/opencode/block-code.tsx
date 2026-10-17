import { Show, createSignal, onCleanup } from 'solid-js';
import { copyText } from '../../../dist/tui/clipboard.js';
import { filetypeForFence, useSyntaxStyle } from './block-syntax';
import { useClick } from './block-click';
import { useTheme } from './theme';

const FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

/** Fenced code: language label, copy action and tree-sitter highlighting where a parser is bundled. */
export function CodeBlock(props: { code: string; language: string; streaming: boolean; copy?: (text: string) => Promise<void> }) {
  const theme = useTheme();
  const style = useSyntaxStyle();
  const [state, setState] = createSignal<CopyState>('idle');
  let reset: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(reset));
  const show = (next: CopyState) => {
    setState(next);
    clearTimeout(reset);
    reset = setTimeout(() => setState('idle'), FEEDBACK_MS);
  };
  const copy = useClick(() => void (props.copy ?? copyText)(props.code).then(() => show('copied'), () => show('failed')));
  return (
    <box backgroundColor={theme().panel} paddingLeft={1} paddingRight={1} marginTop={1} marginBottom={1} flexShrink={0} width="100%">
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme().muted}>{props.language || 'text'}</text>
        <Show when={!props.streaming}>
          <box onMouseUp={copy}>
            <text fg={state() === 'failed' ? theme().error : theme().secondary}>
              {state() === 'copied' ? 'copied' : state() === 'failed' ? 'copy failed' : 'copy'}
            </text>
          </box>
        </Show>
      </box>
      <code content={props.code} filetype={filetypeForFence(props.language)} syntaxStyle={style()} streaming={props.streaming}
        fg={theme().text} wrapMode="char" conceal={false} />
    </box>
  );
}

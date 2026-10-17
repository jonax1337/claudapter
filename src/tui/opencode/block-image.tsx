import { For, Show, createSignal } from 'solid-js';
import { imageLabel, type ImageRef } from './block-model';
import { useClick } from './block-click';
import { copyImage, openImage } from './clipboard-image';
import { useTheme } from './theme';

export interface ImageActions {
  open(image: ImageRef): Promise<string>;
  copy(image: ImageRef): Promise<{ copied: 'image' | 'path'; path: string }>;
}

const SYSTEM_ACTIONS: ImageActions = { open: openImage, copy: copyImage };

function ImageRow(props: { image: ImageRef; position: number; actions: ImageActions }) {
  const theme = useTheme();
  const [status, setStatus] = createSignal('');
  const run = (task: Promise<string>) => task.then(setStatus, (error: Error) => setStatus('failed: ' + error.message));
  const open = useClick(() => void run(props.actions.open(props.image).then(path => 'opened ' + path)));
  const copy = useClick(() => void run(props.actions.copy(props.image).then(result =>
    result.copied === 'image' ? 'copied to clipboard' : 'format not supported by the clipboard; file path copied')));
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      <text fg={theme().accent}>▣</text>
      <text fg={theme().muted}>{`Image ${props.position} · ${imageLabel(props.image)}`}</text>
      <Show when={props.image.data} fallback={<text fg={theme().muted}>(content not kept)</text>}>
        <box onMouseUp={open}><text fg={theme().secondary}>[open]</text></box>
        <box onMouseUp={copy}><text fg={theme().secondary}>[copy]</text></box>
      </Show>
      <Show when={status()}><text fg={theme().muted}>{status()}</text></Show>
    </box>
  );
}

/**
 * Placeholder rows for images in a prompt or a tool result. The terminal is never asked to draw pixels, so the
 * same rows serve terminals without a graphics protocol; `[open]` shows the image in the system viewer and
 * `[copy]` puts it on the clipboard.
 */
export function ImageList(props: { images: ImageRef[]; actions?: ImageActions }) {
  return (
    <box flexShrink={0}>
      <For each={props.images}>{(image, index) => <ImageRow image={image} position={index() + 1} actions={props.actions ?? SYSTEM_ACTIONS} />}</For>
    </box>
  );
}

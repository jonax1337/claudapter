// Adapted from OpenCode packages/tui/src/routes/home.tsx (MIT).
// Upstream: 07bbd0fd166c82d87e79f053dc70e6fdb66f88ac. See docs/opencode-provenance.md.
import { useTerminalDimensions } from '@opentui/solid';
import type { JSX } from 'solid-js';

const wordmark = [
  '  ___ _      _   _   _ ___   _   ___ _____ ___ ___ ',
  ' / __| |    /_\\ | | | |   \\ /_\\ | _ \\_   _| __| _ \\',
  '| (__| |__ / _ \\| |_| | |) / _ \\|  _/ | | | _||   /',
  ' \\___|____/_/ \\_\\\\___/|___/_/ \\_\\_|   |_| |___|_|_\\',
];

export function Logo() {
  const dimensions = useTerminalDimensions();
  const wide = () => dimensions().width >= 58 && dimensions().height >= 24;
  return <box alignItems="center" flexShrink={0}>
    <text fg="#a78bfa">{wide() ? wordmark.join('\n') : '[ >_ ] CLAUDAPTER'}</text>
    <text fg="#67e8f9">{wide() ? 'o───[ YOUR WORKSPACE ]───<>───[ YOUR MODELS ]───o' : 'YOUR WORKSPACE / YOUR MODELS'}</text>
  </box>;
}

export interface HomeProps {
  logo: JSX.Element;
  prompt: JSX.Element;
  footer: JSX.Element;
}

export function Home(props: HomeProps) {
  const dimensions = useTerminalDimensions();
  return (
    <>
      <box
        flexGrow={1}
        alignItems="center"
        paddingLeft={dimensions().width < 44 ? 1 : 2}
        paddingRight={dimensions().width < 44 ? 1 : 2}
      >
        <box flexGrow={1} minHeight={0} />
        <box height={3} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>{props.logo}</box>
        <box height={1} flexShrink={0} />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0} position="relative">
          {props.prompt}
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0}>{props.footer}</box>
    </>
  );
}

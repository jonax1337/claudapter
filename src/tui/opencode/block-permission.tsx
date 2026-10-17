import { For } from 'solid-js';
import { permissionDetails, permissionLine, type PermissionRecord, type PermissionTone } from './block-model';
import { useTheme, type Theme } from './theme';

const toneColor = (theme: Theme, tone: PermissionTone) =>
  tone === 'allowed' ? theme.success : tone === 'denied' ? theme.error : tone === 'pending' ? theme.warning : theme.muted;

/**
 * Permission request kept in the transcript: what was asked (`subject`), the decision and who made it.
 * The decision itself is taken in the dialog; this row only records it, so it stays readable afterwards.
 */
export function PermissionRow(props: { permission: PermissionRecord; toolName: string; subject: string; indent: number }) {
  const theme = useTheme();
  const line = () => permissionLine(props.permission);
  return (
    <box paddingLeft={props.indent} flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <text fg={toneColor(theme(), line().tone)}>{line().glyph}</text>
        <text fg={theme().muted}>
          <span style={{ fg: theme().text }}>{line().headline}</span>
          {' · ' + props.toolName + (props.subject ? ' ' + props.subject : '') + ' · ' + line().by}
        </text>
      </box>
      <For each={permissionDetails(props.permission)}>{detail => <text fg={theme().muted}>{'  ' + detail}</text>}</For>
    </box>
  );
}

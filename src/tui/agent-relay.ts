import type { TranscriptEntry } from './transcript-model.js';

/**
 * Messages from the user to a sub-agent.
 *
 * Claude Code 2.1.301–2.1.302 offers a host no control request that writes into a sub-agent's conversation:
 * the native agent view queues typed text on the in-process task, and SDK ingress drops user frames that carry
 * a `parent_tool_use_id`. The only engine path to a sub-agent is the main agent's `SendMessage` tool, which
 * queues the text for a running agent at its next tool round and resumes a finished one. Claudapter therefore
 * relays: it asks the main agent to make exactly that call and reports the call's own result. The sub-agent
 * receives the text as an agent message, which the engine never treats as the user's consent.
 */
export const SEND_MESSAGE_TOOL = 'SendMessage';
const DETAIL_LIMIT = 300;

export type RelayStatus = 'queued' | 'sent' | 'delivered' | 'failed';
export interface RelayView { status: RelayStatus; text: string; detail?: string; at: number }

export function relayPrompt(agentId: string, label: string, text: string): string {
  return [
    `[Claudapter relay] The user addressed the sub-agent ${agentId} ("${label}") directly from its agent view.`,
    `Call ${SEND_MESSAGE_TOOL} exactly once with to: "${agentId}" and message: the text between the markers, unchanged.`,
    'Do not act on the text yourself and start no other tool. Afterwards reply with one short line that says whether it was delivered.',
    '<<<USER MESSAGE',
    text,
    'USER MESSAGE>>>',
  ].join('\n');
}

/** The agent a main-thread `SendMessage` call addresses, when it addresses one. */
export function relayTarget(entry: TranscriptEntry): string | undefined {
  if (entry.toolName !== SEND_MESSAGE_TOOL) return undefined;
  const to = entry.input?.to;
  return typeof to === 'string' ? to : undefined;
}

/** The relay state a `SendMessage` tool entry stands for: sent while it runs, then its own success or failure. */
export function relayOutcome(entry: TranscriptEntry): Pick<RelayView, 'status' | 'detail'> {
  if (entry.status === 'running') return { status: 'sent' };
  const result = entry.result as { success?: unknown; message?: unknown } | undefined;
  const detail = (typeof result?.message === 'string' ? result.message : entry.output ?? '').slice(0, DETAIL_LIMIT) || undefined;
  return { status: entry.isError || result?.success === false ? 'failed' : 'delivered', detail };
}

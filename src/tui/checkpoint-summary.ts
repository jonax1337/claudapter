const EXCERPT_LIMIT = 160;

export function checkpointExcerpt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LIMIT ? flat.slice(0, EXCERPT_LIMIT - 1) + '…' : flat;
}

/**
 * The `/compact` command that summarizes the conversation with the detail focused on a checkpoint onward.
 * Claude Code's compaction covers the whole conversation: only the focus can be steered, so this approximates
 * the native "summarize from here" instead of reproducing its partial compaction.
 */
export function summarizeFromCheckpointCommand(prompt: string): string {
  return `/compact Keep the summary of everything before this user message short. Preserve the detail of the work that begins at and follows it: "${checkpointExcerpt(prompt).replaceAll('"', "'")}"`;
}

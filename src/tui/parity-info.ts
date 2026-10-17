// Account pages that open the official browser, and native features Claudapter's TUI deliberately does not imitate.

export interface OfficialPage {
  command: string;
  title: string;
  url: string;
  /** Plain statement of what the page does, shown in the confirmation. */
  summary: string;
}

export const OFFICIAL_PAGES: readonly OfficialPage[] = [
  { command: '/privacy', title: 'Privacy settings', url: 'https://claude.ai/settings/data-privacy-controls',
    summary: 'Your Claude account data and privacy controls. Available to the account owner after signing in on claude.ai.' },
  { command: '/upgrade', title: 'Plan and upgrade', url: 'https://claude.ai/upgrade',
    summary: 'Compare and change your Claude subscription plan. Claudapter never purchases or changes a plan.' },
];

export interface UnavailableFeature {
  command: string;
  title: string;
  reason: string;
}

const NATIVE_HINT = 'Run the native `claude` command (plain `claudapter` without `tui`) to use it. Claudapter does not hand this dialog to the native UI, and nothing was started.';

export const UNAVAILABLE_FEATURES: readonly UnavailableFeature[] = [
  { command: '/cloud', title: 'Cloud sessions, environments and teleport',
    reason: 'Pulling a cloud session into this terminal and choosing a cloud environment need a live claude.ai account service and its private session protocol.' },
  { command: '/artifacts', title: 'Artifacts',
    reason: 'The artifact selector is a native view of claude.ai artifacts that the Agent SDK does not expose.' },
  { command: '/ide', title: 'IDE integration and onboarding',
    reason: 'IDE onboarding installs and pairs an editor extension. It needs a running IDE and cannot be completed from this terminal interface.' },
  { command: '/voice', title: 'Voice dictation',
    reason: 'Voice input needs microphone capture and the claude.ai speech service, which this interface does not provide.' },
  { command: '/passes', title: 'Guest passes',
    reason: 'Guest passes are shown only to eligible accounts through a native view that has no SDK equivalent.' },
];

export function unavailableText(feature: UnavailableFeature): string {
  return `${feature.reason}\n\n${NATIVE_HINT}`;
}

export const confirmationText = (page: OfficialPage) =>
  `${page.summary}\n\n${page.url}\n\nThis opens your default browser. Claudapter sends nothing to the page and reads nothing back.`;

export interface ReferenceRow { label: string; value: string }
export interface ReferenceSection { title: string; rows: ReferenceRow[] }

/** Guided tour shown by /tutorial; every command named here is registered in the palette. */
export const TUTORIAL_SECTIONS: readonly ReferenceSection[] = [
  { title: 'Talk to Claude', rows: [
    { label: 'Enter', value: 'Send the prompt. Shift+Enter or a trailing backslash adds a line.' },
    { label: '@ path', value: 'Mention a file; Tab completes it.' },
    { label: '/', value: 'Commands, skills and settings. Ctrl+P opens the full palette.' },
    { label: '/btw question', value: 'Ask a side question while Claude works. It does not join the conversation.' },
  ] },
  { title: 'Stay in control', rows: [
    { label: 'Esc', value: 'Interrupt the running turn. Tools that already ran are not undone.' },
    { label: 'Shift+Tab', value: 'Cycle the permission mode: ask, edit, plan.' },
    { label: '/rewind', value: 'Restore files or branch the conversation at an earlier checkpoint.' },
    { label: '/cd <path>', value: 'Move the session to another project; you confirm trust for new projects.' },
  ] },
  { title: 'Make it yours', rows: [
    { label: '/vim', value: 'Switch the prompt between the default editor and Vim modes.' },
    { label: '/keymap', value: 'Every shortcut, generated from what is registered right now.' },
    { label: '/theme, /keybindings', value: 'Appearance and your own shortcuts.' },
    { label: '/settings', value: 'Default model, per-model effort and fallback rules.' },
  ] },
  { title: 'Know your limits', rows: [
    { label: '/usage', value: 'Provider quotas and routed token counts.' },
    { label: '/context', value: 'What fills the context window.' },
    { label: '/cloud /artifacts /ide /voice', value: 'Not available here. They explain why and point to native `claude`.' },
  ] },
];

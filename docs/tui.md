# Claudapter TUI

Start the optional interface with `claudapter tui`. Native Claude Code remains
the default for `claudapter`. Both use the installed Claude engine and the same
Claudapter gateway; the TUI does not implement a second tool-execution loop.

```powershell
claudapter tui -- --model gpt-6.1-sol --permission-mode default
claudapter tui -- --resume
claudapter usage --refresh
claudapter usage --json
```

## OpenTUI migration status

`claudapter tui` now launches the bundled OpenTUI/Solid interface using Bun
>=1.3.14 on PATH. Native `claudapter` still uses Node and does not load the UI.
Developers also need Bun to build the UI bundle. Source attribution is in
[OpenCode provenance](opencode-provenance.md).

The new interface includes a two-tone block-glyph logo, centered dialogs over a
dimmed backdrop, a searchable command palette with descriptions, and controller-backed
command actions. The composer offers slash-command suggestions (↑↓ select, tab
complete, enter run, esc dismiss), prompt history on ↑/↓ from an empty prompt, and a
permission-mode badge with model and provider. Below it, a status bar shows an
animated scanner, elapsed time and `esc interrupt` during a turn, and context usage
otherwise. Command errors appear as a dismissing toast. Themes: midnight, ocean,
ember, daylight, terminal and contrast (`/theme`). The historical details below describe
the earlier Ink implementation and are not a blanket parity claim for the new UI.
Frozen selection during streaming, styled Markdown fidelity, theme coverage and every
administrative interaction still require full acceptance. The earlier Ink source
remains temporarily for regression comparison, not as a public mode.

## Branded interface

An empty conversation shows an original five-row CLAUDAPTER wordmark when the
terminal has enough space, with a compact fallback for small windows. Conversation
history replaces the large banner while the project header stays visible. The
composer has an empty-state hint, menus have a framed surface and highlighted
selection, and transcript/code colors follow the selected palette. Existing
shortcuts, permission defaults and engine configuration are unchanged.

## Everyday controls

Enter sends a prompt. Shift+Enter or Ctrl+J inserts a newline. Ctrl+P opens the
searchable command palette. F2 opens models, F3 agents, F4 usage and F6 themes.
Drag with the left mouse button over transcript text to select it, then press
Ctrl+C to copy. Selection is highlighted and freezes the visible transcript while
new output arrives. Escape clears it; scrolling clears it and continues browsing.
Without a selection Ctrl+C retains its interrupt/exit behavior. Mouse-wheel
scrolling remains enabled, with no mode switch required.
PageUp/PageDown and the mouse wheel scroll the transcript, usage and context
panels. Browsing history stays anchored while new output arrives; End (with an
empty composer) returns to live output and Home goes to the beginning.
Ctrl+T or `/tasks` opens the agents & workflows tree: native sub-agents,
workflows, shells and monitors with status, elapsed time, progress summaries,
details, agent transcripts (t) and stopping (x). While they run, a live strip
above the composer shows each task tree, and the status bar summarizes them
("◉ 2 agents · ⛓ 1 workflow"); clicking that chip opens the panel.

Sub-agents never stream into the main transcript. Each agent launch is one
live row there (status, type, the model and provider the gateway actually
routed it to, fallback reason, elapsed time, tokens, last action); the agent's
text, thinking, tool calls and results are captured into its own view whether
or not it is open. A tab strip above the composer ("main · ● Explore · ✗
general-purpose") switches views: Alt+←/→ cycles, Alt+0…9 picks, `/agent` lists
them, `o` in the Ctrl+T panel or a click on a summary row opens one, and Esc
returns to the previous view. In an agent view the composer addresses that
agent and Ctrl+B moves a foreground agent to the background. Claude Code
2.1.301–2.1.302 has no host request that writes into a sub-agent's
conversation, so Claudapter asks the main agent to call `SendMessage` (a main
turn); the view then shows the call's own outcome: queued for a running agent's
next tool round, a finished agent resumed, or the engine's refusal, for
example for agents you stopped. Sessions without the `SendMessage` tool show
the agent composer as unavailable. Stopping an agent (x in Ctrl+T) never
interrupts the main turn.
`/details` expands or collapses tool inputs/output; failed tools keep their
error details visible. Assistant Markdown supports inline emphasis/code, lists,
quotes, links and fenced blocks; tables use labelled rows on narrow terminals.
Routine hook starts/successes live under `/hooks` → Recent hook activity, not
in the conversation. Hook failures remain visible. `/permissions` offers a
session mode picker without implicitly enabling unrestricted execution.
Escape closes
an overlay; Ctrl+C interrupts work, or twice while idle exits. Permission and
trust dialogs default to decline. Questions support choices, multi-selection
and a typed answer; Tab moves between fields and the final decision.

`/theme` offers Midnight, Ocean, Ember, Daylight (light), Terminal and Contrast and
previews each one while you browse; Esc restores the saved theme. Every theme is
checked for WCAG contrast (text 7:1, secondary and status text 4.5:1, also after
256-color degradation). `NO_COLOR` switches to a hue-free palette, terminals that
report only 16 colors (`TERM=linux`, `FORCE_COLOR=1`) get an ANSI-only palette, and
`CLAUDAPTER_REDUCED_MOTION=1` freezes spinners, scanners and dialog fades. Press `?`
on an empty prompt for the keyboard shortcut overview. The home screen shows which
providers are usable (Claude, ChatGPT, Z.ai in their identity colors; `○ sign in`
when every model of a provider lacks credentials) and up to three recent sessions,
which resume on click. `/keybindings` changes
Claudapter shortcuts. `/favorite` stars models. These preferences live only in
`CLAUDAPTER_HOME/ui.json`; native colors and keybindings are untouched.

## Implemented own surfaces

| Surface | Behavior |
| --- | --- |
| `/model`, `/effort`, `/output-style` | Session selection, account catalog refresh and preserved native policy |
| `/usage`, `/context` | Graphical quota and context panels: meter bars, reset countdowns, routed request tokens, context categories, memory/MCP breakdown |
| `/agents`, `/tasks` | Explicit native delegation, follow-up, agents & workflows tree with transcripts and stopping |
| `/resume`, `/clear`, `/fork`, `/rename`, `/history` | Native saved sessions and composer recall |
| `/rewind` | Native file preview/restore and conversation branching; original session retained |
| `/export`, `/copy` | Native transcript export to a new file; last assistant answer to clipboard |
| `/attach`, `/attachments` | Explicit image/text attachments and removal before sending |
| `/diff`, `/add-dir` | Graphical workspace diff browser (file list, per-file review, untracked) and confirmed session-only additional file access |
| `/plan` | View native plan; enter/leave plan mode without auto-accepting tool permissions |
| `/settings`, `/setup`, `/fallback` | Defaults hub: default model, per-model reasoning effort and structured fallback-rule editing (create/edit/toggle/delete) with explicit confirmation |
| `/config`, `/permissions` | Session overlays and explicitly scoped native rule editing |
| `/mcp`, `/plugins`, `/skills` | Status, lifecycle, native configuration and OAuth forms |
| `/hooks`, `/memory` | Native discovery and scoped edits; Markdown edits preserve a recovery backup |
| `/status`, `/doctor`, `/login` | Native diagnostics and explicit official account sign-in |
| `/sandbox`, `/chrome`, `/remote-control` | Native capabilities and confirmed controls, subject to platform/account policy |
| Trust, tool permission, AskUserQuestion, MCP elicitation | Own dialogs; cancellation and request identity retained |
| 15 declared native dialog kinds | Validated own rendering, including network/terms/usage consent; unknown kinds cancel |

Administrative forms show the exact action and chosen scope before a persistent
change. Native writers enforce policy and stale IDs. Reload/restart after saved
plugin, hook or settings changes when the engine requires it. OAuth opens the
official browser flow and keeps its codes out of the transcript. No login,
remote connection or paid fallback is activated merely by opening the TUI.

## Context and usage semantics

GPT capacity comes from valid `max_context_window` in the existing Codex account
catalog, falling back to `context_window`. The observed local maximum is 872,000
tokens. The native engine receives temporary per-model windows. Recognized
Claude models keep their native windows; additional providers use the explicit
configured capacity. Unrepresentable mixed capacities fail clearly instead of
advertising an incorrect limit. Catalog ceilings do not guarantee successful
near-limit generation; the engine still reserves output/compaction space.

`/usage` in **this TUI** shows Claude and ChatGPT quota windows from their actual
accounts and token usage measured at the gateway, with the actual routed model
and agent. Compatible providers without a quota adapter remain visible as
unknown. Quotas have provider-defined scope and are not summed. Missing usage is
not zero, cache/reasoning counts are subsets, and dollar prices are unknown.
The native Claude `/usage` screen remains native and is not relabeled.

Gateway sessions save bounded, nonsecret accounting under `CLAUDAPTER_HOME/usage`.
CLI usage shows active gateways and the ten most recent saved gateway sessions.
It does not reconstruct traffic from before this release or from other clients.

## Compatibility and remaining work

The public SDK handles tools, streaming and session operations. Some native
special dialogs require private methods, pinned to SDK **0.3.301** and installed
Claude Code **2.1.301 or 2.1.302**. Those methods refuse an unknown version. This is tested
compatibility, not an upstream guarantee.

Full native feature parity is **not complete**. Triage and status of each gap are in
[parity-plan.md](parity-plan.md). Own flows now exist for side questions (`/btw`),
`/cd` (with settings revalidation and renewed trust), an optional Vim mode with a kill
ring and safe paste (`/vim`), a checkpoint summary approximation, `/account`, `/privacy`
and `/upgrade` (browser only after confirmation), `/keymap` and `/tutorial`. Cloud,
environment, artifact selectors, IDE onboarding, voice and passes remain native-only; their
commands (`/cloud`, `/artifacts`, `/ide`, `/voice`, `/passes`) only explain that and never
hand the dialog to the native UI. True partial checkpoint compaction is not available.
Native sandboxing is unavailable on the tested Windows host. Successful external OAuth, connected-browser selection and
remote activation need interactive acceptance with those services.

Native auto permission mode can require a safety-classifier model that the
external-model gateway does not support. Use the explicit default/manual mode
shown above for the tested GPT approval flow. Existing permission modes are
preserved; Claudapter never silently disables the classifier or grants access.

Unsupported native JSX dialogs are canceled with no native-UI handoff. An
unavailable dialog is not counted as an implemented feature. See
[SDK evidence](sdk-parity.md), [administration evidence](admin-evidence.md),
[context evidence](context-evidence.md) and [release verification](verification.md).

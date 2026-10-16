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

## Everyday controls

Enter sends a prompt. Shift+Enter or Ctrl+J inserts a newline. Ctrl+P opens the
searchable command palette. F2 opens models, F3 agents, F4 usage and F6 themes.
PageUp/PageDown scroll the transcript, usage and context panels. Escape closes
an overlay; Ctrl+C interrupts work, or twice while idle exits. Permission and
trust dialogs default to decline. Questions support choices, multi-selection
and a typed answer; Tab moves between fields and the final decision.

`/theme` offers Midnight, Ocean, Terminal and Contrast. `/keybindings` changes
Claudapter shortcuts. `/favorite` stars models. These preferences live only in
`CLAUDAPTER_HOME/ui.json`; native colors and keybindings are untouched.

## Implemented own surfaces

| Surface | Behavior |
| --- | --- |
| `/model`, `/effort`, `/output-style` | Session selection, account catalog refresh and preserved native policy |
| `/usage`, `/context` | Separate account quotas, routed request tokens and effective engine capacity |
| `/agents`, `/tasks` | Explicit native delegation, follow-up, task output and stopping |
| `/resume`, `/clear`, `/fork`, `/rename`, `/history` | Native saved sessions and composer recall |
| `/rewind` | Native file preview/restore and conversation branching; original session retained |
| `/export`, `/copy` | Native transcript export to a new file; last assistant answer to clipboard |
| `/attach`, `/attachments` | Explicit image/text attachments and removal before sending |
| `/diff`, `/add-dir` | Safe Git review; confirmed session-only additional file access |
| `/plan` | View native plan; enter/leave plan mode without auto-accepting tool permissions |
| `/fallback` | Inspect, edit/confirm allowlisted rules and reset the current main cooldown |
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
Claude Code **2.1.301**. Those methods refuse an unknown version. This is tested
compatibility, not an upstream guarantee.

Full native feature parity is **not complete**. Cloud/environment/artifact
selectors, IDE onboarding, voice, account privacy/upgrade/passes, side questions,
tutorial/demo panels, advanced editor/Vim behaviors and full checkpoint
summarization still lack equivalent own flows. `/cd` needs coordinated gateway
revalidation and session relocation. Native sandboxing is unavailable on the
tested Windows host. Successful external OAuth, connected-browser selection and
remote activation need interactive acceptance with those services.

Native auto permission mode can require a safety-classifier model that the
external-model gateway does not support. Use the explicit default/manual mode
shown above for the tested GPT approval flow. Existing permission modes are
preserved; Claudapter never silently disables the classifier or grants access.

Unsupported native JSX dialogs are canceled with no native-UI handoff. An
unavailable dialog is not counted as an implemented feature. See
[SDK evidence](sdk-parity.md), [administration evidence](admin-evidence.md),
[context evidence](context-evidence.md) and [release verification](verification.md).

# Release candidate checklist

Evidence: `docs/verification.md`. Check items only after verification; record blocked and untested cases explicitly. M1–M5 below preserve the original 0.1.0-rc.1 evidence; they do not imply that every flow has been rerun for the 0.2.0 extension.

## OpenCode UI adoption
- [x] Pin upstream source and retain MIT provenance; adapt home, composer, viewport and dialog structure.
- [x] Bun/OpenTUI Windows renderer, responsive ASCII logo, Solid controller state bridge.
- [x] Command palette and existing controller/admin action integration; native launch unchanged.
- [x] Bundle build, external package install, real model selection and short response, mouse copy/paste-back.
- [x] Ten UI tests plus 159 existing tests passing (5 skipped); TypeScript checks.
- [x] Chat message layout adapted: user rail, native Markdown assistant text, reasoning rail, inline tool rows with summaries, error rail. Fixture frames only; not yet seen live.
- [ ] Remaining upstream session features: diff/edit/write block tools, inline permission rows, images, sub-agent groups and complete interaction parity.
- [ ] Live approval/elicitation, resize, wheel, selection-during-streaming, resume and interruption acceptance.
- [ ] Theme/Markdown fidelity, removal of superseded Ink code after parity, packed public `claudapter tui` entry verified.
- [ ] Release candidate approval; the migration is not fully accepted.

## Selection and version compatibility fixes
- [x] Visible transcript drag selection and Ctrl+C copy without removing wheel scrolling.
- [x] Actual Windows Terminal drag/copy/paste-back verified; Unicode and streaming regression tests.
- [x] Explicit CLI 2.1.302 compatibility with real isolated readers and native writer tests.
- [ ] Live OAuth and all native dialog variants on 2.1.302; not implied by reader tests.

## Branded Ink shell
- [x] Original responsive welcome banner, compact project header and composer hint.
- [x] Shared palette/Ink UI spinner theme, framed menus and selection highlight.
- [x] Shared shell/scroll dimensions; 157 tests passed, 5 skipped.
- [x] Actual Windows Terminal error surface and Ctrl+P palette visually inspected.
- [ ] Connected welcome/chat visual acceptance: inherited base URL blocked startup.
- [ ] Expanded visual acceptance and updated packed installation; not a release candidate.

## TUI presentation follow-up
- [x] Routine hook lifecycle moved out of chat; failures retained and hook activity inspectable.
- [x] Markdown spans, compact tool summaries, simpler framing and permission-mode picker.
- [x] Anchored transcript browsing, mouse-wheel input and paging covered by isolated renderer tests.
- [x] Typecheck and isolated suite: 152 passed, 5 skipped; packed CLI installed outside checkout.
- [ ] Real Windows terminal visual, wheel, resize and terminal-cleanup acceptance.
- [ ] Installed updated TUI live-session acceptance; not yet a verified release candidate.

## M1: real protocol spike
- [x] Read the entire mandate; inventory installed tools and reference license.
- [x] Verify current official Claude/Codex interfaces and inspect reference transport.
- [x] Independent launcher; live native Claude -> GPT -> Claude switch with tool cycle.
- [x] Claude main -> native GPT subagent -> result; follow-up/resume and request attribution.
- [x] Establish safe replay boundary and native retry ownership before fallback design.

## M2: independent implementation
- [x] Pure translation with regression tests; no Rookery runtime dependency.
- [x] One strict model/capability registry; provider contracts and credential isolation.
- [x] Scoped opt-in fallback rules, retries, timeouts, cooldown and reset.
- [x] Bounded authenticated loopback HTTP, cancellation, redacted diagnostics.
- [x] Isolated unit and transport tests, including malicious/unknown inputs.

## M3: daily use
- [x] Setup, models, providers, provider add, doctor, native argument passthrough.
- [x] Optional GPT agents, additive manifest and read-only live discovery/refresh.
- [x] Preserve settings, explicit settings, hooks, skills/plugins, MCP, permissions and resume.
- [x] Concurrent sessions, credential refresh strategy, Windows cleanup and paths with spaces. Refresh is officially owned by Codex; Claudapter only rereads unexpired file credentials.
- [x] Explicit Anthropic-compatible provider, fixture tested.

## M4: compatibility and failures
- [x] Tool IDs/results, long-input bounds, images and usage; unsupported thinking/content fails explicitly. Real model-switch continuation remains in M1.
- [x] Expired auth, 429, outage, malformed/partial streams, dropped connection and cancellation.
- [x] Disabled fallback, allowed chains, cooldown/reset, exhaustion, capability refusal and scope isolation.
- [x] No replay after content/tool output; auth, billing, refusal and invalid requests never trigger fallback.
- [x] Claude-only and ChatGPT-only; actual identity and updated session awareness.
- [x] Native interactive controls, /model persistence, resume, subagent follow-up, preserved extensions.

## M5: local release
- [x] Build and pack; install tarball outside checkout; run installed artifact with live GPT and MCP discovery.
- [x] Windows/macOS/Linux CI configured (remote execution not performed).
- [x] English install/config/auth/fallback/agent/security/troubleshooting/uninstall docs and demo.
- [x] Factual compatibility matrix, final tests and live evidence with explicit gaps.

## 0.2.0-rc.2 extension: optional TUI, usage and maximum context

The user's subsequent instruction extends the original native-only brief and
permits development subagents for this task. Native mode remains the default.
Checked implementation/fixture items below do not substitute for the separate
live acceptance and packaged-install gates.

- [x] Replace the historical proposal with the implemented architecture and explicit parity boundaries in `docs/tui-concept.md`.
- [x] Share session preparation between the native launcher and optional `claudapter tui`; explicitly select the installed Claude executable through the pinned SDK.
- [x] Select validated catalog maxima, preserve default/max provenance, and apply native per-model windows. Installed-engine calculations verify 872K/272K external windows and unchanged recognized Claude context.
- [x] Add actual-provider/model/agent usage accounting, attempt deduplication, unknown partial usage, provider quota snapshots and `claudapter usage` text/JSON reports.
- [x] Implement streaming chat, tool output, multiline Unicode editing, attachments, prompt history, model/agent/task panels and theme presets.
- [x] Implement favorites and validated shortcuts in atomic Claudapter-owned preferences; preserve native preferences.
- [x] Implement own permission, user-question and MCP-form dialogs with cancellation, typed validation and scoped session approval tests.
- [x] Implement native session resume/clear/fork/checkpoint/export controls; regression-test initial-prompt single delivery and launch-selector cleanup.
- [x] Implement own settings, permissions, MCP, plugin, skill, hook, memory and diagnostics controls with explicit persistent-change scope and guarded native compatibility.
- [x] Require explicit workspace trust, use a minimal native handshake, and regression-test rejection/close/discovery races without real credentials.
- [x] Keep fallback opt-in and reject unsafe response replay; invalidate cooldown routing when policy authorization is removed.
- [x] Update install guidance for SDK dependencies and `--omit=optional`; no bundled-engine substitution or Rookery dependency.
- [x] Record 152 passing tests, build, tarball, outside-checkout installation and global 0.2.0 command verification.
- [x] Live TUI tool/agent/question acceptance; installed artifact edit/test, explicit allow/deny, effective 872K context, CLI usage and own-session resume.
- [ ] Repeat Claude→GPT→Claude, agent follow-up and cross-interface resume against 0.2.0 after the real Claude limit resets; prior live evidence is from 0.1.
- [ ] Verify real external OAuth completion, browser-device selection and Remote Control beyond fixtures/entry-point validation.
- [ ] Verify real near-maximum conversations and simultaneously active agents with different context capacities.
- [ ] Verify additional compatible-provider accounts and macOS/Linux interactive terminal behavior.
- [ ] Reach complete native parity: voice, cloud/teleport, artifacts, full IDE onboarding, working-directory changes with renewed trust and advanced editor interactions remain incomplete or unverified.

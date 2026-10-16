# Release candidate checklist

Evidence: `docs/verification.md`. Check items only after verification; record blocked and untested cases explicitly. M1–M5 below preserve the original 0.1.0-rc.1 evidence; they do not imply that every flow has been rerun for the 0.2.0 extension.

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

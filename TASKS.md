# Release candidate checklist

Evidence: `docs/verification.md`. Check items only after verification; record blocked and untested cases explicitly. M1–M5 below preserve the original 0.1.0-rc.1 evidence; they do not imply that every flow has been rerun for the 0.2.0 extension.

## Multi-account profiles and account rotation (0.2.0-rc.5)
- [x] Profile slot lifecycle: `claudapter profile add|login|list|remove|default` wizard with official `claude auth login`/`codex login` flows, separate Claude/Codex homes under `~/.claudapter/profiles`, reserved/invalid names rejected, interactive confirmation before destructive removal.
- [x] Launch selection: `--profile <name>|none` (CLI and TUI) and optional default profile; activation fails loudly on conflicting `CLAUDE_CONFIG_DIR`/`CODEX_HOME` instead of switching accounts silently; `profile` subcommands stay usable with a broken default.
- [x] Account routing: `sonnet@<profile>` style ids resolve only on Claude bases, keep native headers and context handling, send with the profile's read-only OAuth token (unexpired file credentials only; official CLI owns refresh), and appear in `/model` with an honest description.
- [x] Rotation: account ids work as explicit fallback targets with the existing cooldown/notice/reset machinery; missing/expired account credentials stop with 401 plus recovery command; quota windows for accounts stay unknown so pre-emption never skips them.
- [x] Tests: 11 new profile tests (lifecycle, activation conflicts, credential states, id resolution, registry aliases, flag extraction, gateway account routing, fallback switch and reset, credential failure isolation); node suite 265 passed / 0 failed / 5 skipped, bun TUI suite 204 passed; TypeScript checks clean. Fixed a pre-existing parallel-run flake in the parity-native trust-dialog test (fixed 20 ms sleep → bounded poll).
- [x] Packaging: 0.2.0-rc.5 packed from the checkout, installed globally outside it with `--omit=optional`; `claudapter --version`, `--help` profile lines and `profile list` verified from the installed artifact.
- [ ] Live acceptance: a real second Claude account (profile login, one `sonnet@<profile>` turn, one real-limit rotation) — no second account was available during this run; current evidence is fixture-only for account routing.

## TUI parity push: transcript, native parity, fallback UX, sub-agents, polish (in progress)
- [x] Transcript parity: diff/edit/write blocks with tree-sitter highlighting and collapse, Bash/Read/Grep/Web rows, TodoWrite checklist, recorded permission rows, image rows with open/copy, fenced-code blocks, tables and wide-character-safe cell-width helpers (`layout.ts`), plus `slots` extension points. Fixture tests only.
- [x] Native parity: `/btw` side questions, `/cd` with revalidation and trust renewal, Vim mode, kill ring and paste handling, `/account` `/privacy` `/upgrade` `/keymap` `/tutorial`, honest native-only dialogs; triage in `docs/parity-plan.md`.
- [x] Fallback UX: typed route notices (switched/recovered/exhausted/interrupted/unprotected) without secrets, toast + transcript marker + per-turn badge + status countdown, user-initiated alt+r/b/p/f recovery, guided fallback setup with presets and dry run; replay after output stays blocked (gateway tests).
- [x] Sub-agent isolation: `parent_tool_use_id` frames partitioned into per-agent streams with full capture, summary row, tab strip, navigation, addressed composer via the SendMessage relay, independent stop and Ctrl+B backgrounding; regression test proves no sub-agent text reaches main; bridge per-row reconcile (~25x faster at 2,000 entries).
- [x] Visual polish: six contrast-tested themes with 256/16/`NO_COLOR` degradation, provider colors, shared motion timers, fuzzy-match highlighting, home provider/recent-session overview, `?` shortcut overlay, layered Esc semantics.
- [x] Reviews: security review clean (no high/critical); its three findings fixed with tests (image temp cleanup on close, interrupted-fingerprint cap, steer/updateFallback target-auth refusal). Integration reviewer lost to repeated upstream API errors; coordinator re-verified the bridge entry-replacement assumption across mutation paths; Esc/Alt ordering stays on the live list.
- [x] Integrated suites (final): `npm run check` 0 errors; node suite 254 passed / 0 failed / 5 skipped of 259; bun suite 204 passed across 10 files.
- [ ] Live acceptance: fallback visibility and one-key recovery on a real limit, agent relay delivery and resume, a successful `/btw` answer, alt-key chords in Windows Terminal, themes/colors/`?`/Esc, resize during a busy turn.
- [ ] Decisions and follow-ups: remove the superseded Ink TUI and its Ink/React dependencies (needs approval), dedupe main-stream handling against `LiveTranscript`, drop the duplicate agent line in the TasksStrip, unused-export cleanup.
- [x] Packed artifact rebuild and outside-checkout install test: 0.2.0-rc.4 packed from the committed checkout (commit 5155b90), installed globally from a temp directory with `--omit=optional`; `claudapter --version` returns 0.2.0-rc.4. Interactive TUI run performed 2026-10-17 (see verification.md): trust dialog, home view, live Z.AI glm-5.3 turn, command palette, clean Ctrl+C exit.

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

## Session recovery, usage graphics, tasks display, zAI and quota pre-emption
- [x] Recover the interrupted migration: finish app wiring (StatusBar segments, TasksStrip, scroll ref), fix Windows test glob, finish prompt-recall and fuzzy-ranking TDD leftovers; 178 Node tests plus 64 OpenTUI tests green.
- [x] Graphical `/usage` panel (meter bars, reset countdowns, per-model token accounting, r refresh) replacing the JSON dump, with fallback to the view dialog for reduced hosts.
- [x] Native sub-agent and workflow display: task folding from `task_*`/`background_tasks_changed`, live strip above the composer, status chip, Ctrl+T tree panel with details, agent transcripts and stop; `agentProgressSummaries` enabled; inline agent frames retained.
- [x] Z.ai provider preset `claudapter provider add zai` with the documented Anthropic-protocol endpoint and GLM-5.3 / GLM-5.3-Flash capabilities; preset contract and merge tests.
- [x] Quota pre-emption: enabled fallback rules skip a target whose fresh quota window reports ≥95% usage before sending; last target always attempted; background read-only quota refresh bounded to once per minute; gateway regression tests for skip/no-skip/stale/final-target.
- [ ] Live Windows Terminal acceptance of the usage panel, tasks strip/panel with a real workflow or sub-agent turn, zAI live inference and a real near-limit pre-emptive switch; packed artifact rebuild.

## Graphical data views, settings hub and rc.3 install
- [x] Packed and installed 0.2.0-rc.3 globally (outside-checkout tarball); `claudapter --version` and `providers` verified from the temp directory before the UI work, reinstalled with all features at the end.
- [x] Graphical `/context`: model/catalog capacity, active-window meter, stacked category bar (used/buffer/deferred), memory and MCP token breakdown; fixture-frame test.
- [x] Graphical `/diff`: unified-patch parser (per-file, deletion naming, hunk numbering, marker immunity) plus a file-list → per-file review browser using the existing DiffView; parser and render tests.
- [x] `/settings` (also `/setup`, `/fallback`): defaults hub panel with default model, per-model reasoning effort and structured fallback-rule editing (create/edit/toggle/delete, prefilled option forms, explicit confirmation); replaced the raw JSON-textarea rule editor.
- [x] Config extension `model` + `modelEffort` with strict validation; applied at session start (`Options.model`/`Options.effort`) and on model switch (`applyFlagSettings`); controller setters save through `validateConfig`/`saveConfig`.
- [ ] Live acceptance of `/settings` flows with a real engine and saved-configuration reload; rc.3 packed artifact interactive run.

## TUI visual polish (OpenCode look)
- [x] Central theme palettes; all components themed; two-tone block-glyph logo and tagline; home footer with location and status.
- [x] Centered 60/88-column dialogs over a dimmed backdrop for palette, menus, confirmations, forms and permission prompts.
- [x] Composer: slash-command suggestions with descriptions, prompt history, permission-mode badge, model and provider.
- [x] Status bar: scanner with elapsed time and `esc interrupt`, connection states, context meter; error toast.
- [x] Fourteen UI tests plus existing suite (160 passed, 5 skipped); TypeScript checks. Fixture frames only.
- [ ] Live Windows Terminal visual acceptance of colors, backdrop, scanner and esc-interrupt during a real turn.

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

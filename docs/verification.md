# Release candidate verification

Verification date: 2026-10-16, Windows, PowerShell, Node.js 24.20.0,
Claude Code 2.1.301, Codex CLI 0.163.0. This file separates observed behavior
from protocol documentation and remaining limitations. No external publication
or remote CI execution occurred.

## OpenCode UI adoption — 2026-10-17 (in progress)


- Live chat session, Windows Terminal, `bun dist/tui/opencode.js` from a disposable
  untrusted folder: trust dialog → project trust recorded → prompt → `✓ Read` row →
  Markdown answer → `Ready`; one Ctrl+C exited and left a normal prompt. A defect found
  only live: the trust handshake used a `cwd` whose Windows path case differed from the
  trusted directory, so Claude Code silently recorded nothing and startup failed with
  "did not acknowledge workspace trust". Reproduced with the SDK directly (differing case
  → `workspace_trust_recorded=false`, identical → `true`); fixed in `controller.start`
  and covered by a regression test (fixtures could not catch it).
- Not exercised: the own tool-approval dialog (a Write was rejected by a GateGuard hook
  from the user's native configuration before any prompt), resize, wheel, resume and
  mid-stream interrupt. The assistant text appeared twice once in that rejected turn;
  unexplained, not yet investigated.

- Visual polish (2026-10-17): fixture-rendered character frames inspected for home
  (block logo, centered composer, footer), session (rails, tool icons, status bar with
  scanner, `esc interrupt` and context meter), centered palette and permission dialog,
  and composer suggestions. `npm test`: 160 passed, 5 skipped; `npm run test:tui`: 14
  passed. Colors and the backdrop are not visible in character frames; live terminal
  acceptance is still open.

- Upstream pinned at `07bbd0fd…`; see `opencode-provenance.md`. Bun 1.4.3 on
  Windows runs the OpenTUI 0.6.6 renderer; OpenTUI requires Bun ≥1.3.14 or
  Node ≥26.4 with experimental FFI, so the TUI uses Bun while native stays on Node 24.
- Observed: the packed tarball, installed outside the checkout, started the bundle,
  rendered the ASCII logo and command palette, switched model, sent one short
  prompt (reply "OK") and returned to Ready. Mouse selection, Ctrl+C copy and
  paste-back into the composer worked. `npm audit --omit=dev` on that install: 0 findings
  (Solid is compiled into the UI bundle because npm does not apply package overrides to consumers).
- Defects found only by this outside-checkout run and fixed: vulnerable Solid
  resolved in consumer installs; backend module paths relocated by bundling;
  status row overpainted by a long transcript.
- Tests: 9 OpenTUI tests (fixture controller) plus 159 existing passing, 5 skipped.
  Fixture success is not live verification.
- Not verified: live tool approval/elicitation, resize, wheel, selection during
  streaming, resume, interruption, upstream message renderer parity, and the final
  `claudapter tui` entry from the packed install.


## Recovery, usage panel, task display, zAI preset and quota pre-emption — 2026-10-17
- The interrupted working tree (17 modified, 27 untracked files) was reconstructed:
  controller-side task folding, agent transcripts, sessions/picker, diff and
  permission views were complete; the session had stopped mid-wiring of
  `opencode/app.tsx` (missing scroll ref, StatusBar segments and the task strip)
  and mid-TDD (prompt-recall submit lacked an await; fuzzy ranking expectation
  conflicted with an undocumented haystack-length tiebreak, which was removed in
  favor of stable order). The Windows-invisible `test:tui` glob was replaced with
  an explicit file list.
- `npm run check`: TypeScript passes. `npm test`: **178 passed, 0 failed,
  5 skipped**. `npm run test:tui`: **64 passed** (includes the new usage-panel,
  task-strip and picker/recall tests). No live terminal session was run for the
  new surfaces; frames are fixture renders.
- `/usage` now opens a graphical panel (quota meter bars with warning/danger
  colors, reset countdowns, request-token totals per actual model/agent, `r`
  refresh, `end` scroll) instead of a JSON dump. Verified by a fixture-frame test
  at 100×30 including the scrolled totals section.
- Tasks display: `agentProgressSummaries` is enabled; a fixture App render shows
  the workflow strip (`⛓ spec`), sub-agent row (`◉ Review code · reviewer`) above
  the composer and the status chip `◉ 1 agent · ⛓ 1 workflow`. Controller folding
  tests cover lifecycle, kinds, background level replace semantics and tool links.
- Z.ai preset: `claudapter provider add zai` writes the documented
  Anthropic-protocol endpoint and GLM-5.3/GLM-5.3-Flash capabilities (verified
  against docs.z.ai on 2026-10-17); contract tests assert every preset passes
  `validateConfig` and that merges reject duplicates/empty selections without
  mutating config. No zAI key was configured and no zAI inference ran.
- Quota pre-emption: gateway tests with simulated upstreams prove a fresh ≥95%
  anthropic window routes directly to the fallback target with reason
  `quota_near_limit` and zero primary contacts; moderate (94%), reset-past and
  stale (>60s) windows keep the primary; a chain whose final target is exhausted
  still attempts it (quota telemetry never refuses). No live near-limit switch
  against a real account was performed.

## Graphical views, settings hub, rc.3 — 2026-10-17 (second session)

- Version bumped to 0.2.0-rc.3; tarball packed from the checkout and installed
  globally with `--omit=optional` before the feature work. From `%TEMP%`,
  `claudapter --version` returned 0.2.0-rc.3 and `claudapter providers` reported
  the real account states. `claudapter provider add` correctly refuses
  non-interactive terminals; the zAI wizard therefore remains to be run by the
  user in an interactive shell. Reinstalled after the features below.
- `/context` renders a graphical panel (catalog/engine capacity, active-window
  meter, proportional stacked category bar, compaction-buffer and deferred rows,
  memory-file and MCP-tool token breakdown). Verified by a fixture-frame test.
- `/diff` renders a file-list browser over a new `unifiedDiff` parser; enter
  reviews one file with the existing colored DiffView. Parser tests cover
  multi-file patches, `/dev/null` deletion naming, `--- `/`+++` header immunity
  and old/new hunk numbering.
- `/settings` (`/setup`, `/fallback`) opens a defaults hub: default model,
  per-model reasoning effort and structured fallback-rule editing through
  prefilled option/number forms plus an explicit confirmation. The previous raw
  JSON-textarea rule editor is gone. Decision forms gained an optional `initial`
  prefill; the null prototype of the value map is retained (`__proto__` key test
  still passes).
- Config schema: `model` and `modelEffort` validate strictly; controller tests
  cover setter round-trips (set/validate/reject/clear) through the isolated
  `CLAUDAPTER_HOME`. Session-start application (`Options.model`, `Options.effort`)
  and the model-switch effort reapplication are type-checked wiring, not yet
  observed against a live engine.
- Final suites after all changes: `npm run check` 0 errors; `npm test` **180
  passed, 0 failed, 5 skipped**; `npm run test:tui` **70 passed**. No live
  terminal session, real zAI inference or saved-config reload was performed.

## Live ConPTY walkthrough and focus defect — 2026-10-17 (third session)

- Computer Use could not be used for visual inspection (screenshots are not
  readable by this model), so the real TUI was driven through the repository's
  ConPTY harness (`test/terminal.py`, fixture homes, 160×42) and read back as
  text. This is a real terminal run, not a fixture render.
- Defect found only live: `/mcp`, `/status`, `/skills`, `/plugins` and other admin
  inspectors showed raw JSON in a Cancel/Confirm decision dialog. Replaced by a
  structured snapshot renderer (`snapshot-view.tsx`: sections, record lists with
  status chips, wrapped descriptions, nested fields, no duplicate titles); task,
  rewind, plan, remote-control, browser and shortcut data use it too.
- Second defect found only live: panels without an input (usage, context, tasks,
  settings, snapshot, diff) received no keys at all — Esc, arrows and even Ctrl+C
  were dead — because the composer editor keeps claiming keyboard input unless
  another input takes focus (menus work only because their search input does).
  Fixture tests could not show this. Fix: a zero-width focus-sink input in the
  shared `Dialog`, plus the composer reclaiming focus once it is enabled again.
- Observed live after the fix: `/mcp` → Inspect (graphical, Esc closes),
  `/usage`, `/context`, `/settings` (Enter opens the model menu), `/diff`,
  Ctrl+T tasks panel, `/status` (SESSION section) and `/skills`, each reopening
  correctly after the previous panel was closed. No inference was performed.
- Not verified: sub-agent/workflow rows with a real turn, resize and mouse.

## Selection and Claude Code 2.1.302 — 2026-10-17

- Left-drag transcript selection uses SGR button-motion reporting; wheel scrolling
  remains active. Ctrl+C copies a selection; without one it interrupts as before.
  Selected visible rows are frozen during streaming. Escape, resize and navigation
  clear the selection. Selection is limited to the visible transcript, not dialogs.
- Actual Windows Terminal drag highlight, Ctrl+C and paste-back into the composer
  succeeded on the startup-error transcript. Connected inference was not needed.
- Full suite: 159 passed, 0 failed, 5 skipped. Unicode/reverse selection and frozen
  streaming with subsequent wheel navigation have regression coverage.
- SDK 0.3.301 now explicitly accepts CLI 2.1.301 and 2.1.302. Unknown versions
  remain rejected; private method availability and payload validation remain.
- Real isolated 2.1.302 query initialization and settings/hooks/permissions/memory/
  skills/status/sandbox/plan/Chrome-status readers succeeded. Browser listing
  correctly refused a disconnected session. No inference or login was requested.

## TUI parity push: transcript, fallback, sub-agents, polish — 2026-10-17 (fifth session)

- Five parallel workstreams extended the OpenCode TUI: transcript block tools,
  native-parity panels, fallback UX, sub-agent isolation and visual polish.
  Everything below is fixture, mock or isolated-unit evidence; no live engine
  turn ran in this session.
- Transcript: edit/write/multi-edit diff blocks (native `<diff>`, tree-sitter
  styles, side-by-side from 120 columns, collapsed at 40 rows), Bash exit codes
  with expandable output, Read/Grep/Glob rows, WebSearch/WebFetch sources,
  TodoWrite checklist, recorded permission rows keyed by request id, image rows
  (open/copy, 8 MiB retention cap), fenced code with copy, tables and CJK
  wrapping. 61 transcript tests.
- Native parity: `/btw` via the private SDK control request (version-pinned,
  signal-only options); `/cd` validates settings, relocates and re-trusts —
  exercised against real CLI 2.1.302 with a fixture home and unreachable model
  endpoint (refusal, trust challenge, relocation, same-directory no-op); Vim
  mode (motions, counts, operators, text objects, visual, `.`, undo) with kill
  ring and paste handling; `/account` `/privacy` `/upgrade` (https allowlist,
  confirm before open, shell-less spawn); `/keymap` `/tutorial`; honest
  native-only dialogs. Checkpoint "summarize" is an approximation
  (whole-conversation `/compact`); no successful `/btw` answer was observed.
  Triage in `docs/parity-plan.md`.
- Fallback: `RouteNotice` schema (switched/recovered/exhausted/interrupted/
  unprotected) with per-agent scope; notices contain no tokens, prompt bodies
  or upstream error text (test-enforced); coalesced toast, per-turn markers and
  badges, status-bar countdown; alt+r/b/p/f recovery is user-initiated only;
  guided setup builds presets from signed-in models with capability warnings
  and a dry run. Replay after output stays blocked (gateway test asserts
  exactly one upstream request). Gateway 34/34, route-model 12, presets 4,
  route-views 6.
- Sub-agents: `parent_tool_use_id` frames partition into per-agent
  `LiveTranscript` streams (stream_event adoption, nested agents,
  resume-filtered history); a regression test proves no sub-agent text,
  thinking or tool use reaches the main transcript; summary row, tab strip,
  Alt+arrow/digit navigation, `/agent`, Ctrl+T `o` and click; the SendMessage
  relay surfaces the engine's own outcome; `stopTask` is independent; Ctrl+B
  backgrounds a foreground agent. `bridge.ts` reconciles per row: 200 streamed
  updates at 2,000 entries took 27 ms versus 670 ms before. 46 agent/controller
  node tests.
- Polish and layout: six themes with WCAG-checked token pairs including
  256-colour degradation; `NO_COLOR` greyscale and 16-colour fallback; provider
  colours; shared motion timers with `CLAUDAPTER_REDUCED_MOTION`; fuzzy-match
  highlighting; home provider chips and recent sessions with fixed heights;
  `?` overlay; layered Esc. Cell-width helpers (`layout.ts`: string-width,
  grapheme-safe truncate/pad) carry regression tests (CJK, emoji, ZWJ,
  surrogate safety, composed rows).
- Integrated results after all changes: `npm run check` 0 errors; `npm test`
  **254 passed, 0 failed, 5 skipped** of 259 (one skip is the
  `CLAUDAPTER_NATIVE_TEST`-gated admin test; new: image-cleanup and steer-auth
  tests); `npm run test:tui` **204 passed, 0 failed across 10 files** (the
  script now lists every bun suite). The Vim Esc layering (insert/visual Esc
  never interrupts a busy turn) has App-level regression tests.
- Read-only security review (2026-10-17, model-assisted, evidence per file
  and line) found no high or critical issues; route notices leak no tokens,
  bodies or upstream text, replay stays blocked by scope and body-fingerprint
  guards, fallback stays opt-in, the external-link allowlist and /cd trust
  flow held up. Its three findings were fixed and tested: saved image temp
  directories are now tracked and removed on controller close
  (`cleanupSavedImages`, node test); the gateway's interrupted fingerprint set
  is capped at 4096; `steer()` and `updateFallback` refuse targets that are
  not signed in, mirroring the preset message. An integration review agent
  was lost to repeated upstream API errors after covering the controller and
  agent-stream areas; the coordinator re-verified the bridge assumption
  (entry objects are replaced on change; only streamed text is appended in
  place; per-agent revision bumping) across all mutation paths without
  finding a break. The Esc/Alt-key ordering questions remain on the live
  acceptance list.
- Not verified live: a real fallback or quota event in the TUI, agent relay
  delivery and resume, a successful `/btw` answer, Alt-key chords in Windows
  Terminal, themes/colours/`NO_COLOR` in a real terminal, resize during a busy
  turn, and the packed artifact.
- 0.2.0-rc.4 release packaging (after commit 5155b90): `npm pack` from the
  clean checkout (prepack build included, 126 files), tarball moved to a
  fresh temp directory outside the checkout and installed globally with
  `--omit=optional`; `claudapter --version` from that directory returns
  **0.2.0-rc.4**. The interactive `claudapter tui` run itself was left to the
  user, so UI live acceptance remains open.
- All 16 admin tests passed with native writer testing enabled, using disposable
  homes. The native writer test uses a fixture query and the actual CLI writer;
  this is not live OAuth or every native-dialog end-to-end acceptance.

## Branded Ink shell — 2026-10-17

- Typecheck passed; final `npm test`: 157 passed, 0 failed, 5 skipped.
- Renderer tests cover the large welcome banner, transition to conversation,
  multiline drafts at 120x40, 100x30, 80x24 and 48x18, and existing approval,
  masking, cancellation and anchored-scrolling behavior.
- Actual Windows Terminal launch displayed the new header/composer and a startup
  error: inherited ANTHROPIC_BASE_URL conflicts with the gateway. Configuration
  was not changed to suppress this guard. Ctrl+P opened the new framed palette;
  its rendering and selection highlight were inspected in a desktop screenshot.
- Connected-session/banner visual acceptance, live resizing, theme screenshots,
  and an updated packed-artifact installation remain pending. No live inference
  or release-candidate claim is made for this change.

## TUI presentation follow-up — 2026-10-16

- `npm run check`: passed. `npm test`: 152 passed, 0 failed, 5 skipped.
- Added regression coverage for quiet successful hooks, independent hook IDs,
  visible failures, Markdown style spans/Unicode/unfinished fences, anchored
  streaming, immediate overscroll reversal and mouse-wheel draft protection.
- Ink tests exercise mouse input and a live-updating transcript with a fake
  controller. These are not live Windows terminal or subscription evidence.
- Packed tarball installed outside the checkout at a fresh temporary location;
  installed CLI `--version` returned `0.2.0-rc.2`. Package inventory includes
  the new Markdown/viewport modules and excludes test homes/credentials.
- Pending: real Windows-terminal visual acceptance, mouse-mode cleanup on real
  terminal shutdown, resize while browsing, and installed TUI session acceptance.
  No new live inference, OAuth, publishing or global installation was performed.
- This follow-up is not yet an independently accepted release candidate. Existing
  release evidence below describes the earlier artifact, not these UI changes.

## 0.2.0 extension acceptance

The optional TUI, provider ledger and maximum-context integration are implemented.
Full native feature parity remains incomplete; [TUI documentation](tui.md)
lists the implemented surfaces and explicit gaps. Every implemented special
dialog uses the own renderer. Unsupported native JSX is canceled, not handed
off to the native UI or advertised as complete.

The final suite includes controller/trust lifecycle, Unicode editing, UI
approvals, native compatibility envelopes, preference persistence, quota and
token normalization, admin writers and workspace controls. The installed native
engine participates in isolated context, replay, fallback and settings-writer
tests; those tests use fixture accounts and no real inference.

`CLAUDAPTER_NATIVE_TEST=1 npm test`: **152 passed, 0 failed, 0 skipped**.
TypeScript and the final UI regression checks pass. The npm tarball contains
only the configured distribution, docs and notices, with no credentials/test
homes. It was installed under the Windows temporary directory outside the
checkout and globally as **0.2.0-rc.2**; the installed command reports that version.

The outside-checkout artifact edited a deliberately broken `sum.mjs`. In an
explicit `--permission-mode default` session with fixture `ask: ["Bash"]`, the
own dialog allowed `node sum.test.mjs` once, producing **PACKED_TUI_OK**, and
denied a separate sentinel write. `denial-sentinel-2.txt` was absent afterward.
Own `/resume` restored session `73f42dcf-f95a-4dda-bac2-48c2eb75586b` with the
test output, denied-tool result, native history and successful resume hook;
no new prompt/inference was needed. Installed `usage --refresh --json` reported
three completed main requests separately from one canceled auxiliary request.

The first fresh GPT-only fixture inherited native **auto** permission mode:
the native safety classifier rejected some Bash requests while allowing a safe
sentinel command without a dialog. That run is not permission-dialog evidence.
Claudapter does not silently change the user's mode. Explicit manual/default
mode above supplies the verified GPT-only approval path; auto classification
with external models remains a compatibility limitation.

Actual Windows ConPTY acceptance against the 0.2 implementation observed:

| Scenario | Observed result |
| --- | --- |
| Own startup trust | Own decline-first dialog; explicit acceptance recorded by Claude, then trusted configuration loaded |
| Maximum context | `/context`: GPT-6.1-Sol catalog and engine both 872,000; auto-compact threshold 839,000; context estimates labeled |
| Account quota panel | Claude session/weekly and ChatGPT weekly windows from real accounts; separate reset times and sources; no inferred billing |
| Native question round trip | GPT `AskUserQuestion`, own Ocean/Midnight choice, selected Ocean, final `CHOSEN_THEME Ocean` |
| Tool cycle | GPT Read of `sum.mjs`, Bash `node sum.test.mjs`, final `SUM_TEST_OK` |
| Native GPT agent | Explicit `claudapter:gpt-reviewer`, agent `a3e54a0a55cf40523`, Read and returned review; two completed GPT requests separately attributed |
| Main accounting | Six completed main requests; two canceled auxiliary attempts remain interrupted/unmeasured rather than zero |
| Function key and refresh | F2 opened the own model library; its catalog refresh completed and retained maximum-context rows |
| Graceful shutdown | `/exit` returned 0 and saved the gateway usage snapshot |

Claude's account was already at its real session limit during this TUI acceptance.
No new Claude inference was repeatedly attempted; the real Claude→GPT→Claude
cycle and Claude-main/GPT-agent evidence below belong to 0.1 acceptance. New
engine-level context and fallback regression checks use simulated endpoints.
No near-872K prompt or quota-exhaustion test was performed.

Both real credential-file hashes still matched the original preservation
baseline. Native `settings.json` did not match that older baseline; its last
write was 21:20 local and its selected model was `gpt-6-astra`. This prevents an
honest whole-session unchanged-settings claim. No restoration was attempted;
automated tests and the TUI acceptance use separate native homes. The later
pack/install verification records a fresh hash comparison separately.
That fresh comparison passed for native settings, Claude credentials and Codex
credentials after installation and the outside-checkout TUI tests.

### Home-directory trust regression

The first installed TUI failed when launched from `C:\Users\Jonas`: it required
`workspace_trust_recorded`, but native Claude intentionally returns false for
home-directory consent, which is session-only. The corrected controller passes
that consent to the actual running query and retains it only for this TUI's
lifetime. It does not start/close a temporary trust process or write a permanent
home-directory trust record. Declining still starts no engine.

The regression is covered both through controller startup/resume fixtures and
the installed Claude executable with an isolated HOME/USERPROFILE/config. The
real-engine test observes `workspace_trust_recorded:false`, a usable live query
and no accepted project trust record. Ordinary project trust retains its native
persistent acknowledgement path.

## Automated evidence

The original 0.1.0 release passed **43 tests**, including the actual
installed Claude executable with fixture credentials for truncated tool streams
and separate native/gateway fallback ownership.
`npm run check`: TypeScript passes. Unit/integration test homes are isolated;
real subscriptions are used only by explicitly invoked live acceptance runs.

Coverage includes strict routing, authentication before body processing, provider
credential/header separation, compatible-provider transport, cached versus live
availability, account pinning and read-only refresh pickup, settings composition,
tool IDs/results, image conversion, reasoning, cached usage accounting, malformed
SSE/CRLF, tool JSON validation, oversized requests, cancellation, timeout,
fallback scopes/cooldown/reset/exhaustion/capability rejection, non-eligible errors,
and interrupted-response replay guards.

Native 2.1.301 made three primary overload attempts before using its own configured
fallback. With a Claudapter-owned rule and zero retries, the actual CLI reached
the mocked primary and replacement exactly once each, then received the exhausted
policy guard; its native retries did not multiply upstream work. This required a
scope/prompt exhaustion guard in addition to `x-should-retry: false`.

## Live evidence recorded so far

| Scenario | Observed result |
| --- | --- |
| GPT native tool cycle | `gpt-6.1-sol` through ChatGPT returned HTTP 200; Read, Edit and Bash corrected `add` and produced `SUM_TEST_OK` |
| Native GPT subagent | GPT main invoked `claudapter:gpt-reviewer`; distinct native agent ID `abad989adfff98225`; Read/Bash, test exit 0, result returned; no independent Codex agent process |
| Native picker | Additional account GPT rows displayed; `s` switched Sonnet 5.5 -> GPT-6.1-Sol for this session only; no `model` field added to isolated user settings |
| Main-session discovery | Native `mcp__plugin_claudapter_discovery__discovery` called with refresh; main correctly reported both agent names, empty fallback rules and actual ChatGPT route |
| ChatGPT-only | Fresh Claude home with no copied Claude credential, `claude:false`; real result `CHATGPT_ONLY_OK` |
| Simulated limit with real fallback | Native requested `claude-sonnet-5-5`; injected 429 before upstream Claude inference; real GPT replacement, subsequent Read/PowerShell-denial/Bash turns stayed on GPT; `SUM_TEST_OK`; one primary attempt |
| Permission preservation | A non-allowed PowerShell tool was denied in isolated acceptance; no bypass added; allowed Bash ran the test |
| Existing extensions | Existing project CLAUDE.md, SessionStart hook, sentinel skill and discovery MCP all worked together; `INSTRUCTIONS_SENTINEL_OK`, `HOOK_SENTINEL_OK`, `SKILL_SENTINEL_OK` |
| Existing MCP configuration | An independently supplied sentinel MCP server via native `--mcp-config` remained callable alongside the packaged discovery plugin; final installed artifact returned `EXISTING_MCP_OK` and the discovered ChatGPT provider |
| Vision | Native Read loaded a generated red PNG; GPT accepted the image tool result and identified red |
| Installed artifact | npm tarball installed globally; outside checkout, actual GPT + packaged discovery MCP returned `INSTALLED_RC_OK`; no Rookery dependency |
| Interactive exit | Native `/exit` returned 0; gateway closed and all test runtime records were removed |
| Ctrl+C | Native first Ctrl+C displayed its normal second-press exit notice; double Ctrl+C exited with code 0 and removed the gateway runtime record |
| Concurrent sessions | Interactive native session and separate live test launchers operated concurrently with distinct gateway ports/tokens and independent routing; Codex credentials were read-only |
| Actual Claude at initial spike | Both direct Claude and gateway Claude were blocked by the pre-existing session usage limit; direct CLI reported reset at 20:30 Europe/Berlin |
| Complete interactive model cycle | After reset: same session `6dad84e6-c8ea-48c8-87ca-e7897b1ebdb1`, installed artifact: Sonnet 5.5 Read/analysis -> native picker GPT-6.1-Sol -> Edit/Bash and `SUM_TEST_OK` -> native picker Sonnet 5.5 -> `git diff -- sum.mjs` and review; both backend routes HTTP 200 |
| Claude main / GPT subagent | In that same Claude session, native `claudapter:gpt-reviewer` had agent ID `a09737830fcabe0be`; GPT Read, Bash, SubagentHandback; Claude received its successful test report and remained on Anthropic |
| Claude-only | `chatgpt:false`, absent CODEX_HOME; real `CLAUDE_ONLY_OK` from Sonnet 5.5 |
| Picker persistence | Enter on GPT saved `model:gpt-6.1-sol` to the isolated native settings file; selecting Sonnet with Enter restored its default. Subsequent `s` switches preserved `model:sonnet`. No backup restoration was used. |
| Session and agent resume | Installed CLI resumed the same session after the interactive run; Claude used SendMessage to resume `a09737830fcabe0be` on `gpt-6.1-sol`; same agent ID, previous tool history, HTTP 200 and returned `SUM_TEST_OK` from existing context; no new agent was spawned |

The simulated-fallback run uses a test-specific 4096-token output reserve. The
default native 128000-token reserve plus a large native prompt exceeded the
conservative byte-bound fit check; Claudapter correctly refused that first run
before sending the conversation to GPT. This is a usability limit, not silent
history truncation. Native cost output continued attributing that turn to Claude;
only the redacted route log is evidence of the actual provider/model.

The PowerShell npm shim consumes the standalone `--` in some invocations.
The CLI also accepts unambiguous native flags directly, so the documented
`claudapter -- --model ...` workflow works through both npm shims and direct Node.

Local raw acceptance outputs are ignored under `.artifacts` and `.test-live`.
They are not included in the package. Test credentials are not committed.

## Known limits

- Native agent follow-up uses `SendMessage` in this Claude version. The first
  constrained acceptance harness omitted that tool and correctly could not
  resume; exposing it in the resumed harness verified the same-agent continuation.
  The launcher itself never restricts that native tool set.
- Keyring-only Codex credentials and automatic refresh-token rotation are not
  implemented. Official Codex owns refresh; unexpired file credentials are reread.
- GPT native context display defaults to 200K; native costs are estimates, not
  subscription charges. Claudapter does not invent model price mappings.
- Additional compatible providers are fixture-tested only. Other cached GPT
  model rows are configured, not claimed live-tested.
- Long real near-context-limit conversations, unsupported hosted tools/documents,
  opaque/redacted thinking and automatic multimodal fallback are not supported
  by claiming equivalent behavior. Unsupported content fails explicitly.
- CI is configured for three operating systems; only Windows was run locally.

Global Claude settings, global Claude credentials and Codex auth.json were
compared by hash and remained unchanged. Rookery was inspected read-only.
The optional Python terminal harness encountered a non-atomic test command-file
read on final exit; its reader now retries incomplete writes. Normal native
`/exit` and Ctrl+C cleanup were independently observed earlier. This test helper
is not shipped in the runtime package.

Automatic approval review rejected both bundled cleanup and the narrower deletion
of `.test-live/Claude Home/.credentials.json` with only `blocked by policy` as its
reason. That ignored, unshipped copy of the live-test login remains and should be
removed manually. The inactive final terminal runtime record and its non-secret
temporary plugin directory may also remain after the helper's forced exit.

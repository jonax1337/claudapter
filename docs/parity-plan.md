# Native parity plan

Scope: the TUI gaps listed in [tui.md](tui.md) ("Compatibility and remaining work") and
[tui-concept.md](tui-concept.md) ("Remaining parity"). Each gap is triaged first, then the
ones that can be built honestly are implemented. Test results and live evidence belong in
[verification.md](verification.md); this file states what exists, what is mocked and what
is out of reach.

Private SDK methods stay pinned to SDK **0.3.301** and Claude Code **2.1.301 / 2.1.302** and
refuse every other version. Unsupported native dialogs are still cancelled, never handed to
the native UI. Nothing here adds a permission-bypass flag or edits native configuration.

## Triage

| Gap | Class | Outcome |
| --- | --- | --- |
| Side questions (`/btw`) | Implementable now | Implemented. Private `askSideQuestion` through the compat facade. |
| `/cd` | Implementable now | Implemented: settings revalidation, native `setCwd`, renewed trust, host state refresh. |
| Advanced editor / Vim | Implementable now | Implemented: Vim mode, kill ring, bracketed/multi-line paste. Word/line navigation and undo/redo were already provided by the editor and are now documented. |
| Full checkpoint summarization | Partly implementable | Approximation only: a confirmed, focused `/compact`. True partial compaction is not safely possible. |
| Account privacy / upgrade | Implementable now | Read-only confirmation dialogs that open an official page after explicit confirmation. |
| Account info | Implementable now | `/account`: read-only account and `claude auth status` snapshot (existing admin reader). |
| Passes | Not safely possible | No URL or SDK surface; explained as native-only. |
| Tutorial / demo panels | Implementable now (own content) | `/tutorial` and `/keymap`. The native radio/power-up demos are not copied. |
| Cloud sessions, environments, teleport | Needs live external service | Explanation dialog only (`/cloud`). |
| Artifacts selector | Needs live external service | Explanation dialog only (`/artifacts`). |
| IDE onboarding | Needs live external software (an IDE) | Explanation dialog only (`/ide`). |
| Voice | Needs hardware and a live service | Explanation dialog only (`/voice`). |

## Implemented

### Side questions

`/btw <question>` calls the engine's `side_question` control request. It does not enter the input
queue, so the main turn, its tool calls and the saved conversation are untouched; the answer is shown in a
panel and marked "Not saved to the conversation". The composer stays editable while a turn runs
and accepts only `/btw` (anything else shows a hint to interrupt first). Esc on a pending
question aborts the request. `/btw` with no argument lists this session's earlier questions.
A side question is billed to the active model like any request; the gateway counts it as usual.

Limits: the question is capped at 4,000 characters; answers appear only after the engine
finishes (no streaming); a refusal fallback is reported but never retried automatically.

### `/cd <path>`

1. The target must be an existing directory (`~`, relative paths and symlinks resolved).
2. The target's `.claude/settings*.json` is validated with the launcher's own check: gateway,
   provider and agent environment overrides, duplicate plugin namespaces and fallback
   conflicts are refused exactly as at launch. Nothing changes on refusal.
3. The engine relocates with native `setCwd`. For a directory without trust it answers
   `needs_trust` with its canonical directory; the TUI shows its own dialog (default: stay)
   and answers that exact challenge once. Claude Code records the decision itself.
4. On success the host adopts the directory (`process.chdir`, controller `cwd`), and agents,
   commands and context are re-read.

Not covered: the session keeps its conversation, but where Claude Code files it on disk after a
move is its own decision and has not been inspected. Plugin and agent-frontmatter features of the
new project may need a fresh launch, as with native workspace trust.

### Prompt editing

Already present (OpenTUI textarea, now listed by `/keymap`): word/line navigation, selection, undo and redo
(ctrl+- / ctrl+.), word and line deletion.

New:

- **Vim mode** (`/vim` toggles, stored in `ui.json` as `editorMode`; off by default). Starts in INSERT.
  NORMAL: `h l j k` (sticky column), `0 ^ $`, `w W b B e E`, `gg G`, `f F t T ; ,`, counts,
  operators `d c y` with motions, `dd cc yy`, `D C Y`, `iw aw`, `x X s S r J ~`, `p P`, `i a I A o O`,
  VISUAL and V-LINE with `d c y x s o`, `u` / `ctrl+r` through the editor history, `.` repeat
  (including typed text), Enter sends. The mode is shown in the prompt footer; the cursor is a
  block outside INSERT.
- **Kill ring**: `ctrl+k`, `ctrl+u`, `ctrl+w`, `alt+d`, `alt+backspace` save what they delete
  (consecutive kills extend one entry); `ctrl+y` yanks, `alt+y` cycles. Bounded to 60 entries.
- **Paste**: bracketed paste is parsed by the terminal layer; text pastes are now always inserted by the composer
  after control-sequence stripping and CR/CRLF normalization. Over 20 lines collapses to `[pasted N lines]`
  (expanded on send); over 500,000 characters is refused.

Not covered: registers other than the unnamed one, marks, macros, ex commands, search (`/`, `?`, `n`),
`%`, paragraph motions, text objects other than `iw`/`aw`, block-wise visual, counts for `.`.
Combining marks are treated as separate characters by the Vim motions.

### Checkpoint summarization

The checkpoint menu has "Summarize from here": after confirmation it sends `/compact` with an
instruction to keep detail from that checkpoint onward. Claude Code compacts the **whole**
conversation; the native "summarize from here" compacts only the later part, and the engine
exposes no control request for partial compaction in SDK 0.3.301. The dialog says so.

### Account and reference panels

- `/account` shows the existing read-only account/`auth status` snapshot.
- `/privacy` and `/upgrade` show the exact URL and open the system browser only after confirmation, only for
  `https` pages on `claude.ai`, `www.anthropic.com`, `support.anthropic.com` and `code.claude.com`. Claudapter sends nothing to
  the page and reads nothing back. Nothing is purchased or changed.
- `/keymap` is generated from the registered bindings: the textarea's own bindings with the composer's overrides,
  the kill-ring and Vim tables, and the user's `ui.json` shortcuts. Session-level keys are a short table whose entries are
  checked against the handling source by a test. Vim reference entries are replayed through the interpreter by a test.
- `/tutorial` is a short guided tour in Claudapter's own words.

### Native-only entries

`/cloud`, `/artifacts`, `/ide`, `/voice` and `/passes` open a dialog that says the feature is not available in the
Claudapter TUI and to use native `claude`. They start nothing and are not forwarded to the model or the native UI.

## Why the rest is out of reach

- **Cloud, teleport, environments, artifacts** need a signed-in claude.ai service and its private session
  protocol. The SDK has no public surface, and none of the pinned runtime methods lists, attaches or selects them.
- **IDE onboarding** installs and pairs an editor extension; it needs a running IDE.
- **Voice** needs microphone capture and the claude.ai speech service.
- **Passes** have no SDK surface and no known public URL.
- **True partial checkpoint compaction** has no control request in the pinned runtime.

## Evidence classes

- Pure logic (Vim, kill ring, `/cd` module, link allow-list, keymap): node/bun unit tests.
- OpenTUI rendering and key handling: bun tests with the OpenTUI test renderer and mock input.
- Engine behavior: `/cd` was exercised against the installed Claude Code 2.1.302 in a fixture home with an unreachable
  model endpoint (gateway-conflict refusal, trust challenge and approval, relocation, same-directory no-op).
  `askSideQuestion` was confirmed to exist on the live runtime and to accept the request; **no successful answer
  has been observed** because that needs a reachable model. Live `/btw`, `/cd` with a real gateway and the checkpoint
  summary remain interactive acceptance items. Mock success is not live verification.

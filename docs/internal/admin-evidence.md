# Own administration dialogs: integration and evidence

`src/tui/admin.ts` supplies renderer-neutral snapshots and explicit actions. The
Ink host draws its own dialogs, fields, previews and confirmation controls; no
administration action switches into Claude Code's native TUI. Authentication can
open or return the official browser authorization page.

## Host contract

Pass `query`, `cwd`, `claudePath`, and `initialSettings` (the launcher's exact
settings object) to `adminSnapshot` and `runAdminAction`. Optionally pass `env`
for the native subprocess environment, `signal` for subprocess cancellation,
`onOutput` for sanitized CLI browser-login progress, and `keybindings` for the
host's actual mappings. Render `adminActions[kind]`; actions marked `confirm`
require a user-confirmed `input.confirm = "yes"`. Secret fields must be masked.

The SDK process owns runtime settings and permissions. Session overlays merge
the original flags and prior successful edits without rewriting native settings
files. Reserved gateway credentials, routing environment variables, native
fallback ownership and permission bypass modes cannot be changed through JSON
settings overlays. The installed SDK's known setting names and primitive types
are checked locally; native schema and managed policy remain authoritative for
complex values. Startup-only settings may require a new session.

Live settings, permission rules, hooks, memory, skills, status and sandbox data
use `invokeCompat` on the verified SDK/CLI pair. Unsupported readers fall back
to public SDK data where useful. Malformed responses fail explicitly. Permission
and hook rows include an `id` derived from the exact native row. Saved remove /
replace actions reread current rows and reject stale IDs, scope mismatches and
noneditable rows.

## Native writers

The installed CLI's hidden commands and their embedded parser/writer source
were inspected on Claude Code **2.1.301**. They are compatibility integrations,
not stable public API promises. Writes require SDK **0.3.301**, the running
query's reported CLI version, and a fresh version check of the executable being
invoked. Structured JSON goes through stdin; subprocesses never use a shell.

| Action family | Native mechanism | Persistence |
| --- | --- | --- |
| Saved permission add/remove | `edit-permission-rules --json` | Explicit `user`, `project` or `local` scope |
| Saved hook add/replace/remove | `edit-hook --json` | Explicit scope; exact native target; native stale/ambiguous-match checks |
| Skill invocation state | `edit-skill-overrides --json` | `local` only; native author/plugin/policy restrictions |
| Automatic memory/dream settings | `edit-memory-settings --json` | `user` only, explicitly confirmed |
| Sandbox mode / unsandboxed fallback | `edit-sandbox-settings --json` | `local` only; native platform/policy/dependency checks |

The memory content editor is separate: it previews only an explicitly selected
Markdown file (64 KiB maximum for edits), requires its SHA-256, checks for changes,
captures the old file, and exclusively installs the replacement without
overwriting a concurrently created path. A recovery backup is retained and its
path returned. Symlinks and shared hard links are not edited. This content editor
does not change the assistant's own durable memory without an explicit user edit.

Plugin and marketplace administration uses the installed CLI's documented
subcommands with explicit scopes and argument arrays. Uninstall preserves plugin
data. Command-based plugin install approvals are not bypassed with `-y`.
MCP administration exposes read-only status, reconnect, runtime enable/disable,
explicit saved add/remove, and native OAuth. Query-owned Claude/MCP OAuth flows
use the version-pinned compatibility facade; the official browser-login CLI is
the fallback where that flow is unavailable. No login is performed automatically.

## Verification

`test/admin.test.mjs` has 16 tests. With `CLAUDAPTER_NATIVE_TEST=1`, the installed
native writers really add/remove a permission rule, change an automatic-memory
setting, set a skill override, and add/replace/remove a hook inside temporary
project and user homes. The test checks preservation of unrelated settings,
stale target rejection, and Windows sandbox refusal without a settings write.
No inference, actual sign-in, external installation or user-home mutation is
part of these tests. Other tests cover secret redaction, scope/confirmation gates,
version rejection, own-dialog OAuth control calls, session overlay preservation,
invalid JSON, Markdown conflicts and recovery backups.

## Remaining boundaries

Full native UI parity is not claimed by these helpers. Session approvals from
other native sources are visible through the compatibility reader, but removal
is limited to tracked session overlays and editable saved rules. Sandbox command
exclusions are not exposed because the native writer can choose a different
persistent scope based on policy. Actual browser login completion and live
runtime settings-watcher behavior require separate product acceptance. Future
SDK/CLI versions fail closed for private methods and writers until verified.

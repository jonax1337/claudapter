# Claudapter

**Your Claude Code. Your choice of models.**

Claudapter launches your installed Claude Code with a temporary loopback model
gateway. It adds account-catalog GPT models to the native `/model` picker,
optional GPT-backed native agents, read-only discovery, and explicitly enabled
provider fallback. Version **0.2.0-rc.2** adds an optional custom TUI,
actual-provider usage accounting and maximum catalog context configuration.
Both interfaces run your installed Claude Code; there is no Rookery runtime
dependency. The TUI uses React, Ink and the pinned Claude Agent SDK.
See [verified behavior and limitations](docs/verification.md).

## Install locally

Requires Node.js 24 LTS or newer, Claude Code **2.1.301** (the tested version),
and a file-backed Codex ChatGPT login for GPT inference. The TUI compatibility
layer is verified against Claude Code **2.1.301** and Agent SDK **0.3.301**;
private native operations refuse unverified version combinations.

For a tested GPT approval flow, run
`claudapter tui -- --model gpt-6.1-sol --permission-mode default`.
Native auto mode may require a safety classifier unsupported by the external
model gateway. The explicit flag changes only this session, not saved permissions.

```powershell
npm ci --omit=optional
npm test
npm pack
npm install --global --omit=optional .\claudapter-0.2.0-rc.2.tgz
claudapter setup
claudapter doctor
```

No package has been published. Installation adds `claudapter`; it does not
replace `claude`, edit your shell profile, or rewrite global Claude settings.
For an isolated installation use
`npm install --omit=optional --prefix <directory> <tarball>` and run
`<directory>/node_modules/.bin/claudapter`. Omitting optional packages avoids
downloading the SDK's optional bundled engine: Claudapter explicitly selects
your installed Claude executable.

Use the official login commands when needed:

```powershell
claude auth login
codex login
```

Claudapter reads the ChatGPT session and model cache under `CODEX_HOME`, or
`~/.codex`. It never writes, rotates or locks shared Codex credentials. Each
request rereads the access token; a concurrent official Codex refresh is picked
up automatically. Expired/unknown-expiry tokens stop with a diagnostic; refresh
using the official Codex CLI and retry. Keyring-only and external-token storage
are not implemented. This compatibility bridge is not an official promise of
Claude/ChatGPT subscription interoperability.

## Use your normal Claude environment

```powershell
cd C:\path\to\your\project
claudapter
claudapter -- --continue
claudapter -- --resume <session-id>
claudapter -- --model <exact-model-id>
```

The launcher inherits the working directory, terminal, native configuration
directory, permissions and environment. Native arguments follow `--`. User and
project instructions, skills, plugins, MCP servers and hooks still load through
Claude Code. A temporary session plugin supplies only additive context,
discovery and configured agents. No permission bypass or global alias remapping
is added. Child exit codes propagate; normal exit closes the gateway and removes
temporary files. A forced OS kill cannot run cleanup; stale runtime files may
remain, but no background gateway daemon survives a dead launcher.

Open `/model`, select a row, and press **s** to switch for this session only.
**Enter**, and `/model <id>`, save the selected model as Claude's default. Saving
a GPT default can make a later plain `claude` session request an unsupported
Anthropic model. Choose a native Claude model there to correct it. Claudapter
does not race other sessions by restoring settings backups.

`--settings <file-or-json>` is preserved and its picker rows are combined with
the added rows; otherwise existing user picker rows are used. The highest native
managed policy still wins. Conflicting provider/gateway variables and global
subagent-model overrides cause an explicit error. Resolve them in your shell or
configuration; Claudapter does not silently erase them. Native `availableModels`
allowlists are not broadened by Claudapter.

## Optional Claudapter TUI

```powershell
claudapter tui
claudapter tui -- --model <exact-model-id>
claudapter tui -- --resume <session-id>
```

`claudapter` still opens the native interface. `claudapter tui` opens Claudapter's
own chat, composer, tool output and dialogs; it does not hand you back to an
interactive native screen to manage settings. Native execution, session storage,
permissions and provider routing remain shared. Opening an untrusted workspace
requires an explicit decision; declining stops TUI startup. Claude Code records
accepted trust through its own writer.

| Commands | Available interface |
| --- | --- |
| `/model`, `/favorite`, `/agents`, `/tasks` | Model selection and favorites, explicit agent delegation/follow-up, task inspection and stop |
| `/usage`, `/context`, `/fallback` | Actual-provider usage, effective context and explicit routing policy |
| `/resume`, `/clear`, `/history`, `/fork`, `/rewind`, `/export` | Native sessions, prompt recall, conversation branching, checkpoint preview/restore and Markdown export |
| `/theme`, `/thinking`, `/keybindings`, `/copy` | Four palettes, reasoning visibility, custom shortcuts and copying the latest response |
| `/config`, `/permissions`, `/mcp`, `/plugins`, `/skills`, `/hooks`, `/memory` | Own inspection and editing dialogs; persistent changes identify their scope and require confirmation |
| `/plan`, `/effort`, `/sandbox`, `/chrome`, `/remote-control`, `/login` | Native controls exposed through the pinned compatibility layer; account/platform requirements still apply |

Use `/help` for the command palette. The composer supports multiline paste,
grapheme-aware editing and Ctrl/Alt shortcuts. Shift+Enter or Ctrl+J inserts a
newline; Ctrl+C interrupts work, then exits on a second press while idle.
Permission dialogs preserve their own navigation and default to denial or
cancellation. Themes are **Midnight**, **Ocean**, **Terminal** and **Contrast**;
favorites and shortcuts live only in `~/.claudapter/ui.json`.

This is a working optional interface, **not complete native feature parity**.
Voice, cloud/teleport sessions, artifacts, full IDE onboarding, working-directory
changes with renewed trust, and advanced native editor interactions remain
outside this release's verified coverage. Browser/OAuth/remote-control methods
being present does not establish a successful external-account flow.
See [TUI architecture](docs/tui-concept.md) and [verification](docs/verification.md).

## Provider usage and maximum context

```powershell
claudapter usage
claudapter usage --refresh
claudapter usage --refresh --json
```

Native Claude Code still owns its `/usage` screen. Use the commands above or
**TUI `/usage`** for Claudapter's combined view. Session tokens come from upstream
usage and are attributed to the **actual provider/model and agent**, including
fallback attempts. Incomplete attempts remain unmeasured; SDK aggregates are not
added again. Saved summaries cover the latest ten closed gateways plus active
gateways, not unrelated traffic from other applications.

Account quotas are separate snapshots with provider-defined windows, source and
freshness. Refresh uses read-only account interfaces; it does not make inference
requests or rotate credentials. Claude quota availability depends on a supported
SDK response or observed native OAuth authorization. Configured compatible
providers without a quota interface remain **unknown**, not zero. Dollar amounts
are not inferred from subscription tokens; native cost estimates are not bills.

For GPT, Claudapter now selects valid `max_context_window` metadata, falling back
to `context_window`, while retaining both values and their provenance. The local
catalog observed on 2026-10-16 supplies **872,000 tokens** for the GPT models;
native engine context calculation was verified at that window. This number is
catalog data, not a hardcoded model limit or a near-capacity generation claim.

Temporary native settings combine the external-model ceiling with per-model
`autoCompactWindow` entries. Model switching therefore uses each configured
window, while recognized Claude models retain native context handling. No fake
Claude identity or disabled compaction is needed. Unknown or unrepresentable
mixed capacities fail explicitly. `/context` separates catalog capacity from
effective engine capacity and local usage estimates; output/compaction reserves
still apply. See [context evidence](docs/context-evidence.md).

## Models, agents and discovery

```powershell
claudapter models
claudapter providers
claudapter agents enable <exact-chatgpt-model-id>
```

Get the ID from the account's current catalog, not an example in this README.
The last command enables the namespaced session agents
`claudapter:gpt-implementer` and `claudapter:gpt-reviewer`. Ask explicitly:

> Use claudapter:gpt-reviewer to review this change and run its focused test.

These are native Claude Code agents using GPT inference, not Codex CLI agents.
They inherit normal permissions. Their routing identity comes from native
session/agent headers, bound to the definition name by `SubagentStart`. An
unexpected native per-invocation model override is rejected, not reported as a
successful GPT invocation. Existing agents are unaffected. Availability never
grants permission to delegate.

Startup, prompt and tool hooks add a concise model/policy snapshot. Ask the main
session to call `mcp__plugin_claudapter_discovery__discovery` with `refresh: true`
to reread catalog/auth readiness and inspect actual recent routes. This read-only
MCP server cannot enable fallback, modify config or execute commands. The manifest
distinguishes cached entries, credential readiness, completed live requests,
temporary failures and auth failures. A cached model is not proof of availability.
Changes to agent configuration require relaunch. The TUI's explicit fallback
editor can apply validated rules during a session, and its model refresh updates
catalog bindings. Read-only discovery never enables new data-sharing rules.

## Explicit fallback

Fallback is **off by default**. Edit only the trusted user configuration at
`~/.claudapter/config.json` (`CLAUDAPTER_HOME` may select another absolute user
directory). Project settings cannot enable Claudapter policies.

```json
{
  "version": 1,
  "claude": true,
  "chatgpt": true,
  "providers": [],
  "agents": {},
  "fallback": [
    {
      "enabled": false,
      "from": "claude-sonnet-5-5",
      "targets": ["REPLACE_WITH_EXACT_ACCOUNT_MODEL_ID"],
      "scopes": ["main"],
      "errors": ["rate_limit", "unavailable"],
      "retries": 0,
      "timeoutMs": 60000,
      "cooldownMs": 300000
    }
  ]
}
```

Replace both IDs with observed registry/request IDs, then explicitly enable the
rule. `from` uses the actual wire model, not `sonnet`. Targets are ordered, unique
and limited to three; retries are 0–2 per target. Scopes are `main` and/or exact
configured agent names without the `claudapter:` prefix. Rules cannot overlap.
Enabling a cross-provider rule authorizes sending that scope's conversation,
system instructions and tool schemas/results to each listed target. No other
provider is automatically selected.

The gateway handles recognized 429 usage/rate rejections and selected 5xx
availability rejections **before any response output**. Auth, billing, policy,
invalid requests, refusals, transport failures and interrupted streams stop.
Retries honor `Retry-After`; a long hint skips retrying the rejected target and
extends its cooldown. A successful fallback stays local to its conversation/agent
until cooldown expiry or explicit model change/reset. State is in memory and
resets on launcher restart/resume. Native fallback chains remain available when
Claudapter rules are disabled; combining both owners is rejected.

```powershell
claudapter fallback show
claudapter sessions
claudapter fallback reset <runtime-id> <conversation-id> [agent-id]
```

Omitting the conversation ID resets all scopes of that launcher. Reset also
clears interrupted-turn protection: inspect any tool side effects before doing
so. Normal recovery from interrupted output is a **new explicit user prompt**.
The gateway never splices a replacement stream into an already-started response.

Target tools and context capacity are checked conservatively. Text uses UTF-8
bytes as a safe upper bound plus output/overhead reserve; this may reject requests
that would actually fit. Unknown capacity, unsupported content and automatic
multimodal fallback are rejected. Nothing truncates history to make it fit.
`[Claudapter]` routing notices and discovery report requested versus actual model;
Claude's picker/status may continue showing the requested model during fallback.

## Other providers and account modes

`claudapter provider add` configures an HTTPS Anthropic-compatible endpoint,
explicit models/capabilities and a dedicated environment variable containing its
key. The key itself is never requested in an argument or written to config.
Built-in account credential variables cannot be reused for another provider.
Compatible providers receive only their own credentials; redirects are refused.
Only the fixture provider path has been tested; no paid account was added.

For ChatGPT-only mode set `"claude": false` and start with an explicit catalog
GPT model. A local placeholder credential starts Claude Code without a Claude
login and is never sent to Anthropic. Native Claude-only auxiliary features may
be unavailable. For Claude-only mode set `"chatgpt": false` and leave agents and
cross-provider fallback empty.

## Limits and troubleshooting

- Native `/usage` and cost estimates are not replaced by Claudapter's ledger.
  Use `claudapter usage` or TUI `/usage` for actual-provider accounting. Context
  settings now use catalog maxima; user/managed overrides and native reserves
  can still change the effective window shown by `/context`.
- Native tools, text, supported image blocks, tool results and tool choices have
  translation coverage. Foreign reasoning summaries become text; Claude thinking
  is carried as prior reasoning text for GPT. Redacted thinking, hosted tools,
  documents, structured output formats and unknown semantic blocks fail explicitly.
  GPT output limits follow the Codex backend; Anthropic's output-token budget is
  not an exact cross-provider control.
- Experimental features and future Claude wire fields can require adapter work.
  Native auto-mode classifiers can still request Claude models, including while
  the main model is GPT. No permission system is disabled to conceal this.
- Diagnostic traces are opt-in with `CLAUDAPTER_TRACE=1`. They contain model IDs,
  scopes, statuses and tool names, never conversation bodies or credentials.
- Credential snapshots in optional live-test directories must be kept private and
  removed after testing. Standard `npm test` uses fake credentials and isolated homes.

See [architecture and security](docs/architecture.md),
[demo](docs/demo.md) and [verification](docs/verification.md).

The [TUI architecture](docs/tui-concept.md) documents the implemented extension
and the remaining native-parity boundaries.

## Develop and uninstall

```powershell
npm test
npm run check
$env:CLAUDAPTER_NATIVE_TEST = "1"
npm test
npm uninstall --global claudapter
```

The opt-in native test uses the installed CLI with fixture accounts only. CI is
configured for Windows, Linux and macOS; configured jobs are not evidence of
remote execution. Remove `~/.claudapter` separately if you no longer want its
non-secret policy configuration. Claude/Codex settings, plugins and logins belong
to their official tools and are not removed.

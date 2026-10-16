# Claudapter

**Your Claude Code. Your choice of models.**

Claudapter launches your installed Claude Code with a temporary loopback model
gateway. It adds account-catalog GPT models to the native `/model` picker,
optional GPT-backed native agents, read-only discovery, and explicitly enabled
provider fallback. It has no Rookery runtime dependency and no runtime npm
dependencies. See [verified behavior and limitations](docs/verification.md).

## Install locally

Requires Node.js 24 LTS or newer, Claude Code **2.1.301** (the tested version),
and a file-backed Codex ChatGPT login for GPT inference.

```powershell
npm ci
npm test
npm pack
npm install --global .\claudapter-0.1.0-rc.1.tgz
claudapter setup
claudapter doctor
```

No package has been published. Installation adds `claudapter`; it does not
replace `claude`, edit your shell profile, or rewrite global Claude settings.
For an isolated installation use `npm install --prefix <directory> <tarball>`
and run `<directory>/node_modules/.bin/claudapter`.

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
Policy/agent changes require relaunch; discovery does not silently enable new
data-sharing rules mid-session.

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

- Claude Code does not recognize GPT's context/pricing semantics. Its UI may
  assume 200K context and display guessed dollar costs even on subscriptions.
  Claudapter reports provider usage, not invented prices, and deliberately sets
  no global context override or fake `behavesAs` Claude identity.
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

The [optional TUI concept](docs/tui-concept.md) describes the proposed next extension,
including provider-aware usage and context provenance. Its TUI commands are not
implemented in this release.

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

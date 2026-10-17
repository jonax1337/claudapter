# Configuration and reference

Everything Claudapter-specific lives in `~/.claudapter` (or the absolute directory in
`CLAUDAPTER_HOME`). Claude Code and Codex keep their own configuration, logins and
settings; Claudapter reads them but never rewrites them.

## Contents

- [Launch behavior](#launch-behavior)
- [ChatGPT credentials](#chatgpt-credentials)
- [Multiple accounts (profiles)](#multiple-accounts-profiles)
- [Models, agents and discovery](#models-agents-and-discovery)
- [Explicit fallback](#explicit-fallback)
- [Other providers and account modes](#other-providers-and-account-modes)
- [Ollama local models](#ollama-local-models)
- [Provider usage and maximum context](#provider-usage-and-maximum-context)
- [Environment variables](#environment-variables)
- [Limits and troubleshooting](#limits-and-troubleshooting)
- [Uninstall](#uninstall)

## Launch behavior

```sh
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

## ChatGPT credentials

Claudapter reads the ChatGPT session and model cache under `CODEX_HOME`, or
`~/.codex`. It never writes, rotates or locks shared Codex credentials. Each
request rereads the access token; a concurrent official Codex refresh is picked
up automatically. Expired/unknown-expiry tokens stop with a diagnostic; refresh
using the official Codex CLI and retry. Keyring-only and external-token storage
are not implemented. This compatibility bridge is not an official promise of
Claude/ChatGPT subscription interoperability.

## Multiple accounts (profiles)

A profile is a named account slot with its own native Claude home (and optionally
its own Codex/ChatGPT home) under `~/.claudapter/profiles/<name>/`. The wizard
creates the slot and starts the official `claude auth login` flow for it; logins,
sessions and settings stay completely separate from your main account.

```sh
claudapter profile add work      # wizard: create the slot, optional own Codex login, official login flow
claudapter profile list          # every profile with its Claude/ChatGPT login status
claudapter profile login work    # re-run the official login flows for that profile
claudapter profile remove work   # deletes the profile including its logins (asks first)
claudapter profile default work  # start every plain `claudapter` under this profile; `--clear` undoes it
claudapter --profile work        # one launch under the profile (also: `claudapter tui --profile work`)
claudapter --profile none        # explicitly use the native homes this once
```

Without a profile active, nothing changes: Claudapter keeps using your normal
`~/.claude` and `~/.codex`. An externally exported `CLAUDE_CONFIG_DIR`/`CODEX_HOME`
conflicts with a profile and fails loudly instead of switching accounts silently.
Login tokens are read-only; only the official CLIs refresh them.

Two ways to *use* a second account from your main session:

- **Pick it directly**: `/model` lists `sonnet@work`, `opus@work`, `haiku@work`
  (and any exact versioned id like `claude-sonnet-5-5@work`). The request runs
  the same native Claude model through the profile's account token; all native
  Claude headers stay, only the authorization is the profile's.
- **Automatic rotation**: use the id as an explicit fallback target. A rule
  `"from": "claude-sonnet-5-5", "targets": ["sonnet@work"]` switches to the
  second account on a rate limit, with the usual cooldown, notices and reset.
  Enabling it authorizes sending that scope's conversation to the other account.

Account models keep native context handling (no fake ceiling). Their quota
windows are **unknown** — quota pre-emption never skips them. Missing or expired
profile credentials stop with `401` and name the recovery command; nothing is
ever sent under an unverified token. Multi-account use remains your
responsibility under the providers' terms.

`--settings <file-or-json>` is preserved and its picker rows are combined with
the added rows; otherwise existing user picker rows are used. The highest native
managed policy still wins. Conflicting provider/gateway variables and global
subagent-model overrides cause an explicit error. Resolve them in your shell or
configuration; Claudapter does not silently erase them. Native `availableModels`
allowlists are not broadened by Claudapter.

## Models, agents and discovery

```sh
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
  "model": "glm-5.3",
  "modelEffort": { "glm-5.3": "max" },
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

The TUI's `/settings` (also `/setup`, `/fallback`) edits all of this without
hand-written JSON: a default model for new sessions, a per-model reasoning effort
(`low`–`max`, applied at session start and model switch), and fallback rules
through a structured picker with an explicit confirmation before anything is
saved. Both optional fields can be removed again; absent values keep the native
Claude Code defaults.

The gateway handles recognized 429 usage/rate rejections and selected 5xx
availability rejections **before any response output**. Auth, billing, policy,
invalid requests, refusals, transport failures and interrupted streams stop.
Retries honor `Retry-After`; a long hint skips retrying the rejected target and
extends its cooldown. A successful fallback stays local to its conversation/agent
until cooldown expiry or explicit model change/reset. State is in memory and
resets on launcher restart/resume. Native fallback chains remain available when
Claudapter rules are disabled; combining both owners is rejected.

Enabled rules also pre-empt a provider whose fresh quota window reports at least
95% usage: such a target is skipped before its request is sent, so a turn is not
started on an almost-exhausted provider. Quota telemetry alone never refuses a
request — the last target of a chain is always attempted — and unknown or stale
quotas disable pre-emption for that provider.

```sh
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
`[Claudapter]` notices report route deviations (fallback, interrupted output), and discovery
reports requested versus actual model; routine per-request routing lines are opt-in with
`CLAUDAPTER_ROUTE_LOG=1`. Claude's picker/status may continue showing the requested model
during fallback.

## Other providers and account modes

`claudapter provider add` configures an HTTPS Anthropic-compatible endpoint,
explicit models/capabilities and a dedicated environment variable containing its
key. The key itself is never requested in an argument or written to config.
Built-in account credential variables cannot be reused for another provider.
Compatible providers receive only their own credentials; redirects are refused.

`claudapter provider add zai` applies the documented Z.ai preset: the
Anthropic-protocol endpoint `https://api.z.ai/api/anthropic`, the key variable
`ZAI_API_KEY`, and the documented GLM-5.3 (text-only) and GLM-5.3-Flash
(multimodal) models with their 1M context. The wizard prints and confirms the
model list before writing anything.

Only the fixture provider path and the preset's documented values have been
verified; no paid account was added.

For ChatGPT-only mode set `"claude": false` and start with an explicit catalog
GPT model. A local placeholder credential starts Claude Code without a Claude
login and is never sent to Anthropic. Native Claude-only auxiliary features may
be unavailable. For Claude-only mode set `"chatgpt": false` and leave agents and
cross-provider fallback empty.

## Ollama local models

Every launch auto-detects a local [Ollama](https://ollama.com) server: `GET
/api/tags` names the installed models and `POST /api/show` supplies each
model's capabilities and trained context, so every installed model — including
newly pulled ones — appears in `/model` without any configuration. Discovery
re-runs on `/refresh`, and the registry drops models you remove. Requests use
Ollama's Anthropic-compatible `/v1/messages` endpoint directly (the same
passthrough transport as Z.ai); no credential is sent, and exact token counting
is refused with 501 because Ollama has no count_tokens endpoint.

The server address resolves from the optional `ollama` config section, then
`OLLAMA_HOST`, then `http://127.0.0.1:11434`. Plaintext `http` is only accepted
for loopback and private-network addresses; public servers need `https`.

```json
"ollama": { "baseUrl": "http://127.0.0.1:11434" }
```

Set `"ollama": { "enabled": false }` to switch auto-detection off. Two honesty
rules apply. First, the catalog reports each model's *trained* context
(`<arch>.context_length`); the window the Ollama server actually loads can be
smaller (`OLLAMA_CONTEXT_LENGTH`, default 4096) and truncates input silently —
raise the server window to match the models you use. Second, Claude Code only
accepts per-model windows between 100k and 1M tokens: models below that floor
are still listed and selectable, run under the session ceiling, and are named
in a launch notice; `/model` marks them accordingly.

## Provider usage and maximum context

```sh
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
still apply. See [context evidence](internal/context-evidence.md).

## Environment variables

| Variable | Effect |
| --- | --- |
| `CLAUDAPTER_HOME` | Absolute directory for Claudapter's own configuration (default `~/.claudapter`) |
| `CODEX_HOME` | Codex login and model cache (default `~/.codex`) |
| `OLLAMA_HOST` | Ollama server address when the `ollama` config section does not set one |
| `CLAUDAPTER_TRACE=1` | Diagnostic routing traces (model IDs, scopes, statuses; never bodies or credentials) |
| `CLAUDAPTER_ROUTE_LOG=1` | Routine per-request routing lines; implied by `CLAUDAPTER_TRACE` |
| `CLAUDAPTER_REDUCED_MOTION=1` | TUI: freeze spinners, scanners and dialog fades |
| `NO_COLOR` | TUI: hue-free palette |

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
- Diagnostic traces are opt-in with `CLAUDAPTER_TRACE=1`, which also enables the routine
  routing lines of `CLAUDAPTER_ROUTE_LOG=1`. They contain model IDs,
  scopes, statuses and tool names, never conversation bodies or credentials.
- Credential snapshots in optional live-test directories must be kept private and
  removed after testing. Standard `npm test` uses fake credentials and isolated homes.

## Uninstall

```sh
npm uninstall --global claudapter
```

Remove `~/.claudapter` separately if you no longer want its non-secret policy
configuration and profile slots (profile slots contain their own logins). Claude and
Codex settings, plugins and logins belong to their official tools and are not removed.

# Claudapter — project brief and execution mandate

This document is the initial product specification and execution context for a new, independent project. Read it fully before implementation. Treat implementation suggestions as starting decisions that can be improved with evidence; preserve the product requirements and acceptance criteria.

## Mission

Build **Claudapter**, a local CLI launcher that runs the user's installed Claude Code in the current project directory and lets the user switch between Claude, ChatGPT/Codex models, and supported additional providers through Claude Code's native `/model` picker.

The initial release also includes explicitly configured provider fallback, GPT-backed native Claude Code subagents, and accurate model/agent availability information for the main session. These are required product features, not deferred ideas.

Tagline: **Your Claude Code. Your choice of models.**

The user wants implementation, not another proposal or a scaffold-only delivery. Build, test, package, install locally where appropriate, and demonstrate the actual workflow. Do not claim success from mocked tests alone. If live verification requires the user's interactive login or terminal interaction, complete all independent work and explain the exact remaining action and evidence gap.

Claudapter is the working product name. Preliminary web searches found no clear matching project, but npm, domain, and trademark availability have NOT been established. Do not claim exclusivity or availability. Do not publish or reserve anything without explicit authorization.

## User and collaboration context

- The user is Jonas, working primarily on Windows with PowerShell and Windows Terminal. Communicate with him in German; write identifiers, comments, documentation, CLI messages, and commit messages in English.
- Work in the main agent. Do not delegate or spawn subagents unless Jonas explicitly requests it for this task.
- Execute ordinary reversible development work autonomously. Do not repeatedly ask for permission for already-authorized implementation, testing, builds, or local setup.
- Preserve unrelated changes and concurrent work. Never sweep unrelated files into commits.
- Do not alter global Claude Code settings, overwrite shell profiles, replace the `claude` command, reset credentials, or change default permissions as an incidental setup step.
- Do not purchase services, publish packages, create remote repositories, or send messages to others without explicit authorization.

## Workspace and reference implementation

New project root: `E:\DEV\claudapter`.

Reference repository: **`E:\DEV\rookery-agent`**. It is a separate, working project. Inspect its current source and applicable instructions before reusing code. Treat it as read-only for this task unless Jonas explicitly expands scope. Rookery must keep working on its existing implementation during Claudapter development.

Rookery already launches Claude Code and injects a local model gateway plus picker entries. Extract the useful transport behavior, not its assistant runtime. Claudapter must have no runtime dependency on the Rookery checkout, database, server, workspace, persona, memory, organization system, or MCP bridge.

Relevant files observed during planning (verify current contents; line numbers and behavior may change):

| Reference file under Rookery | Role |
| --- | --- |
| `packages/core/src/providers/model-gateway.ts` | Routes Messages requests by model to Anthropic, the Codex bridge, or direct provider profiles |
| `packages/core/src/providers/codex-bridge.ts` | Loopback Anthropic Messages endpoint backed by the ChatGPT Codex backend; streaming and credential forwarding |
| `packages/core/src/providers/codex-translate.ts` | Pure Messages-to-Responses request translation and Responses-to-Messages streaming translation |
| `packages/core/src/providers/codex-auth.ts` | Reads the Codex session, refreshes tokens, respects `CODEX_HOME` |
| `packages/core/src/providers/provider-catalog.ts` | Provider profiles and account model catalog derived from Codex's model cache |
| `packages/core/src/providers/loopback-server.ts` | Random loopback port, per-start token, server lifecycle and cancellation helpers |
| `packages/core/src/providers/claude-code.ts` | `#commandEnv` supplies gateway configuration; `composeSettings` adds `modelPicker.options` |
| `packages/core/src/assistant/terminals.ts` | `#startGateway` assembles available provider models and picker entries |
| `packages/core/test/codex-translate.test.js` | Translator regression coverage |
| `packages/core/test/codex-bridge.test.js` | Bridge regression coverage |
| `packages/core/test/gateway.test.js` | Inspect the actual scope before assuming it tests model-gateway behavior |

Preserve applicable MIT attribution and license notices when adapting code. Use selected source files and tests, not a wholesale copy of the Rookery repository.

### Observed mechanism

1. Claude Code speaks Anthropic Messages to one `ANTHROPIC_BASE_URL`.
2. Rookery points that URL at a local gateway.
3. For Claude requests, the gateway forwards the caller's existing Claude authentication to Anthropic.
4. For ChatGPT requests, a bridge translates Messages to Responses and uses a Codex login session. The observed upstream is `https://chatgpt.com/backend-api/codex/responses`; verify against current upstream code before depending on it.
5. Direct, Anthropic-compatible provider profiles receive their own credentials instead of the user's Claude credentials.
6. A separate custom header carries the local gateway token, leaving Claude's own authentication available for Anthropic passthrough.
7. Additional picker rows are passed through temporary settings as `modelPicker: { options: [...], replaceBuiltInOptions: false }`.

This is a compatibility integration, not a promise of officially supported interoperability between Claude Code and ChatGPT subscriptions. Credential handling, backend protocols, and model behavior can change. Keep that dependency isolated and describe compatibility honestly.

### Known limitations to investigate rather than copy blindly

- Rookery's token refresh coalescing is process-local. Multiple launchers and a concurrently running Codex process require a carefully validated strategy. A lock understood only by Claudapter does not coordinate with Codex itself.
- The observed auth implementation assumes a file-backed Codex session. Check supported credential storage modes; do not claim keychain support without implementation and verification.
- The translator's effort mapping is limited and may omit newer request fields. Audit reasoning, tool choice, tool schemas, images, usage accounting, and unsupported content blocks.
- Unknown models must not silently resolve to another model or provider.
- Body limits, authentication-before-expensive-work, request timeouts, allowed routes, cancellation, header isolation, and redacted errors need explicit review.
- ChatGPT-only use without a Claude subscription is an important compatibility scenario. Prove how Claude Code is launched and authenticated in that case; do not assume the passthrough setup covers it.

## Product experience

Planned commands (not existing commands):

```text
claudapter setup
claudapter
claudapter -- --continue
claudapter -- --resume
claudapter -- --model <model-id>
claudapter models
claudapter providers
claudapter provider add
claudapter doctor
```

`claudapter` launches the real installed Claude Code in the caller's directory with inherited terminal input/output. Preserve exit codes, interactive behavior, and native CLI arguments. Use `--` as an unambiguous pass-through boundary. Do not introduce an alternate chat UI.

Setup detects installed tools and supported existing sign-ins. Initial Claude and Codex authentication should use their official login commands. Do not suggest an OpenAI API key as a replacement for the ChatGPT subscription flow. Explicitly configured additional providers may use their own keys.

Normal Claude configuration must remain usable: user/project settings, `CLAUDE.md`, skills, plugins, MCP servers, hooks, and permissions. Preserve the native configuration directory and current working directory. Reuse user configuration through Claude Code itself where possible rather than reimplementing its entire loader.

No Rookery system prompt, assistant persona, hidden permission escalation, or account pooling. A model switch is either a deliberate user action or the execution of an explicitly enabled fallback policy. Always distinguish the requested model from the model actually called; never silently substitute one for the other.

## Configurable provider fallback

Fallback is off until the user enables a policy. Once enabled, execute that policy automatically without asking for confirmation on every matching failure. Configuration must specify the ordered model/provider targets, eligible error classes, bounded retries and timeouts, cooldown behavior, and whether it applies to the main session, particular subagents, or both. Only explicitly allowed providers and accounts may receive the conversation.

Primary use case: the user enables Claude as the primary backend and a particular available ChatGPT model as the fallback when Claude reaches a usage limit. Show a visible notice identifying the failure reason, requested model, and actual replacement. Keep the affected conversation on the replacement during the configured cooldown, with an explicit return/reset action, rather than hitting the exhausted provider on every request.

Implementation requirements:

- Verify native Claude Code fallback support and its error semantics for the installed version. At planning time, the official documentation described `--fallback-model` / `fallbackModel` chains for some availability/server failures, but not rate-limit, authentication, billing, request-size, or transport failures. Do not assume native chains implement subscription-limit fallback.
- Use native fallback where it meets the requirements; implement missing behavior in the gateway. Assign one owner to each retry/fallback decision so native retries and gateway policies do not multiply attempts or form loops.
- Classify errors explicitly. Handle eligible 429/usage-limit and availability errors according to policy and honor retry hints. Default to stopping on invalid credentials, billing problems, invalid requests, policy denials, and incompatible capabilities. Content refusals are not an availability-fallback trigger.
- Validate the target's context capacity, required tools, vision support, and other relevant capabilities before forwarding. Do not truncate conversation history silently to make a fallback fit.
- Automatic replay is allowed only at a proven safe boundary. After response content or tool calls have been delivered, do not silently start a replacement stream or replay actions. Report an interrupted turn or use a verified continuation mechanism that cannot duplicate tool side effects.
- Maintain fallback state per conversation/agent, not as one process-global model switch. A subagent failure must not change the main session's route or another subagent's route. Prove how requests are attributed; do not guess session identity from the model name.
- Emit redacted routing events with requested model, actual provider/model, reason, and affected conversation/agent. A gateway reroute does not automatically update Claude Code's picker/status display; expose the distinction through a supported, non-disruptive notice/status mechanism and document any UI limitation. Never inject notices into protocol content in a way that corrupts streaming.
- Persist only intentional non-secret policy configuration. Define resume behavior and policy precedence. Untrusted project content must not broaden provider permissions or enable fallback.

## GPT-backed subagents

Support a Claude main conversation delegating to a native Claude Code subagent whose requests are answered by a configured GPT model through the gateway. This is a Claude Code subagent with GPT inference, not an independently spawned Codex CLI runtime.

Provide optional generated definitions such as `gpt-implementer` and `gpt-reviewer`, with explicit model IDs from the registry, useful task descriptions, and normal Claude Code tool permissions. Load them through supported session-scoped mechanisms such as a generated plugin or documented agent definitions; do not overwrite existing user agents or globally remap Claude model aliases to GPT.

- Verify the installed version accepts the custom model ID in subagent definitions and routes its requests through the gateway. Current documentation describes full model IDs and per-invocation overrides, but cross-provider operation must be tested end to end.
- Preserve existing agents, permission restrictions, and tool configuration. Handle name collisions explicitly and avoid global force-model settings that would redirect unrelated agents.
- Confirm that results return to the main session and that follow-up/resume retains the intended backend. Account for native model overrides and allowlists; a request for GPT must not silently be reported as successful if Claude Code substituted another model.
- Apply subagent fallback only if the user enabled it for that scope. Show the actual model used for each agent and keep its route independent of the main session.
- Availability is not permission to delegate. Preserve Jonas's preference that agents are launched only when he explicitly requests delegation. Developing this feature does not authorize the implementing coding assistant to delegate its own work. Dedicated product acceptance runs may exercise a subagent when their test prompt explicitly requests it.

## Main-session awareness of available models and agents

Picker entries alone are not sufficient evidence that the responding model knows which backends or agents exist. Generate a concise capability manifest from the same registry that drives routing, picker entries, and agent definitions, and make it available to the main session through a supported additive context mechanism.

The manifest must identify configured model IDs and providers, known capabilities, catalog freshness, auth readiness, available agent names and purposes, and the user's delegation/fallback policy. Distinguish configured, authenticated, recently verified, temporarily unavailable, and unknown states; a cached model entry does not prove current availability. Include no credentials, tokens, private headers, or unnecessary account details.

Provide a supported read-only discovery/refresh mechanism for the session to inspect current availability and actual routing state. If implemented as an MCP tool, keep it separate from execution permissions. Refresh on startup and relevant provider/catalog/agent changes; invalidate stale claims after authentication failures or cooldown changes. Define how a running session learns updates without replacing the user's system prompt or instructions.

Example intended knowledge: “The `gpt-reviewer` agent is configured to use model X through ChatGPT. Invoke it when the user requests an independent review. Provider fallback is enabled only for these targets and error classes.” Descriptions communicate availability and policy; they must not mandate unsolicited delegation or advertise unsupported capabilities.

## Architecture decisions

Start with one TypeScript/Node.js npm package, ESM, with a CLI entrypoint and an internally separable gateway library. Choose and document a currently supported Node baseline after inspecting requirements. Avoid a monorepo, UI framework, database, or service manager unless a demonstrated requirement warrants one.

Suggested structure:

```text
src/
  cli/
  launcher/
  gateway/
  providers/
    anthropic/
    chatgpt/
    compatible/
  models/
  config/
test/
  fixtures/
```

For v1, use one gateway per launched session, bound only to `127.0.0.1` on a random port with a high-entropy temporary token. No always-on daemon is required. Child termination must cancel upstream work and release sockets and temporary files. Test Windows process and signal semantics instead of assuming Unix behavior.

Credential refresh may require a separate coordination design even with per-session gateways. Evaluate supported upstream auth mechanisms first. Do not invent a home-grown OAuth client or ship brittle shared-file writes as a finished solution. Detect unsupported configurations and produce actionable diagnostics.

Each provider adapter must expose a small, explicit contract for model enumeration, auth readiness, capabilities, and request handling. Keep translation functions pure and testable. Claude passthrough should preserve supported request bodies and necessary headers; redact or remove local and foreign-provider credentials before forwarding.

## Model registry and settings

Use one model registry for routing, picker construction, fallback validation, agent definitions, session capability manifests, and diagnostics. Entries contain provider identity, upstream model ID, display label, verified capabilities, context limits where known, and catalog source/freshness. Handle collisions and unavailable or stale catalogs explicitly. Do not fabricate a model list or usage figures.

Prefer `modelPicker.options` for additional models, preserving built-in Claude options as appropriate for the connected accounts. Gateway discovery is not a universal substitute: Claude Code versions can filter model IDs. Verify current documentation and installed behavior.

Generate temporary launch settings without permanently rewriting `~/.claude/settings.json`. Respect existing custom picker entries, explicit `--settings`, and environment precedence. Detect conflicting gateway/provider settings and explain them rather than silently hijacking the session.

Document and test `/model` persistence: Claude Code can save a selected default in its own settings. Determine how launcher-added models affect a later plain `claude` launch. Do not claim global state is untouched simply because the launcher writes no global file itself. Do not race other sessions by blindly restoring a settings backup.

Store Claudapter configuration under its own home, for example `~/.claudapter/config.json`. Keep secrets out of ordinary config, command arguments, logs, fixtures, and repository files. Use a credential-store abstraction with an explicitly documented platform strategy. Project-controlled files must not redirect existing account credentials to arbitrary destinations.

Context limits and effort settings need per-model treatment. A single global context variable must not misrepresent every model after a switch. Support only mappings proven for the relevant Claude Code version; report remaining limitations.

## Scope and milestones

### Milestone 1 — prove the core workflow

- Inspect current Rookery source and current official Claude/Codex references.
- Build the smallest independent launcher with Claude passthrough and ChatGPT translation.
- Start the real Claude Code in a disposable project.
- Demonstrate Claude → GPT → Claude through `/model`, including a real tool cycle.
- Spike a Claude main session calling a GPT-backed native subagent and receiving its result. Verify request attribution and safe fallback boundaries before committing to the fallback state design.
- Record exact versions and observed limitations. A failed spike must inform the implementation plan before expansion.

### Milestone 2 — independent, tested implementation

- Extract/adapt only the required modules and meaningful regression tests.
- Eliminate Rookery-specific types, singleton coupling, and runtime dependencies.
- Define provider contracts and strict routing.
- Implement the fallback policy/state contracts, request attribution, and shared model/agent capability registry with isolated tests.
- Implement bounded HTTP handling, streaming, auth isolation, and cancellation.
- Ensure automated tests use isolated homes and fixture credentials, never the developer's installations.

### Milestone 3 — normal daily use

- Implement setup, provider configuration, model listing, and doctor.
- Add fallback configuration, visible routing notices, optional GPT agent definitions, and a concise main-session capability manifest with read-only refresh/discovery.
- Preserve native Claude settings, plugins, MCP, hooks, permissions, and resume behavior.
- Support multiple simultaneous launcher sessions with a verified credential-refresh strategy.
- Validate launch and cleanup under Windows/PowerShell, including paths with spaces.
- Add one explicitly configured Anthropic-compatible provider path; test it with fixtures and live only when an authorized account is available.

### Milestone 4 — compatibility and failure handling

- Verify model changes after tool use, long conversations, and provider-specific thinking content.
- Handle unsupported content explicitly; never silently discard semantically important input.
- Test expired credentials, upstream errors, 429s, malformed streams, dropped connections, cancellation, oversized input, and shutdown.
- Publish a factual compatibility matrix for tested models/features/Claude Code versions.
- Validate ChatGPT-only and Claude-only account setups independently.
- Verify configured fallback under controlled limit/outage injection, including cooldown, exhausted chains, incompatible targets, and the absence of unsafe replay after partial output.
- Verify GPT subagent tool use, result delivery, follow-up/resume, main/subagent route isolation, and accurate session awareness when availability changes.

### Milestone 5 — distributable local release candidate

- Produce an npm tarball and install/test that artifact outside the development checkout.
- Add CI for Windows, macOS, and Linux; distinguish configured CI from actually passing remote runs.
- Document install, login, model switching, fallback policy and its data-routing implications, GPT subagents, availability discovery, configuration precedence, troubleshooting, limitations, and uninstall.
- Provide a reproducible demo and a concise final report of tests and live evidence.
- Do not publish to npm or GitHub without a separate explicit instruction.

## Acceptance tests

Core end-to-end scenario: in a disposable project, Claude analyzes a small coding task; GPT edits a file and runs a real test; Claude reviews the resulting diff. Exit, resume the conversation, and continue. Verify backend model identity through redacted routing diagnostics rather than asking the model what it is.

Subagent scenario: keep the main session on Claude, explicitly request the registered GPT implementer/reviewer, verify a real tool cycle on the GPT backend, and confirm that its result returns to Claude. Resume or follow up with that agent and verify the model again. Do not substitute a main-session model switch for this test.

Fallback scenario: enable an explicit Claude-to-ChatGPT policy and inject a controlled eligible error at the upstream boundary, without deliberately exhausting real account quotas. Verify the replacement response, visible reason and model, cooldown behavior, and independent main/subagent routing. Label simulated failures as simulated; separately establish that the real replacement backend works.

Additional meaningful checks:

- Native interactive terminal remains usable; Ctrl+C and process exit clean up resources.
- Existing `CLAUDE.md`, one harmless hook, one skill/plugin, and one MCP tool remain functional.
- Permissions remain at the user's chosen level; no bypass flag is added.
- Two sessions can work concurrently without credential corruption or crossed model routing.
- Tool call IDs and tool results survive translation and model switching.
- Text streaming, supported image input, error termination, and usage accounting are correct.
- Unknown models fail explicitly; no unconfigured provider fallback or invented token/cost metrics.
- Fallback disabled means no provider switch. Enabled policies visit only allowed compatible targets with bounded attempts, respect cooldown/reset behavior, and stop clearly when exhausted.
- Partial streams and tool calls cannot cause duplicate actions through replay. Auth errors, policy denials, and content refusals are not misclassified as eligible outages.
- GPT subagents use the verified configured backend, return results, and preserve permissions and resume behavior. Their failures and fallback state do not reroute unrelated agents or the main session.
- The main session can discover actual configured models and agent names from generated context and refresh tools, without exposing secrets or overriding the user's delegation preference. Missing/expired accounts are reported accurately rather than advertised as ready.
- Routing notices and diagnostics identify actual models even when native Claude Code status continues to show a requested model.
- Requests without the expected local authorization cannot use stored provider accounts.
- Credentials cannot cross provider boundaries or leak through logs/errors.
- Automated tests cannot read or mutate real `~/.claude`, `~/.codex`, or Rookery data.
- Installation from the packed artifact works without the source checkout or Rookery.

Use focused unit tests for translation and fallback decisions, integration tests with mock upstream servers for transport, auth, and failure injection, and real interactive checks for product behavior. Live checks may spend the user's existing subscription quota; avoid broad repeated calls and never introduce additional paid fallback providers without explicit authorization.

## External references to verify

- Claude model configuration: https://code.claude.com/docs/en/model-config
- Native fallback chains: https://code.claude.com/docs/en/model-config#fallback-model-chains
- Subagent model selection: https://code.claude.com/docs/en/sub-agents#choose-a-model
- Gateway connection: https://code.claude.com/docs/en/llm-gateway-connect
- Gateway protocol and discovery: https://code.claude.com/docs/en/llm-gateway-protocol
- Official Codex source: https://github.com/openai/codex
- Similar project for comparison: https://github.com/johnlindquist/claudex

Use primary documentation and upstream code for technical facts. A competitor README establishes a comparison point, not proof that an auth approach is supported or safe to copy. Do not use unverified remembered model names or hardcode account availability.

## Start here

1. Inspect this directory, parent instructions, Git status, installed runtime, and relevant Rookery source without changing Rookery.
2. Write a concise `AGENTS.md` for this new project and a tracked implementation checklist that preserves this brief's acceptance criteria.
3. Initialize the project as needed and execute Milestone 1 immediately.
4. Continue through the remaining milestones, adapting implementation details to observed evidence.
5. Keep the user informed of concrete findings and blockers. Ask only for genuinely missing decisions, interactive authentication, or actions beyond the authorized scope.

Completion means a working independent local release candidate with evidence and clearly identified residual limitations. A scaffold, architectural diagram, passing mocks, or another plan alone is not completion.

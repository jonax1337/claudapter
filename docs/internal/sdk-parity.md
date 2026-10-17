# Claude Code engine and TUI integration evidence

Checked on 2026-10-16 against installed Claude Code **2.1.301**, TypeScript Agent SDK **0.3.301**, the official SDK documentation, CLI help, and the installed SDK type declarations. This document describes available integration mechanisms; it is not an assertion that every corresponding Claudapter dialog has been implemented or verified.

## Verified without model inference

`.artifacts/sdk-spike/spike.mjs` starts the installed executable with a fixture home, fixture API key and an unreachable loopback inference endpoint. `.artifacts/sdk-spike/result.json` records the result:

- Initialization identifies Claude Code 2.1.301.
- A project fixture skill and agent are discovered through user/project/local setting sources.
- `setPermissionMode('plan')` succeeds.
- `getContextUsage({detail:'summary'})` succeeds without a reachable model endpoint. It reports model, categories, total tokens, raw/model capacity, compaction capacity and threshold.
- Changing to an unrecognized model with `setModel()` validates through the network and fails with `check_failed` when the endpoint is unreachable. The gateway must support this path.
- No inference prompt was submitted. These checks do not prove streaming, tool execution, approvals or live provider compatibility.

## Engine configuration

Use a persistent streaming-input query, the installed executable and the existing gateway environment:

```ts
query({
  prompt: userMessageAsyncIterable,
  options: {
    cwd: process.cwd(),
    pathToClaudeCodeExecutable: installedClaudePath,
    env: { ...process.env, ...gatewayEnvironment },
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    plugins: [{ type: 'local', path: temporaryClaudapterPlugin }],
    includePartialMessages: true,
    forwardSubagentText: true,
    includeHookEvents: true,
    enableFileCheckpointing: true,
    canUseTool: showOwnPermissionOrQuestionDialog,
    onElicitation: showOwnMcpElicitationDialog,
  },
});
```

Leave tool restrictions, permission bypasses, MCP strict mode, and skill allowlists unset. Existing user/project rules, hooks, skills, agents and configured MCP servers then remain part of the engine. SDK `env` replaces, rather than merges, the child environment. Session persistence defaults to enabled. SDK/print mode skips the native workspace trust dialog, so an own TUI must explicitly handle trust before executing project hooks/MCP or clearly constrain launch to trusted projects.

## Own dialogs and their backing operations

| Own surface | Backing operation | Boundary |
| --- | --- | --- |
| Model and effort | `supportedModels()`, `setModel(id)`, `applyFlagSettings({effortLevel})` | Model switch can validate via network; runtime setters do not need to change a global default. |
| Commands and skills | `supportedCommands()`, command prompts, `reloadSkills()`; replace list on `commands_changed` | An unknown slash command can spend a model turn. Validate before forwarding. |
| Config | `resolveSettings({cwd})` for effective values/provenance; `applyFlagSettings()` for current-session overlay | Redact secret-bearing env/headers. SDK `updateSettings()` only supports local `outputStyle` or user `effortLevel`, not a general settings editor. Other persistent settings require a scoped, validated, atomic file edit. |
| Permissions | Effective settings and provenance; `setPermissionMode()`; `applyFlagSettings({permissions: ...})` | Preserve deny/ask and managed rules. Never turn on bypass implicitly. Rules added only to the overlay need not persist. |
| Approval prompt | `canUseTool(toolName,input,options)` | Display complete relevant input and reason; honor abort, request identity, `defaultToNo`, and `suppressAlwaysAllowRule`. |
| Clarifying questions | `canUseTool` for `AskUserQuestion` | Return `updatedInput` retaining original questions plus `answers` keyed by full question text; support multi-select and free text. |
| Plan mode | `setPermissionMode('plan')`, permission callback for `ExitPlanMode` | Entering/exiting a plan cannot silently accept implementation permissions. |
| MCP status | `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()` | Retains configured/plugin servers. |
| MCP add/edit/remove | `setMcpServers()` for session additions; `claude mcp add-json/remove` for explicit persistent changes | `setMcpServers()` replaces SDK/dynamic server set, not all settings/plugin servers. |
| MCP authentication | Spawn `claude mcp login <name> --no-browser`, render URL and accept redirect in own dialog | Browser OAuth remains interactive. Never log code or redirect token. |
| MCP elicitation | `onElicitation(request,{signal})` | Form and URL modes differ. Missing callback declines. Treat URL as external, untrusted input. |
| Plugins | `claude plugin list --json`, `details`, `configure`; install/enable/disable/uninstall subcommands; `reloadPlugins()` | Changes may be persistent and plugin installation runs external code. Display scope/action explicitly. A reload may affect prompt cache or need a restart. |
| Hooks | Scoped settings from `resolveSettings()`; own viewer/editor; `includeHookEvents:true` | A settings snapshot is not proof a hook executed. Render hook events separately. |
| Agents | `supportedAgents()`, agent markdown files, live task events | SDK definitions/agent files and prompt invocation retain native agent engine; agent teams are not a directly configured SDK feature. |
| Background tasks | `task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`; `stopTask(id)` and `backgroundTasks(toolUseId?)` | Set `perTaskStopAffordance:true` only when each task has a real Stop control. Otherwise interruption deliberately also kills background tasks. |
| Session picker/history | `listSessions({dir})`, `getSessionMessages(id,{dir,includeSystemMessages:true})`, `getSubagentMessages()` | Read-only metadata does not attach to an already running native terminal session. |
| Resume/branch/rename/tag | New query with `resume`; `forkSession()` or `forkSession:true`; `renameSession()`, `tagSession()` | Close/finish the old query intentionally. Never edit JSONL chains manually. |
| File rewind | `enableFileCheckpointing:true`; `rewindFiles(uuid,{dryRun:true})`, then confirmed `rewindFiles(uuid)` | Tracks Write/Edit/NotebookEdit, not Bash writes; generally not subagent edits. Files-only rewind does not truncate conversation. |
| Conversation rewind | Resume with `resumeSessionAt`; optional `resumeDropsTurn` safety check; `forkSession` for preserved original | Preserve UUIDs and offer preview. Do not imply file rollback unless performed separately. |
| Context | `getContextUsage({detail:'summary'})`, or full details on explicit request | Summary uses last API usage/local estimates. Full mode performs token-count requests; local estimates are not provider token counts. |
| Compact | Send `/compact [instructions]`; render `compact_boundary` and status events | This is actual model work; requires prior conversation. |
| Usage | Claudapter provider accounting; native `/usage` structured `usage_report` if account qualifies | Native account quota is not GPT or other-provider quota. SDK per-model cumulative usage must not be summed across results. |
| Memory | Own selector/editor for relevant CLAUDE.md/rules and auto-memory files; config for auto-memory | Use exact discovered paths; do not overwrite global files or reveal unrelated content. |
| Status | Own aggregate of engine version, active model, config provenance, MCP, plugins, tasks and routing | Distinguish requested model from actual provider/model after fallback. |
| Doctor | Capture `claude doctor` output in own view; `/doctor` is also a bundled agent skill | The read-only CLI check differs from the model-powered fixing workflow. |
| Login/logout | `claude auth status --json`, `claude auth login --claudeai`, `claude auth logout` | Status/help inspected; actual login not attempted. Own dialog can show subprocess progress, but the browser login requires user interaction and changes credentials only on explicit action. |
| Diff/export/copy | Read-only `git diff`/`git status`; SDK transcript; native platform clipboard | Exports disclose conversation to the chosen local file/clipboard; no automatic uploads. |
| Themes/focus/keybindings/help | Claudapter-owned renderer/config/dialogs | Native theme and keybindings describe a different UI; no automatic global Claude setting rewrite. |

## General dialog bridge limitations

The installed SDK exposes `onUserDialog` and `supportedDialogKinds`, although the downloaded reference did not include them. `UserDialogRequest` provides only `dialogKind`, opaque `payload` and optional `toolUseID`; results are `{behavior:'completed',result:unknown}` or `{behavior:'cancelled'}`. There is no public, exhaustive typed catalog or general form schema. Declare only kinds that the host actually understands and renders.

Read-only inspection of the installed executable found 38 named internal dialog registrations. Definitions are retained only in the ignored `.artifacts/sdk-spike/native-dialogs.json` research artifact. Their existence is not proof they are forwarded through headless mode, and internal schemas can change between versions.

In particular, native `local_jsx` carries a native component node ID and command name rather than a transferable view. It cannot deliver native settings/theme/other terminal panels to Ink. Those panels require the own handlers above; handing off to the native UI is not equivalent implementation.

The observed refusal fallback dialog contains original/fallback model, optional refusal category and guidance, and optional retracted message UUIDs. Its choices are retry fallback, edit prompt, and cancel. An adapter must not implement this as an automatic safety-refusal bypass, activate paid overage, or introduce replay after visible output. Unrecognized dialogs should fail closed, with an explanatory own-UI notice.

Additional native surfaces without a demonstrated public SDK-equivalent controller include cloud session teleport/attach, terminal-native agent view, voice mode, interactive IDE onboarding, account privacy/upgrade/passes, artifact/cloud selectors, native radio/power-up demos and parts of full native rewind summarization. Public API absence does not establish that the installed private protocol lacks an operation; the compatibility research below identifies additional usable methods. A complete parity claim requires implementing and testing each surface. Returning a pretty unavailable dialog is not feature parity.

## Sources

- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Loading Claude Code features](https://code.claude.com/docs/en/agent-sdk/claude-code-features)
- [SDK commands and skills](https://code.claude.com/docs/en/agent-sdk/slash-commands)
- [Approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- [File checkpointing limitations](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)
- [Native command inventory](https://code.claude.com/docs/en/commands)
- Installed SDK 0.3.301 `sdk.d.ts`, and installed Claude Code 2.1.301 `--help` plus `auth`, `plugin`, `mcp` subcommand help.

## Implemented native-dialog descriptions

`src/tui/native-dialogs.ts` provides pure, validated descriptions for 15 known dialog kinds. Every description defaults to decline/cancel/stay and preserves the exact protocol result shape. Paid-credit consent states that charges can occur; sandbox network approval is once-only and never writes an allow rule. Unattended-serving consent includes the complete supplied terms. Unknown or malformed kinds return `undefined`; opaque native JSX and internal permission objects are deliberately not advertised.

The mapping test `test/native-dialogs.test.mjs` passed all four tests after a complete TypeScript build. This verifies schemas, safe defaults and consent content. It does not prove that Claude Code forwards every registered kind in SDK mode or that the renderer handles every dialog interactively. Those remain end-to-end acceptance items for the parent TUI implementation.

## Pinned private compatibility adapter

Deeper inspection of the **installed SDK runtime**, rather than only its public declaration file, found additional concrete `Query` methods. `src/tui/compat.ts` exposes a narrow allowlist, checks SDK **0.3.301** and Claude Code **2.1.301**, validates response envelopes, and refuses every unknown method/version. It does not expose arbitrary raw control requests. These are private upstream interfaces: compatibility with a later CLI is intentionally refused until tested.

| Runtime method | Observed response / purpose |
| --- | --- |
| `getSettings()` | `{effective, sources, applied}`; includes the actual running model/effort alongside raw source settings. Redact secrets before display. |
| `getHooksListing()` | Full `/hooks` rows with event, matcher, command text, source, editable metadata, event catalog and policy state. |
| `listPermissionRules()` | `{state:{rules,workspaceDirectories,originalCwd,managedOnly}}`; rows retain source, exact rule spelling, behavior and editability. |
| `getMemoryDialog()` | `{files,folders,auto_memory,auto_dream}` with native-discovered paths and toggle state. |
| `getSkillsDialog()` | `{skills}` with state/source/lock metadata when skills are available. |
| `getStatus()` | `{sections}` containing display rows. |
| `getSandboxDialog()` | Supported/locked/enabled/mode/dependency/restriction state; the fixture correctly reported unsupported on native Windows. |
| `getPlan()` | `{exists:false}` in an empty session; populated-plan details require further acceptance. |
| `getChromeDialog()` | Allowed/subscriber/installed/connected/default/startup state and official URLs. |
| `exportConversation()` | `{text,default_filename}` without writing an export itself. |
| `getTaskOutput(taskId)` | Typed native response `{output,total_bytes,truncated}`; renderer must escape tool output. A running-task acceptance remains separate. |

The isolated real-engine probe `.artifacts/sdk-spike/private-control.mjs` successfully used the settings, hooks and permission methods. A session allow overlay did not remove existing project or policy deny rows; policy rows remained read-only. This demonstrates preserved native rule state, not a complete adversarial permission-enforcement test.

The own adapter was then exercised against the real installed executable by `.artifacts/sdk-spike/trust-wrapper-control.mjs`; all seven dialog/export getters in that script succeeded. Evidence is in `.artifacts/sdk-spike/trust-wrapper/result.json`. These probes used fixture homes and credentials and an unreachable loopback inference endpoint; no real model prompt was sent.

### Native-backed workspace trust

The earlier public-API search was incomplete: the pinned runtime accepts a hidden launch option:

```ts
workspaceTrust: { accepted: true, directory: absoluteDirectoryShownToUser }
```

`launchWorkspaceTrust(directory, accepted)` constructs that option after an explicit decision; the launcher must call `assertCompatVersion(installedVersion)` before constructing the query. The first initialization returns `workspace_trust_recorded: true` when the native engine accepted and recorded it. A host must verify that result rather than announce success unconditionally.

The installed CLI documents this internal option in its runtime schema as a host attestation to an actual user trust decision. The engine canonicalizes the directory, checks that it matches the session's trust root, and records trust through its own native writer. No Claudapter read/modify/write of `.claude.json` is required. Home-directory trust remains session-only. Project allow rules/hooks rederive immediately; plugins, agent-frontmatter features and other launch-time readers can require a fresh launch.

Real fixture proof: before acceptance, the fixture project allow rule was absent while its deny rule remained. On a new query with explicit fixture consent, `workspace_trust_recorded` was true, the allow rule appeared, the deny rule remained, and the private test home's native configuration contained the trust record for that fixture repository.

Changing directories uses hidden `setCwd(path, {trustAccepted?, trustedDirectory?})`. The native response is `ok`, `needs_trust`, or `rejected`. An untrusted fixture target returned `needs_trust` with its exact canonical directory; resending with explicit consent and that exact string returned `ok` and relocated the session. The adapter requires an outstanding challenge belonging to the same query/path and consumes it once. Same-directory `setCwd` is a successful no-op and does not establish trust: use the launch option for initial workspace trust.

### Authentication, browser and Remote Control adapters

Runtime source confirms these signatures; no real login, credential change, remote enabling or inference was performed to test them:

- `mcpAuthenticate(serverName, redirectUri)` → `mcp_authenticate`.
- `mcpClearAuth(serverName)` → `mcp_clear_auth`.
- `mcpSubmitOAuthCallbackUrl(serverName, callbackUrl)` → `mcp_oauth_callback_url`.
- `claudeAuthenticate(loginWithClaudeAi)` → `claude_authenticate`.
- `claudeOAuthCallback(authorizationCode, state)` → `claude_oauth_callback`.
- `claudeOAuthWaitForCompletion()` → `claude_oauth_wait_for_completion`.
- `enableRemoteControl(enabled, name?, options?)` → `remote_control`.
- `askSideQuestion(question, {history?,signal?})` → `side_question` and can perform inference.

The compatibility facade now wraps the authentication methods, browser selection and Remote Control with validated arguments and an explicit `confirmed: true` marker supplied only after the user chooses the corresponding action. Claude login is fixed to subscription login; the adapter offers no paid Console login mode, arbitrary callback target, refresh token or Remote Control work-secret override. MCP callbacks accept the full loopback callback URL generated by the native flow, with OAuth state and code/error fields; native handling still checks that it belongs to the active sign-in attempt. Authentication secrets belong only in the temporary dialog state, never in conversation history or logs.

`getChromeBrowsers()` returns browser rows with device ID, name and current-selection state; `selectChromeBrowser()` chooses a named device. With no connected browser, the real native engine rejects both operations. Missing-server MCP authentication/clear requests likewise fail before doing any authentication. Remote Control disable succeeded in the private fixture with no active bridge. The exact wrapped negative paths were exercised by `.artifacts/sdk-spike/method-wrapper-presence.mjs`; a successful real login, browser switch and Remote Control enable remain explicit user-interactive acceptance cases. The eight compatibility unit tests cover argument/confirmation gates and successful response contracts with mocks, not those live external workflows.

The hidden native editing subcommands `edit-permission-rules --json`, `edit-memory-settings --json`, `edit-hook`, and `edit-skill-overrides` are now integrated and fixture-tested. See [administration evidence](admin-evidence.md) for validated schemas, scope restrictions and preserved unrelated settings.

## Workspace helper acceptance and remaining gaps

`src/tui/workspace.ts` provides read-only tracked Git diffs and a separate untracked-file list. Git runs with paging, external diff, text conversion and filesystem monitoring disabled, optional index locks disabled, a 10-second timeout and a 2 MiB output cap. A real temporary-repository test confirmed both staged/unstaged output and an unchanged index.

The additional-directory helper reads the running flag-settings source and appends only to its `permissions.additionalDirectories`; it does not copy effective permission rules from other scopes into trusted flags. It verifies the resulting native working-directory list. Output styles come from the native refresh/catalog and apply to the current session; the helper verifies the effective result. Both helpers passed a real isolated SDK probe (`.artifacts/sdk-spike/workspace-control.mjs`) without changing the fixture settings files. Three unit/integration tests also pass, including refusal to report success when native policy ignores a requested grant/style.

Changing the active working directory is **not integrated**. The existing controller keeps its launch directory for session metadata, attachments, exports and administration, and the launcher validates that directory's settings for conflicting gateway environment overrides. Moving only the native engine would bypass equivalent validation of the new project's environment and leave stale host state. A complete `/cd` needs coordinated host/engine state and target revalidation or a deliberate restart; the low-level native trust capability alone is not a complete feature.

Do not describe the present TUI as full native UI parity. Additional own surfaces still need implementation/acceptance where applicable: native cloud/environment/artifact selectors, privacy/upgrade/pass management, IDE onboarding, voice, side questions, native tutorial/demo views, and every option of native checkpoint summarization. Availability is account/platform dependent. Missing UI integration is distinct from a backend capability being absent; this research does not establish that the private native protocol cannot support these features. Configurable frontend keybindings are implemented separately in `preferences.ts` and the own `/keybindings` dialog.

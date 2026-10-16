# Release candidate verification

Verification date: 2026-10-16, Windows, PowerShell, Node.js 24.20.0,
Claude Code 2.1.301, Codex CLI 0.163.0. This file separates observed behavior
from protocol documentation and remaining limitations. No external publication
or remote CI execution occurred.

## Automated evidence

`CLAUDAPTER_NATIVE_TEST=1 npm test`: **43 passing tests**, including the actual
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

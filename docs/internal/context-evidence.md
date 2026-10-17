# Maximum model context evidence

Verified on 2026-10-16 with installed Claude Code 2.1.301 and Agent SDK 0.3.301.

## Catalog contract

Claudapter chooses a valid `max_context_window` from the Codex account catalog,
falling back to a valid `context_window`. It preserves both values as
`maxContext` and `defaultContext`, plus `contextSource` and catalog freshness.
Capacities must be safe integers of at least 1,024 tokens. A maximum below the
default remains the ceiling; malformed values cannot enlarge the window.

Codex upstream describes `max_context_window` as the ceiling for configuration
overrides and clamps an override to that ceiling. This is catalog metadata,
not proof that an account successfully processed a maximum-sized conversation.
Sources: [model schema](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs)
and [override application](https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/model_info.rs).

## Native engine integration

`nativeContextSettings()` supplies a process ceiling through
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` and individual `modelSettings` entries with
`autoCompactWindow`. Known Claude model IDs retain native behavior. Per-model
windows accept 100,000 through 1,000,000 tokens. Unknown capacities and mixed
capacities that cannot be represented are rejected explicitly.

Official references: [gateway context configuration](https://code.claude.com/docs/en/model-config#correct-the-window-for-a-gateway-or-custom-model-id),
[per-model settings](https://code.claude.com/docs/en/settings-reference#modelsettings),
and [SDK context inspection](https://code.claude.com/docs/en/agent-sdk/typescript#sdkcontrolgetcontextusageresponse).

## Observed native behavior

An isolated SDK session used fixture authentication and a non-listening loopback
endpoint. No model generation or account quota was needed. `getContextUsage`
with `detail: 'summary'` returned:

| Selected model | Process ceiling | Per-model window | Native maxTokens / rawMaxTokens |
| --- | ---: | ---: | ---: |
| fixture-context-large | 872,000 | 872,000 | 872,000 / 872,000 |
| fixture-context-small | 872,000 | 272,000 | 272,000 / 272,000 |
| claude-sonnet-5-5 | 872,000 | unset | 1,000,000 / 1,000,000 |

A separate check changed the ceiling during the same process with
`applyFlagSettings({env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:'400000'}})`; an unknown
model with no per-model entry immediately reported 400,000. A process ceiling
must still accommodate concurrent native subagents; changing it just for the
main agent is therefore not the integration strategy.

The opt-in regression is in `test/context.test.mjs`. Set
`CLAUDAPTER_NATIVE_TEST` to the installed Claude executable path and run it after
building, using the test isolation preloader. Ordinary tests do not read account
catalogs or launch Claude.

## Remaining evidence boundaries

These checks verify native context calculation and model switching, not a
near-capacity generation or long-session compaction. The native engine reserves
space for output and compaction, so the catalog ceiling is not a promise of that
many user-input tokens. The observed fixture sessions reserved 33,000 tokens.
Concurrent subagent inference at different capacities remains an integration
acceptance test. Explicit user or managed compaction settings can impose a lower
effective window and must be reported rather than called the maximum.

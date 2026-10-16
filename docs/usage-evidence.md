# Provider-aware usage evidence

## Contract

`GET /usage`, `POST /usage/refresh`, and `GET /status` (`usage`) require the
gateway's existing local token. The ledger lives in memory for one gateway
lifetime. It is not an account-wide token history, and restarting or resuming in
a new gateway starts new totals. The latest 200 attempts are retained; grouped
totals cover the whole lifetime. Active concurrent requests are retained until
finished even if more than 200 are pending.

Every inference attempt has a unique ID, requested model, routed model, upstream
model, provider, session, agent and request class when the caller supplies those
headers. A response-reported model is recorded separately. Native aliases and
configured gateway aliases therefore remain distinguishable from upstream IDs.
Fallback failures and replacement attempts are separate records. Missing scope
headers stay absent rather than being guessed. Token-counting calls are excluded.

Only complete upstream usage enters token totals. Rejected, interrupted, missing
or invalid usage is counted as unknown, never as a free request. Tokens count
at the upstream transport boundary once; SDK aggregate model/session usage is
not added again. Anthropic cumulative SSE usage replaces earlier values instead
of summing them. Input includes cache reads and writes; cache and reasoning
fields are subsets, not additional tokens to add to totals. The latest complete
attempt's input is appropriate for a context indicator; lifetime input is not.

Quota snapshots are separate from token totals and cover the account, including
other sessions and devices. All configured providers appear, including ones
without a quota adapter. `unknown` does not mean unlimited. Snapshot timestamps
and `stale` accompany each provider. Refresh is coalesced and cached for at least
60 seconds, honors numeric Retry-After, and uses bounded fixed-origin GETs with
redirects disabled. No inference, credit redemption or token rotation is used
to query quotas. No credentials, account IDs or raw provider responses enter
snapshots. Costs remain unknown: native Claude API-price estimates are not
relabelled as ChatGPT subscription charges or added to provider totals.

The native Claude Code `/usage` screen remains owned by Claude Code. Claudapter's
provider dashboard reads the shared ledger and quota snapshots; it does not
pretend that Claude's native account bars describe every provider.

## Interfaces and evidence

- **Documented:** [Anthropic cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  defines input as uncached input plus cache creation and reads.
- **Documented:** [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
  defines message-delta token counts as cumulative.
- **Official upstream code:** [Codex quota requests](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)
  uses `/wham/usage` for the ChatGPT backend. Claudapter uses only the GET,
  without reserve or reset-credit opt-ins.
- **Official upstream types:** [Quota payload](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs)
  and [additional meters](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/additional_rate_limit_details.rs)
  describe ordinary and model-specific windows. Missing/null windows are unknown.
- **Installed SDK contract:** `SDKControlGetUsageResponse` exposes Claude account
  `rate_limits_available`, `rate_limits`, and model-scoped windows. The
  experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` API
  lets the engine own authentication. `QuotaReader.ingestClaudeSdkUsage` imports
  only account quota fields, ignoring cost estimates, behavior scans and session
  token aggregates. The caller should request `{skipBehaviors:true}`.
- **Installed binary evidence:** the installed `claude.exe` contains
  `/api/oauth/usage` and the five-hour/seven-day field names. The gateway's
  direct Claude quota fallback uses an OAuth credential already forwarded by
  a Claude inference request. Until then it reports unknown. Binary strings
  alone do not establish stable public support for this fallback interface.
- **Live read-only verification, 2026-10-16 19:50 UTC:** the existing file-backed
  Codex account successfully returned a weekly quota window through the new
  reader. No inference was sent, credentials were not refreshed, and no raw
  account response was saved. This establishes this account's current endpoint
  compatibility, not all account plans or future protocol stability.
- **Isolated regression evidence:** usage normalization, idempotence, fallback
  attribution, independent agent totals, partial-stream unknowns, cumulative
  Anthropic deltas, non-stream messages, excluded count_tokens requests, cache
  accounting, quota auth isolation/cache/coalescing, missing quotas, SDK ingestion
  and authenticated endpoints are exercised in `test/usage.test.mjs` and
  `test/gateway.test.mjs`.

## Remaining limits

Compatible-provider quota adapters and authoritative billing are unavailable.
Claude's direct OAuth quota fallback has not been live verified by this module's
tests; SDK runtime acceptance must establish the actual UI path separately.
Official Codex source and installed experimental SDK interfaces may change.
This implementation does not reconstruct older-session token usage from native
transcripts or infer costs from a model name.

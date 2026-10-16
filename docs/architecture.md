# Architecture and evidence boundaries

One Node.js 24 ESM package, no runtime dependencies, no daemon or database.
`launcher.ts` owns one gateway and one real Claude child. `models.ts` is the
registry for routing, picker rows, manifests and agents. `providers.ts` separates
provider credentials and request formats. `translate.ts` is a pure adapted MIT
Messages/Responses translator. `fallback.ts` owns scoped decisions and replay
guards. `integration.ts` supplies additive hooks and read-only MCP discovery.

The gateway binds only 127.0.0.1 on an OS-selected port. A random 256-bit token
is checked before routes, parsing, catalog access or account spending. Only
explicit routes are accepted. HTTP bodies are capped at 16 MiB, SSE frames at
4 MiB, error bodies at 64 KiB, headers at 100, and upstream turns at 120 seconds
(each configured fallback attempt also has a bounded timeout). Requests are
canceled when clients leave or the server closes. Redirects are not followed.

The local token travels separately from Claude OAuth. Anthropic receives its
native auth and open-ended anthropic capability headers; ChatGPT receives only
the Codex account credential; compatible providers receive a dedicated key.
Runtime endpoint files contain a short-lived local token and use user-private
directories/0600 mode where supported. Windows relies on the user's inherited
profile ACLs. Any process with access to the user's own credentials/environment
is already inside this trust boundary. Do not share CLAUDAPTER_HOME across users.

Native `x-claude-code-session-id`, `x-claude-code-agent-id`, request-class and
prompt-ID headers establish attribution. Model names never establish agent
identity. A SubagentStart hook binds IDs to configured names. Unattributed,
auxiliary and compaction calls do not get main-session fallback. Interrupted
output poisons that prompt's scope, including retries requesting a different
model. Without a new prompt ID, explicit reset is required. A second body hash
guard blocks exact duplicates. This protects against native retry behavior as
well as internal fallback. A model-generated request to repeat an action in a
genuinely new user turn is outside the automatic replay boundary.

Codex credential refresh deliberately has one owner: the official Codex CLI.
Upstream currently uses process-local synchronization and guarded reload, not a
cross-process lock Claudapter could safely join. Inventing a private lock would
not protect concurrent Codex refresh. Claudapter only reads access tokens, pins
account identity for the launch, refuses expiry, and rereads renewed credentials.
No home-grown OAuth client or shared-file writes are shipped.

## Primary references inspected on 2026-10-16

- [Claude model configuration](https://code.claude.com/docs/en/model-config): native model switching, session-only `s`, persistence, native fallback exclusions and context behavior.
- [Gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol): attribution/hint headers, protocol events, retry and capability semantics.
- [Gateway connection](https://code.claude.com/docs/en/llm-gateway-connect): base URL and authentication configuration.
- [Settings reference](https://code.claude.com/docs/en/settings-reference#modelpicker): picker sources and precedence.
- [Native subagents](https://code.claude.com/docs/en/sub-agents): full model IDs and model-override precedence.
- [Hooks](https://code.claude.com/docs/en/hooks): additive context and agent-name/ID binding.
- [Codex request structs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs) and [SSE handling](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs): Responses protocol.
- [Codex provider base URLs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs): current ChatGPT `/backend-api/codex` base URL; the adapter uses its `/responses` endpoint.
- [Codex auth manager](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs), [storage](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs) and [app-server v1 auth protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v1.rs): storage/refresh design inspection. Merely exposing a refresh RPC does not prove cross-process refresh safety.

Official documentation establishes intended interfaces; local live acceptance
establishes the tested compatibility subset. Neither establishes support for all
models, all future versions, undisclosed keychains or every provider.

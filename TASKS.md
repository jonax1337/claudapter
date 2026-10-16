# Release candidate checklist

Evidence: `docs/verification.md`. Check items only after verification; record blocked and untested cases explicitly.

## M1: real protocol spike
- [x] Read the entire mandate; inventory installed tools and reference license.
- [x] Verify current official Claude/Codex interfaces and inspect reference transport.
- [x] Independent launcher; live native Claude -> GPT -> Claude switch with tool cycle.
- [x] Claude main -> native GPT subagent -> result; follow-up/resume and request attribution.
- [x] Establish safe replay boundary and native retry ownership before fallback design.

## M2: independent implementation
- [x] Pure translation with regression tests; no Rookery runtime dependency.
- [x] One strict model/capability registry; provider contracts and credential isolation.
- [x] Scoped opt-in fallback rules, retries, timeouts, cooldown and reset.
- [x] Bounded authenticated loopback HTTP, cancellation, redacted diagnostics.
- [x] Isolated unit and transport tests, including malicious/unknown inputs.

## M3: daily use
- [x] Setup, models, providers, provider add, doctor, native argument passthrough.
- [x] Optional GPT agents, additive manifest and read-only live discovery/refresh.
- [x] Preserve settings, explicit settings, hooks, skills/plugins, MCP, permissions and resume.
- [x] Concurrent sessions, credential refresh strategy, Windows cleanup and paths with spaces. Refresh is officially owned by Codex; Claudapter only rereads unexpired file credentials.
- [x] Explicit Anthropic-compatible provider, fixture tested.

## M4: compatibility and failures
- [x] Tool IDs/results, long-input bounds, images and usage; unsupported thinking/content fails explicitly. Real model-switch continuation remains in M1.
- [x] Expired auth, 429, outage, malformed/partial streams, dropped connection and cancellation.
- [x] Disabled fallback, allowed chains, cooldown/reset, exhaustion, capability refusal and scope isolation.
- [x] No replay after content/tool output; auth, billing, refusal and invalid requests never trigger fallback.
- [x] Claude-only and ChatGPT-only; actual identity and updated session awareness.
- [x] Native interactive controls, /model persistence, resume, subagent follow-up, preserved extensions.

## M5: local release
- [x] Build and pack; install tarball outside checkout; run installed artifact with live GPT and MCP discovery.
- [x] Windows/macOS/Linux CI configured (remote execution not performed).
- [x] English install/config/auth/fallback/agent/security/troubleshooting/uninstall docs and demo.
- [x] Factual compatibility matrix, final tests and live evidence with explicit gaps.

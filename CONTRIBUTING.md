# Contributing

Thanks for your interest in Claudapter. Issues and pull requests are welcome.

## Setup

You need Node.js 24+, [Bun](https://bun.sh) 1.3.14+ and, for manual testing,
Claude Code 2.1.301+.

```sh
npm ci
npm run check      # TypeScript for the backend and the TUI
npm test           # build + Node test suite
npm run test:tui   # Bun/OpenTUI test suite
```

All three must pass before a pull request is merged; CI runs them on Windows, macOS
and Linux.

## Ground rules

These keep Claudapter safe to run against real accounts:

- **Never weaken a safety property.** No permission-bypass flags, no silent edits to
  native Claude settings, no writes to Claude or Codex credentials, fallback stays
  opt-in, and no replay after a response has started.
- **Never log secrets or conversation bodies.** Diagnostics may contain model IDs,
  scopes and statuses only.
- **Tests use fixtures.** Automated tests run with fixture credentials in disposable
  homes (`test/isolate.mjs`). Do not add tests that need a real account or spend quota.
- **Mock success is not live verification.** If you verified something live, say how;
  otherwise describe it as tested with fixtures.
- **Preserve attribution.** Adapted code keeps its MIT notice — see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
  [docs/opencode-provenance.md](docs/opencode-provenance.md).

## Code style

Match the surrounding code. Keep functions small, names descriptive, and avoid
comments that restate the code. Prefer a failing test first for bug fixes.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
`docs:` …). Describe what changed, why, and how you tested it. User-visible changes
belong in [CHANGELOG.md](CHANGELOG.md).

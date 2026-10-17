# Changelog

All notable changes to Claudapter. Versions before 1.0 are release candidates;
see [docs/internal/verification.md](docs/internal/verification.md) for what each one
was verified against.

## 0.2.0-rc.7 — 2026-10-17

First public release candidate.

- **TUI:** the composer shows the provider's display name (`Claude`, `Z.ai`, `Ollama`)
  instead of its internal ID; Ollama gained a label.
- **Removed** the superseded Ink-based TUI and its `ink`, `react` and `@inkjs/ui`
  dependencies. `claudapter tui` has used the OpenTUI interface since rc.3.
- **Install:** dropped the `--omit=optional` recommendation. It also removed OpenTUI's
  per-platform native renderer, so `claudapter tui` could not start.
- **Build:** `npm run build` cleans `dist/` first, so removed modules cannot linger
  in the packed artifact.
- **CI:** installs Bun, runs the TypeScript check and the OpenTUI test suite.
- **Docs:** new README and [configuration reference](docs/configuration.md); internal
  planning and evidence moved to [docs/internal](docs/internal/); added CONTRIBUTING,
  SECURITY and issue templates.

## 0.2.0-rc.6 — 2026-10-17

- Auto-detected local Ollama models through the Anthropic-compatible passthrough,
  with honest context reporting and mid-session refresh.

## 0.2.0-rc.5 — 2026-10-17

- Multi-account profiles (`claudapter profile …`, `--profile`), `sonnet@<profile>`
  model IDs and account rotation as an explicit fallback target.
- Routine per-request routing lines moved behind `CLAUDAPTER_ROUTE_LOG=1`.

## 0.2.0-rc.4 — 2026-10-17

- TUI transcript parity (diffs, tool views, images, tables), native flows (`/btw`,
  `/cd`, Vim mode), typed fallback notices with one-key recovery, sub-agent isolation
  with tabs, six contrast-checked themes.

## 0.2.0-rc.3 — 2026-10-17

- Graphical `/usage`, `/context` and `/diff` panels, `/settings` hub, Z.ai preset,
  quota pre-emption for enabled fallback rules.
- TUI moved to OpenTUI with components adapted from OpenCode.

## 0.2.0-rc.1 – rc.2 — 2026-10-16

- Optional TUI, maximum catalog context and provider-aware usage accounting.

## 0.1.0-rc.1 — 2026-10-16

- Initial release candidate: loopback gateway, ChatGPT models in the native `/model`
  picker, GPT-backed native agents, read-only discovery and explicit opt-in fallback.

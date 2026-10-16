# Claudapter

`PROJECT_BRIEF.md` is the binding product mandate. Work in the main agent; do not delegate development. Dedicated product acceptance prompts may explicitly invoke native Claude Code subagents.

- Communicate with Jonas in German; code, CLI output and documentation are English.
- Keep `E:/DEV/rookery-agent` read-only. Preserve MIT attribution for adapted code.
- Preserve native Claude configuration, permissions, credentials and current directory. Never add permission bypass flags.
- Automated tests use disposable homes and fixture credentials. Live acceptance uses existing subscriptions sparingly and simulated limit failures.
- Keep routing strict, fallback opt-in, agent state independent, and replay forbidden after output starts. Never log secrets or conversation bodies.
- Track evidence and incomplete acceptance criteria in `TASKS.md` and `docs/verification.md`. Mock success is not live verification.
- Use the installed ProjectAtlas skill for indexed navigation; initialize only absent project-local state and refresh incrementally. Read-only reference inspection must not initialize or mutate Rookery.
- Build and test the packed artifact outside this checkout before calling it a release candidate. No external publishing.

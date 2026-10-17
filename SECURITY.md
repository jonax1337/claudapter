# Security policy

Claudapter handles access to your Claude, ChatGPT and provider accounts, so security
reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub Security Advisories](https://github.com/jonax1337/claudapter/security/advisories/new).
Include the affected version, your platform, and steps to reproduce. Never include real
credentials or conversation content — fixture values are enough.

You can expect an acknowledgement within a week. Fixes ship in a new release
candidate and are credited in the changelog unless you prefer otherwise.

## Scope

In scope, for example:

- the local gateway accepting requests without the per-launch token, or listening
  beyond loopback
- credentials reaching a provider other than their owner, or appearing in logs
- fallback or replay happening without an explicit, enabled rule
- writes to Claude or Codex credential stores or native settings

Out of scope: vulnerabilities in Claude Code, the Codex CLI or the providers
themselves (report those to their vendors), and attacks that already require control
of your user account — any process running as you can read your own credentials.

## Supported versions

Only the latest release candidate receives fixes.

# Third-party notices

The Messages/Responses translator in `src/translate.ts` and its original regression
tests are adapted from Rookery Agent, copyright (c) 2026 Jonas Laux, MIT License.
The full applicable MIT notice is included in `LICENSE`.

`claudapter tui` adapts parts of the OpenCode terminal interface
(https://github.com/anomalyco/opencode, commit `07bbd0fd166c82d87e79f053dc70e6fdb66f88ac`),
copyright (c) 2025 opencode, MIT License. Adapted files and the full license text are in
`docs/opencode-provenance.md`. It is built on @opentui/core, @opentui/solid and
solid-js (MIT); Solid and @opentui/solid are compiled into the shipped bundle.
Claudapter is not affiliated with or endorsed by OpenCode.

Runtime dependencies `marked` and `string-width` are used under their MIT licenses, and
the Anthropic Claude Agent SDK under its own terms:

© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements
outlined here: https://code.claude.com/docs/en/legal-and-compliance.

Dependency distributions retain their own license files. Claudapter's MIT
license does not relicense Anthropic software. The SDK package declares optional
platform binaries, which npm installs for the current platform; Claudapter does not run them.
Claudapter always selects the user's separately installed Claude Code executable.
Codex and credentials are not bundled. Protocol interoperability does not imply
endorsement or an official cross-provider subscription integration.

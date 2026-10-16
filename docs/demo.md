# Reproducible local demo

Use a disposable project with an isolated Claude configuration for automated
experiments. Live acceptance intentionally uses existing subscription inference;
do not run it as a unit test or manufacture real quota exhaustion.

1. Create `sum.mjs` containing `export const add = (a,b) => a-b;` and
   `sum.test.mjs` containing:

   ```js
   import assert from 'node:assert/strict';
   import { add } from './sum.mjs';
   assert.equal(add(2, 3), 5);
   console.log('SUM_TEST_OK');
   ```

2. Run `claudapter models`, then `claudapter agents enable <catalog-gpt-id>`.
3. Start `claudapter -- --model sonnet` in that project. Ask Claude to read the
   two files and describe the defect without editing or delegating.
4. Open `/model`, select the GPT row and press **s**. Ask GPT to fix the defect
   and run `node sum.test.mjs`. Approve only the required project-local tools.
5. Open `/model`, choose Sonnet and press **s**. Ask Claude to review the change.
   Check route diagnostics rather than asking the model to identify itself.
6. Explicitly ask Claude to invoke `claudapter:gpt-reviewer`, request the test
   result, then ask it to resume that same agent for a brief follow-up. Confirm
   agent-ID request headers and GPT route events separately from main requests.
7. Ask the main model to use the discovery MCP tool with `refresh: true` and
   report actual routes, configured agents and active policies.
8. Exit, run `claudapter -- --continue`, and ask Claude to report the prior test
   result. Verify no unexpected backend substitution occurred.

For exact routing events, set `CLAUDAPTER_TRACE=1` before launch. Never put API
keys or account tokens in the terminal command line or demo transcript.

The development-only `test/live-fallback.mjs` requires
`CLAUDAPTER_LIVE_ACCEPTANCE=1` and an explicit account model ID. It injects the
primary 429 inside the upstream transport, uses real GPT for the replacement,
and asserts a single primary attempt across the tool cycle. It never exhausts
Claude quota to test fallback. Prepare its isolated directories first; it is
deliberately not packaged or run by `npm test`.

`test/terminal.py` and `test/terminal-screen.py` are Windows ConPTY acceptance
helpers. Their Python packages live only under ignored `.artifacts/pydeps`, not
inside the shipped application. Feed small explicit commands through the test
control files and retain only sanitized observations in release documentation.

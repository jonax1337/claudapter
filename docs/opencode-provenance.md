# OpenCode source provenance

Upstream: https://github.com/anomalyco/opencode
Pinned commit: `07bbd0fd166c82d87e79f053dc70e6fdb66f88ac`.

## Adopted files

| Local file | Upstream file | Adaptation |
| --- | --- | --- |
| `src/tui/opencode/home.tsx` | `packages/tui/src/routes/home.tsx`, `packages/tui/src/component/logo.tsx` | Retained responsive centered layout; inject logo, prompt and footer instead of OpenCode backend contexts, updater and plugin slots. The logo reuses the upstream two-tone block-glyph technique (shadow-filled counters, muted/bright word halves) with original `claud`/`apter` glyphs. |
| `src/tui/opencode/composer.tsx` | `packages/tui/src/component/prompt/index.tsx:1659–1774`, `component/prompt/autocomplete.tsx` | Adapted textarea, left rail, mode/model row and slash-command suggestion list; controller submission, own prompt history and the command registry replace upstream prompt state. |
| `src/tui/opencode/dialog.tsx` | `packages/tui/src/ui/dialog.tsx` | Adapted centered dialog frame: dimmed backdrop, 60/88-column widths, quarter-height offset and `esc` header. No dialog stack, keymap modes or focus restoration. |
| `src/tui/opencode/app.tsx` | `packages/tui/src/routes/session/index.tsx:1382–1413` | Adapted session viewport shell; palette, overlays and key handling are bridged to `TuiController`. |
| `src/tui/opencode/transcript.tsx` | `routes/session/index.tsx` (`UserMessage`, `BlockTool`), `routes/session/message-parts.tsx` (`TextPart`, `ReasoningPart`, `InlineToolRow`), `ui/border.ts` | Adapted user rail, native `<markdown>` assistant text, reasoning rail, inline tool rows and error rail. Entries come from the controller instead of OpenCode message parts. Not adopted: diff/edit/write block tools, inline permission rows, images, sub-agent groups. |
| `src/tui/opencode/decision.tsx` | `packages/tui/src/ui/dialog-confirm.tsx` | Adapted choice presentation/navigation; preserve controller default and cancel semantics. |
| `src/tui/opencode/menu.tsx` | `packages/tui/src/ui/dialog-select.tsx` | Adapted searchable list; items are supplied by command actions. |

Claudapter-owned code (no upstream source): `theme.ts` (palettes and theme context), `status.tsx` (scanner, status indicator, context meter), `bridge.ts` (controller state store), `actions.ts` (command registry), `main.tsx` (entry), `../launch.ts` (Bun launcher) and `../../../scripts/build-tui.mjs`.

## Status

`claudapter tui` starts the bundled OpenTUI/Solid interface through Bun; native `claudapter` and the controller, gateway and permission handling are unchanged. The home view, composer, dialogs, palette and message layout are adapted. Diff/edit/write block tools, inline permission rows and the remaining upstream session features are not adopted, so this is not full OpenCode parity.

Automated tests use fixture controllers, not a live engine session. Fourteen UI tests cover home rendering, Unicode submission, decisions and forms, streaming reconciliation, tool rows, paging, menus, centered dialogs, slash-command completion, prompt history, the status bar and command dispatch. Live acceptance covered a model switch, a short response and mouse copy/paste in Windows Terminal using a packed install outside the checkout; tool approval, resize, wheel, resume and interruption remain unverified.

OpenTUI 0.6.6 pins Solid 1.9.12. Solid and `@opentui/solid` are compiled into `dist/tui/opencode.js`, so the transitive `seroval` advisory does not reach consumers; `@opentui/core` remains an external runtime dependency. OpenTUI needs Bun on PATH; the native CLI stays on Node.

## License

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

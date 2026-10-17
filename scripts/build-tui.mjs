import solid from '@opentui/solid/bun-plugin';

const result = await Bun.build({
  entrypoints: ['./src/tui/opencode/main.tsx'],
  target: 'bun',
  outdir: './dist/tui',
  naming: 'opencode.js',
  external: ['@opentui/core', '@opentui/core/*', '@anthropic-ai/claude-agent-sdk', 'ink', 'react', '@inkjs/ui', 'marked', 'string-width'],
  conditions: ['browser'],
  plugins: [solid, {
    name: 'preserve-backend-module-paths',
    setup(build) {
      build.onResolve({ filter: /dist\/.+\.js$/ }, ({ path }) => {
        if (!path.startsWith('../../../dist/')) return;
        const relative = path.slice('../../../dist/'.length);
        return { path: relative.startsWith('tui/') ? './'+relative.slice(4) : '../'+relative, external: true };
      });
    },
  }],
});
if (!result.success) throw new AggregateError(result.logs, 'OpenCode TUI build failed.');

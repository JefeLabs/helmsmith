import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  // Code-splitting on so the TUI stack (@helmsmith/tui-view-components → @opentui/react)
  // used only by `connect` stays in its own chunk.
  splitting: true,
  shims: false,
  // Bundle the @helmsmith/* workspace libraries into dist so the published package has no
  // workspace:* dependencies (a private lib like tui-view-components can't be installed
  // from npm otherwise). @opentui/* use Bun-specific import attributes and stay external,
  // resolved from node_modules at runtime; they are declared as real dependencies.
  noExternal: [/^@helmsmith\//],
  external: [/^@opentui\//, '@inquirer/core', '@inquirer/ansi', '@inquirer/figures'],
});

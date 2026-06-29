import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  // Code-splitting on: keeps the dynamic import() of the TUI stack
  // (@helmsmith/tui-view-components → @opentui/react) in a separate chunk so it
  // loads only when the interactive `connect` command runs — non-interactive
  // commands don't pull the React reconciler into the startup graph.
  splitting: true,
  shims: false,
  // Inline @helmsmith/agent-* — consumed via npm link from
  // agentx-platform until those packages are published. Their
  // package.json exports point at .ts source, so a built JS bundle
  // must inline them to be runnable.
  noExternal: [/^@helmsmith\//],
  // @opentui/* uses Bun-specific import attributes (`with { type: "file" }`)
  // for embedded WASM/SCM assets, which esbuild can't bundle. Keep them
  // external so they resolve from node_modules at runtime — taskmaster
  // runs on Bun (see bin shebang), which handles those imports natively.
  external: [/^@opentui\//],
});

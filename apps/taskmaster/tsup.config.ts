import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: false,
  // Inline @ecruz165/agent-* — consumed via npm link from
  // agentx-platform until those packages are published. Their
  // package.json exports point at .ts source, so a built JS bundle
  // must inline them to be runnable.
  noExternal: [/^@ecruz165\//],
});

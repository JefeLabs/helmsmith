import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  shims: true,
  clean: true,
  // Bun builtin — esbuild can't resolve it, leave it for the Bun runtime.
  external: ['bun:sqlite'],
  banner: {
    js: '#!/usr/bin/env bun',
  },
});

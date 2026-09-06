import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  // TypeScript 7 ships no JS compiler API, so tsup's bundled dts plugin cannot run.
  // Declarations come from `tsc --emitDeclarationOnly` in the build script instead.
  dts: false,
  shims: true,
  clean: true,
  // Bun builtin — esbuild can't resolve it, leave it for the Bun runtime.
  external: ['bun:sqlite'],
  banner: {
    js: '#!/usr/bin/env bun',
  },
});

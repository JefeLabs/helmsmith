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
  // Bundle the @helmsmith/* workspace libraries into dist so the published package has no
  // workspace:* dependencies (the private tui-view-components can't be installed from npm).
  noExternal: [/^@helmsmith\//],
  // bun:sqlite is a Bun builtin esbuild can't resolve. @opentui/* use Bun-specific import
  // attributes; they stay external and are declared as real dependencies, as is react, so
  // the bundle and @opentui/react share one React instance.
  external: ['bun:sqlite', /^@opentui\//, 'react'],
  banner: {
    js: '#!/usr/bin/env bun',
  },
});

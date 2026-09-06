import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // TypeScript 7 ships no JS compiler API, so tsup's bundled dts plugin cannot run.
  // Declarations come from `tsc --emitDeclarationOnly` in the build script instead.
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
});

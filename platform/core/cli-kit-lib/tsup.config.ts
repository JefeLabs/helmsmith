import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // TypeScript 7 ships no JS compiler API, so tsup's bundled dts plugin cannot run.
  // Declarations come from `tsc --emitDeclarationOnly` in the build script instead.
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});

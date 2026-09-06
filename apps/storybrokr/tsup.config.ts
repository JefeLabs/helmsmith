import { defineConfig } from 'tsup';

export default defineConfig({
  // src/server/start.ts joins this list once it exists (Task 12).
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // TypeScript 7 has no JS compiler API; declarations come from tsc in the build script.
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  // @helmsmith/cli-kit exports .ts source and is unpublished — inline it.
  noExternal: [/^@helmsmith\//],
  external: [/^[^@./]/, /^@(?!helmsmith\/)/],
});

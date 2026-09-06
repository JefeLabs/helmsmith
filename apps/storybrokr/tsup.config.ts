import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/server/start.ts'],
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

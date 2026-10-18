import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/core/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // TypeScript 7 has no JS compiler API; no declarations are shipped for a CLI.
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  // @helmsmith/* packages export .ts source and are unpublished — inline them.
  noExternal: [/^@helmsmith\//],
  external: [/^[^@./]/, /^@(?!helmsmith\/)/],
});

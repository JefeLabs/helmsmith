import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Bundle @ecruz165/* workspace packages (their package.json `main`
  // points at TS source, so they need inlining to ship a usable JS
  // bundle). Everything else stays external — Node/Bun resolves them
  // from node_modules at runtime.
  noExternal: [/^@ecruz165\//],
  external: [
    // Any unscoped npm package
    /^[^@./]/,
    // Any scoped package that isn't @ecruz165/* (excluded via lookahead)
    /^@(?!ecruz165\/)/,
  ],
  // No banner: bin/skillzkit.mjs (stub) provides the #!/usr/bin/env bun shebang.
});

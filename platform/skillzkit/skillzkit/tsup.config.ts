import { defineConfig } from 'tsup';

export default defineConfig({
  // `tui` is the TUI `skillzkit ui` runs in its own Bun process (src/commands/ui.ts). It ships
  // bundled like the CLI: its imports reach the private @helmsmith/* workspace packages, which
  // only exist inlined in a bundle, never as installed dependencies.
  entry: { index: 'src/index.ts', cli: 'src/cli.ts', tui: 'src/tui/main.tsx' },
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // TypeScript 7 ships no JS compiler API, so tsup's bundled dts plugin cannot run.
  // Declarations come from `tsc --emitDeclarationOnly` in the build script instead.
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Bundle @helmsmith/* workspace packages (their package.json `main`
  // points at TS source, so they need inlining to ship a usable JS
  // bundle). Everything else stays external — Node/Bun resolves them
  // from node_modules at runtime.
  noExternal: [/^@helmsmith\//],
  external: [
    // Any unscoped npm package
    /^[^@./]/,
    // Any scoped package that isn't @helmsmith/* (excluded via lookahead)
    /^@(?!ecruz165\/)/,
  ],
  // No banner: bin/skillzkit.mjs (stub) provides the #!/usr/bin/env bun shebang.
});

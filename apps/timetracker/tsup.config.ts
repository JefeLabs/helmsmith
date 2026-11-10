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
  // Keep `node:` on builtin imports. tsup strips it by default, and node:sqlite (the Node
  // branch of src/storage/sqlite/driver.ts) only exists under that prefix.
  removeNodeProtocol: false,
  // Bundle ONLY @helmsmith/* workspace libs — their package.json exports
  // point at .ts source (cli-kit ships dist, tui-view-components ships
  // src), so they must be inlined to produce a usable JS bundle. They are
  // devDependencies: the private tui-view-components can't be installed
  // from npm, so the published package must not depend on it.
  //
  // Everything else (discord.js, @aws-sdk/*, react, @opentui/*) stays a
  // runtime require, loaded from node_modules in its published form.
  // Bundling CJS deps with dynamic require() breaks at runtime.
  noExternal: [/^@helmsmith\//],
  external: [
    // Any unscoped npm package (`discord.js`, `commander`, `react`, …)
    /^[^@./]/,
    // Any scoped package that isn't @helmsmith/* (excluded via lookahead)
    /^@(?!helmsmith\/)/,
    // Bun built-in — never bundle
    'bun:sqlite',
  ],
});

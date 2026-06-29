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
  // Bundle ONLY @jefelabs/* workspace libs — their package.json exports
  // point at .ts source (cli-kit ships dist, tui-view-components ships
  // src), so they must be inlined to produce a usable JS bundle.
  //
  // Everything else (discord.js, @aws-sdk/*, react, @opentui/*) stays a
  // runtime require, loaded from node_modules in its published form.
  // Bundling CJS deps with dynamic require() breaks at runtime.
  noExternal: [/^@jefelabs\//],
  external: [
    // Any unscoped npm package (`discord.js`, `commander`, `react`, …)
    /^[^@./]/,
    // Any scoped package that isn't @jefelabs/* (excluded via lookahead)
    /^@(?!ecruz165\/)/,
    // Bun built-in — never bundle
    'bun:sqlite',
  ],
});

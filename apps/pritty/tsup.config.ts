import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "es2022",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Bundle ONLY @ecruz165/agent-* (consumed via npm link from
  // agentx-platform until those packages are published). Their
  // package.json exports point at .ts source, so they must be inlined
  // to ship a usable JS bundle. Everything else stays as a runtime
  // require — npm-installed at the consumer's node_modules.
  //
  // Why externalize the rest: transitive deps via agent-adapter
  // (@anthropic-ai, @langchain) and pritty's own (octokit, etc.)
  // include CJS modules with dynamic require() calls. Bundling them
  // breaks at runtime ("Dynamic require of X not supported"). Leaving
  // them external means Node loads them from node_modules using
  // their published forms (CJS or ESM, doesn't matter — Node handles
  // either at runtime).
  noExternal: [/^@ecruz165\//],
  external: [
    // Any unscoped npm package (`octokit`, `commander`, `ora`, etc.)
    /^[^@./]/,
    // Any scoped package that isn't @ecruz165/* (excluded via lookahead)
    /^@(?!ecruz165\/)/,
  ],
});

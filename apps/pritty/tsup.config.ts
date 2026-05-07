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
  // Bundle workspace deps directly. Their package.json `exports` point
  // at .ts source (no built dist/), so leaving them externalized would
  // make Node try to import .ts files at runtime and fail. Bundling
  // them in keeps the CLI self-contained.
  noExternal: [/^@agentx\//],
});

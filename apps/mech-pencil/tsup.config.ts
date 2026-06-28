import { defineConfig } from 'tsup';

// tsup builds ONLY the library entry (`src/index.ts`) — it's clean of
// the `.pen` embed graph and tsup/esbuild can't process
// `import … with { type: "file" }`. `src/cli.ts` is built by
// `bun build` instead (see package.json "build"), which embeds the
// HeroUI library and is the path toward `bun build --compile`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
});

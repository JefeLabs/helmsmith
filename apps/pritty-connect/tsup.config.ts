import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Bundle only the private view library; @helmsmith/pritty, OpenTUI, React and
  // commander are published packages and stay external.
  noExternal: [/^@helmsmith\/tui-view-components/],
  external: [/^[^@./]/, /^@(?!helmsmith\/tui-view-components)/],
});

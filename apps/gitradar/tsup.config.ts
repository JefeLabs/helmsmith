import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  shims: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env bun',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // bin.test.ts spawns the CLI via `tsx bin.ts` for each case. The first
    // spawn pays a cold TS-transform cost that exceeds vitest's default 5s
    // timeout under CI load (the rest hit tsx's warm cache and finish fast),
    // so give the real-subprocess suite generous headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

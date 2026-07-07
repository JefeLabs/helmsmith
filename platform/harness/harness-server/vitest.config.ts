import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This package's suites are subprocess-heavy — spawn-worker, validate-repo-
    // access, run-pipeline-* each shell out to real `git`/`tsx` many times, and
    // several beforeAll hooks spin up ~10 git subprocesses. Under CI load those
    // intermittently brush past vitest's default 5s (observed: spawn-worker at
    // 5016ms), so give the whole package generous headroom rather than chasing
    // individual timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

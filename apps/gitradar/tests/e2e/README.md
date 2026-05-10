# gitradar e2e tests

End-to-end tests that spawn the built `gitradar` CLI as a subprocess.

## Convention

See [`apps/pritty/tests/e2e/README.md`](../../../pritty/tests/e2e/README.md)
for the full convention.

## Gitradar-specific notes

- **SQLite isolation**: gitradar's vitest config sets
  `pool: "forks", fileParallelism: false` because SQLite doesn't
  tolerate parallel writes from worker threads. E2E tests spawn the
  CLI as a *subprocess* (separate process, separate SQLite handle),
  so parallel e2e tests against *different* temp data dirs are fine —
  but tests pointed at the *same* `--data-dir` must be sequential.
- **GitHub API mocking**: e2e tests should mock GitHub by setting
  `GITRADAR_GH_FIXTURE=<path>` in the spawned env (or whatever flag
  the CLI exposes). Don't hit the real API from tests.

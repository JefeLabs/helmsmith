# skillzkit e2e tests

End-to-end tests that spawn the built `skillzkit` CLI as a subprocess.

## Convention

See [`apps/pritty/tests/e2e/README.md`](../../../pritty/tests/e2e/README.md)
for the full convention.

## Skillzkit-specific notes

- **Catalog dependency**: skillzkit's e2e tests typically need a
  generated `catalog.json`. The `npm run build` script runs
  `npm run catalog && tsup` — wire your `globalSetup` to run both
  before any e2e test runs.
- **Storage modes**: skillzkit can run against `memory:`, `fs:<path>`,
  `fs-persistent:<path>`, or `s3:<bucket>` storage. E2E tests for
  `skillzkit serve` should pin to `memory:` or a temp `fs:` path —
  never the user's home or a shared bucket.
- **Team mode**: tests for the `contribute` flow need a team-mode
  config. Use a temp `~/.agentx/skillzkit/config.json` via a
  `SKILLZKIT_HOME=<temp-dir>` override (or whatever env var the CLI
  honors).

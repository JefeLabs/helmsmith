# gittyup e2e tests

End-to-end tests that spawn the built `gittyup` CLI as a subprocess.

## Convention

See [`apps/pritty/tests/e2e/README.md`](../../../pritty/tests/e2e/README.md)
for the full convention.

## Gittyup-specific notes

- **Multi-repo fixtures**: gittyup orchestrates across many repos.
  E2E tests should construct a temp directory tree of fake git
  repos (e.g. `mkdtemp` + `git init` per fixture) and point the
  CLI at it via `GITTYUP_HOME=<temp-dir>` (or whatever env var
  the CLI exposes).
- **GitHub API mocking**: gittyup uses `octokit` for PR work.
  Stub or mock the GitHub API in e2e tests — never hit the real
  API. The `nock`-style approach (intercept HTTP) works since
  octokit uses `fetch` under the hood.
- **Rebrand awareness**: gittyup is rebrandable (`branding.yaml`).
  E2E tests that assert specific output strings should reference
  `APP_NAME` from `src/config/branding.ts` rather than hardcoding
  the string `"gittyup"`.

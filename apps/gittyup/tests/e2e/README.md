# gittyup e2e tests

End-to-end tests that spawn the built `gittyup` CLI as a subprocess.

## Convention

See [`apps/pritty/tests/e2e/README.md`](../../../pritty/tests/e2e/README.md)
for the full convention.

## Gittyup-specific notes

- **Isolation contract** (`helpers.ts`): `runCli(ws, args)` spawns
  `bin/gittyup.mjs` with `cwd` = a temp workspace holding `gittyup.yaml`,
  `HOME` and `AGENTX_HOME` = that same dir, and the whitelist env from
  `src/test/git-fixture.ts` (`fixtureEnv`). Config, cache and auth never
  touch the developer's home. Run via `pnpm test:e2e`
  (`vitest.e2e.config.ts`; the global setup builds `dist/` first).
- **Repos** come from `makeRepo(spec)` in `src/test/git-fixture.ts`: a
  declarative list of commits per branch, optional bare `origin`, fixed
  author and dates, no global git config. Put the repo's `path` in the
  workspace manifest.
- **GitHub is never hit.** `runCli` blanks `GITHUB_TOKEN`, `GH_TOKEN` and
  `COPILOT_GITHUB_TOKEN`. A test that needs the API stubs `fetch`.
- **Rebrand awareness**: gittyup is rebrandable (`branding.yaml`). Tests
  that assert specific output strings should reference `APP_NAME` from
  `src/config/branding.ts` rather than hardcoding `"gittyup"`.

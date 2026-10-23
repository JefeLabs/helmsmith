# pritty e2e tests

End-to-end tests that spawn the published entry point, `node bin/pritty.mjs`,
against throwaway git repositories. Run with `pnpm test:e2e`
(`vitest.e2e.config.ts`); `pnpm test` stays unit-only (`src/**/*.test.ts`).
`global-setup.ts` builds `dist/` with tsup first.

| File             | Covers                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `cli.test.ts`    | `--help`, unknown commands, `categorize` (config found from a subdirectory), `pr` failing before it pushes              |
| `home.test.ts`   | `auth` and `cache` keep their files under `PRITTY_HOME` and never print a token                                         |
| `init.test.ts`   | starter config + Claude Code / Copilot files, skip-unless-`--force`, outside a repo                                     |
| `commit.test.ts` | one commit per category, `--dry-run`, from a subdirectory, redacted prompt, model failure, incomplete plan, no provider |
| `rebase.test.ts` | `--dry-run` plan, no history rewrite without a terminal, refusing `main`                                                |

## Hermetic by construction

`runCli` (helpers.ts) builds the child's environment from scratch instead of
inheriting it:
- `PATH` is the sandbox `bin/` plus `/usr/bin:/bin`. `bin/` holds `git` and,
  when a test calls `installFakeClaude`, a fake `claude`. The developer's real
  Claude Code, `gh` login and tokens are unreachable, so no test can call a
  model or GitHub.
- `HOME` and `PRITTY_HOME` point into the sandbox; git runs with no global or
  system config (each repo carries its own identity).
- stdin is closed at once, so a prompt fails fast instead of hanging.
- No `CI`/`GITHUB_ACTIONS`, so output has no colour codes on CI either.

## The fake `claude`

AI-driven commands run with `provider: "claude"`, which executes the first
`claude` on `PATH`. `installFakeClaude(sb)` installs a stand-in that records
each call's argv, stdin (the prompt) and cwd, and answers with the envelope
`claude -p --output-format json` prints:

```ts
const fake = installFakeClaude(sb);
fake.answer(JSON.stringify([{ category: 'app', message: 'feat: x', files: [] }]));
// or: fake.fail(1, 'not logged in');
const r = await runCli(sb, repo, ['commit', '--json']);
expect(fake.calls()[0]!.stdin).not.toContain(secret);
```

## Adding a test

```ts
let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

it('does the thing', async () => {
  sb = makeSandbox();
  const repo = makeRepo(sb, { config: { provider: 'claude' } });
  const r = await runCli(sb, repo, ['categorize']);
  expect(r.exitCode, r.stderr).toBe(0);
});
```

Assert on exit code, stdout/stderr and the repository afterwards (`head`,
`gitIn`, `stagedPaths`). `--json` runs must print exactly one stdout line;
`jsonLine(r)` enforces that.

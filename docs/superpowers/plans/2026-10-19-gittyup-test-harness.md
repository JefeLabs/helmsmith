# gittyup Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give gittyup a declarative temp-git-repo fixture for unit tests and a subprocess e2e harness for the built CLI, so every later hardening slice can assert behavior against real git state.

**Architecture:** A `makeRepo(spec)` helper under `src/test/` builds a throwaway repository from an ordered list of commits per branch, fully isolated from the developer's git config, and tracks what it created for a one-call cleanup. Under `tests/e2e/`, a `runCli` helper spawns `bin/gittyup.mjs` with `HOME`/`AGENTX_HOME` pointed at a temp directory and `cwd` at a temp workspace holding a `gittyup.yaml`, after a vitest global setup has built `dist/`. Unit and e2e run under separate vitest configs so `pnpm test` stays fast.

**Tech Stack:** vitest 5, simple-git 3, tsup 8, js-yaml 5, Node 24 (`node:fs/promises`, `node:child_process`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-gittyup-hardening-design.md` — slice §3.10, plus the `test:integration` and `passWithNoTests` lines in §1.13 and §7.

## Global Constraints

- Co-located unit tests (`src/**/*.test.ts`); e2e tests only in `tests/e2e/` and only against the built CLI (`docs/toolbox-conventions.md`).
- Every app implements `build`, `dev`, `test`, `test:watch`, `test:e2e`, `typecheck` (`toolbox-conventions.md`). `test:integration` is removed (spec §3.10).
- vitest `passWithNoTests: false` in both configs (spec §3.10): an empty directory fails.
- Fixtures must not read the developer's git config: `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, fixed `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (spec §7: "no network", deterministic).
- Fixture repos use `main` as the default branch unless the spec says otherwise.
- Version bump 0.1.0 → 0.2.0 lands with the first merged slice (spec §6): this PR carries a `minor` changeset for `@helmsmith/gittyup`.
- No behavior change to any command in this PR. Tests here assert what `main` does today.

## Review Focus

1. A developer with `commit.gpgsign=true` or a global `core.hooksPath` runs the fixture: commits must still succeed and sign nothing. Test: `git-fixture.test.ts` "ignores the developer's global git config" (Task 1).
2. A commit spec deletes a file (`null` value): the file is gone from the tree and the commit succeeds. Test: Task 1 "deletes a file when the value is null".
3. A commit spec names a branch that does not exist yet and gives no `from`: the branch is cut from the current `HEAD`, not from `main`. Test: Task 1 "cuts a new branch from the current HEAD when from is omitted".
4. A test forgets `cleanupFixtures()`: temp dirs leak under `tmpdir()`. The fixture module registers `afterEach(cleanupFixtures)` itself when vitest's `afterEach` is available, so a forgotten call still cleans. Test: Task 1 "cleans up registered repos" (asserts the directory is gone after `cleanupFixtures()`).
5. The CLI is run with no `gittyup.yaml` in the temp workspace: it must not fall back to the developer's real `~/.agentx/gittyup/`. `HOME` is overridden in `runCli`. Test: Task 3 "does not read the developer's home config" asserts the printed `config:` path is under the temp dir.

---

### Task 1: Declarative git fixture

**Files:**
- Create: `apps/gittyup/src/test/git-fixture.ts`
- Test: `apps/gittyup/src/test/git-fixture.test.ts`

**Interfaces:**
- Consumes: `simple-git` (`simpleGit(path).env(...)`), `node:fs/promises`.
- Produces:

```ts
export interface CommitSpec {
  /** branch to commit on; created if missing. Default: spec.defaultBranch */
  branch?: string;
  /** branch to cut a new branch from. Default: current HEAD */
  from?: string;
  message: string;
  /** path → content; null deletes the file */
  files: Record<string, string | null>;
}
export interface RepoSpec {
  defaultBranch?: string;            // default 'main'
  commits: CommitSpec[];
  /** branch to leave checked out at the end. Default: defaultBranch */
  checkout?: string;
  /** create a bare remote named 'origin' and push every branch. Default: false */
  remote?: boolean;
}
export interface FixtureRepo {
  path: string;
  remotePath?: string;
  git: SimpleGit;                    // pre-configured with FIXTURE_GIT_ENV
  sha(ref: string): Promise<string>;
  read(file: string): Promise<string>;
  exists(file: string): Promise<boolean>;
  currentBranch(): Promise<string>;
}
export const FIXTURE_GIT_ENV: Record<string, string>;   // the isolation env, exported for e2e reuse
export async function makeRepo(spec: RepoSpec): Promise<FixtureRepo>;
export async function cleanupFixtures(): Promise<void>; // removes every repo makeRepo created since the last call
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/test/git-fixture.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { cleanupFixtures, makeRepo } from './git-fixture.js';

afterEach(() => cleanupFixtures());

describe('makeRepo', () => {
  it('builds commits on the default branch in order', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\n' } },
        { message: 'second', files: { 'f.txt': 'a\nb\n', 'g.txt': 'g\n' } },
      ],
    });
    expect(await repo.currentBranch()).toBe('main');
    const log = await repo.git.log();
    expect(log.all.map((c) => c.message)).toEqual(['second', 'base']);
    expect(await repo.read('f.txt')).toBe('a\nb\n');
  });

  it('cuts a new branch from the current HEAD when from is omitted', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev1', files: { 'f.txt': 'x-dev\n' } },
      ],
      checkout: 'develop',
    });
    expect(await repo.sha('develop~1')).toBe(await repo.sha('main'));
    expect(await repo.currentBranch()).toBe('develop');
  });

  it('cuts a new branch from `from` when given', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev1', files: { 'f.txt': 'x-dev\n' } },
        { branch: 'hotfix', from: 'main', message: 'fix', files: { 'h.txt': 'h\n' } },
      ],
    });
    expect(await repo.sha('hotfix~1')).toBe(await repo.sha('main'));
    expect(await repo.sha('hotfix~1')).not.toBe(await repo.sha('develop'));
  });

  it('deletes a file when the value is null', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n', 'g.txt': 'g\n' } },
        { message: 'rm g', files: { 'g.txt': null } },
      ],
    });
    expect(await repo.exists('g.txt')).toBe(false);
    const show = await repo.git.raw(['show', '--name-status', '--format=', 'HEAD']);
    expect(show).toMatch(/^D\s+g\.txt/m);
  });

  it('produces a real conflict when both branches edit the same line', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'l1\nl2\nl3\n' } },
        { branch: 'develop', message: 'ours', files: { 'f.txt': 'l1\nl2-ours\nl3\n' } },
        { branch: 'main', message: 'theirs', files: { 'f.txt': 'l1\nl2-theirs\nl3\n' } },
      ],
      checkout: 'develop',
    });
    await expect(repo.git.merge(['main'])).rejects.toThrow();
    const status = await repo.git.status();
    expect(status.conflicted).toEqual(['f.txt']);
  });

  it('creates a bare origin and pushes every branch when remote is true', async () => {
    const repo = await makeRepo({
      remote: true,
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev', files: { 'f.txt': 'y\n' } },
      ],
    });
    expect(repo.remotePath).toBeDefined();
    const remotes = await repo.git.getRemotes(true);
    expect(remotes[0]).toMatchObject({ name: 'origin' });
    expect(await repo.sha('origin/develop')).toBe(await repo.sha('develop'));
    expect(await repo.sha('origin/main')).toBe(await repo.sha('main'));
  });

  it('ignores the developer\'s global git config', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const name = await repo.git.raw(['log', '-1', '--format=%an <%ae>']);
    expect(name.trim()).toBe('gittyup-fixture <fixture@gittyup.test>');
    const signed = await repo.git.raw(['log', '-1', '--format=%G?']);
    expect(signed.trim()).toBe('N');
  });

  it('cleans up registered repos', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    expect(existsSync(repo.path)).toBe(true);
    await cleanupFixtures();
    expect(existsSync(repo.path)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/gittyup && pnpm exec vitest run src/test/git-fixture.test.ts`
Expected: FAIL — `Cannot find module './git-fixture.js'`.

- [ ] **Step 3: Implement `src/test/git-fixture.ts`**

Decisions the signature leaves open, fixed here:

- `FIXTURE_GIT_ENV` = `{ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'gittyup-fixture', GIT_AUTHOR_EMAIL: 'fixture@gittyup.test', GIT_COMMITTER_NAME: 'gittyup-fixture', GIT_COMMITTER_EMAIL: 'fixture@gittyup.test', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_TERMINAL_PROMPT: '0' }`. Apply with `simpleGit(path).env({ ...process.env, ...FIXTURE_GIT_ENV })`.
- Temp dir: `mkdtemp(join(tmpdir(), 'gittyup-fx-'))`; the repo is at `<tmp>/repo`, the bare remote at `<tmp>/origin.git`. Track `<tmp>` in a module-level `Set<string>`; `cleanupFixtures` does `rm(dir, { recursive: true, force: true })` for each and clears the set.
- `git init -b <defaultBranch>` then, for each commit: if `branch` differs from the current branch, `checkout` it when it exists, else `checkout -b <branch> [from]`. Write files with `mkdir -p` on parents; `null` → `git rm -q` (file must exist, let git error). Then `git add -A` and `git commit -m <message> --allow-empty`.
- `remote: true`: `git init --bare <tmp>/origin.git`, `git remote add origin <path>`, `git push -q origin --all`.
- Finish with `checkout <spec.checkout ?? defaultBranch>`.
- At module load: `if (typeof afterEach === 'function') afterEach(cleanupFixtures)` via `import { afterEach } from 'vitest'` inside a try so the module also loads outside vitest (e2e helpers import `FIXTURE_GIT_ENV`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/gittyup && pnpm exec vitest run src/test/git-fixture.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup/src/test/git-fixture.ts apps/gittyup/src/test/git-fixture.test.ts
git commit -m "test(gittyup): declarative temp git repo fixture for unit tests"
```

---

### Task 2: Split unit and e2e vitest configs, co-locate the schema test, fix scripts

**Files:**
- Modify: `apps/gittyup/vitest.config.ts`
- Create: `apps/gittyup/vitest.e2e.config.ts`
- Move: `apps/gittyup/tests/unit/schema.test.ts` → `apps/gittyup/src/config/schema.test.ts` (delete `tests/unit/`)
- Modify: `apps/gittyup/package.json` (`scripts`)

**Interfaces:**
- Produces: `pnpm test` runs only `src/**/*.test.ts`; `pnpm test:e2e` runs only `tests/e2e/**/*.test.ts` with `globalSetup` from Task 3.

- [ ] **Step 1: Move the schema test and fix its import**

`git mv tests/unit/schema.test.ts src/config/schema.test.ts`; change the import to `'./schema.js'`.

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
```

- [ ] **Step 3: Write `vitest.e2e.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['./tests/e2e/global-setup.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Update `package.json` scripts**

Replace the `test*` entries with exactly:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "vitest run --config vitest.e2e.config.ts",
```

(`test:unit` and `test:integration` are removed.)

- [ ] **Step 5: Verify unit run is green and e2e run fails for the right reason**

Run: `cd apps/gittyup && pnpm test`
Expected: PASS — 2 files (`schema.test.ts`, `git-fixture.test.ts`), 16 tests.

Run: `cd apps/gittyup && pnpm test:e2e; echo exit=$?`
Expected: non-zero exit, message mentions `global-setup.ts` not found (the file arrives in Task 3). This confirms `passWithNoTests: false` plus `globalSetup` are wired.

- [ ] **Step 6: Commit**

```bash
git add apps/gittyup/vitest.config.ts apps/gittyup/vitest.e2e.config.ts apps/gittyup/package.json apps/gittyup/src/config/schema.test.ts
git rm -r --cached apps/gittyup/tests/unit 2>/dev/null; rmdir apps/gittyup/tests/unit 2>/dev/null
git commit -m "test(gittyup): split unit and e2e vitest configs, co-locate schema test"
```

---

### Task 3: E2E harness and smoke tests

**Files:**
- Create: `apps/gittyup/tests/e2e/global-setup.ts`
- Create: `apps/gittyup/tests/e2e/helpers.ts`
- Create: `apps/gittyup/tests/e2e/cli.smoke.test.ts`
- Modify: `apps/gittyup/tests/e2e/README.md` (replace the "or whatever env var the CLI exposes" guess with the real isolation contract below)

**Interfaces:**
- Consumes: `makeRepo`, `cleanupFixtures`, `FIXTURE_GIT_ENV` from Task 1 (`../../src/test/git-fixture.js`).
- Produces:

```ts
// tests/e2e/helpers.ts
export interface CliResult { stdout: string; stderr: string; exitCode: number }
export interface Workspace {
  /** temp dir used as cwd and as HOME/AGENTX_HOME for the spawned CLI */
  dir: string;
  /** path of <dir>/gittyup.yaml */
  manifestPath: string;
  /** rewrite gittyup.yaml from an object (yaml.dump) */
  writeManifest(manifest: Record<string, unknown>): Promise<void>;
  cleanup(): Promise<void>;
}
export async function createWorkspace(manifest?: Record<string, unknown>): Promise<Workspace>;
export async function runCli(ws: Workspace, args: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<CliResult>;
```

`runCli` spawns `node bin/gittyup.mjs <args>` (the real launcher, so the Bun re-exec path is exercised) with `cwd: ws.dir` and `env: { ...process.env, ...FIXTURE_GIT_ENV, HOME: ws.dir, AGENTX_HOME: ws.dir, GITHUB_TOKEN: '', GH_TOKEN: '', COPILOT_GITHUB_TOKEN: '', ...opts.env }`. It never throws on non-zero exit. `createWorkspace()` with no argument writes `{ workspace: '.', groups: {} }`. The temp dir is created with `mkdtemp(join(tmpdir(), 'gittyup-e2e-'))` and is not inside any git repository (asserted once in the smoke test, see below).

- [ ] **Step 1: Write `global-setup.ts`**

Same shape as `apps/taskmaster/tests/e2e/global-setup.ts`: `execFileSync('pnpm', ['exec', 'tsup'], { cwd: <app root>, stdio: 'inherit' })`.

- [ ] **Step 2: Write the failing smoke tests**

```ts
// tests/e2e/cli.smoke.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cleanupFixtures, makeRepo } from '../../src/test/git-fixture.js';
import { createWorkspace, runCli, type Workspace } from './helpers.js';

let ws: Workspace;
afterEach(async () => { await ws?.cleanup(); await cleanupFixtures(); });

describe('gittyup CLI smoke', () => {
  it('prints usage with every registered command', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['--help']);
    expect(r.exitCode).toBe(0);
    for (const cmd of ['init', 'repo', 'find', 'group', 'status', 'fetch', 'compare', 'merge', 'pick', 'prs', 'cache', 'auth', 'config', 'connect', 'rebrand'])
      expect(r.stdout).toContain(cmd);
  });

  it('does not read the developer\'s home config', async () => {
    ws = await createWorkspace();
    expect(() => execFileSync('git', ['-C', ws.dir, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' })).toThrow();
    const r = await runCli(ws, ['repo', 'list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No repos configured');
    expect(r.stdout).toContain(`config: ${ws.manifestPath}`);
  });

  it('shows a fixture repo on the status dashboard', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev', files: { 'f.txt': 'y\n' } },
      ],
    });
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fixture', path: repo.path, branches: { dev: 'develop', prod: 'main' } }] } },
    });
    const r = await runCli(ws, ['status', '--compact']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('fixture');
    expect(r.stdout).toContain('All clean');
  });

  it('config --show reports no GitHub token in an isolated home', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['config', '--show']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('not found');
  });
});
```

- [ ] **Step 3: Run the e2e suite to verify it fails**

Run: `cd apps/gittyup && pnpm test:e2e`
Expected: build runs, then FAIL — `Cannot find module './helpers.js'`.

- [ ] **Step 4: Implement `tests/e2e/helpers.ts`** per the Interfaces block. Use `js-yaml`'s `dump` for `writeManifest`; `promisify(execFile)` with `maxBuffer: 10 * 1024 * 1024`; map a thrown error's `code` to `exitCode` (default 1), as `apps/taskmaster/tests/e2e/helpers.ts` does.

- [ ] **Step 5: Run the e2e suite to verify it passes**

Run: `cd apps/gittyup && pnpm test:e2e`
Expected: PASS, 4 tests. Also run `pnpm test` again: still 16 tests, no e2e file picked up.

- [ ] **Step 6: Update `tests/e2e/README.md`**

Replace the "Gittyup-specific notes" section with three bullets: isolation is `cwd` = temp workspace with `gittyup.yaml`, `HOME` and `AGENTX_HOME` = that dir, `FIXTURE_GIT_ENV` applied; repos come from `src/test/git-fixture.ts`; GitHub is never hit (tokens blanked), tests that need the API stub `fetch`.

- [ ] **Step 7: Commit**

```bash
git add apps/gittyup/tests/e2e
git commit -m "test(gittyup): e2e harness spawning the built CLI against temp workspaces"
```

---

### Task 4: Changeset, typecheck, lint, and PR

**Files:**
- Create: `.changeset/gittyup-test-harness.md`

- [ ] **Step 1: Write the changeset**

```md
---
"@helmsmith/gittyup": minor
---

Test harness: declarative temp-git-repo fixture (`src/test/git-fixture.ts`), e2e harness that spawns the built CLI against isolated temp workspaces, unit/e2e vitest configs split. `test:unit` and `test:integration` scripts removed; `pnpm test` runs co-located unit tests only. First slice of the 2026-10-19 hardening spec; version moves to 0.2.0.
```

- [ ] **Step 2: Verify the whole app**

Run, from `apps/gittyup`: `pnpm typecheck && pnpm test && pnpm test:e2e && (cd ../.. && pnpm exec biome check apps/gittyup)`
Expected: all four exit 0.

- [ ] **Step 3: Commit and open the PR**

```bash
git add .changeset/gittyup-test-harness.md
git commit -m "chore(gittyup): changeset for the test harness slice"
```

PR title: `test(gittyup): git fixture + e2e harness (hardening slice 3.10)`. Body links the spec and this plan, lists the three test files, and states that no command behavior changed.

---

## Self-review notes

- Spec §3.10 asks for a `makeRepo(spec)` fixture (Task 1), `tests/e2e/cli.test.ts` (Task 3, named `cli.smoke.test.ts`; the `config --ai bad` and `merge --no-fetch` cases it lists belong to slices 3.6 and 3.1–3.2 and are added by those plans), removal or creation of `test:integration` (Task 2 removes it), `passWithNoTests: false` (Task 2).
- `npm pack --dry-run` assertion is slice 3.8, not here.
- Co-locating `schema.test.ts` is not in the spec but is required by `toolbox-conventions.md`; it rides along in Task 2 because the config split would otherwise leave `tests/unit/` unreachable.

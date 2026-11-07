# gittyup `--json` contract (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gittyup command a program would call, except `merge`/`pick`, accepts `--json` and keeps the contract in spec §3: one JSON line on stdout, a JSON error body on stderr, exit 2 for "refused" and 1 for "broken", and never a prompt.

**Architecture:**
- **Detection and plumbing (`cli.ts`).** JSON mode is detected once from argv in `cli.ts`, before commander parses, so usage errors are caught too.
- **Output module (`src/output/json.ts`).** Entering JSON mode redirects `console.log`/`console.info` to stderr and keeps the real stdout writer for the single document. That way no stray print, however deep, can corrupt it.
- **Errors (`src/core/errors.ts`).** A `GittyupError(code, message, details?)` class carries refusals.
- **Commands.** Each command builds its document from data it already has. Every document type lives in one file, `src/output/contract.ts`.
- **Text mode stays byte-for-byte as it is**, except status's ahead/behind (spec §7).

**Tech Stack:** TypeScript (ESM, tsup bundle, run under Bun via `bin/gittyup.mjs`), commander 15, zod 4, simple-git 4, vitest 5.0.3 (unit: `src/**/*.test.ts`; e2e: `tests/e2e/**/*.test.ts`, which spawns the built CLI).

**Spec:** `docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md` (approved 2026-11-07). This plan covers §3, §4, §7, and the PR 1 part of §9. `merge`/`pick` (§5) are PR 2 and get their own plan.

## Global Constraints

- **Success:** stdout is exactly one line, `JSON.stringify(doc) + '\n'`. Nothing else may reach stdout under `--json`.
- **Failure:** stdout is empty. The last non-empty stderr line is `{"code": "...", "message": "...", "details"?: {...}}`. Exit 2 for refusals (`USAGE`, `CONFIRMATION_REQUIRED`, `INTERACTIVE_ONLY`, `TARGET_REQUIRED`, `TARGET_UNKNOWN`, `GROUP_EXISTS`, `GROUP_NOT_FOUND`, `REPO_EXISTS`, `REPO_NOT_FOUND`, `PATH_NOT_FOUND`, `MANIFEST_INVALID`, `AUTH_REQUIRED`); exit 1 for `GIT_FAILED`, `GITHUB_FAILED`, `INTERNAL`.
- **Partial multi-repo runs** (`fetch`): the full report goes to stdout and the exit code is 1.
- **Never prompt** under `--json`. A request that would need a prompt is refused with `INTERACTIVE_ONLY`.
- **Values:**
  - Unknown is `null`, never `0`/`false`/`'unknown'`/`'error'`.
  - Dates are git's ISO-8601 strings (`%aI`).
  - SHAs are the full 40 characters.
  - No ANSI escapes in any value.
- **Text mode is unchanged:** same output, same exit codes, `config:` footer still on stdout. The one sanctioned change is that status shows `–` instead of `0` for ahead/behind when there is no tracking ref.
- **`--json` is a per-command option**, declared as `.option('--json', '<one-line description of the document>')`, the same style as workbrokr and storybrokr.
- **Build on the rename** (PR #143, merged as `df686c3`). It uses `HELMSMITH_HOME` and `~/.helmsmith`. Never write `AGENTX_*` in new code or tests.
- **Spinners:** no per-site change. `ora` already draws no animation when stderr is not a TTY, which holds for every program caller, so spec §3.5's "stderr stays readable in logs" is met as is. Where a JSON code path is being rewritten anyway (status `--fetch`), just don't start one.
- **vitest:** never put a bare `RegExp` inside `toMatchObject`/`toEqual`, because it asserts nothing here. Use `expect.stringMatching(...)`.
- **Never run `biome --write` on `.md` files**, because it breaks changeset frontmatter. Scope biome to `src` and `tests`.
- **While 0.x,** document-shape changes forced by hardening slices are listed in the CHANGELOG under a "JSON contract" heading (spec §3.6).

## Review Focus

1. **`--json` on a command that doesn't take it** (`connect --json`, `init --json`, `auth login --json`): the caller expects a `USAGE` error body and exit 2, not commander's plain-text error. Task 3 tests this.
2. **No manifest anywhere** (fresh machine): read commands return empty documents with `manifest.exists: false` and exit 0, not an error. Tested in Task 5 (`repo list`) and Task 7 (`status`).
3. **A manifest entry whose path doesn't exist on disk:** `status --json` returns that repo with an `error` string, `branches: {}` and exit 0, and still reports the other repos. Task 7 tests this.
4. **A stray print from shared code** during a JSON run, such as compare's cache notice on a cache hit: it lands on stderr and stdout stays one line. Task 8 tests this with a second `compare` run.
5. **Option values that look like JSON:** `repo add … --branches '{"dev":"develop"}' --json` parses the map, and `--branches 'nope' --json` is `USAGE` (today an uncaught `SyntaxError`). Task 4 tests both.

---

### Task 0: Branch and carry the docs

**Files:** none changed in code.

- [ ] **Step 1: Create the worktree from `origin/main`.** The rename merged as `df686c3` (PR #143). Another session is releasing gittyup 0.4.0 on `release/gittyup-0.4.0` with 6 pending changesets on main, so **never run `changeset version` on this branch**.

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
git fetch origin
git worktree add .worktrees/gittyup-json -b gittyup/json-contract origin/main
cd .worktrees/gittyup-json
PATH="$(npx -y -p node-gyp@11 -c 'dirname "$(command -v node-gyp)"' | tail -1):$PATH" pnpm install --frozen-lockfile
```

- [ ] **Step 2: Baseline.** Run `cd apps/gittyup && npx vitest run && npx vitest run --config vitest.e2e.config.ts && npx tsc --noEmit`. Expected: all green (88 unit / 15 e2e as of 7dda083; the rename keeps the counts). If anything is red, stop and report it.

- [ ] **Step 3: Copy the spec and this plan in from the main checkout** (both are untracked there) and commit them.

```bash
cp ../../docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md docs/superpowers/specs/
cp ../../docs/superpowers/plans/2026-11-07-gittyup-json-contract.md docs/superpowers/plans/
git add docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md docs/superpowers/plans/2026-11-07-gittyup-json-contract.md
git commit -m "docs(gittyup): --json mode design and PR 1 plan"
```

All later paths are relative to `apps/gittyup/` unless they start with `docs/`.

---

### Task 1: Error model

**Files:**
- Create: `src/core/errors.ts`
- Test: `src/core/errors.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorCode`: the 15 codes in Global Constraints, as a string-literal union.
  - `class GittyupError extends Error { readonly code: ErrorCode; readonly details?: Record<string, unknown>; constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) }` with `name = 'GittyupError'`.
  - `interface ErrorBody { code: ErrorCode; message: string; details?: Record<string, unknown> }`.
  - `function toErrorBody(err: unknown): ErrorBody`.
  - `function exitCodeFor(code: ErrorCode): 1 | 2`.
  - These mirror `apps/workbrokr/src/core/errors.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('exitCodeFor', () => {
  it.each([
    'USAGE', 'CONFIRMATION_REQUIRED', 'INTERACTIVE_ONLY', 'TARGET_REQUIRED', 'TARGET_UNKNOWN',
    'GROUP_EXISTS', 'GROUP_NOT_FOUND', 'REPO_EXISTS', 'REPO_NOT_FOUND', 'PATH_NOT_FOUND',
    'MANIFEST_INVALID', 'AUTH_REQUIRED',
  ] as const)('%s is a refusal (2)', (code) => expect(exitCodeFor(code)).toBe(2));
  it.each(['GIT_FAILED', 'GITHUB_FAILED', 'INTERNAL'] as const)('%s is broken (1)', (code) =>
    expect(exitCodeFor(code)).toBe(1));
});

describe('toErrorBody', () => {
  it('keeps code, message and details of a GittyupError', () => {
    expect(toErrorBody(new GittyupError('TARGET_UNKNOWN', '"x" is not a known group or repo', { target: 'x' })))
      .toStrictEqual({ code: 'TARGET_UNKNOWN', message: '"x" is not a known group or repo', details: { target: 'x' } });
  });
  it('omits details when there are none', () => {
    expect(Object.keys(toErrorBody(new GittyupError('USAGE', 'bad')))).toEqual(['code', 'message']);
  });
  it('maps any other Error to INTERNAL', () =>
    expect(toErrorBody(new Error('boom'))).toStrictEqual({ code: 'INTERNAL', message: 'boom' }));
  it('maps a thrown non-Error to INTERNAL', () =>
    expect(toErrorBody('str')).toStrictEqual({ code: 'INTERNAL', message: 'str' }));
});
```

- [ ] **Step 2: Run** `npx vitest run src/core/errors.test.ts`. Expected: FAIL, because `./errors.js` cannot be resolved.
- [ ] **Step 3: Implement `src/core/errors.ts`** with the interfaces above. Keep the refusal set in a `Set<ErrorCode>`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): GittyupError and error codes for --json"`.

---

### Task 2: JSON output primitives

**Files:**
- Create: `src/output/json.ts`
- Test: `src/output/json.test.ts`

**Interfaces:**
- Consumes: `toErrorBody`, `exitCodeFor`, `GittyupError` (Task 1).
- Produces:
  - `function wantsJson(argv: readonly string[]): boolean`: true iff an element equals `'--json'` before any `'--'` terminator.
  - `interface JsonIo { writeOut(s: string): void; writeErr(s: string): void; exit(code: number): never }`.
  - `function createJsonOutput(io: JsonIo): { emit(doc: unknown): void; fail(err: unknown): never }`:
    - `emit` writes `JSON.stringify(doc) + '\n'` via `writeOut`. A second call throws `GittyupError('INTERNAL', 'emitJson called twice')`.
    - `fail` writes `JSON.stringify(toErrorBody(err)) + '\n'` via `writeErr`, then calls `exit(exitCodeFor(body.code))`.
  - `function redirectConsoleToStderr(target: Pick<Console, 'log' | 'info'>, writeErr: (s: string) => void): () => void`: replaces `log` and `info` with `(...a) => writeErr(util.format(...a) + '\n')` and returns a restore function.
  - `function enterJsonMode(): void`:
    - Captures `process.stdout.write.bind(process.stdout)` before redirecting.
    - Installs the console redirect onto `process.stderr`.
    - Stores a module-level `createJsonOutput({ writeOut: captured, writeErr: s => process.stderr.write(s), exit: c => process.exit(c) })`.
  - `function emitJson(doc: unknown): void` and `function failJson(err: unknown): never`: delegate to the stored instance, and throw `GittyupError('INTERNAL', 'not in JSON mode')` if `enterJsonMode` hasn't run.

- [ ] **Step 1: Write the failing tests** (use a fake `JsonIo` that records calls; `exit` throws a sentinel so `never` holds)

```ts
it('wantsJson finds --json but not after --', () => {
  expect(wantsJson(['status', '--json'])).toBe(true);
  expect(wantsJson(['status'])).toBe(false);
  expect(wantsJson(['repo', 'add', '--', '--json'])).toBe(false);
  expect(wantsJson(['repo', 'add', 'g', 'n', 'p', '--branches', '{"json":1}'])).toBe(false);
});
it('emit writes one compact line, escaping newlines inside values', () => {
  const io = fakeIo();
  createJsonOutput(io).emit({ a: 'x\ny', n: null });
  expect(io.out).toEqual(['{"a":"x\\ny","n":null}\n']);
});
it('emit refuses a second document', () => {
  const out = createJsonOutput(fakeIo());
  out.emit({});
  expect(() => out.emit({})).toThrow(/twice/);
});
it('fail writes the error body to stderr and exits 2 for a refusal', () => {
  const io = fakeIo();
  expect(() => createJsonOutput(io).fail(new GittyupError('TARGET_UNKNOWN', 'nope'))).toThrow(EXIT);
  expect(io.err).toEqual(['{"code":"TARGET_UNKNOWN","message":"nope"}\n']);
  expect(io.exitCode).toBe(2);
  expect(io.out).toEqual([]);
});
it('fail exits 1 for an unexpected error', () => {
  const io = fakeIo();
  expect(() => createJsonOutput(io).fail(new Error('boom'))).toThrow(EXIT);
  expect(io.exitCode).toBe(1);
});
it('redirectConsoleToStderr formats like console.log and restores', () => {
  const target = { log: () => {}, info: () => {} };
  const original = target.log;
  const err: string[] = [];
  const restore = redirectConsoleToStderr(target, (s) => err.push(s));
  target.log('a', 1, { b: 2 });
  target.info('i');
  expect(err).toEqual(['a 1 { b: 2 }\n', 'i\n']);
  restore();
  expect(target.log).toBe(original);
});
```

- [ ] **Step 2: Run** `npx vitest run src/output/json.test.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `src/output/json.ts`** with the interfaces above. `enterJsonMode` is not unit-tested, because it patches process globals. Task 3's e2e tests cover it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): JSON output primitives (single-document stdout, stderr error body)"`.

---

### Task 3: CLI wiring, e2e contract helpers, first command (`cache`)

**Files:**
- Modify: `src/cli.ts` (whole file, about 60 lines)
- Create: `src/output/contract.ts` (document types; later tasks append to it)
- Modify: `src/commands/cache.ts`
- Modify: `tests/e2e/helpers.ts` (append two helpers)
- Create: `tests/e2e/json.test.ts` (later tasks add `describe` blocks)

**Interfaces:**
- Consumes: `wantsJson`, `enterJsonMode`, `emitJson`, `failJson` (Task 2); `GittyupError` (Task 1).
- Produces:
  - `contract.ts`: `interface CacheClearDocument { cleared: number }`, `interface CachePruneDocument { pruned: number }`.
  - `helpers.ts`:
    - `function parseJsonLine(stdout: string): any`: throws unless stdout is exactly one `\n`-terminated line, then `JSON.parse`s it.
    - `function parseErrorLine(stderr: string): { code: string; message: string; details?: Record<string, unknown> }`: `JSON.parse` of the last non-empty stderr line.
  - Every later task's command reads `opts.json` and calls `emitJson(doc)`. Errors are thrown as `GittyupError`; the top-level catch in `cli.ts` turns them into `failJson`.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/json.test.ts` (same `afterEach` cleanup pattern as `cli.smoke.test.ts`)

```ts
describe('--json contract: cache', () => {
  it('cache clear --json prints one document and no footer', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ cleared: 0 });
    expect(r.stdout).not.toContain('config:');
  });
  it('cache prune --json', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'prune', '--json']);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ pruned: 0 });
  });
});

describe('--json contract: usage errors', () => {
  it('an unknown option is USAGE, exit 2, empty stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json', '--bogus']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    expect(parseErrorLine(r.stderr)).toMatchObject({ code: 'USAGE', message: expect.stringMatching(/unknown option/) });
  });
  it.each([['connect'], ['init'], ['auth', 'login']])('%s does not take --json → USAGE', async (...cmd) => {
    ws = await createWorkspace();
    const r = await runCli(ws, [...cmd, '--json']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    expect(parseErrorLine(r.stderr).code).toBe('USAGE');
  });
  it('text mode is untouched: no --json keeps the footer on stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`config: ${ws.manifestPath}`);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.e2e.config.ts tests/e2e/json.test.ts`. Expected: the `--json` tests FAIL (unknown option `--json` → exit 1 with commander text), and the text-mode test PASSES.
- [ ] **Step 3: Wire `src/cli.ts`.** Order matters, because commander copies `exitOverride` and output settings to subcommands when `.command()` runs:
  1. Compute `const json = wantsJson(process.argv.slice(2))`. If true, call `enterJsonMode()`.
  2. Right after `createCli`, if `json`: call `program.exitOverride()` and `program.configureOutput({ outputError: () => {} })` **before** any `registerX(program)`.
  3. In the `postAction` hook, return early when `json`.
  4. Parsing:
     - Text mode keeps `program.parse()`.
     - JSON mode runs `await program.parseAsync()` inside `try`.
     - In the `catch`: a `CommanderError` with `exitCode === 0` (help/version) → `process.exit(0)`. Any other `CommanderError` → `failJson(new GittyupError('USAGE', err.message.replace(/^error: /, ''), { commander: err.code }))`. Anything else → `failJson(err)`.
- [ ] **Step 4: Add `--json` to `cache clear` and `cache prune`.** When `opts.json`, call `emitJson({ cleared })` / `emitJson({ pruned })` instead of the chalk line. Add both types to `contract.ts`.
- [ ] **Step 5: Run** the Step 2 command. Expected: PASS. Then run the whole e2e suite: still green, and `cli.smoke` proves text mode is untouched.
- [ ] **Step 6: Commit** with `git commit -m "feat(gittyup): --json plumbing in the CLI entry; cache clear/prune --json"`.

---

### Task 4: Refusal codes at the throw sites; `group` and `repo add/remove --json`

**Files:**
- Modify: `src/core/repo-manager.ts` (`getReposForTarget`)
- Modify: `src/config/manifest.ts` (`load`, `addRepo`, `removeRepo`, `createGroup`, `removeGroup`)
- Modify: `src/auth/token-manager.ts` (`requireGitHubToken`'s final throw)
- Modify: `src/commands/group.ts`, `src/commands/repo.ts` (`add`, `remove`), `src/output/contract.ts`
- Test: `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - Thrown codes; each **keeps its current message text** so text mode reads the same:
    - `TARGET_UNKNOWN` (details `{ target }`)
    - `REPO_EXISTS` (details `{ group, repo }`)
    - `GROUP_NOT_FOUND` (details `{ group }`)
    - `REPO_NOT_FOUND` (details `{ group, repo }`)
    - `GROUP_EXISTS` (details `{ group }`)
    - `AUTH_REQUIRED`
    - `MANIFEST_INVALID`: wraps a YAML or zod failure in `load()`. The message is `Invalid manifest ${path}: ${original message}`; details are `{ path }`.
    - `USAGE`: `repo add --branches` that isn't valid JSON, or isn't an object of strings.
  - `contract.ts`:
    - `interface RepoDocument { name: string; path: string; remote: string; url: string | null; branches: Record<string, string>; tags: string[] }`
    - `GroupCreateDocument { created: { group: string; description: string | null } }`
    - `GroupRemoveDocument { removed: { group: string } }`
    - `RepoAddDocument { added: { group: string; groupCreated: boolean; repo: RepoDocument } }`
    - `RepoRemoveDocument { removed: { group: string; repo: string } }`
    - `function toRepoDocument(repo: RepoConfig): RepoDocument` (lives in `contract.ts`; maps `url: repo.url ?? null`)

- [ ] **Step 1: Write the failing e2e tests** (`describe('--json contract: manifest CRUD')`)

```ts
it('group create/remove round trip and refusals', async () => {
  ws = await createWorkspace();
  let r = await runCli(ws, ['group', 'create', 'web', '--desc', 'Web apps', '--json']);
  expect(parseJsonLine(r.stdout)).toStrictEqual({ created: { group: 'web', description: 'Web apps' } });
  r = await runCli(ws, ['group', 'create', 'web', '--json']);
  expect([r.exitCode, r.stdout, parseErrorLine(r.stderr).code]).toEqual([2, '', 'GROUP_EXISTS']);
  r = await runCli(ws, ['group', 'remove', 'web', '--json']);
  expect(parseJsonLine(r.stdout)).toStrictEqual({ removed: { group: 'web' } });
  r = await runCli(ws, ['group', 'remove', 'web', '--json']);
  expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'GROUP_NOT_FOUND']);
});
it('repo add/remove with branches, groupCreated and refusals', async () => {
  ws = await createWorkspace();
  let r = await runCli(ws, ['repo', 'add', 'web', 'app', './app', '--branches', '{"dev":"develop"}', '--json']);
  expect(parseJsonLine(r.stdout)).toStrictEqual({ added: { group: 'web', groupCreated: true,
    repo: { name: 'app', path: join(ws.dir, 'app'), remote: 'origin', url: null, branches: { dev: 'develop' }, tags: [] } } });
  r = await runCli(ws, ['repo', 'add', 'web', 'app', './app', '--json']);
  expect(parseErrorLine(r.stderr).code).toBe('REPO_EXISTS');
  r = await runCli(ws, ['repo', 'add', 'web', 'b', './b', '--branches', 'nope', '--json']);
  expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'USAGE']);
  r = await runCli(ws, ['repo', 'remove', 'web', 'app', '--json']);
  expect(parseJsonLine(r.stdout)).toStrictEqual({ removed: { group: 'web', repo: 'app' } });
  r = await runCli(ws, ['repo', 'remove', 'web', 'app', '--json']);
  expect(parseErrorLine(r.stderr).code).toBe('REPO_NOT_FOUND');
});
it('an invalid manifest is MANIFEST_INVALID', async () => {
  ws = await createWorkspace({ groups: 5 });
  const r = await runCli(ws, ['group', 'create', 'x', '--json']);
  expect([r.exitCode, r.stdout]).toEqual([2, '']);
  expect(parseErrorLine(r.stderr)).toMatchObject({ code: 'MANIFEST_INVALID', details: { path: ws.manifestPath } });
});
it('text mode keeps its wording and exit 1', async () => {
  ws = await createWorkspace();
  await runCli(ws, ['group', 'create', 'web']);
  const r = await runCli(ws, ['group', 'create', 'web']);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('Group "web" already exists');
});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.e2e.config.ts tests/e2e/json.test.ts -t "manifest CRUD"`. Expected: FAIL (unknown option `--json`).
- [ ] **Step 3: Convert the throw sites** listed under Produces. `groupCreated` is `manifest.getGroup(group) === undefined` read before `addRepo`. Parse `--branches` with `JSON.parse`, then require a plain object of string values. Anything else throws `USAGE` with the message `--branches must be a JSON object of alias → branch name`.
- [ ] **Step 4: Add `--json` to `group create`, `group remove`, `repo add`, `repo remove`**, emitting the documents above.
- [ ] **Step 5: Run** the Step 2 command, then the full unit and e2e suites. Expected: PASS. In particular, `cli-robustness` and `cli.smoke` still pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(gittyup): refusal codes at throw sites; group and repo add/remove --json"`.

---

### Task 5: `repo list`, `repo tags`, `repo tag` under `--json`

**Files:**
- Modify: `src/commands/repo.ts` (`list`, `tag`, `tags`), `src/output/contract.ts`
- Test: `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: `toRepoDocument` (Task 4), `GittyupError`.
- Produces (`contract.ts`):
  - `interface ManifestRef { path: string; exists: boolean }`
  - `RepoListDocument { manifest: ManifestRef; groups: Array<{ name: string; description: string | null; repos: RepoDocument[] }> }`
  - `RepoTagsDocument { tags: Array<{ tag: string; repos: number }> }`
  - `RepoTagDocument { updated: Array<{ repo: string; tags: string[] }>; added: string[]; removed: string[] }`
  - `function manifestRef(m: ManifestManager): ManifestRef` (in `contract.ts`; `exists` is `existsSync(m.manifestPath)`)

- [ ] **Step 1: Write the failing e2e tests**

```ts
it('repo list --json with no manifest anywhere is empty, not an error', async () => {
  ws = await createWorkspace();
  await rm(ws.manifestPath);
  const r = await runCli(ws, ['repo', 'list', '--json']);
  expect(r.exitCode).toBe(0);
  expect(parseJsonLine(r.stdout)).toStrictEqual({
    manifest: { path: expect.stringMatching(/gittyup\.yaml$/), exists: false }, groups: [] });
});
it('repo list --json always includes tags; repo tags counts them sorted', async () => {
  ws = await createWorkspace({ workspace: '.', groups: { web: { description: 'Web', repos: [
    { name: 'a', path: '/x/a', branches: { dev: 'develop' }, tags: ['web', 'api'] },
    { name: 'b', path: '/x/b', url: 'https://github.com/o/b.git', branches: {}, tags: ['api'] } ] } } });
  const list = parseJsonLine((await runCli(ws, ['repo', 'list', '--json'])).stdout);
  expect(list.groups).toStrictEqual([{ name: 'web', description: 'Web', repos: [
    { name: 'a', path: '/x/a', remote: 'origin', url: null, branches: { dev: 'develop' }, tags: ['web', 'api'] },
    { name: 'b', path: '/x/b', remote: 'origin', url: 'https://github.com/o/b.git', branches: {}, tags: ['api'] } ] }]);
  expect(parseJsonLine((await runCli(ws, ['repo', 'tags', '--json'])).stdout))
    .toStrictEqual({ tags: [{ tag: 'api', repos: 2 }, { tag: 'web', repos: 1 }] });
});
it('repo tag --json needs --add or --remove (no prompt)', async () => {
  ws = await createWorkspace({ workspace: '.', groups: { web: { repos: [{ name: 'a', path: '/x/a', tags: ['old'] }] } } });
  let r = await runCli(ws, ['repo', 'tag', '--json']);
  expect([r.exitCode, r.stdout, parseErrorLine(r.stderr).code]).toEqual([2, '', 'INTERACTIVE_ONLY']);
  r = await runCli(ws, ['repo', 'tag', '-g', 'web', '--add', 'api,core', '--remove', 'old', '--json']);
  expect(parseJsonLine(r.stdout)).toStrictEqual({ updated: [{ repo: 'a', tags: ['api', 'core'] }], added: ['api', 'core'], removed: ['old'] });
});
```

- [ ] **Step 2: Run** with `-t "repo list|repo tag"`. Expected: FAIL.
- [ ] **Step 3: Implement.** `repo tag --json` without `--add`/`--remove` throws `GittyupError('INTERACTIVE_ONLY', 'repo tag needs --add or --remove with --json')` **before** any prompt import runs. `--tags` on `list` is accepted and ignored under `--json`.
- [ ] **Step 4: Run** the Step 2 command, then the full e2e suite. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): repo list/tags/tag --json"`.

---

### Task 6: `config`, `auth status`, `auth models` under `--json`

**Files:**
- Modify: `src/commands/config.ts`, `src/commands/auth.ts`, `src/output/contract.ts`
- Test: `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: `resolveGitHubToken(): Promise<TokenSource | null>`, `requireGitHubToken(): Promise<TokenSource>` (throws `AUTH_REQUIRED` after Task 4), `getCopilotToken(token, { fromEnv })`, `fetchCopilotModels(): Promise<CopilotModelEntry[] | null>`, all from `src/auth/token-manager.ts`. Also `AiModeSchema` from `src/config/schema.ts`.
- Produces (`contract.ts`):
  - `interface TokenRow { available: boolean; source: string | null }`
  - `ConfigDocument { manifest: { path: string; location: 'home' | 'repo' }; settings: { aiMode: AiMode; aiModel: string; aiModelIsDefault: boolean; conflictBranchPrefix: string }; agent: TokenRow; github: TokenRow }`
  - `AuthStatusDocument { agent: TokenRow & { reachable: boolean | null }; github: TokenRow }`
  - `AuthModelsDocument { models: Array<{ id: string; maxPromptTokens: number | null; maxOutputTokens: number | null }> }`
  - `async function tokenRows(): Promise<{ agent: TokenRow; github: TokenRow }>` (in `config.ts`, exported for `auth.ts`):
    - `agent` comes from `resolveGitHubToken`.
    - `github` comes from `requireGitHubToken`; an `AUTH_REQUIRED` is caught and becomes `{ available: false, source: null }`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
it('config --json shows defaults and no tokens', async () => {
  ws = await createWorkspace();
  const doc = parseJsonLine((await runCli(ws, ['config', '--json'])).stdout);
  expect(doc).toStrictEqual({ manifest: { path: ws.manifestPath, location: 'home' },
    settings: { aiMode: 'suggest', aiModel: 'gpt-4o', aiModelIsDefault: true, conflictBranchPrefix: 'conflict-resolution' },
    agent: { available: false, source: null }, github: { available: false, source: null } });
});
it('config --ai/--model --json persists and returns the new settings', async () => {
  ws = await createWorkspace();
  const doc = parseJsonLine((await runCli(ws, ['config', '--ai', 'auto', '--model', 'gpt-5', '--json'])).stdout);
  expect(doc.settings).toStrictEqual({ aiMode: 'auto', aiModel: 'gpt-5', aiModelIsDefault: false, conflictBranchPrefix: 'conflict-resolution' });
  expect(await readFile(ws.manifestPath, 'utf-8')).toContain('ai_mode: auto');
});
it('config --ai with an unknown mode is USAGE and leaves the manifest alone', async () => {
  ws = await createWorkspace();
  const before = await readFile(ws.manifestPath, 'utf-8');
  const r = await runCli(ws, ['config', '--ai', 'bogus', '--json']);
  expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'USAGE']);
  expect(await readFile(ws.manifestPath, 'utf-8')).toBe(before);
});
it('a GITHUB_TOKEN shows up as the source in both rows (no network)', async () => {
  ws = await createWorkspace();
  const doc = parseJsonLine((await runCli(ws, ['config', '--json'], { env: { GITHUB_TOKEN: 'ghp_test' } })).stdout);
  expect([doc.agent, doc.github]).toEqual([{ available: true, source: 'env:GITHUB_TOKEN' }, { available: true, source: 'env:GITHUB_TOKEN' }]);
  expect(JSON.stringify(doc)).not.toContain('ghp_test');
});
it('auth status --json with no token, and auth models --json refuses', async () => {
  ws = await createWorkspace();
  expect(parseJsonLine((await runCli(ws, ['auth', 'status', '--json'])).stdout)).toStrictEqual({
    agent: { available: false, source: null, reachable: null }, github: { available: false, source: null } });
  const r = await runCli(ws, ['auth', 'models', '--json']);
  expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'AUTH_REQUIRED']);
});
```

`location: 'home'` is today's label for a manifest found by walking up from the cwd. That label is wrong (spec §6, finding 5), but this PR reports what the code reports.

- [ ] **Step 2: Run** with `-t "config|auth"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `config --json` checks `--ai` with `AiModeSchema.safeParse` **before** `updateSettings`; on failure it throws `USAGE` and does not save. Text mode is unchanged.
  - `auth status --json`: `reachable` is `null` without an agent token. Otherwise it is `true`/`false` from `getCopilotToken(token, { fromEnv: source !== 'auth.json' })` resolving or throwing.
  - `auth models --json` with no agent token throws `AUTH_REQUIRED` (message as in today's text). A `null` from `fetchCopilotModels` *with* a token throws `GITHUB_FAILED` with the message `could not fetch Copilot models`.
  - Map `capabilities.limits.max_prompt_tokens`/`max_output_tokens` to `?? null`.
- [ ] **Step 4: Run** the Step 2 command, then the full e2e suite. Expected: PASS. If the no-token cases fail locally, check `HOME=<ws> gh auth token` on this machine. CI has no `gh` login.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): config and auth status/models --json with agent/github token rows"`.

---

### Task 7: Honest branch state and `status --json`

**Files:**
- Modify: `src/config/schema.ts` (`RepoBranchState`)
- Modify: `src/core/git-operations.ts` (`getBranchState`)
- Modify: `src/ui/dashboard.ts:88-97`
- Modify: `src/commands/status.ts`, `src/output/contract.ts`
- Test: `src/core/git-operations.test.ts` (new `describe('getBranchState tracking')`), `src/commands/status.test.ts` (create), `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: `makeRepo`/`cleanupFixtures` (`src/test/git-fixture.ts`; `remote: true` creates a bare `origin` and pushes all branches), `RepoManager.getStates`, `fetchAll`.
- Produces:
  - `RepoBranchState` becomes `{ branch: string; ahead: number | null; behind: number | null; tracking: boolean; trackingBranch?: string; hasConflicts: boolean; isDirty: boolean; lastCommit: string /* 8-char display, unchanged */; lastCommitSha: string | null; lastCommitDate: string }`.
  - `StatusDocument` (`contract.ts`, shape exactly as spec §4 "status").
  - `function toStatusDocument(states: RepoState[], ctx: { manifest: ManifestRef; fetch: Array<{ repo: string; success: boolean; error?: string }> | null; now: Date }): StatusDocument`, exported from `src/commands/status.ts`. Mapping rules:
    - `currentBranch` is `null` when `state.error` is set.
    - `lastCommit` is `{ sha, date }`, or `null` when `lastCommitSha` is `null`.
    - `fetch` rows become `{ repo, ok: success, error? }`.
    - `summary.withConflicts` counts `hasUnresolved`; `summary.withErrors` counts `error`.

- [ ] **Step 1: Write the failing unit tests**

```ts
describe('getBranchState tracking', () => {
  it('reports null ahead/behind when there is no tracking ref', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const s = await new GitOperations(repo.path).getBranchState('main');
    expect(s).toMatchObject({ tracking: false, ahead: null, behind: null, lastCommitSha: await repo.sha('main') });
    expect(s.lastCommitSha).toMatch(/^[0-9a-f]{40}$/);
  });
  it('counts against origin/<branch> when it exists', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }], remote: true });
    await repo.git.raw(['commit', '--allow-empty', '-m', 'local only']);
    expect(await new GitOperations(repo.path).getBranchState('main'))
      .toMatchObject({ tracking: true, ahead: 1, behind: 0, trackingBranch: 'origin/main' });
  });
});
```

In `src/commands/status.test.ts`, build two hand-written `RepoState` literals: one healthy with a `dev` branch (`tracking: false, ahead: null`), and one with `error: 'Repo path not found: /nope (gone)'`, `currentBranch: 'error'`, `branches: {}`. Assert `toStatusDocument(..., { manifest: { path: '/w/gittyup.yaml', exists: true }, fetch: null, now: new Date('2026-11-07T00:00:00Z') })` `toStrictEqual`s a hand-written `StatusDocument`. The error repo's `currentBranch` is `null` and `summary` is `{ repos: 2, withConflicts: 0, withErrors: 1 }`.

- [ ] **Step 2: Run** `npx vitest run src/core/git-operations.test.ts src/commands/status.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`getBranchState`:** `tracking = await this.branchExists(trackingRef)`. Run the `rev-list` only when tracking. `lastCommitSha` is `latest?.hash ?? null`. The `catch` path returns `tracking: false, ahead: null, behind: null, lastCommitSha: null`.
  - **Dashboard:** `null` ahead or behind renders `chalk.dim('–')`. The diverged icon needs both values to be non-null and `> 0`.
  - **`status --json`:** emits `toStatusDocument(...)` and skips `Dashboard.render`. With `--fetch`, keep the `fetchAll` result (today it's discarded) and pass it as `ctx.fetch`; there is no spinner in JSON mode. `--compact` is ignored.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Write the failing e2e tests** (`describe('--json contract: status')`):
  1. A fixture repo with no remote and aliases `{ dev: 'develop', prod: 'main' }`. Assert `repos[0].branches.dev` `toMatchObject({ branch: 'develop', tracking: false, ahead: null, behind: null, lastCommit: { sha: expect.stringMatching(/^[0-9a-f]{40}$/), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) } })` and `manifest.exists === true`.
  2. A manifest repo whose path doesn't exist, next to a real one. Assert exit 0, two rows, and the missing one has `error: expect.stringMatching(/not found/)` and `branches: {}`.
  3. `status -g nope --json` gives exit 2 with `TARGET_UNKNOWN`.
  4. With no manifest, assert `{ repos: [], manifest: { exists: false } }` via `toMatchObject`.
  5. `status --fetch --json` on a repo without `origin` gives exit 0 and `fetch: [{ repo, ok: false, error: expect.any(String) }]`.
  6. Text `status` on the no-remote repo shows `–` in the ahead column.
- [ ] **Step 6: Run** `npx vitest run --config vitest.e2e.config.ts tests/e2e/json.test.ts -t status`, then the full unit and e2e suites. Expected: PASS.
- [ ] **Step 7: Commit** with `git commit -m "feat(gittyup): null ahead/behind without a tracking ref; status --json"`.

---

### Task 8: `compare --json`

**Files:**
- Modify: `src/ui/compare.ts` (`getSideInfo`, `renderCompare`)
- Modify: `src/commands/compare.ts`, `src/output/contract.ts`
- Test: `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: `gatherCompareData(manifest, repoManager, target, left, right, { fetch, checkConflicts }): Promise<CompareRow[]>`, `CliCache` (`get`/`set`/`buildKey`), `GitHubClient`.
- Produces:
  - `CompareDocument` (`contract.ts`, shape exactly as spec §4 "compare").
  - `BranchSideInfo.lastCommitDate` becomes the full ISO string and `author` the full author name. `renderCompare` does the display formatting it used to receive pre-formatted (`.slice(0, 10)`, `.substring(0, 7).toUpperCase()`), so text output is unchanged.
  - `async function lookupPrs(rows: CompareRow[], left: string, right: string): Promise<{ prs: Map<string, PRInfo>; error?: string }>`, extracted from today's inline block in `compare.ts`. Its "Could not fetch PR data" becomes the `error` value. The text path prints it exactly as today.

- [ ] **Step 1: Write the failing e2e tests.** Use two fixture repos, `clean` and `clash`. In `clash`, `develop` and `main` edit the same line of `f.txt`. Aliases are `{ dev: 'develop', prod: 'main' }`.
  1. `compare dev prod --no-pr --json` gives exit 0. Assert `doc.left === 'dev'`, `doc.cache` `toStrictEqual({ hit: false, ageMs: null })`, `doc.prLookup` `toStrictEqual({ ran: false })`, and `doc.summary` `toStrictEqual({ repos: 2, withConflicts: 1, clean: 1 })`. The `clash` row `toMatchObject({ leftRef: 'develop', rightRef: 'main', hasConflicts: true, url: null, pr: null, left: { lastCommitDate: expect.stringMatching(/T/), author: 'gittyup-fixture', commitCount: expect.any(Number) } })`.
  2. Run the same command again. `parseJsonLine` still succeeds (stdout is one line even though the cache notice printed), `doc.cache.hit === true`, and `doc.cache.ageMs` is a number ≥ 0.
  3. `--no-conflicts --no-pr --json -f` gives `hasConflicts: null` on every row.
  4. With PR lookup on and no token, `compare dev prod --json -f` gives `prLookup` `toMatchObject({ ran: true, error: expect.stringMatching(/No GitHub token/) })`, exit 0.
  5. Text `compare dev prod --no-pr -f` still shows the uppercase short author `GITTYUP` and a `YYYY-MM-DD` date.
- [ ] **Step 2: Run** with `-t compare`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Under `--json`, the cache-hit branch builds the document with `cache: { hit: true, ageMs }` and skips `printCacheNotice`.
  - `hasConflicts` is `null` when `opts.conflicts === false`.
  - `leftRef`/`rightRef` are `repo.branches[x] ?? x`.
  - `url` is `repo.url ?? null`.
  - `prLookup` is `{ ran: false }` with `--no-pr`, otherwise `{ ran: true, error? }`.
  - Values must carry no OSC 8 hyperlinks: build the document from rows, not from rendered strings.
- [ ] **Step 4: Run** the Step 2 command, then the full suites. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): compare --json; side info keeps raw date and author"`.

---

### Task 9: `prs`, `fetch`, `find` under `--json`

**Files:**
- Modify: `src/commands/prs.ts`, `src/commands/fetch.ts`, `src/commands/find.ts`, `src/output/contract.ts`
- Test: `tests/e2e/json.test.ts`

**Interfaces:**
- Consumes: `GitHubClient.create()` (throws `AUTH_REQUIRED` via `requireGitHubToken`, Task 4), `gh.getRepoOwner(url)`, `gh.listOpenPRs(owner, repo)` (returns `{ number, title, url, head, base, author }[]`), `RepoManager.fetchAll`, `new RepoFinder(dir, { maxDepth, includeMetadata }).find()` → `DiscoveredRepo[]`.
- Produces (`contract.ts`):
  - `PrsDocument { repos: Array<{ name: string; prs: Array<{ number: number; title: string; head: string; base: string; url: string }>; error?: string }> }`. All PRs are included, not the text view's first 10.
  - `FetchDocument { repos: Array<{ repo: string; ok: boolean; error?: string }> }`.
  - `FindDocument { root: string; repos: Array<{ name: string; absolutePath: string; relativePath: string; remoteUrl: string | null; currentBranch: string | null; isDirty: boolean | null }> }`.

- [ ] **Step 1: Write the failing e2e tests**
  1. **`prs`:**
     - No GitHub-URL repos → `{ repos: [] }`, exit 0.
     - One repo with `url: 'https://github.com/o/r.git'` and no token → exit 2, `AUTH_REQUIRED`, empty stdout.
  2. **`fetch`:**
     - The `fetch-exit-code.test.ts` setup with `--json` → exit 1, a single stdout line, `{ repos: [{ repo: 'repoA', ok: false, error: expect.any(String) }] }`.
     - A `makeRepo({ remote: true, … })` repo → exit 0, `{ repos: [{ repo, ok: true }] }`.
  3. **`find`:**
     - Create `ws.dir/projects/a` and `ws.dir/projects/b`, each with `git init -q -b main` and one commit, using `fixtureEnv()` as `fetch-exit-code.test.ts` does. (`makeRepo` can't place repos under a chosen directory.)
     - `find projects --json` → exit 0, `root` is `` `${ws.dir}/projects` ``, and `repos` sorted by `relativePath` `toMatchObject` `[{ name: 'a', relativePath: 'a', currentBranch: 'main', isDirty: false }, { name: 'b', … }]`. The run returns without a prompt (stdin closed, so a prompt would fail or hit the 20 s timeout).
     - `find /no/such/dir --json` → exit 2, `PATH_NOT_FOUND`.
- [ ] **Step 2: Run** with `-t "prs|fetch|find"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`prs`:** per-repo errors go in the row's `error` field.
  - **`fetch`:** emit, then set `process.exitCode = 1` if any row failed.
  - **`find`:**
    - With `--json`, emit right after `finder.find()` and return before the interactive selection loop.
    - Sort the repos by `relativePath`.
    - Missing metadata (`--no-metadata`) becomes `null`.
    - A missing directory throws `PATH_NOT_FOUND` under `--json` only. Text mode keeps its `console.error` + `exit(1)`.
- [ ] **Step 4: Run** the Step 2 command, then the full suites. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(gittyup): prs, fetch and find --json"`.

---

### Task 10: Docs, changeset, full verification

**Files:**
- Modify: `README.md` (new section "Scripting with `--json`", after "Commands")
- Create: `../../.changeset/gittyup-json-contract.md`

- [ ] **Step 1: README section.** Cover:
  - the contract table (the streams and exit-code table from spec §3.1);
  - the error codes;
  - one example per command family (`status`, `compare`, `repo list`, `config`), plus a line saying `merge`/`pick` `--json` arrive in a later release;
  - the 0.x stability note (spec §3.6).
- [ ] **Step 2: Changeset** (`"@helmsmith/gittyup": minor`). One paragraph saying every non-merge/pick command takes `--json`, with the contract in one sentence. Then a `### JSON contract` heading that lists the text-mode change: ahead/behind shows `–` without a tracking ref. Check it with `npx changeset status` from the repo root; don't run biome on it.
- [ ] **Step 3: Full verification.** In `apps/gittyup`, run `npx tsc --noEmit && npx vitest run && npx vitest run --config vitest.e2e.config.ts`, then from the repo root `npx biome check apps/gittyup/src apps/gittyup/tests`. Expected: everything exits 0. Report the test counts.
- [ ] **Step 4: Manual smoke.** In the scratch workspace (two fixture repos), run each `--json` command and pipe it to `node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))'`. Every run parses, and `| wc -l` prints `1`.
- [ ] **Step 5: Commit** with `git commit -m "docs(gittyup): Scripting with --json; changeset"`.

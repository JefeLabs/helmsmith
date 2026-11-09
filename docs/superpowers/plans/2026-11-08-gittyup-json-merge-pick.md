# gittyup `merge`/`pick --json` (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `merge --json` and `pick --json` run to completion with no human. On a conflict, gittyup's own agent tries first; if it can't resolve every file, the repo is rolled back to exactly where it started. Either way the run prints one JSON report (spec §5).

**Architecture:**
- **New `GitOperations` primitives** (`revParse`, `isAncestor`, `resetHard`, `pickOne`, `finishResolvedCommit`, and `switchToBranch` made public). Hardening §3.3 can reuse them later.
- **A headless resolver** (`src/core/headless-resolver.ts`). It walks the conflicted files with an injected agent and never prompts. It sits beside `ConflictResolver`, not inside its menu loop.
- **A JSON run module** (`src/core/json-operations.ts`). It holds the per-repo merge and pick flows, and the rollback and report rows.
- **`merge.ts`/`pick.ts`** check the spec §5.1 preconditions and emit the document.
- **The text-mode flow is untouched:** `Orchestrator.executeMerge`/`executeCherryPick` and `ConflictResolver`.

**Tech Stack:** TypeScript (ESM, tsup, Bun via `bin/gittyup.mjs`), commander 15, simple-git 4, vitest 5.0.3 (unit `src/**/*.test.ts`; e2e `tests/e2e/**` spawns the built CLI).

**Spec:** `docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md` (approved 2026-11-07), §5. It builds on PR 1 (`gittyup/json-contract`, PR #147, HEAD `a48abc1`): `GittyupError`, `emitJson`, `contract.ts`, JSON-mode wiring in `cli.ts`. Today PR 1 refuses `merge`/`pick --json` as `USAGE`, because neither command has a `--json` option yet.

## Global Constraints

- **Contract (spec §3.1):**
  - stdout is exactly one line, `JSON.stringify(doc) + '\n'`.
  - A refusal leaves stdout empty, puts `{code,message,details?}` on the last stderr line, and exits 2.
  - A run that produced a report exits **1 if any row's `status` is not `'success'`**, and 0 otherwise.
- **Never prompt (spec §3.3).** The JSON path must not reach `@inquirer/*`, `confirmGate`, `ConflictResolver`, `Orchestrator.executeMerge`/`executeCherryPick`, `Dashboard`, or start an `ora` spinner.
- **Never leave a repo mid-operation** (spec §2 anti-goal):
  - Any exception after `git merge`/`cherry-pick` has started is rolled back (`merge --abort`; `cherry-pick --abort` + `reset --hard <preSha>`) **before** the row is written.
  - Rows always run inside `withRepoGuard`, which restores the start branch and the stash.
- **`reset --hard`** only ever targets the `preSha` this run recorded on this branch, and only after `isAncestor(preSha, 'HEAD')` returns true. Otherwise the row is `error` and no reset happens (spec §5.2).
- **Trailer, exact:** `Resolved-by: ${APP_NAME} agent (${model})`. `APP_NAME` is `'gittyup'` (`src/config/branding.ts`). The model is `settings.ai_model ?? 'gpt-4o'`.
- **simple-git strips inherited `GIT_*` env**, so never rely on `GIT_EDITOR`. A resolved merge or pick commit is finished with `git commit --no-edit --cleanup=strip --trailer <trailer>`. This was verified on git 2.56: it keeps the original author and message, drops the `# Conflicts:` comment, and clears `MERGE_HEAD`/`CHERRY_PICK_HEAD`.
- **Honest values:**
  - SHAs in the report are full 40-char hashes, except `commits.requested`, which echoes what the caller passed.
  - Unknown is `null`.
  - `commits.applied` lists only commits this run left on the target. It is `[]` after a rollback.
- **Agent:**
  - Reuse `callCopilot` + `buildAiMessages(file, 'auto')` + `stripOuterFence` + `applyResolution` (which runs `checkResolution`).
  - Never route through `src/auth/call-ai.ts` or `readAuthFile()` (spec §5.3).
  - Availability is decided once per run, from `resolveGitHubToken()`, never the `gh`/git-credential cascade.
- **Text mode unchanged:** same output, same exit codes.
- **Process:**
  - `HELMSMITH_HOME`/`~/.helmsmith` only. No `AGENTX_*`.
  - vitest: never a bare `RegExp` inside `toMatchObject`/`toEqual`; use `expect.stringMatching`.
  - Biome only on `src`/`tests`, never `.md`.
  - Never run `changeset version`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A source or target branch that doesn't exist in one repo of a group:** that repo's row is `error`, its branches are untouched, and the other repos still run. Task 4 tests this.
2. **`--commits` holding a merge commit, or a SHA one repo lacks:** `error` row, and commits this run already applied are undone. A missing SHA is caught before anything is touched; a merge commit fails at its turn and earlier picks are reset. Task 5 tests both.
3. **Nothing to do** (the source is already merged, or a commit is already on the target): `success` with `head` unchanged, or the commit listed in `dropped`. Never counted as applied. Tasks 4 and 5 test this.
4. **`--push` rejected** (no remote, non-fast-forward): row `error`, `pushed: false`, `head` is the local commit, exit 1. Task 4 tests this.
5. **A binary-file conflict:** never sent to the agent. Its outcome is `agent_refused` with reason `binary file`, and the repo is rolled back. Task 3 tests this.

---

### Task 0: Branch and carry the plan

**Files:** none in code.

- [ ] **Step 1: Create a worktree stacked on PR 1.** PR #147 is not merged yet. The PR for this branch targets `gittyup/json-contract` until #147 merges, then it is rebased onto `main` and retargeted.

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
git fetch origin
git worktree add .worktrees/gittyup-json-pr2 -b gittyup/json-merge-pick origin/gittyup/json-contract
cd .worktrees/gittyup-json-pr2
PATH="$(npx -y -p node-gyp@11 -c 'dirname "$(command -v node-gyp)"' | tail -1):$PATH" pnpm install --frozen-lockfile
```

- [ ] **Step 2: Baseline.** Run `cd apps/gittyup && npx tsc --noEmit && npx vitest run && npx vitest run --config vitest.e2e.config.ts`. Expected: green, unit 124 / e2e 51. `cli.smoke` "kills the whole process group" counts gittyup processes machine-wide and can flake when another session runs gittyup; re-run once before treating it as red.

- [ ] **Step 3: Copy this plan in and commit it.**

```bash
cp ../../docs/superpowers/plans/2026-11-08-gittyup-json-merge-pick.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-11-08-gittyup-json-merge-pick.md
git commit -m "docs(gittyup): merge/pick --json plan (PR 2)"
```

All later paths are relative to `apps/gittyup/` unless they start with `docs/`.

---

### Task 1: Git primitives and the conflict fixture

**Files:**
- Modify: `src/core/git-operations.ts` (make `switchToBranch` public; add five methods)
- Create: `src/test/conflict-fixture.ts`
- Test: `src/core/git-operations-headless.test.ts`

**Interfaces:**
- Produces, on `GitOperations`:
  - `switchToBranch(target: string): Promise<void>`: now public, body unchanged.
  - `revParse(ref: string): Promise<string>`: full 40-char SHA of `<ref>^{commit}`; throws if it doesn't resolve. `assertSafeRef(ref)` first.
  - `isAncestor(ancestor: string, descendant: string): Promise<boolean>`: `git merge-base <a> <d>` equals `revParse(a)`. Do **not** use `merge-base --is-ancestor`: it signals with exit 1 and empty stderr, which simple-git resolves instead of rejecting (see `refExists`).
  - `resetHard(sha: string): Promise<void>`: `git reset --hard <sha>`.
  - `pickOne(sha: string): Promise<'applied' | 'dropped' | 'conflict'>`:
    - Runs `cherry-pick --empty=drop --end-of-options <sha>`, then reads `git status`.
    - Any `conflicted` path → `'conflict'`, whether the call resolved or rejected.
    - Otherwise, if the call rejected → throw `cherry-pick failed on <sha>: <first line>`.
    - Otherwise → `'applied'` if `revParse('HEAD')` moved, `'dropped'` if not.
  - `finishResolvedCommit(trailer: string): Promise<string>`: `git commit --no-edit --cleanup=strip --trailer <trailer>`, returns `revParse('HEAD')`. Valid while `MERGE_HEAD` or `CHERRY_PICK_HEAD` is set.
- Produces, in `src/test/conflict-fixture.ts`: `makeConflictRepo(): Promise<ConflictRepo>`, where `ConflictRepo = FixtureRepo & { c: { addA: string; changeF: string; addB: string; changeF2: string; addG: string } }` (full SHAs). History:
  - `main`: `base` (`f.txt` = `a\nb\nc\n`), then `mainF` (`f.txt` = `a\nMAIN\nc\n`).
  - `feature`, cut from `base`: `addA` (`a.txt`), `changeF` (`f.txt` = `a\nFEATURE\nc\n`), `addB` (`b.txt`), `changeF2` (`f.txt` = `a\nFEATURE2\nc\n`).
  - `side`, cut from `base`: `addG` (`g.txt`).
  - Left checked out on `main`.
  - So merging `feature` → `main` conflicts on `f.txt`, and merging `side` → `main` is clean. Picking `changeF` conflicts. After `changeF` is resolved to anything but `FEATURE`, picking `changeF2` conflicts again.

- [ ] **Step 1: Write the failing tests** in `src/core/git-operations-headless.test.ts`. Use `makeConflictRepo()`, `new GitOperations(repo.path)` and `cleanupFixtures` in `afterAll`.
  - `revParse` returns `await repo.sha('main')` (matches `/^[0-9a-f]{40}$/`) and rejects for `'nope'`.
  - `isAncestor(c.addA, c.changeF)` is `true`; `isAncestor(c.changeF, c.addA)` is `false`; `isAncestor(c.addG, c.addA)` is `false`.
  - `resetHard`: after `switchToBranch('main')` and `resetHard(<base sha>)`, `revParse('HEAD')` equals base and `f.txt` reads `a\nb\nc\n`.
  - `pickOne`:
    - `addA` onto `main` → `'applied'`, and `a.txt` exists.
    - Picking `addA` again → `'dropped'` and HEAD unchanged.
    - `changeF` → `'conflict'`, and `repo.git.raw(['rev-parse','--verify','CHERRY_PICK_HEAD'])` resolves.
    - A missing SHA (`'0'.repeat(40)`) rejects with `expect.stringMatching(/cherry-pick failed/)` as the message.
  - `finishResolvedCommit` after a pick conflict. First run `repo.git.addConfig('user.name','resolver')`, then pick `changeF`, write `a\nRESOLVED\nc\n` to `f.txt`, and `git add` it.
    - `git log -1 --format=%an|%cn|%B` gives author `gittyup-fixture` and committer `resolver`.
    - The body is `"<changeF subject>\n\nResolved-by: gittyup agent (m)"`, with no `# Conflicts` line.
    - `CHERRY_PICK_HEAD` is gone.
  - `finishResolvedCommit` after `merge('feature','main')` conflicts and `f.txt` is resolved: `git log -1 --format=%P` has two parents, and the body starts with `Merge branch 'feature'` and ends with the trailer.

- [ ] **Step 2: Run them to verify they fail.** Run `npx vitest run src/core/git-operations-headless.test.ts`. Expected: FAIL, because the methods don't exist (`switchToBranch` is private and the rest are missing).

- [ ] **Step 3: Implement** the five methods and the visibility change in `src/core/git-operations.ts` per the Interfaces block, and the fixture in `src/test/conflict-fixture.ts`. Build it on `makeRepo` with `CommitSpec.branch`/`from`; the `c` SHAs come from `repo.sha(<branch>~n)`.

- [ ] **Step 4: Run to verify they pass.** Run `npx vitest run src/core/git-operations-headless.test.ts src/core/git-operations.test.ts`. Expected: PASS. The existing tests must stay green, since `switchToBranch` callers are unchanged.

- [ ] **Step 5: Commit.**

```bash
git add src/core/git-operations.ts src/test/conflict-fixture.ts src/core/git-operations-headless.test.ts
git commit -m "feat(gittyup): git primitives for headless merge/pick (revParse, pickOne, finishResolvedCommit, …)"
```

---

### Task 2: The Copilot agent, as a call that throws

**Files:**
- Create: `src/core/copilot-agent.ts`
- Test: `src/core/copilot-agent.test.ts`

**Interfaces:**
- Consumes: `resolveGitHubToken`, `getCopilotToken`, `callCopilot` (`src/auth/token-manager.ts`); `buildAiMessages` (`src/core/ai-text.ts`).
- Produces:
  - `type AgentReply = (file: ConflictFile) => Promise<string>`. It resolves with the model's raw text (`''` when the reply has no content) and **throws** on any network or model error. This is unlike `Orchestrator.createAiResolver`, which returns `null` for both "no token" and "error", so the two outcomes can't be told apart.
  - `checkAgentAvailable(): Promise<{ available: true } | { available: false; reason: string }>`:
    - No token → reason `no GitHub token for the agent (set GITHUB_TOKEN or run "${CLI_BIN_NAME} auth login")`.
    - `getCopilotToken(token, { fromEnv: source !== 'auth.json' })` throws → reason `Copilot token exchange failed: <message>`.
  - `createCopilotAgent(model: string): AgentReply`: `callCopilot(buildAiMessages(file, 'auto'), model)` → `choices[0].message.content ?? ''`.

- [ ] **Step 1: Write the failing tests.** Copy the isolation `beforeEach`/`afterEach` and the `vi.stubGlobal('fetch', …)` pattern from `src/auth/token-manager.test.ts`.
  - No token → `{ available: false, reason: expect.stringContaining('auth login') }`, and `fetch` is never called.
  - `GITHUB_TOKEN=t` and the token URL answers 200 → `{ available: true }`.
  - The token URL answers 401 → `available: false`, reason `expect.stringContaining('401')`.
  - `createCopilotAgent('m')(file)` resolves to the chat reply's content. The request body's `model` is `'m'`.
  - The chat URL answers 500 → the agent rejects. Assert `rejects.toThrow(/Copilot API error \(500\)/)`; `toThrow` with a RegExp is fine, only `toMatchObject` isn't.

- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run src/core/copilot-agent.test.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `src/core/copilot-agent.ts` per Interfaces.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/copilot-agent.ts src/core/copilot-agent.test.ts
git commit -m "feat(gittyup): Copilot agent call and once-per-run availability check for headless runs"
```

---

### Task 3: Headless resolver

**Files:**
- Create: `src/core/headless-resolver.ts`
- Modify: `src/output/contract.ts` (add the conflict row types)
- Test: `src/core/headless-resolver.test.ts`

**Interfaces:**
- Consumes: `AgentReply` (Task 2); `GitOperations.getConflictedFiles`, `applyResolution`, `getStatus`; `stripOuterFence`; `ResolutionRejected`.
- Produces, in `contract.ts`:
  - `type ConflictOutcome = 'resolved' | 'agent_unavailable' | 'agent_refused' | 'agent_error' | 'not_attempted'`
  - `interface ConflictRow { path: string; commit?: string; outcome: ConflictOutcome; reason?: string }`
- Produces, in `headless-resolver.ts`:
  - `interface HeadlessAgent { mode: 'auto' | 'manual'; reply: AgentReply | null; unavailableReason?: string }`
  - `resolveConflictsHeadless(git: GitOperations, agent: HeadlessAgent, commit?: string): Promise<{ resolved: boolean; conflicts: ConflictRow[] }>`. Rules, applied in this order, with `commit` copied onto every row when given:
    1. `mode === 'manual'` → every file `not_attempted`, reason `ai mode is manual`.
    2. `reply === null` → every file `agent_unavailable`, reason `unavailableReason`. Availability is run-wide, so every file gets it, not just the first.
    3. Files in `getConflictedFiles()` order. The first failure stops the walk, and every later file is `not_attempted` with reason `an earlier file in this repo was not resolved` (spec §5.4). The failures are:
       - A side (`ours`/`theirs`/`base`) contains `\0` → `agent_refused`, `binary file`, without calling the agent.
       - The agent throws → `agent_error`, with the error message.
       - `stripOuterFence(reply).trim() === ''` → `agent_refused`, `empty reply`.
       - `applyResolution` throws `ResolutionRejected` → `agent_refused`, with `err.reason`.
       - Any other throw → `agent_error`.
       - Success → `resolved`.
    4. `resolved` is true only when every row is `resolved` **and** `getStatus().conflicted` is empty afterwards.

- [ ] **Step 1: Write the failing tests.** Each test creates `makeConflictRepo()` and runs `await git.merge('feature', 'main')`, which conflicts on `f.txt`.
  - Agent returns `'a\nRESOLVED\nc\n'` → `{ resolved: true, conflicts: [{ path: 'f.txt', outcome: 'resolved' }] }`, `f.txt` holds that text, and `getStatus().conflicted` is `[]`.
  - Agent returns the same text fenced in ` ``` ` → resolved, and the file has no fence.
  - Agent returns `'<<<<<<< x\n'` → `agent_refused` with reason `'still contains conflict markers'`, and `f.txt` is still conflicted.
  - Agent throws `new Error('rate limited')` → `agent_error`, reason `'rate limited'`.
  - `reply: null, unavailableReason: 'no token'` → `[{ path: 'f.txt', outcome: 'agent_unavailable', reason: 'no token' }]`.
  - `mode: 'manual'` → `not_attempted`.
  - Passing `commit: 'abc'` puts `commit: 'abc'` on every row.
  - **Two conflicted files:** build an inline `makeRepo` whose `main` and `feature` both change `f.txt` and `h.txt`. The agent refuses the first file. Expect the second file `not_attempted` and the agent called exactly once.
  - **Binary (Review Focus 5):** an inline repo where both sides change `bin.dat` to different bytes containing `\0`. Expect `agent_refused` with reason `'binary file'`, and the agent spy is never called.

- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run src/core/headless-resolver.test.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `headless-resolver.ts` and the two contract types per Interfaces.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/headless-resolver.ts src/core/headless-resolver.test.ts src/output/contract.ts
git commit -m "feat(gittyup): headless conflict resolver (agent first, stop at first failure, no prompts)"
```

---

### Task 4: Report types and the JSON merge flow

**Files:**
- Create: `src/core/json-operations.ts`
- Modify: `src/output/contract.ts`
- Test: `src/core/json-operations.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `MergeTarget`, `RepoConfig`, `AiMode` (`src/config/schema.ts`); `APP_NAME`.
- Produces, in `contract.ts`, exactly spec §5.4 with one deviation (see the ruling at the end of this block):
  - `interface PrRow { status: 'created' | 'existing' | 'skipped' | 'error'; url?: string; number?: number; reason?: string }`
  - `interface MergePickRow { repo; sourceRef; targetRef; status: 'success' | 'conflict' | 'error' | 'skipped'; message: string; commits?: { requested: string[]; applied: string[]; dropped: string[] }; stoppedAt?: string; resolvedBy: 'agent' | null; conflicts: ConflictRow[]; rolledBack: boolean; head: string | null; pushed: boolean; pr: PrRow | null; error?: string }`
  - `interface MergePickDocument { operation: 'merge' | 'pick'; source: string; target: string; agent: { mode: 'auto' | 'manual'; modeSource: 'flag' | 'manifest'; model: string; available: boolean | null }; repos: MergePickRow[]; summary: { repos: number; success: number; conflict: number; error: number; skipped: number } }`
  - **Ruling:** `agent.available` is `boolean | null` (the spec says `boolean`). It is `null` under `manual`, because nothing was checked. This is the spec §3.4 "unknown is null" rule.
- Produces, in `json-operations.ts`:
  - `resolveAgentMode(flag: AiMode | undefined, manifestMode: AiMode): { mode: 'auto' | 'manual'; modeSource: 'flag' | 'manifest' }`. `suggest` from the manifest → `auto` (spec §5.1). The CLI refuses a `suggest` flag before this is called.
  - `interface AgentSetup extends HeadlessAgent { modeSource: 'flag' | 'manifest'; model: string; available: boolean | null }`
  - `setupAgent(mode, modeSource, model, deps = { check: checkAgentAvailable, make: createCopilotAgent }): Promise<AgentSetup>`:
    - `manual` → `available: null, reply: null`, and `check` is never called.
    - `auto` → `check()` once; `reply = make(model)` if available, else `unavailableReason = reason`.
  - `interface RunDeps { getGit: (repo: RepoConfig) => GitOperations; agent: AgentSetup }`
  - `interface RunOptions { fetch: boolean; push: boolean; pr: boolean }`
  - `resolvedByTrailer(model: string): string` → `` `Resolved-by: ${APP_NAME} agent (${model})` ``
  - `runMergeJson(targets: MergeTarget[], deps: RunDeps, opts: RunOptions): Promise<MergePickRow[]>`
  - `toMergePickDocument(operation, source, target, agent: AgentSetup, rows): MergePickDocument`. `summary` counts rows by `status`.
  - Module-internal, shared with Task 5: `prRow(row: MergePickRow, operation: 'merge' | 'pick'): PrRow`, plus the fetch and push steps below.
  - Each row's `repo` is `target.repo.name`, `sourceRef` is `target.sourceBranch`, and `targetRef` is `target.targetBranch`.
- The per-repo merge, run sequentially over `targets`, one row each. The algorithm is pinned because rollback ordering matters:

```text
row = { status:'error', resolvedBy:null, conflicts:[], rolledBack:false, head:null, pushed:false, pr:null, … }
if opts.fetch: try git.fetch(repo.remote)
               catch e → skipped; error "fetch failed: <e>"; head = revParse(targetRef) or null; → pr; next repo
try withRepoGuard(label, async () =>
  before = revParse(targetRef)                       # throws for a missing target → error row
  m = merge(sourceRef, targetRef)                    # throws for a missing source → error row
  if m.success: success; message says "already contains" when revParse(targetRef) == before
  else:
    try r = resolveConflictsHeadless(git, agent); row.conflicts = r.conflicts
        if r.resolved: finishResolvedCommit(resolvedByTrailer(model)); success; resolvedBy 'agent'
        else: abortMerge(); rolledBack = true; conflict
    catch e: abortMerge() (ignore its error); rolledBack = true; rethrow e
  row.head = revParse(targetRef))
catch e: error; error = message; head = revParse(targetRef) or null
if success and opts.push: try push(remote, targetRef); pushed = true
                          catch e → error; error "push failed: <e>"  (head keeps the local sha)
row.pr = opts.pr ? prRow(row) : null
```

  `prRow`: a non-`success` row → `{ status: 'skipped', reason: 'repo was not <merged|picked> (<status>)' }`. Otherwise `{ status: 'skipped', reason: 'head equals base; needs --branch (hardening §3.5)' }`. JSON mode never makes a conflict branch, so head is always the target branch (spec §5.4). **No GitHub call in PR 2.**

- [ ] **Step 1: Write the failing tests** in `src/core/json-operations.test.ts`. Helpers:
  - A literal `AgentSetup` with `mode: 'auto', modeSource: 'manifest', model: 'test-model', available: true` and a `vi.fn` reply.
  - `getGit: (r) => new GitOperations(r.path)`.
  - `RepoConfig` built from the fixture path, with `branches: {}` and `remote: 'origin'`.

  Cases:
  - `resolveAgentMode(undefined, 'suggest')` → `{ mode: 'auto', modeSource: 'manifest' }`.
  - `resolveAgentMode('manual', 'auto')` → `{ mode: 'manual', modeSource: 'flag' }`.
  - `setupAgent('manual', …)` never calls `check` and returns `available: null`.
  - `setupAgent('auto', …)` with a failing `check` returns `reply: null` and the reason.
  - **Clean merge** (`side` → `main`, `fetch: false`):
    - `status: 'success'`, `resolvedBy: null`, `conflicts: []`.
    - `head` ≠ the pre-run `main` sha and equals `repo.sha('main')`.
    - `repo.currentBranch()` is unchanged.
  - **Conflict, agent resolves** (`feature` → `main`):
    - `success`, `resolvedBy: 'agent'`, `conflicts: [{ path: 'f.txt', outcome: 'resolved' }]`.
    - The `main` tip has two parents, and its body ends with `Resolved-by: gittyup agent (test-model)`.
  - **Conflict, agent refuses:**
    - `conflict`, `rolledBack: true`, `head` equals the pre-run `main` sha.
    - `MERGE_HEAD` doesn't resolve.
  - **Conflict, agent throws:** `conflict`, `rolledBack: true`, outcome `agent_error`.
  - **Start branch and stash restored:** the repo is checked out on `side` with an uncommitted edit to `g.txt`, and the run conflicts and rolls back. Afterwards `currentBranch()` is `'side'` and `g.txt` holds the edit.
  - **Missing source in one repo (Review Focus 1):** two targets; the first names source `nope`.
    - Row 1 is `error` with `head` equal to its pre-run sha.
    - Row 2 (`side` → `main`, in a second fixture) is `success`.
  - **Already merged (Review Focus 3):** merge `side` twice. The second row is `success`, `head` is unchanged, and `message` is `expect.stringMatching(/already/)`.
  - **Push rejected (Review Focus 4):** the fixture has no remote; `push: true`.
    - `status: 'error'`, `pushed: false`, `error` is `expect.stringMatching(/^push failed/)`.
    - `head` equals the new local merge sha.
  - **Fetch fails:** `fetch: true` and no remote → `status: 'skipped'`, `error` is `expect.stringMatching(/^fetch failed/)`, and `head` equals the pre-run `main` sha (the target was read, not touched).
  - **`pr: true` on a success** → `pr: { status: 'skipped', reason: expect.stringContaining('needs --branch') }`.
  - **`toMergePickDocument` summary** for rows `[success, conflict, error, skipped]` → `{ repos: 4, success: 1, conflict: 1, error: 1, skipped: 1 }`.

- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run src/core/json-operations.test.ts`. Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** the contract types and `json-operations.ts` (the merge half) per Interfaces and the algorithm above.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/json-operations.ts src/core/json-operations.test.ts src/output/contract.ts
git commit -m "feat(gittyup): headless merge flow with rollback and the merge/pick report types"
```

---

### Task 5: The JSON pick flow

**Files:**
- Modify: `src/core/json-operations.ts`
- Test: `src/core/json-operations.test.ts` (new `describe('runPickJson')`)

**Interfaces:**
- Consumes: Task 4's `RunDeps`, `RunOptions`, `MergePickRow`, `resolvedByTrailer`, `prRow`; Task 1's primitives; `CherryPickTarget`.
- Produces: `runPickJson(targets: CherryPickTarget[], deps: RunDeps, opts: RunOptions): Promise<MergePickRow[]>`. Each row carries `commits: { requested, applied, dropped }`. The per-repo pick algorithm (spec §5.2), with fetch, push and PR handled as in Task 4:

```text
full = for each requested sha: revParse(sha) — the first that fails →
       error row "commit <sha> not found in <repo>"; nothing touched; next repo
try withRepoGuard(label, async () =>
  switchToBranch(targetRef); preSha = revParse('HEAD')
  undo = async () => cherryPickAbort() (ignore its error)
                     if !isAncestor(preSha, 'HEAD') throw "HEAD no longer descends from <preSha>; not resetting"
                     resetHard(preSha); rolledBack = true; applied = []
  try for sha of full:
        r = pickOne(sha)
        applied → applied.push(sha); dropped → dropped.push(sha)
        conflict → res = resolveConflictsHeadless(git, agent, sha); conflicts.push(...res.conflicts)
                   if res.resolved: finishResolvedCommit(trailer); applied.push(sha); resolvedBy = 'agent'
                   else: stoppedAt = sha; undo(); conflict; stop the loop
      success unless stopped
  catch e: undo() (if it throws, append its message to e's); rethrow
  row.head = revParse(targetRef))
catch e: error; error = message; head = revParse(targetRef) or null
```

**Ruling (carried from Global Constraints):** after a rollback, `applied` is `[]`. The field means "on the target now because of this run". `stoppedAt` tells the caller how far it got. `dropped` keeps what was observed.

- [ ] **Step 1: Write the failing tests.** Same helpers as Task 4; `requested` uses the fixture's full SHAs unless a case says otherwise.
  - **No conflicts** (`[addA, addB]`):
    - `success`, `commits.applied` equals `[addA, addB]`, `dropped: []`.
    - The two new `main` commits keep the original subjects.
  - **Conflict at commit 2 of 3, agent resolves** (`[addA, changeF, addB]`; first run `addConfig('user.name','resolver')`):
    - `success`, `applied` is all three, `resolvedBy: 'agent'`.
    - `conflicts: [{ path: 'f.txt', commit: changeF, outcome: 'resolved' }]`.
    - `git log -3 --format=%an|%s` shows every author as `gittyup-fixture`, with the original subjects.
    - Only the `changeF` copy's body contains `Resolved-by: gittyup agent (test-model)`.
  - **Conflict at commit 2, agent refuses:**
    - `conflict`, `rolledBack: true`, `stoppedAt: changeF`, `applied: []`.
    - `head` equals the pre-run `main` sha, and `a.txt` is absent on `main`.
    - `CHERRY_PICK_HEAD` doesn't resolve.
  - **Second conflict fails** (`[addA, changeF, addB, changeF2]`, agent resolves its first call and refuses its second):
    - `conflict`, `stoppedAt: changeF2`, `head` equals pre-run `main`.
    - `a.txt` and `b.txt` are absent.
  - **Already present (Review Focus 3):** `[addA, addA]` → `success`, `applied: [addA]`, `dropped: [addA]`.
  - **Short SHA in, full SHA out:** `requested: [addA.slice(0, 8)]` → `commits.requested` is `[addA.slice(0, 8)]` and `commits.applied` is `[addA]`.
  - **Missing SHA (Review Focus 2):** `['0'.repeat(40)]` → `error`, `error` is `expect.stringContaining('not found')`, `rolledBack: false`, `head` unchanged.
  - **Merge commit in the list (Review Focus 2):** in the test, create `mergeSha` with `repo.git.raw(['checkout','-b','m', c.addG])`, then `['merge','--no-ff','-m','m', c.addA]`. Run `[addA, mergeSha]`:
    - `error`, `rolledBack: true`, `applied: []`.
    - `head` equals pre-run `main`, and `a.txt` is absent.

- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run src/core/json-operations.test.ts -t runPickJson`. Expected: FAIL, because `runPickJson` isn't exported.

- [ ] **Step 3: Implement** `runPickJson` per the algorithm. Reuse Task 4's fetch, push and PR helpers rather than copying them.

- [ ] **Step 4: Run to verify they pass.** Run `npx vitest run src/core/json-operations.test.ts`. Expected: PASS, including Task 4's cases.

- [ ] **Step 5: Commit.**

```bash
git add src/core/json-operations.ts src/core/json-operations.test.ts
git commit -m "feat(gittyup): headless pick flow (agent-resolved picks keep message and author; reset to preSha on failure)"
```

---

### Task 6: `merge`/`pick --json` in the CLI

**Files:**
- Modify: `src/commands/merge.ts`, `src/commands/pick.ts`
- Test: `tests/e2e/json-merge-pick.test.ts` (new; reuse `createWorkspace`, `runCli`, `parseJsonLine`, `parseErrorLine` from `tests/e2e/helpers.ts` and `makeConflictRepo` from `src/test/conflict-fixture.ts`)

**Interfaces:**
- Consumes: Tasks 4–5; `GittyupError`; `emitJson`; `AiModeSchema`; `orchestrator.repos.getReposForTarget` (which already throws `TARGET_UNKNOWN`) and `.getGit`.
- Both commands get `.option('--json', 'Run without prompts; print the merge/pick report as one JSON line (needs --yes)')`. With `opts.json`, the action runs a JSON branch and returns, and the text path below it is unchanged. The precondition order is fixed so a caller with several mistakes always gets the same code:
  1. `--ai` given and not `auto|suggest|manual` → `USAGE` `{ ai }`.
  2. `pick` without `-s` or `-t` → `USAGE`.
  3. No `--group`/`--repo` → `TARGET_REQUIRED`.
  4. `--ai suggest`; `pick --interactive`; `pick` without `--commits` → `INTERACTIVE_ONLY`.
  5. No `--yes` → `CONFIRMATION_REQUIRED`.
  6. `getReposForTarget(scope)` → `TARGET_UNKNOWN`.

  Then:
  - `resolveAgentMode(opts.ai, settings.ai_mode)`.
  - `setupAgent(…, settings.ai_model ?? 'gpt-4o')`.
  - Run `runMergeJson`/`runPickJson` with `{ fetch: opts.fetch !== false, push: !!opts.push, pr: !!opts.pr }`.
  - `emitJson(toMergePickDocument(...))`. `source`/`target` are the aliases as given; for `pick` they are `-s`/`-t`.
  - Set `process.exitCode = 1` when any row's `status !== 'success'`.

- [ ] **Step 1: Write the failing e2e tests.** Each workspace manifest is `{ workspace: '.', groups: { web: { repos: [{ name: 'app', path: <fixture path>, remote: 'origin', branches: {}, tags: [] }] } } }`. Pass `--no-fetch` unless the case is about fetch.
  - **Refusals** (`it.each`). Each expects stdout `''`, exit 2, the given `parseErrorLine(stderr).code`, and `main` unchanged:
    - `merge feature main -r app --json` → `CONFIRMATION_REQUIRED`
    - `merge feature main --yes --json` → `TARGET_REQUIRED`
    - `merge feature main -r app --yes --ai suggest --json` → `INTERACTIVE_ONLY`
    - `merge feature main -r app --yes --ai bogus --json` → `USAGE`
    - `pick -r app -s feature -t main --yes --json` → `INTERACTIVE_ONLY`
    - `pick -r app -s feature -t main -i --yes --json` → `INTERACTIVE_ONLY`
    - `pick -r app -t main -c <addA> --yes --json` → `USAGE`
    - `merge feature main -g nope --yes --json` → `TARGET_UNKNOWN`
  - **Conflicting merge, no agent** (tokens are blank in `runCli`). The repo starts on `side` with an uncommitted edit to `g.txt`.
    - Exit 1, and `parseJsonLine` gives a document matching:
      - `operation: 'merge'`
      - `agent: { mode: 'auto', modeSource: 'manifest', model: 'gpt-4o', available: false }` (the manifest default `ai_mode` is `suggest`)
      - row `{ status: 'conflict', rolledBack: true, conflicts: [{ path: 'f.txt', outcome: 'agent_unavailable', reason: expect.stringContaining('auth login') }] }`
    - `head` equals the pre-run `main` sha.
    - `MERGE_HEAD` is absent, the current branch is `side`, and `g.txt` keeps the edit.
  - **Pick conflicting at commit 2 of 3, no agent** (`-c <addA> <changeF> <addB>`): exit 1, `status: 'conflict'`, `stoppedAt: changeF`, `commits.applied: []`, `head` equals pre-run `main`, and `CHERRY_PICK_HEAD` absent.
  - **Clean merge** (`merge side main`): exit 0, `status: 'success'`, `head` equals the new `main` sha, and `summary` equals `{ repos: 1, success: 1, conflict: 0, error: 0, skipped: 0 }`.
  - **Manifest `manual`** (`settings: { ai_mode: 'manual' }` in the manifest): `agent: { mode: 'manual', modeSource: 'manifest', available: null }` and outcome `not_attempted`.
  - **`--ai auto` overrides the manifest's `manual`:** `agent.mode: 'auto'`, `modeSource: 'flag'`.
  - **Pre-fetch failure** (no `--no-fetch`; the fixture has no remote): exit 1, `status: 'skipped'`, `error` is `expect.stringMatching(/^fetch failed/)`, and `main` unchanged.

- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run --config vitest.e2e.config.ts tests/e2e/json-merge-pick.test.ts`. Expected: FAIL. Every case gets `USAGE`, because `--json` is unknown on merge/pick.

- [ ] **Step 3: Implement** the JSON branch in `merge.ts` and `pick.ts` per Interfaces.

- [ ] **Step 4: Run to verify they pass.** Same command, then the whole e2e suite: `npx vitest run --config vitest.e2e.config.ts`. Expected: PASS, with PR 1's `json.test.ts` unchanged (it has no merge/pick cases).

- [ ] **Step 5: Commit.**

```bash
git add src/commands/merge.ts src/commands/pick.ts tests/e2e/json-merge-pick.test.ts
git commit -m "feat(gittyup): merge and pick --json (agent first, roll back, one report)"
```

---

### Task 7: Docs, changeset, full verification

**Files:**
- Modify: `README.md` (the "Scripting with `--json`" section)
- Create: `.changeset/gittyup-json-merge-pick.md` (repo root)

- [ ] **Step 1: README.** Replace "`merge` and `pick` get `--json` in a later release." with a short `merge`/`pick` subsection covering:
  - They need `--yes`; the six refusals are listed in Task 6.
  - Mode is `--ai` or else the manifest. A manifest `manual` is honoured, and `suggest` means the agent tries.
  - On a conflict the agent tries every file. One failure rolls the repo back to where it started.
  - Agent-written commits carry `Resolved-by: gittyup agent (<model>)`, findable with `git log --format='%(trailers:key=Resolved-by)'`.
  - Exit 1 when any repo is not `success`, with the report still on stdout.
  - `--pr` reports `skipped` until `--branch` lands.
  - One `jq` example: `gittyup merge feature dev -g web --yes --json | jq '.repos[] | {repo, status, rolledBack}'`.

- [ ] **Step 2: Changeset** (do not biome it):

```markdown
---
"@helmsmith/gittyup": minor
---

`merge` and `pick` take `--json` (with `--yes`). They never prompt: on a conflict gittyup's own agent tries to resolve every file, and if any file can't be resolved the repo is rolled back to exactly where it started. Each run prints one JSON report: per repo the status, which files the agent resolved, whether it rolled back, the target's final commit, and whether it pushed. Commits the agent resolved carry a `Resolved-by: gittyup agent (<model>)` trailer. A manifest set to `ai_mode: manual` keeps the agent out.

### JSON contract

- `--pr` under `--json` reports `skipped` ("needs --branch") for every repo until hardening §3.5 adds `--branch`; it will then report `created`/`existing`/`error`.
- `agent.available` is `null` when the mode is `manual` (nothing was checked).
```

- [ ] **Step 3: Full verification.** From `apps/gittyup`: `npx tsc --noEmit && npx vitest run && npx vitest run --config vitest.e2e.config.ts`, then from the repo root: `npx biome check apps/gittyup/src apps/gittyup/tests` and `npx changeset status`. Expected: all green and no changeset errors. **By hand**, on the built CLI with a throwaway `makeConflictRepo`-shaped repo: run `merge feature main -r app --yes --no-fetch --json` and check it prints one line, exits 1, and leaves `main`, the start branch and `git status` exactly as they were.

- [ ] **Step 4: Commit.**

```bash
git add README.md ../../.changeset/gittyup-json-merge-pick.md
git commit -m "docs(gittyup): merge/pick --json in Scripting with --json; changeset"
```

# workbrokr — intra-area parallel waves, mode promotion, and core concurrency (design)

**Status:** approved in conversation 2026-10-18 (updated with live Phase 1b `skoolscout-com` rollout findings), written for planning.
**Home:** `apps/workbrokr` (`@helmsmith/workbrokr`, including `apps/workbrokr/src/core`).
**Series:** Spec 1 of 3 for parallel-workflow upgrades across `workbrokr` and `storybrokr`:
- **Spec 1 (this document):** Intra-area wave parallelism (`--mode backend`, `--task <slug>`, `--scope <glob>`), in-place mode promotion (`work promote`), task convergence (`work finish --into-area`), reference-counted `--join`, squash-merge & foreign-branch recovery, cold-worktree seeding & hash-stamped refresh with clean lockfile restore, submodule pre-sync repair, notice lifecycle & attribution fixes, mode-aware `extraScopes` + `sharedScopes`, git hook chaining, worktree-bound `commons` & scope commit guards, single-fetch git status/audit, and `./core` package export.
- **Spec 2 (drafted, `2026-10-18-storybrokr-worktree-isolation-design.md`):** worktree-scoped `storybrokr` instances, root-first default story discovery, parallel `check`, and a lease-aligned lifecycle (TTL, touch, teardown) between `workbrokr` and `storybrokr` — the registries stay separate (decision 14).
- **Spec 3 (planned):** Bidirectional import graph, `--affected` story verification, targeted impact notices, Storybook globals (`theme`/`locale`), console/network/a11y failure capture, and base-vs-worktree visual diffing.

---

## 1. Problem

Phase 1 (`2026-10-17-workbrokr-design.md`) and its live Phase 1b rollout in `skoolscout-com` (`#5464`) established area-based worktrees (`.claude/worktrees/<area>`), `<type>/<area>` branches, slot leases, and `finish`/`reap`/`retire`/`audit`. When exercised against real multi-agent workflows (`team-lead` waves, `e2e-inspect-orchestrator` parallel bug fixes, and the live `org/team` smoke test), 12 concrete limitations and bugs emerged:

1. **No intra-area parallelism (`team-lead` & `e2e-inspect-orchestrator` regression):** `workbrokr` enforces one open effort per area (`EFFORT_OPEN`) and offers only `frontend` and `fullstack`. A backend agent (`api-coordinator`) and a frontend agent (`view-coordinator`), two frontend agents building separate components in the same area, or 4 `e2e-inspect-fix-executor` agents fixing 4 separate issues in `org/applications` cannot run in parallel — 3 of 4 immediately abort with `EFFORT_OPEN`.
2. **No mode promotion across waves:** Wave 1 (`[view]`) and Wave 2 (`[section]` with MSW) only need `frontend` mode, whereas Wave 3 (`[e2e]`) needs a fullstack slot on the same effort without prematurely finishing and pushing.
3. **Bypassed `commons` locks under shared session names:** `currentOwner()` falls back to `user@hostname` (or inherits a parent `CLAUDE_CODE_SESSION_ID` across subagents). Because `checkCommit()` skips `commons` write-locks whenever `lease.owner.session === c.ownerSession`, parallel agents on the same machine bypass each other's `commons` locks.
4. **Stateless `when:` refresh failure, lockfile dirtying, and submodule ordering:**
   - When `ensureWorktree()` creates or syncs a worktree where `syncFrom()` reports `up-to-date` (`changed = []`), `when: '*/package-lock.json'` is skipped even when `node_modules` lags `package-lock.json`.
   - When `npm install` runs in refresh, loose version ranges can dirty a clean `package-lock.json`, causing `work finish` to fail with `DIRTY_WORKTREE` on files the agent never touched.
   - `startEffort()` runs `syncFrom(baseBranch)` *before* `runRefresh()`, so broken submodule `.git` gitfile pointers left by `git worktree add` (when `submodule.recurse=true`) break `git merge` before refresh scripts can repair them.
5. **Over-broad `globsOverlap` and cross-area `extraScopes` deadlocks:**
   - `literalPrefix()` truncates at the first wildcard character and compares raw string prefixes without `/` boundaries (`modules/school` vs `modules/schoolscandidates`, `db/migration/*{module}*`).
   - `AreaSpec.extraScopes` is unconditionally included in all modes and treated as exclusive, so shared directories like `app-ui/components/discover-schools/dashboards/**` on both `org/dashboard` and `family/dashboard` block both areas from ever running in parallel (`SCOPE_CONFLICT`).
6. **Unsafe `--join`, squash-merge deadlocks, and leftover worktree branch mismatches:**
   - `--join` returns immediately even while an effort is still `'starting'` (`leases: []`), ignores mode/story mismatches, and has no participant reference counting on `work finish`.
   - Squash-merged PRs leave `commitsNotOn(baseBranch) > 0` on `<type>/<area>`, blocking subsequent `--type` switches with `EFFORT_OPEN`.
   - Leftover worktrees on non-area or older branches (e.g. `chore/platform/tooling`) are only checked if `current.endsWith('/' + area)`, risking commits on stale branches if not verified/switched cleanly.
7. **Immortal & misattributed `commons` notices:**
   - `finishEffort()` computes `commonsTouched` from `g.changedSince(baseBranch)` (`origin/<baseBranch>...HEAD`). If an effort made 0 commits of its own (or inherited commits from an unmerged parent branch), it spams all 35+ areas with false notices.
   - `Registry.clearNotices(project, area)` is only called on `retireArea()` (and only clears notices *for* `area`, not notices *from* `area`'s branch). Neither `startEffort()` (after syncing `origin/<baseBranch>`) nor `finishEffort()` ever clears notices, leaving stale notices in `~/.cache/helmsmith/registry.json` forever.
8. **Git hook exclusivity collision:** `work hooks install` sets `core.hooksPath = .helmsmith/hooks`, which disables `.git/hooks/{pre-commit,pre-push}` (such as `.pre-commit-config.yaml` / `pre-commit` framework) instead of chaining to them.
9. **O(N) serial `git fetch` storms:** `statusFor()` and `auditProject()` run `git fetch origin <baseBranch>` inside every area worktree in a loop despite all worktrees sharing `--git-common-dir`.
10. **Folded `workkit` packaging gap (`#67`):** `platform/core/workkit-lib` was folded into `apps/workbrokr/src/core`, but `apps/workbrokr/package.json` only exports `./dist/cli.js`, preventing `@helmsmith/storybrokr` from importing `./core` in Spec 2.

---

## 2. Goals and Non-Goals

**Goals**
1. Enable concurrent backend and multi-component/multi-issue frontend or fullstack efforts inside the same area via `--mode backend`, `--task <slug>`, and narrowed `--scope <glob>...`.
2. Support both independent sub-ticket PRs (`work finish` pushes `<type>/<area>--<task>`) and multi-wave feature assembly (`work finish --into-area` merges into `<type>/<area>`, followed by `work promote --mode fullstack`).
3. Keep zero worktree clutter: primary area worktrees stay permanent and warm; `--task <slug>` worktrees are ephemeral and automatically removed on `work finish`.
4. Enforce `commons` write-locks and exclusive `scopes` by checkout worktree identity at `pre-commit` time, while supporting mode-aware `extraScopes` and non-blocking cross-area `sharedScopes`.
5. Make worktree bootstrap and refresh self-healing: repair submodule gitfiles *before* `syncFrom`, trigger `when:` refresh entries via content-hash stamps in `<logDir>/.refresh-stamps.json`, restore clean `when` lockfiles dirtied by install commands, and support optional `manifest.seed`.
6. Fix notice attribution and lifecycle so notices are only emitted for commits unique to the finishing effort, cleared when an area syncs `origin/<baseBranch>`, and purged when a source branch is retired.
7. Chain `.helmsmith/hooks/{pre-commit,pre-push}` to existing `.git/hooks/<hook>` scripts, and export `./core` from `@helmsmith/workbrokr`.

**Non-Goals**
- Changing `storybrokr`'s internal daemon or browser pool (deferred to Spec 2).
- AST/import-graph impact notices (deferred to Spec 3).

---

## 3. Data Model, Packaging & Manifest Extensions

### 3.1 Package Exports (`apps/workbrokr/package.json` & `tsup.config.ts`)
- Add `src/core/index.ts` as a second entry point in `tsup.config.ts` (`entry: ['src/cli.ts', 'src/core/index.ts']`).
- Add `exports` to `apps/workbrokr/package.json`:
  ```json
  "exports": {
    ".": "./dist/cli.js",
    "./core": "./dist/core/index.js"
  }
  ```

### 3.2 Types (`src/core/types.ts`)

```ts
export type Mode = 'frontend' | 'backend' | 'fullstack';

export interface ServiceSpec {
  start: string;
  stop: string;
  health: string;
  healthyCodes?: number[];
  reset?: string;
  healthTimeoutMs?: number;
  /**
   * Which slot-bearing modes start this service.
   * Default: ['fullstack'] when service name === 'frontend', else ['backend', 'fullstack'].
   */
  modes?: ('backend' | 'fullstack')[];
}

export interface RefreshEntry {
  when?: string;
  always?: boolean;
  run?: string;
  mark?: string;
  /**
   * When true (default true when `when` is set), if files matching `when` were clean before
   * `run` executed and dirty afterwards, restore them with `git checkout --` after recording
   * their pre-run content hash stamp.
   */
  restoreWhenIfClean?: boolean;
}

export type ExtraScopesSpec =
  | string[]
  | {
      frontend?: string[];
      backend?: string[];
    };

export interface AreaSpec {
  module?: string;
  commons?: string[];
  /** Exclusive additional scopes held by this area (array defaults to frontend + fullstack). */
  extraScopes?: ExtraScopesSpec;
  /**
   * Non-exclusive scopes shared across multiple areas (e.g. shared dashboard widgets).
   * Included in commit/push in-scope checks so commits don't warn, but excluded from
   * start-time `globsOverlap` refusal unless explicitly claimed via `--scope`.
   */
  sharedScopes?: string[];
}

export interface Manifest {
  // ...existing fields...
  /**
   * Optional commands run in a worktree the first time `git worktree add` creates it.
   * Runs with WORKTREE and MAIN_ROOT in env before sync/refresh.
   */
  seed?: string[];
}

export interface Effort {
  id: string;
  project: string;
  area: string;
  /** Optional intra-area task slug (^[a-z0-9][a-z0-9_-]{0,47}$, no `--`). */
  task?: string;
  type: string;
  mode: Mode;
  branch: string;
  worktree: string;
  owner: Owner;
  /** Additional sessions that joined this effort via `--join`. */
  participants?: Owner[];
  /** Commit SHA of HEAD when the effort started (used to attribute commits made during this effort). */
  baseSha?: string;
  state: EffortState;
  scopes: string[];
  commons: string[];
  leases: string[];
  notices: Notice[];
  started: string;
  lastActivity: string;
  parkedReason?: string;
}
```

### 3.3 Worktree and Branch Addressing

| Effort Kind | CLI Flags | Worktree Path | Branch Name | Lifecycle |
| :--- | :--- | :--- | :--- | :--- |
| **Area Effort** | `--area <a> --type <t>` | `<worktreeRoot>/<a>` | `<t>/<a>` | **Permanent** (removed only by `work retire`) |
| **Task Sub-Effort** | `--area <a> --task <slug> --type <t>` | `<worktreeRoot>/_tasks/<a>--<slug>` | `<t>/<a>--<slug>` | **Ephemeral** (auto-removed by `work finish`) |

- **Why `<worktreeRoot>/_tasks/<a>--<slug>`:** Placing task worktrees under `_tasks/` guarantees they never nest inside `<worktreeRoot>/<a>` (which is itself a git working tree).
- **Why `<t>/<a>--<slug>`:** Git stores refs as files under `.git/refs/heads/`. If `<t>/<a>` exists as a ref file, git refuses to create `<t>/<a>/<slug>`. Joining with `--` keeps both refs valid at the same directory depth; `TASK_INVALID` forbids `--` inside task slugs (`TASK_SLUG = /^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/`).

---

## 4. Scopes, Narrowing, and Lock Semantics

### 4.1 Mode-Aware Scope Expansion (`src/core/scopes.ts`)

`expandScopes(m: Manifest, area: string, mode: Mode, narrowedScopes?: string[]): string[]`:
1. Compute the area's **exclusive mode scope**:
   - `frontend`: `m.scopes.frontend` expanded with `{group}` and `{section}`, plus frontend `extraScopes` (`Array.isArray(spec.extraScopes) ? spec.extraScopes : (spec.extraScopes?.frontend ?? [])`).
   - `backend`: requires `spec.module` (throws `MANIFEST_INVALID` if missing); expands `m.scopes.backend` with `{group}`, `{section}`, `{module}`, plus backend `extraScopes` (`Array.isArray(spec.extraScopes) ? [] : (spec.extraScopes?.backend ?? [])`).
   - `fullstack`: union of `frontend` and `backend` scopes.
2. Compute the area's **allowed scope** = `exclusiveModeScope` ∪ `(spec.sharedScopes ?? [])`.
3. If `narrowedScopes` (`--scope <glob>...`) is omitted: return `exclusiveModeScope`.
4. If `narrowedScopes` is provided:
   - Require `--task <slug>` (refuse with `SCOPE_REQUIRES_TASK` if `--scope` is passed without `--task`, so a primary area effort always protects the full area).
   - Validate that every glob `g` in `narrowedScopes` is contained within at least one glob `base` of the area's **allowed scope** (`isSubGlob(g, base)`). If any `g` falls outside the area's allowed scope, throw `WorkkitError('SCOPE_OUTSIDE_AREA', ...)`.
   - Return `narrowedScopes`.

`allowedScopesForEffort(m: Manifest, effort: Pick<Effort, 'area' | 'scopes'>): string[]`:
- Returns `[...effort.scopes, ...(m.areas[effort.area]?.sharedScopes ?? []), ...Object.values(m.commons).flat()]` for use in commit/push scope guards.

### 4.2 Segment-Aware Glob Overlap (`globsOverlap`)

Replace character-level `literalPrefix` with path-segment comparison:
1. Normalize leading `./` and split each glob `x` and `y` on `/`.
2. Walk segment pairs `(sx, sy)` from index `0`:
   - If either segment is `**`, the globs overlap at that depth → **match (`true`)**.
   - If neither segment contains wildcard characters (`*?[{`): they must be strictly equal (`sx === sy`); if not, the globs are disjoint (`false`). (Fixes `modules/school` vs `modules/schoolscandidates`).
   - If one or both segments contain wildcards (e.g. `*registration_students*` vs `*team*`, or `SearchInput` vs `*`):
     - If one segment is literal and the other is a pattern: test `picomatch.isMatch(literal, pattern)`. If false, disjoint (`false`).
     - If both segments are patterns: if both match `^\*([^*?[{]+)\*$` with tokens `tx` and `ty`, and neither `tx.includes(ty)` nor `ty.includes(tx)` holds (e.g. `*registration_students*` vs `*team*`), they are disjoint (`false`). Otherwise treat as overlapping (`true`, conservative).
3. If one glob runs out of segments before the other without hitting `**`, they are disjoint (`false`).

### 4.3 Commit-Time and Push-Time Guards (`src/core/guards.ts`)

In `checkCommit(c: CommitCheck): { refusals: string[]; warnings: string[] }`:
1. **Protected branches:** Unchanged — refuse commits on `m.protectedBranches`.
2. **Worktree-bound `commons` write-locks:**
   - Identify the holder effort of each `commons` lease (`efforts.get(lease.effort)`).
   - If `holder && c.checkoutRoot && existsSync(holder.worktree)`: allow **only** when `same(holder.worktree, c.checkoutRoot)` (do **not** short-circuit on `lease.owner.session === c.ownerSession` when both worktree paths are known, preventing same-machine/same-session agents in other worktrees from bypassing the lock).
   - Fallback to `lease.owner.session === c.ownerSession` only when `c.checkoutRoot` is omitted or `holder` has no worktree.
   - Otherwise, if any `c.stagedPaths` match `m.commons[lease.value]`, push a refusal naming the owning area/task, worktree, and session.
3. **Commit-time exclusive scope lock:**
   - For every *other* open (`starting` or `active`) effort `other` in the project (`!(c.checkoutRoot && existsSync(other.worktree) && same(other.worktree, c.checkoutRoot))`):
     - If any `c.stagedPaths` match `other.scopes`, push a refusal:
       `path(s) <hit> are inside the active scope of <otherLabel> (<other.branch>, owned by <other.owner.session>)`.
   - If the committing checkout belongs to an open effort `mine`, any `c.stagedPaths` outside `allowedScopesForEffort(c.m, mine)` produce a non-blocking `warnings[]` entry printed to stderr at commit time.
4. **Pre-push (`checkPush`):**
   - Look up the effort for `c.branch` across `active` **and** `parked` efforts, and check against `allowedScopesForEffort(c.m, effort)`.

### 4.4 Git Hook Chaining (`src/core/hooks.ts`)
- Update `preCommitScript` and `prePushScript` so that instead of `exec workbrokr hook <name> "$@"`, the script runs `workbrokr hook <name> "$@"` (capturing its exit code and forwarding `$input` on stdin for `pre-push`), and if it exits `0`, checks for an executable legacy hook at `$(git rev-parse --git-common-dir)/hooks/<name>` (guarding against self-recursion via `[ "$(cd "$(dirname "$LEGACY")" && pwd)" != "$(cd "$(dirname "$0")" && pwd)" ]`) and chains to it.

---

## 5. Lifecycle Operations (`src/lib/effort.ts`, `src/core/refresh.ts`, `src/core/git.ts`)

### 5.1 Single-Fetch, Submodule Pre-Sync Repair, Branch Verification & Squash-Merge Recovery

- **Single `git fetch`:**
  - `fetchBaseOnce(ctx: Ctx)` runs `new Git(ctx.repoRoot).tryRun(['fetch', '-q', 'origin', ctx.manifest.baseBranch])` once at the start of `startEffort()`, `statusFor()`, and `auditProject()`.
  - `behindBase(ctx, worktree)` no longer runs `git fetch`; it only runs `git rev-list --count HEAD..origin/<baseBranch>`.
- **Submodule gitfile repair (`Git.repairSubmodules()`):**
  - When `git worktree add` creates a worktree in a repo with `.gitmodules` and `submodule.recurse=true`, submodule `.git` pointers inside the worktree can point to broken relative paths, causing `git merge` in `syncFrom` to fail before refresh scripts run.
  - Add `wg.repairSubmodules(mainRoot: string)`: if `.gitmodules` exists in `wg.cwd`, parse `submodule.<name>.path` from `git config -f .gitmodules --get-regexp '^submodule\..*\.path$'`; for each submodule path whose `<mainRoot>/<subPath>/.git` exists, point `<worktree>/<subPath>/.git` at the resolved gitdir and run `git submodule update --init --checkout` on any uninitialized submodule.
  - Run `wg.repairSubmodules(ctx.repoRoot)` in `ensureWorktree` **before** `syncFrom(m.baseBranch)`.
- **Branch verification & squash-merge recovery in `ensureWorktree`:**
  - Add `wg.isEquivalentToBase(baseBranch: string): boolean`:
    1. `wg.tryRun(['diff', '--quiet', `origin/${baseBranch}`, 'HEAD']).code === 0` (tree is identical to `origin/<baseBranch>`), OR
    2. `wg.tryRun(['cherry', `origin/${baseBranch}`, 'HEAD'])` succeeds and every non-empty line starts with `- ` (all commits on `HEAD` have patch-equivalent commits on `origin/<baseBranch>`).
  - When reusing an existing worktree:
    - If `current !== branch`:
      - Check if `wg.isDirty()` first → throw `DIRTY_WORKTREE`.
      - If `wg.commitsNotOn(m.baseBranch).length > 0 && !wg.isEquivalentToBase(m.baseBranch)` → throw `EFFORT_OPEN` (regardless of whether `current` ends with `/${area}`, protecting any unmerged commits on a previous branch in that worktree).
      - If `wg.branchExists(branch)` and `branch` itself has unmerged commits that are `isEquivalentToBase(m.baseBranch)` (e.g. `branch` was previously squash-merged), reset `branch` to `origin/${m.baseBranch}` (`checkout -B`).
      - Otherwise `wg.checkout(branch, `origin/${m.baseBranch}`)`.
    - If `current === branch`:
      - If `!wg.isDirty() && wg.commitsNotOn(m.baseBranch).length > 0 && wg.isEquivalentToBase(m.baseBranch)`, reset `branch` to `origin/${m.baseBranch}` (`wg.run(['reset', '--hard', `origin/${m.baseBranch}`])`) so a previously squash-merged branch starts clean at `origin/<baseBranch>` instead of re-merging stale history.

### 5.2 Cold-Worktree Seeding, Hash-Stamped `when:` Refresh, and Clean Lockfile Restore

- **Cold-worktree seeding (`created === true`):**
  - When `ensureWorktree` creates the worktree directory for the first time (`created === true`) and `m.seed && m.seed.length > 0`:
    - Execute `runRefresh(m.seed, worktree, log, { ...process.env, WORKTREE: worktree, MAIN_ROOT: ctx.repoRoot })` before `selectRefresh`.
- **Content-hash stamps for `when:` refresh (`<logDir>/.refresh-stamps.json`):**
  - Instead of relying solely on `changedPaths` from `syncFrom` (which is empty on newly created worktrees or when `node_modules` was seeded from a stale checkout), `selectRefresh(entries, changedPaths, { worktree, stampFile })`:
    - Reads `<logDir>/.refresh-stamps.json` (map of `whenGlob -> sha256Hex`).
    - For each `RefreshEntry` with `e.when`:
      - Resolves tracked files in `worktree` matching `e.when` (or checks if `e.when` is a literal relative path that exists in `worktree`) and computes a combined sha256 digest of their contents.
      - Triggers the refresh entry if `changedPaths` matches `e.when` **OR** if the current sha256 digest differs from the stored stamp in `.refresh-stamps.json` (including when no stamp exists yet on a cold worktree).
- **Clean lockfile restore (`restoreWhenIfClean`):**
  - Before executing a triggered refresh entry that has `e.when` and `e.restoreWhenIfClean !== false`:
    - Check which matched `when` files are currently clean in git (`git status --porcelain -- <files>` is empty).
    - After `e.run` completes with exit code `0`, if any of those previously clean `when` files are now modified (`git status --porcelain -- <file>` non-empty, e.g. `npm install` dirtied `package-lock.json`), restore them via `git checkout -- <file>` and write the stamp to `<logDir>/.refresh-stamps.json`.

### 5.3 Accurate Notice Lifecycle & Attribution

1. **Only emit notices for commits made by the effort:**
   - Record `baseSha = wg.rev('HEAD')` on the `Effort` when `startEffort()` finishes syncing `origin/<baseBranch>`.
   - In `finishEffort()`, compute changed files for notice attribution as:
     - If `wg.commitsNotOn(m.baseBranch).length === 0` or `wg.isEquivalentToBase(m.baseBranch)`: `changed = []` (0 notices).
     - Else if `effort.baseSha`: intersect `wg.changedPaths(effort.baseSha, 'HEAD')` with `wg.changedSince(m.baseBranch)` so commits inherited before `startEffort` (e.g. branching from an unmerged parent branch and making 0 commits) never emit false notices.
     - Else: `changed = wg.changedSince(m.baseBranch)`.
   - Deduplicate notices per `(project, area, from, text)` in `Registry.addNotice` so repeated finishes never stack duplicate notice entries.
2. **Auto-prune notices once their source branch is merged into `HEAD`:**
   - In `startEffort()`, after `syncFrom(m.baseBranch)` succeeds, check each notice for `o.area`: if `origin/<notice.from>` or `<notice.from>` is an ancestor of `HEAD` (`wg.isAncestor(ref, 'HEAD')`), remove that notice from the registry (since `o.area` has now synced the commons changes).
3. **Clear notices emitted *by* a retired area (`Registry.clearNoticesFrom`):**
   - Add `Registry.clearNoticesFrom(project: string, branches: string[])` which removes any notice in `project` whose `notice.from` is in `branches`.
   - Call `clearNoticesFrom` inside `retireArea()` for all `<type>/<area>` branches of that area.

### 5.4 Reference-Counted, Mode-Safe `--join`

When `startEffort(ctx, o)` finds an open effort for `(o.area, o.task)` and `o.join === true`:
1. **Wait if `'starting'`:** If `open.state === 'starting'`, poll `ctx.registry.openEffortFor(m.project, o.area, o.task)` every 200 ms (up to 60 s) until `state === 'active'`. If it disappears or fails, throw `EFFORT_NOT_FOUND`.
2. **Mode compatibility check:**
   - Define mode coverage: `fullstack` covers `frontend`, `backend`, `fullstack`; `frontend` covers `frontend`; `backend` covers `backend`.
   - If `open.mode` does not cover `o.mode`, throw `WorkkitError('MODE_MISMATCH', `open effort on ${label} is in ${open.mode} mode; run \`work promote --area ${o.area}${o.task ? ` --task ${o.task}` : ''} --mode fullstack\` to upgrade it`)`.
3. **Late story attachment:** If `o.story` is passed and no `storybook` lease for `o.story` exists on the effort, boot `ctx.storybrokr.up(o.story, hostRoot)` and record the `storybook` lease on the effort.
4. **Participant registration:** Add `ctx.owner` to `open.participants` (if not already `open.owner` or in `open.participants` by `session + pid`), touch all leases, and return `{ effort, leases, joined: true, ... }`.

### 5.5 In-Place Mode Promotion (`work promote` / `work_promote`)

```ts
export interface PromoteOptions {
  area: string;
  task?: string;
  mode: 'backend' | 'fullstack';
  story?: string;
}
```
1. Look up the open effort for `(area, task)` (refuse `EFFORT_NOT_FOUND` if none).
2. Validate promotion direction: `frontend -> fullstack`, `backend -> fullstack`, or idempotent same-mode (`fullstack -> fullstack`, `backend -> backend`). Refuse `fullstack -> backend` or `frontend -> backend` with `MODE_MISMATCH`.
3. Compute `nextScopes = expandScopes(m, area, targetMode)` (or union with existing scopes if task-narrowed).
4. Inside `ctx.registry.update(...)`: verify no other open effort's `scopes` overlap `nextScopes` (`SCOPE_CONFLICT`); update `effort.mode = targetMode` and `effort.scopes = nextScopes`.
5. If the effort does not hold a `slot` lease: allocate a free slot (probing `busyPorts`), emit `.slot` and the env file via `emitWorktreeConfig`.
6. Filter `m.services` to services enabled for `targetMode` (`serviceModes(name, spec).includes(targetMode)`) that are not already running in `slotLease.pids`. Start only those newly required services via `ctx.runner.start`, merging the new `pids` and `signatures` into the slot lease.

### 5.6 Finishing & Converging Efforts (`work finish`)

```ts
export interface FinishOptions {
  area: string;
  task?: string;
  park?: boolean;
  intoArea?: boolean;
  force?: boolean;
}
```
1. Locate the open or parked effort for `(o.area, o.task)`.
2. **Participant check:** If `!o.force` and `effort.participants && effort.participants.length > 0`:
   - If the caller matches a participant (`p.session === ctx.owner.session`), remove that participant; if the caller is `effort.owner`, promote `effort.participants[0]` to `effort.owner` and remove from `participants`.
   - Touch the effort and return `{ effort: updated, pushed: false, parked: false, left: true, notices: 0 }` without stopping services.
3. **Dirty check / `--park`:** Same as Phase 1 (`DIRTY_WORKTREE` unless `o.park`, which commits `wip(<label>): parked <iso>`).
4. **Convergence (`o.task` vs `o.intoArea`):**
   - If `o.intoArea`:
     - Require `o.task` (refuse `MANIFEST_INVALID` / `WORKTREE_INVALID` if `--into-area` is passed without `--task`).
     - Ensure the parent area worktree (`<worktreeRoot>/<area>`) exists on `<effort.type>/<effort.area>` (creating/checking it out via `ensureWorktree` if needed) and is clean (`DIRTY_WORKTREE` if dirty).
     - In the area worktree, merge the task branch (`git merge --no-edit -q <effort.branch>`). If the merge conflicts, abort the merge in the area worktree (`git merge --abort`) and throw `SYNC_CONFLICT` **before** stopping task leases or removing the task worktree.
   - Else:
     - Push `effort.branch` to `origin` (`g.push(effort.branch)`).
5. **Teardown & Ephemeral Task Cleanup:**
   - Release all leases held by the effort (stopping only recorded service PIDs / Storybook instances).
   - Leave `commons` notices if `commonsTouched` (from commits unique to this effort) is non-empty and `!o.intoArea` (when merging `--into-area`, notices are deferred until the parent area effort finishes and pushes).
   - If `effort.task`:
     - Archive `m.archive.paths` into `.slot-archive/<area>--<task>/<stamp>/`.
     - Remove the ephemeral task worktree (`main.worktreeRemove(effort.worktree)`).
     - If `o.intoArea`, delete the local merged task branch (`main.deleteLocalBranch(effort.branch)`).
     - Remove the finished task effort record from the registry.

---

## 6. CLI, MCP, and Error Codes

### 6.1 CLI Changes (`src/commands/`)
- `work start`: add `--task <slug>`, `--scope <glob>...` (repeatable), and widen `--mode <frontend|backend|fullstack>`.
- `work promote`: new command `work promote --area <area> [--task <slug>] --mode <backend|fullstack> [--story <path>] [--project-root <dir>] [--json]`.
- `work finish`: add `--task <slug>`, `--into-area`, and `--force`.
- `work status` & `work env`: add `--task <slug>`.

### 6.2 MCP Changes (`src/mcp/server.ts`)
- Add optional `projectRoot?: string` to every MCP tool (`work_start`, `work_status`, `work_finish`, `work_promote`, `work_reap`, `work_audit`, `work_env`) so agents working across multiple repos or checkouts are never pinned to the stdio server's startup `cwd`.
- Update `work_start`, `work_status`, `work_finish`, `work_env` schemas with `task?`, `scopes?`, `intoArea?`, `force?`, and `mode: 'frontend' | 'backend' | 'fullstack'`.
- Register new tool `work_promote`.

### 6.3 New Refusal Codes (Exit Code 2)
- `TASK_INVALID`: task slug does not match `/^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/`.
- `SCOPE_REQUIRES_TASK`: `--scope` was passed without `--task`.
- `SCOPE_OUTSIDE_AREA`: a `--scope` glob is not a subset of the area's allowed scopes.
- `MODE_MISMATCH`: `--join` requested a mode not covered by the open effort, or `promote` requested an invalid mode transition.

---

## 7. Testing Plan

1. **Scope, `extraScopes`/`sharedScopes`, & Overlap Unit Tests (`src/core/scopes.test.ts`):**
   - `expandScopes` for `frontend`, `backend`, and `fullstack` modes, including mode-specific `extraScopes` and `sharedScopes`.
   - `globsOverlap` returns `false` for `app-service/modules/school/**` vs `app-service/modules/schoolscandidates/**`.
   - `globsOverlap` returns `false` for `db/migration/*registration_students*` vs `db/migration/*team*`, and `true` for identical or wildcard-containing migration globs.
   - `--scope` subset validation accepts `app/org/applications/SearchInput/**` under `app/{group}/{section}/**` (and paths under `sharedScopes`), rejects `app/org/team/**` with `SCOPE_OUTSIDE_AREA`, and rejects `--scope` without `--task` with `SCOPE_REQUIRES_TASK`.
2. **Worktree-Bound Guard & Hook Chaining Tests (`src/core/guards.test.ts`, `src/core/hooks.test.ts`):**
   - Two efforts with identical `owner.session` (`user@host`) in different worktrees: committing a file under a `commons` lease held by Worktree A from Worktree B is **refused**; committing from Worktree A is allowed.
   - Committing a file in Worktree B that matches Worktree A's active `scopes` is **refused** by `checkCommit`.
   - Committing a file in Worktree A that matches Worktree A's `sharedScopes` produces zero warnings and zero refusals.
   - Installed `.helmsmith/hooks/pre-commit` chains to executable `.git/hooks/pre-commit` when `workbrokr hook pre-commit` exits 0.
3. **Refresh Stamp, Clean Lockfile Restore, & Submodule Repair Tests (`src/core/refresh.test.ts`, `src/core/git.test.ts`):**
   - Cold worktree with `changedPaths = []` triggers `when: 'package-lock.json'` because no hash stamp exists yet in `.refresh-stamps.json`; second run with unchanged `package-lock.json` skips it; modifying `package-lock.json` triggers it again.
   - When a refresh command modifies a previously clean `when` file (`package-lock.json`), `runRefresh` restores `package-lock.json` to clean while recording the stamp.
   - `repairSubmodules` repairs a broken `.git` gitfile pointer in a submodule worktree before `syncFrom`.
4. **Service Mode & Promotion Tests (`src/core/runner.test.ts`, `src/lib/effort.test.ts`):**
   - `--mode backend` starts only `postgres` and `backend` (`frontend` is not spawned).
   - `promoteEffort` from `backend` to `fullstack` keeps existing `postgres`/`backend` PIDs untouched and spawns only `frontend`.
   - `promoteEffort` from `frontend` to `fullstack` allocates a slot lease and starts `postgres`, `backend`, and `frontend`.
5. **Intra-Area Wave, Notice Lifecycle, & Squash-Merge Tests (`src/lib/effort.test.ts`, `tests/e2e/lifecycle.test.ts`):**
   - Parallel wave on one area: start `(org/applications, task: api, mode: backend)` + `(org/applications, task: search-input, mode: frontend, scope: ...)` + `(org/applications, task: user-card, mode: frontend, scope: ...)` concurrently; `finish --into-area` merges all three into `feature/org/applications` and removes `_tasks/*` worktrees.
   - Reference-counted `--join`: Agent B joins Agent A's effort; Agent B calling `work finish` leaves the effort and services running; Agent A calling `work finish` stops services and pushes.
   - Notice lifecycle: finishing an effort with 0 unique commits emits 0 notices; notices are cleared on the next `work start` after `syncFrom`; retiring an area clears notices emitted by its branches.
   - Squash-merge recovery: simulate a squash-merge of `feature/org/team` onto `origin/develop`; verify `work start --area org/team --type fix` resets and switches cleanly without `EFFORT_OPEN`.
   - Single `git fetch`: verify `statusFor` across multiple areas invokes `git fetch` once on `repoRoot`.

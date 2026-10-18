# workbrokr — intra-area parallel waves, mode promotion, and core concurrency (design)

**Status:** approved in conversation 2026-10-18, written for planning.
**Home:** `apps/workbrokr` (`@helmsmith/workbrokr`, including `apps/workbrokr/src/core`).
**Series:** Spec 1 of 3 for parallel-workflow upgrades across `workbrokr` and `storybrokr`:
- **Spec 1 (this document):** Intra-area wave parallelism (`--mode backend`, `--task <slug>`, `--scope <glob>`), in-place mode promotion (`work promote`), task convergence (`work finish --into-area`), reference-counted `--join`, squash-merge branch recovery, cold-worktree seeding (`manifest.seed`), worktree-bound `commons` & scope commit guards, and single-fetch git status/audit.
- **Spec 2 (planned):** Worktree-scoped `storybrokr` instances, root-only default story discovery, parallel `BrowserPool` checks, and unified `workbrokr`/`storybrokr` lease & TTL management.
- **Spec 3 (planned):** Bidirectional import graph, `--affected` story verification, targeted impact notices, Storybook globals (`theme`/`locale`), console/network/a11y failure capture, and base-vs-worktree visual diffing.

---

## 1. Problem

Phase 1 (`2026-10-17-workbrokr-design.md`) established area-based worktrees (`.claude/worktrees/<area>`), `<type>/<area>` branches, slot leases, and `finish`/`reap`/`retire`/`audit`. When exercised against real multi-agent workflows on the same project — specifically orchestrated feature waves (`team-lead`: parallel `[api]` + multiple `[view]` agents followed by `[section]` and `[e2e]`) and parallel sub-tickets within one domain — seven concrete limitations emerge:

1. **No intra-area parallelism:** `workbrokr` enforces one open effort per area (`EFFORT_OPEN`) and offers only `frontend` (locks UI scopes) and `fullstack` (locks UI + backend scopes and boots all services). A backend agent (`api-coordinator`) and a frontend agent (`view-coordinator`), or two frontend agents building separate components in the same area, cannot work in isolated worktrees concurrently.
2. **No mode promotion across waves:** Wave 1 (`[view]`) and Wave 2 (`[section]` with MSW) only need `frontend` mode, whereas Wave 3 (`[e2e]`) needs a fullstack slot on the same effort without prematurely finishing and pushing.
3. **Bypassed `commons` locks under shared session names:** `currentOwner()` falls back to `user@hostname` (or inherits a parent `CLAUDE_CODE_SESSION_ID` across subagents). Because `checkCommit()` skips `commons` write-locks whenever `lease.owner.session === c.ownerSession`, parallel agents on the same machine bypass each other's `commons` locks.
4. **Cold-worktree bootstrap gap:** When `ensureWorktree()` creates a worktree for the first time at `origin/<baseBranch>`, `syncFrom()` reports `up-to-date` (`changed = []`), skipping all `when:` refresh commands (`make install`, `db-reset`) and leaving the new worktree without `node_modules` or a seeded database.
5. **Over-broad `globsOverlap`:** `literalPrefix()` truncates at the first wildcard character and compares raw string prefixes without `/` boundaries. Wildcard-prefixed globs (`db/migration/*{module}*`) collide across all areas, and module names that are string prefixes of other modules (`school` vs `schoolscandidates`) falsely conflict.
6. **Unsafe `--join` and squash-merge deadlocks:** `--join` returns immediately even while an effort is still `'starting'` (`leases: []`), ignores mode/story mismatches, and has no participant reference counting on `work finish`. Meanwhile, squash-merged PRs leave `commitsNotOn(baseBranch) > 0` on `<type>/<area>`, permanently blocking branch type switches with `EFFORT_OPEN`.
7. **O(N) serial `git fetch` storms:** `statusFor()` and `auditProject()` run `git fetch origin <baseBranch>` inside every area worktree in a loop despite all worktrees sharing `--git-common-dir`.

---

## 2. Goals and Non-Goals

**Goals**
1. Enable concurrent backend and multi-component frontend efforts inside the same area via `--mode backend`, `--task <slug>`, and narrowed `--scope <glob>...`.
2. Support both independent sub-ticket PRs (`work finish` pushes `<type>/<area>--<task>`) and multi-wave feature assembly (`work finish --into-area` merges into `<type>/<area>`, followed by `work promote --mode fullstack`).
3. Keep zero worktree clutter: primary area worktrees stay permanent and warm; `--task <slug>` worktrees are ephemeral and automatically removed on `work finish`.
4. Enforce `commons` write-locks and exclusive `scopes` by checkout worktree identity at `pre-commit` time.
5. Bootstrap newly created worktrees deterministically via `manifest.seed` (with full-refresh fallback) and recover cleanly when `<type>/<area>` branches were squash-merged into `origin/<baseBranch>`.

**Non-Goals**
- Changing `storybrokr`'s internal daemon or browser pool (deferred to Spec 2).
- AST/import-graph impact notices (deferred to Spec 3).

---

## 3. Data Model & Manifest Extensions

### 3.1 Types (`src/core/types.ts`)

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

export interface Manifest {
  // ...existing fields...
  /**
   * Optional commands run in a worktree the first time `git worktree add` creates it.
   * Runs with WORKTREE and MAIN_ROOT in env. When absent or empty, initial creation
   * runs all `refresh` entries (both `always` and `when`) so dependencies are installed.
   */
  seed?: string[];
}

export interface Effort {
  id: string;
  project: string;
  area: string;
  /** Optional intra-area task slug (^[a-z0-9][a-z0-9_-]{0,47}$). */
  task?: string;
  type: string;
  mode: Mode;
  branch: string;
  worktree: string;
  owner: Owner;
  /** Additional sessions that joined this effort via `--join`. */
  participants?: Owner[];
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

### 3.2 Worktree and Branch Addressing

| Effort Kind | CLI Flags | Worktree Path | Branch Name | Lifecycle |
| :--- | :--- | :--- | :--- | :--- |
| **Area Effort** | `--area <a> --type <t>` | `<worktreeRoot>/<a>` | `<t>/<a>` | **Permanent** (removed only by `work retire`) |
| **Task Sub-Effort** | `--area <a> --task <slug> --type <t>` | `<worktreeRoot>/_tasks/<a>--<slug>` | `<t>/<a>--<slug>` | **Ephemeral** (auto-removed by `work finish`) |

- **Why `<worktreeRoot>/_tasks/<a>--<slug>`:** Placing task worktrees under `_tasks/` guarantees they never nest inside `<worktreeRoot>/<a>` (which is itself a git working tree).
- **Why `<t>/<a>--<slug>`:** Git stores refs as files under `.git/refs/heads/`. If `<t>/<a>` exists as a ref file, git refuses to create `<t>/<a>/<slug>`. Joining with `--` keeps both refs valid at the same directory depth; `MANIFEST_INVALID` / `TASK_INVALID` forbids `--` inside area segments and task slugs (`TASK_SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/` with no `--`).

---

## 4. Scopes, Narrowing, and Lock Semantics

### 4.1 Mode-Aware Scope Expansion (`src/core/scopes.ts`)

`expandScopes(m: Manifest, area: string, mode: Mode, narrowedScopes?: string[]): string[]`:
1. Compute the area's **full mode scope**:
   - `frontend`: `m.scopes.frontend` expanded with `{group}` and `{section}`, plus `spec.extraScopes ?? []`.
   - `backend`: requires `spec.module` (throws `MANIFEST_INVALID` if missing); expands `m.scopes.backend` with `{group}`, `{section}`, `{module}`.
   - `fullstack`: union of `frontend` and `backend` scopes.
2. If `narrowedScopes` (`--scope <glob>...`) is omitted: return the full mode scope.
3. If `narrowedScopes` is provided:
   - Require `--task <slug>` (refuse with `SCOPE_REQUIRES_TASK` if `--scope` is passed without `--task`, so a primary area effort always protects the full area).
   - Validate that every glob `g` in `narrowedScopes` is contained within at least one glob `base` of the area's full mode scope (`isSubGlob(g, base)`). If any `g` falls outside the area's mode scope, throw `WorkkitError('SCOPE_OUTSIDE_AREA', ...)`.
   - Return `narrowedScopes`.

### 4.2 Segment-Aware Glob Overlap (`globsOverlap`)

Replace character-level `literalPrefix` with path-segment comparison:
1. Normalize leading `./` and split each glob `x` and `y` on `/`.
2. Walk segment pairs `(sx, sy)` from index `0`:
   - If either segment is `**`, the globs overlap at that depth → **match (`true`)**.
   - If neither segment contains wildcard characters (`*?[{`): they must be strictly equal (`sx === sy`); if not, the globs are disjoint (`false`). (Fixes `modules/school` vs `modules/schoolscandidates`).
   - If one or both segments contain wildcards (e.g. `*registration_students*` vs `*team*`, or `SearchInput` vs `*`):
     - If one segment is literal and the other is a pattern: test `picomatch.isMatch(literal, pattern)`. If false, disjoint (`false`).
     - If both segments are patterns: extract literal substrings (tokens between `*`) or test synthetic candidates; if both are `*<literal>*` with distinct non-substring literals (`registration_students` vs `team`), they are disjoint (`false`). Otherwise treat as overlapping (`true`, conservative).
3. If one glob runs out of segments before the other without hitting `**`, they are disjoint (`false`).

### 4.3 Commit-Time and Push-Time Guards (`src/core/guards.ts`)

In `checkCommit(c: CommitCheck)`:
1. **Protected branches:** Unchanged — refuse commits on `m.protectedBranches`.
2. **Worktree-bound `commons` write-locks:**
   - Identify the committing effort by matching `c.checkoutRoot` against open efforts' `worktree` (`realpath` comparison).
   - For each `commons` lease in the project:
     - Allow if `holder && c.checkoutRoot && same(holder.worktree, c.checkoutRoot)`.
     - Allow only as a fallback when `c.checkoutRoot` is undefined if `lease.owner.session === c.ownerSession`.
     - Otherwise, if any `c.stagedPaths` match `m.commons[lease.value]`, push a refusal naming the owning area/task, worktree, and session.
3. **Commit-time exclusive scope lock:**
   - For every *other* open (`starting` or `active`) effort `other` in the project (`!same(other.worktree, c.checkoutRoot)`):
     - If any `c.stagedPaths` match `other.scopes`, push a refusal:
       `path(s) <hit> are inside the active scope of <other.area>[--<other.task>] (<other.branch>, owned by <other.owner.session>)`.
   - If the committing checkout belongs to an open effort `mine`, any `c.stagedPaths` outside `[...mine.scopes, ...allCommonsGlobs]` produce a non-blocking `warnings[]` entry printed to stderr at commit time.
4. **Pre-push (`checkPush`):**
   - Look up the effort for `c.branch` across `active` **and** `parked` efforts so finishing a parked effort still runs scope/commons warnings.

---

## 5. Lifecycle Operations (`src/lib/effort.ts`)

### 5.1 Single-Fetch & Cold-Worktree Seeding

- **Single `git fetch`:**
  - `fetchBaseOnce(ctx: Ctx)` runs `new Git(ctx.repoRoot).tryRun(['fetch', '-q', 'origin', ctx.manifest.baseBranch])` once at the start of `startEffort()`, `statusFor()`, and `auditProject()`.
  - `behindBase(ctx, worktree)` no longer runs `git fetch`; it only runs `git rev-list --count HEAD..origin/<baseBranch>`.
- **Squash-merge branch recovery in `ensureWorktree`:**
  - When reusing an existing area worktree whose current branch `curr` has `commitsNotOn(baseBranch).length > 0`:
    - Check `wg.isEquivalentToBase(m.baseBranch)`:
      1. `wg.tryRun(['diff', '--quiet', `origin/${m.baseBranch}`, 'HEAD']).code === 0` (tree is identical to `origin/<baseBranch>`), OR
      2. Every line of `wg.tryRun(['cherry', `origin/${m.baseBranch}`, 'HEAD']).out` starts with `- ` (all patches applied upstream).
    - If `isEquivalentToBase` is true and `!wg.isDirty()`, reset the branch to `origin/<baseBranch>` via `wg.run(['checkout', '-q', '-B', branch, `origin/${m.baseBranch}`])`.
- **Cold-worktree seeding (`created === true`):**
  - When `ensureWorktree` creates the worktree directory for the first time:
    - If `m.seed && m.seed.length > 0`, execute `runRefresh(m.seed, worktree, log, { ...process.env, WORKTREE: worktree, MAIN_ROOT: ctx.repoRoot })`.
    - Otherwise, select all `m.refresh` entries (`e.always === true || e.when !== undefined`) so initial creation runs every install command and collects marks (`db-reset`).

### 5.2 Reference-Counted, Mode-Safe `--join`

When `startEffort(ctx, o)` finds an open effort for `(o.area, o.task)` and `o.join === true`:
1. **Wait if `'starting'`:** If `open.state === 'starting'`, poll `ctx.registry.openEffortFor(m.project, o.area, o.task)` every 200 ms (up to 60 s) until `state === 'active'`. If it disappears or fails, throw `EFFORT_NOT_FOUND`.
2. **Mode compatibility check:**
   - Define mode coverage: `fullstack` covers `frontend`, `backend`, `fullstack`; `frontend` covers `frontend`; `backend` covers `backend`.
   - If `open.mode` does not cover `o.mode`, throw `WorkkitError('MODE_MISMATCH', `open effort on ${label} is in ${open.mode} mode; run \`work promote --area ${o.area}${o.task ? ` --task ${o.task}` : ''} --mode fullstack\` to upgrade it`)`.
3. **Late story attachment:** If `o.story` is passed and no `storybook` lease for `o.story` exists on the effort, boot `ctx.storybrokr.up(o.story, hostRoot)` and record the `storybook` lease on the effort.
4. **Participant registration:** Add `ctx.owner` to `open.participants` (if not already `open.owner` or in `open.participants` by `session + pid`), touch all leases, and return `{ effort, leases, joined: true, ... }`.

### 5.3 In-Place Mode Promotion (`work promote` / `work_promote`)

```ts
export interface PromoteOptions {
  area: string;
  task?: string;
  mode: 'backend' | 'fullstack';
  story?: string;
}
```
1. Look up the open effort for `(area, task)` (refuse `EFFORT_NOT_FOUND` if none).
2. Compute `nextScopes = expandScopes(m, area, targetMode)` (or union with existing scopes if task-narrowed).
3. Inside `ctx.registry.update(...)`: verify no other open effort's `scopes` overlap `nextScopes` (`SCOPE_CONFLICT`); update `effort.mode = targetMode` and `effort.scopes = nextScopes`.
4. If the effort does not hold a `slot` lease: allocate a free slot (probing `busyPorts`), emit `.slot` and the env file via `emitWorktreeConfig`.
5. Filter `m.services` to services enabled for `targetMode` (`serviceModes(name, spec).includes(targetMode)`) that are not already running in `slotLease.pids`. Start only those newly required services via `ctx.runner.start`, merging the new `pids` and `signatures` into the slot lease.

### 5.4 Finishing & Converging Efforts (`work finish`)

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
2. **Participant check:** If `!o.force` and `effort.participants?.length`:
   - Remove the current caller (`ctx.owner.session`) from `effort.participants` (or promote `participants[0]` to `effort.owner` if the caller was `owner`), touch the effort, and return `{ effort, pushed: false, parked: false, left: true, notices: 0 }` without stopping services.
3. **Dirty check / `--park`:** Same as Phase 1 (`DIRTY_WORKTREE` unless `o.park`, which commits `wip(<label>): parked <iso>`).
4. **Convergence (`o.task` vs `o.intoArea`):**
   - If `o.intoArea`:
     - Require `o.task` (refuse `INVALID_ARGS` if `--into-area` is passed without `--task`).
     - Ensure the parent area worktree (`<worktreeRoot>/<area>`) exists on `<type>/<area>` and is clean (`DIRTY_WORKTREE` if dirty).
     - In the area worktree, merge the task branch (`git merge --no-edit <effort.branch>`). If the merge conflicts, abort the merge in the area worktree (`git merge --abort`) and throw `SYNC_CONFLICT` **before** stopping task leases or removing the task worktree.
   - Else:
     - Push `effort.branch` to `origin` (`g.push(effort.branch)`).
5. **Teardown & Ephemeral Task Cleanup:**
   - Release all leases held by the effort (stopping only recorded service PIDs / Storybook instances).
   - Leave `commons` notices if `commonsTouched` is non-empty.
   - If `effort.task`:
     - Archive `m.archive.paths` into `.slot-archive/<area>--<task>/<stamp>/`.
     - Remove the ephemeral task worktree (`main.worktreeRemove(effort.worktree)`).
     - If `o.intoArea`, delete the local merged task branch (`main.deleteLocalBranch(effort.branch)`).
     - Remove the finished task effort record from the registry (or mark `finished`).

---

## 6. CLI, MCP, and Error Codes

### 6.1 CLI Changes (`src/commands/`)
- `work start`: add `--task <slug>`, `--scope <glob>...` (repeatable), and widen `--mode <frontend|backend|fullstack>`.
- `work promote`: new command `work promote --area <area> [--task <slug>] --mode <backend|fullstack> [--story <path>] [--json]`.
- `work finish`: add `--task <slug>`, `--into-area`, and `--force`.
- `work status` & `work env`: add `--task <slug>`.

### 6.2 MCP Changes (`src/mcp/server.ts`)
- Add optional `projectRoot?: string` to every MCP tool (`work_start`, `work_status`, `work_finish`, `work_promote`, `work_reap`, `work_audit`, `work_env`) so agents working across multiple repos or checkouts are never pinned to the stdio server's startup `cwd`.
- Update `work_start`, `work_status`, `work_finish`, `work_env` schemas with `task?`, `scopes?`, `intoArea?`, `force?`, and `mode: 'frontend' | 'backend' | 'fullstack'`.
- Register new tool `work_promote`.

### 6.3 New Refusal Codes (Exit Code 2)
- `TASK_INVALID`: task slug does not match `/^[a-z0-9][a-z0-9_-]{0,47}$/` or contains `--`.
- `SCOPE_REQUIRES_TASK`: `--scope` was passed without `--task`.
- `SCOPE_OUTSIDE_AREA`: a `--scope` glob is not a subset of the area's expanded mode scopes.
- `MODE_MISMATCH`: `--join` requested a mode not covered by the open effort, or `promote` requested a downgrade.

---

## 7. Testing Plan

1. **Scope & Overlap Unit Tests (`src/core/scopes.test.ts`):**
   - `expandScopes` for `frontend`, `backend`, and `fullstack` modes.
   - `globsOverlap` returns `false` for `app-service/modules/school/**` vs `app-service/modules/schoolscandidates/**`.
   - `globsOverlap` returns `false` for `db/migration/*registration_students*` vs `db/migration/*team*`, and `true` for identical or wildcard-containing migration globs.
   - `--scope` subset validation accepts `app/org/applications/SearchInput/**` under `app/{group}/{section}/**` and rejects `app/org/team/**` with `SCOPE_OUTSIDE_AREA`.
2. **Worktree-Bound Guard Tests (`src/core/guards.test.ts`):**
   - Two efforts with identical `owner.session` (`user@host`) in different worktrees: committing a file under a `commons` lease held by Worktree A from Worktree B is **refused**; committing from Worktree A is allowed.
   - Committing a file in Worktree B that matches Worktree A's active `scopes` is **refused** by `checkCommit`.
3. **Service Mode & Promotion Tests (`src/core/runner.test.ts`, `src/lib/effort.test.ts`):**
   - `--mode backend` starts only `postgres` and `backend` (`frontend` is not spawned).
   - `promoteEffort` from `backend` to `fullstack` keeps existing `postgres`/`backend` PIDs untouched and spawns only `frontend`.
   - `promoteEffort` from `frontend` to `fullstack` allocates a slot lease and starts `postgres`, `backend`, and `frontend`.
4. **Intra-Area Wave & Lifecycle Tests (`src/lib/effort.test.ts`, `tests/e2e/lifecycle.test.ts`):**
   - Cold worktree executes `manifest.seed` (and fallback full `refresh`) on first `worktreeAdd`.
   - Parallel wave on one area: start `(org/applications, task: api, mode: backend)` + `(org/applications, task: search-input, mode: frontend, scope: ...)` + `(org/applications, task: user-card, mode: frontend, scope: ...)` concurrently; `finish --into-area` merges all three into `feature/org/applications` and removes `_tasks/*` worktrees.
   - Reference-counted `--join`: Agent B joins Agent A's effort; Agent B calling `work finish` leaves the effort and services running; Agent A calling `work finish` stops services and pushes.
   - Squash-merge recovery: simulate a squash-merge of `feature/org/team` onto `origin/develop`; verify `work start --area org/team --type fix` resets and switches cleanly without `EFFORT_OPEN`.
   - Single `git fetch`: verify `statusFor` across multiple areas invokes `git fetch` once on `repoRoot`.

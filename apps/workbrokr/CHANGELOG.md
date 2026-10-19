# @helmsmith/workbrokr

## 0.2.1

### Patch Changes

- The remaining workbrokr findings of the 2026-10-18 tooling review (W2–W14; helmsmith `docs/superpowers/specs/2026-10-18-work-tooling-review.md` §3.1a), each with a test that failed first: `finish` pushes before it stops or releases anything; reap parks a start that died before its first lease; the pre-commit hook no longer refuses the commit that resolves a sync conflict; port probes see wildcard listeners; `work start` reaps expired leases first; `PORT_STORYBOOK` keeps the storybrokr instance port; tasks of one area share its commons; `promote` claims its slot before changing mode; an owed `db-reset` is kept until a start with a database runs it; `retire` refuses before touching Storybook; `finish --into-area` targets the area branch that exists; registry lock timings; port ranges re-checked on every command; the storybrokr sweep skips backend efforts and passes `--if-running` (needs storybrokr 0.3.0).

## 0.2.0

### Minor Changes

- fbade8e, 8b74d26, eb5ef4d: Task waves and mode promotion. `work start --task <slug>` opens a task sub-effort in `_tasks/<area>--<task>` on `<type>/<area>--<task>`; `work finish --into-area` merges it into the area branch; `work promote` moves a frontend or backend effort to fullstack in place. New `backend` mode, task and scope types in the manifest schema, and a `@helmsmith/workbrokr/core` export.
- 0a8f43f, 90948a3: Segment-aware scope overlap, backend and shared scopes, `--scope` narrowing; commit guards bound to the worktree that made the commit, scope locks enforced by the hook, and chaining into a project's existing git hooks.
- 753ec3e, 315f1b6: Hash-stamped refresh steps that restore a lockfile only when it was clean before the install, a squash-merge equivalence check so a merged area restarts from the base, a mode-filtered service runner and task-aware registry queries.
- 8df02fd: Spec 2 alignment with storybrokr 0.3.0. `STORYBROKR_HOST` is emitted in `.env.slot`, `work env` and templates; storybook instances get the lease's TTL; `finish`, `reap` and `retire` bring the worktree's instances down. Frontend `work start` now requires `storybrokr` 0.3.0 or newer.

### Patch Changes

- 8716373: `repairSubmodules` no longer runs `git checkout -f` against the main checkout's submodules. It clones each submodule locally from the main checkout's module directory into the worktree's own module directory and re-syncs the URL, replacing both the stale gitfile `git worktree add` leaves and the borrowed gitfile earlier versions wrote. Failed repairs are logged instead of swallowed.
- 271f560: Submodule names from `.gitmodules` that would escape `<git-dir>/modules` or break a git config key are refused.

## 0.1.0

### Minor Changes

- 71bb46a: First release of `@helmsmith/workbrokr`. Its core (lease registry with atomic writes and a lock, per-project port ranges, slot allocation, manifest loading and validation, scope expansion and overlap, git operations, protected-branch and commons guards, hook installer, per-worktree config emitter, refresh runner, service runner with health polling and pid-scoped stop) is internal to the package. It ships the `work` CLI, MCP server and skill: `init`, `start`, `status`, `env`, `finish`, `reap`, `retire`, `audit`, `hook`, `hooks install`, `mcp`. One worktree per area, `<type>/<area>` branches, every effort synced from the base branch first, frontend work through storybrokr, fullstack work through the manifest's own commands.

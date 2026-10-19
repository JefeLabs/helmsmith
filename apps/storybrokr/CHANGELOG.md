# @helmsmith/storybrokr

## 0.3.0

### Minor Changes

- Spec 2 (worktree isolation): realpath host identity, `--host` on every verb, `STORYBROKR_HOST`, `Registry.resolve` scoping with `INSTANCE_AMBIGUOUS`, `down --host` / `downByHost`, orphan reaping when a host disappears, root-first story discovery with `--include-children`, `--concurrency` for `check` with one browser context per worker, instance cap 10.
- `down --if-running`: do nothing, and start no daemon, when none is listening.

### Patch Changes

- The thirteen storybrokr findings of the 2026-10-18 tooling review (S1–S13; helmsmith `docs/superpowers/specs/2026-10-18-work-tooling-review.md` §4.1a), each with a test that failed first: `down --all --host` scoped to the host; `up` honours `STORYBROKR_HOST`; a repeat `up` applies an explicit TTL; Storybook children log to a file and survive the daemon's exit; adoption after a daemon restart (dead processes dropped, mid-boot instances watched to ready); reconcile under the daemon lock; wildcard-aware port probe; leaf-file discovery no longer takes a sibling component's stories; per-instance locking between `up` and `stop`; legacy `includeChildren` default; flag-only flips keep the instance; `down` never falls through to another worktree; canonical paths for deleted worktrees; a failed check worker stops the others; `checkConcurrency` range-checked.

## 0.2.0

### Minor Changes

- 380b0c7: `check` and `screenshot` (CLI + MCP): run stories headlessly with pass/fail per story, and write a PNG of one story at a chosen viewport. Adds a `playwright` dependency; Chromium is fetched lazily on first use. New config key `browserIdleMinutes`.

## 0.1.0

### Minor Changes

- 89614cf: Initial release: broker ephemeral single-component Storybook instances from an existing host Storybook — daemon, CLI, and MCP server.

---
name: work
description: Start, run, finish and audit area-based work with `work` (@helmsmith/workbrokr). Fires when the user wants to begin an effort on a part of the application ("start work on applications", "new effort on org/team", "open the cart area"), needs a slot or a running stack for a worktree, asks which slot or worktree to use, wants to open the effort's pull request, wants to finish or park an effort, or asks to clean up, retire or audit worktrees and slots. One worktree per area, branches are <type>/<area>, every effort starts from the latest base branch, no work ever happens on develop. Also resets a slot's database on request. CLI (`work start|promote|status|pr|reset|finish|reap|retire|audit|env`) and MCP tools (`work_start`, `work_promote`, `work_status`, `work_pr`, `work_reset`, `work_finish`, `work_reap`, `work_audit`, `work_env`).
---

# work

> The whole arc, from `work start` through tasks, `work pr`, `finish` and `retire`, with storybrokr and pritty's parts: [The life of a worktree](https://github.com/JefeLabs/helmsmith/blob/main/docs/work-lifecycle.md).

`work` owns the lifecycle of a piece of work in a repo that has a `helmsmith.config.{ts,mjs,json}`: it creates or reuses the **area's** worktree on a `<type>/<area>` branch, syncs it from the base branch, refreshes it, leases what the mode needs (a **slot** for `fullstack`, a storybrokr instance for `frontend`), writes the per-worktree config, runs it, and later finishes, expires, retires and audits it. State lives in one registry under `~/.cache/helmsmith`.

## Rules an agent applies before calling it

- **Never commit on the base branch** (`develop` here) or on `stage`/`prod`: the hooks refuse, and the main checkout is a mirror. Work only inside the worktree `work start` prints.
- **Pick the area from the manifest** (`work status --json` lists them). Areas are leaves like `org/applications`; the branch becomes `feature|chore|fix/<area>`.
- **Pick the type by intent** (`feature` new behaviour, `fix` a defect, `chore` tooling/docs) and **the mode by what you must run**: `fullstack` when the backend or database is involved, `frontend` when a scoped Storybook is enough (add `--story <path>` to boot one).
- **Read refusals, do not bypass them.** Exit code 2 is a rule saying no; the first stderr line (or the JSON `code`) says which:
  - `EFFORT_OPEN`: someone holds this area (the message names the session). Ask, wait, or `--join` to work in the same checkout on purpose.
  - `SCOPE_CONFLICT`: another effort holds overlapping paths. Pick another area or wait for it to finish.
  - `SYNC_CONFLICT`: the merge from the base branch conflicts. Resolve it in the worktree the message names, commit, rerun with `--no-sync`.
  - `DIRTY_WORKTREE` on finish: commit, or `work finish --park` to commit as `wip(<area>)` and push.
  - `COMMONS_LOCKED` at commit time: a cross-cutting effort owns that shared code for a few hours; wait or coordinate.
- **Subagents** spawned from the worktree work inside the same effort (same branch, same leases, same session). They must not create their own git worktrees (no `isolation: "worktree"`); a subagent that needs its own stack starts its own effort with `work start` or joins this one with `--join`.
- **Never run the project's tools from outside the worktree** and never bypass `make`/`work` to reach a port directly: slot 0's ports belong to the human.

## The loop

1. `work status --json` → what is open, by whom, and which areas exist.
2. `work start --area <area> [--task <slug>] --type <type> --mode <fullstack|backend|frontend> [--scopes <glob>...] [--story <path>] --json` → the effort record, the worktree path, the leases (ports under `leases[].ports`). `cd` into `effort.worktree`.
3. Work there. `work env --area <area>` prints `PORT_*`, `SLOT`, `LOG_DIR`, `STORYBROKR_HOST`, `MODE` when a tool needs them (also written to `.env.slot`). Service logs are in `<worktree>/.logs/<service>.log`. When the slot's database is polluted (a failed run, old data), `work reset --area <area>` stops the app services, recreates the database, starts them again and seeds; `work start --reset-db` does the same before a fullstack start. A migration landing on the base branch triggers the reset on its own.
4. `work finish --area <area> [--task <slug>] [--into-area]` (or `--park`) when done: the runner stops, leases and any worktree `storybrokr` instances are released, the branch is pushed (or merged into the parent area branch with `--into-area`); area worktrees stay, task worktrees are cleaned up. Open the PR from the branch.
5. `work retire --area <area>` only when an area is being removed for good (archives evidence first; refuses unpushed work).
6. `work reap` expires idle leases; `work audit --json` lists unsaved or unpushed work, stray worktrees, aging leases, drift and stale notices.

## Commands

| Command | Purpose |
|---|---|
| `work init --project <name> --service name=port… [--base-branch b] [--storybook-host dir] [--no-hooks] [--force]` | Write a starter manifest, claim the port ranges, install the hooks |
| `work hooks install [--project-root dir]` | Install the hooks in a clone whose manifest already exists |
| `work start --area a [--task slug] --type t --mode m [--scopes g...] [--story p] [--join] [--no-sync] [--reset-db] [--json]` | Begin (or join) an effort; `--reset-db` recreates the slot database first |
| `work promote --area a [--task slug] --mode <backend\|fullstack> [--json]` | Promote an open effort's mode and lease a slot |
| `work reset --area a [--task slug] [--json]` | Fresh database for an open fullstack/backend effort: stop app services, `postgres.reset`, start, `postgres.seed` |
| `work status [--area a] [--task slug] [--json]` | Efforts, leases, drift, notices |
| `work env (--area a [--task slug] \| --slot n) [--json]` | Slot-derived variables (`SLOT`, `PORT_*`, `LOG_DIR`, `STORYBROKR_HOST`, `MODE`) |
| `work finish --area a [--task slug] [--into-area] [--park] [--force] [--json]` | Stop, release, push (or merge task into area) |
| `work reap [--dry-run] [--json]` | Expire idle leases |
| `work retire --area a [--json]` | Archive and remove an area's worktree, and drop the database of the slot it last used if that slot is free (destructive) |
| `work audit [--json]` | What would otherwise be forgotten |
| `work mcp` | MCP stdio server |

Every command takes `--project-root <dir>`; without it the repo is the main checkout of the current directory. Exit codes: 0 ok, 2 refused, 1 error.

## MCP tools

`work_start { area, task?, type, mode, scopes?, story?, join?, sync?, resetDb? }`, `work_promote { area, task?, mode }`, `work_status { area?, task? }`, `work_reset { area, task? }`, `work_finish { area, task?, intoArea?, park?, force? }`, `work_reap { dryRun? }`, `work_audit {}`, `work_env { area, task? }`. Results are the same JSON the CLI's `--json` prints; failures set `isError` with `{ code, message, details? }`.

## Error codes

Refusals (exit 2): `MANIFEST_INVALID`, `AREA_UNKNOWN`, `TYPE_UNKNOWN`, `MODE_UNKNOWN`, `MAIN_CHECKOUT`, `PROTECTED_BRANCH`, `EFFORT_OPEN`, `EFFORT_NOT_FOUND`, `SCOPE_CONFLICT`, `COMMONS_LOCKED`, `NO_FREE_SLOT`, `LEASE_NOT_FOUND`, `PORT_RANGE_TAKEN`, `SYNC_CONFLICT`, `DIRTY_WORKTREE`, `UNPUSHED`. Faults (exit 1): `MANIFEST_NOT_FOUND`, `HEALTH_TIMEOUT` (the last probe output is attached), `SERVICE_FAILED`, `STORYBROKR_FAILED`, `GIT_FAILED`, `INTERNAL`.

## Opening the pull request: `work pr`

After the last commit on an effort, open its PR with the words you already know:

```bash
work pr <area> --title "feat(area): what changed" --body-file /tmp/pr-body.md   # --task <slug> for a task effort; --draft for a draft
```

`work pr` pushes the branch first, then opens the PR through `pritty pr --no-push --auto-approve --json` against the manifest's base branch, and stores `{ number, url, draft }` on the effort (`work status` shows it). Run it again and it returns the same PR; pass `--title`/`--body-file` again to update the PR's words in place. If the stored PR was merged or closed it refuses with `PR_CLOSED`; `--force` opens a new one. Write the body in the repository's PR conventions; the attribution footer comes from pritty's `prFooter`, not from you. Always pass a title and a body: pritty's AI path is the fallback, never the default. Needs `@helmsmith/pritty` 0.1.1 or newer on PATH.

`--story` takes a path relative to the manifest's Storybook host (`app-ui` in skoolscout): a folder, a story or module file, or a bare stem such as `components/discover-schools/dashboards/charts/ChartSkeleton` (storybrokr 0.3.1 or newer resolves a stem to its file).

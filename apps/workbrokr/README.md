# @helmsmith/workbrokr

`work` starts, runs, finishes, expires, retires and audits **area-based work**: one git worktree per area of the application, branches named `<type>/<area>`, every effort synced from the latest base branch before it begins, slots and ports handed out by one machine-wide registry, a scoped Storybook (via [`@helmsmith/storybrokr`](../storybrokr)) for frontend work and the project's own stack for full-stack work. It is a CLI, an MCP server and a skill over the same functions, built on [`@helmsmith/workkit`](../../platform/core/workkit-lib).

It exists because creating worktrees and stacks was easy and nothing ever closed the loop: dozens of merged worktrees, slots claimed by several checkouts, stacks running unattended for days, work that lived only on one machine, and a stray command that dialled the human's database. `work` makes finishing, expiring and auditing as cheap as starting, and turns the rules that used to live in memory notes into refusals.

## Install

```bash
npm i -g @helmsmith/workbrokr      # provides `work` and `workbrokr`
npm i -g @helmsmith/storybrokr     # only for --mode frontend
```

Node 24 or newer. Manifests may be TypeScript (`helmsmith.config.ts`), ESM (`.mjs`) or JSON.

## Set a project up

```bash
cd <repo>
work init --project my-app --base-branch develop \
  --service frontend=3000 --service backend=8443 --service postgres=5432 \
  --storybook-host app-ui
```

This writes `helmsmith.config.mjs` (edit the service commands, the scope templates, the areas and the commons), claims the project's port ranges in the registry so two projects on one machine never collide, and installs the git hooks under `.helmsmith/hooks` (commit them; each clone runs `work hooks install` once to point `core.hooksPath` at them).

## Manifest reference

| Key | Meaning |
|---|---|
| `project` | lowercase name; the registry key |
| `baseBranch`, `protectedBranches` | efforts start from and sync with the base; commits on protected branches are refused (default: the base only) |
| `worktreeRoot` | where area worktrees live (`.claude/worktrees`); each area at `<root>/<area>` |
| `branch.types` | allowed branch types (`feature`, `chore`, `fix`) |
| `slots.count`, `slots.reserved` | how many slots; reserved ones (slot 0, the human's) are never leased |
| `ports.services.<name>.base` | the slot-0 port of each service; slot N uses `base + N`; the project claims `[base, base + count)` |
| `services.<name>.{start,stop,health,healthyCodes,reset,healthTimeoutMs}` | shell commands run in the worktree with `PORT_*`, `SLOT`, `LOG_DIR` in the environment; key order is start order; `health` is polled every second |
| `storybook.hostRoot` | the package whose `.storybook` storybrokr boots from |
| `logs.dir` | per-worktree log directory (`.logs`), one file per service plus `refresh.log` |
| `env.file`, `env.template` | the env file emitted per worktree from `${VAR}` placeholders (`SLOT`, `PORT_<SERVICE>`, `PORT_STORYBOOK`, `LOG_DIR`, `PROJECT`, `AREA`, `BRANCH`, `WORKTREE`) |
| `refresh[]` | `{ when: glob, run }` commands and `{ when, mark }` marks selected by the paths a sync changed; `{ always: true, run }` runs every time; the mark `db-reset` runs `services.postgres.reset` before a fullstack start |
| `scopes.frontend`, `scopes.backend` | glob templates with `{group}`, `{section}`, `{module}`; a frontend effort holds the first set, a fullstack effort both |
| `areas.<path>.{module,commons,extraScopes}` | leaves only (`shop/cart`, never `shop` and `shop/cart` together); `module` fills the backend templates; `commons` makes the area cross-cutting |
| `commons.<name>` | shared paths never held exclusively; a cross-cutting effort write-locks them briefly |
| `expiry.{slotHours,commonsHours,storybookHours}` | idle expiry per lease kind (12 / 4 / 2) |
| `archive.{paths,keepDays,keepPerArea}` | what `retire` copies out of the worktree into `.slot-archive/`, and for how long |

## Verbs

- `work start --area <area> --type <type> --mode <fullstack|frontend> [--story <path>] [--join] [--no-sync]`: guards (area, type, mode, one open effort per area, scope overlap), the worktree, the branch, sync (fast-forward or merge, never rebase; a conflict stops before any lease), refresh, leases, config, run, record.
- `work status`, `work env`: what is open and the variables it runs with.
- `work finish [--park]`: stop only the pids the lease recorded, bring the Storybook down, release leases, push, leave commons notices; the worktree and branch stay.
- `work reap [--dry-run]`: the same for expired leases, parking the effort.
- `work retire`: archive, remove the worktree, delete the local branches that are on origin. The only destructive verb; refuses unpushed work.
- `work audit`: dirty or unpushed worktrees, foreign checkouts, aging leases, drift, stale notices, archive size.

Exit codes: 0 ok, 2 refused (first stderr line is the reason; `--json` prints `{ code, message, details }`), 1 error. The registry is `$HELMSMITH_HOME/registry.json`, default `~/.cache/helmsmith`, written atomically under a lock.

## What this phase does not do yet

- Frontend mode does not lease a Storybook port: storybrokr allocates its own and the lease records the instance id and port.
- Impact notices are commons-based ("commons auth changed on fix/platform/auth"); an import-graph version is planned.
- The full-stack runner spawns the manifest's commands itself; `stackbrokr` (a daemon with the same manifest) replaces it in a later phase without changing the manifest.

## Security note

The hooks under `.helmsmith/hooks` are tracked files that run on every committer's machine, exactly like husky's. They are four fixed lines that `exec workbrokr hook <name>`; review changes to that directory as you would any executable.

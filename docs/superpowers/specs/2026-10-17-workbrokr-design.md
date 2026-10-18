# workbrokr — area-based work initiation, slots and lifecycle (design)

**Status:** approved in conversation 2026-10-17, written for planning.
**Home:** this monorepo. Package: `apps/workbrokr` publishes `@helmsmith/workbrokr` with bins `workbrokr` and `work`; the core described below as `workkit` lives inside it at `apps/workbrokr/src/core` (amendment 14: it was briefly a separate `@helmsmith/workkit` package, folded back on 2026-10-18 before its first publish). The first adopter is skoolscout-com, which holds the tooling being extracted (`slot.mk`, `stackbrokr.config.ts`, its `docs/superpowers/specs/2026-09-20-parallel-slots-design.md`); a copy of this spec sits there untracked.
**Owner's rules this design encodes:** no work is ever done on `develop`; one worktree per area; branch names are `<type>/<area>`; every effort starts from the latest `develop`; cross-cutting work never stops section work; impact notices are informational only.

---

## 1. Problem

Creating a stack is solved (`make worktree-new SLOT=auto` seeds a full stack reliably). Nothing closes the loop afterwards. The 2026-10-17 clean-up of skoolscout-com found: 40 worktrees, 34 already merged; six slots with two to four worktrees each; a stack running unattended for two days; two branches that existed only locally; two worktrees with weeks of uncommitted work; 78 abandoned cache worktrees; 270 merged local branches; 18 GB of evidence archives; and a direct `npx playwright test` that dialled the human's database because the slot rules live in environment variables.

Each of these is a lifecycle gap, not a tooling gap: nothing finishes, reaps or audits, and the rules that prevent collisions are conventions in memory notes rather than checks in a tool. The current tooling is also bound to one project: ports, service names and paths are constants in `slot.mk`, so a second project on the same machine collides with the first.

## 2. Goals and non-goals

**Goals**

1. One command starts a piece of work with everything it needs: the area's worktree on the right branch, synced to the latest base branch, refreshed, configured (ports, logs, Storybook), and running in the chosen mode.
2. The same tool finishes, expires and audits, so nothing is forgotten by default.
3. Collisions are checked, not remembered: resources (slots, ports, worktrees) are hard locks; code scopes are mode-aware locks; shared code is write-locked briefly and never blocks a start.
4. Project-agnostic core; everything project-specific lives in a manifest and behind the repo's own commands. A new project adopts by writing the manifest.
5. Agents are first-class users: CLI, MCP and a Claude skill share one implementation and one source of truth.

**Non-goals**

- Replacing CI, code review or promotion. Promotion stays a merge of branches through PRs.
- Rebasing or rewriting anyone's branch. Syncs are merges.
- Containerising the runners. Compose mode remains the repo's own option behind its make targets.
- Semantic merge-conflict prediction beyond path overlap.

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Manifest** | `helmsmith.config.ts` at a repo root: services, ports, commands, areas, scopes, protected branches. The only place a project describes itself. |
| **Area** | A leaf of the manifest's area tree, named by path (`discover-schools/applications`). Owns one worktree, forever. |
| **Effort** | One cycle of work on an area: starts on a `<type>/<area>` branch, ends in a PR. An area has at most one open effort. |
| **Type** | `feature`, `chore` or `fix`. Picks the branch. |
| **Mode** | `frontend` (scoped Storybook through storybrokr) or `fullstack` (a slot with the whole stack). Picks the leases and the lock scope. |
| **Work record** | The registry entry for an open effort: area, type, mode, worktree, branch, owner, leases, held scopes, timestamps, notices. |
| **Lease** | A time-bounded claim on a resource: a slot, a port block, a Storybook instance, a commons write lock. Expires on idle. |
| **Slot** | An integer that selects one full stack's ports and names inside a project's port block. Slot 0 is the human's and is never leased. |
| **Scope** | The set of path globs an effort holds exclusively, expanded from templates by area and mode. |
| **Commons** | Shared paths (auth, proxy, core components, infra) that are never held exclusively; a cross-cutting effort may write-lock them briefly. |
| **Base branch** | The branch efforts start from and sync with (`develop` here; from the manifest). |

## 4. Architecture

Three layers, one state store.

```
┌────────────────────────────────────────────────────────────────┐
│ consumers   work CLI · work MCP · Claude skill /work            │
├────────────────────────────────────────────────────────────────┤
│ brokers     workbrokr (this)   stackbrokr (phase 2)   storybrokr│
├────────────────────────────────────────────────────────────────┤
│ core        @helmsmith/workkit: registry · leases · worktree ops│
│             manifest · scopes · config emitter · hooks          │
├────────────────────────────────────────────────────────────────┤
│ state       ~/.cache/helmsmith/registry.json (+ per-entry locks)│
└────────────────────────────────────────────────────────────────┘
```

- **`@helmsmith/workkit`** (directory `platform/core/workkit-lib`, exports TS source like the other shared libs) holds everything more than one broker needs: the lease registry with idle expiry, port-block allocation, worktree and branch operations, manifest loading and validation, scope expansion and overlap checks, the per-worktree config emitter, git hook installation, and the refresh-hook runner. It knows nothing about any project.
- **`workbrokr`** (`work` on the command line) is the orchestrator: `init`, `start`, `status`, `finish`, `reap`, `retire`, `audit`. It takes leases from core and delegates running to a runner.
- **Runners.** `frontend` mode calls `storybrokr up/down` (unchanged interface). `fullstack` mode calls the manifest's service commands in phase 1 (the repo's make targets, exactly as today) and `stackbrokr` in phase 2. `work` never embeds a project's start logic.
- **storybrokr** migrates its instance registry onto core's leases in phase 3 so one reaper and one `status` cover everything; its CLI and MCP surface do not change.

Why not one daemon for everything: storybrokr works and boots in seconds; coupling it to the stack machinery buys nothing. Why not an orchestrator over fully independent brokers: three registries that disagree about what is running is today's problem moved up one level. Shared core, thin brokers is the only shape where `finish` and `reap` mean one thing and ports come from one place.

## 5. Project setup: `work init`

Run once per repo. Interviews (or takes flags) and writes `helmsmith.config.ts`, installs git hooks, claims the project's port block.

### 5.1 Manifest

```ts
export default {
  project: "skoolscout-com",
  baseBranch: "develop",
  protectedBranches: ["develop", "stage", "prod"],
  worktreeRoot: ".claude/worktrees",
  branch: { types: ["feature", "chore", "fix"] },      // branch = `${type}/${area}`

  slots: { count: 10, reserved: [0] },                 // slot 0 = the human's stack
  ports: {
    block: { base: 3000, width: 100 },                 // claimed by `work init`, recorded here
    services: {                                        // slot-0 port of each service
      frontend:  { base: 3000 },
      backend:   { base: 8443 },
      postgres:  { base: 5432 },
      storybook: { base: 6100 },
    },
  },

  services: {                                          // what fullstack mode runs (phase 1 = make)
    postgres: { start: "make -C app-service db-up",   stop: "make -C app-service db-down",
                health: "pg_isready -h localhost -p ${PORT_POSTGRES}", reset: "make -C app-service db-reset" },
    backend:  { start: "make -C app-service dev",     stop: "make -C app-service dev-stop",
                health: "curl -sk -H 'Host: ${TENANT_HOST}' https://localhost:${PORT_BACKEND}/api/mtauth/v1/public/tenant-by-host" },
    frontend: { start: "make -C app-ui dev-e2e",      stop: "make -C app-ui dev-stop",
                health: "curl -sk -o /dev/null -w '%{http_code}' https://${TENANT_HOST}:${PORT_FRONTEND}/auth/sign-in", healthyCodes: [200, 307] },
  },
  storybook: { hostRoot: "app-ui" },
  logs: { dir: ".logs" },

  env: {                                               // emitted per worktree at `work start`
    file: ".env.slot",
    template: { SLOT: "${SLOT}", PORT_FRONTEND: "${PORT_FRONTEND}", PORT_BACKEND: "${PORT_BACKEND}",
                PORT_POSTGRES: "${PORT_POSTGRES}", PORT_STORYBOOK: "${PORT_STORYBOOK}", LOG_DIR: "${LOG_DIR}" },
  },

  refresh: [                                           // run after a sync, keyed on changed paths
    { when: "app-ui/package-lock.json",             run: "make -C app-ui install" },
    { when: "app-test-e2e-runner/package-lock.json", run: "make -C app-test-e2e-runner install" },
    { when: "app-service/pom.xml",                   run: "make -C app-service install" },
    { when: "app-service/src/main/resources/db/**",  mark: "db-reset" },
    { when: "app-ui/.storybook/**",                  run: "make -C app-ui storybook-css" },
    { always: true,                                  run: "rm -f app-test-e2e-runner/.e2e-cache/auth/*.json" },
  ],

  scopes:  { /* §7.1 */ },
  areas:   { /* §6.1 */ },
  commons: { /* §7.3 */ },
};
```

Validation at load: every template variable resolves, every area is a leaf, no two areas share a worktree path, every `when` glob is syntactically valid, the port block holds `slots.count` × services.

### 5.2 Machine-wide port plan

Ports are **allocated by the registry, never computed by the project**. `work init` claims the next free block (default 100 ports wide, starting at the project's existing slot-0 base so the human's numbers do not change) and records it in the manifest; slots are carved inside the block as `base + N` per service, exactly today's formula but per project. Two projects on one machine therefore never share a port, and a fresh machine replays the plan from the manifests. A second checkout of the same project claims a second block under a distinct `project` name.

### 5.3 Hooks

`work init` installs `pre-commit` and `pre-push` hooks in the repo (and `core.hooksPath` so worktrees share them):

- refuse a commit or push on any `protectedBranches` entry (no work on develop, ever, even by hand);
- refuse a commit that writes under a commons path currently write-locked by another effort (§7.3), naming the owner;
- warn (push continues) when the changed paths leave the effort's held scope (§7.2), listing them.

## 6. Areas, worktrees, branches

### 6.1 The area tree

```ts
areas: {
  "discover-schools/applications": { module: "registration_students" },
  "discover-schools/team":         { module: "team" },
  "discover-schools/messaging":    { module: "messaging" },
  "platform/auth":                 { commons: ["auth"] },        // a cross-cutting area
}
```

- **Leaves only.** `discover-schools` is a grouping node, never an area. Git refs are a directory tree, so `feature/discover-schools` and `feature/discover-schools/applications` cannot coexist; and the worktree path mirrors the area. Work that spans a group gets its own leaf (`discover-schools/shell`).
- **One worktree per area, forever**, at `${worktreeRoot}/${area}`. Created on the first `work start`, reused by every later effort, removed only by `work retire`.
- **Per-area metadata** carries what templates cannot derive: the backend `module`, extra paths, or the commons an area owns.

### 6.2 Branches

`branch = <type>/<area>`, type from the manifest's list (`feature | chore | fix`). The worktree checks out whichever type the effort declares; switching type between efforts is a checkout in the same worktree. A branch is created from fresh `origin/<baseBranch>` the first time it is needed and lives on afterwards; a new PR is opened from it for every effort.

**One open effort per area.** Starting a `fix` while `feature/<area>` holds commits not yet on the base branch is refused: ship or finish the feature first, or `--join` it. This is what keeps half-done work from being stranded on a branch nobody is watching.

**Renewal.** A long-lived branch accumulates merges from the base. When that bothers anyone, `work retire` then `work start` recreates it; the area name and path do not change, so nothing downstream notices.

### 6.3 Protected branches and the main checkout

The main checkout is a mirror. `work start` refuses to run in it and refuses any branch equal to the base branch. The tool's only writes there are `git fetch` and a fast-forward of the base branch, so the human's slot 0 always runs the shipped state. The hooks (§5.3) enforce the same rule for hand-made commits in any checkout.

## 7. Locks

### 7.1 Scope templates

```ts
scopes: {
  frontend: [
    "app-ui/app/{group}/{section}/**",
    "app-ui/components/{group}/{section}/**",
    "app-ui/app/api/{section}/**",
  ],
  backend: [
    "app-service/src/main/java/com/skoolscout/app/api/{module}/**",
    "app-service/src/main/java/com/skoolscout/app/modules/{module}/**",
    "app-service/src/main/resources/db/migration/*{module}*",
  ],
}
```

`{group}` and `{section}` come from the area path; `{module}` from the area's metadata. A `frontend` effort holds the expanded `frontend` set; a `fullstack` effort holds `frontend` + `backend`. The expanded globs are stored on the work record so `status` shows exactly what is held.

### 7.2 Section locks (hard)

Two active efforts conflict when their held sets overlap. `work start` refuses, printing the overlapping globs and the owning session. Two frontend efforts on different sections share nothing and run side by side; a fullstack effort on `applications` blocks a frontend effort on `applications`.

Resources are hard locks independent of scope: a slot, a Storybook port, a worktree. The registry is the single allocator, so two brokers cannot hand out the same port.

A push whose changed paths leave the held set is a **warning**, not a refusal (`--force` to silence): it usually means a template needs a line, not that the work is wrong.

### 7.3 Commons (write locks, short)

```ts
commons: {
  auth:  ["app-ui/app/api/auth/**", "app-service/src/main/java/com/skoolscout/app/mtauth/**"],
  proxy: ["app-ui/app/api/proxy/**", "app-ui/proxy.ts"],
  core:  ["app-ui/components/core/**", "app-ui/app/globals.css"],
  infra: [".infra/**", ".github/**"],
}
```

- Commons are never held exclusively by a section effort; touching them is allowed and reported (hook warning, `audit`).
- A **cross-cutting effort** (an area whose metadata names commons) takes a **write lock** on those sets: other efforts keep starting and running; only a commit that modifies a locked path is refused by the hook, with the owner named, until the lock is released.
- Commons leases are **short** (default idle expiry 4 h, versus 12 h for slots) and always visible in `work status` with owner and age. Needing longer is a signal to split the effort.
- At start, a cross-cutting effort prints the active efforts that already have commits under the paths it is about to lock, so the owner can coordinate or wait for a merge.
- No global freeze, ever; no automatic rebase of section branches onto a merged commons change.

### 7.4 Impact notices (informational)

When an effort that touched `commons.core` (or any path with dependents) finishes, `work` computes dependents from the import graph (a TypeScript references walk, cached) and attaches a notice to each area that imports a changed module: `core Button changed in #5440 — re-verify your stories`. Notices appear in `work status` and `work start` for the affected area and in `work audit`. They never block anything.

## 8. Effort lifecycle

### 8.1 `work start --area <area> --type <type> --mode <frontend|fullstack> [--join] [--no-sync]`

Ordered, fail-stop; no lease is taken until step 6.

1. **Guards.** Not the main checkout; area is a leaf; type is allowed; no other open effort on the area (or `--join` names it); no scope overlap with active efforts (§7.2); for a cross-cutting area, print the efforts with commits under its commons.
2. **Worktree.** Create `${worktreeRoot}/${area}` if missing (seed per manifest); otherwise reuse.
3. **Branch.** Checkout `<type>/<area>`, creating it from `origin/<baseBranch>` if missing.
4. **Sync** (skipped only with `--no-sync`): `git fetch origin <baseBranch>`; fast-forward when the branch has no own commits since the last merge, otherwise `git merge origin/<baseBranch>`. A conflict stops here with the conflict handed to the caller. Never a rebase.
5. **Refresh.** Run the manifest's `refresh` entries whose `when` globs match paths the sync changed (`always` entries run every time). `mark: db-reset` flags the slot database for reset at stack start.
6. **Lease.** `fullstack`: the lowest free slot in the project's block (never a reserved one), atomically. `frontend`: a Storybook port. Both idle-expiring.
7. **Config.** Emit the `.slot` marker, the env file from the template, the log directory, the Storybook port. Nothing is written to git.
8. **Run.** `fullstack`: start services in manifest order, wait on each health command (honouring `healthyCodes`), reset the database first if marked. `frontend`: `storybrokr up` for the story or component given (or none yet; the lease is held for later).
9. **Record.** Write the work record (§9.1) and print `work status` for the area.

### 8.2 `work status [--area <area>] [--json]`

Per area: open effort (type, mode, branch, owner session, started, last activity), leases with age and expiry, held scopes, write-locked commons, pending impact notices, sync state (commits behind the base branch). Machine-wide: every lease and its owner, which is today's `make slot-status` with real owners instead of inferred ones.

### 8.3 `work finish [--area <area>]`

Stops the runner (`storybrokr down`, or the service stop commands in reverse order), releases every lease held by the effort, pushes the branch (so nothing lives only locally), computes impact notices if commons changed, and closes the work record. The worktree and branch remain. Refuses if the worktree has uncommitted changes unless `--park` is given, which commits them as `wip(<area>): parked <date>` and pushes.

### 8.4 `work reap [--dry-run]`

Expires idle leases: stops the runner behind each (never a process the registry did not start), releases slots and ports, and marks the effort `parked` with the reason. Runs from a launchd timer and as a pre-flight inside `work start`. Defaults: slots 12 h idle, commons 4 h, Storybook 2 h; per-project override in the manifest. Idle is measured from the last registry touch (the runner's health poll, a `status` call, or a push through the hook).

### 8.5 `work retire --area <area>`

The only destructive verb. Refuses while an effort is open or the branch has unpushed commits; otherwise archives evidence (per manifest, e.g. the runner's `test-results`, `.maturity`, trace logs) under `.slot-archive/<area>-<UTC>/` with a retention rule (default keep 30 days or last 5 per area), removes the worktree, deletes the local branch (never the remote), releases the area's registry entry.

### 8.6 `work audit [--json]`

The weekly list of what would otherwise be forgotten: areas with uncommitted or unpushed work and their age; worktrees whose branch is not a `<type>/<area>` branch (detached, `tmp/`, by-hand checkouts); leases past half their expiry; areas behind the base branch by more than N commits; branches whose last diff left their scope; pending impact notices older than a week; archive size against retention. Optionally parks (as in `finish --park`) anything dirty older than a threshold.

### 8.7 `work pr [--area <area>] [--task <slug>] [--draft] [--title <t>] [--body-file <f>] [--json]`

Opens (or reports) the pull request for the effort's branch against the manifest's base branch, through pritty (§18). Pushes first if the branch is not on origin, refuses a dirty worktree, and records `{ number, url, draft }` on the effort so `status` shows it. Running it twice returns the open PR instead of creating a second one. Added by amendment A, 2026-10-18.

## 9. Registry

### 9.1 Location and shape

`~/.cache/helmsmith/registry.json`, written atomically (temp file + rename) under a directory lock; one file per machine, small (hundreds of entries at most).

```jsonc
{
  "projects": { "skoolscout-com": { "root": "/…/skoolscout-com", "block": { "base": 3000, "width": 100 } } },
  "leases": [
    { "id": "lease_…", "project": "skoolscout-com", "kind": "slot", "value": 5,
      "ports": { "frontend": 3005, "backend": 8448, "postgres": 5437 },
      "owner": { "session": "automations-7a", "pid": 59103 }, "effort": "eff_…",
      "created": "…", "touched": "…", "expires": "…" },
    { "kind": "storybook", "value": 6103, "…": "…" },
    { "kind": "commons", "value": "auth", "…": "…" }
  ],
  "efforts": [
    { "id": "eff_…", "project": "skoolscout-com", "area": "discover-schools/applications",
      "type": "feature", "mode": "fullstack", "branch": "feature/discover-schools/applications",
      "worktree": "/…/.claude/worktrees/discover-schools/applications",
      "owner": { "session": "…" }, "state": "active|parked|finished",
      "scopes": ["app-ui/app/discover-schools/applications/**", "…"],
      "leases": ["lease_…"], "notices": [ { "from": "#5440", "text": "core Button changed", "at": "…" } ],
      "pr": { "number": 5464, "url": "https://github.com/…/pull/5464", "draft": false },
      "started": "…", "lastActivity": "…" }
  ]
}
```

### 9.2 Rules

- Every allocation (slot, port, Storybook port, commons lock, worktree) goes through the registry; brokers never pick numbers themselves.
- Reserved slots are never leased. Slot 0's ports are also refused by the core's port guard (§11).
- A lease names the process it started where there is one; `reap` and `finish` stop only those. Nothing in the system ever kills by port or by name pattern.
- Ownership is a session id (the Claude session name when present, else user@host:pid). `status` shows it; `start` names it on refusal.
- A registry entry whose worktree directory is gone and whose ports are free is garbage and is collected by `reap`.

## 10. Runners

**frontend → storybrokr.** `work start --mode frontend` leases a Storybook port and, given `--story <path>`, calls `storybrokr up <story> --host <hostRoot> --port <leased> --ttl <lease>`; `finish` calls `down`. Until phase 3 storybrokr keeps its own instance list; `work` records the instance id so `status` can show both.

**fullstack → manifest services (phase 1), stackbrokr (phase 2).** Phase 1 runs the manifest's `start`/`health`/`stop` commands with the slot's env, in order, from the worktree root, logging to `${LOG_DIR}/<service>.log`. Phase 2 moves exactly that loop into `stackbrokr` as a daemon with leases from the same core, so the manifest does not change and `work` only changes which runner it calls.

## 11. Safety rules

- **Port guard in core.** Any core-driven command receives only the leased ports; a project helper that needs a database connection asks core (`work env --json`) instead of reading `PG*` variables. In the first adopter, the runner's `execPsql` and the backend's dev profile are changed to refuse a reserved slot's ports when running from a linked worktree, closing the hole found on 2026-10-16.
- **No killing by port or pattern.** Only processes the registry started are stopped.
- **Destructive verbs are explicit and few:** `retire` (archive first), `finish --park` (commits, never discards). There is no "discard" verb.
- **The main checkout is read-only to the tool** except for fetching and fast-forwarding the base branch.
- **Secrets never enter the registry or the emitted env file**; the manifest's env template may only reference slot-derived values.

## 12. Agent surface

- **CLI** `work <verb>`, every verb with `--json`; exit codes: 0 ok, 2 refused (with the reason as the first line), 1 error.
- **MCP** `work mcp` (stdio), tools `work_start`, `work_status`, `work_finish`, `work_reap`, `work_audit`, `work_env`, `work_pr` (amendment A); refusal payloads carry the owner and the overlap so an agent can act without parsing prose.
- **Claude skill `/work`** wraps the CLI and carries the rules an agent must apply before calling it (declare area and type, pick the mode, read refusals, never bypass with raw git in a protected checkout).
- Output is stable and greppable: one line per lease in `status`, one line per finding in `audit`.

## 13. Adopting skoolscout-com

1. `work init` writes `helmsmith.config.ts` from today's values: ports 3000/8443/5432 + N, slots 0–9 with 0 reserved, services behind the existing make targets, the refresh entries above, the area list from the current section and module layout.
2. `slot.mk` becomes a shim that reads `.env.slot` (ports, slot) instead of computing them; every existing `make` target keeps working; `make worktree-new/-remove/slot-status` become thin wrappers that call `work` so old habits still land in the registry.
3. `stackbrokr.config.ts` is superseded by the manifest; the parallel-slots spec gets a pointer here.
4. The runner's `execPsql` and the backend dev profile gain the reserved-port refusal.
5. Existing worktrees are gone (cleaned 2026-10-17); the first `work start` per area creates the area worktree. Local branches not yet on develop stay as they are until their owners decide.

## 14. Phasing

- **Phase 1 — core + workbrokr, make-backed fullstack.** Registry, leases, port blocks, worktree/branch ops, sync + refresh, scopes and commons locks, hooks, all verbs, CLI + MCP + skill, skoolscout-com adoption. This phase already removes every failure class from §1.
- **Phase 2 — stackbrokr.** Daemon running the manifest's services on core leases, health watching, log tailing, the same `up/down/ls` shape as storybrokr. `work` switches runner; nothing else changes.
- **Phase 3 — storybrokr on core.** Instance registry moves onto core leases; one reaper and one `status` for everything; CLI/MCP unchanged.
- **Later, optional.** Impact notices from a real dependency graph service; `audit` posted to a channel. (`work pr` moved out of this bucket: amendment A, §18.)

## 15. Testing

- Core: unit tests for scope expansion and overlap (frontend vs fullstack, ancestors, commons), lease allocation under concurrency (two allocators racing for the lowest slot get different slots), expiry, registry atomicity (crash between temp write and rename), manifest validation errors.
- Git behaviour: fixture repos exercising fast-forward vs merge vs conflict stop, protected-branch hooks (commit refused on develop, allowed on an area branch), scope-leave warning, commons write refusal with owner named.
- Verbs end to end against a fixture project whose "services" are tiny scripts: `start` emits config and reaches healthy; `reap` stops only what it started; `finish --park` commits and pushes; `retire` refuses with unpushed commits and archives otherwise; `audit` lists each finding class.
- Adoption test in skoolscout-com: `make slot-status` and the e2e runner work unchanged against a `work start --mode fullstack` worktree.

## 16. Decisions log (from the 2026-10-17 conversation)

1. Shared core with thin brokers, not one daemon and not independent brokers.
2. Port blocks per project, allocated by the registry; slot 0 keeps today's numbers.
3. The area is the unit: one worktree per area, permanently; worktree path mirrors the area; areas are leaves only.
4. Branch = `<type>/<area>` with `feature | chore | fix`; one open effort per area; switching type is a checkout in the same worktree.
5. Every effort starts by syncing from the latest base branch (fast-forward or merge, never rebase) and refreshing the worktree; a conflict stops before any lease.
6. No work on develop: the main checkout is a mirror; hooks refuse commits on protected branches everywhere.
7. Locks: resources hard; section scopes hard, mode-aware (frontend set, or frontend + backend); commons write-locked briefly by cross-cutting efforts, never blocking a start; no global freeze; no automatic rebase.
8. Impact notices are informational only.
9. `finish` keeps the worktree and branch; `retire` is the only destructive verb and archives first; `finish --park` commits rather than discards.
10. (phase 1 execution) Ports are per-service ranges `[base, base + slots.count)` claimed per project; the single `ports.block` of §5.2 is dropped.
11. (phase 1 execution) Frontend mode leases no Storybook port: `storybrokr up` has no `--port`, so the lease records the instance id and the port storybrokr chose. Phase 3 unifies this.
12. (phase 1 execution) Impact notices are commons-based ("commons X changed on branch Y"); the import-graph version stays in "later, optional".
13. (phase 1 execution) The emitted `.slot`, env file, log dir and the worktree root are excluded from git through the clone's `info/exclude`, not `.gitignore`, so `finish --park` never commits them.
14. **No separate workkit package (owner, 2026-10-18).** storybrokr stays independent (phase 3 as written is dropped; `work audit` should instead warn when storybrokr's port range overlaps a claimed project range), so workbrokr is workkit's only consumer. The core is folded into `apps/workbrokr/src/core`; one package, one publish. A second consumer would be the trigger to extract it again.
15. **PRs are opened by `work pr`, not by `work start`, and through pritty (amendment A, 2026-10-18).** A draft at start would give every effort a PR before it has a commit; a verb the agent calls when the branch is ready keeps the PR list honest. workbrokr does not grow its own GitHub client: `@helmsmith/pritty` already owns push, create, template, labels and reviewers, and gains the non-interactive, non-AI path workbrokr needs.

## 17. Open questions

- Idle-expiry defaults (12 h slot, 4 h commons, 2 h Storybook) are proposals; confirm against how long an e2e run or a review wait really takes here.
- Session identity for `owner`: the Claude session name is available inside Claude Code; for a human shell the fallback is `user@host:pid`. Good enough, or should `work` mint a per-shell token?
- Archive retention default (30 days or last 5 per area) against the 18 GB found today.

## 18. Amendment A (2026-10-18): `work pr` through pritty

**Status:** proposed; resolves the fourth §17 question (decision 15).
**Packages:** `apps/pritty` (`@helmsmith/pritty`, 0.0.1 unpublished → 0.1.0 published) and `apps/workbrokr` (0.2.0, alongside Spec 2).

### 18.1 Why pritty

`work finish` pushes the branch and stops; nothing in workbrokr opens the pull request, so every effort ends with the agent hand-rolling `gh pr create` and the body conventions drift. `apps/pritty` already has the pieces, exported as a programmatic API and as a CLI: push with upstream, `createPR`, `listOpenPRsForHead` (the duplicate check), `findPullRequestTemplate`, `CODEOWNERS` reviewers, labels, and an AI title/body when nothing better is available. The value for an agent-driven flow is the deterministic part; inside Claude Code the agent knows what it changed and writes a better body than a second model would. So `work pr` uses pritty for the mechanics and lets the caller supply the words.

What pritty is today, from the code rather than its README (whose status table is stale: `commit`, `pr` and `rebase` are implemented): version 0.0.1, never published, not in the Makefile allowlist, interactive by design (inquirer prompts), one global GitHub token, no `--json`, no way to pass a title or body, no commit trailer or PR footer configuration, and a dependency list that includes OpenTUI, React, LangChain and `bun` for its `connect` TUI.

### 18.2 Changes to pritty (prerequisites, pritty 0.1.0)

1. **Non-interactive, machine-readable `pr` & idempotent existing-PR reuse.** `pritty pr --json` prints `{ number, url, draft, created: boolean, head, base }` and nothing else on stdout; prompts are skipped under `--auto-approve` as today. A `--draft` flag creates a draft PR (adding `draft?: boolean` to `createPR`, `OpenPRSummary`, and `PRResult`). When `listOpenPRsForHead` finds an existing open PR for `(head, base)`, `pritty pr` under `--json` / `--auto-approve` short-circuits *before* AI generation and `createPR`, returning the existing PR with `created: false` (and if `--title` or `--body`/`--body-file` was explicitly passed, calls `pulls.update` to update the existing PR's title/body in place).
2. **A non-AI path that bypasses ticket validation.** `pritty pr --title <t> --body-file <f>` (or `--body <text>`) uses the given text verbatim, skips `resolveTicketContext` entirely (so `buildAdapter` is never constructed, `ticket.validate: true` never blocks branch names like `feature/discover-schools/applications` that lack a Jira key, and stale commit-ticket `confirm()` prompts never fire), and never calls an LLM. On the AI path, `resolveTicketContext` also guards its interactive `confirm()` prompt behind `!autoApprove && !json`. The PR template, labels and reviewers still apply.
3. **Strict base & remote-tracking diff base (`origin/<base>...HEAD`).** An explicit `--base` is final (true today) and is **required** under `--json`, so a non-interactive caller can never inherit GitHub's default branch. In `git.ts`, `getCommitsSinceBase` and `getDiffStatSinceBase` resolve the comparison ref as `origin/${base}` when `refs/remotes/origin/${base}` exists (falling back to local `${base}`), and diff against the merge-base (`origin/${base}...HEAD`) rather than the local `base` branch pointer—which in a `workbrokr` worktree sits stale in the main checkout while worktrees fetch and merge `origin/<base>`.
4. **`--no-push` flag.** `pritty pr --no-push` skips `pushBranch` when the caller (`work pr`) has already pushed `effort.branch` with upstream tracking, avoiding a duplicate `git push` and a duplicate `.helmsmith/hooks/pre-push` invocation.
5. **Repo-root config, template, and CODEOWNERS lookup.** `loadConfig()`, `findPullRequestTemplate()`, and `findCodeowners()` resolve paths relative to `git rev-parse --show-toplevel` (falling back to `process.cwd()`), so running `pritty` from a package subdirectory inside a worktree (`app-ui/`) still loads the repository's `.pritty.json`, PR template, and `CODEOWNERS`.
6. **Per-repository GitHub identity.** Token resolution becomes: `GH_TOKEN` / `GITHUB_TOKEN` in the environment; else `.pritty.json` `github.account` → `gh auth token --user <login>`; else `gh auth token`; else the Copilot device-flow token. Today the Copilot token comes first and is global, which opens helmsmith PRs as the skoolscout account or the reverse. Whether the Copilot client's OAuth token can create PRs on organisation repositories is unverified and stops mattering once `gh` is preferred.
7. **Attribution.** `.pritty.json` gains `commitTrailers: string[]` (appended to every commit `pritty commit` makes) and `prFooter: string` (appended to every body, AI or given, idempotently so updating an existing PR body does not duplicate the footer). skoolscout sets `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the "Generated with Claude Code" line there.
8. **`skipHooks` is refused inside a workbrokr worktree** (a `.helmsmith/hooks` `core.hooksPath` or a `WORKTREE` variable in the environment): the hooks are the scope and protected-branch guards, and pritty must not be the way around them.
9. **Packaging.** `@helmsmith/pritty/core` subpath export with git, GitHub, template, CODEOWNERS and config only (no AI adapters, no TUI), so a future in-process consumer does not inherit the TUI stack. workbrokr still spawns the CLI in this amendment (§18.3) and only needs the published binary. Add `@helmsmith/pritty` to `PUBLISH_PKGS`, fix the README status table, publish 0.1.0.

### 18.3 Changes to workbrokr (0.2.0)

**`prEffort(ctx, o)` in `src/lib/effort.ts`**, behind `work pr` and `work_pr`:

1. Resolve the effort as `effortEnv` does (`--area`/`--task`, else the cwd worktree). No open or parked effort → `EFFORT_NOT_FOUND`.
2. `g.isDirty()` → `DIRTY_WORKTREE` (same message as `finish`: commit, or `work finish --park`). A parked effort is allowed: its wip commit is on the branch.
3. `g.unpushedCount(m.baseBranch) > 0` or no upstream → `g.push(effort.branch)` first. workbrokr owns the push so the pre-push hook runs once under workbrokr's identity and the branch is on origin even if pritty fails afterwards. If `g.behindCount(m.baseBranch) > BEHIND_LIMIT` (20), log a non-blocking warning (`branch is <N> commits behind <baseBranch>`) and include `behindBase: N` in `--json` output, without refusing.
4. `effort.pr` already set → verify it is still open through `pritty pr --no-push --json` (which returns the existing open PR for `(head, base)` instead of creating another, and updates its title/body if `--title` or `--body-file` was passed); return it. Not open any more (merged or closed) → fall through and create a new one only with `--force`; otherwise refuse with `PR_CLOSED` naming the old number. Note: `pr` is stored per `Effort` record (not per area), so after `work finish` closes an effort and its PR merges, the next `work start` on that reused `<type>/<area>` branch creates a fresh `Effort` with `pr: undefined`.
5. Spawn `pritty pr --base <m.baseBranch> --no-push --auto-approve --json [--draft] [--title <t>] [--body-file <f>]` with `cwd = effort.worktree`. No `--title` → pritty's AI path; the skill tells agents to always pass a title and a body file.
6. Parse the JSON, `updateEffort(effort.id, { pr: { number, url, draft } })`, touch the effort, return `{ effort, pr, created, behindBase }`.

**Errors.** New `WorkkitError` codes `PRITTY_FAILED` (exit 1: pritty missing, below 0.1.0, or non-zero exit; the message carries pritty's stderr) and `PR_CLOSED` (exit 2, refusal). A pritty version gate mirrors the storybrokr one in Spec 2: `pritty --version` once per call, refuse below 0.1.0.

**Surface.** `work pr [area] [--task <slug>] [--draft] [--title <t>] [--body-file <f>] [--force] [--json]`; MCP `work_pr { rootDir?, area?, task?, draft?, title?, bodyFile?, force? }`. `work status` prints the PR as `PR #5464 open` in the effort's line and in `--json`, and includes each effort's `scopes` and `commons` leases in `--json` so the `/work` skill can include a scope summary in the PR body when desired. `Effort.pr?: { number: number; url: string; draft: boolean }` in `core/types.ts`.

**`finish` is unchanged.** It still pushes and never opens a PR; `--pr` on finish was considered and dropped so that finishing (release the slot, leave the branch) and publishing (ask for review) stay separate verbs an agent can call in either order. `retireArea` keeps refusing while the branch has commits not on origin; an open PR is not a reason to refuse retirement, because the branch stays on origin.

**Skill.** `/work` and the skoolscout skills gain one step: after the final commit, `work pr --title "<conventional title>" --body-file <scratch>/pr-body.md`, body written by the agent in the repo's PR conventions; the footer comes from pritty's config, not from the agent.

### 18.4 Identity and conventions in the two repositories

| | skoolscout-com | helmsmith |
|---|---|---|
| GitHub default branch | `develop` | `main` |
| Manifest `baseBranch` | `develop` | (no manifest yet) |
| Account | `edwin-skoolscout` | `ecruz165` |
| PR template / CODEOWNERS | none today | none today |
| Required attribution | commit trailer + PR footer | PR footer |

With `.pritty.json` `github.account` per repository and `--base` always passed by workbrokr, neither repo depends on pritty's default-branch guess or on a global token. The template and CODEOWNERS features are latent until either repo adds those files.

### 18.5 Testing

- pritty unit: `--json` output shape; existing open PR short-circuits with `created: false` and calls `pulls.update` when `--title`/`--body-file` is passed; `--title/--body-file` skips `resolveTicketContext` and never constructs an adapter (spy on `buildAdapter`); `--json` without `--base` is a usage error; `origin/<base>...HEAD` merge-base diffing when local `<base>` is stale; `--no-push` skips `pushBranch`; repo-root `.pritty.json` lookup from a subdirectory; token resolution order with a fake `gh`; `prFooter` appended idempotently; `commitTrailers` present on every commit; `skipHooks` refused when `WORKTREE` is set.
- workbrokr unit (`effort.test.ts`, fake pritty): dirty worktree refused; unpushed branch pushed before `pritty pr --no-push` runs; `behindBase > BEHIND_LIMIT` warns without refusing; second call returns the stored PR (or updates title/body); closed PR refused without `--force`; `pr` persisted on the effort and shown by `statusFor`; version gate.
- e2e (pritty, with the existing fixture repo and a throwaway GitHub repo under the `ecruz165` account, skipped without a token): create, re-run returns the same number, draft flag honoured.
- Live proof: in skoolscout-com, an area effort with one commit, `work pr --title … --body-file …` opens the PR against `develop` as `edwin-skoolscout` with the footer; `work status` shows it; `work pr` again returns the same number.

### 18.6 Decisions

1. `work pr` is a verb, not a side effect of `start` or `finish` (decision 15).
2. workbrokr spawns the pritty CLI; it does not import `@helmsmith/pritty` until the `/core` export exists and the TUI dependencies are out of the path.
3. The agent writes the title and body; pritty's AI path is the fallback, never the default inside Claude Code.
4. workbrokr pushes before calling `pritty pr --no-push`, so hooks and identity are workbrokr's, and pritty does not push a second time.
5. One PR per effort record; a second one on the same effort needs `--force` after the first was closed or merged, while a new effort started after `work finish` gets a fresh `pr: undefined`.
6. `work pr` warns (and reports `behindBase` in `--json`) when the branch is more than `BEHIND_LIMIT` (20) commits behind `origin/<baseBranch>`, rather than refusing—publishing a draft PR or checkpoint PR for review should not force a merge mid-flight.
7. `workbrokr` does not mutate the caller's PR body to inject a scope summary; `work status --json` exposes the effort's `scopes` and `commons` so the `/work` skill can include a collapsible scope block when appropriate.
8. `work finish --park` keeps its deterministic, offline `wip(<area>): parked <iso>` commit rather than invoking `pritty commit`.


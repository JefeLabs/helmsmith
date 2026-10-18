# storybrokr — worktree-scoped instances, root-first discovery, parallel `check`, and a lease-aligned lifecycle with workbrokr (design)

**Status:** approved in conversation 2026-10-18 (revised after critical review; §9 questions resolved).
**Home:** `apps/storybrokr` (`@helmsmith/storybrokr`, 0.2.0 → 0.3.0) and `apps/workbrokr` (`@helmsmith/workbrokr`, 0.1.0 → 0.2.0).
**Series:** Spec 2 of 3. Spec 1: `2026-10-18-workbrokr-parallel-waves-design.md` (task waves, `_tasks/<area>--<task>` worktrees, `work promote`). Spec 3 (planned): import graph, `--affected`, Storybook globals, runtime error capture, visual diffing.
**Standing decision:** workbrokr spec §16 decision 14 (owner, 2026-10-18): storybrokr stays independent; it keeps its own daemon, registry and ports. This spec does **not** unify registries. It makes the two brokers agree on three things: which host an instance belongs to, how long it lives, and who stops it.

---

## 1. Problem

Spec 1 puts several worktrees of one repository on one machine at once: `<worktreeRoot>/<area>` per area and `<worktreeRoot>/_tasks/<area>--<task>` per parallel task. Every worktree contains the same component paths. Against that layout, the code on `main` today has four gaps. Each is stated against the code, not against the first draft's memory of it.

1. **Instances are keyed by host, but almost nothing asks for the host.** `instanceId(hostRoot, component)` and `Registry.find(hostRoot, component)` are host-scoped, so two worktrees booting `components/Card` get two instances. But `Registry.resolve(idOrPath, hostRoot?)` falls back to `list().find(r => r.component === idOrPath)` when `hostRoot` is undefined, which is every caller except `up`: `Broker.touch/logs/logStream/down` pass no host, the routes read none, `DaemonClient.get/down/touch/check/screenshot/logs/follow` send none, and the CLI and MCP tools accept none. An agent in `_tasks/billing--card` running `storybrokr check components/Card` silently checks, screenshots or tears down whichever worktree booted `components/Card` first (`createdAt` order). A `./components/Card` or absolute path to any command but `up` is `INSTANCE_NOT_FOUND`, because only `up` normalizes through `resolveComponent`.

2. **Discovery is always transitive.** `discoverStories` follows every relative and `tsconfig`-alias import and adds `storyFilesFor()` of every module it visits. That is what the 2026-09-06 spec asked for ("one component plus its child components"). In the first adopter it means a molecule or page section pulls 20 to 50 atom story files (`Button`, `Icon`, `Badge`, `Modal`, …) into the generated `main.ts`: slower boot, and `check` spends most of its time on stories the agent did not change.

3. **`check` is serial.** `inspector.check` opens one page and settles stories in a `for … await` loop. Eight stories at 1.5 s each is 12 s; one story that hits the 30 s budget holds every story behind it.

4. **The two lifecycles disagree on time and ownership.**
   - `work start --mode frontend --story <p>` calls `storybrokr up <p> --host <host> --json` with no `--ttl`, so the instance gets the daemon default of 30 idle minutes, while the `storybook` lease that records it (`Lease.kind === 'storybook'`, `value` = instance id) lives `manifest.expiry.storybookHours` (2 h in skoolscout). `touchEffort` extends the lease and never tells storybrokr, so storybrokr reaps the instance of an effort that is still active.
   - What does already work: `finishEffort` and `reapLeases` both go through `releaseLease`, which calls `storybrokr.down(lease.value)` for every `storybook` lease. The leak is narrower than "nothing stops storybrokr": instances an agent booted **by hand** with `storybrokr up` inside the effort's worktree have no lease and nobody stops them when the effort finishes, is reaped, or the area is retired. (`retireArea` refuses while an effort is open, so lease-owned instances are already down by then; `promoteEffort` refuses every transition to `backend`, so there is no demotion path to handle.)
   - storybrokr's `reapIdle()` never checks that `r.hostRoot` still exists. After `git worktree remove` or `work retire`, the Storybook process keeps running until its TTL, holding a port and a cap slot.
   - Inside an effort, an agent has to know the instance id or type `--host <worktree>/app-ui` on every storybrokr command. The host is `join(effort.worktree, manifest.storybook.hostRoot)` (skoolscout: `<worktree>/app-ui`), **not** the worktree itself. Any design that keys on `effort.worktree` matches nothing there.

Capacity is the real ceiling behind all four: `instanceCap` is 6 today (raised to 10 in this spec, the first adopter's `slots.count`; the workbrokr manifest schema has no default for it) and the port range is 6100 to 6199, and each instance is a full Storybook dev server. Stopping instances from leaking ensures the cap is spent on live work.

## 2. Goals and non-goals

**Goals**

- Every storybrokr surface (CLI, MCP, HTTP, `DaemonClient`) can name the host; an unqualified component path that matches more than one host is an error, not a guess.
- Inside a `work` worktree, storybrokr commands find that worktree's instance with no extra flags.
- The default instance holds the stories of the component asked for; the transitive set is one flag away, and a repeat `up` never silently narrows an instance.
- `check` runs stories concurrently with isolated browser state per worker, deterministic result order, and the same exit semantics.
- An instance never outlives its effort by accident: TTL equals the lease, activity on the effort touches the instance, finish / reap / retire stop every instance under the effort's host, and a deleted host is reaped by storybrokr itself.
- Raise `DEFAULT_CONFIG.instanceCap` from 6 to 10, the first adopter's `slots.count`, so a full wave of frontend tasks fits; `config.json` still overrides it per machine.

**Non-goals**

- Merging the two registries, moving storybrokr onto workbrokr leases, or a shared reaper (decision 14).
- `work check` / `work screenshot`: a second copy of storybrokr's option surface in workbrokr. The host default in §3.5 gives the same ergonomics with one environment variable (§4).
- Changing port ranges or multi-instance Storybook builds.
- Anything in Spec 3 (`--affected`, globals, console/network capture, visual diff).

## 3. Design

### 3.1 Host-scoped resolution (storybrokr)

**Identity.** `hostRoot` is stored and compared as a realpath. `Broker.up` resolves `req.hostRoot` (or the walked-up root) through `realpathSync` before `inspectHost`; `resolveComponent` and `findHostRoot` return realpaths. Comparisons in the registry use the stored value against `realpathSync(input)`. (macOS `/tmp` → `/private/tmp` and symlinked worktree roots otherwise never match. Instance ids change for symlinked hosts; instances are ephemeral and reconcile reads the path from each record, so nothing else moves.)

**`Registry.resolve(idOrPath, scope?)`** where `scope` is `{ host?: string; hint?: string }`:

1. `byId.get(idOrPath)` → return it. (An id is unique; a mismatching `host` is ignored.)
2. `host` given (explicit `--host` / `hostRoot`): candidates = instances with `component === idOrPath && hostRoot === realpath(host)`. One → return. None → `INSTANCE_NOT_FOUND` naming the host.
3. No `host`, `hint` given (derived from cwd or `STORYBROKR_HOST`, §3.5): try step 2 with the hint. One → return. None → fall through to step 4. The hint never produces an error on its own.
4. No scope: candidates = instances with `component === idOrPath`. One → return. More → `INSTANCE_AMBIGUOUS`. None → `INSTANCE_NOT_FOUND`.

```ts
new StorybrokrError(
  'INSTANCE_AMBIGUOUS',
  `${idOrPath} is running in ${matches.length} hosts: ${matches.map((m) => `${m.id} @ ${m.hostRoot}`).join(', ')}; pass --host <dir> or an instance id`,
)
```

`INSTANCE_AMBIGUOUS` joins `ErrorCode` with HTTP 409.

Why a hint and not a strict cwd rule: the MCP server's cwd is wherever the editor launched it, usually the main checkout, and the main checkout has the same component on disk. A strict cwd rule would turn today's wrong answer into `INSTANCE_NOT_FOUND` for every MCP caller that omits `hostRoot`. With the hint, an agent inside its worktree gets its own instance, a caller from the main checkout with one instance anywhere gets that instance, and two instances produce the 409 with the list.

**Client-side `resolveTarget(idOrPath, explicitHost?)`** in `commands/_shared/output.ts`, returning `{ idOrPath, host?, hint? }`:

- 12-hex id → `{ idOrPath, host: explicitHost }`.
- `explicitHost` → normalize the path relative to `realpath(explicitHost)` (absolute inside the host → `relative()`; otherwise strip `./` and trailing `/`) and return it as `host`.
- Otherwise, `process.env.STORYBROKR_HOST` set → same normalization, returned as `hint`.
- Otherwise `resolveComponent(idOrPath)` from cwd; found and inside the host → `{ idOrPath: component, hint: hostRoot }`; not found → `{ idOrPath: idOrPath.replace(/\/+$/, '') }`.

`up` uses the same precedence for the host it boots in: `--host`, then `STORYBROKR_HOST`, then the walk-up from the path. Without this, `storybrokr_up` from an MCP server whose cwd is the main checkout would boot the main checkout's Storybook even with the variable set.

**Propagation.** `Broker.get/touch/logs/logStream/down(idOrPath, scope?)`; `Broker.downByHost(host): Promise<InstanceRecord[]>` stops every instance whose `hostRoot` equals `realpath(host)` and returns them. Routes read `?host=` and `?hint=` on `GET /v1/instances` (filter), `GET|DELETE /v1/instances/:id`, `POST /v1/instances/:id/{touch,check,screenshot}`, `GET /v1/instances/:id/logs`; `DELETE /v1/instances?host=<dir>` → `200 { stopped: string[] }`. `DaemonClient` gains the matching `scope?` parameter on `get/down/touch/check/screenshot/logs/follow`, `list({ host? })`, and `downByHost(host)`. CLI: `--host <dir>` on `get down touch check screenshot logs open ls`; `down --host <dir>` with no id stops that host's instances (`--all --host <dir>` is the same thing spelled out). MCP: optional `hostRoot` on `storybrokr_list/get/down/touch/check/screenshot/logs`; `storybrokr_down` accepts `{ hostRoot }` without `id`. Every tool runs its `id` through `resolveTarget` first, so `STORYBROKR_HOST` in the MCP server's environment also works.

### 3.2 Orphan reaping (storybrokr)

`Broker.reapIdle()` also stops any instance in `starting` or `ready` whose `hostRoot` no longer exists (`!existsSync`). `stop()` already tolerates a missing config dir. The reaper interval is unchanged (60 s), so a removed worktree frees its port and cap slot within a minute, with no cooperation from whoever removed it.

### 3.3 Root-first discovery (storybrokr)

`discoverStories(hostRoot, component, tsconfigPaths, opts?: { includeChildren?: boolean })` returns `DiscoveryResult` with a new `includedChildren: boolean`.

**Root boundary.** `abs = resolve(hostRoot, component)`:

- `abs` is a `.stories.*` file → that file alone (no fallback, no children unless asked).
- `abs` is a directory → root modules are the files under `abs`; stories found under `abs` are root stories. Imports that resolve outside `abs` are children.
- `abs` is `index.*` → the boundary is `dirname(abs)`.
- `abs` is any other source file (`components/Button.tsx`) → root stories are `storyFilesFor(abs)` (`Button.stories.tsx`, `Button.variants.stories.tsx`); every import, including a sibling, is a child.

**Phases.** Phase 1 collects root stories only (the BFS still runs over root modules so a root `index.ts` that re-exports `./Button` finds `Button.stories.tsx`, but it does not leave the boundary). If phase 1 finds at least one story and `includeChildren` is not `true`, return with `includedChildren: false`. Otherwise run today's full transitive BFS and return `includedChildren: true`. Zero stories after both phases is `COMPONENT_NOT_FOUND`, as today.

**Record and repeat `up`.** `UpRequest.includeChildren?: boolean` and `InstanceRecord.includeChildren: boolean`. In `Broker.up` for an existing `ready` instance:

- `req.includeChildren === undefined` → re-discover with the **record's** value. A plain `up` (which `work start`, `--join` and a human retyping the command all issue) never narrows or widens an instance it did not create.
- `req.includeChildren` explicit → re-discover with it; if the story list differs, stop and recreate (same id, new port), as today for a changed list.

**Surface.** `storybrokr up <path> --include-children`; `includeChildren` on `UpBody` and `storybrokr_up`; `ls`/`get` show `children: yes|no`. README, SKILL.md and the MCP descriptions change from "one component plus its child components" to "one component's stories; `--include-children` adds the stories of everything it imports". The plan records before/after numbers for the README table (today: `organisms/calendar/section` + children = 16 stories, 83 modules).

This is a behaviour change for every existing caller and ships as 0.3.0 with a breaking changeset (§6). The alternative, opt-in `--root-only` with the transitive default kept, is in §4 and §9.

### 3.4 Parallel `check` (storybrokr)

`DaemonConfig.checkConcurrency` (default 4, `config.json` overridable); `CheckRequest.concurrency?: number` (1 to 16) via `--concurrency <n>` and the `concurrency` field of `storybrokr_check`.

`inspector.check(record, req)`:

1. `assertReady`, `findStories`, `results = new Array(stories.length)`.
2. `n = max(1, min(stories.length || 1, req.concurrency ?? deps.defaultConcurrency ?? 4))`.
3. Start `n` workers. **Each worker acquires its own `BrowserContext`** (`deps.pool.acquire()`), adds `RECORDER_SCRIPT`, opens one page, and loops: claim `idx = next++`, stop when `idx >= stories.length`, settle `stories[idx]`, write `results[idx]`. Each worker closes its context in `finally`.
4. `Promise.all(workers)`, then the summary as today.

One context per worker, not one shared context: pages in a Playwright context share cookies, `localStorage`, `sessionStorage` and IndexedDB, and the first adopter persists Zustand stores and the theme to `localStorage`. Shared storage would make story results depend on which stories ran beside them. The cost is `n` contexts instead of one; the Storybook dev server serves the preview bundle from memory, so the shared HTTP cache the first draft wanted buys little. `BrowserPool.open` already counts contexts and defers the idle close until all are released.

Results are index-ordered, so output and exit code are the same as a serial run. `durationMs` per story is still reported but is now measured under contention; the SKILL notes `--concurrency 1` for timing questions and for stories known to be timing sensitive.

`screenshot` is unchanged (one story, one context).

### 3.5 Lease-aligned lifecycle (workbrokr)

All of this is written against `apps/workbrokr/src/lib/effort.ts` and `src/lib/storybrokr.ts` as they are on `main` today: the `Ctx.storybrokr: StorybrokrClient`, the `storybook` lease whose `value` is the instance id, `touchEffort`, `releaseLease`, `finishEffort`, `reapLeases`, `retireArea`.

**One host helper.** `storybookHostFor(m, worktree) = m.storybook ? join(worktree, m.storybook.hostRoot) : worktree`, replacing the two inline copies in `startEffort` and used by every call below. The host is never `effort.worktree` unless the manifest says so.

**Client.**

```ts
export interface StorybrokrClient {
  up(story: string, hostRoot: string, opts?: { ttlMinutes?: number; includeChildren?: boolean }): Promise<StorybrokrInstance>;
  down(id: string): Promise<void>;
  downHost(hostRoot: string): Promise<string[]>;   // stopped ids; [] when the daemon is not running
  touch(id: string): void;                          // synchronous: touchEffort is synchronous
  version(): string;                                // `storybrokr --version`
}
```

`down` and `touch` take an instance id only: an id resolves in step 1 of §3.1 regardless of host, so the lease's `value` is enough and no host needs threading through `releaseLease`. `storybrokrCli` maps these onto `up … --host H --json [--ttl N] [--include-children]`, `down ID`, `down --host H --json`, `touch ID`, `--version`. `downHost` and `touch` are best effort: a non-zero exit or `DAEMON_UNAVAILABLE` is logged through `ctx.log`, never thrown. `up`/`down` keep today's `STORYBROKR_FAILED` behaviour. The client is `spawnSync` throughout, so the synchronous `touch` and `version` cost nothing extra.

**TTL.** Both `up` call sites in `startEffort` (the fresh start and the `--join` late story attachment) pass `ttlMinutes: Math.ceil(m.expiry.storybookHours * 60)`. The instance and the lease now expire together, and both are extended by the same touches.

**Touch.** `touchEffort` stays synchronous; `statusFor` and `effortEnv` call it and are synchronous too. For each `storybook` lease it calls `storybrokr.touch(String(lease.value))` **only when the lease's `touched` is older than 60 s**, then extends the lease as today. The throttle matters because `work env` runs from Makefiles (`slot-check`, every `make` in a worktree) and each storybrokr call is a Node process start.

**Teardown.** `releaseLease` is unchanged (`down(lease.value)`). After the lease loop in `finishEffort` and `reapLeases`, and before `worktreeRemove` in the task path of `finishEffort` and in `retireArea`, call `storybrokr.downHost(storybookHostFor(m, worktree))` when the worktree still exists. That is what catches hand-booted instances. When the worktree is already gone, §3.2 catches them within a minute.

**Host default.** `slotVars` emits `STORYBROKR_HOST=<storybookHostFor(m, worktree)>`; it joins the known-variable list in `manifest.ts` so a project can put it in `env.template`, and `work env` prints it. Inside a worktree whose env file is sourced, or in a shell that ran `eval "$(work env --sh)"`, every storybrokr command and the storybrokr MCP server resolve paths to that host with no flags (§3.1 step 3). skoolscout adds the variable to its template in the adoption follow-up.

**Version gate.** `startEffort` in frontend mode calls `storybrokr.version()` once and refuses with `STORYBROKR_FAILED` ("storybrokr 0.3.0 or newer is required; found X") below 0.3.0, because `--include-children` and `down --host` do not exist before it.

## 4. Alternatives considered

- **Strict cwd scoping with no hint.** Rejected: breaks every MCP caller launched from the main checkout (§3.1).
- **Shared `BrowserContext`, many pages.** Rejected for state leakage between stories (§3.4).
- **Keep the transitive default, add `--root-only`.** Keeps today's contract and avoids a breaking release, at the cost of every agent having to learn the flag to get the fast path. The problem statement says the fast path is what agents want almost always, so the default moves and the flag goes the other way. Open for the owner (§9).
- **`work check` / `work screenshot`.** Rejected: duplicates storybrokr's option surface in a second CLI and MCP, and every future storybrokr flag would need mirroring. `STORYBROKR_HOST` gives the same ergonomics.
- **storybrokr on workbrokr leases.** Already rejected by decision 14; this spec aligns the two without merging them.
- **Realpath-insensitive matching (string equality on `resolve()`).** Rejected: fails on symlinked hosts and macOS `/tmp`.

## 5. Files affected

**`apps/storybrokr`**
- `src/types.ts`: `includeChildren` on `UpRequest` and `InstanceRecord`; `checkConcurrency` on `DaemonConfig`; `concurrency` on `CheckRequest`.
- `src/lib/errors.ts` (+test): `INSTANCE_AMBIGUOUS` = 409.
- `src/lib/host.ts`, `src/commands/_shared/output.ts` (+tests): realpath roots; `resolveTarget`.
- `src/lib/discover.ts` (+test): root boundary, two phases, `includedChildren`.
- `src/server/registry.ts` (+test): `resolve(idOrPath, scope)`.
- `src/server/broker.ts` (+test): scope threading, `downByHost`, realpath at `up`, `includeChildren` inheritance, orphan reap.
- `src/server/inspector.ts` (+test): worker pool with one context per worker.
- `src/server/config.ts` (+test): `checkConcurrency: 4`, `instanceCap: 10`.
- `src/server/routes.ts`: `host`/`hint` query params, `DELETE /v1/instances?host=`, `includeChildren`, `concurrency`.
- `src/client/index.ts` (+test): scope parameters, `downByHost`, `list({ host })`.
- `src/commands/{up,get,down,touch,check,screenshot,logs,open,ls}.ts`: `--host`, `--include-children`, `--concurrency`.
- `src/mcp/server.ts` (+test): `hostRoot`, `includeChildren`, `concurrency`.
- `README.md`, `SKILL.md`, `CHANGELOG.md` (via changeset).
- `tests/e2e/worktrees.test.ts` (new), `tests/e2e/up-down.test.ts` (default story set, `--include-children`), `tests/e2e/inspect.test.ts` (`--concurrency`). `render.test.ts` is unchanged: it asserts that the Panel story renders its child Button, which root-first discovery does not affect (children are still bundled as modules; only their stories are left out).

**`apps/workbrokr`**
- `src/lib/storybrokr.ts`: the client in §3.5.
- `src/lib/effort.ts` (+test): `storybookHostFor`, TTL, throttled touch, `downHost` in finish / reap / retire, version gate.
- `src/core/config.ts`, `src/core/manifest.ts` (+tests): `STORYBROKR_HOST`.
- `SKILL.md`: "inside a worktree, storybrokr finds your instance; pass `--include-children` when you need the atoms".

## 6. Compatibility, versions, rollout

- **storybrokr 0.3.0 (minor, breaking by the project's pre-1.0 convention).** Breaking: default discovery is root-first; unqualified paths that match several hosts return 409 where they used to return the oldest instance; instance ids change for symlinked hosts. Additive: `--host` everywhere, `--include-children`, `--concurrency`, `STORYBROKR_HOST`, orphan reaping, `instanceCap: 10`. Changeset: `minor` with a "Breaking" paragraph naming the three changes.
- **workbrokr 0.2.0 (minor).** Requires storybrokr ≥ 0.3.0 in frontend mode (version gate). Changeset `minor`. The pending Spec 1 work on `main` ships in the same release.
- **Rollout in skoolscout-com:** install both, add `STORYBROKR_HOST: '${STORYBROKR_HOST}'` to `helmsmith.config.ts` `env.template`, update the e2e-inspect skills that mention storybrokr. No migration of running instances: `Registry.load` and `reconcile` read a record without `includeChildren` as `true`, because every 0.2.0 instance was booted transitively. A repeat `up` without the flag therefore keeps such an instance exactly as it was; the way to narrow one is `down` and a fresh `up`.

## 7. Testing

**Unit (vitest, both packages).**
- `registry.test.ts`: two hosts, same component; `resolve(c, { host: A })` → A; `resolve(c)` → `INSTANCE_AMBIGUOUS` listing both; `resolve(c, { hint: X })` with no instance in X → falls through; by-id ignores a mismatching host; realpath equality.
- `broker.test.ts`: `downByHost(A)` stops A's instances only; `reapIdle` stops an instance whose `hostRoot` was removed; repeat `up` without `includeChildren` keeps the record's value, with an explicit flip rebuilds.
- `discover.test.ts`: directory with own stories → root only; `index.ts` re-export → sibling story found, child excluded; leaf file → `storyFilesFor` only; zero root stories → transitive fallback with `includedChildren: true`; explicit `includeChildren: true` on a component with root stories → transitive.
- `inspector.test.ts`: with a fake pool, `check` acquires exactly `min(n, stories)` contexts, results keep story order, one timing-out story does not delay the others past its own budget, `concurrency: 1` equals today's behaviour.
- `output.test.ts`: `resolveTarget` for id / `--host` / `STORYBROKR_HOST` / cwd / bare string.
- `effort.test.ts`: `up` receives `ttlMinutes = storybookHours * 60` on both paths; `touchEffort` calls `touch` once per minute at most; `finishEffort`, `reapLeases` and `retireArea` call `downHost(storybookHostFor(...))` with the manifest's host (not the worktree) before removing anything; the version gate refuses 0.2.0.
- `manifest.test.ts` / `config.test.ts`: `STORYBROKR_HOST` accepted in a template and emitted.

**E2E (`tests/e2e`, subprocess, built CLI).**
- `worktrees.test.ts`: copy the fixture host to `A` and `B`; `up` the same component in both; `check <component>` → exit 1 with `INSTANCE_AMBIGUOUS`; `check <component> --host B` → B's instance; `STORYBROKR_HOST=A check <component>` → A's; `cd A && check <component>` → A's; `down --host A` leaves B running; `rm -rf B` then wait one reaper tick → B's instance gone from `ls`.
- `up-down.test.ts`: `up src/components/Panel` returns only `organisms-panel--*` stories by default and `includeChildren: false`; `up … --include-children` adds the child stories and flips the record; a plain repeat `up` after that keeps the wider instance.
- `render.test.ts`: unchanged, and it must still pass under the new default (the Panel story renders its child Button).
- `inspect.test.ts`: `check --concurrency 4` and `--concurrency 1` report identical per-story statuses in identical order.
- `mcp.test.ts`: `storybrokr_check` with `hostRoot` and with `STORYBROKR_HOST` in the server environment.

**Live proof** before merge: in skoolscout-com, `work start --area <a> --task t1 --mode frontend --scope <glob1> --story <p>` and the same for `t2` with a non-overlapping `--scope`, then from inside each worktree `storybrokr check <p>` hits its own instance, `work finish --area <a> --task t1` leaves `t2`'s instance up, and `storybrokr ls` shows the TTL equal to the lease.

## 8. Decisions log

1. storybrokr stays independent (decision 14 carried over); alignment, not unification.
2. The cwd-derived host is a hint that falls back to an unscoped match; only `--host` is strict.
3. `hostRoot` is a realpath everywhere.
4. Parallel `check` uses one browser context per worker (`DEFAULT_CONFIG.checkConcurrency = 4`).
5. Root-first becomes the default in 0.3.0 with a breaking changeset; a repeat `up` without the flag inherits the record's `includeChildren`.
6. No `work check` / `work screenshot`; `STORYBROKR_HOST` instead.
7. Instance TTL = `expiry.storybookHours`; touches are throttled to once a minute per lease.
8. Hand-booted instances are stopped by `downHost` on the manifest's Storybook host at finish, reap and retire; storybrokr reaps instances whose host directory is gone.
9. The first draft's workbrokr section was replaced: it referenced `effort.storybrokrId`, `effort.story`, `ctx.leaseTtlSeconds`, a demotion path and a reap gap that do not exist on `main`, and keyed teardown on `effort.worktree` where the host is `<worktree>/app-ui`.
10. `DEFAULT_CONFIG.instanceCap` raised from `6` to `10` (owner), sized to the first adopter's `slots.count`; per-machine `config.json` can lower it.
11. `work audit` remains focused on git worktrees and `workbrokr` leases (`downHost` on finish/reap/retire + `storybrokr` orphan reaping already clean up hand-booted instances).
12. `down` and `touch` address instances by id only; hosts matter for component paths, not ids.
13. A record saved before 0.3.0 loads as `includeChildren: true`, so upgrading never narrows a running instance.
14. `up` resolves its host with the same precedence as every other command: `--host`, `STORYBROKR_HOST`, walk-up.

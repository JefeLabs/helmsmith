# Spec 2: Worktree-Scoped `storybrokr`, Root-First Discovery, Parallel `BrowserPool`, and Unified Leases

- **Date:** 2026-10-18
- **Packages:** `@helmsmith/storybrokr` (`apps/storybrokr`), `@helmsmith/workbrokr` (`apps/workbrokr`)
- **Status:** Draft — Pending User Review
- **Related:** Spec 1 (`docs/superpowers/specs/2026-10-18-workbrokr-parallel-waves-design.md`), Spec 3 (planned: bidirectional import graph, `--affected`, Storybook globals, runtime error capture, visual diffing)

---

## 1. Problem Statement

When multiple parallel efforts run across git worktrees on the same repository (enabled by Spec 1's intra-area task waves and multi-area worktrees), four concrete bottlenecks and isolation failures surface between `@helmsmith/storybrokr` and `@helmsmith/workbrokr`:

1. **Cross-Worktree Instance Collisions (`storybrokr`):**
   - `instanceId(hostRoot, component)` hashes `hostRoot + component`, creating distinct 12-hex IDs per worktree.
   - However, only `storybrokr up` resolves a component path to `{ component, hostRoot }`. Every other command (`get`, `down`, `touch`, `check`, `screenshot`, `logs`, `open`) and MCP tool (`storybrokr_get`, `storybrokr_down`, `storybrokr_touch`, `storybrokr_check`, `storybrokr_screenshot`, `storybrokr_logs`), as well as the HTTP routes (`/v1/instances/:id/*`) and `DaemonClient`, omit `hostRoot`.
   - Worse, `Registry.resolve(idOrPath, hostRoot)` falls back to `this.list().find((r) => r.component === idOrPath)` when `hostRoot` is `undefined`—silently returning whichever worktree booted that component first (`createdAt` order). An agent in `worktrees/school--card` running `storybrokr check components/Card` silently checks, screenshots, or tears down `worktrees/billing--card`'s Storybook instance.
   - Passing a relative path like `./components/Card` or an absolute worktree path to `storybrokr check ./components/Card` fails with `INSTANCE_NOT_FOUND` because only `up` normalizes paths via `resolveComponent`.

2. **Unbounded Transitive Story Discovery (`discover.ts`):**
   - `discoverStories(hostRoot, component, tsconfigPaths)` unconditionally performs a full transitive BFS over all relative and `tsconfig` alias imports, collecting `.stories.*` files from every transitive dependency.
   - Booting a molecule, organism, or page section imports shared atoms (`Button`, `Icon`, `Badge`, `Modal`, `Switch`, etc.), dragging 20–50 child story files into the generated `.storybook/main.ts`. This inflates bundler compile time and causes `storybrokr check` to run dozens of unrelated atom stories.

3. **Serial Story Verification (`inspector.ts`):**
   - `inspector.check()` opens a single Playwright `Page` and runs `for (const story of stories) { await settle(page, ...); }` strictly sequentially.
   - A component with 8 stories taking 1.5s each takes 12s serially; a single story that hits the 30s settle timeout blocks all subsequent stories in the queue.

4. **Disconnected `workbrokr` ↔ `storybrokr` Lifecycles & TTLs:**
   - `work start --mode frontend --story <path>` boots `storybrokr` with its default 30-minute TTL (`ttlMinutes: 30`), while `workbrokr` effort leases default to 4 hours (`leaseTtlSeconds: 14400`). After 30 minutes of editing code, `storybrokr` reaps the active effort's Storybook instance.
   - `work status` and `work env` touch `workbrokr`'s port leases in `leases.json`, but never call `storybrokr touch <storybrokrId>`.
   - `reapLeases`, `retireArea`, and `promoteEffort` (when demoting to `backend`) never stop `storybrokr` instances, and `finishEffort` only stops `effort.storybrokrId`—leaking any additional `storybrokr` instances the agent booted directly inside `effort.worktree`.
   - `storybrokr`'s `reapIdle()` never checks whether `r.hostRoot` still exists on disk, leaving orphan processes if a worktree directory is removed externally.
   - Agents inside a `workbrokr` effort must manually look up `storybrokrId` or pass `--host <worktree>` to run `storybrokr check` / `storybrokr screenshot`.

---

## 2. Design Overview

### 2.1 Worktree-Scoped Instance Resolution & Host Teardown (`storybrokr`)

1. **`INSTANCE_AMBIGUOUS` Error Code (`errors.ts`):**
   - Add `'INSTANCE_AMBIGUOUS'` to `ErrorCode` with HTTP status `409` (`Conflict`).
   - In `Registry.resolve(idOrPath: string, hostRoot?: string)`:
     - If `this.byId.get(idOrPath)` exists, return it immediately.
     - Filter `this.list()` by `r.component === idOrPath && (hostRoot === undefined || r.hostRoot === hostRoot)`.
     - If `matches.length === 1`, return `matches[0]`.
     - If `matches.length > 1`, throw:
       ```ts
       new StorybrokrError(
         'INSTANCE_AMBIGUOUS',
         `multiple instances match ${idOrPath} (${matches.map((m) => `${m.id} @ ${m.hostRoot}`).join(', ')}); pass --host <dir> or an instance id`,
       )
       ```
     - If `matches.length === 0`, throw `INSTANCE_NOT_FOUND`.

2. **Client-Side Target Resolution (`resolveTarget` in `commands/_shared/output.ts`):**
   - Introduce `resolveTarget(idOrPath: string, explicitHost?: string): { idOrPath: string; hostRoot?: string }`:
     - If `explicitHost` is provided:
       - If `/^[0-9a-f]{12}$/.test(idOrPath)`, return `{ idOrPath, hostRoot: resolve(explicitHost) }`.
       - Otherwise normalize `idOrPath` relative to `resolve(explicitHost)` (if `isAbsolute(idOrPath)` and inside `explicitHost`, use `relative(hostRoot, idOrPath)`, else strip leading `./` and trailing `/`), returning `{ idOrPath: component, hostRoot: resolve(explicitHost) }`.
     - If `explicitHost` is not provided:
       - If `/^[0-9a-f]{12}$/.test(idOrPath)`, return `{ idOrPath }`.
       - Otherwise attempt `resolveComponent(idOrPath)` (which walks up from `resolve(process.cwd(), idOrPath)` to find `.storybook/main.*`). If found and `component` is non-empty and doesn't start with `..`, return `{ idOrPath: component, hostRoot }`. If not found on disk (e.g., a bare component string when `cwd` is outside a host repo), fall back to `{ idOrPath: idOrPath.replace(/\/+$/, '') }`.

3. **End-to-End `hostRoot` Propagation (`Broker`, `routes.ts`, `DaemonClient`, CLI, MCP):**
   - `Broker`:
     - `get(idOrPath: string, hostRoot?: string): InstanceRecord`
     - `touch(idOrPath: string, hostRoot?: string): InstanceRecord`
     - `logs(idOrPath: string, tail = 200, hostRoot?: string): string[]`
     - `logStream(idOrPath: string, hostRoot?: string): LogBuffer | undefined`
     - `down(idOrPath: string, hostRoot?: string): Promise<void>`
     - `downByHost(hostRoot: string): Promise<InstanceRecord[]>` — stops all instances where `r.hostRoot === resolve(hostRoot)` and returns the stopped records.
   - `routes.ts`:
     - Read optional `?hostRoot=<dir>` query parameter on:
       - `GET /v1/instances` (when `?hostRoot=<dir>` is present, filters list to `r.hostRoot === resolve(hostRoot)`)
       - `DELETE /v1/instances?hostRoot=<dir>` (calls `ctx.broker.downByHost(hostRoot)` and returns `200 { stopped: records.map(r => r.id) }`)
       - `GET /v1/instances/:id?hostRoot=<dir>`
       - `DELETE /v1/instances/:id?hostRoot=<dir>`
       - `POST /v1/instances/:id/touch?hostRoot=<dir>`
       - `POST /v1/instances/:id/check?hostRoot=<dir>` (also accepts `hostRoot?: string` in `CheckBody`)
       - `POST /v1/instances/:id/screenshot?hostRoot=<dir>` (also accepts `hostRoot?: string` in `ScreenshotBody`)
       - `GET /v1/instances/:id/logs?hostRoot=<dir>&tail=...&follow=...`
   - `DaemonClient`:
     - `list(opts?: { hostRoot?: string }): Promise<InstanceRecord[]>`
     - `get(idOrPath: string, hostRoot?: string): Promise<InstanceRecord>`
     - `down(idOrPath: string, hostRoot?: string): Promise<void>`
     - `downByHost(hostRoot: string): Promise<string[]>`
     - `touch(idOrPath: string, hostRoot?: string): Promise<InstanceRecord>`
     - `check(idOrPath: string, req?: CheckRequest, hostRoot?: string): Promise<CheckResponse>`
     - `screenshot(idOrPath: string, req: ScreenshotRequest, hostRoot?: string): Promise<ScreenshotResponse>`
     - `logs(idOrPath: string, tail?: number, hostRoot?: string): Promise<string[]>`
     - `follow(idOrPath: string, onLine: (line: string) => void, onEnd?: () => void, hostRoot?: string): Promise<() => void>`
   - CLI commands (`get`, `down`, `touch`, `check`, `screenshot`, `logs`, `open`, `ls`):
     - Add `--host <dir>` option to `get`, `down`, `touch`, `check`, `screenshot`, `logs`, `open`, and `ls`.
     - In `down [id-or-path]`: allow `storybrokr down --host <dir>` (without `id-or-path`) to stop all instances for that `hostRoot` via `client.downByHost(resolve(o.host))`.
     - Use `resolveTarget(idOrPath, o.host)` in `get`, `down`, `touch`, `check`, `screenshot`, `logs`, and `open`.
   - MCP tools (`storybrokr_list`, `storybrokr_get`, `storybrokr_down`, `storybrokr_touch`, `storybrokr_check`, `storybrokr_screenshot`, `storybrokr_logs`):
     - Add optional `hostRoot?: z.string()` to input schemas.
     - In `storybrokr_down`: allow `{ hostRoot }` without `id` (or `{ id, hostRoot }`) so agents can tear down an entire worktree's instances.
     - Use `resolveTarget(id, hostRoot)` before invoking `DaemonClient`.

---

### 2.2 Root-First Story Discovery with Automatic Fallback (`discover.ts`)

1. **`DiscoverOptions` & `DiscoveryResult` (`discover.ts`, `types.ts`):**
   ```ts
   export interface DiscoverOptions {
     includeChildren?: boolean;
   }

   export interface DiscoveryResult {
     storyFiles: string[];
     modulesVisited: number;
     unresolved: string[];
     includedChildren: boolean;
   }
   ```
   - Add `includeChildren?: boolean` to `UpRequest` and `InstanceRecord` (defaults to `false`).

2. **Two-Phase Discovery Algorithm (`discoverStories`):**
   - **Root Boundary Definition:**
     - Let `abs = resolve(hostRoot, component)`.
     - If `abs` is a `.stories.*` file and `!opts?.includeChildren`, return `{ storyFiles: [relative(hostRoot, abs)], modulesVisited: 1, unresolved: [], includedChildren: false }` immediately.
     - If `abs` is a **directory**: root modules are files inside `abs` (`file === abs || file.startsWith(abs + '/')`). Imports to files outside `abs` are child imports.
     - If `abs` is an **`index.*` source file**: root modules are files inside `dirname(abs)` (`file.startsWith(dirname(abs) + '/')`). Imports to files outside `dirname(abs)` are child imports.
     - If `abs` is a **non-index source file** (e.g., `components/Button.tsx`): root stories are `storyFilesFor(abs)` (e.g., `components/Button.stories.tsx`). Any imported module (including sibling files in the same folder like `./Icon`) is a child import.
   - **Phase 1 — Root Discovery (when `!opts?.includeChildren`):**
     - Collect stories within the root boundary defined above.
     - If root discovery finds `>= 1` story file (`rootStories.size > 0`), return `{ storyFiles, modulesVisited, unresolved, includedChildren: false }`.
   - **Phase 2 — Automatic Fallback / Explicit `--include-children`:**
     - If `opts?.includeChildren === true` OR Phase 1 found `0` root stories:
       - Run the full transitive import BFS across all local relative and `tsconfig` alias imports.
       - Return `{ storyFiles, modulesVisited, unresolved, includedChildren: true }`.

3. **Broker Re-Creation on `includeChildren` Change (`broker.ts`):**
   - In `Broker.up(req)`:
     - Pass `{ includeChildren: req.includeChildren }` to `discoverStories`.
     - If an instance is already `ready` for `(host.hostRoot, component)`, compare `discovery.storyFiles` against `existing.storyFiles` (just as today). If the caller switched from default (`includeChildren: false`) to `includeChildren: true` (or vice versa) and the discovered `storyFiles` list changed, `Broker.up` stops the existing instance and creates a fresh one with the updated story list.

4. **CLI & MCP Surface (`up.ts`, `mcp/server.ts`, `routes.ts`):**
   - `storybrokr up <path> --include-children` (`includeChildren?: boolean` on `UpOptions`, `UpRequest`, `UpBody` in `routes.ts`, and `storybrokr_up` in `mcp/server.ts`).

---

### 2.3 Parallel Multi-Page `check` in `inspector.ts` (`BrowserPool` Concurrency)

1. **Configuration & Request Types (`types.ts`, `config.ts`, `routes.ts`):**
   - Add `checkConcurrency: number` to `DaemonConfig` in `types.ts` and `DEFAULT_CONFIG` in `config.ts` with default `4`.
   - Add `concurrency?: number` (integer `1..16`) to `CheckRequest` in `types.ts`, `CheckBody` in `routes.ts`, `--concurrency <n>` in `commands/check.ts`, and `concurrency` in `storybrokr_check` (`mcp/server.ts`).

2. **Single-Context Multi-Page Worker Pool (`inspector.ts`):**
   - `createInspector(deps: InspectorDeps)` accepts `defaultConcurrency?: number` in `InspectorDeps` (default `4`).
   - In `inspector.check(record, req)`:
     - Validate `assertReady(record)` and `const stories = findStories(record, req.storyIds)`.
     - Allocate `const results = new Array<CheckResult>(stories.length)`.
     - Acquire **one** `BrowserContext` (`const ctx = await deps.pool.acquire()`), and call `await ctx.addInitScript(RECORDER_SCRIPT)` once on the context.
     - Compute `const concurrency = Math.max(1, Math.min(stories.length || 1, req.concurrency ?? deps.defaultConcurrency ?? 4))`.
     - Spawn `concurrency` async workers sharing `let nextIdx = 0`:
       - Each worker opens its own tab via `const page = await ctx.newPage()`.
       - In a `while (true)` loop:
         - Claim `const idx = nextIdx++`; if `idx >= stories.length`, break.
         - Settle `stories[idx]` on `page` and write `results[idx]`.
     - `await Promise.all(workers)` inside `try { ... } finally { await ctx.close(); }`.
     - Compute `summary` and return `{ instanceId: record.id, results, summary }`.
   - **Why Single-Context Multi-Page:**
     - `pool.acquire()`, `ctx.addInitScript(RECORDER_SCRIPT)`, and `ctx.close()` are each called once per `check()` invocation.
     - Each worker's `page` has its own isolated `window.__STORYBROKR__` event array while sharing the `BrowserContext` HTTP cache so Storybook preview bundles are not re-fetched across parallel tabs.
     - `results` order is deterministic and matches `stories` order regardless of completion order.

---

### 2.4 Orphan Worktree Reaping & Unified `workbrokr` ↔ `storybrokr` Lifecycle

1. **Orphan `hostRoot` Reaping in `storybrokr` (`registry.ts` / `broker.ts`):**
   - In `Broker.reapIdle()`:
     - In addition to `this.registry.idleInstances()`, check active instances (`starting` or `ready`) whose `r.hostRoot` no longer exists on disk (`!existsSync(r.hostRoot)`).
     - Stop and remove any instance whose `hostRoot` directory has been deleted (e.g., after `git worktree remove` or `work retire`).

2. **Extended `StorybrokrClient` in `workbrokr` (`apps/workbrokr/src/lib/storybrokr.ts`):**
   ```ts
   export interface StorybrokrUpOptions {
     ttlMinutes?: number;
     includeChildren?: boolean;
   }

   export interface StorybrokrCheckOptions {
     storyIds?: string[];
     waitForText?: string;
     waitForSelector?: string;
     timeoutMs?: number;
     concurrency?: number;
   }

   export interface StorybrokrScreenshotOptions {
     storyId: string;
     outPath?: string;
     viewport?: string;
     clip?: 'root' | 'viewport' | 'page';
     waitForText?: string;
     waitForSelector?: string;
     timeoutMs?: number;
   }

   export interface StorybrokrClient {
     up(story: string, hostRoot: string, opts?: StorybrokrUpOptions): Promise<StorybrokrInstance>;
     down(id: string, hostRoot?: string): Promise<void>;
     downHost?(hostRoot: string): Promise<void>;
     touch?(id: string, hostRoot?: string): Promise<void>;
     check?(idOrPath: string, hostRoot: string, opts?: StorybrokrCheckOptions): Promise<unknown>;
     screenshot?(
       idOrPath: string,
       hostRoot: string,
       opts: StorybrokrScreenshotOptions,
     ): Promise<unknown>;
   }
   ```
   - `storybrokrCli.up(story, hostRoot, opts)` passes `['up', story, '--host', hostRoot, '--json']` plus `['--ttl', String(opts.ttlMinutes)]` when `opts?.ttlMinutes !== undefined` and `['--include-children']` when `opts?.includeChildren` is true.
   - `storybrokrCli.down(id, hostRoot)` passes `['down', id, ...(hostRoot ? ['--host', hostRoot] : [])]`.
   - `storybrokrCli.downHost(hostRoot)` runs `storybrokr down --host <hostRoot>` (ignoring `DAEMON_UNAVAILABLE` if the daemon isn't running).
   - `storybrokrCli.touch(id, hostRoot)` runs `storybrokr touch <id> [--host <hostRoot>]` (best-effort).
   - `storybrokrCli.check(idOrPath, hostRoot, opts)` runs `storybrokr check <idOrPath> --host <hostRoot> --json` with optional `--story`, `--wait-for-text`, `--wait-for-selector`, `--timeout`, `--concurrency`.
   - `storybrokrCli.screenshot(idOrPath, hostRoot, opts)` runs `storybrokr screenshot <idOrPath> <storyId> --host <hostRoot> --json` with optional `--out`, `--viewport`, `--clip`, `--wait-for-text`, `--wait-for-selector`, `--timeout`.

3. **Synchronized TTL, Touch, and Teardown in `effort.ts` (`apps/workbrokr/src/lib/effort.ts`):**
   - **Boot (`startEffort` and `promoteEffort`):**
     - Compute `const ttlMinutes = Math.ceil((ctx.leaseTtlSeconds ?? 4 * 3600) / 60)`.
     - Call `sb.up(story, worktree, { ttlMinutes })`.
   - **Touch (`statusFor` and `effortEnv`):**
     - Whenever `statusFor` or `effortEnv` touches port leases for open efforts, also call `await sb.touch?.(e.storybrokrId, e.worktree)` (wrapped in `try/catch` so a stopped `storybrokr` daemon never breaks `work status` or `work env`).
   - **Teardown (`finishEffort`, `promoteEffort` demotion to `backend`, `reapLeases`, `retireArea`):**
     - In `finishEffort`: if `effort.storybrokrId` is set, call `await sb.down(effort.storybrokrId, effort.worktree)` AND call `await sb.downHost?.(effort.worktree)` (best-effort) so any additional `storybrokr` instances the agent started manually inside `effort.worktree` are also stopped!
     - In `promoteEffort` (when demoting to `backend`): stop `effort.storybrokrId` and `await sb.downHost?.(effort.worktree)`.
     - In `reapLeases`: when reaping an effort whose lease expired, also stop `effort.storybrokrId` and `await sb.downHost?.(effort.worktree)` (best-effort) and clear `storybrokrId`/`storybrokrPort`/`storybrokrUrl` on the parked effort.
     - In `retireArea`: call `await sb.downHost?.(wt)` before removing the worktree directory so no orphan `storybrokr` instance survives area retirement.

4. **`work check` and `work screenshot` Commands & MCP Tools (`apps/workbrokr`):**
   - `checkEffort(ctx, opts: { area?: string; task?: string; component?: string; storyIds?: string[]; waitForText?: string; waitForSelector?: string; timeoutMs?: number; concurrency?: number })` in `effort.ts`:
     - Resolves the open effort via `(area, task)` or `cwd` worktree (same resolution pattern as `effortEnv`).
     - Selects target `idOrPath = opts.component ?? effort.storybrokrId ?? effort.story` (throwing `WorkkitError('STORY_REQUIRED', ...)` if none is available).
     - Touches the effort's port leases and calls `sb.check(idOrPath, effort.worktree, ...)`.
   - `screenshotEffort(ctx, opts: { area?: string; task?: string; component?: string; storyId: string; outPath?: string; viewport?: string; clip?: 'root' | 'viewport' | 'page'; waitForText?: string; waitForSelector?: string; timeoutMs?: number })` in `effort.ts`:
     - Resolves the open effort via `(area, task)` or `cwd` worktree.
     - Selects target `idOrPath = opts.component ?? effort.storybrokrId ?? effort.story`.
     - Touches the effort's port leases and calls `sb.screenshot(idOrPath, effort.worktree, ...)`.
   - CLI commands:
     - `work check [area] [--task <slug>] [--component <path>] [--story <id>...] [--concurrency <n>] [--wait-for-text <text>] [--wait-for-selector <sel>] [--timeout <ms>] [--json]`
     - `work screenshot <story-id> [area] [--task <slug>] [--component <path>] [--out <path>] [--viewport <WxH>] [--clip <mode>] [--wait-for-text <text>] [--wait-for-selector <sel>] [--timeout <ms>] [--json]`
   - MCP tools (`apps/workbrokr/src/mcp/server.ts`):
     - `work_check` and `work_screenshot` with optional `rootDir`, `area`, `task`, `component`, etc.

---

## 3. Files Affected

### `@helmsmith/storybrokr` (`apps/storybrokr`)
- `src/types.ts` — Add `includeChildren?: boolean` to `UpRequest` & `InstanceRecord`; add `checkConcurrency: number` to `DaemonConfig`; add `concurrency?: number` and `hostRoot?: string` to `CheckRequest` / `ScreenshotRequest`.
- `src/lib/errors.ts` & `src/lib/errors.test.ts` — Add `INSTANCE_AMBIGUOUS` (HTTP `409`).
- `src/lib/discover.ts` & `src/lib/discover.test.ts` — Root-first story discovery with automatic fallback to transitive child imports and `includeChildren?: boolean`.
- `src/server/config.ts` & `src/server/config.test.ts` — Add `checkConcurrency: 4` to `DEFAULT_CONFIG`.
- `src/server/registry.ts` & `src/server/registry.test.ts` — Throw `INSTANCE_AMBIGUOUS` in `resolve(idOrPath, hostRoot)` when multiple worktrees match an unqualified component path.
- `src/server/broker.ts` & `src/server/broker.test.ts` — Thread `hostRoot` through `get`, `touch`, `logs`, `logStream`, `down`; add `downByHost(hostRoot)`; pass `includeChildren` to `discoverStories`; reap instances whose `hostRoot` no longer exists on disk in `reapIdle()`.
- `src/server/inspector.ts` & `src/server/inspector.test.ts` — Multi-page concurrent `check()` inside a single `BrowserContext`.
- `src/server/routes.ts` — Support `?hostRoot=` query parameter on `/v1/instances` and `/v1/instances/:id/*`, `DELETE /v1/instances?hostRoot=`, `includeChildren` on `UpBody`, and `concurrency` on `CheckBody`.
- `src/client/index.ts` & `src/client/index.test.ts` — Thread `hostRoot` and `downByHost` through `DaemonClient`.
- `src/commands/_shared/output.ts` & `src/commands/_shared/output.test.ts` — Add `resolveTarget(idOrPath, explicitHost)`.
- `src/commands/up.ts`, `get.ts`, `down.ts`, `touch.ts`, `check.ts`, `screenshot.ts`, `logs.ts`, `open.ts`, `ls.ts` — Add `--host <dir>`, `--include-children` (on `up`), `--concurrency <n>` (on `check`).
- `src/mcp/server.ts` & `src/mcp/server.test.ts` — Add `hostRoot`, `includeChildren`, and `concurrency` to MCP tool schemas.

### `@helmsmith/workbrokr` (`apps/workbrokr`)
- `src/lib/storybrokr.ts` — Add `ttlMinutes`/`includeChildren` to `up`, `hostRoot` to `down`, plus `downHost`, `touch`, `check`, and `screenshot` methods.
- `src/lib/effort.ts` & `src/lib/effort.test.ts` — Pass `ttlMinutes` on `sb.up`, call `sb.touch` on `statusFor`/`effortEnv`, call `sb.downHost` on `finishEffort`/`promoteEffort`/`reapLeases`/`retireArea`, and implement `checkEffort` / `screenshotEffort`.
- `src/commands/check.ts`, `src/commands/screenshot.ts`, `src/cli.ts` — Register `work check` and `work screenshot`.
- `src/mcp/server.ts` & `src/mcp/server.test.ts` — Register `work_check` and `work_screenshot` MCP tools.

---

## 4. Testing & Verification Plan

1. **`storybrokr` Unit & Integration Tests:**
   - `discover.test.ts`: Verify root-only discovery when the target component/directory has its own `.stories.*`, automatic fallback when the target has 0 own stories, and explicit `{ includeChildren: true }` walking transitive child imports.
   - `registry.test.ts` & `broker.test.ts`: Verify two worktrees (`hostA`, `hostB`) with the same `component` path coexist, `resolve(component, hostA)` returns `hostA`'s instance, `resolve(component)` without `hostRoot` throws `INSTANCE_AMBIGUOUS`, `downByHost(hostA)` stops only `hostA`'s instances, and `reapIdle()` stops instances whose `hostRoot` was deleted from disk.
   - `inspector.test.ts`: Verify `check()` opens multiple pages concurrently up to `concurrency`, preserves story result order, and still acquires/closes a single `BrowserContext`.
   - `mcp/server.test.ts`, `client/index.test.ts`, `commands/*.test.ts`: Verify `--host`, `--include-children`, and `--concurrency` end-to-end.
2. **`workbrokr` Unit & Integration Tests:**
   - `effort.test.ts`: Verify `startEffort` passes `ttlMinutes` derived from `leaseTtlSeconds`, `statusFor`/`effortEnv` touch `storybrokrId`, `reapLeases`/`retireArea`/`finishEffort`/`promoteEffort` tear down worktree `storybrokr` instances, and `checkEffort`/`screenshotEffort` delegate with the effort's worktree `hostRoot`.
   - `mcp/server.test.ts`: Verify `work_check` and `work_screenshot`.
3. **Full Suite & E2E:**
   - `pnpm --filter @helmsmith/storybrokr test && pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr build`
   - `pnpm --filter @helmsmith/workbrokr test && pnpm --filter @helmsmith/workbrokr typecheck && pnpm --filter @helmsmith/workbrokr build`

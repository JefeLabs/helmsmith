# Storybrokr Worktree Isolation, Root-First Discovery, Parallel Check & Lease Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@helmsmith/storybrokr` (0.3.0) and `@helmsmith/workbrokr` (0.2.0) worktree-safe and fast by scoping instance resolution to `realpath(hostRoot)` with `STORYBROKR_HOST`/cwd hints and `INSTANCE_AMBIGUOUS` (409) errors, defaulting story discovery to root-first with automatic fallback and `--include-children`, running `storybrokr check` concurrently across isolated `BrowserContext` workers, and aligning `workbrokr` ↔ `storybrokr` TTLs, throttled touches, and host teardowns.

**Architecture:** `storybrokr` stays an independent daemon with its own registry and ports (`6100–6199`), while `Registry.resolve(idOrPath, scope)` gains `{ host?, hint? }` resolution backed by `realpathSync` host paths. `discoverStories` runs a two-phase BFS (root boundary first; transitive fallback when root stories are 0 or `includeChildren: true`), `inspector.check` runs a bounded worker pool where each worker acquires its own `BrowserContext`, and `workbrokr` emits `STORYBROKR_HOST`, passes `ttlMinutes = storybookHours * 60` on `up`, throttles `storybrokr.touch` to 60s in `touchEffort`, and calls `storybrokr.downHost` on finish, reap, and retire.

**Tech Stack:** TypeScript (ESM, Node 20+), Vitest, Playwright, Commander, Zod, `@modelcontextprotocol/sdk`.

## Global Constraints

- `@helmsmith/storybrokr` version bumps `0.2.0` → `0.3.0`; `@helmsmith/workbrokr` bumps `0.1.0` → `0.2.0` and gates `startEffort` in frontend mode on `storybrokr >= 0.3.0`.
- `storybrokr` stays independent (decision 14): no shared registry file, no `work check` / `work screenshot` wrapper commands in `workbrokr`.
- `hostRoot` is stored and compared as a `realpathSync` path everywhere.
- `DEFAULT_CONFIG.checkConcurrency` is `4`; `DEFAULT_CONFIG.instanceCap` is `10`.
- Parallel `check` uses **one `BrowserContext` per worker** so `localStorage`/`sessionStorage`/cookies never leak between concurrent stories.
- `touchEffort` in `workbrokr` stays synchronous and throttles `storybrokr.touch` calls to once per 60 seconds per lease.

---

### Task 1: Core Types, `INSTANCE_AMBIGUOUS`, Config Defaults, and Root-First Story Discovery

**Files:**
- Modify: `apps/storybrokr/src/types.ts`
- Modify: `apps/storybrokr/src/lib/errors.ts`
- Modify: `apps/storybrokr/src/lib/errors.test.ts`
- Modify: `apps/storybrokr/src/server/config.ts`
- Modify: `apps/storybrokr/src/server/config.test.ts`
- Modify: `apps/storybrokr/src/lib/discover.ts`
- Modify: `apps/storybrokr/src/lib/discover.test.ts`

**Interfaces:**
- Consumes: Existing `InstanceRecord`, `UpRequest`, `DaemonConfig`, `CheckRequest` in `apps/storybrokr/src/types.ts`.
- Produces:
  - `ResolveScope = { host?: string; hint?: string }` in `apps/storybrokr/src/types.ts`
  - `InstanceRecord.includeChildren?: boolean`, `UpRequest.includeChildren?: boolean`, `DaemonConfig.checkConcurrency: number`, `CheckRequest.concurrency?: number`
  - `ErrorCode` with `'INSTANCE_AMBIGUOUS'` (HTTP `409`) in `apps/storybrokr/src/lib/errors.ts`
  - `DEFAULT_CONFIG` with `instanceCap: 10, checkConcurrency: 4` in `apps/storybrokr/src/server/config.ts`
  - `discoverStories(hostRoot, component, tsconfigPaths, opts?: { includeChildren?: boolean }): DiscoveryResult` with `includedChildren: boolean` in `apps/storybrokr/src/lib/discover.ts`

- [ ] **Step 1: Write failing tests in `errors.test.ts`, `config.test.ts`, and `discover.test.ts`**

Update `apps/storybrokr/src/lib/discover.test.ts` to test root-first default discovery, `index.ts` intra-directory re-exports, leaf file `storyFilesFor`, automatic fallback when 0 root stories exist, and explicit `{ includeChildren: true }`:

```ts
  it('defaults to root-only stories when the component folder has its own stories, and includes children when requested', () => {
    const root = tree({
      'components/core/organisms/calendar/section/CalendarSection.tsx':
        "import { CalendarHeader } from '../molecules/CalendarHeader/CalendarHeader';\nimport { Switch } from '@core/atoms/switch/Switch';\nimport { fmt } from '../utils/fmt';\nexport const CalendarSection = () => null;\n",
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx':
        'export default {};\n',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.tsx':
        "import { CalendarViewTab } from '@core/atoms/CalendarViewTab/CalendarViewTab';\nexport const CalendarHeader = () => null;\n",
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx': '',
      'components/core/atoms/switch/Switch.tsx': 'export const Switch = () => null;\n',
      'components/core/atoms/switch/Switch.stories.tsx': '',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.tsx':
        'export const CalendarViewTab = () => null;\n',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx': '',
    });
    roots.push(root);
    const rootOnly = discoverStories(root, 'components/core/organisms/calendar/section', PATHS);
    expect(rootOnly.storyFiles).toEqual([
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx',
    ]);
    expect(rootOnly.includedChildren).toBe(false);

    const withChildren = discoverStories(
      root,
      'components/core/organisms/calendar/section',
      PATHS,
      { includeChildren: true },
    );
    expect(withChildren.storyFiles).toEqual([
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx',
      'components/core/atoms/switch/Switch.stories.tsx',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx',
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx',
    ]);
    expect(withChildren.includedChildren).toBe(true);
  });

  it('automatically falls back to transitive children when the root target has zero stories of its own', () => {
    const root = tree({
      'src/pages/HomePage.tsx': "import { Button } from '../Button/Button';\nexport const HomePage = () => null;\n",
      'src/Button/Button.tsx': 'export const Button = () => null;\n',
      'src/Button/Button.stories.tsx': '',
    });
    roots.push(root);
    const res = discoverStories(root, 'src/pages/HomePage.tsx', {});
    expect(res.storyFiles).toEqual(['src/Button/Button.stories.tsx']);
    expect(res.includedChildren).toBe(true);
  });

  it('leaf source file collects only its own storyFilesFor and excludes sibling imports unless includeChildren is set', () => {
    const root = tree({
      'src/Button.tsx': "import './Icon';\nexport const Button = () => null;\n",
      'src/Button.stories.tsx': '',
      'src/Icon.tsx': 'export const Icon = () => null;\n',
      'src/Icon.stories.tsx': '',
    });
    roots.push(root);
    const rootOnly = discoverStories(root, 'src/Button.tsx', {});
    expect(rootOnly.storyFiles).toEqual(['src/Button.stories.tsx']);
    expect(rootOnly.includedChildren).toBe(false);

    const withChildren = discoverStories(root, 'src/Button.tsx', {}, { includeChildren: true });
    expect(withChildren.storyFiles).toEqual(['src/Button.stories.tsx', 'src/Icon.stories.tsx']);
    expect(withChildren.includedChildren).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr test src/lib/discover.test.ts`
Expected: FAIL (`includedChildren` is undefined and root-only returns child stories).

- [ ] **Step 3: Implement types, `INSTANCE_AMBIGUOUS`, config defaults, and two-phase `discoverStories`**

In `apps/storybrokr/src/types.ts`:
- Add `export interface ResolveScope { host?: string; hint?: string; }`
- Add `includeChildren?: boolean;` to `InstanceRecord` and `UpRequest`
- Add `checkConcurrency: number;` to `DaemonConfig`
- Add `concurrency?: number;` to `CheckRequest`

In `apps/storybrokr/src/lib/errors.ts`:
- Add `'INSTANCE_AMBIGUOUS'` to `ErrorCode` and `INSTANCE_AMBIGUOUS: 409` to `STATUS`.

In `apps/storybrokr/src/server/config.ts`:
- Update `DEFAULT_CONFIG` with `instanceCap: 10` and `checkConcurrency: 4`.

In `apps/storybrokr/src/lib/discover.ts`:
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
Implement Phase 1 (root boundary check) and Phase 2 (transitive walk when `opts?.includeChildren === true` or Phase 1 found `0` stories). Specifically:
- If `STORY_RE.test(abs)` and `!opts?.includeChildren`, return `{ storyFiles: [relative(hostRoot, abs)], modulesVisited: 1, unresolved: [], includedChildren: false }`.
- Define `walk(stayInRoot: boolean)`:
  - If `stayInRoot`:
    - When `abs` is a non-index file (`!statSync(abs).isDirectory() && !/^index\.(tsx|ts|jsx|js)$/.test(basename(abs))`): visit only `abs`, collect `storyFilesFor(abs)`, and do not queue its imports.
    - When `abs` is a directory or an `index.*` file: let `boundary = statSync(abs).isDirectory() ? abs : dirname(abs)`. Only enqueue resolved imports `target` where `target === boundary || target.startsWith(`${boundary}/`)`.
  - When `!stayInRoot`: enqueue all local/alias imports not in `/node_modules/`.
- If `!opts?.includeChildren`:
  - Run `const rootRes = walk(true)`.
  - If `rootRes.storyFiles.length > 0`, return `{ ...rootRes, includedChildren: false }`.
- Run `const fullRes = walk(false)`.
- If `fullRes.storyFiles.length === 0`, throw `StorybrokrError('COMPONENT_NOT_FOUND', `no *.stories.* files reachable from ${component}`)`.
- Return `{ ...fullRes, includedChildren: !STORY_RE.test(abs) || Boolean(opts?.includeChildren) }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr test src/lib/errors.test.ts src/server/config.test.ts src/lib/discover.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/storybrokr/src/types.ts apps/storybrokr/src/lib/errors.ts apps/storybrokr/src/lib/errors.test.ts apps/storybrokr/src/server/config.ts apps/storybrokr/src/server/config.test.ts apps/storybrokr/src/lib/discover.ts apps/storybrokr/src/lib/discover.test.ts
git commit -m "feat(storybrokr): add root-first story discovery, INSTANCE_AMBIGUOUS error & config defaults"
```

---

### Task 2: Realpath Host Identity, `resolveTarget`, and Scoped Registry Resolution

**Files:**
- Modify: `apps/storybrokr/src/lib/host.ts`
- Modify: `apps/storybrokr/src/lib/host.test.ts`
- Modify: `apps/storybrokr/src/commands/_shared/output.ts`
- Modify: `apps/storybrokr/src/commands/_shared/output.test.ts`
- Modify: `apps/storybrokr/src/server/registry.ts`
- Modify: `apps/storybrokr/src/server/registry.test.ts`

**Interfaces:**
- Consumes: `ResolveScope`, `StorybrokrError('INSTANCE_AMBIGUOUS', ...)` from Task 1.
- Produces:
  - `realPathOrResolve(p: string): string` and realpath-normalized `findHostRoot` / `inspectHost` / `resolveHost` in `apps/storybrokr/src/lib/host.ts`
  - `resolveTarget(idOrPath: string, explicitHost?: string): { idOrPath: string; host?: string; hint?: string }` in `apps/storybrokr/src/commands/_shared/output.ts`
  - `Registry.resolve(idOrPath: string, scope?: ResolveScope | string): InstanceRecord` in `apps/storybrokr/src/server/registry.ts`

- [ ] **Step 1: Write failing tests in `host.test.ts`, `output.test.ts`, and `registry.test.ts`**

Add tests in `apps/storybrokr/src/commands/_shared/output.test.ts` for `resolveTarget` (12-hex id, `--host`, `STORYBROKR_HOST`, cwd inside host, bare string outside host) and in `apps/storybrokr/src/server/registry.test.ts` for `Registry.resolve` with `{ host }`, `{ hint }`, `INSTANCE_AMBIGUOUS`, and symlinked realpaths.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr test src/lib/host.test.ts src/commands/_shared/output.test.ts src/server/registry.test.ts`
Expected: FAIL (`resolveTarget` is not exported; `Registry.resolve` does not throw `INSTANCE_AMBIGUOUS`).

- [ ] **Step 3: Implement realpath normalization, `resolveTarget`, and `Registry.resolve`**

In `apps/storybrokr/src/lib/host.ts`:
- Add helper:
  ```ts
  export function realpathOrResolve(p: string): string {
    const abs = resolve(p);
    try {
      return realpathSync(abs);
    } catch {
      return abs;
    }
  }
  ```
- In `findHostRoot(startPath)`: normalize the returned `dir` via `realpathOrResolve(dir)`.
- In `inspectHost(hostRoot)`: normalize `hostRoot = realpathOrResolve(hostRoot)`.

In `apps/storybrokr/src/commands/_shared/output.ts`:
- Update `resolveComponent(pathArg: string)` so `abs` is resolved through `realpathOrResolve` when its parent exists.
- Implement `resolveTarget(idOrPath: string, explicitHost?: string): { idOrPath: string; host?: string; hint?: string }`:
  ```ts
  const ID_RE = /^[0-9a-f]{12}$/;

  function normalizeAgainstHost(idOrPath: string, hostDir: string): string {
    const hostRoot = realpathOrResolve(hostDir);
    if (isAbsolute(idOrPath)) {
      const abs = realpathOrResolve(idOrPath);
      const rel = relative(hostRoot, abs).split('\\').join('/');
      if (rel && !rel.startsWith('..')) return rel.replace(/\/+$/, '');
    }
    return idOrPath.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  export function resolveTarget(
    idOrPath: string,
    explicitHost?: string,
  ): { idOrPath: string; host?: string; hint?: string } {
    const host = explicitHost ? realpathOrResolve(explicitHost) : undefined;
    if (ID_RE.test(idOrPath)) {
      return host ? { idOrPath, host } : { idOrPath };
    }
    if (host) {
      return { idOrPath: normalizeAgainstHost(idOrPath, host), host };
    }
    const envHost = process.env.STORYBROKR_HOST?.trim();
    if (envHost) {
      const hint = realpathOrResolve(envHost);
      return { idOrPath: normalizeAgainstHost(idOrPath, hint), hint };
    }
    try {
      const { component, hostRoot } = resolveComponent(idOrPath);
      if (component && component !== '.' && !component.startsWith('..')) {
        return { idOrPath: component.replace(/\/+$/, ''), hint: hostRoot };
      }
    } catch {
      // Fall through to bare component string when cwd is outside any host repo
    }
    return { idOrPath: idOrPath.replace(/^\.\//, '').replace(/\/+$/, '') };
  }
  ```
- Also update `printInstance` and `printInstanceTable` to show `children: yes|no` in `printInstance`.

In `apps/storybrokr/src/server/registry.ts`:
- Update `find(hostRoot: string, component: string)` to compare `realpathOrResolve(r.hostRoot) === realpathOrResolve(hostRoot)`.
- Update `resolve(idOrPath: string, scope?: ResolveScope | string): InstanceRecord`:
  ```ts
  resolve(idOrPath: string, scope?: ResolveScope | string): InstanceRecord {
    const byId = this.byId.get(idOrPath);
    if (byId) return byId;
    const normScope: ResolveScope =
      typeof scope === 'string' ? { host: scope } : (scope ?? {});
    const all = this.list();
    if (normScope.host !== undefined) {
      const targetHost = realpathOrResolve(normScope.host);
      const match = all.find(
        (r) => r.component === idOrPath && realpathOrResolve(r.hostRoot) === targetHost,
      );
      if (match) return match;
      throw new StorybrokrError(
        'INSTANCE_NOT_FOUND',
        `no instance matches ${idOrPath} in host ${targetHost}`,
      );
    }
    if (normScope.hint !== undefined) {
      const hintHost = realpathOrResolve(normScope.hint);
      const hinted = all.find(
        (r) => r.component === idOrPath && realpathOrResolve(r.hostRoot) === hintHost,
      );
      if (hinted) return hinted;
    }
    const matches = all.filter((r) => r.component === idOrPath);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new StorybrokrError(
        'INSTANCE_AMBIGUOUS',
        `${idOrPath} is running in ${matches.length} hosts: ${matches.map((m) => `${m.id} @ ${m.hostRoot}`).join(', ')}; pass --host <dir> or an instance id`,
      );
    }
    throw new StorybrokrError('INSTANCE_NOT_FOUND', `no instance matches ${idOrPath}`);
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr test src/lib/host.test.ts src/commands/_shared/output.test.ts src/server/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/storybrokr/src/lib/host.ts apps/storybrokr/src/lib/host.test.ts apps/storybrokr/src/commands/_shared/output.ts apps/storybrokr/src/commands/_shared/output.test.ts apps/storybrokr/src/server/registry.ts apps/storybrokr/src/server/registry.test.ts
git commit -m "feat(storybrokr): add realpath host identity, resolveTarget & scoped Registry.resolve"
```

---

### Task 3: Broker Scope Threading, `downByHost`, Orphan Reaping, `includeChildren` Inheritance, and Parallel `inspector.check`

**Files:**
- Modify: `apps/storybrokr/src/server/broker.ts`
- Modify: `apps/storybrokr/src/server/broker.test.ts`
- Modify: `apps/storybrokr/src/server/inspector.ts`
- Modify: `apps/storybrokr/src/server/inspector.test.ts`
- Modify: `apps/storybrokr/src/server/daemon.ts`

**Interfaces:**
- Consumes: `ResolveScope`, `realpathOrResolve`, `discoverStories(..., { includeChildren })` from Tasks 1–2.
- Produces:
  - `Broker.list(scope?: { host?: string })`, `Broker.get(idOrPath, scope?)`, `Broker.touch(idOrPath, scope?)`, `Broker.logs(idOrPath, tail?, scope?)`, `Broker.logStream(idOrPath, scope?)`, `Broker.down(idOrPath, scope?)`, `Broker.downByHost(host: string): Promise<InstanceRecord[]>`
  - `Broker.reapIdle()` stopping instances whose `hostRoot` no longer exists on disk
  - `createInspector(deps: InspectorDeps)` with `defaultConcurrency?: number` and multi-context worker pool in `apps/storybrokr/src/server/inspector.ts`

- [ ] **Step 1: Write failing tests in `broker.test.ts` and `inspector.test.ts`**

In `apps/storybrokr/src/server/broker.test.ts`:
- Update existing `up` tests where `src/Button` is booted without `includeChildren` (it now discovers `['src/Button/Button.stories.tsx']` by default, and `['src/Button/Button.stories.tsx', 'src/Icon/Icon.stories.tsx']` with `includeChildren: true`).
- Add tests for:
  - `repeat up without includeChildren inherits existing record's includeChildren; explicit flip rebuilds`
  - `downByHost(hostA) stops only hostA instances and leaves hostB running`
  - `reapIdle stops an active instance whose hostRoot directory was removed`

In `apps/storybrokr/src/server/inspector.test.ts`:
- Update the first test and add concurrency tests verifying:
  - `check` acquires `min(concurrency, stories.length)` contexts (1 context per worker), preserves `stories` order in `results`, and a slow story in one worker does not block faster stories in parallel workers.
  - `concurrency: 1` acquires 1 context and runs stories serially.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr test src/server/broker.test.ts src/server/inspector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `Broker` updates, `createInspector` worker pool, and `daemon.ts` wiring**

In `apps/storybrokr/src/server/broker.ts`:
- Normalize `req.hostRoot` with `realpathOrResolve(req.hostRoot)` before calling `this.inspect(...)`.
- In `list(opts?: { host?: string })`: if `opts?.host`, filter by `realpathOrResolve(r.hostRoot) === realpathOrResolve(opts.host)`.
- Thread `scope?: ResolveScope | string` through `get`, `touch`, `logs`, `logStream`, `down`.
- Add `async downByHost(host: string): Promise<InstanceRecord[]>`:
  ```ts
  async downByHost(host: string): Promise<InstanceRecord[]> {
    const target = realpathOrResolve(host);
    const matching = this.registry
      .list()
      .filter((r) => realpathOrResolve(r.hostRoot) === target);
    for (const r of matching) await this.stop(r);
    return matching;
  }
  ```
- In `up(req: UpRequest)`:
  - When `existing?.status === 'ready'`:
    - `const effectiveIncludeChildren = req.includeChildren ?? existing.includeChildren ?? false;`
    - Run `const discovery = discoverStories(host.hostRoot, component, host.tsconfigPaths, { includeChildren: effectiveIncludeChildren });`
    - If `unchanged && Boolean(existing.includeChildren) === discovery.includedChildren`, touch and return `{ record, created: false }`.
    - Otherwise `await this.stop(existing)` and recreate with `{ ...req, includeChildren: effectiveIncludeChildren }`.
  - In `createInstance`: pass `{ includeChildren: req.includeChildren }` to `discoverStories` and store `includeChildren: discovery.includedChildren` on `record`.
- In `reapIdle()`:
  ```ts
  async reapIdle(): Promise<InstanceRecord[]> {
    const idle = this.registry.idleInstances();
    const orphaned = this.registry
      .list()
      .filter(
        (r) =>
          (r.status === 'starting' || r.status === 'ready') &&
          !existsSync(r.hostRoot) &&
          !idle.some((i) => i.id === r.id),
      );
    const toStop = [...idle, ...orphaned];
    for (const r of toStop) await this.stop(r);
    return toStop;
  }
  ```

In `apps/storybrokr/src/server/inspector.ts`:
- Add `defaultConcurrency?: number` to `InspectorDeps` (default `4`).
- In `check(record, req)`:
  ```ts
  assertReady(record);
  const stories = findStories(record, req.storyIds);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = new Array<CheckResult>(stories.length);
  if (stories.length > 0) {
    const workerCount = Math.max(
      1,
      Math.min(stories.length, req.concurrency ?? deps.defaultConcurrency ?? 4),
    );
    let nextIdx = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      const ctx = await deps.pool.acquire();
      try {
        await ctx.addInitScript(RECORDER_SCRIPT);
        const page = await ctx.newPage();
        for (;;) {
          const i = nextIdx++;
          if (i >= stories.length) break;
          const story = stories[i];
          const t0 = now();
          const outcome = await settle(page, {
            iframeUrl: story.iframeUrl,
            waitFor: req.waitFor,
            timeoutMs,
          });
          const durationMs = now() - t0;
          if (outcome.kind === 'pass') {
            results[i] = { storyId: story.id, status: 'pass', played: outcome.played, durationMs };
          } else if (outcome.kind === 'fail') {
            results[i] = {
              storyId: story.id,
              status: 'fail',
              played: false,
              durationMs,
              error:
                outcome.stack === undefined
                  ? { message: outcome.reason, event: outcome.event }
                  : { message: outcome.reason, event: outcome.event, stack: outcome.stack },
            };
          } else {
            const lastPhase = outcome.kind === 'timeout' ? outcome.lastPhase : undefined;
            results[i] = {
              storyId: story.id,
              status: 'timeout',
              played: false,
              durationMs,
              error: {
                message: `did not settle within ${timeoutMs}ms (last phase: ${lastPhase ?? 'none'})`,
                event: 'timeout',
              },
            };
          }
        }
      } finally {
        await ctx.close();
      }
    });
    await Promise.all(workers);
  }
  const summary = { pass: 0, fail: 0, timeout: 0 };
  for (const r of results) summary[r.status]++;
  return { instanceId: record.id, results, summary };
  ```

In `apps/storybrokr/src/server/daemon.ts`:
- Pass `defaultConcurrency: opts.config.checkConcurrency` to `createInspector({ pool, defaultConcurrency: opts.config.checkConcurrency })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr test src/server/broker.test.ts src/server/inspector.test.ts src/server/daemon.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/storybrokr/src/server/broker.ts apps/storybrokr/src/server/broker.test.ts apps/storybrokr/src/server/inspector.ts apps/storybrokr/src/server/inspector.test.ts apps/storybrokr/src/server/daemon.ts
git commit -m "feat(storybrokr): add broker host scoping, downByHost, orphan reaping & parallel check workers"
```

---

### Task 4: HTTP Routes, `DaemonClient`, CLI Commands, and MCP Server in `storybrokr`

**Files:**
- Modify: `apps/storybrokr/src/server/routes.ts`
- Modify: `apps/storybrokr/src/client/index.ts`
- Modify: `apps/storybrokr/src/client/index.test.ts`
- Modify: `apps/storybrokr/src/commands/up.ts`
- Modify: `apps/storybrokr/src/commands/up.test.ts`
- Modify: `apps/storybrokr/src/commands/get.ts`
- Modify: `apps/storybrokr/src/commands/down.ts`
- Modify: `apps/storybrokr/src/commands/down.test.ts`
- Modify: `apps/storybrokr/src/commands/touch.ts`
- Modify: `apps/storybrokr/src/commands/check.ts`
- Modify: `apps/storybrokr/src/commands/screenshot.ts`
- Modify: `apps/storybrokr/src/commands/logs.ts`
- Modify: `apps/storybrokr/src/commands/open.ts`
- Modify: `apps/storybrokr/src/commands/ls.ts`
- Modify: `apps/storybrokr/src/mcp/server.ts`
- Modify: `apps/storybrokr/src/mcp/server.test.ts`
- Modify: `apps/storybrokr/package.json`
- Modify: `apps/storybrokr/src/version.ts`
- Modify: `apps/storybrokr/README.md`
- Modify: `apps/storybrokr/SKILL.md`

**Interfaces:**
- Consumes: `ResolveScope`, `resolveTarget`, `Broker` methods, `CheckRequest.concurrency`, `UpRequest.includeChildren` from Tasks 1–3.
- Produces:
  - HTTP `/v1/instances` and `/v1/instances/:id/*` supporting `?host=` and `?hint=`, `DELETE /v1/instances?host=<dir>` returning `{ stopped: string[] }`, `includeChildren` on `POST /v1/instances`, `concurrency` on `POST /v1/instances/:id/check`.
  - `DaemonClient` methods accepting `scope?: ResolveScope` and `downByHost(host: string): Promise<string[]>`.
  - CLI commands with `--host <dir>`, `up --include-children`, `check --concurrency <n>`, `down --host <dir> [--json]`.
  - MCP tools with `hostRoot`, `includeChildren`, `concurrency`.
  - `@helmsmith/storybrokr` version `0.3.0`.

- [ ] **Step 1: Write failing tests in `client/index.test.ts`, `commands/up.test.ts`, `commands/down.test.ts`, and `mcp/server.test.ts`**

Add unit tests covering:
- `DaemonClient.list({ host })`, `get(id, scope)`, `downByHost(host)`, `check(id, req, scope)`
- `up --include-children` forwarding `includeChildren: true`
- `down --host <dir>` calling `downByHost`
- `mcp` tools forwarding `hostRoot`, `includeChildren`, `concurrency`, and `storybrokr_down` with `{ hostRoot }` alone.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr test src/client/index.test.ts src/commands/up.test.ts src/commands/down.test.ts src/mcp/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `routes.ts`, `DaemonClient`, CLI commands, MCP server, and version `0.3.0`**

1. In `apps/storybrokr/src/server/routes.ts`:
   - Add `includeChildren: z.boolean().optional()` to `UpBody`.
   - Add `concurrency: z.number().int().min(1).max(16).optional()` to `CheckBody`.
   - Extract `const scope = { host: url.searchParams.get('host') ?? undefined, hint: url.searchParams.get('hint') ?? undefined }`.
   - On `GET /v1/instances`: return `{ instances: ctx.broker.list({ host: scope.host }) }`.
   - On `DELETE /v1/instances` (when `parts.length === 2` and `scope.host`): `const stopped = await ctx.broker.downByHost(scope.host); return send(res, 200, { stopped: stopped.map(r => r.id) });`.
   - Pass `scope` to `ctx.broker.get(id, scope)`, `ctx.broker.down(id, scope)`, `ctx.broker.touch(id, scope)`, `ctx.broker.logs(id, tail, scope)`, `ctx.broker.logStream(id, scope)`.
2. In `apps/storybrokr/src/client/index.ts`:
   - Helper `scopeQuery(scope?: ResolveScope, extra?: Record<string, string>): string` to build query strings with `host` and `hint`.
   - Update `list(opts?: { host?: string })`, `get(id, scope?)`, `down(id, scope?)`, `downByHost(host)`, `touch(id, scope?)`, `check(id, req?, scope?)`, `screenshot(id, req, scope?)`, `logs(id, tail?, scope?)`, `follow(id, onLine, onEnd?, scope?)`.
3. In `apps/storybrokr/src/commands/`:
   - `up.ts`: add `--include-children` option and forward `includeChildren: Boolean(o.includeChildren)`.
   - `get.ts`, `touch.ts`, `check.ts`, `screenshot.ts`, `logs.ts`, `open.ts`: add `--host <dir>`, call `const target = resolveTarget(idOrPath, o.host)`, and pass `{ host: target.host, hint: target.hint }` to `client`.
   - `check.ts`: add `--concurrency <n>` (`parseIntegerInRange(1, 16)`) and forward `concurrency: o.concurrency`.
   - `down.ts`: add `--host <dir>` and `--json`; when `o.host && !idOrPath`, call `const stopped = await client.downByHost(resolve(o.host))` (if `o.json`, `printJson({ stopped })`, else `console.log(...)`). When `idOrPath` is given, resolve via `resolveTarget(idOrPath, o.host)` and call `client.down(target.idOrPath, { host: target.host, hint: target.hint })`.
   - `ls.ts`: add `--host <dir>` and pass `{ host: o.host ? resolve(o.host) : undefined }` to `client.list(...)`.
4. In `apps/storybrokr/src/mcp/server.ts`:
   - Add `includeChildren: z.boolean().optional()` to `storybrokr_up`.
   - Add `hostRoot: z.string().optional()` to `storybrokr_list`, `storybrokr_get`, `storybrokr_down` (making `id` optional when `hostRoot` is provided), `storybrokr_touch`, `storybrokr_check`, `storybrokr_screenshot`, `storybrokr_logs`.
   - Add `concurrency: z.number().int().min(1).max(16).optional()` to `storybrokr_check`.
   - Use `resolveTarget(id, hostRoot)` in `get`, `down`, `touch`, `check`, `screenshot`, `logs`.
5. Bump version to `0.3.0` in `apps/storybrokr/package.json` and `apps/storybrokr/src/version.ts` (if hardcoded), and update `apps/storybrokr/README.md` and `apps/storybrokr/SKILL.md`.

- [ ] **Step 4: Run all `storybrokr` unit tests and typecheck**

Run: `pnpm --filter @helmsmith/storybrokr test && pnpm --filter @helmsmith/storybrokr typecheck`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/storybrokr/src/server/routes.ts apps/storybrokr/src/client/index.ts apps/storybrokr/src/client/index.test.ts apps/storybrokr/src/commands/ apps/storybrokr/src/mcp/ apps/storybrokr/package.json apps/storybrokr/src/version.ts apps/storybrokr/README.md apps/storybrokr/SKILL.md
git commit -m "feat(storybrokr): expose --host, --include-children, --concurrency across HTTP, CLI & MCP (0.3.0)"
```

---

### Task 5: Lease-Aligned Lifecycle & `STORYBROKR_HOST` in `workbrokr`

**Files:**
- Modify: `apps/workbrokr/src/core/config.ts`
- Modify: `apps/workbrokr/src/core/config.test.ts`
- Modify: `apps/workbrokr/src/core/manifest.ts`
- Modify: `apps/workbrokr/src/core/manifest.test.ts`
- Modify: `apps/workbrokr/src/lib/storybrokr.ts`
- Modify: `apps/workbrokr/src/lib/effort.ts`
- Modify: `apps/workbrokr/src/lib/effort.test.ts`
- Modify: `apps/workbrokr/package.json`
- Modify: `apps/workbrokr/SKILL.md`

**Interfaces:**
- Consumes: `storybrokr` 0.3.0 CLI flags (`--ttl`, `--include-children`, `down --host <dir> --json`, `touch <id> --host <dir>`, `--version`).
- Produces:
  - `STORYBROKR_HOST` in `slotVars` (`apps/workbrokr/src/core/config.ts`) and `templateVariables` (`apps/workbrokr/src/core/manifest.ts`)
  - `storybookHostFor(m: Manifest, worktree: string): string` in `apps/workbrokr/src/core/config.ts` (re-exported from `src/core/index.ts`)
  - Extended `StorybrokrClient` in `apps/workbrokr/src/lib/storybrokr.ts` (`up` with `{ ttlMinutes?, includeChildren? }`, `down(id, hostRoot?)`, `downHost(hostRoot)`, `touch(id, hostRoot?)`, `version()`)
  - Version gate (`>= 0.3.0`), `ttlMinutes = Math.ceil(m.expiry.storybookHours * 60)`, 60s-throttled `touchEffort`, and `downHost` on `finishEffort`, `reapLeases`, and `retireArea` in `apps/workbrokr/src/lib/effort.ts`.

- [ ] **Step 1: Write failing tests in `config.test.ts`, `manifest.test.ts`, and `effort.test.ts`**

Add tests in:
- `apps/workbrokr/src/core/config.test.ts` & `manifest.test.ts`: `STORYBROKR_HOST` is allowed in `env.template` and populated by `slotVars` as `join(worktree, m.storybook.hostRoot)` (or `worktree` when `m.storybook` is absent).
- `apps/workbrokr/src/lib/effort.test.ts`:
  - `startEffort` passes `{ ttlMinutes: m.expiry.storybookHours * 60 }` to `storybrokr.up` on both fresh start and `--join` late story attachment, and refuses `storybrokr` version `< 0.3.0` with `STORYBROKR_FAILED`.
  - `touchEffort` calls `storybrokr.touch(id, host)` only when the lease's `touched` timestamp is older than 60 seconds.
  - `finishEffort`, `reapLeases`, and `retireArea` call `storybrokr.downHost(storybookHostFor(m, worktree))` before removing any worktree directory.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/config.test.ts src/core/manifest.test.ts src/lib/effort.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `STORYBROKR_HOST`, `StorybrokrClient`, and `effort.ts` lifecycle alignment**

1. In `apps/workbrokr/src/core/config.ts`:
   ```ts
   export function storybookHostFor(m: Manifest, worktree?: string): string {
     if (!worktree) return '';
     return m.storybook ? join(worktree, m.storybook.hostRoot) : worktree;
   }
   ```
   Include `STORYBROKR_HOST: storybookHostFor(m, o.worktree)` in `slotVars`. Export `storybookHostFor` from `apps/workbrokr/src/core/index.ts`.
2. In `apps/workbrokr/src/core/manifest.ts`:
   Add `'STORYBROKR_HOST'` to `templateVariables`.
3. In `apps/workbrokr/src/lib/storybrokr.ts`:
   ```ts
   export interface StorybrokrUpOptions {
     ttlMinutes?: number;
     includeChildren?: boolean;
   }

   export interface StorybrokrClient {
     up(story: string, hostRoot: string, opts?: StorybrokrUpOptions): Promise<StorybrokrInstance>;
     down(id: string, hostRoot?: string): Promise<void>;
     downHost?(hostRoot: string): Promise<string[]>;
     touch?(id: string, hostRoot?: string): void;
     version?(): string;
   }
   ```
   Implement `up`, `down`, `downHost`, `touch`, and `version` on `storybrokrCli`.
4. In `apps/workbrokr/src/lib/effort.ts`:
   - Add `assertStorybrokrVersion(ctx: Ctx)` called before `ctx.storybrokr.up`: if `ctx.storybrokr.version` is defined, parse `<major>.<minor>.<patch>` and throw `WorkkitError('STORYBROKR_FAILED', `storybrokr 0.3.0 or newer is required; found ${ver}`)` if `< 0.3.0`.
   - Pass `{ ttlMinutes: Math.ceil(m.expiry.storybookHours * 60) }` to `ctx.storybrokr.up` in both `startEffort` call sites (and in `promoteEffort` if `o.story` is provided).
   - In `touchEffort(ctx, effort)`:
     ```ts
     const host = storybookHostFor(ctx.manifest, effort.worktree);
     for (const l of ctx.registry.leases({ effort: effort.id })) {
       if (l.kind === 'storybook' && Date.now() - Date.parse(l.touched) >= 60_000) {
         try {
           ctx.storybrokr.touch?.(String(l.value), host);
         } catch (err) {
           ctx.log(`storybrokr touch ${l.value} failed: ${(err as Error).message}`);
         }
       }
       ctx.registry.touch(l.id, hoursFor(ctx.manifest, l.kind));
     }
     ```
   - In `releaseLease`: pass `effort ? storybookHostFor(ctx.manifest, effort.worktree) : undefined` to `ctx.storybrokr.down(String(lease.value), host)`.
   - In `finishEffort`, `reapLeases`, and `retireArea`: when the worktree exists on disk, call `await ctx.storybrokr.downHost?.(storybookHostFor(m, worktree)).catch((e) => ctx.log(...))` before any `worktreeRemove`.
5. Bump `@helmsmith/workbrokr` version to `0.2.0` in `apps/workbrokr/package.json` and `apps/workbrokr/src/cli.ts` / `apps/workbrokr/src/mcp/server.ts` (if needed), and update `apps/workbrokr/SKILL.md`.

- [ ] **Step 4: Run `workbrokr` unit and e2e tests**

Run: `pnpm --filter @helmsmith/workbrokr test && pnpm --filter @helmsmith/workbrokr typecheck && pnpm --filter @helmsmith/workbrokr test:e2e`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/workbrokr/src/core/config.ts apps/workbrokr/src/core/config.test.ts apps/workbrokr/src/core/index.ts apps/workbrokr/src/core/manifest.ts apps/workbrokr/src/core/manifest.test.ts apps/workbrokr/src/lib/storybrokr.ts apps/workbrokr/src/lib/effort.ts apps/workbrokr/src/lib/effort.test.ts apps/workbrokr/package.json apps/workbrokr/SKILL.md
git commit -m "feat(workbrokr): align storybrokr lease TTL, throttled touch, downHost & STORYBROKR_HOST (0.2.0)"
```

---

### Task 6: E2E Worktree Isolation, Root-First Render, and Concurrency Tests in `storybrokr`

**Files:**
- Create: `apps/storybrokr/tests/e2e/worktrees.test.ts`
- Modify: `apps/storybrokr/tests/e2e/up-down.test.ts`
- Modify: `apps/storybrokr/tests/e2e/render.test.ts`
- Modify: `apps/storybrokr/tests/e2e/inspect.test.ts`
- Modify: `apps/storybrokr/tests/e2e/mcp.test.ts`

**Interfaces:**
- Consumes: Built `storybrokr` CLI (`dist/cli.js`) and daemon (`dist/server/start.js`) from Tasks 1–4.
- Produces: End-to-end verification of multi-worktree isolation, `INSTANCE_AMBIGUOUS`, `--host`, `STORYBROKR_HOST`, `down --host`, orphan reaping, `--include-children`, and `--concurrency`.

- [ ] **Step 1: Update `up-down.test.ts`, `render.test.ts`, `inspect.test.ts`, `mcp.test.ts`, and create `worktrees.test.ts`**

1. In `apps/storybrokr/tests/e2e/up-down.test.ts`:
   - Verify default `up src/components/Panel --host <FIXTURE_HOST>` discovers only `['src/components/Panel/Panel.stories.tsx']` (3 stories), and `up src/components/Panel --host <FIXTURE_HOST> --include-children` respawns with all 3 story files (`Button`, `Icon`, `Panel`, 6 stories).
2. In `apps/storybrokr/tests/e2e/render.test.ts`:
   - Verify Panel renders its own story by default (with child Button component still rendered inside Panel's JSX), and only Panel's 3 stories are in `rec.stories`.
3. In `apps/storybrokr/tests/e2e/inspect.test.ts`:
   - Update expected summary for root-only Panel (`{ pass: 2, fail: 1, timeout: 0 }`) and verify `check --concurrency 4` and `check --concurrency 1` return identical statuses in identical order.
4. In `apps/storybrokr/tests/e2e/mcp.test.ts`:
   - Verify `storybrokr_check` with `hostRoot` and with `STORYBROKR_HOST` in the MCP server's environment.
5. Create `apps/storybrokr/tests/e2e/worktrees.test.ts`:
   - Create two worktree-like host directories `hostA` and `hostB` (sharing `node_modules` via symlink to `FIXTURE_HOST/node_modules`, just like git worktrees or seeded worktrees).
   - Boot `src/components/Button` in both `hostA` and `hostB`.
   - Verify unqualified `check src/components/Button` from outside both hosts exits `1` with `INSTANCE_AMBIGUOUS`.
   - Verify `check src/components/Button --host <hostB>` checks `hostB`'s instance.
   - Verify `STORYBROKR_HOST=<hostA> check src/components/Button` checks `hostA`'s instance.
   - Verify `down --host <hostA>` stops `hostA` while leaving `hostB` running.
   - Remove `hostB` directory (`rmSync(hostB, { recursive: true, force: true })`) and verify `reapIdle` removes `hostB` from `ls`.

- [ ] **Step 2: Run the full `storybrokr` build and E2E suite**

Run: `pnpm --filter @helmsmith/storybrokr test:e2e`
Expected: PASS

- [ ] **Step 3: Commit Task 6**

```bash
git add apps/storybrokr/tests/e2e/
git commit -m "test(storybrokr): add worktree isolation, root-first discovery & concurrency e2e tests"
```

# workbrokr Phase 1 Implementation Plan (helmsmith packages)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@helmsmith/workkit` (shared core: registry, leases, ports, scopes, git, guards, config, refresh, runner) and `@helmsmith/workbrokr` (the `work` CLI, MCP server and skill) so one command starts an area's work from the latest base branch, runs it in frontend or fullstack mode, and the same tool finishes, reaps, retires and audits.

**Architecture:** `platform/core/workkit-lib` exports TypeScript source (no build, like the other shared libs) and knows nothing about any project; every project fact comes from `helmsmith.config.{ts,mjs,json}`. `apps/workbrokr` is a thin commander CLI (via `@helmsmith/cli-kit`) plus an MCP server over the same functions; tsup inlines workkit into `dist/cli.js`. State lives in one JSON registry at `~/.cache/helmsmith/registry.json`, written atomically under a directory lock. The fullstack runner spawns the manifest's service commands and polls their health commands; the frontend runner shells out to the installed `storybrokr` CLI.

**Tech Stack:** Node ≥ 24 (TypeScript manifests load through Node's built-in type stripping), pnpm 9.15.9 workspace, commander 15 via `@helmsmith/cli-kit`, zod, picomatch, chalk, `@modelcontextprotocol/sdk`, vitest 5, tsup 8, Biome 2.

**Spec:** `docs/superpowers/specs/2026-10-17-workbrokr-design.md` (this repo, branch `feature/workbrokr`). Second plan (skoolscout-com adoption): `2026-10-17-workbrokr-phase-1b-skoolscout-adoption.md`, written after this one.

## Global Constraints

- Node `>=24`; ESM only (`"type": "module"`); TypeScript extends `tsconfig.base.json`; imports between source files use the `.js` suffix (Bundler resolution, as storybrokr does).
- Shared lib directory ends in `-lib`, package name drops it: `platform/core/workkit-lib` → `@helmsmith/workkit`, `"main": "./src/index.ts"`, no build step. App bundles it: tsup `noExternal: [/^@helmsmith\//]`.
- Branch = `<type>/<area>`; types default `feature | chore | fix`; areas are leaves; one open effort per area; `finish` keeps worktree and branch; `retire` is the only destructive verb.
- Sync = fast-forward or merge from `origin/<baseBranch>`, never rebase; a conflict stops before any lease.
- The tool never writes to the main checkout except `fetch` and fast-forwarding the base branch; `start` refuses the main checkout and any protected branch.
- Only processes the registry started are ever stopped; nothing is killed by port or by name.
- Registry: `$HELMSMITH_HOME` or `~/.cache/helmsmith`, file `registry.json`, version 1, atomic temp-file + rename under a `registry.lock` directory lock.
- Exit codes: 0 ok, 2 refused (first stderr line = reason), 1 error. Every command has `--json`.
- Biome clean (`pnpm check` at repo root), `pnpm -r typecheck` clean, each package's `vitest run` green before every commit.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Spec amendments this plan makes (ruled during planning, recorded in §16 of the spec on completion): (a) `ports.block` is replaced by per-service ranges `[base, base + slots.count)`, which the registry claims per project; (b) in phase 1 frontend mode does not lease a Storybook port because `storybrokr up` has no `--port`; the lease records the instance id and the port storybrokr chose; (c) impact notices in phase 1 are commons-based ("commons X changed on branch Y"), the import-graph version stays "later".

## Review Focus

1. Two `work start` calls racing for the lowest free slot must get different slots (Task 3 test `allocateSlot under contention`).
2. A manifest naming an area that is a prefix of another area (`a` and `a/b`) must be rejected at load, not discovered as a git ref error at branch creation (Task 2 test `rejects an area that is an ancestor of another`).
3. A sync that conflicts must leave no lease behind and must report the conflicted files (Task 11 test `conflict stops before any lease`).
4. `reap` must stop only the pids a lease recorded, never a process on the same port started elsewhere (Task 13 test `reap ignores a foreign process on the slot's port`).
5. `hook pre-commit` must refuse a commit on a protected branch even when no effort or registry exists (Task 7 test `refuses on develop with an empty registry`).

---

## File structure

```
platform/core/workkit-lib/
  package.json  tsconfig.json  vitest.config.ts  README.md
  src/index.ts            re-exports
  src/types.ts            Manifest, Area, Lease, Effort, RegistryFile, Owner, Mode, Notice
  src/errors.ts           WorkkitError + codes + exit-code mapping
  src/manifest.ts         loadManifest(repoRoot) → Manifest (zod schema, leaf/prefix/type checks)
  src/registry.ts         Registry: load/save/lock, projects, leases, efforts, expiry
  src/ports.ts            portsForSlot, claimRanges, rangesOverlap
  src/scopes.ts           expandScopes, globsOverlap, pathsMatching, commonsTouched
  src/git.ts              Git class: exec wrapper + the operations the verbs need
  src/guards.ts           checkCommit, checkPush, assertNotMainCheckout, assertNotProtected
  src/hooks.ts            installHooks(repoRoot) → .helmsmith/hooks/* + core.hooksPath
  src/config.ts           emitWorktreeConfig, renderTemplate
  src/refresh.ts          selectRefresh, runRefresh
  src/runner.ts           startServices, waitHealthy, stopServices (sh -c, detached, pid recorded)
  src/session.ts          currentOwner()
  src/testing/fixture-repo.ts   makeRepo(): bare origin + clone with base branch (used by tests)
  src/**/*.test.ts        one per module

apps/workbrokr/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  vitest.e2e.config.ts
  bin/workbrokr.mjs  bin/work.mjs  README.md  SKILL.md
  src/cli.ts  src/version.ts
  src/commands/_shared/output.ts   printJson, fail, exit codes
  src/commands/{init,start,status,finish,reap,retire,audit,env,hook,mcp}.ts
  src/lib/effort.ts       startEffort, finishEffort, reapLeases, retireArea, auditProject, effortEnv
  src/lib/storybrokr.ts   frontend runner over the storybrokr CLI (injectable for tests)
  src/mcp/server.ts
  tests/e2e/helpers.ts    runCli(bin) with HELMSMITH_HOME per test
  tests/e2e/fixtures/project/  helmsmith.config.mjs + services/http.mjs (tiny HTTP "services")
  tests/e2e/*.test.ts
```

---

### Task 0: Scaffold both packages

**Files:**
- Create: `platform/core/workkit-lib/package.json`, `platform/core/workkit-lib/tsconfig.json`, `platform/core/workkit-lib/vitest.config.ts`, `platform/core/workkit-lib/src/index.ts`
- Create: `apps/workbrokr/package.json`, `apps/workbrokr/tsconfig.json`, `apps/workbrokr/tsup.config.ts`, `apps/workbrokr/vitest.config.ts`, `apps/workbrokr/vitest.e2e.config.ts`, `apps/workbrokr/bin/workbrokr.mjs`, `apps/workbrokr/bin/work.mjs`, `apps/workbrokr/src/version.ts`, `apps/workbrokr/src/cli.ts`
- Modify: `Makefile:24` (PUBLISH_PKGS, append the two packages after cli-kit)

**Interfaces:**
- Produces: workspace packages `@helmsmith/workkit` (source export) and `@helmsmith/workbrokr` (bins `workbrokr`, `work`); `VERSION` constant.

- [ ] **Step 1: Write the smoke test (e2e) that fails until the bin exists**

`apps/workbrokr/tests/e2e/helpers.ts`:
```ts
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN = join(APP_ROOT, 'bin', 'work.mjs');

export interface CliResult { code: number | null; stdout: string; stderr: string }

/** A fresh HELMSMITH_HOME per test file so registries never collide. */
export function makeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'workbrokr-e2e-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function runCli(
  args: string[],
  opts: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? APP_ROOT,
      env: { ...process.env, ...opts.env, HELMSMITH_HOME: opts.home, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timed out: work ${args.join(' ')}\n${stderr}`));
    }, opts.timeoutMs ?? 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
```

`apps/workbrokr/tests/e2e/version.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import { makeHome, runCli } from './helpers.js';

describe('work --version', () => {
  const { home, cleanup } = makeHome();
  afterAll(cleanup);
  it('prints the package version and exits 0', async () => {
    const r = await runCli(['--version'], { home });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/workbrokr && pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/version.test.ts`
Expected: FAIL (no `vitest.e2e.config.ts` / no bin yet: "Cannot find module" or ENOENT on `bin/work.mjs`).

- [ ] **Step 3: Create the workkit package**

`platform/core/workkit-lib/package.json`:
```json
{
  "name": "@helmsmith/workkit",
  "version": "0.0.1",
  "description": "Shared core for helmsmith brokers: lease registry, slots and ports, worktree and branch operations, manifest, scopes, guards, config emitter, service runner.",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=24" },
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src", "README.md"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "picomatch": "^4.0.3", "zod": "^4.3.6" },
  "devDependencies": { "@types/node": "^24.13.3", "@types/picomatch": "^4.0.2", "typescript": "^7.0.2", "vitest": "^5.0.0" }
}
```
(Use the zod and `@types/node` versions `apps/storybrokr/package.json` pins; copy them verbatim if they differ from the above.)

`platform/core/workkit-lib/tsconfig.json`:
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`platform/core/workkit-lib/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 20_000 } });
```

`platform/core/workkit-lib/src/index.ts`: `export const WORKKIT = 'workkit';` (replaced by real exports in later tasks).

- [ ] **Step 4: Create the workbrokr app**

`apps/workbrokr/package.json`:
```json
{
  "name": "@helmsmith/workbrokr",
  "version": "0.0.1",
  "description": "Start, run, finish, reap and audit area-based work: one worktree per area, <type>/<area> branches, slots and leases from one registry, storybrokr for frontend work. CLI, MCP server and skill.",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=24" },
  "bin": { "workbrokr": "./bin/workbrokr.mjs", "work": "./bin/work.mjs" },
  "main": "./dist/cli.js",
  "files": ["dist", "bin", "README.md", "SKILL.md"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:e2e": "pnpm run build && vitest run --config vitest.e2e.config.ts",
    "typecheck": "tsc --noEmit",
    "prepack": "pnpm run build"
  },
  "dependencies": {
    "@helmsmith/cli-kit": "workspace:*",
    "@helmsmith/workkit": "workspace:*",
    "@modelcontextprotocol/sdk": "<same version as apps/storybrokr>",
    "chalk": "<same as storybrokr>",
    "commander": "<same as storybrokr>",
    "zod": "<same as storybrokr>"
  },
  "devDependencies": { "@types/node": "^24.13.3", "tsup": "^8.5.1", "tsx": "^4.23.13", "typescript": "^7.0.2", "vitest": "^5.0.0" }
}
```
Replace each `<same as storybrokr>` with the exact range from `apps/storybrokr/package.json` (the root `overrides` pin commander, tsup and vitest anyway).

`apps/workbrokr/tsconfig.json`: copy `apps/storybrokr/tsconfig.json` verbatim.

`apps/workbrokr/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  noExternal: [/^@helmsmith\//],
  external: [/^[^@./]/, /^@(?!helmsmith\/)/],
});
```

`apps/workbrokr/vitest.config.ts`: copy storybrokr's. `apps/workbrokr/vitest.e2e.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/e2e/**/*.test.ts'], testTimeout: 120_000, fileParallelism: false } });
```

`apps/workbrokr/bin/workbrokr.mjs` and `apps/workbrokr/bin/work.mjs` (identical):
```js
#!/usr/bin/env node
// Plain re-export of the tsup bundle so npm consumers get a runnable bin without a build step.
await import('../dist/cli.js');
```
`chmod +x` both.

`apps/workbrokr/src/version.ts`: copy `apps/storybrokr/src/version.ts` verbatim.

`apps/workbrokr/src/cli.ts`:
```ts
import { createCli } from '@helmsmith/cli-kit';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'work',
  version: VERSION,
  description: 'Area-based work: start, status, finish, reap, retire, audit.',
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 5: Install, build, run the smoke test**

Run: `pnpm install && pnpm --filter @helmsmith/workbrokr build && cd apps/workbrokr && pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/version.test.ts`
Expected: PASS 1/1 (`0.0.1`). Also `pnpm -r typecheck` passes for both packages and `pnpm check` is clean.

- [ ] **Step 6: Add the packages to the publish allowlist and commit**

In `Makefile` line 24 append ` @helmsmith/workkit @helmsmith/workbrokr` to `PUBLISH_PKGS` (workkit before workbrokr, after cli-kit; the comment block above it lists the order rule).

```bash
git add platform/core/workkit-lib apps/workbrokr Makefile pnpm-lock.yaml
git commit -m "chore(workbrokr): scaffold @helmsmith/workkit and @helmsmith/workbrokr

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: workkit types and errors

**Files:**
- Create: `platform/core/workkit-lib/src/types.ts`, `platform/core/workkit-lib/src/errors.ts`
- Test: `platform/core/workkit-lib/src/errors.test.ts`

**Interfaces:**
- Produces: every type below; `WorkkitError`, `ErrorCode`, `exitCodeFor(code)`, `toErrorBody(err)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { WorkkitError, exitCodeFor, toErrorBody } from './errors.js';

describe('WorkkitError', () => {
  it('maps refusals to exit 2 and faults to exit 1', () => {
    expect(exitCodeFor('SCOPE_CONFLICT')).toBe(2);
    expect(exitCodeFor('PROTECTED_BRANCH')).toBe(2);
    expect(exitCodeFor('GIT_FAILED')).toBe(1);
    expect(exitCodeFor('INTERNAL')).toBe(1);
  });
  it('serialises with code, message and details; unknown errors become INTERNAL', () => {
    const e = new WorkkitError('EFFORT_OPEN', 'an effort is open', { owner: 's1' });
    expect(toErrorBody(e)).toEqual({ code: 'EFFORT_OPEN', message: 'an effort is open', details: { owner: 's1' } });
    expect(toErrorBody(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
```

- [ ] **Step 2: Run it** — `cd platform/core/workkit-lib && pnpm exec vitest run src/errors.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write types.ts**

```ts
export type Mode = 'frontend' | 'fullstack';
export type EffortState = 'active' | 'parked' | 'finished';
export type LeaseKind = 'slot' | 'storybook' | 'commons';

export interface ServiceSpec {
  start: string;
  stop: string;
  health: string;
  /** stdout of `health` (trimmed) must be one of these; absent = exit code 0 is healthy */
  healthyCodes?: number[];
  reset?: string;
  healthTimeoutMs?: number; // default 180_000
}
export interface RefreshEntry { when?: string; always?: boolean; run?: string; mark?: string }
export interface AreaSpec { module?: string; commons?: string[]; extraScopes?: string[] }
export interface ArchiveSpec { paths: string[]; keepDays: number; keepPerArea: number }

export interface Manifest {
  project: string;
  baseBranch: string;
  protectedBranches: string[];
  worktreeRoot: string;
  branch: { types: string[] };
  slots: { count: number; reserved: number[] };
  /** slot-0 port per service; slot N = base + N; the project claims [base, base + count) per service */
  ports: { services: Record<string, { base: number }> };
  /** insertion order = start order */
  services: Record<string, ServiceSpec>;
  storybook?: { hostRoot: string };
  logs: { dir: string };
  env: { file: string; template: Record<string, string> };
  refresh: RefreshEntry[];
  scopes: { frontend: string[]; backend: string[] };
  areas: Record<string, AreaSpec>;
  commons: Record<string, string[]>;
  expiry: { slotHours: number; commonsHours: number; storybookHours: number };
  archive: ArchiveSpec;
}

export interface Owner { session: string; pid: number }
export interface Notice { from: string; text: string; at: string }

export interface Lease {
  id: string;
  project: string;
  kind: LeaseKind;
  /** slot number, storybrokr instance id, or commons name */
  value: string | number;
  ports?: Record<string, number>;
  /** pids this lease started (fullstack services); the only processes reap/finish may stop */
  pids?: number[];
  owner: Owner;
  effort: string;
  created: string;
  touched: string;
  expires: string;
}

export interface Effort {
  id: string;
  project: string;
  area: string;
  type: string;
  mode: Mode;
  branch: string;
  worktree: string;
  owner: Owner;
  state: EffortState;
  scopes: string[];
  commons: string[];
  leases: string[];
  notices: Notice[];
  started: string;
  lastActivity: string;
  parkedReason?: string;
}

export interface ProjectEntry {
  root: string;
  /** per service: [base, base + count) */
  ranges: Record<string, { base: number; count: number }>;
}

export interface RegistryFile {
  version: 1;
  projects: Record<string, ProjectEntry>;
  leases: Lease[];
  efforts: Effort[];
}
```

- [ ] **Step 4: Write errors.ts**

```ts
export type ErrorCode =
  | 'MANIFEST_NOT_FOUND' | 'MANIFEST_INVALID'
  | 'AREA_UNKNOWN' | 'TYPE_UNKNOWN' | 'MODE_UNKNOWN'
  | 'MAIN_CHECKOUT' | 'PROTECTED_BRANCH'
  | 'EFFORT_OPEN' | 'EFFORT_NOT_FOUND' | 'SCOPE_CONFLICT' | 'COMMONS_LOCKED'
  | 'NO_FREE_SLOT' | 'LEASE_NOT_FOUND' | 'PORT_RANGE_TAKEN'
  | 'SYNC_CONFLICT' | 'DIRTY_WORKTREE' | 'UNPUSHED'
  | 'HEALTH_TIMEOUT' | 'SERVICE_FAILED' | 'STORYBROKR_FAILED'
  | 'GIT_FAILED' | 'INTERNAL';

const REFUSALS = new Set<ErrorCode>([
  'MANIFEST_INVALID', 'AREA_UNKNOWN', 'TYPE_UNKNOWN', 'MODE_UNKNOWN', 'MAIN_CHECKOUT',
  'PROTECTED_BRANCH', 'EFFORT_OPEN', 'EFFORT_NOT_FOUND', 'SCOPE_CONFLICT', 'COMMONS_LOCKED',
  'NO_FREE_SLOT', 'LEASE_NOT_FOUND', 'PORT_RANGE_TAKEN', 'SYNC_CONFLICT', 'DIRTY_WORKTREE', 'UNPUSHED',
]);

/** 2 = refused (a rule said no), 1 = something broke. */
export function exitCodeFor(code: ErrorCode): 1 | 2 {
  return REFUSALS.has(code) ? 2 : 1;
}

export class WorkkitError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkkitError';
    this.code = code;
    if (details) this.details = details;
  }
}

export interface ErrorBody { code: ErrorCode; message: string; details?: Record<string, unknown> }

/** Shape every surface (CLI --json, MCP) returns for a failure. */
export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof WorkkitError) {
    return err.details ? { code: err.code, message: err.message, details: err.details } : { code: err.code, message: err.message };
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}
```

- [ ] **Step 5: Run** → PASS 2/2. Replace `src/index.ts` with `export * from './types.js'; export * from './errors.js';`.

- [ ] **Step 6: Commit** — `git add platform/core/workkit-lib/src && git commit -m "feat(workkit): types and error model" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 2: Manifest loader and validation

**Files:**
- Create: `platform/core/workkit-lib/src/manifest.ts`
- Test: `platform/core/workkit-lib/src/manifest.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `WorkkitError`.
- Produces: `loadManifest(repoRoot: string): Promise<Manifest>`, `validateManifest(raw: unknown): Manifest`, `MANIFEST_FILES = ['helmsmith.config.ts','helmsmith.config.mjs','helmsmith.config.json']`, `DEFAULTS` (expiry 12/4/2 h, archive keepDays 30 keepPerArea 5, branch types, worktreeRoot `.claude/worktrees`, logs dir `.logs`, env file `.env.slot`).

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadManifest, validateManifest } from './manifest.js';

export const minimal = {
  project: 'demo',
  baseBranch: 'develop',
  ports: { services: { frontend: { base: 3000 }, backend: { base: 8443 } } },
  services: {
    backend: { start: 'echo start', stop: 'echo stop', health: 'true' },
    frontend: { start: 'echo start', stop: 'echo stop', health: 'true' },
  },
  scopes: { frontend: ['app-ui/app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart' } },
};

describe('validateManifest', () => {
  it('fills defaults', () => {
    const m = validateManifest(minimal);
    expect(m.protectedBranches).toEqual(['develop']);
    expect(m.branch.types).toEqual(['feature', 'chore', 'fix']);
    expect(m.slots).toEqual({ count: 10, reserved: [0] });
    expect(m.expiry).toEqual({ slotHours: 12, commonsHours: 4, storybookHours: 2 });
    expect(m.worktreeRoot).toBe('.claude/worktrees');
    expect(m.env.file).toBe('.env.slot');
  });
  it('rejects an area that is an ancestor of another', () => {
    expect(() => validateManifest({ ...minimal, areas: { shop: {}, 'shop/cart': {} } }))
      .toThrow(/shop.*ancestor.*shop\/cart/);
  });
  it('rejects a service without a port and a port without a service, and a reserved slot out of range', () => {
    expect(() => validateManifest({ ...minimal, ports: { services: { frontend: { base: 3000 } } } })).toThrow(/backend.*port/);
    expect(() => validateManifest({ ...minimal, slots: { count: 3, reserved: [5] } })).toThrow(/reserved/);
  });
  it('rejects a template variable the env cannot resolve', () => {
    expect(() => validateManifest({ ...minimal, env: { file: '.env', template: { X: '${PORT_NOPE}' } } })).toThrow(/PORT_NOPE/);
  });
});

describe('loadManifest', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'wk-man-')); dirs.push(d); return d; };

  it('loads .json, .mjs and .ts', async () => {
    const a = dir(); writeFileSync(join(a, 'helmsmith.config.json'), JSON.stringify(minimal));
    expect((await loadManifest(a)).project).toBe('demo');
    const b = dir(); writeFileSync(join(b, 'helmsmith.config.mjs'), `export default ${JSON.stringify(minimal)};`);
    expect((await loadManifest(b)).project).toBe('demo');
    const c = dir(); writeFileSync(join(c, 'helmsmith.config.ts'), `const m = ${JSON.stringify(minimal)} as const;\nexport default m;`);
    expect((await loadManifest(c)).project).toBe('demo');
  });
  it('names the repo when no manifest exists', async () => {
    await expect(loadManifest(dir())).rejects.toMatchObject({ code: 'MANIFEST_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement manifest.ts**

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WorkkitError } from './errors.js';
import type { Manifest } from './types.js';

export const MANIFEST_FILES = ['helmsmith.config.ts', 'helmsmith.config.mjs', 'helmsmith.config.json'] as const;

const Service = z.object({
  start: z.string().min(1), stop: z.string().min(1), health: z.string().min(1),
  healthyCodes: z.array(z.number().int()).optional(), reset: z.string().optional(),
  healthTimeoutMs: z.number().int().positive().optional(),
});
const Schema = z.object({
  project: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  baseBranch: z.string().min(1),
  protectedBranches: z.array(z.string()).optional(),
  worktreeRoot: z.string().default('.claude/worktrees'),
  branch: z.object({ types: z.array(z.string().regex(/^[a-z]+$/)).min(1) }).default({ types: ['feature', 'chore', 'fix'] }),
  slots: z.object({ count: z.number().int().min(1).max(100), reserved: z.array(z.number().int().min(0)) }).default({ count: 10, reserved: [0] }),
  ports: z.object({ services: z.record(z.string(), z.object({ base: z.number().int().min(1024).max(65535) })) }),
  services: z.record(z.string(), Service),
  storybook: z.object({ hostRoot: z.string() }).optional(),
  logs: z.object({ dir: z.string() }).default({ dir: '.logs' }),
  env: z.object({ file: z.string(), template: z.record(z.string(), z.string()) }).optional(),
  refresh: z.array(z.object({ when: z.string().optional(), always: z.boolean().optional(), run: z.string().optional(), mark: z.string().optional() })).default([]),
  scopes: z.object({ frontend: z.array(z.string()), backend: z.array(z.string()) }),
  areas: z.record(z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/), z.object({ module: z.string().optional(), commons: z.array(z.string()).optional(), extraScopes: z.array(z.string()).optional() })),
  commons: z.record(z.string(), z.array(z.string())).default({}),
  expiry: z.object({ slotHours: z.number().positive(), commonsHours: z.number().positive(), storybookHours: z.number().positive() }).default({ slotHours: 12, commonsHours: 4, storybookHours: 2 }),
  archive: z.object({ paths: z.array(z.string()), keepDays: z.number().int().positive(), keepPerArea: z.number().int().positive() }).default({ paths: [], keepDays: 30, keepPerArea: 5 }),
});

/** Variables the env template may reference. */
export function templateVariables(m: { ports: { services: Record<string, unknown> } }): Set<string> {
  const vars = new Set(['SLOT', 'LOG_DIR', 'PROJECT', 'AREA', 'BRANCH', 'WORKTREE', 'PORT_STORYBOOK']);
  for (const s of Object.keys(m.ports.services)) vars.add(`PORT_${s.toUpperCase()}`);
  return vars;
}

export function validateManifest(raw: unknown): Manifest {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkkitError('MANIFEST_INVALID', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const m = parsed.data;
  const problems: string[] = [];
  const areas = Object.keys(m.areas).sort();
  for (const a of areas) for (const b of areas) if (a !== b && b.startsWith(`${a}/`)) problems.push(`area "${a}" is an ancestor of "${b}": areas must be leaves`);
  for (const s of Object.keys(m.services)) if (!m.ports.services[s]) problems.push(`service "${s}" has no port base under ports.services`);
  for (const s of Object.keys(m.ports.services)) if (!m.services[s] && s !== 'storybook') problems.push(`port "${s}" names no service`);
  for (const r of m.slots.reserved) if (r >= m.slots.count) problems.push(`reserved slot ${r} is outside 0..${m.slots.count - 1}`);
  const env = m.env ?? { file: '.env.slot', template: Object.fromEntries([['SLOT', '${SLOT}'], ['LOG_DIR', '${LOG_DIR}'], ...Object.keys(m.ports.services).map((s) => [`PORT_${s.toUpperCase()}`, `\${PORT_${s.toUpperCase()}}`])]) };
  const allowed = templateVariables(m);
  for (const [k, v] of Object.entries(env.template)) for (const [, name] of v.matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!allowed.has(name)) problems.push(`env.template.${k} references ${name}, which no slot derives (allowed: ${[...allowed].join(', ')})`);
  for (const [area, spec] of Object.entries(m.areas)) for (const c of spec.commons ?? []) if (!m.commons[c]) problems.push(`area "${area}" names commons "${c}", which is not declared`);
  if (problems.length) throw new WorkkitError('MANIFEST_INVALID', problems.join('; '));
  return { ...m, protectedBranches: m.protectedBranches ?? [m.baseBranch], env } as Manifest;
}

export async function loadManifest(repoRoot: string): Promise<Manifest> {
  for (const name of MANIFEST_FILES) {
    const file = join(repoRoot, name);
    if (!existsSync(file)) continue;
    const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: unknown };
    return validateManifest(name.endsWith('.json') ? mod.default ?? mod : mod.default);
  }
  throw new WorkkitError('MANIFEST_NOT_FOUND', `no ${MANIFEST_FILES.join(' | ')} in ${repoRoot}; run \`work init\``);
}
```
Note: Node 24 strips types from an imported `.ts` file natively; JSON needs `import(..., { with: { type: 'json' } })`, so read JSON with `readFileSync` + `JSON.parse` instead of `import` in the `.json` branch.

- [ ] **Step 4: Run** → PASS 7/7 (fix the JSON branch per the note if the import fails). Export from `index.ts`.

- [ ] **Step 5: Commit** — `feat(workkit): manifest loader with leaf, port and template validation`.

---

### Task 3: Registry with atomic writes, lock and slot allocation

**Files:**
- Create: `platform/core/workkit-lib/src/registry.ts`, `platform/core/workkit-lib/src/paths.ts`
- Test: `platform/core/workkit-lib/src/registry.test.ts`

**Interfaces:**
- Produces: `homeDir(env?)` (`$HELMSMITH_HOME` or `~/.cache/helmsmith`), `registryFile(home)`, `class Registry { static open(home): Registry; read(): RegistryFile; update<T>(fn: (r: RegistryFile) => T): T; project(name); upsertProject(name, entry); leases(filter?); efforts(filter?); allocateSlot(project, manifest, owner, effortId): Lease; addLease(l); touch(leaseId); release(leaseId); expired(now?): Lease[]; addEffort(e); updateEffort(id, patch); activeEffortFor(project, area) }`, `newId(prefix)`.

`update()` takes the directory lock `registry.lock` (mkdir, retry every 25 ms up to 5 s, stale after 30 s by mtime), reads the file fresh, applies `fn`, writes atomically (`.tmp` + rename), releases the lock. Every mutation goes through `update()`, so two processes cannot both read "slot 1 free" and both take it.

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { minimal } from './manifest.test.js';
import { Registry } from './registry.js';

const owner = { session: 's1', pid: 1 };
describe('Registry', () => {
  const homes: string[] = [];
  const home = () => { const h = mkdtempSync(join(tmpdir(), 'wk-reg-')); homes.push(h); return h; };
  afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

  it('starts empty and persists projects, leases and efforts across opens', () => {
    const h = home();
    const r = Registry.open(h);
    r.upsertProject('demo', { root: '/d', ranges: { frontend: { base: 3000, count: 10 } } });
    expect(Registry.open(h).project('demo')?.root).toBe('/d');
  });

  it('allocates the lowest free non-reserved slot and never a reserved one', () => {
    const r = Registry.open(home());
    const m = validateManifest(minimal);
    r.upsertProject('demo', { root: '/d', ranges: {} });
    const a = r.allocateSlot('demo', m, owner, 'e1');
    const b = r.allocateSlot('demo', m, owner, 'e2');
    expect([a.value, b.value]).toEqual([1, 2]);
    expect(a.ports).toEqual({ frontend: 3001, backend: 8444 });
    r.release(a.id);
    expect(r.allocateSlot('demo', m, owner, 'e3').value).toBe(1);
  });

  it('refuses when every slot is leased', () => {
    const r = Registry.open(home());
    const m = validateManifest({ ...minimal, slots: { count: 2, reserved: [0] } });
    r.upsertProject('demo', { root: '/d', ranges: {} });
    r.allocateSlot('demo', m, owner, 'e1');
    expect(() => r.allocateSlot('demo', m, owner, 'e2')).toThrow(/NO_FREE_SLOT|no free slot/i);
  });

  it('allocateSlot under contention hands out distinct slots', async () => {
    const h = home();
    const m = validateManifest(minimal);
    Registry.open(h).upsertProject('demo', { root: '/d', ranges: {} });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      new Promise<number>((res) => setTimeout(() => res(Registry.open(h).allocateSlot('demo', m, owner, `e${i}`).value as number), 0))));
    expect(new Set(results).size).toBe(6);
  });

  it('lists expired leases by the clock it is given', () => {
    const r = Registry.open(home());
    const m = validateManifest(minimal);
    r.upsertProject('demo', { root: '/d', ranges: {} });
    const l = r.allocateSlot('demo', m, owner, 'e1');
    expect(r.expired(new Date(Date.parse(l.expires) - 1000))).toEqual([]);
    expect(r.expired(new Date(Date.parse(l.expires) + 1000)).map((x) => x.id)).toEqual([l.id]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement paths.ts and registry.ts**

`paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HELMSMITH_HOME && env.HELMSMITH_HOME.length > 0 ? env.HELMSMITH_HOME : join(homedir(), '.cache', 'helmsmith');
}
export const registryFile = (home: string) => join(home, 'registry.json');
export const lockDir = (home: string) => join(home, 'registry.lock');
```

`registry.ts` (core of it; keep every mutation inside `update`):
```ts
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { WorkkitError } from './errors.js';
import { lockDir, registryFile } from './paths.js';
import { portsForSlot } from './ports.js';
import type { Effort, Lease, Manifest, Owner, ProjectEntry, RegistryFile } from './types.js';

export const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;
const EMPTY: RegistryFile = { version: 1, projects: {}, leases: [], efforts: [] };
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class Registry {
  private constructor(private readonly home: string, private readonly now: () => Date) {}
  static open(home: string, now: () => Date = () => new Date()): Registry { mkdirSync(home, { recursive: true }); return new Registry(home, now); }

  read(): RegistryFile {
    const file = registryFile(this.home);
    if (!existsSync(file)) return structuredClone(EMPTY);
    try { return JSON.parse(readFileSync(file, 'utf8')) as RegistryFile; } catch { return structuredClone(EMPTY); }
  }

  /** Lock, re-read, mutate, write atomically, unlock. The only way state changes. */
  update<T>(fn: (r: RegistryFile) => T): T {
    const lock = lockDir(this.home);
    const started = Date.now();
    for (;;) {
      try { mkdirSync(lock); break; } catch {
        try { if (Date.now() - statSync(lock).mtimeMs > 30_000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
        if (Date.now() - started > 5_000) throw new WorkkitError('INTERNAL', `registry lock ${lock} held for over 5 s`);
        sleep(25);
      }
    }
    try {
      const r = this.read();
      const out = fn(r);
      const file = registryFile(this.home);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(r, null, 2)}\n`);
      renameSync(tmp, file);
      return out;
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }

  project(name: string): ProjectEntry | undefined { return this.read().projects[name]; }
  upsertProject(name: string, entry: ProjectEntry): void { this.update((r) => { r.projects[name] = entry; }); }
  leases(filter: Partial<Pick<Lease, 'project' | 'kind' | 'effort'>> = {}): Lease[] {
    return this.read().leases.filter((l) => Object.entries(filter).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v));
  }
  efforts(filter: Partial<Pick<Effort, 'project' | 'area' | 'state'>> = {}): Effort[] {
    return this.read().efforts.filter((e) => Object.entries(filter).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v));
  }
  activeEffortFor(project: string, area: string): Effort | undefined { return this.efforts({ project, area, state: 'active' })[0]; }

  allocateSlot(project: string, m: Manifest, owner: Owner, effort: string): Lease {
    return this.update((r) => {
      const taken = new Set(r.leases.filter((l) => l.project === project && l.kind === 'slot').map((l) => l.value as number));
      const reserved = new Set(m.slots.reserved);
      let slot = -1;
      for (let n = 0; n < m.slots.count; n++) if (!taken.has(n) && !reserved.has(n)) { slot = n; break; }
      if (slot < 0) throw new WorkkitError('NO_FREE_SLOT', `no free slot in ${project} (0..${m.slots.count - 1}, reserved ${[...reserved].join(',')})`);
      const lease = this.lease(project, 'slot', slot, owner, effort, m.expiry.slotHours, portsForSlot(m, slot));
      r.leases.push(lease);
      return lease;
    });
  }
  addLease(kind: Lease['kind'], project: string, value: string | number, owner: Owner, effort: string, hours: number, extra: Partial<Lease> = {}): Lease {
    return this.update((r) => { const l = { ...this.lease(project, kind, value, owner, effort, hours), ...extra }; r.leases.push(l); return l; });
  }
  private lease(project: string, kind: Lease['kind'], value: string | number, owner: Owner, effort: string, hours: number, ports?: Record<string, number>): Lease {
    const now = this.now();
    return { id: newId('lease'), project, kind, value, ...(ports ? { ports } : {}), owner, effort, created: now.toISOString(), touched: now.toISOString(), expires: new Date(now.getTime() + hours * 3_600_000).toISOString() };
  }
  touch(leaseId: string, hours: number): void {
    this.update((r) => { const l = r.leases.find((x) => x.id === leaseId); if (!l) throw new WorkkitError('LEASE_NOT_FOUND', leaseId); const now = this.now(); l.touched = now.toISOString(); l.expires = new Date(now.getTime() + hours * 3_600_000).toISOString(); });
  }
  patchLease(leaseId: string, patch: Partial<Lease>): void { this.update((r) => { const i = r.leases.findIndex((x) => x.id === leaseId); if (i < 0) throw new WorkkitError('LEASE_NOT_FOUND', leaseId); r.leases[i] = { ...r.leases[i], ...patch }; }); }
  release(leaseId: string): void { this.update((r) => { r.leases = r.leases.filter((l) => l.id !== leaseId); }); }
  expired(now: Date = this.now()): Lease[] { return this.read().leases.filter((l) => Date.parse(l.expires) < now.getTime()); }

  addEffort(e: Effort): void { this.update((r) => { r.efforts.push(e); }); }
  updateEffort(id: string, patch: Partial<Effort>): Effort {
    return this.update((r) => { const i = r.efforts.findIndex((e) => e.id === id); if (i < 0) throw new WorkkitError('EFFORT_NOT_FOUND', id); r.efforts[i] = { ...r.efforts[i], ...patch }; return r.efforts[i]; });
  }
}
```
`portsForSlot` comes from Task 4; write it in the same commit (the registry test needs it):

- [ ] **Step 4: Create `ports.ts` minimal** — `export function portsForSlot(m: Manifest, slot: number): Record<string, number> { return Object.fromEntries(Object.entries(m.ports.services).map(([s, { base }]) => [s, base + slot])); }`

- [ ] **Step 5: Run** → PASS 5/5. Export `Registry`, `newId`, `homeDir`, `registryFile`, `portsForSlot` from `index.ts`.

- [ ] **Step 6: Commit** — `feat(workkit): lease registry with directory lock, atomic writes and slot allocation`.

---

### Task 4: Port ranges per project

**Files:**
- Modify: `platform/core/workkit-lib/src/ports.ts`
- Test: `platform/core/workkit-lib/src/ports.test.ts`

**Interfaces:**
- Produces: `rangesFor(m: Manifest): Record<string, {base: number; count: number}>`, `rangesOverlap(a, b): boolean`, `claimRanges(registry, m, repoRoot): void` (throws `PORT_RANGE_TAKEN` naming the other project and service; idempotent for the same project).

- [ ] **Step 1: Failing tests**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { minimal } from './manifest.test.js';
import { claimRanges, rangesFor, rangesOverlap } from './ports.js';
import { Registry } from './registry.js';

describe('ports', () => {
  it('derives one range per service from the slot count', () => {
    expect(rangesFor(validateManifest(minimal))).toEqual({ frontend: { base: 3000, count: 10 }, backend: { base: 8443, count: 10 } });
  });
  it('detects overlapping ranges', () => {
    expect(rangesOverlap({ base: 3000, count: 10 }, { base: 3009, count: 10 })).toBe(true);
    expect(rangesOverlap({ base: 3000, count: 10 }, { base: 3010, count: 10 })).toBe(false);
  });
  it('claims ranges once and refuses another project on the same ports', () => {
    const r = Registry.open(mkdtempSync(join(tmpdir(), 'wk-ports-')));
    const m = validateManifest(minimal);
    claimRanges(r, m, '/a'); claimRanges(r, m, '/a');
    expect(r.project('demo')?.ranges.frontend).toEqual({ base: 3000, count: 10 });
    expect(() => claimRanges(r, validateManifest({ ...minimal, project: 'other' }), '/b')).toThrow(/demo.*frontend/);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`rangesFor`, `rangesOverlap` = `a.base < b.base + b.count && b.base < a.base + a.count`, `claimRanges` walks `registry.read().projects` other than `m.project`, throws on overlap, else `upsertProject(m.project, { root, ranges })`). **Step 4: Run** → PASS 3/3. **Step 5: Commit** — `feat(workkit): per-project port ranges claimed in the registry`.

---

### Task 5: Scopes: expansion, overlap, membership, commons

**Files:**
- Create: `platform/core/workkit-lib/src/scopes.ts`
- Test: `platform/core/workkit-lib/src/scopes.test.ts`

**Interfaces:**
- Produces: `expandScopes(m, area, mode): string[]`, `literalPrefix(glob): string`, `globsOverlap(a: string[], b: string[]): string[]` (the overlapping pairs rendered `a ~ b`), `pathsMatching(paths, globs): string[]` (picomatch, `dot: true`), `commonsTouched(m, paths): string[]` (commons names), `areaVars(area): { group, section }`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { minimal } from './manifest.test.js';
import { commonsTouched, expandScopes, globsOverlap, pathsMatching } from './scopes.js';

const m = validateManifest({ ...minimal,
  scopes: { frontend: ['app-ui/app/{group}/{section}/**', 'app-ui/components/{group}/{section}/**', 'app-ui/app/api/{section}/**'], backend: ['svc/modules/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart', extraScopes: ['docs/cart/**'] }, 'shop/team': { module: 'team' } },
  commons: { auth: ['app-ui/app/api/auth/**'], core: ['app-ui/components/core/**'] } });

describe('scopes', () => {
  it('expands templates from the area path and module; fullstack adds backend', () => {
    expect(expandScopes(m, 'shop/cart', 'frontend')).toEqual(['app-ui/app/shop/cart/**', 'app-ui/components/shop/cart/**', 'app-ui/app/api/cart/**', 'docs/cart/**']);
    expect(expandScopes(m, 'shop/cart', 'fullstack')).toContain('svc/modules/cart/**');
  });
  it('finds overlap by literal prefix, in either direction', () => {
    expect(globsOverlap(['app-ui/app/shop/cart/**'], ['app-ui/app/shop/cart/checkout/**'])).toEqual(['app-ui/app/shop/cart/** ~ app-ui/app/shop/cart/checkout/**']);
    expect(globsOverlap(['app-ui/app/shop/cart/**'], ['app-ui/app/shop/team/**'])).toEqual([]);
  });
  it('matches paths against globs and names the commons touched', () => {
    expect(pathsMatching(['app-ui/app/shop/cart/page.tsx', 'README.md'], ['app-ui/app/shop/cart/**'])).toEqual(['app-ui/app/shop/cart/page.tsx']);
    expect(commonsTouched(m, ['app-ui/components/core/Button.tsx', 'x.ts'])).toEqual(['core']);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with picomatch (`picomatch(globs, { dot: true })`); `areaVars`: `group` = all segments but the last joined by `/`, `section` = last segment; substitute `{group}`, `{section}`, `{module}` (module missing → skip templates that need it, and `expandScopes` throws `MANIFEST_INVALID` for `fullstack` when the area has no module); `literalPrefix` = text before the first of `* ? [ {`. **Step 4: Run** → PASS 3/3. **Step 5: Commit** — `feat(workkit): scope expansion, overlap and commons detection`.

---

### Task 6: Git operations and the fixture repo

**Files:**
- Create: `platform/core/workkit-lib/src/git.ts`, `platform/core/workkit-lib/src/testing/fixture-repo.ts`
- Test: `platform/core/workkit-lib/src/git.test.ts`

**Interfaces:**
- Produces: `class Git { constructor(cwd); run(args): string (throws GIT_FAILED with stderr); tryRun(args): {code, out, err}; root(): string; isMainCheckout(): boolean; currentBranch(): string; branchExists(name): boolean; remoteBranchExists(name): boolean; fetch(branch): void; hasUpstream(): boolean; unpushedCount(): number; isDirty(): boolean; changedPathsStaged(): string[]; changedPaths(from, to): string[]; mergeBaseIsAncestor(a, b): boolean; syncFrom(base): {kind: 'up-to-date'|'ff'|'merge'|'conflict'; before: string; after: string; conflicted: string[]}; worktreeAdd(path, branch, startPoint?): void; worktreeRemove(path): void; checkout(branch, createFrom?): void; push(branch): void; deleteLocalBranch(branch): void; commitsNotOn(base): string[] }`.
- `makeRepo(): { origin: string; main: string; cleanup(): void }` — bare origin + a clone on `develop` with one commit; helper `commitFile(repoDir, path, content, message)`.

- [ ] **Step 1: Failing tests** (fixture helper written in the same step)

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { commitFile, makeRepo } from './testing/fixture-repo.js';

describe('Git', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('knows the main checkout from a linked worktree', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const g = new Git(f.main);
    expect(g.isMainCheckout()).toBe(true);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    expect(new Git(wt).isMainCheckout()).toBe(false);
    expect(new Git(wt).currentBranch()).toBe('feature/shop/cart');
  });

  it('syncFrom fast-forwards, merges, or reports a conflict without touching leases', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const g = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    commitFile(f.main, 'a.txt', 'two', 'develop moves'); g.push('develop');
    w.fetch('develop');
    expect(w.syncFrom('develop').kind).toBe('ff');
    commitFile(wt, 'b.txt', 'mine', 'own work');
    commitFile(f.main, 'c.txt', 'theirs', 'develop again'); g.push('develop'); w.fetch('develop');
    expect(w.syncFrom('develop').kind).toBe('merge');
    commitFile(wt, 'a.txt', 'mine-a', 'edit a'); commitFile(f.main, 'a.txt', 'theirs-a', 'edit a too'); g.push('develop'); w.fetch('develop');
    const r = w.syncFrom('develop');
    expect(r.kind).toBe('conflict');
    expect(r.conflicted).toEqual(['a.txt']);
    expect(existsSync(join(wt, '.git', 'MERGE_HEAD')) || existsSync(join(f.main, '.git/worktrees/cart/MERGE_HEAD'))).toBe(true);
  });

  it('counts unpushed commits and lists changed paths', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const g = new Git(f.main);
    commitFile(f.main, 'x/y.txt', '1', 'x');
    expect(g.unpushedCount()).toBe(1);
    expect(g.changedPaths('origin/develop', 'HEAD')).toEqual(['x/y.txt']);
    g.push('develop');
    expect(g.unpushedCount()).toBe(0);
  });
});
```

`src/testing/fixture-repo.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).toString();

export function makeRepo(base = 'develop'): { origin: string; main: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'wk-repo-'));
  const origin = join(dir, 'origin.git');
  const main = join(dir, 'main');
  git(dir, 'init', '--bare', '-b', base, origin);
  git(dir, 'clone', '-q', origin, main);
  git(main, 'checkout', '-q', '-b', base);
  commitFile(main, 'README.md', 'hello', 'init');
  git(main, 'push', '-q', '-u', 'origin', base);
  return { origin, main, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function commitFile(repo: string, path: string, content: string, message: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  git(repo, 'add', path);
  git(repo, 'commit', '-q', '-m', message);
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `git.ts`** with `execFileSync('git', args, { cwd, stdio: 'pipe' })`; `isMainCheckout` = `rev-parse --git-common-dir` resolved equals `rev-parse --git-dir` resolved; `syncFrom(base)`: `before = rev-parse HEAD`; if `merge-base --is-ancestor HEAD origin/<base>` → `merge --ff-only origin/<base>` → `ff` (or `up-to-date` when HEAD already equals it); else `tryRun(['merge','--no-edit','origin/<base>'])` → code 0 → `merge`; else `conflicted = diff --name-only --diff-filter=U` and return `conflict` leaving the merge in place; `commitsNotOn(base)` = `rev-list origin/<base>..HEAD`; `unpushedCount` = `rev-list @{u}..HEAD` or `rev-list origin/<baseBranch>..HEAD` when no upstream (pass the base as an argument); `push(branch)` = `push -u origin <branch>`. **Step 4: Run** → PASS 3/3. **Step 5: Commit** — `feat(workkit): git operations and a fixture repo for tests`.

---

### Task 7: Guards and hook installation

**Files:**
- Create: `platform/core/workkit-lib/src/guards.ts`, `platform/core/workkit-lib/src/hooks.ts`
- Test: `platform/core/workkit-lib/src/guards.test.ts`, `platform/core/workkit-lib/src/hooks.test.ts`

**Interfaces:**
- Produces: `assertNotProtected(m, branch)`, `assertNotMainCheckout(git)`, `checkCommit({ m, registry, git, project, branch, stagedPaths, ownerSession }): { refusals: string[] }` (protected branch; commons write-locked by another effort), `checkPush({ m, registry, git, project, branch, changedPaths }): { refusals: string[]; warnings: string[] }` (protected → refusal; paths outside the active effort's scopes → warning; commons touched → warning), `installHooks(repoRoot): { hooksDir: string; files: string[] }` writing `.helmsmith/hooks/pre-commit` and `pre-push` (each `#!/bin/sh\nexec workbrokr hook <name> "$@"`), `chmod 755`, `git config core.hooksPath .helmsmith/hooks`.

- [ ] **Step 1: Failing tests**

```ts
// guards.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { checkCommit, checkPush } from './guards.js';
import { validateManifest } from './manifest.js';
import { minimal } from './manifest.test.js';
import { Registry } from './registry.js';
import { makeRepo } from './testing/fixture-repo.js';

const m = validateManifest({ ...minimal, commons: { auth: ['api/auth/**'] }, areas: { 'shop/cart': { module: 'cart' }, 'platform/auth': { commons: ['auth'] } } });
const reg = () => Registry.open(mkdtempSync(join(tmpdir(), 'wk-g-')));

describe('guards', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());
  it('refuses on develop with an empty registry', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const r = checkCommit({ m, registry: reg(), git: new Git(f.main), project: 'demo', branch: 'develop', stagedPaths: ['x'], ownerSession: 's1' });
    expect(r.refusals[0]).toMatch(/develop.*protected/);
  });
  it('refuses a write under commons locked by another effort, names the owner, allows the owner', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const registry = reg();
    registry.addLease('commons', 'demo', 'auth', { session: 'other', pid: 2 }, 'eff_x', 4);
    const args = { m, registry, git: new Git(f.main), project: 'demo', branch: 'feature/shop/cart', stagedPaths: ['api/auth/login.ts'] };
    expect(checkCommit({ ...args, ownerSession: 's1' }).refusals[0]).toMatch(/auth.*locked.*other/);
    expect(checkCommit({ ...args, ownerSession: 'other' }).refusals).toEqual([]);
  });
  it('warns on a push that leaves the effort scope and on commons touched', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const registry = reg();
    registry.addEffort({ id: 'e1', project: 'demo', area: 'shop/cart', type: 'feature', mode: 'frontend', branch: 'feature/shop/cart', worktree: '/w', owner: { session: 's1', pid: 1 }, state: 'active', scopes: ['app-ui/app/shop/cart/**'], commons: [], leases: [], notices: [], started: 'x', lastActivity: 'x' });
    const r = checkPush({ m, registry, git: new Git(f.main), project: 'demo', branch: 'feature/shop/cart', changedPaths: ['app-ui/app/shop/cart/a.tsx', 'svc/other.ts', 'api/auth/x.ts'] });
    expect(r.refusals).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/svc\/other\.ts/);
    expect(r.warnings.join('\n')).toMatch(/commons auth/);
  });
});
```

```ts
// hooks.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { installHooks } from './hooks.js';
import { makeRepo } from './testing/fixture-repo.js';

describe('installHooks', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());
  it('writes executable hooks and points core.hooksPath at them', () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const out = installHooks(f.main);
    expect(out.files.map((p) => p.split('/').pop())).toEqual(['pre-commit', 'pre-push']);
    for (const p of out.files) { expect(existsSync(p)).toBe(true); expect(readFileSync(p, 'utf8')).toMatch(/workbrokr hook/); }
    expect(new Git(f.main).run(['config', 'core.hooksPath']).trim()).toBe('.helmsmith/hooks');
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`checkCommit`: protected → refusal `branch "<b>" is protected (<list>): work happens on <type>/<area> branches, never here`; for each commons lease in the project whose owner session ≠ ownerSession and whose globs match a staged path → refusal `commons "<name>" is write-locked by <session> (effort <id>, since <touched>)`). `checkPush`: protected → refusal; active effort on this branch → `outside = paths not matching effort.scopes nor any commons` → warning listing them; `commonsTouched` → warning `commons <name> touched: others will be told at finish`. **Step 4: Run** → PASS 4/4. **Step 5: Commit** — `feat(workkit): protected-branch, commons and scope guards; hook installer`.

---

### Task 8: Config emitter and refresh runner

**Files:**
- Create: `platform/core/workkit-lib/src/config.ts`, `platform/core/workkit-lib/src/refresh.ts`
- Test: `platform/core/workkit-lib/src/config.test.ts`, `platform/core/workkit-lib/src/refresh.test.ts`

**Interfaces:**
- Produces: `renderTemplate(s, vars): string` (unknown `${X}` throws `MANIFEST_INVALID`), `emitWorktreeConfig({ m, worktree, slot, ports, storybookPort?, area, branch }): { envFile: string; slotFile: string; logDir: string; vars: Record<string,string> }` (writes `<worktree>/.slot` = `N\n`, env file `KEY=value` lines, `mkdir -p` logDir; slot absent (frontend) writes no `.slot` and `SLOT=`), `selectRefresh(entries, changedPaths): { runs: string[]; marks: string[] }`, `runRefresh(runs, cwd, log: (line) => void): void` (`sh -c`, inherits env, throws `INTERNAL` with the command on non-zero).

- [ ] **Step 1: Failing tests**

```ts
// config.test.ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emitWorktreeConfig, renderTemplate } from './config.js';
import { validateManifest } from './manifest.js';
import { minimal } from './manifest.test.js';

describe('config', () => {
  it('renders known variables and refuses unknown ones', () => {
    expect(renderTemplate('p=${PORT_BACKEND}', { PORT_BACKEND: '8444' })).toBe('p=8444');
    expect(() => renderTemplate('${NOPE}', {})).toThrow(/NOPE/);
  });
  it('writes .slot, the env file and the log dir', () => {
    const wt = mkdtempSync(join(tmpdir(), 'wk-cfg-'));
    const out = emitWorktreeConfig({ m: validateManifest(minimal), worktree: wt, slot: 3, ports: { frontend: 3003, backend: 8446 }, area: 'shop/cart', branch: 'feature/shop/cart' });
    expect(readFileSync(join(wt, '.slot'), 'utf8')).toBe('3\n');
    expect(readFileSync(out.envFile, 'utf8')).toContain('PORT_BACKEND=8446');
    expect(out.logDir).toBe(join(wt, '.logs'));
  });
});
```
```ts
// refresh.test.ts
import { describe, expect, it } from 'vitest';
import { selectRefresh } from './refresh.js';
describe('selectRefresh', () => {
  const entries = [{ when: 'app-ui/package-lock.json', run: 'install-ui' }, { when: 'db/**', mark: 'db-reset' }, { always: true, run: 'clear-cache' }];
  it('selects by changed paths and always-entries', () => {
    expect(selectRefresh(entries, ['db/V1.sql'])).toEqual({ runs: ['clear-cache'], marks: ['db-reset'] });
    expect(selectRefresh(entries, ['app-ui/package-lock.json'])).toEqual({ runs: ['install-ui', 'clear-cache'], marks: [] });
    expect(selectRefresh(entries, [])).toEqual({ runs: ['clear-cache'], marks: [] });
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS 3/3. **Step 5: Commit** — `feat(workkit): per-worktree config emitter and refresh selection`.

---

### Task 9: Service runner (start, health, stop)

**Files:**
- Create: `platform/core/workkit-lib/src/runner.ts`, `platform/core/workkit-lib/src/testing/http-service.mjs`
- Test: `platform/core/workkit-lib/src/runner.test.ts`

**Interfaces:**
- Produces: `startServices({ m, cwd, env, logDir, onLog? }): Promise<{ pids: Record<string, number> }>` (per service in manifest order: `spawn('sh', ['-c', start], { cwd, env, detached: true, stdio: ['ignore', fd, fd] })` with `fd` = `<logDir>/<service>.log`, `child.unref()`, then `waitHealthy(service)`), `waitHealthy({ spec, env, cwd, timeoutMs }): Promise<void>` (poll every 1 s: `sh -c health`; healthy when exit 0 and, if `healthyCodes`, trimmed stdout's last token is one of them; else `HEALTH_TIMEOUT` with the last stderr/stdout line), `stopServices({ m, cwd, env, pids }): Promise<void>` (run each `stop` in reverse order; then for each pid still alive after 5 s `process.kill(-pid, 'SIGTERM')`, after 5 more s `SIGKILL`; a pid that is not alive is skipped; never anything else), `isAlive(pid)`.
- `http-service.mjs`: `node http-service.mjs --port N --name X` → serves `200 ok X` on `/health`, writes its pid file to `$PIDFILE` when set; used by tests and by the workbrokr e2e fixture.

- [ ] **Step 1: Failing test**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { isAlive, startServices, stopServices } from './runner.js';

const svc = fileURLToPath(new URL('./testing/http-service.mjs', import.meta.url));
const m = validateManifest({
  project: 'demo', baseBranch: 'develop',
  ports: { services: { api: { base: 42100 } } },
  services: { api: { start: `node ${svc} --port $PORT_API --name api`, stop: 'true', health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_API/health', healthyCodes: [200], healthTimeoutMs: 15000 } },
  scopes: { frontend: [], backend: [] }, areas: { a: {} },
});

describe('runner', () => {
  it('starts a service, reports healthy, stops only the pid it started', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const env = { ...process.env, PORT_API: '42107' };
    const { pids } = await startServices({ m, cwd, env, logDir: cwd });
    expect(isAlive(pids.api)).toBe(true);
    await stopServices({ m, cwd, env, pids });
    expect(isAlive(pids.api)).toBe(false);
  });
  it('times out with HEALTH_TIMEOUT when nothing answers', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const bad = validateManifest({ ...JSON.parse(JSON.stringify(m)), services: { api: { ...m.services.api, start: 'sleep 30', healthTimeoutMs: 2000 } } });
    await expect(startServices({ m: bad, cwd, env: { ...process.env, PORT_API: '42108' }, logDir: cwd })).rejects.toMatchObject({ code: 'HEALTH_TIMEOUT' });
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement runner.ts and http-service.mjs** (the service: `import { createServer } from 'node:http'`; parse `--port`/`--name`; `createServer((req,res)=>{res.end('ok '+name)}).listen(port)`). On `HEALTH_TIMEOUT`, stop what was started so far before throwing. **Step 4: Run** → PASS 2/2. **Step 5: Commit** — `feat(workkit): service runner with health polling and pid-scoped stop`.

---

### Task 10: workbrokr skeleton: output, session, `init`

**Files:**
- Create: `apps/workbrokr/src/commands/_shared/output.ts`, `platform/core/workkit-lib/src/session.ts`, `apps/workbrokr/src/commands/init.ts`
- Modify: `apps/workbrokr/src/cli.ts`
- Test: `apps/workbrokr/src/commands/init.test.ts`, `platform/core/workkit-lib/src/session.test.ts`

**Interfaces:**
- Produces: `printJson(v)`, `fail(err, json): never` (prints `toErrorBody` as JSON or the message to stderr; `process.exit(exitCodeFor(code))`), `currentOwner(env?): Owner` (`WORK_SESSION` env, else `CLAUDE_SESSION_NAME`, else `user@host:ppid`), `runInit(opts): { manifestPath: string; hooks: string[] }` writing `helmsmith.config.mjs` and `registerInit(program)` with flags `--project`, `--base-branch` (default: `git symbolic-ref refs/remotes/origin/HEAD` short name, else `main`), `--service name=port` (repeatable), `--storybook-host <dir>`, `--worktree-root`, `--no-hooks`, `--force`.

- [ ] **Step 1: Failing tests**

```ts
// init.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadManifest, makeRepo } from '@helmsmith/workkit';
import { runInit } from './init.js';

describe('work init', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());
  it('writes a loadable manifest, installs hooks, claims ranges, refuses to overwrite without --force', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const home = join(f.main, '.home');
    const out = runInit({ repoRoot: f.main, home, project: 'demo', baseBranch: 'develop', services: ['frontend=3000', 'backend=8443', 'postgres=5432'], storybookHost: 'app-ui', hooks: true, force: false });
    expect(existsSync(out.manifestPath)).toBe(true);
    const m = await loadManifest(f.main);
    expect(m.ports.services.backend.base).toBe(8443);
    expect(m.services.backend.start).toMatch(/make/);
    expect(readFileSync(join(f.main, '.helmsmith/hooks/pre-push'), 'utf8')).toMatch(/workbrokr hook pre-push/);
    expect(() => runInit({ repoRoot: f.main, home, project: 'demo', baseBranch: 'develop', services: ['frontend=3000'], hooks: false, force: false })).toThrow(/exists/);
  });
});
```
(`makeRepo` is exported from workkit's `testing/` through `index.ts` under `export * from './testing/fixture-repo.js'`; it is test-only but harmless to ship as source.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The generated manifest is a real, loadable file with per-service commands written as `make -C <service-dir> dev|dev-stop` placeholders that are valid shell (`echo "define start for backend" && exit 1` for stop/health is NOT allowed: write `make -C app-service dev`, `make -C app-service dev-stop`, `curl -sf http://127.0.0.1:${PORT_BACKEND}/health`), with a header comment telling the owner which lines to edit; `postgres` gets `docker compose up -d postgres` / `docker compose stop postgres` / `pg_isready -h 127.0.0.1 -p ${PORT_POSTGRES}`; `storybook` port base 6100 is added when `--storybook-host` is given; `scopes` default to the three frontend templates and three backend templates from the spec §7.1 with `{module}` paths under `services/{module}/**`; `areas: {}`, `commons: {}`. After writing: `loadManifest` (validates), `claimRanges`, `installHooks` unless `--no-hooks`. **Step 4: Run** → PASS; `work init --help` lists the flags. **Step 5: Commit** — `feat(workbrokr): init writes the manifest, claims ports, installs hooks`.

---

### Task 11: `work start` — guards, worktree, branch, sync, refresh, lease, config, run, record

**Files:**
- Create: `apps/workbrokr/src/lib/effort.ts`, `apps/workbrokr/src/lib/storybrokr.ts`, `apps/workbrokr/src/commands/start.ts`
- Test: `apps/workbrokr/src/lib/effort.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: `startEffort(ctx, opts): Promise<StartResult>` where `ctx = { home, repoRoot, manifest, registry, owner, runner: ServiceRunner, storybrokr: StorybrokrClient, log }` and `opts = { area, type, mode, join?: boolean, sync?: boolean, story?: string }`; `StartResult = { effort: Effort; leases: Lease[]; sync: 'up-to-date'|'ff'|'merge'|'skipped'; refreshed: string[]; marks: string[] }`. `StorybrokrClient = { up(story, hostRoot): Promise<{ id: string; port: number; url: string }>; down(id): Promise<void> }` with the real one shelling to `storybrokr up <story> --host <hostRoot> --json` / `storybrokr down <id>` and throwing `STORYBROKR_FAILED` on a non-zero exit; `ServiceRunner = { start, stop }` defaulting to workkit's runner.

Order of operations inside `startEffort` (each a small private function, in this order; the test names them):

1. `guardStart`: `assertNotMainCheckout(git(repoRoot))` is NOT applied to `repoRoot` itself (the tool runs from anywhere in the repo and creates worktrees under it); it is applied to the **caller's cwd** when the caller is inside a checkout. Area must exist; type ∈ manifest types; mode valid; `activeEffortFor(project, area)` → if present and not `join` → `EFFORT_OPEN` with owner; if `join` → adopt it (return early after touching). Branch `<type>/<area>` ∉ protected (cannot be, but assert). Open efforts whose `scopes` overlap the candidate scopes → `SCOPE_CONFLICT` listing pairs and owner. For a cross-cutting area (has `commons`), compute other active efforts with commits (`changedPaths(origin/base, branch)`) under those commons and put them in `warnings`.
2. `ensureWorktree`: path `${repoRoot}/${worktreeRoot}/${area}`; if missing `worktreeAdd(path, branch, exists? branch : 'origin/<base>')` after `fetch(base)`; if present and on another branch → checkout the wanted branch (creating from `origin/<base>` if missing); if the other-type branch has `commitsNotOn(base).length > 0` → `EFFORT_OPEN` ("ship or finish `<other-branch>` first, or --join").
3. `sync` (unless `opts.sync === false`): `fetch(base)`, `syncFrom(base)`; `conflict` → `SYNC_CONFLICT` with `conflicted` list and the worktree path (nothing leased yet).
4. `refresh`: `changedPaths(before, after)` → `selectRefresh` → `runRefresh` (logged to `${logDir}/refresh.log`); marks kept for step 7.
5. `scopes`: `expandScopes(m, area, mode)` + area `extraScopes`.
6. `lease`: `fullstack` → `allocateSlot`; `frontend` → no lease yet (storybrokr allocates the port; after `up` a `storybook` lease with `value = instance id` and `ports: { storybook }` is added); cross-cutting → `commons` lease per name (`commonsHours`).
7. `config`: `emitWorktreeConfig`; if `db-reset` ∈ marks and `services.postgres.reset` exists → run it before starting.
8. `run`: `fullstack` → `runner.start` with `env = process.env + vars`; pids patched onto the slot lease (`patchLease(id, { pids })`); failure → release leases, rethrow. `frontend` + `story` → `storybrokr.up`.
9. `record`: `addEffort` with `state: 'active'`; return.

- [ ] **Step 1: Failing tests** (fake runner + fake storybrokr; real git fixture; registry in a temp home)

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git, Registry, commitFile, currentOwner, makeRepo, validateManifest } from '@helmsmith/workkit';
import { afterEach, describe, expect, it } from 'vitest';
import { startEffort } from './effort.js';

const manifest = validateManifest({
  project: 'demo', baseBranch: 'develop', worktreeRoot: '.claude/worktrees',
  ports: { services: { frontend: { base: 43000 }, backend: { base: 43100 } } },
  services: { backend: { start: 'true', stop: 'true', health: 'true' }, frontend: { start: 'true', stop: 'true', health: 'true' } },
  scopes: { frontend: ['app-ui/app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart' }, 'shop/team': { module: 'team' }, 'platform/auth': { commons: ['auth'] } },
  commons: { auth: ['api/auth/**'] },
  refresh: [{ when: 'lock.json', run: 'touch refreshed.marker' }],
});
const fakeRunner = () => { const calls: string[] = []; return { calls, start: async () => { calls.push('start'); return { pids: { backend: process.pid } }; }, stop: async () => { calls.push('stop'); } }; };
const fakeSb = () => ({ ups: [] as string[], up: async (story: string) => { return { id: 'sb_1', port: 6101, url: 'http://x' }; }, down: async () => {} });

function ctxFor(f: { main: string }, runner = fakeRunner(), storybrokr = fakeSb()) {
  const home = mkdtempSync(join(tmpdir(), 'wk-eff-'));
  const registry = Registry.open(home);
  registry.upsertProject('demo', { root: f.main, ranges: {} });
  return { home, repoRoot: f.main, manifest, registry, owner: currentOwner({ WORK_SESSION: 's1' }), runner, storybrokr, log: () => {} };
}

describe('startEffort', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('creates the area worktree on <type>/<area>, syncs, leases a slot, emits config, starts services, records the effort', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    expect(r.effort.branch).toBe('feature/shop/cart');
    expect(new Git(r.effort.worktree).currentBranch()).toBe('feature/shop/cart');
    expect(r.leases.map((l) => l.kind)).toEqual(['slot']);
    expect(r.leases[0].value).toBe(1);
    expect(ctx.registry.activeEffortFor('demo', 'shop/cart')?.id).toBe(r.effort.id);
    expect((ctx.runner as ReturnType<typeof fakeRunner>).calls).toEqual(['start']);
  });

  it('refuses a second effort on the same area and names the owner; --join adopts it', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    await expect(startEffort({ ...ctx, owner: { session: 's2', pid: 2 } }, { area: 'shop/cart', type: 'fix', mode: 'frontend' })).rejects.toMatchObject({ code: 'EFFORT_OPEN', details: { owner: 's1' } });
    const j = await startEffort({ ...ctx, owner: { session: 's2', pid: 2 } }, { area: 'shop/cart', type: 'feature', mode: 'frontend', join: true });
    expect(j.effort.area).toBe('shop/cart');
  });

  it('refuses overlapping scopes across areas only when they overlap', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    await expect(startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'frontend' })).resolves.toBeTruthy();
  });

  it('conflict stops before any lease', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'README.md', 'mine', 'mine');
    commitFile(f.main, 'README.md', 'theirs', 'theirs'); new Git(f.main).push('develop');
    ctx.registry.updateEffort(first.effort.id, { state: 'finished' });
    await expect(startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' })).rejects.toMatchObject({ code: 'SYNC_CONFLICT', details: { conflicted: ['README.md'] } });
    expect(ctx.registry.leases({ kind: 'slot' })).toEqual([]);
  });

  it('runs refresh entries for paths the sync changed', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    ctx.registry.updateEffort(first.effort.id, { state: 'finished' });
    commitFile(f.main, 'lock.json', '{}', 'deps'); new Git(f.main).push('develop');
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    expect(r.sync).toBe('ff');
    expect(r.refreshed).toEqual(['touch refreshed.marker']);
  });

  it('a cross-cutting area takes commons write locks', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'platform/auth', type: 'fix', mode: 'frontend' });
    expect(r.leases.map((l) => `${l.kind}:${l.value}`)).toEqual(['commons:auth']);
  });

  it('frontend with a story records the storybrokr instance as a lease', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend', story: 'components/cart/Cart.stories.tsx' });
    expect(r.leases.map((l) => `${l.kind}:${l.value}`)).toEqual(['storybook:sb_1']);
  });
});
```
(`validateManifest` here has no `storybook.hostRoot`; `startEffort` uses `repoRoot` as the host when absent.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `effort.ts` (startEffort), `storybrokr.ts`, `start.ts`** (`work start --area <a> --type <t> --mode <m> [--story <path>] [--join] [--no-sync] [--json]`; prints the status block from Task 12 or JSON). The main-checkout guard: `start` refuses when `process.cwd()` is inside the main checkout **and** the user is not merely invoking from the repo root; concretely: resolve `repoRoot` from cwd (`git rev-parse --show-toplevel` of the main checkout via `--git-common-dir`), never create the worktree inside another worktree, and refuse when the resolved target worktree path equals the caller's checkout root (that would mean working in the main checkout). **Step 4: Run** → PASS 7/7. **Step 5: Commit** — `feat(workbrokr): work start`.

---

### Task 12: `work status` and `work env`

**Files:**
- Create: `apps/workbrokr/src/commands/status.ts`, `apps/workbrokr/src/commands/env.ts`
- Modify: `apps/workbrokr/src/lib/effort.ts` (add `statusFor(ctx, area?)`, `effortEnv(ctx, area)`)
- Test: `apps/workbrokr/src/lib/effort.test.ts` (append)

**Interfaces:**
- Produces: `statusFor(ctx, area?): StatusReport` = `{ project, areas: AreaStatus[], leases: Lease[] }`, `AreaStatus = { area, effort?: Effort, leases: Lease[], behindBase: number, notices: Notice[] }`; `effortEnv(ctx, area): Record<string,string>` (the vars the config emitter wrote; `MODE`, `PORT_*`, `SLOT`, `LOG_DIR`, `WORKTREE`, `BRANCH`), and `slotEnv(manifest, slot): Record<string,string>` (the same vars computed from the manifest alone, no effort needed; `LOG_DIR`, `WORKTREE` and `BRANCH` empty). Table output: one line per area (`AREA  TYPE/MODE  BRANCH  OWNER  STARTED  LEASES  BEHIND  NOTICES`) then one line per lease (`KIND VALUE OWNER AGE EXPIRES-IN`); `--json` prints the report. `work env (--area <a> | --slot <n>) [--project-root <dir>] [--json|--sh]` prints `KEY=value` lines (sh) or JSON; `--slot` uses `slotEnv` so a Makefile can ask for a slot's ports before any effort exists (phase 1b's `make slot-check` depends on it); `--project-root` overrides the manifest lookup from cwd.

- [ ] **Step 1: Failing test** — after a start: `statusFor(ctx)` has one area with the effort, a slot lease, `behindBase: 0`; after `commitFile(main)+push`, `behindBase: 1`; `effortEnv` contains `PORT_BACKEND: '43101'` and `SLOT: '1'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(workbrokr): status and env`.

---

### Task 13: `work finish` and `work reap`

**Files:**
- Create: `apps/workbrokr/src/commands/finish.ts`, `apps/workbrokr/src/commands/reap.ts`
- Modify: `apps/workbrokr/src/lib/effort.ts` (add `finishEffort`, `reapLeases`)
- Test: `apps/workbrokr/src/lib/effort.test.ts` (append)

**Interfaces:**
- Produces: `finishEffort(ctx, { area, park?: boolean }): Promise<{ effort, pushed: boolean, notices: number }>`: refuse `DIRTY_WORKTREE` unless `park` (then `git add -A && commit -m "wip(<area>): parked <ISO date>"`); stop runner with the slot lease's `pids`; `storybrokr.down` for storybook leases; release every lease of the effort; `push(branch)`; notices: if `commonsTouched(m, changedPaths(origin/base, branch))` non-empty, append `{ from: branch, text: "commons <names> changed on <branch>: sync and re-verify", at }` to every other area's latest effort (or a `parked` placeholder record per area if none exists — simplest: store notices per area in `registry` under efforts of that area; when no effort exists, create one with `state: 'finished'` and `notices` only); set `state: 'finished'`.
- `reapLeases(ctx, { dryRun?: boolean, now?: Date }): Promise<{ reaped: Lease[] }>`: for each expired lease: stop only `lease.pids` that are alive (`isAlive`) via the manifest stop commands with the lease's env then the pid group; `storybrokr.down` for storybook kind; release; the effort → `state: 'parked', parkedReason: 'idle: <kind> lease expired'`. Garbage: leases whose effort's worktree directory no longer exists → release.

- [ ] **Step 1: Failing tests**

```ts
  it('finish refuses a dirty worktree, parks with --park, releases leases, pushes', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    writeFileSync(join(r.effort.worktree, 'dirty.txt'), 'x');
    await expect(finishEffort(ctx, { area: 'shop/cart' })).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' });
    const done = await finishEffort(ctx, { area: 'shop/cart', park: true });
    expect(done.pushed).toBe(true);
    expect(new Git(f.main).remoteBranchExists('feature/shop/cart')).toBe(true);
    expect(ctx.registry.leases()).toEqual([]);
    expect((ctx.runner as ReturnType<typeof fakeRunner>).calls).toEqual(['start', 'stop']);
  });

  it('finish leaves notices on other areas when commons changed', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'platform/auth', type: 'fix', mode: 'frontend' });
    commitFile(r.effort.worktree, 'api/auth/x.ts', '1', 'auth change');
    await finishEffort(ctx, { area: 'platform/auth' });
    const s = await import('./effort.js').then((m) => m.statusFor(ctx, 'shop/cart'));
    expect(s.areas[0].notices[0].text).toMatch(/commons auth changed/);
  });

  it('reap ignores a foreign process on the slot\'s port and stops only recorded pids', async () => {
    const f = makeRepo(); cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    const lease = r.leases[0];
    const late = new Date(Date.parse(lease.expires) + 60_000);
    const out = await reapLeases(ctx, { now: late });
    expect(out.reaped.map((l) => l.id)).toEqual([lease.id]);
    expect(ctx.registry.efforts({ area: 'shop/cart' })[0].state).toBe('parked');
    expect((ctx.runner as ReturnType<typeof fakeRunner>).calls).toEqual(['start', 'stop']);
  });
```
(The fake runner records which pids it was asked to stop; assert it received exactly `{ backend: process.pid }` from the lease, which proves nothing else is targeted.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(workbrokr): finish (with --park) and reap`.

---

### Task 14: `work retire` and `work audit`

**Files:**
- Create: `apps/workbrokr/src/commands/retire.ts`, `apps/workbrokr/src/commands/audit.ts`
- Modify: `apps/workbrokr/src/lib/effort.ts` (add `retireArea`, `auditProject`)
- Test: `apps/workbrokr/src/lib/effort.test.ts` (append)

**Interfaces:**
- `retireArea(ctx, { area }): Promise<{ archived: string[]; removed: string }>`: refuse `EFFORT_OPEN` while active; refuse `UNPUSHED` when `unpushedCount > 0` or `isDirty`; archive each `manifest.archive.paths` that exists under the worktree into `${repoRoot}/.slot-archive/<area-with-slashes-as-dashes>-<UTC>/`; apply retention (`keepDays`, `keepPerArea`) to older archives of that area; `worktreeRemove`; `deleteLocalBranch` for every `<type>/<area>` branch that is fully on `origin` (skip and report others); drop the area's finished efforts from the registry.
- `auditProject(ctx): Finding[]`, `Finding = { kind: 'dirty'|'unpushed'|'foreign-branch'|'lease-aging'|'behind-base'|'notice-stale'|'archive-size'; area?: string; detail: string }`: walk `worktreeRoot` recursively for git worktrees (`git worktree list --porcelain` from `repoRoot`), classify as above (`foreign-branch` when the branch is not `<type>/<area>` for a known area), leases past half their expiry, `behindBase > 20`, notices older than 7 days, archive directory over 5 GB.

- [ ] **Step 1: Failing tests** — retire refuses with unpushed commits then succeeds after `finish` (worktree gone, local branch gone, archive dir exists when `archive.paths` lists an existing dir); audit on a repo with a dirty area worktree and a hand-made `tmp/x` worktree returns `dirty` and `foreign-branch` findings.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(workbrokr): retire and audit`.

---

### Task 15: `work hook` and the hooks end to end

**Files:**
- Create: `apps/workbrokr/src/commands/hook.ts`
- Test: `apps/workbrokr/tests/e2e/hooks.test.ts`

**Interfaces:**
- `work hook pre-commit`: `git rev-parse --show-toplevel` of cwd → find the repo root via `--git-common-dir`; `loadManifest(repoRoot)` (absent → exit 0 silently: hooks must never break a repo that stopped using the tool); `checkCommit` with staged paths; refusals → print each to stderr, exit 2. `work hook pre-push`: reads the stdin lines git passes (`<local ref> <local sha> <remote ref> <remote sha>`), `changedPaths(remote sha or origin/<base>, local sha)`, `checkPush`; refusals exit 2, warnings printed, exit 0.
- `work hooks install [--project-root <dir>]`: calls `installHooks(repoRoot)` alone, for a clone whose manifest already exists (adoption of an existing repo, or a second clone); prints the files written. Same test shape as `installHooks` but through the bin.

- [ ] **Step 1: Failing e2e test** — in a `makeRepo()` clone: `work init …`, commit the generated files, then `git commit` on `develop` → exit non-zero with "protected" in stderr; in a `work start`ed area worktree (fake services via `true`) a commit succeeds; with a commons lease held by another session a commit touching that commons fails with the owner's session in stderr.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (register in `cli.ts`; the hook scripts call `workbrokr`, so the e2e test prepends `apps/workbrokr/bin` (a `workbrokr` shim to `work.mjs`) to `PATH`). **Step 4: Run** → PASS. **Step 5: Commit** — `feat(workbrokr): hook command; protected-branch and commons checks run from git`.

---

### Task 16: MCP server

**Files:**
- Create: `apps/workbrokr/src/mcp/server.ts`, `apps/workbrokr/src/commands/mcp.ts`
- Test: `apps/workbrokr/src/mcp/server.test.ts`

**Interfaces:**
- `buildMcpServer(ctxFactory: () => Promise<Ctx>): McpServer` registering `work_start` (area, type, mode, story?, join?, sync?), `work_status` (area?), `work_finish` (area, park?), `work_reap` (dryRun?), `work_audit`, `work_env` (area). Each returns the same JSON the CLI's `--json` prints; failures return `toErrorBody` with `isError: true` (copy storybrokr's `ok/failed/guard` helpers). `work mcp` starts it on stdio.

- [ ] **Step 1: Failing test** — `buildMcpServer` lists exactly those six tools (use the SDK's in-memory transport pair as storybrokr's `server.test.ts` does) and `work_status` on an empty registry returns `{ areas: [] }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(workbrokr): MCP server`.

---

### Task 17: End-to-end suite against a fixture project

**Files:**
- Create: `apps/workbrokr/tests/e2e/fixtures/project/helmsmith.config.mjs`, `apps/workbrokr/tests/e2e/fixtures/project/services/http.mjs` (copy of workkit's `http-service.mjs`), `apps/workbrokr/tests/e2e/lifecycle.test.ts`

The fixture manifest: project `fixture`, base `develop`, services `backend` (port base 45100, start `node services/http.mjs --port $PORT_BACKEND --name backend`, health curl with `healthyCodes: [200]`, stop `true`) and `frontend` (45200), scopes as in the spec, areas `shop/cart` (module `cart`), `platform/auth` (commons `auth`), commons `auth: ['api/auth/**']`, refresh `[{ always: true, run: 'echo refreshed >> .logs/refresh.marker' }]`, `env.file: '.env.slot'`.

- [ ] **Step 1: Write the test** — build a `makeRepo()`-style origin whose `develop` contains the fixture project files; then through the **bin**: `work start --area shop/cart --type feature --mode fullstack --json` → exit 0, JSON has `leases[0].kind === 'slot'`, `.env.slot` exists in the worktree, `curl` on `PORT_BACKEND/health` answers; `work status --json` lists it; a second `work start` on the same area from `WORK_SESSION=other` → exit 2 and stderr names `s1`; `work finish --area shop/cart --json` → exit 0, port closed, remote branch exists; `work retire --area shop/cart` → worktree gone; `work audit --json` → `[]`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/workbrokr test:e2e` → FAIL until wired. **Step 3: Fix whatever the real bin surfaces** (PATH for `storybrokr` is not needed in this test; `--mode frontend` without `--story` must not call it). **Step 4: Run** → PASS. **Step 5: Commit** — `test(workbrokr): lifecycle end to end through the bin`.

---

### Task 18: SKILL.md, README, changeset, spec amendments

**Files:**
- Create: `apps/workbrokr/SKILL.md`, `apps/workbrokr/README.md`, `platform/core/workkit-lib/README.md`, `.changeset/workbrokr-phase-1.md`
- Modify: `docs/superpowers/specs/2026-10-17-workbrokr-design.md` §16 (append the three amendments from Global Constraints), `scripts/sync-skills.mjs` only if it needs the new SKILL.md registered (read it first; storybrokr's SKILL.md is the template).

- [ ] **Step 1: SKILL.md** — front matter `name: work`, a `description` that fires on "start work on <area>", "new effort", "which slot", "finish this", "clean up worktrees", "audit worktrees"; the loop: `work status --json` → `work start --area … --type … --mode …` (how to pick type and mode; frontend needs `--story` for a Storybook) → read refusals (`EFFORT_OPEN` → ask or `--join`; `SCOPE_CONFLICT` → pick another area or wait; `SYNC_CONFLICT` → resolve in the worktree, rerun with `--no-sync`) → work in `effort.worktree` only → `work finish --area …` (or `--park`) → never `git commit` on a protected branch, never bypass with raw `git worktree`.
- [ ] **Step 2: READMEs** — install (`npm i -g @helmsmith/workbrokr`), `work init` walkthrough, the manifest reference (every key, one line each), the verbs, exit codes, the registry location, the three amendments.
- [ ] **Step 3: Changeset** — `"@helmsmith/workkit": minor`, `"@helmsmith/workbrokr": minor`, one paragraph.
- [ ] **Step 4: Full gate** — `pnpm check && pnpm -r typecheck && pnpm --filter @helmsmith/workkit test && pnpm --filter @helmsmith/workbrokr test && pnpm --filter @helmsmith/workbrokr test:e2e` → all green.
- [ ] **Step 5: Commit** — `docs(workbrokr): skill, readmes, changeset; spec amendments recorded`.

---

## Self-review

**Spec coverage.** §4 architecture → Tasks 0–9 (core) and 10–16 (brokers); §5.1 manifest → Task 2 (schema) + Task 10 (init); §5.2 port plan → Tasks 3–4 (amended to per-service ranges); §5.3 hooks → Tasks 7 and 15; §6 areas/branches/protected → Tasks 2 (leaf check), 6, 7, 11; §7.1–7.3 locks → Tasks 5, 7, 11; §7.4 notices → Task 13 (commons-based, amended); §8 verbs → Tasks 11–15; §9 registry → Task 3; §10 runners → Tasks 9, 11 (frontend via storybrokr CLI, amended: no port lease); §11 safety → Tasks 9 (pid-scoped stop), 11 (main checkout), 14 (retire refuses unpushed); §12 agent surface → Tasks 10 (exit codes, --json), 16 (MCP), 18 (skill); §13 adoption → plan 1b; §14 phase 1 complete; §15 tests → each task plus Task 17. Gap found and closed: the spec's `work init` "interviews" — phase 1 is flags-only (inquirer prompts deferred; every value is a flag, per the conventions' rule that every prompt is also a flag).

**Placeholders.** The `<same as storybrokr>` version strings in Task 0 are an instruction to copy exact ranges from a named file, not a TBD; Task 10 forbids placeholder shell in the generated manifest.

**Type consistency.** `Lease.pids` (Task 1) is what Task 11 patches and Task 13 stops; `Effort.scopes` (Task 1) is what Task 7's `checkPush` and Task 11's overlap read; `StatusReport.areas[].notices` (Task 12) is where Task 13 writes; `portsForSlot` is defined in Task 3's step 4 and extended in Task 4 without renaming.

**Review Focus.** Each of the five has a named test in the task that owns it (3, 2, 11, 13, 7).

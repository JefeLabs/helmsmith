# workbrokr Parallel Waves, Mode Promotion & Core Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `@helmsmith/workbrokr` to support intra-area parallel waves (`--mode backend`, `--task <slug>`, `--scope <glob>`), in-place mode promotion (`work promote`), task convergence (`work finish --into-area`), reference-counted `--join`, squash-merge recovery, hash-stamped refresh with clean lockfile restore, submodule pre-sync repair, accurate notice lifecycle, mode-aware `extraScopes`/`sharedScopes`, git hook chaining, worktree-bound commit guards, single-fetch status/audit, and `./core` package exports.

**Architecture:** Extend `apps/workbrokr/src/core/` with `Mode = 'frontend' | 'backend' | 'fullstack'`, task-addressed efforts (`(area, task)`), segment-aware glob overlap + subset validation, worktree-bound `checkCommit`, hash-stamped `selectRefresh`/`runRefresh`, submodule/squash-merge git helpers, and mode-filtered service runner. Extend `apps/workbrokr/src/lib/effort.ts`, CLI commands, and the MCP server with `--task`, `--scope`, `--into-area`, `--force`, `work promote` (`work_promote`), and `projectRoot` overrides.

**Tech Stack:** TypeScript (`>=7.0.2`), Node.js (`>=24`), `tsup`, `vitest`, `zod`, `picomatch`, `commander`, `@modelcontextprotocol/sdk`.

## Global Constraints

- Node engine floor: `>=24` (`apps/workbrokr/package.json`).
- All refusal `ErrorCode`s exit with code `2`; unexpected/internal errors exit with code `1`.
- Area efforts live at `<worktreeRoot>/<area>` on branch `<type>/<area>` (permanent); task sub-efforts live at `<worktreeRoot>/_tasks/<area>--<task>` on branch `<type>/<area>--<task>` (ephemeral, removed on `work finish`).
- Task slug regex: `/^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/` (no `--` allowed inside task slugs or area segments).
- Run unit tests via `pnpm --filter @helmsmith/workbrokr test` and typecheck via `pnpm --filter @helmsmith/workbrokr typecheck`.

---

### Task 1: Package Exports, Core Types, Error Codes, and Manifest Validation

**Files:**
- Modify: `apps/workbrokr/package.json`
- Modify: `apps/workbrokr/tsup.config.ts`
- Modify: `apps/workbrokr/src/core/types.ts`
- Modify: `apps/workbrokr/src/core/errors.ts`
- Modify: `apps/workbrokr/src/core/manifest.ts`
- Test: `apps/workbrokr/src/core/manifest.test.ts`

**Interfaces:**
- Consumes: none (foundational types and schema)
- Produces:
  - `Mode = 'frontend' | 'backend' | 'fullstack'`
  - `ExtraScopesSpec = string[] | { frontend?: string[]; backend?: string[] }`
  - `AreaSpec.sharedScopes?: string[]`, `Manifest.seed?: string[]`, `RefreshEntry.restoreWhenIfClean?: boolean`, `ServiceSpec.modes?: ('backend' | 'fullstack')[]`
  - `Effort.task?: string`, `Effort.participants?: Owner[]`, `Effort.baseSha?: string`
  - `TASK_SLUG = /^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/`
  - `ErrorCode`: adds `'TASK_INVALID' | 'SCOPE_REQUIRES_TASK' | 'SCOPE_OUTSIDE_AREA' | 'MODE_MISMATCH'`

- [ ] **Step 1: Write the failing tests in `apps/workbrokr/src/core/manifest.test.ts`**

Add tests for `seed`, `modes` on services, structured `extraScopes`, `sharedScopes`, area `--` rejection, and new refusal error codes in `apps/workbrokr/src/core/manifest.test.ts`:

```ts
  it('accepts seed, service modes, structured extraScopes, and sharedScopes', () => {
    const m = validateManifest({
      ...minimal,
      seed: ['.scripts-tools/worktree-seed.sh .'],
      services: {
        ...minimal.services,
        backend: { ...minimal.services.backend, modes: ['backend', 'fullstack'] },
      },
      areas: {
        'org/dashboard': {
          module: 'dashboard',
          extraScopes: { frontend: ['app-ui/widgets/**'], backend: ['svc/shared/**'] },
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
      },
    });
    expect(m.seed).toEqual(['.scripts-tools/worktree-seed.sh .']);
    expect(m.areas['org/dashboard'].sharedScopes).toEqual([
      'app-ui/components/discover-schools/dashboards/**',
    ]);
  });

  it('rejects area names containing double-dash (--)', () => {
    expect(() =>
      validateManifest({ ...minimal, areas: { 'org/my--area': { module: 'x' } } }),
    ).toThrow(/areas/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/manifest.test.ts`
Expected: FAIL (`extraScopes` object rejected by Zod schema; `org/my--area` not rejected).

- [ ] **Step 3: Update `package.json`, `tsup.config.ts`, `types.ts`, `errors.ts`, and `manifest.ts`**

In `apps/workbrokr/package.json`, add `"exports"`:
```json
  "main": "./dist/cli.js",
  "exports": {
    ".": "./dist/cli.js",
    "./core": "./dist/core/index.js"
  },
```

In `apps/workbrokr/tsup.config.ts`, update `entry`:
```ts
export default defineConfig({
  entry: ['src/cli.ts', 'src/core/index.ts'],
  format: ['esm'],
```

In `apps/workbrokr/src/core/types.ts`:
```ts
export type Mode = 'frontend' | 'backend' | 'fullstack';
export type EffortState = 'starting' | 'active' | 'parked' | 'finished';
export type LeaseKind = 'slot' | 'storybook' | 'commons';

export interface ServiceSpec {
  start: string;
  stop: string;
  health: string;
  /** stdout of `health` (trimmed, last token) must be one of these; absent = exit code 0 is healthy */
  healthyCodes?: number[];
  reset?: string;
  /** default 180_000 */
  healthTimeoutMs?: number;
  /** Which slot-bearing modes start this service. Default: ['fullstack'] for 'frontend', else ['backend', 'fullstack']. */
  modes?: ('backend' | 'fullstack')[];
}

export interface RefreshEntry {
  when?: string;
  always?: boolean;
  run?: string;
  mark?: string;
  /** Restore clean `when`-matched files if the refresh command dirties them (default true when `when` is set). */
  restoreWhenIfClean?: boolean;
}

export type ExtraScopesSpec =
  | string[]
  | {
      frontend?: string[];
      backend?: string[];
    };

export interface AreaSpec {
  module?: string;
  commons?: string[];
  extraScopes?: ExtraScopesSpec;
  sharedScopes?: string[];
}

export interface ArchiveSpec {
  paths: string[];
  keepDays: number;
  keepPerArea: number;
}

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
  seed?: string[];
  refresh: RefreshEntry[];
  scopes: { frontend: string[]; backend: string[] };
  areas: Record<string, AreaSpec>;
  commons: Record<string, string[]>;
  expiry: { slotHours: number; commonsHours: number; storybookHours: number };
  archive: ArchiveSpec;
}
```
And on `Effort` in `apps/workbrokr/src/core/types.ts`:
```ts
export interface Effort {
  id: string;
  project: string;
  area: string;
  task?: string;
  type: string;
  mode: Mode;
  branch: string;
  worktree: string;
  owner: Owner;
  participants?: Owner[];
  baseSha?: string;
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

In `apps/workbrokr/src/core/errors.ts`, add `'TASK_INVALID' | 'SCOPE_REQUIRES_TASK' | 'SCOPE_OUTSIDE_AREA' | 'MODE_MISMATCH'` to both `ErrorCode` and `REFUSALS`.

In `apps/workbrokr/src/core/manifest.ts`, export `TASK_SLUG = /^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/;` and update `Service` and `Schema`:
```ts
export const TASK_SLUG = /^(?!.*--)[a-z0-9][a-z0-9_-]{0,47}$/;

const Service = z.object({
  start: z.string().min(1),
  stop: z.string().min(1),
  health: z.string().min(1),
  healthyCodes: z.array(z.number().int()).optional(),
  reset: z.string().optional(),
  healthTimeoutMs: z.number().int().positive().optional(),
  modes: z.array(z.enum(['backend', 'fullstack'])).optional(),
});

const ExtraScopes = z.union([
  z.array(z.string()),
  z.object({
    frontend: z.array(z.string()).optional(),
    backend: z.array(z.string()).optional(),
  }),
]);
```
And in `Schema`:
- `seed: z.array(z.string().min(1)).optional(),`
- `refresh`: add `restoreWhenIfClean: z.boolean().optional(),`
- `areas`: key regex `/^(?!.*--)[a-z0-9-]+(\/[a-z0-9-]+)*$/`, value adds `extraScopes: ExtraScopes.optional(), sharedScopes: z.array(z.string()).optional()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/package.json apps/workbrokr/tsup.config.ts apps/workbrokr/src/core/types.ts apps/workbrokr/src/core/errors.ts apps/workbrokr/src/core/manifest.ts apps/workbrokr/src/core/manifest.test.ts
git commit -m "feat(workbrokr): add backend mode, task/scope types, manifest schema & core export"
```

---

### Task 2: Mode-Aware Scopes, `extraScopes`/`sharedScopes`, `--scope` Narrowing, and Segment-Aware `globsOverlap`

**Files:**
- Modify: `apps/workbrokr/src/core/scopes.ts`
- Test: `apps/workbrokr/src/core/scopes.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `Mode`, `Effort`, `WorkkitError` from `src/core/types.ts` and `src/core/errors.ts`
- Produces:
  - `expandScopes(m: Manifest, area: string, mode: Mode, narrowedScopes?: string[], hasTask?: boolean): string[]`
  - `allowedScopesForEffort(m: Manifest, effort: Pick<Effort, 'area' | 'scopes'>): string[]`
  - `isSubGlob(child: string, parent: string): boolean`
  - `globsOverlap(a: string[], b: string[]): string[]`

- [ ] **Step 1: Write the failing tests in `apps/workbrokr/src/core/scopes.test.ts`**

Add tests to `apps/workbrokr/src/core/scopes.test.ts`:
```ts
  it('supports backend mode and mode-specific extraScopes + sharedScopes', () => {
    const m2 = validateManifest({
      ...minimal,
      scopes: {
        frontend: ['app-ui/app/{group}/{section}/**'],
        backend: ['svc/modules/{module}/**', 'db/migration/*{module}*'],
      },
      areas: {
        'org/dashboard': {
          module: 'dashboard',
          extraScopes: { frontend: ['app-ui/widgets/org/**'], backend: ['svc/common/dash/**'] },
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
        'family/dashboard': {
          module: 'family_dashboard',
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
      },
    });
    expect(expandScopes(m2, 'org/dashboard', 'backend')).toEqual([
      'svc/modules/dashboard/**',
      'db/migration/*dashboard*',
      'svc/common/dash/**',
    ]);
    expect(expandScopes(m2, 'org/dashboard', 'frontend')).toEqual([
      'app-ui/app/org/dashboard/**',
      'app-ui/widgets/org/**',
    ]);
    // sharedScopes do not cause org/dashboard and family/dashboard to overlap by default
    expect(
      globsOverlap(
        expandScopes(m2, 'org/dashboard', 'frontend'),
        expandScopes(m2, 'family/dashboard', 'frontend'),
      ),
    ).toEqual([]);
  });

  it('compares globs by path segment so school vs schoolscandidates and distinct *module* globs do not collide', () => {
    expect(
      globsOverlap(['app-service/modules/school/**'], ['app-service/modules/schoolscandidates/**']),
    ).toEqual([]);
    expect(
      globsOverlap(['db/migration/*registration_students*'], ['db/migration/*team*']),
    ).toEqual([]);
    expect(
      globsOverlap(['db/migration/*team*'], ['db/migration/*team*']),
    ).toEqual(['db/migration/*team* ~ db/migration/*team*']);
  });

  it('narrows scopes when --task and --scope are passed, and refuses invalid narrowing', () => {
    expect(() =>
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/cart/SearchInput/**'], false),
    ).toThrow(/SCOPE_REQUIRES_TASK|--task/);
    expect(
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/cart/SearchInput/**'], true),
    ).toEqual(['app-ui/app/shop/cart/SearchInput/**']);
    expect(() =>
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/team/**'], true),
    ).toThrow(/outside|SCOPE_OUTSIDE_AREA/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/scopes.test.ts`
Expected: FAIL (`expandScopes` does not handle `backend` mode or `narrowedScopes`; `globsOverlap` falsely reports overlaps).

- [ ] **Step 3: Implement mode-aware `expandScopes`, `isSubGlob`, `allowedScopesForEffort`, and segment-aware `globsOverlap` in `apps/workbrokr/src/core/scopes.ts`**

Replace `apps/workbrokr/src/core/scopes.ts` with:
```ts
import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { AreaSpec, Effort, Manifest, Mode } from './types.js';

/** `{group}` = every segment but the last, `{section}` = the last segment of an area path. */
export function areaVars(area: string): { group: string; section: string } {
  const parts = area.split('/');
  return { group: parts.slice(0, -1).join('/'), section: parts[parts.length - 1] };
}

function fill(template: string, vars: Record<string, string | undefined>): string | null {
  let missing = false;
  const out = template.replace(/\{(group|section|module)\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === '') {
      missing = true;
      return '';
    }
    return v;
  });
  return missing ? null : out;
}

function extraScopesForMode(spec: AreaSpec, mode: Mode): string[] {
  if (!spec.extraScopes) return [];
  if (Array.isArray(spec.extraScopes)) {
    return mode === 'frontend' || mode === 'fullstack' ? spec.extraScopes : [];
  }
  const out: string[] = [];
  if (mode === 'frontend' || mode === 'fullstack') out.push(...(spec.extraScopes.frontend ?? []));
  if (mode === 'backend' || mode === 'fullstack') out.push(...(spec.extraScopes.backend ?? []));
  return out;
}

const normalizeGlob = (g: string) => g.replace(/^\.\//, '').replace(/\/+$/, '');
const hasWildcard = (s: string) => /[*?[{]/.test(s);

/** True when every path matched by `child` is guaranteed to be inside `parent`. */
export function isSubGlob(child: string, parent: string): boolean {
  const c = normalizeGlob(child);
  const p = normalizeGlob(parent);
  if (c === p) return true;
  const cSegs = c.split('/');
  const pSegs = p.split('/');
  for (let i = 0; i < pSegs.length; i++) {
    const ps = pSegs[i];
    if (ps === '**') return true;
    const cs = cSegs[i];
    if (cs === undefined || cs === '**') return false;
    if (!hasWildcard(ps) && !hasWildcard(cs)) {
      if (ps !== cs) return false;
      continue;
    }
    if (!hasWildcard(cs) && hasWildcard(ps)) {
      if (!picomatch.isMatch(cs, ps, { dot: true })) return false;
      continue;
    }
    if (cs !== ps) return false;
  }
  return cSegs.length === pSegs.length;
}

/** The globs an effort on `area` holds exclusively in `mode`; backend/fullstack templates need the area's module. */
export function expandScopes(
  m: Manifest,
  area: string,
  mode: Mode,
  narrowedScopes?: string[],
  hasTask = false,
): string[] {
  const spec = m.areas[area];
  if (!spec)
    throw new WorkkitError(
      'AREA_UNKNOWN',
      `unknown area "${area}" (known: ${Object.keys(m.areas).join(', ')})`,
    );
  const vars = { ...areaVars(area), module: spec.module };
  const out: string[] = [];
  if (mode === 'frontend' || mode === 'fullstack') {
    for (const t of m.scopes.frontend) {
      const g = fill(t, vars);
      if (g) out.push(g);
    }
  }
  if (mode === 'backend' || mode === 'fullstack') {
    if (!spec.module) {
      throw new WorkkitError(
        'MANIFEST_INVALID',
        `area "${area}" has no module, so a ${mode} effort cannot hold a backend scope; add areas["${area}"].module or use --mode frontend`,
      );
    }
    for (const t of m.scopes.backend) {
      const g = fill(t, vars);
      if (g) out.push(g);
    }
  }
  out.push(...extraScopesForMode(spec, mode));
  if (!narrowedScopes || narrowedScopes.length === 0) return out;
  if (!hasTask) {
    throw new WorkkitError(
      'SCOPE_REQUIRES_TASK',
      '--scope narrowing requires --task <slug> so primary area efforts always protect the full area',
    );
  }
  const allowed = [...out, ...(spec.sharedScopes ?? [])];
  for (const g of narrowedScopes) {
    if (!allowed.some((base) => isSubGlob(g, base))) {
      throw new WorkkitError(
        'SCOPE_OUTSIDE_AREA',
        `narrowed scope "${g}" is outside ${area}'s ${mode} scopes (${allowed.join(', ')})`,
        { area, mode, scope: g, allowed },
      );
    }
  }
  return narrowedScopes;
}

/** All globs an effort is allowed to touch without an out-of-scope warning (exclusive scopes + sharedScopes + commons). */
export function allowedScopesForEffort(
  m: Manifest,
  effort: Pick<Effort, 'area' | 'scopes'>,
): string[] {
  const shared = m.areas[effort.area]?.sharedScopes ?? [];
  const allCommons = Object.values(m.commons).flat();
  return [...effort.scopes, ...shared, ...allCommons];
}

/** The part of a glob before its first wildcard character. */
export function literalPrefix(glob: string): string {
  const i = glob.search(/[*?[{]/);
  return i < 0 ? glob : glob.slice(0, i);
}

function segmentsOverlap(sx: string, sy: string): boolean {
  if (sx === sy) return true;
  const wx = hasWildcard(sx);
  const wy = hasWildcard(sy);
  if (!wx && !wy) return false;
  if (!wx && wy) return picomatch.isMatch(sx, sy, { dot: true });
  if (wx && !wy) return picomatch.isMatch(sy, sx, { dot: true });
  const starToken = /^\*([^*?[{]+)\*$/;
  const mx = starToken.exec(sx);
  const my = starToken.exec(sy);
  if (mx && my) {
    const tx = mx[1];
    const ty = my[1];
    return tx.includes(ty) || ty.includes(tx);
  }
  return true;
}

function twoGlobsOverlap(x: string, y: string): boolean {
  const xs = normalizeGlob(x).split('/');
  const ys = normalizeGlob(y).split('/');
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    if (xs[i] === '**' || ys[i] === '**') return true;
    if (!segmentsOverlap(xs[i], ys[i])) return false;
  }
  if (xs.length === ys.length) return true;
  const longer = xs.length > ys.length ? xs : ys;
  return longer[len] === '**';
}

/** Pairs `a ~ b` whose path segments overlap. */
export function globsOverlap(a: string[], b: string[]): string[] {
  const pairs: string[] = [];
  for (const x of a) {
    for (const y of b) {
      if (twoGlobsOverlap(x, y)) pairs.push(`${x} ~ ${y}`);
    }
  }
  return pairs;
}

export function pathsMatching(paths: string[], globs: string[]): string[] {
  if (globs.length === 0) return [];
  const isMatch = picomatch(globs, { dot: true });
  return paths.filter((p) => isMatch(p));
}

/** Names of the commons any of `paths` falls under. */
export function commonsTouched(m: Manifest, paths: string[]): string[] {
  return Object.entries(m.commons)
    .filter(([, globs]) => pathsMatching(paths, globs).length > 0)
    .map(([name]) => name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/scopes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/core/scopes.ts apps/workbrokr/src/core/scopes.test.ts
git commit -m "feat(workbrokr): add segment-aware globsOverlap, backend/shared scopes & --scope narrowing"
```

---

### Task 3: Worktree-Bound Commit/Push Guards and Chained Git Hooks

**Files:**
- Modify: `apps/workbrokr/src/core/guards.ts`
- Modify: `apps/workbrokr/src/commands/hook.ts`
- Modify: `apps/workbrokr/src/core/hooks.ts`
- Test: `apps/workbrokr/src/core/guards.test.ts`
- Test: `apps/workbrokr/src/core/hooks.test.ts`

**Interfaces:**
- Consumes: `allowedScopesForEffort`, `pathsMatching`, `commonsTouched` from `src/core/scopes.ts`
- Produces:
  - `checkCommit(c: CommitCheck): { refusals: string[]; warnings: string[] }`
  - `checkPush(c: PushCheck): { refusals: string[]; warnings: string[] }`
  - `installHooks(repoRoot: string, opts: { protectedBranches: string[] })` with `.git/hooks/<hook>` chaining

- [ ] **Step 1: Write the failing tests in `guards.test.ts` and `hooks.test.ts`**

Add to `apps/workbrokr/src/core/guards.test.ts`:
```ts
  it('refuses commons write from another worktree even when both efforts share the same session id', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    const wtA = join(f.main, '.claude/worktrees/platform/auth');
    const wtB = join(f.main, '.claude/worktrees/shop/cart');
    new Git(f.main).worktreeAdd(wtA, 'fix/platform/auth', 'origin/develop');
    new Git(f.main).worktreeAdd(wtB, 'feature/shop/cart', 'origin/develop');
    registry.addEffort({
      id: 'eff_a',
      project: 'demo',
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      branch: 'fix/platform/auth',
      worktree: wtA,
      owner: { session: 'same-user@host', pid: 1 },
      state: 'active',
      scopes: ['app-ui/app/platform/auth/**'],
      commons: ['auth'],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addLease('commons', 'demo', 'auth', { session: 'same-user@host', pid: 1 }, 'eff_a', 4);
    const refused = checkCommit({
      m,
      registry,
      git: new Git(wtB),
      project: 'demo',
      branch: 'feature/shop/cart',
      stagedPaths: ['api/auth/login.ts'],
      ownerSession: 'same-user@host',
      checkoutRoot: wtB,
    });
    expect(refused.refusals[0]).toMatch(/auth.*write-locked/);
    const allowed = checkCommit({
      m,
      registry,
      git: new Git(wtA),
      project: 'demo',
      branch: 'fix/platform/auth',
      stagedPaths: ['api/auth/login.ts'],
      ownerSession: 'same-user@host',
      checkoutRoot: wtA,
    });
    expect(allowed.refusals).toEqual([]);
  });

  it('refuses a commit touching another open effort exclusive scope and warns on out-of-scope paths', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    const wtA = join(f.main, '.claude/worktrees/shop/cart');
    const wtB = join(f.main, '.claude/worktrees/platform/auth');
    new Git(f.main).worktreeAdd(wtA, 'feature/shop/cart', 'origin/develop');
    new Git(f.main).worktreeAdd(wtB, 'fix/platform/auth', 'origin/develop');
    registry.addEffort({
      id: 'eff_cart',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: wtA,
      owner: { session: 's1', pid: 1 },
      state: 'active',
      scopes: ['app-ui/app/shop/cart/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addEffort({
      id: 'eff_auth',
      project: 'demo',
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      branch: 'fix/platform/auth',
      worktree: wtB,
      owner: { session: 's2', pid: 2 },
      state: 'active',
      scopes: ['app-ui/app/platform/auth/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    const r = checkCommit({
      m,
      registry,
      git: new Git(wtB),
      project: 'demo',
      branch: 'fix/platform/auth',
      stagedPaths: ['app-ui/app/shop/cart/page.tsx', 'unscoped/file.ts'],
      ownerSession: 's2',
      checkoutRoot: wtB,
    });
    expect(r.refusals[0]).toMatch(/active scope of shop\/cart/);
    expect(r.warnings[0]).toMatch(/outside the effort's scope.*unscoped\/file\.ts/);
  });
```

Add to `apps/workbrokr/src/core/hooks.test.ts`:
```ts
  it('chains to an executable .git/hooks/pre-commit script when present', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const legacyHook = join(f.main, '.git/hooks/pre-commit');
    mkdirSync(join(f.main, '.git/hooks'), { recursive: true });
    const { writeFileSync, chmodSync } = require('node:fs');
    writeFileSync(legacyHook, '#!/bin/sh\necho "legacy-pre-commit-ran" >&2\nexit 3\n');
    chmodSync(legacyHook, 0o755);
    installHooks(f.main, { protectedBranches: ['develop'] });
    new Git(f.main).checkout('feature/shop/cart', 'origin/develop');
    let stderr = '';
    try {
      execFileSync('git', ['commit', '--allow-empty', '-m', 'test'], {
        cwd: f.main,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
        stdio: 'pipe',
      });
    } catch (e) {
      stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    }
    expect(stderr).toMatch(/legacy-pre-commit-ran/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/guards.test.ts src/core/hooks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement worktree-bound `checkCommit`/`checkPush` in `guards.ts`, warnings output in `commands/hook.ts`, and hook chaining in `hooks.ts`**

In `apps/workbrokr/src/core/guards.ts`:
```ts
import { existsSync, realpathSync } from 'node:fs';
import { WorkkitError } from './errors.js';
import type { Git } from './git.js';
import type { Registry } from './registry.js';
import { allowedScopesForEffort, commonsTouched, pathsMatching } from './scopes.js';
import type { Effort, Manifest } from './types.js';

export function assertNotProtected(m: Manifest, branch: string): void {
  if (m.protectedBranches.includes(branch)) {
    throw new WorkkitError(
      'PROTECTED_BRANCH',
      `branch "${branch}" is protected (${m.protectedBranches.join(', ')}): work happens on <type>/<area> branches, never here`,
      { branch },
    );
  }
}

export function assertNotMainCheckout(git: Git): void {
  if (git.isMainCheckout()) {
    throw new WorkkitError(
      'MAIN_CHECKOUT',
      `${git.cwd} is the main checkout, which is a mirror of the base branch: run \`work start\` to get an area worktree`,
      { cwd: git.cwd },
    );
  }
}

const same = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

const effortLabel = (e: Pick<Effort, 'area' | 'task'>) =>
  e.task ? `${e.area}--${e.task}` : e.area;

export interface CommitCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  branch: string;
  stagedPaths: string[];
  ownerSession: string;
  /** the committing checkout's top level: a lock held by the effort living there is the committer's own */
  checkoutRoot?: string;
}

/** What a pre-commit hook asks: may this commit be made? Refusals are sentences for stderr. */
export function checkCommit(c: CommitCheck): { refusals: string[]; warnings: string[] } {
  const refusals: string[] = [];
  const warnings: string[] = [];
  if (c.m.protectedBranches.includes(c.branch)) {
    refusals.push(
      `branch "${c.branch}" is protected (${c.m.protectedBranches.join(', ')}): work happens on <type>/<area> branches, never here`,
    );
  }
  const allEfforts = c.registry.efforts({ project: c.project });
  const efforts = new Map(allEfforts.map((e) => [e.id, e]));
  for (const lease of c.registry.leases({ project: c.project, kind: 'commons' })) {
    const holder = efforts.get(lease.effort);
    const holderHasWorktree = Boolean(holder && existsSync(holder.worktree));
    if (holder && holderHasWorktree && c.checkoutRoot) {
      if (same(holder.worktree, c.checkoutRoot)) continue;
    } else if (lease.owner.session === c.ownerSession) {
      continue;
    }
    const globs = c.m.commons[String(lease.value)] ?? [];
    const hit = pathsMatching(c.stagedPaths, globs);
    if (hit.length > 0) {
      refusals.push(
        `commons "${lease.value}" is write-locked by ${lease.owner.session} (effort ${lease.effort}, since ${lease.touched}); staged: ${hit.join(', ')}`,
      );
    }
  }
  const openEfforts = allEfforts.filter((e) => e.state === 'active' || e.state === 'starting');
  for (const other of openEfforts) {
    if (c.checkoutRoot && existsSync(other.worktree) && same(other.worktree, c.checkoutRoot)) {
      continue;
    }
    if (!c.checkoutRoot && other.branch === c.branch) continue;
    const hit = pathsMatching(c.stagedPaths, other.scopes);
    if (hit.length > 0) {
      refusals.push(
        `path(s) ${hit.join(', ')} are inside the active scope of ${effortLabel(other)} (${other.branch}, owned by ${other.owner.session})`,
      );
    }
  }
  const mine = openEfforts.find((e) =>
    c.checkoutRoot && existsSync(e.worktree)
      ? same(e.worktree, c.checkoutRoot)
      : e.branch === c.branch,
  );
  if (mine && c.stagedPaths.length > 0) {
    const allowed = allowedScopesForEffort(c.m, mine);
    const inScope = new Set(pathsMatching(c.stagedPaths, allowed));
    const outside = c.stagedPaths.filter((p) => !inScope.has(p));
    if (outside.length > 0) {
      warnings.push(
        `${outside.length} staged path(s) are outside the effort's scope (${effortLabel(mine)}): ${outside.join(', ')}`,
      );
    }
  }
  return { refusals, warnings };
}

export interface PushCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  /** the local branch being pushed ('' for a delete) */
  branch: string;
  /** the destination ref (`refs/heads/<name>`); absent = same name as the local branch */
  remoteRef?: string;
  isDelete?: boolean;
  changedPaths: string[];
}

/** What a pre-push hook asks: a protected destination → refusal; leaving the scope or touching commons → warnings. */
export function checkPush(c: PushCheck): { refusals: string[]; warnings: string[] } {
  const refusals: string[] = [];
  const warnings: string[] = [];
  const destination = (c.remoteRef ?? `refs/heads/${c.branch}`).replace(/^refs\/heads\//, '');
  if (c.m.protectedBranches.includes(destination)) {
    refusals.push(
      c.isDelete
        ? `refusing to delete protected branch "${destination}"`
        : `"${destination}" is protected (${c.m.protectedBranches.join(', ')}): nothing is pushed to it directly, open a PR from ${c.branch || 'an area branch'}`,
    );
    return { refusals, warnings };
  }
  if (c.isDelete) return { refusals, warnings };
  const effort = c.registry
    .efforts({ project: c.project })
    .find((e) => (e.state === 'active' || e.state === 'parked') && e.branch === c.branch);
  const commons = commonsTouched(c.m, c.changedPaths);
  if (effort) {
    const allowed = allowedScopesForEffort(c.m, effort);
    const inScope = new Set(pathsMatching(c.changedPaths, allowed));
    const outside = c.changedPaths.filter((p) => !inScope.has(p));
    if (outside.length > 0) {
      warnings.push(
        `${outside.length} changed path(s) are outside the effort's scope (${effortLabel(effort)}): ${outside.join(', ')} — add a scope template or expect a merge collision`,
      );
    }
  }
  for (const name of commons)
    warnings.push(`commons ${name} touched: the other areas are told at \`work finish\``);
  return { refusals, warnings };
}
```

In `apps/workbrokr/src/commands/hook.ts`, print `warnings` in `runPreCommit`:
```ts
  const { refusals, warnings } = checkCommit({
    m: c.manifest,
    registry: c.registry,
    git: c.git,
    project: c.manifest.project,
    branch: c.git.currentBranch(),
    stagedPaths: c.git.changedPathsStaged(),
    ownerSession: currentOwner().session,
    checkoutRoot: root,
  });
  for (const w of warnings) console.error(chalk.yellow(`work: ${w}`));
  for (const r of refusals) console.error(chalk.red(`work: ${r}`));
  return refusals.length ? 2 : 0;
```

In `apps/workbrokr/src/core/hooks.ts`, update `preCommitScript` and `prePushScript` to chain to `$(git rev-parse --git-common-dir)/hooks/<hook>`:
```ts
function preCommitScript(protectedBranches: string[]): string {
  return `#!/bin/sh
# Installed by \`work init\` (@helmsmith/workbrokr). The protected-branch rule lives here; the rest in workbrokr.
PROTECTED="${protectedBranches.join(' ')}"
branch=$(git symbolic-ref --short -q HEAD)
for p in $PROTECTED; do
  if [ "$branch" = "$p" ]; then
    echo "work: branch \\"$branch\\" is protected ($PROTECTED): work happens on <type>/<area> branches, never here" >&2
    exit 2
  fi
done
if command -v workbrokr >/dev/null 2>&1; then
  workbrokr hook pre-commit "$@" || exit $?
else
  echo "work: workbrokr is not on PATH; commons and scope checks skipped (npm i -g @helmsmith/workbrokr)" >&2
fi
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
LEGACY="$COMMON_DIR/hooks/pre-commit"
if [ -n "$COMMON_DIR" ] && [ -x "$LEGACY" ]; then
  SELF_DIR=$(cd "$(dirname "$0")" && pwd)
  LEGACY_DIR=$(cd "$(dirname "$LEGACY")" && pwd)
  if [ "$SELF_DIR" != "$LEGACY_DIR" ]; then
    exec "$LEGACY" "$@"
  fi
fi
exit 0
`;
}

function prePushScript(protectedBranches: string[]): string {
  return `#!/bin/sh
# Installed by \`work init\` (@helmsmith/workbrokr). Refuses a push to, or a delete of, a protected branch here; the rest in workbrokr.
PROTECTED="${protectedBranches.join(' ')}"
input=$(cat)
printf '%s\\n' "$input" | while read -r lref lsha rref rsha; do
  [ -n "$rref" ] || continue
  dest=\${rref#refs/heads/}
  for p in $PROTECTED; do
    if [ "$dest" = "$p" ]; then
      echo "work: \\"$dest\\" is protected ($PROTECTED): nothing is pushed to it directly, open a PR from an area branch" >&2
      exit 2
    fi
  done
done || exit 2
if command -v workbrokr >/dev/null 2>&1; then
  printf '%s\\n' "$input" | workbrokr hook pre-push "$@" || exit $?
else
  echo "work: workbrokr is not on PATH; scope and commons warnings skipped" >&2
fi
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
LEGACY="$COMMON_DIR/hooks/pre-push"
if [ -n "$COMMON_DIR" ] && [ -x "$LEGACY" ]; then
  SELF_DIR=$(cd "$(dirname "$0")" && pwd)
  LEGACY_DIR=$(cd "$(dirname "$LEGACY")" && pwd)
  if [ "$SELF_DIR" != "$LEGACY_DIR" ]; then
    printf '%s\\n' "$input" | exec "$LEGACY" "$@"
  fi
fi
exit 0
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/guards.test.ts src/core/hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/core/guards.ts apps/workbrokr/src/core/guards.test.ts apps/workbrokr/src/core/hooks.ts apps/workbrokr/src/core/hooks.test.ts apps/workbrokr/src/commands/hook.ts
git commit -m "feat(workbrokr): bind commit guards to worktrees, enforce scope locks & chain git hooks"
```

---

### Task 4: Hash-Stamped `when:` Refresh, Clean Lockfile Restore, Submodule Repair, and Squash-Merge Git Helpers

**Files:**
- Modify: `apps/workbrokr/src/core/refresh.ts`
- Modify: `apps/workbrokr/src/core/git.ts`
- Test: `apps/workbrokr/src/core/refresh.test.ts`
- Test: `apps/workbrokr/src/core/git.test.ts`

**Interfaces:**
- Consumes: `RefreshEntry`, `WorkkitError` from `src/core/types.ts` and `src/core/errors.ts`
- Produces:
  - `selectRefresh(entries: RefreshEntry[], changedPaths: string[], opts?: { worktree?: string; stampFile?: string }): { runs: string[]; marks: string[]; pendingStamps?: Record<string, string>; cleanWhenFiles?: string[] }`
  - `runRefresh(runs: string[], cwd: string, log: (line: string) => void, env?: NodeJS.ProcessEnv, opts?: { stampFile?: string; pendingStamps?: Record<string, string>; restoreFiles?: string[] }): void`
  - `Git.isAncestor(ancestor: string, descendant: string): boolean`
  - `Git.isEquivalentToBase(base: string): boolean`
  - `Git.repairSubmodules(mainRoot: string): void`

- [ ] **Step 1: Write the failing tests in `refresh.test.ts` and `git.test.ts`**

Add to `apps/workbrokr/src/core/refresh.test.ts`:
```ts
  it('triggers when-entries on cold worktree via content hash stamp, skips when unchanged, and restores dirtied clean lockfiles', () => {
    const f = makeRepo();
    try {
      commitFile(f.main, 'app-ui/package-lock.json', '{"v":1}', 'add lockfile');
      const stampFile = join(f.main, '.logs/.refresh-stamps.json');
      const e = [
        {
          when: 'app-ui/package-lock.json',
          run: 'echo "{\\"v\\":1,\\"dirty\\":true}" > app-ui/package-lock.json && touch installed.marker',
        },
      ];
      // Cold worktree: changedPaths is empty, but no stamp exists yet -> triggers!
      const sel1 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel1.runs).toHaveLength(1);
      runRefresh(sel1.runs, f.main, () => {}, process.env, {
        stampFile,
        pendingStamps: sel1.pendingStamps,
        restoreFiles: sel1.cleanWhenFiles,
      });
      expect(existsSync(join(f.main, 'installed.marker'))).toBe(true);
      // Clean lockfile was restored after the install script dirtied it
      expect(new Git(f.main).isDirty()).toBe(false);
      // Second run with unchanged lockfile -> skipped!
      const sel2 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel2.runs).toEqual([]);
      // Updating the lockfile content -> triggers again!
      commitFile(f.main, 'app-ui/package-lock.json', '{"v":2}', 'bump lockfile');
      const sel3 = selectRefresh(e, [], { worktree: f.main, stampFile });
      expect(sel3.runs).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });
```
(Import `commitFile, makeRepo` from `./testing/fixture-repo.js` and `Git` from `./git.js` at top of `refresh.test.ts`.)

Add to `apps/workbrokr/src/core/git.test.ts`:
```ts
  it('detects squash-merged equivalence to base and ancestor relationships', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const main = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    main.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    commitFile(wt, 'cart1.txt', '1', 'c1');
    commitFile(wt, 'cart2.txt', '2', 'c2');
    expect(w.isEquivalentToBase('develop')).toBe(false);
    // Simulate squash-merge onto develop
    commitFile(f.main, 'cart1.txt', '1', 'squash');
    commitFile(f.main, 'cart2.txt', '2', 'squash-2');
    main.push('develop');
    w.fetch('develop');
    expect(w.commitsNotOn('develop').length).toBeGreaterThan(0);
    expect(w.isEquivalentToBase('develop')).toBe(true);
    expect(w.isAncestor('origin/develop', 'origin/develop')).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/refresh.test.ts src/core/git.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement hash-stamped `selectRefresh`/`runRefresh` in `refresh.ts` and `isAncestor`/`isEquivalentToBase`/`repairSubmodules` in `git.ts`**

Replace `apps/workbrokr/src/core/refresh.ts` with:
```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { RefreshEntry } from './types.js';

function matchesWhen(glob: string): (p: string) => boolean {
  const isMatch = picomatch(glob, { dot: true });
  return (p) => isMatch(p);
}

function readStamps(stampFile?: string): Record<string, string> {
  if (!stampFile || !existsSync(stampFile)) return {};
  try {
    return JSON.parse(readFileSync(stampFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStamps(stampFile: string, stamps: Record<string, string>): void {
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, `${JSON.stringify(stamps, null, 2)}\n`);
}

function matchedFilesInWorktree(worktree: string, whenGlob: string): string[] {
  if (!/[*?[{]/.test(whenGlob)) {
    return existsSync(join(worktree, whenGlob)) ? [whenGlob] : [];
  }
  const r = spawnSync('git', ['ls-files'], { cwd: worktree, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const isMatch = matchesWhen(whenGlob);
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && isMatch(l) && existsSync(join(worktree, l)));
}

function hashFiles(worktree: string, relPaths: string[]): string | null {
  if (relPaths.length === 0) return null;
  const h = createHash('sha256');
  for (const rel of [...relPaths].sort()) {
    const abs = join(worktree, rel);
    if (!existsSync(abs)) continue;
    h.update(`${rel}\0`);
    h.update(readFileSync(abs));
    h.update('\0');
  }
  return h.digest('hex');
}

function isFileCleanInGit(worktree: string, relPath: string): boolean {
  const r = spawnSync('git', ['status', '--porcelain', '--', relPath], {
    cwd: worktree,
    encoding: 'utf8',
  });
  return r.status === 0 && (r.stdout ?? '').trim().length === 0;
}

export interface SelectRefreshOptions {
  worktree?: string;
  stampFile?: string;
}

export interface SelectRefreshResult {
  runs: string[];
  marks: string[];
  pendingStamps?: Record<string, string>;
  cleanWhenFiles?: string[];
}

/** Which refresh commands and marks a sync's changed paths or unstamped `when` files call for, in manifest order. */
export function selectRefresh(
  entries: RefreshEntry[],
  changedPaths: string[],
  opts?: SelectRefreshOptions,
): SelectRefreshResult {
  const runs: string[] = [];
  const marks: string[] = [];
  const stored = readStamps(opts?.stampFile);
  const pendingStamps: Record<string, string> = { ...stored };
  const cleanWhenFiles = new Set<string>();

  for (const e of entries) {
    let hit = e.always === true;
    let matchedFiles: string[] = [];
    if (e.when !== undefined) {
      const byChanged = changedPaths.some(matchesWhen(e.when));
      if (opts?.worktree) {
        matchedFiles = matchedFilesInWorktree(opts.worktree, e.when);
        const digest = hashFiles(opts.worktree, matchedFiles);
        if (digest !== null) {
          if (stored[e.when] !== digest) hit = true;
          pendingStamps[e.when] = digest;
        }
      }
      if (byChanged) hit = true;
    }
    if (!hit) continue;
    if (e.run) {
      runs.push(e.run);
      if (opts?.worktree && e.when && e.restoreWhenIfClean !== false) {
        for (const f of matchedFiles) {
          if (isFileCleanInGit(opts.worktree, f)) cleanWhenFiles.add(f);
        }
      }
    }
    if (e.mark) marks.push(e.mark);
  }
  if (!opts?.worktree) return { runs, marks };
  return {
    runs,
    marks,
    pendingStamps,
    cleanWhenFiles: [...cleanWhenFiles],
  };
}

export interface RunRefreshOptions {
  stampFile?: string;
  pendingStamps?: Record<string, string>;
  restoreFiles?: string[];
}

/** Run each command through `sh -c` in the worktree; the first failure names its command. */
export function runRefresh(
  runs: string[],
  cwd: string,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  opts?: RunRefreshOptions,
): void {
  for (const cmd of runs) {
    log(`$ ${cmd}`);
    const r = spawnSync('sh', ['-c', cmd], { cwd, env, encoding: 'utf8' });
    if (r.stdout) log(r.stdout.trimEnd());
    if (r.stderr) log(r.stderr.trimEnd());
    if (r.status !== 0) {
      throw new WorkkitError('INTERNAL', `refresh command failed (${r.status}): ${cmd}`, {
        cmd,
        status: r.status,
      });
    }
  }
  if (opts?.restoreFiles && opts.restoreFiles.length > 0) {
    for (const rel of opts.restoreFiles) {
      if (!isFileCleanInGit(cwd, rel)) {
        spawnSync('git', ['checkout', '--', rel], { cwd, encoding: 'utf8' });
      }
    }
  }
  if (opts?.stampFile && opts.pendingStamps) {
    writeStamps(opts.stampFile, opts.pendingStamps);
  }
}
```

In `apps/workbrokr/src/core/git.ts`, add `isAncestor`, `isEquivalentToBase`, and `repairSubmodules`:
```ts
  isAncestor(ancestor: string, descendant: string): boolean {
    return this.tryRun(['merge-base', '--is-ancestor', ancestor, descendant]).code === 0;
  }

  /** True when HEAD's tree matches origin/<base>, or every commit on HEAD is patch-equivalent to origin/<base> (squash-merged). */
  isEquivalentToBase(base: string): boolean {
    const target = `origin/${base}`;
    if (this.tryRun(['diff', '--quiet', target, 'HEAD']).code === 0) return true;
    const cherry = this.tryRun(['cherry', target, 'HEAD']);
    if (cherry.code !== 0) return false;
    const lines = cherry.out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length > 0 && lines.every((l) => l.startsWith('- '));
  }

  /** Repair broken submodule .git pointers inside a linked worktree before git merge/syncFrom runs. */
  repairSubmodules(mainRoot: string): void {
    const gitmodules = join(this.cwd, '.gitmodules');
    if (!existsSync(gitmodules)) return;
    const cfg = this.tryRun([
      'config',
      '-f',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.path$',
    ]);
    if (cfg.code !== 0) return;
    for (const line of cfg.out.split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const subPath = parts[1];
      if (!subPath) continue;
      const wtSub = join(this.cwd, subPath);
      const wtGit = join(wtSub, '.git');
      if (existsSync(wtGit) && new Git(wtSub).tryRun(['rev-parse', '--git-dir']).code === 0) {
        continue;
      }
      const mainSub = join(mainRoot, subPath);
      if (existsSync(join(mainSub, '.git'))) {
        const subGitDir = new Git(mainSub).tryRun([
          'rev-parse',
          '--path-format=absolute',
          '--git-dir',
        ]);
        if (subGitDir.code === 0 && subGitDir.out.trim()) {
          mkdirSync(wtSub, { recursive: true });
          rmSync(wtGit, { recursive: true, force: true });
          writeFileSync(wtGit, `gitdir: ${subGitDir.out.trim()}\n`);
          new Git(wtSub).tryRun(['checkout', '-f', '-q']);
        }
      }
    }
  }
```
(Update imports at top of `apps/workbrokr/src/core/git.ts` to include `existsSync, rmSync, writeFileSync` and `join`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/refresh.test.ts src/core/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/core/refresh.ts apps/workbrokr/src/core/refresh.test.ts apps/workbrokr/src/core/git.ts apps/workbrokr/src/core/git.test.ts
git commit -m "feat(workbrokr): add hash-stamped refresh with clean lockfile restore, squash-merge check & submodule repair"
```

---

### Task 5: Mode-Filtered Service Runner and Task-Aware Registry

**Files:**
- Modify: `apps/workbrokr/src/core/runner.ts`
- Modify: `apps/workbrokr/src/core/registry.ts`
- Test: `apps/workbrokr/src/core/runner.test.ts`
- Test: `apps/workbrokr/src/core/registry.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `ServiceSpec`, `Effort`, `Notice` from `src/core/types.ts`
- Produces:
  - `serviceModes(name: string, spec: ServiceSpec): ('backend' | 'fullstack')[]`
  - `RunnerArgs.mode?: 'backend' | 'fullstack'`, `RunnerArgs.onlyServices?: string[]`
  - `Registry.activeEffortFor(project: string, area: string, task?: string): Effort | undefined`
  - `Registry.openEffortFor(project: string, area: string, task?: string): Effort | undefined`
  - `Registry.clearNoticesFrom(project: string, branches: string[]): void`
  - `Registry.pruneNoticesWhere(project: string, area: string, predicate: (n: Notice) => boolean): void`

- [ ] **Step 1: Write the failing tests in `runner.test.ts` and `registry.test.ts`**

Add to `apps/workbrokr/src/core/runner.test.ts`:
```ts
  it('starts only backend-mode services when mode is backend, and only missing services when onlyServices is set', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const m = validateManifest({
      project: 'demo',
      baseBranch: 'develop',
      ports: { services: { backend: { base: 42200 }, frontend: { base: 42300 } } },
      services: {
        backend: {
          start: `node ${svc} --port $PORT_BACKEND --name backend`,
          stop: 'true',
          health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_BACKEND/health',
          healthyCodes: [200],
        },
        frontend: {
          start: `node ${svc} --port $PORT_FRONTEND --name frontend`,
          stop: 'true',
          health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_FRONTEND/health',
          healthyCodes: [200],
        },
      },
      scopes: { frontend: [], backend: [] },
      areas: { a: {} },
    });
    const env = { ...process.env, PORT_BACKEND: '42201', PORT_FRONTEND: '42301' };
    const r1 = await startServices({ m, cwd, env, logDir: cwd, mode: 'backend' });
    expect(Object.keys(r1.pids)).toEqual(['backend']);
    const r2 = await startServices({ m, cwd, env, logDir: cwd, onlyServices: ['frontend'] });
    expect(Object.keys(r2.pids)).toEqual(['frontend']);
    await stopServices({
      m,
      cwd,
      env,
      pids: { ...r1.pids, ...r2.pids },
      signatures: { ...r1.signatures, ...r2.signatures },
    });
  });
```

Add to `apps/workbrokr/src/core/registry.test.ts`:
```ts
  it('distinguishes area efforts from task sub-efforts and deduplicates/clears notices by source branch', () => {
    const r = Registry.open(home());
    r.addEffort({
      id: 'e_area',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: '/w1',
      owner,
      state: 'active',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    r.addEffort({
      id: 'e_task',
      project: 'demo',
      area: 'shop/cart',
      task: 'api',
      type: 'feature',
      mode: 'backend',
      branch: 'feature/shop/cart--api',
      worktree: '/w2',
      owner,
      state: 'active',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    expect(r.openEffortFor('demo', 'shop/cart')?.id).toBe('e_area');
    expect(r.openEffortFor('demo', 'shop/cart', 'api')?.id).toBe('e_task');
    r.addNotice('demo', 'shop/team', { from: 'chore/org/team', text: 't1', at: '1' });
    r.addNotice('demo', 'shop/team', { from: 'chore/org/team', text: 't1', at: '2' });
    expect(r.notices('demo', 'shop/team')).toHaveLength(1);
    r.clearNoticesFrom('demo', ['chore/org/team']);
    expect(r.notices('demo', 'shop/team')).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/runner.test.ts src/core/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `serviceModes` and mode filtering in `runner.ts`, and task/notice helpers in `registry.ts`**

In `apps/workbrokr/src/core/runner.ts`:
```ts
export function serviceModes(name: string, spec: ServiceSpec): ('backend' | 'fullstack')[] {
  if (spec.modes && spec.modes.length > 0) return spec.modes;
  return name === 'frontend' ? ['fullstack'] : ['backend', 'fullstack'];
}

export interface RunnerArgs {
  m: Manifest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logDir: string;
  mode?: 'backend' | 'fullstack';
  onlyServices?: string[];
  onLog?: (line: string) => void;
  /** called the moment a service's process exists, before its health is known */
  onSpawn?: (service: string, pid: number, signature: string) => void;
}
```
And in `startServices(a: RunnerArgs)`:
```ts
  const targetMode = a.mode ?? 'fullstack';
  const entries = Object.entries(a.m.services).filter(([name, spec]) => {
    if (a.onlyServices) return a.onlyServices.includes(name);
    return serviceModes(name, spec).includes(targetMode);
  });
  for (const [name, spec] of entries) {
```

In `apps/workbrokr/src/core/registry.ts`:
```ts
  efforts(filter: Partial<Pick<Effort, 'project' | 'area' | 'task' | 'state'>> = {}): Effort[] {
    return this.read().efforts.filter((e) =>
      Object.entries(filter).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v),
    );
  }

  activeEffortFor(project: string, area: string, task?: string): Effort | undefined {
    return this.efforts({ project, area, state: 'active' }).find(
      (e) => (e.task ?? undefined) === (task ?? undefined),
    );
  }

  /** An effort that is being started counts as open: nobody else may start on the same (area, task) meanwhile. */
  openEffortFor(project: string, area: string, task?: string): Effort | undefined {
    return this.efforts({ project, area }).find(
      (e) =>
        (e.state === 'starting' || e.state === 'active') &&
        (e.task ?? undefined) === (task ?? undefined),
    );
  }

  addNotice(project: string, area: string, notice: Notice): void {
    this.update((r) => {
      const existing = r.notices ?? [];
      const dup = existing.findIndex(
        (n) =>
          n.project === project &&
          n.area === area &&
          n.notice.from === notice.from &&
          n.notice.text === notice.text,
      );
      if (dup >= 0) {
        existing[dup] = { project, area, notice };
        r.notices = existing;
      } else {
        r.notices = [...existing, { project, area, notice }];
      }
    });
  }

  clearNoticesFrom(project: string, branches: string[]): void {
    const set = new Set(branches);
    this.update((r) => {
      r.notices = (r.notices ?? []).filter(
        (n) => !(n.project === project && set.has(n.notice.from)),
      );
    });
  }

  pruneNoticesWhere(project: string, area: string, remove: (n: Notice) => boolean): void {
    this.update((r) => {
      r.notices = (r.notices ?? []).filter(
        (n) => !(n.project === project && n.area === area && remove(n.notice)),
      );
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/workbrokr test src/core/runner.test.ts src/core/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/core/runner.ts apps/workbrokr/src/core/runner.test.ts apps/workbrokr/src/core/registry.ts apps/workbrokr/src/core/registry.test.ts
git commit -m "feat(workbrokr): add mode-filtered service runner and task-aware registry methods"
```

---

### Task 6: Intra-Area Task Efforts, Mode Promotion, `--into-area` Convergence, Reference-Counted `--join`, and Notice Lifecycle (`effort.ts`)

**Files:**
- Modify: `apps/workbrokr/src/lib/effort.ts`
- Test: `apps/workbrokr/src/lib/effort.test.ts`

**Interfaces:**
- Consumes: Task 1–5 core functions (`expandScopes`, `TASK_SLUG`, `selectRefresh`, `runRefresh`, `serviceModes`, `isEquivalentToBase`, `repairSubmodules`, `clearNoticesFrom`, `pruneNoticesWhere`)
- Produces:
  - `StartOptions`: adds `task?: string; scopes?: string[]`
  - `PromoteOptions`: `{ area: string; task?: string; mode: 'backend' | 'fullstack'; story?: string }`
  - `PromoteResult`: `{ effort: Effort; leases: Lease[]; startedServices: string[]; warnings: string[] }`
  - `promoteEffort(ctx: Ctx, o: PromoteOptions): Promise<PromoteResult>`
  - `FinishOptions`: `{ area: string; task?: string; park?: boolean; intoArea?: boolean; force?: boolean }`
  - `FinishResult`: `{ effort: Effort; pushed: boolean; parked: boolean; mergedIntoArea?: boolean; left?: boolean; notices: number }`
  - `statusFor(ctx: Ctx, area?: string, task?: string): StatusReport`
  - `effortEnv(ctx: Ctx, area: string, task?: string): Record<string, string>`

- [ ] **Step 1: Write the failing tests in `apps/workbrokr/src/lib/effort.test.ts`**

Add a new `describe('parallel waves, promote, join ref-counting & squash-merge recovery')` block to `apps/workbrokr/src/lib/effort.test.ts`:
```ts
describe('parallel waves, promote, join ref-counting & squash-merge recovery', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('runs parallel backend + narrowed frontend tasks in the same area and converges them with --into-area', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const api = await startEffort(ctx, {
      area: 'shop/cart',
      task: 'api',
      type: 'feature',
      mode: 'backend',
    });
    const viewA = await startEffort(
      { ...ctx, owner: { session: 's2', pid: 2 } },
      {
        area: 'shop/cart',
        task: 'search-input',
        type: 'feature',
        mode: 'frontend',
        scopes: ['app-ui/app/shop/cart/SearchInput/**'],
      },
    );
    const viewB = await startEffort(
      { ...ctx, owner: { session: 's3', pid: 3 } },
      {
        area: 'shop/cart',
        task: 'user-card',
        type: 'feature',
        mode: 'frontend',
        scopes: ['app-ui/app/shop/cart/UserCard/**'],
      },
    );
    expect(api.effort.branch).toBe('feature/shop/cart--api');
    expect(viewA.effort.worktree).toContain('_tasks/shop/cart--search-input');
    commitFile(api.effort.worktree, 'svc/cart/handler.go', 'package cart', 'api work');
    commitFile(
      viewA.effort.worktree,
      'app-ui/app/shop/cart/SearchInput/index.tsx',
      'export const S = 1;',
      'view A',
    );
    commitFile(
      viewB.effort.worktree,
      'app-ui/app/shop/cart/UserCard/index.tsx',
      'export const U = 2;',
      'view B',
    );

    const finApi = await finishEffort(ctx, { area: 'shop/cart', task: 'api', intoArea: true });
    expect(finApi.mergedIntoArea).toBe(true);
    expect(existsSync(api.effort.worktree)).toBe(false);
    await finishEffort(
      { ...ctx, owner: { session: 's2', pid: 2 } },
      { area: 'shop/cart', task: 'search-input', intoArea: true },
    );
    await finishEffort(
      { ...ctx, owner: { session: 's3', pid: 3 } },
      { area: 'shop/cart', task: 'user-card', intoArea: true },
    );

    const areaEffort = await startEffort(ctx, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
    });
    expect(existsSync(join(areaEffort.effort.worktree, 'svc/cart/handler.go'))).toBe(true);
    expect(
      existsSync(join(areaEffort.effort.worktree, 'app-ui/app/shop/cart/SearchInput/index.tsx')),
    ).toBe(true);
    expect(
      existsSync(join(areaEffort.effort.worktree, 'app-ui/app/shop/cart/UserCard/index.tsx')),
    ).toBe(true);

    const promoted = await promoteEffort(ctx, { area: 'shop/cart', mode: 'fullstack' });
    expect(promoted.effort.mode).toBe('fullstack');
    expect(promoted.leases.some((l) => l.kind === 'slot')).toBe(true);
  });

  it('reference-counts --join participants and refuses incompatible mode on --join', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    const other = { ...ctx, owner: { session: 's2', pid: 2 } };
    await expect(
      startEffort(other, { area: 'shop/cart', type: 'feature', mode: 'fullstack', join: true }),
    ).rejects.toMatchObject({ code: 'MODE_MISMATCH' });
    const joined = await startEffort(other, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      join: true,
    });
    expect(joined.effort.participants).toEqual([{ session: 's2', pid: 2 }]);
    const left = await finishEffort(other, { area: 'shop/cart' });
    expect(left.left).toBe(true);
    expect(left.pushed).toBe(false);
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')).toBeDefined();
    const final = await finishEffort(ctx, { area: 'shop/cart' });
    expect(final.pushed).toBe(true);
  });

  it('recovers cleanly when a previous branch was squash-merged into baseBranch', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'app-ui/app/shop/cart/page.tsx', 'v1', 'feat commit');
    await finishEffort(ctx, { area: 'shop/cart' });
    // Simulate GitHub squash-merge onto develop
    commitFile(f.main, 'app-ui/app/shop/cart/page.tsx', 'v1', 'squash merged PR');
    new Git(f.main).push('develop');
    const next = await startEffort(ctx, { area: 'shop/cart', type: 'fix', mode: 'frontend' });
    expect(next.effort.branch).toBe('fix/shop/cart');
  });

  it('emits 0 notices when an effort made no commits of its own, and clears notices from retired branches', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'platform/auth', type: 'chore', mode: 'frontend' });
    expect(r.effort.baseSha).toBeDefined();
    const done = await finishEffort(ctx, { area: 'platform/auth' });
    expect(done.notices).toBe(0);
  });
});
```
(Also import `promoteEffort` from `./effort.js` at the top of `apps/workbrokr/src/lib/effort.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/workbrokr test src/lib/effort.test.ts`
Expected: FAIL (`promoteEffort` not exported; `task`/`intoArea`/`backend` mode not supported).

- [ ] **Step 3: Implement the upgraded lifecycle operations in `apps/workbrokr/src/lib/effort.ts`**

Update `apps/workbrokr/src/lib/effort.ts`:
1. Widen `ServiceRunner.start` signature to include `mode?: 'backend' | 'fullstack'; onlyServices?: string[]`.
2. Add `task?: string` and `scopes?: string[]` to `StartOptions`, and `worktreePathFor(ctx, area, task?)`:
   ```ts
   export const worktreePathFor = (ctx: Ctx, area: string, task?: string) =>
     task
       ? join(ctx.repoRoot, ctx.manifest.worktreeRoot, '_tasks', `${area}--${task}`)
       : join(ctx.repoRoot, ctx.manifest.worktreeRoot, area);
   export const branchFor = (type: string, area: string, task?: string) =>
     task ? `${type}/${area}--${task}` : `${type}/${area}`;
   ```
3. In `guardStart`:
   - Validate `o.task` against `TASK_SLUG` (`throw new WorkkitError('TASK_INVALID', ...)` if invalid).
   - Allow `o.mode` to be `'frontend' | 'backend' | 'fullstack'`.
   - Call `expandScopes(m, o.area, o.mode, o.scopes, Boolean(o.task))`.
4. In `reserveEffort`:
   - Check `open.find((e) => e.area === o.area && (e.task ?? undefined) === (o.task ?? undefined))` for `EFFORT_OPEN`.
   - Check `globsOverlap(scopes, e.scopes)` across all open efforts `e` in the project (including same-area efforts, so two tasks with disjoint `--scope` or `backend` vs `frontend` succeed while overlapping tasks fail with `SCOPE_CONFLICT`!).
5. In `ensureWorktree(ctx, area, branch, task?)`:
   - Return `{ wg: Git; created: boolean }`.
   - When reusing an existing worktree:
     - Call `wg.repairSubmodules(ctx.repoRoot)`.
     - If `current !== branch`:
       - If `wg.isDirty()` → throw `DIRTY_WORKTREE`.
       - If `wg.commitsNotOn(m.baseBranch).length > 0 && !wg.isEquivalentToBase(m.baseBranch)` → throw `EFFORT_OPEN`.
       - If `wg.branchExists(branch)`: check it out, and if `!wg.isDirty() && wg.commitsNotOn(m.baseBranch).length > 0 && wg.isEquivalentToBase(m.baseBranch)`, reset it to `origin/${m.baseBranch}` (`wg.run(['reset', '--hard', `origin/${m.baseBranch}`])`).
       - Else `wg.checkout(branch, `origin/${m.baseBranch}`)`.
     - Else (`current === branch`):
       - If `!wg.isDirty() && wg.commitsNotOn(m.baseBranch).length > 0 && wg.isEquivalentToBase(m.baseBranch)`, reset to `origin/${m.baseBranch}`.
6. In `startEffort`:
   - Run `fetchBaseOnce(ctx)` once at the start.
   - If `open && o.join`:
     - Poll up to 60 s if `open.state === 'starting'`.
     - Check `modeCovers(open.mode, o.mode)` (`fullstack` covers all; `frontend` covers `frontend`; `backend` covers `backend`); throw `MODE_MISMATCH` if not covered.
     - Attach late `o.story` if passed and no storybook lease exists.
     - Append `ctx.owner` to `open.participants` if not already owner/participant.
   - After `ensureWorktree`:
     - Run `wg.repairSubmodules(ctx.repoRoot)`.
     - If `created && m.seed && m.seed.length > 0`: run `runRefresh(m.seed, worktree, ..., { ...process.env, WORKTREE: worktree, MAIN_ROOT: ctx.repoRoot })`.
     - Run `syncFrom(m.baseBranch)` (without a second `wg.fetch` since `fetchBaseOnce` already fetched).
     - Prune notices on `o.area` whose `from` branch is now an ancestor of `HEAD` (`wg.isAncestor(\`origin/\${n.from}\`, 'HEAD') || wg.isAncestor(n.from, 'HEAD')`).
     - Select and run refresh with `{ worktree, stampFile: join(logDir, '.refresh-stamps.json') }` and `restoreFiles: sel.cleanWhenFiles`.
     - Record `baseSha = wg.rev('HEAD')`.
     - When `o.mode === 'fullstack' || o.mode === 'backend'`: allocate a slot and call `ctx.runner.start({ ..., mode: o.mode })`.
7. Implement `promoteEffort(ctx, o)`:
   - Look up `openEffortFor(m.project, o.area, o.task)`.
   - Verify transition (`frontend -> fullstack`, `backend -> fullstack`, or same-mode no-op; refuse `fullstack -> backend` or `frontend -> backend` with `MODE_MISMATCH`).
   - Compute `nextScopes`: if `effort.task`, union `effort.scopes` with `expandScopes(m, o.area, o.mode)`; else `expandScopes(m, o.area, o.mode)`.
   - Atomically check `globsOverlap` against other open efforts and update `effort.mode` and `effort.scopes`.
   - Allocate slot lease if none exists, emit worktree config, and start only services in `serviceModes(name, spec).includes(o.mode)` not already in `slot.pids`.
8. In `finishEffort(ctx, o)`:
   - Support `o.task`, `o.intoArea`, `o.force`.
   - Handle participant leave when `!o.force && effort.participants?.length`.
   - When `o.intoArea`: require `effort.task`; ensure area worktree `<worktreeRoot>/<area>` on `<effort.type>/<effort.area>`, verify clean, run `areaGit.tryRun(['merge', '--no-edit', '-q', effort.branch])` (aborting and throwing `SYNC_CONFLICT` on conflict before releasing leases).
   - Compute `commons` notices only from commits unique to this effort (`effort.baseSha ? wg.changedPaths(effort.baseSha, 'HEAD').filter(p => sinceSet.has(p)) : wg.changedSince(m.baseBranch)`), and skip if `o.intoArea` or `wg.commitsNotOn(m.baseBranch).length === 0` or `wg.isEquivalentToBase(m.baseBranch)`.
   - If `effort.task`: archive worktree, `main.worktreeRemove(effort.worktree)`, delete local branch if `o.intoArea`, and remove effort from registry.
9. In `retireArea(ctx, o)`:
   - Call `ctx.registry.clearNoticesFrom(m.project, m.branch.types.map((t) => `${t}/${o.area}`))`.
10. In `statusFor` and `auditProject`:
   - Call `fetchBaseOnce(ctx)` once at the top; remove `g.tryRun(['fetch', ...])` from `behindBase`; accept task branches `<type>/<area>--<task>` in `auditProject`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/workbrokr test src/lib/effort.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/lib/effort.ts apps/workbrokr/src/lib/effort.test.ts
git commit -m "feat(workbrokr): implement task waves, mode promotion, --into-area convergence & notice lifecycle"
```

---

### Task 7: CLI Commands (`start`, `promote`, `finish`, `status`, `env`) and Multi-Project MCP Server

**Files:**
- Create: `apps/workbrokr/src/commands/promote.ts`
- Modify: `apps/workbrokr/src/commands/start.ts`
- Modify: `apps/workbrokr/src/commands/finish.ts`
- Modify: `apps/workbrokr/src/commands/status.ts`
- Modify: `apps/workbrokr/src/commands/env.ts`
- Modify: `apps/workbrokr/src/cli.ts`
- Modify: `apps/workbrokr/src/mcp/server.ts`
- Test: `apps/workbrokr/src/mcp/server.test.ts`

**Interfaces:**
- Consumes: `startEffort`, `promoteEffort`, `finishEffort`, `statusFor`, `effortEnv` from `src/lib/effort.ts`
- Produces:
  - CLI `work promote` and `--task`, `--scope`, `--into-area`, `--force` options across CLI commands
  - MCP `work_promote` tool and `projectRoot`, `task`, `scopes`, `intoArea`, `force` inputs on MCP tools

- [ ] **Step 1: Write the failing tests in `apps/workbrokr/src/mcp/server.test.ts`**

Update `apps/workbrokr/src/mcp/server.test.ts` to test `work_promote`, `task` sub-efforts, `intoArea`, and `projectRoot`:
```ts
  it('exposes the seven tools including work_promote', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'work_audit',
      'work_env',
      'work_finish',
      'work_promote',
      'work_reap',
      'work_start',
      'work_status',
    ]);
  });

  it('supports task sub-efforts, work_promote, and intoArea convergence via MCP', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const started = JSON.parse(
      text(
        await client.callTool({
          name: 'work_start',
          arguments: { area: 'shop/cart', task: 'api', type: 'feature', mode: 'backend' },
        }),
      ),
    ) as { effort: { branch: string; mode: string } };
    expect(started.effort.branch).toBe('feature/shop/cart--api');
    expect(started.effort.mode).toBe('backend');

    const promoted = JSON.parse(
      text(
        await client.callTool({
          name: 'work_promote',
          arguments: { area: 'shop/cart', task: 'api', mode: 'fullstack' },
        }),
      ),
    ) as { effort: { mode: string } };
    expect(promoted.effort.mode).toBe('fullstack');

    const finished = JSON.parse(
      text(
        await client.callTool({
          name: 'work_finish',
          arguments: { area: 'shop/cart', task: 'api', intoArea: true },
        }),
      ),
    ) as { mergedIntoArea: boolean };
    expect(finished.mergedIntoArea).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/workbrokr test src/mcp/server.test.ts`
Expected: FAIL (`work_promote` not registered).

- [ ] **Step 3: Implement `commands/promote.ts`, update CLI commands, and update `mcp/server.ts`**

Create `apps/workbrokr/src/commands/promote.ts`:
```ts
import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { promoteEffort } from '../lib/effort.js';
import { fail, printJson, warn } from './_shared/output.js';

export function registerPromote(program: Command): void {
  program
    .command('promote')
    .description('Promote an open effort in place to backend or fullstack mode')
    .requiredOption('--area <area>', 'the area of the open effort')
    .option('--task <slug>', 'intra-area task slug if promoting a task sub-effort')
    .requiredOption('--mode <mode>', 'target mode: backend | fullstack')
    .option('--story <path>', 'optional story path to attach via storybrokr')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (o: {
        area: string;
        task?: string;
        mode: 'backend' | 'fullstack';
        story?: string;
        projectRoot?: string;
        json?: boolean;
      }) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await promoteEffort(ctx, {
            area: o.area,
            task: o.task,
            mode: o.mode,
            story: o.story,
          });
          if (o.json) printJson(r);
          else {
            const label = r.effort.task ? `${r.effort.area}--${r.effort.task}` : r.effort.area;
            console.log(
              `${chalk.bold(label)} promoted to ${r.effort.mode}${r.startedServices.length ? ` (started: ${r.startedServices.join(', ')})` : ''}`,
            );
            for (const w of r.warnings) warn(w);
          }
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
```

Update `apps/workbrokr/src/commands/start.ts`:
- Add `.option('--task <slug>', 'intra-area task slug for parallel sub-efforts (<type>/<area>--<slug>)')`
- Add `.option('--scope <glob...>', 'narrow exclusive scope globs for this task sub-effort')`
- Update `--mode` description to `'fullstack | backend | frontend'`
- Pass `task: o.task, scopes: o.scope` into `startEffort`.

Update `apps/workbrokr/src/commands/finish.ts`:
- Add `.option('--task <slug>', 'finish an intra-area task sub-effort')`
- Add `.option('--into-area', 'merge task branch into <type>/<area> instead of pushing to origin')`
- Add `.option('--force', 'stop and finish even if other joined participants remain')`
- Pass `task: o.task, intoArea: o.intoArea, force: o.force` into `finishEffort`.

Update `apps/workbrokr/src/commands/status.ts` and `apps/workbrokr/src/commands/env.ts`:
- Add `.option('--task <slug>', 'intra-area task slug')` and pass `o.task` to `statusFor` / `effortEnv`.

Update `apps/workbrokr/src/cli.ts`:
- Import and call `registerPromote(program)`.

Update `apps/workbrokr/src/mcp/server.ts`:
- Accept `ctxFactory: (projectRoot?: string) => Promise<Ctx>` (defaulting in `runStdio` to `(projectRoot) => buildCtx({ projectRoot, quiet: true })`).
- Add `projectRoot: z.string().optional()` to all tools.
- Add `task: z.string().optional()`, `scopes: z.array(z.string()).optional()`, and `mode: z.enum(['frontend', 'backend', 'fullstack'])` to `work_start`.
- Add `task: z.string().optional()` to `work_status` and `work_env`.
- Add `task: z.string().optional()`, `intoArea: z.boolean().optional()`, `force: z.boolean().optional()` to `work_finish`.
- Register `work_promote` calling `promoteEffort(await ctxFactory(projectRoot), { area, task, mode, story })`.

- [ ] **Step 4: Run full unit test suite, typecheck, and build**

Run: `pnpm --filter @helmsmith/workbrokr test && pnpm --filter @helmsmith/workbrokr typecheck && pnpm --filter @helmsmith/workbrokr build`
Expected: PASS (all unit tests pass, zero TypeScript errors, `dist/cli.js` and `dist/core/index.js` built cleanly).

- [ ] **Step 5: Commit**

```bash
git add apps/workbrokr/src/commands/promote.ts apps/workbrokr/src/commands/start.ts apps/workbrokr/src/commands/finish.ts apps/workbrokr/src/commands/status.ts apps/workbrokr/src/commands/env.ts apps/workbrokr/src/cli.ts apps/workbrokr/src/mcp/server.ts apps/workbrokr/src/mcp/server.test.ts
git commit -m "feat(workbrokr): add work promote CLI/MCP verb and --task/--scope/--into-area flags"
```

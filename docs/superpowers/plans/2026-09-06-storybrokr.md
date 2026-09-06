# storybrokr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@helmsmith/storybrokr`, a local daemon plus CLI and MCP server that boots ephemeral Storybook instances scoped to one component and its import-graph children, derived from a host repo's existing `.storybook/`.

**Architecture:** A daemon (`node:http` on loopback, bearer token) owns a registry of instances, allocates ports, generates a throwaway config dir under the host's `node_modules/.cache/storybrokr/<id>/` that imports the host's `main` and `preview` and overrides only `stories`, spawns the host's own `storybook dev` against it, and reports readiness plus per-story URLs. The CLI and the MCP stdio server are thin HTTP clients of the daemon.

**Tech Stack:** TypeScript 7 (ESM, strict, native `tsc`), Node 24+ runtime (no Bun-only APIs so vitest can exercise everything), commander 15 via `@helmsmith/cli-kit`, zod 4, `@modelcontextprotocol/sdk` 1.30, tsup (JS only; declarations via `tsc --emitDeclarationOnly`), vitest 5, Biome 2.5. Fixture host: Storybook 10.6 `@storybook/react-vite`, vite 8, `@vitejs/plugin-react` 6, React 19.

**Spec:** `docs/superpowers/specs/2026-09-06-storybrokr-design.md`

## Global Constraints

- Package name `@helmsmith/storybrokr`; bin, MCP server name, and CLI name are all `storybrokr`.
- Layout and file roles follow `docs/toolbox-conventions.md` (bin stub, `src/cli.ts` registration only, `src/commands/<verb>.ts`, co-located `*.test.ts`, `tests/e2e/`).
- Root pnpm overrides apply (post 2026-09-06 sweep): `commander ^15.0.0`, `tsup ^8.5.1`, `vitest ^5.0.0`, `vite ^8.2.2`, `react 19.2.8`, `tsup>esbuild ^0.28.2`. There is no global typescript override; every package declares `typescript ^7.0.2`.
- Biome style: single quotes, semicolons, trailing commas, 2-space indent, 100 columns.
- Imports between source files use the `.js` extension (`./commands/up.js`), matching pritty and the Bundler resolution in `tsconfig.base.json`.
- `tsup.config.ts` sets `noExternal: [/^@helmsmith\//]` so `@helmsmith/cli-kit` is bundled; everything else stays external.
- Runtime is Node 24+ (`engines.node >= 24`, the workspace standard), not Bun. The spec's §8 says `engines.bun` and a `bun` dependency; Task 1 amends the spec. Reason: storybrokr uses no Bun-only API, the daemon must run under vitest (Node), and dropping the vendored Bun binary saves ~60 MB per install.
- TypeScript 7 ships no JS compiler API and does not auto-include `@types/*`. `tsconfig.base.json` already sets `"types": ["node"]`; do not set `dts: true` in tsup — emit declarations with `tsc --emitDeclarationOnly --declaration --outDir dist` in the build script, as every other app now does.
- Every failure is a `StorybrokrError` with a stable `code` from the spec's §7.3 table; never throw bare `Error` from library code.
- Every interactive prompt has a flag equivalent. storybrokr has no prompts.
- Tests never touch `~/.storybrokr`: they set `STORYBROKR_HOME` to a temp dir.
- Never modify tracked files in a host repo; the only host write is under `node_modules/.cache/storybrokr/`.
- Commit after every task with a conventional-commit subject starting lowercase, e.g. `feat(storybrokr): ...`, on branch `feat/storybrokr`. Do not stage `Makefile` (a pre-existing local change).

---

## File structure

```
apps/storybrokr/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  vitest.e2e.config.ts
  bin/storybrokr.mjs                 node shebang stub → dist/cli.js
  README.md  SKILL.md
  src/
    cli.ts                           createCli + register every command; nothing else
    version.ts                       VERSION constant read from package.json at build time
    types.ts                         InstanceRecord, StoryEntry, HostInfo, UpRequest, DaemonConfig
    lib/
      errors.ts                      StorybrokrError, ErrorCode, httpStatusFor
      paths.ts                       homeDir() and the four files under it
      tsconfig.ts                    tolerant tsconfig.json reader → paths map
      host.ts                        findHostRoot, inspectHost, resolveHost
      discover.ts                    import-graph child discovery → story files
      instance.ts                    instanceId, generateConfigDir, sidecar read/write, removeConfigDir
      ports.ts                       findFreePort
      logbuffer.ts                   LogBuffer ring buffer with line listeners
      spawn.ts                       Spawner interface + storybookSpawner (child_process)
      readiness.ts                   waitForReady, fetchStories, parseIndex
    server/
      config.ts                      DEFAULT_CONFIG + loadConfig(home)
      registry.ts                    Registry: records, dedupe, ports in use, persistence, reaping
      broker.ts                      Broker: up/down/touch/reconcile using registry+spawner+readiness
      routes.ts                      route table: (method, path) → handler; JSON + SSE
      daemon.ts                      createDaemon: node:http server, token check, lock file, daemon.json
      start.ts                       entry for the detached daemon process
    client/
      index.ts                       DaemonClient: reads daemon.json, fetch with token, auto-start
    commands/
      up.ts ls.ts get.ts down.ts open.ts logs.ts touch.ts doctor.ts daemon.ts mcp.ts
      _shared/output.ts              table/json printers, exit-code mapping
    mcp/
      server.ts                      buildMcpServer(client) → McpServer with 7 tools; runStdio()
  tests/e2e/
    helpers.ts                       temp STORYBROKR_HOME, run CLI, wait helpers
    up-down.test.ts  daemon.test.ts  mcp.test.ts  external-host.test.ts  render.test.ts
    fixtures/host-react-vite/        private workspace package (Storybook 10.6 + react-vite + vite 6)
```

### Shared interfaces (defined in Task 2, used everywhere)

```ts
// src/types.ts
export type InstanceStatus = 'starting' | 'ready' | 'failed' | 'stopped';

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
  url: string;       // http://127.0.0.1:<port>/?path=/story/<id>
  iframeUrl: string; // http://127.0.0.1:<port>/iframe.html?id=<id>&viewMode=story
}

export interface InstanceError {
  code: string;
  message: string;
  logTail?: string[];
}

export interface InstanceRecord {
  id: string;
  hostRoot: string;
  component: string;        // path relative to hostRoot; dedupe key with hostRoot
  framework: string;
  port: number;
  url: string;              // http://127.0.0.1:<port>
  pid: number | null;
  status: InstanceStatus;
  createdAt: string;        // ISO
  lastTouchedAt: string;    // ISO
  ttlMinutes: number;       // 0 = never reap
  storyFiles: string[];     // relative to hostRoot
  stories: StoryEntry[];
  configDir: string;        // absolute
  exitCode?: number | null;
  error?: InstanceError;
}

export interface UpRequest {
  component: string;
  hostRoot?: string;
  ttlMinutes?: number;
  wait?: boolean;           // default true
}

export interface HostInfo {
  hostRoot: string;
  storybookDir: string;     // <hostRoot>/.storybook
  mainFile: string;         // absolute
  previewFile: string | null;
  managerFile: string | null;
  framework: string;        // e.g. '@storybook/nextjs' or 'unknown'
  storybookBin: string;     // <hostRoot>/node_modules/.bin/storybook
  storybookVersion: string;
  tsconfigPaths: Record<string, string[]>;
}

export interface DaemonConfig {
  ttlMinutes: number;
  instanceCap: number;
  portRangeStart: number;
  portRangeEnd: number;
  readinessTimeoutMs: number;
  reaperIntervalMs: number;
  autoStartWaitMs: number;
}

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}
```

---

### Task 1: Package scaffold, build, and `--version` smoke test

**Files:**
- Create: `apps/storybrokr/package.json`, `apps/storybrokr/tsconfig.json`, `apps/storybrokr/tsup.config.ts`, `apps/storybrokr/vitest.config.ts`, `apps/storybrokr/vitest.e2e.config.ts`, `apps/storybrokr/bin/storybrokr.mjs`, `apps/storybrokr/src/cli.ts`, `apps/storybrokr/src/version.ts`, `apps/storybrokr/tests/e2e/helpers.ts`, `apps/storybrokr/tests/e2e/version.test.ts`
- Modify: `docs/superpowers/specs/2026-09-06-storybrokr-design.md` (§8 runtime paragraph)

**Interfaces:**
- Produces: `VERSION` (string) from `src/version.ts`; `runCli(args, opts)` helper from `tests/e2e/helpers.ts` returning `{ code, stdout, stderr }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@helmsmith/storybrokr",
  "version": "0.1.0",
  "description": "Broker ephemeral single-component Storybook instances from an existing host Storybook — daemon, CLI, and MCP server.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=24" },
  "bin": { "storybrokr": "./bin/storybrokr.mjs" },
  "main": "./dist/cli.js",
  "exports": { ".": "./dist/cli.js" },
  "files": ["dist", "bin", "README.md", "SKILL.md"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsup && tsc -p tsconfig.json --noEmit false --emitDeclarationOnly --declaration --outDir dist",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "pnpm run build && vitest run --config vitest.e2e.config.ts",
    "typecheck": "tsc --noEmit",
    "prepack": "pnpm run build"
  },
  "dependencies": {
    "@helmsmith/cli-kit": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.30.0",
    "chalk": "^6.0.0",
    "commander": "^15.0.0",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "tsup": "^8.5.1",
    "tsx": "^4.23.13",
    "typescript": "^7.0.2",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "tests/**"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/server/start.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // TypeScript 7 has no JS compiler API; declarations come from tsc in the build script.
  dts: false,
  sourcemap: true,
  splitting: false,
  shims: false,
  // @helmsmith/cli-kit exports .ts source and is unpublished — inline it.
  noExternal: [/^@helmsmith\//],
  external: [/^[^@./]/, /^@(?!helmsmith\/)/],
});
```

- [ ] **Step 4: Create `vitest.config.ts` and `vitest.e2e.config.ts`**

```ts
// vitest.config.ts — unit + integration only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'tests/**'],
    testTimeout: 15_000,
  },
});
```

```ts
// vitest.e2e.config.ts — subprocess tests; requires `tsup` to have run
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['dist/**', 'tests/e2e/fixtures/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 5: Create `bin/storybrokr.mjs`**

```js
#!/usr/bin/env node
// storybrokr uses no Bun-only APIs, so the stub is a plain re-export of the
// tsup bundle. Kept as a stub (not TS in bin/) so npm consumers get a
// runnable bin without a build step. See docs/toolbox-conventions.md.
await import('../dist/cli.js');
```

Run: `chmod +x apps/storybrokr/bin/storybrokr.mjs`

- [ ] **Step 6: Create `src/version.ts` and a minimal `src/cli.ts`**

```ts
// src/version.ts
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// tsup inlines JSON imports; resolving at runtime keeps the version honest
// for `tsx src/cli.ts` too.
export const VERSION: string = (require('../package.json') as { version: string }).version;
```

```ts
// src/cli.ts
import { createCli } from '@helmsmith/cli-kit';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'storybrokr',
  version: VERSION,
  description: 'Broker ephemeral single-component Storybook instances from an existing Storybook.',
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

Note: `require('../package.json')` resolves relative to `dist/cli.js` after build and relative to `src/cli.ts` under tsx; both are one level below `package.json`.

- [ ] **Step 7: Create `tests/e2e/helpers.ts`**

```ts
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN = join(APP_ROOT, 'bin', 'storybrokr.mjs');
export const FIXTURE_HOST = join(APP_ROOT, 'tests', 'e2e', 'fixtures', 'host-react-vite');

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A fresh STORYBROKR_HOME per test file so daemons never collide. */
export function makeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'storybrokr-e2e-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function runCli(
  args: string[],
  opts: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? APP_ROOT,
      env: { ...process.env, ...opts.env, STORYBROKR_HOME: opts.home, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timed out: storybrokr ${args.join(' ')}\n${stderr}`));
    }, opts.timeoutMs ?? 170_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function runJson<T>(args: string[], opts: { home: string; cwd?: string }): Promise<T> {
  const r = await runCli([...args, '--json'], opts);
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 8: Write the failing e2e smoke test**

```ts
// tests/e2e/version.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { makeHome, runCli } from './helpers.js';

describe('storybrokr --version', () => {
  const { home, cleanup } = makeHome();
  afterAll(cleanup);

  it('prints the package version and exits 0', async () => {
    const r = await runCli(['--version'], { home });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 9: Install, build, run the smoke test**

Run from repo root:
```bash
pnpm install
pnpm --filter @helmsmith/storybrokr typecheck
pnpm --filter @helmsmith/storybrokr test:e2e
```
Expected: `pnpm install` adds the package to the lockfile; typecheck clean (native tsc); `dist/cli.js` and `dist/cli.d.ts` exist after the build; the version test PASSES (prints `0.1.0`).

- [ ] **Step 10: Amend spec §8 runtime paragraph**

In `docs/superpowers/specs/2026-09-06-storybrokr-design.md` §8, replace the sentence fragment
"`engines.bun >= 1.3`, `bun` as a runtime dependency," with
"`engines.node >= 24` (the workspace standard; no Bun-only APIs are used, so the daemon runs under vitest and the vendored Bun binary is unnecessary; recorded as a deviation from the toolbox Bun-distribution rule),". In the same section, replace the tsup bundling paragraph's last sentence with: "Declarations are emitted by `tsc --emitDeclarationOnly` in the build script because TypeScript 7 ships no JS compiler API for tsup's dts plugin." Also change the bin stub line in the layout block from `#!/usr/bin/env bun → import('../dist/cli.js')` to `#!/usr/bin/env node → import('../dist/cli.js')`.

- [ ] **Step 11: Commit**

```bash
git add apps/storybrokr pnpm-lock.yaml docs/superpowers/specs/2026-09-06-storybrokr-design.md
git commit -m "feat(storybrokr): scaffold package with build, vitest configs, and --version smoke test"
```

---

### Task 2: Shared types and the error contract

**Files:**
- Create: `apps/storybrokr/src/types.ts` (verbatim from the "Shared interfaces" block above)
- Create: `apps/storybrokr/src/lib/errors.ts`
- Test: `apps/storybrokr/src/lib/errors.test.ts`

**Interfaces:**
- Produces: `ErrorCode` union, `class StorybrokrError extends Error { code: ErrorCode; status: number; logTail?: string[] }`, `httpStatusFor(code): number`, `toErrorBody(err: unknown): { code, message, logTail? }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/errors.test.ts
import { describe, expect, it } from 'vitest';
import { StorybrokrError, httpStatusFor, toErrorBody } from './errors.js';

describe('StorybrokrError', () => {
  it('maps every code from the spec table to its HTTP status', () => {
    expect(httpStatusFor('HOST_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('HOST_INVALID')).toBe(422);
    expect(httpStatusFor('COMPONENT_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('INSTANCE_CAP_REACHED')).toBe(429);
    expect(httpStatusFor('NO_FREE_PORT')).toBe(503);
    expect(httpStatusFor('BOOT_FAILED')).toBe(502);
    expect(httpStatusFor('BOOT_TIMEOUT')).toBe(504);
    expect(httpStatusFor('INSTANCE_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('DAEMON_UNAVAILABLE')).toBe(503);
  });

  it('carries code, status and an optional log tail', () => {
    const err = new StorybrokrError('BOOT_FAILED', 'storybook exited with code 1', ['line a', 'line b']);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('BOOT_FAILED');
    expect(err.status).toBe(502);
    expect(err.logTail).toEqual(['line a', 'line b']);
    expect(err.message).toBe('storybook exited with code 1');
  });

  it('serializes itself and wraps foreign errors as INTERNAL', () => {
    expect(toErrorBody(new StorybrokrError('NO_FREE_PORT', 'range exhausted'))).toEqual({
      code: 'NO_FREE_PORT',
      message: 'range exhausted',
    });
    expect(toErrorBody(new TypeError('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
    expect(toErrorBody('nope')).toEqual({ code: 'INTERNAL', message: 'nope' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/errors.test.ts`
Expected: FAIL, cannot resolve `./errors.js`.

- [ ] **Step 3: Write `src/types.ts` (the Shared interfaces block, unchanged) and `src/lib/errors.ts`**

```ts
// src/lib/errors.ts
export type ErrorCode =
  | 'HOST_NOT_FOUND'
  | 'HOST_INVALID'
  | 'COMPONENT_NOT_FOUND'
  | 'INSTANCE_CAP_REACHED'
  | 'NO_FREE_PORT'
  | 'BOOT_FAILED'
  | 'BOOT_TIMEOUT'
  | 'INSTANCE_NOT_FOUND'
  | 'DAEMON_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  HOST_NOT_FOUND: 404,
  HOST_INVALID: 422,
  COMPONENT_NOT_FOUND: 404,
  INSTANCE_CAP_REACHED: 429,
  NO_FREE_PORT: 503,
  BOOT_FAILED: 502,
  BOOT_TIMEOUT: 504,
  INSTANCE_NOT_FOUND: 404,
  DAEMON_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS[code];
}

export class StorybrokrError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly logTail?: string[];

  constructor(code: ErrorCode, message: string, logTail?: string[]) {
    super(message);
    this.name = 'StorybrokrError';
    this.code = code;
    this.status = STATUS[code];
    if (logTail) this.logTail = logTail;
  }
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  logTail?: string[];
}

/** Shape every surface (HTTP, CLI --json, MCP) returns for a failure. */
export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof StorybrokrError) {
    return err.logTail
      ? { code: err.code, message: err.message, logTail: err.logTail }
      : { code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/types.ts apps/storybrokr/src/lib/errors.ts apps/storybrokr/src/lib/errors.test.ts
git commit -m "feat(storybrokr): shared instance types and the error contract"
```

---

### Task 3: Home directory paths and daemon config

**Files:**
- Create: `apps/storybrokr/src/lib/paths.ts`, `apps/storybrokr/src/server/config.ts`
- Test: `apps/storybrokr/src/lib/paths.test.ts`, `apps/storybrokr/src/server/config.test.ts`

**Interfaces:**
- Produces: `homeDir(env?)`, `daemonFile(home)`, `lockFile(home)`, `stateFile(home)`, `configFile(home)` (all return absolute strings); `DEFAULT_CONFIG: DaemonConfig`; `loadConfig(home): DaemonConfig`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/paths.test.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFile, daemonFile, homeDir, lockFile, stateFile } from './paths.js';

describe('paths', () => {
  it('defaults to ~/.storybrokr', () => {
    expect(homeDir({})).toBe(join(homedir(), '.storybrokr'));
  });

  it('honors STORYBROKR_HOME', () => {
    expect(homeDir({ STORYBROKR_HOME: '/tmp/sb-home' })).toBe('/tmp/sb-home');
  });

  it('derives the four files from the home dir', () => {
    expect(daemonFile('/h')).toBe('/h/daemon.json');
    expect(lockFile('/h')).toBe('/h/daemon.lock');
    expect(stateFile('/h')).toBe('/h/state.json');
    expect(configFile('/h')).toBe('/h/config.json');
  });
});
```

```ts
// src/server/config.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from './config.js';

describe('loadConfig', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('returns the spec defaults when config.json is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    expect(loadConfig(home)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      ttlMinutes: 30,
      instanceCap: 6,
      portRangeStart: 6100,
      portRangeEnd: 6199,
      readinessTimeoutMs: 120_000,
      reaperIntervalMs: 60_000,
      autoStartWaitMs: 10_000,
    });
  });

  it('merges known keys from config.json and ignores unknown ones', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ ttlMinutes: 5, bogus: 1 }));
    expect(loadConfig(home)).toEqual({ ...DEFAULT_CONFIG, ttlMinutes: 5 });
  });

  it('rejects a non-numeric value with a clear error', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ instanceCap: 'six' }));
    expect(() => loadConfig(home)).toThrow(/instanceCap/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/paths.test.ts src/server/config.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/paths.ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORYBROKR_HOME && env.STORYBROKR_HOME.length > 0
    ? env.STORYBROKR_HOME
    : join(homedir(), '.storybrokr');
}

export const daemonFile = (home: string) => join(home, 'daemon.json');
export const lockFile = (home: string) => join(home, 'daemon.lock');
export const stateFile = (home: string) => join(home, 'state.json');
export const configFile = (home: string) => join(home, 'config.json');
```

```ts
// src/server/config.ts
import { existsSync, readFileSync } from 'node:fs';
import { configFile } from '../lib/paths.js';
import type { DaemonConfig } from '../types.js';

export const DEFAULT_CONFIG: DaemonConfig = {
  ttlMinutes: 30,
  instanceCap: 6,
  portRangeStart: 6100,
  portRangeEnd: 6199,
  readinessTimeoutMs: 120_000,
  reaperIntervalMs: 60_000,
  autoStartWaitMs: 10_000,
};

const KEYS = Object.keys(DEFAULT_CONFIG) as (keyof DaemonConfig)[];

/** Defaults overlaid with any numeric keys found in <home>/config.json. */
export function loadConfig(home: string): DaemonConfig {
  const file = configFile(home);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out: DaemonConfig = { ...DEFAULT_CONFIG };
  for (const key of KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`config.json: ${key} must be a number, got ${JSON.stringify(value)}`);
    }
    out[key] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/paths.test.ts src/server/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/paths.ts apps/storybrokr/src/lib/paths.test.ts apps/storybrokr/src/server/config.ts apps/storybrokr/src/server/config.test.ts
git commit -m "feat(storybrokr): home directory paths and daemon config defaults"
```

---

### Task 4: Host detection

**Files:**
- Create: `apps/storybrokr/src/lib/tsconfig.ts`, `apps/storybrokr/src/lib/host.ts`
- Test: `apps/storybrokr/src/lib/tsconfig.test.ts`, `apps/storybrokr/src/lib/host.test.ts`

**Interfaces:**
- Consumes: `StorybrokrError` (Task 2), `HostInfo` (Task 2).
- Produces: `readTsconfigPaths(hostRoot): Record<string, string[]>`; `findHostRoot(startPath): string | null`; `inspectHost(hostRoot): HostInfo` (throws `HOST_INVALID`); `resolveHost(pathArg, explicitHostRoot?): HostInfo` (throws `HOST_NOT_FOUND` / `HOST_INVALID`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/tsconfig.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTsconfigPaths } from './tsconfig.js';

describe('readTsconfigPaths', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const make = (content: string) => {
    const d = mkdtempSync(join(tmpdir(), 'sb-tsc-'));
    dirs.push(d);
    writeFileSync(join(d, 'tsconfig.json'), content);
    return d;
  };

  it('returns {} when there is no tsconfig', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-tsc-'));
    dirs.push(d);
    expect(readTsconfigPaths(d)).toEqual({});
  });

  it('tolerates comments and trailing commas (tsconfig is JSONC)', () => {
    const d = make(`{
      // alias map
      "compilerOptions": {
        "paths": {
          "@/*": ["./src/*", "./*"], /* two targets */
          "@core/*": ["./components/core/*"],
        },
      },
    }`);
    expect(readTsconfigPaths(d)).toEqual({
      '@/*': ['./src/*', './*'],
      '@core/*': ['./components/core/*'],
    });
  });
});
```

```ts
// src/lib/host.test.ts
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from './errors.js';
import { findHostRoot, inspectHost, resolveHost } from './host.js';

/** Minimal fake host: .storybook/main.ts + preview.js + storybook bin + version. */
function makeHost(opts: { framework?: string; preview?: boolean; bin?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sb-host-'));
  mkdirSync(join(root, '.storybook'));
  const framework = opts.framework ?? '@storybook/react-vite';
  writeFileSync(
    join(root, '.storybook', 'main.ts'),
    `export default { framework: { name: '${framework}', options: {} }, stories: ['../src/**/*.stories.tsx'] };\n`,
  );
  if (opts.preview !== false) writeFileSync(join(root, '.storybook', 'preview.js'), 'export default {};\n');
  if (opts.bin !== false) {
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '.bin', 'storybook'), '#!/bin/sh\n');
    chmodSync(join(root, 'node_modules', '.bin', 'storybook'), 0o755);
    mkdirSync(join(root, 'node_modules', 'storybook'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'storybook', 'package.json'), JSON.stringify({ version: '10.6.0' }));
  }
  mkdirSync(join(root, 'src', 'components', 'button'), { recursive: true });
  return root;
}

describe('host', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('findHostRoot walks up to the directory containing .storybook', () => {
    const root = makeHost();
    dirs.push(root);
    expect(findHostRoot(join(root, 'src', 'components', 'button'))).toBe(root);
    expect(findHostRoot(root)).toBe(root);
  });

  it('findHostRoot returns null when nothing above has .storybook', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-nohost-'));
    dirs.push(d);
    expect(findHostRoot(d)).toBeNull();
  });

  it('inspectHost reports main, preview, framework, bin, version and paths', () => {
    const root = makeHost();
    dirs.push(root);
    writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}');
    const info = inspectHost(root);
    expect(info.hostRoot).toBe(root);
    expect(info.mainFile).toBe(join(root, '.storybook', 'main.ts'));
    expect(info.previewFile).toBe(join(root, '.storybook', 'preview.js'));
    expect(info.managerFile).toBeNull();
    expect(info.framework).toBe('@storybook/react-vite');
    expect(info.storybookBin).toBe(join(root, 'node_modules', '.bin', 'storybook'));
    expect(info.storybookVersion).toBe('10.6.0');
    expect(info.tsconfigPaths).toEqual({ '@/*': ['./src/*'] });
  });

  it('inspectHost throws HOST_INVALID naming the missing storybook binary', () => {
    const root = makeHost({ bin: false });
    dirs.push(root);
    expect(() => inspectHost(root)).toThrow(StorybrokrError);
    try {
      inspectHost(root);
    } catch (e) {
      expect((e as StorybrokrError).code).toBe('HOST_INVALID');
      expect((e as StorybrokrError).message).toMatch(/node_modules\/\.bin\/storybook/);
    }
  });

  it('resolveHost throws HOST_NOT_FOUND for a path with no .storybook above it', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-nohost-'));
    dirs.push(d);
    expect(() => resolveHost(join(d, 'x'))).toThrow(/HOST_NOT_FOUND|no \.storybook/);
  });

  it('resolveHost prefers an explicit host root', () => {
    const root = makeHost();
    dirs.push(root);
    expect(resolveHost('components/button', root).hostRoot).toBe(root);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/tsconfig.test.ts src/lib/host.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/tsconfig.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Strip // and /* */ comments and trailing commas so tsconfig (JSONC) parses. */
export function parseJsonc(text: string): unknown {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:"'])\/\/.*$/gm, '$1');
  const noTrailing = noLine.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

/** compilerOptions.paths from <hostRoot>/tsconfig.json, or {} when absent. */
export function readTsconfigPaths(hostRoot: string): Record<string, string[]> {
  const file = join(hostRoot, 'tsconfig.json');
  if (!existsSync(file)) return {};
  const parsed = parseJsonc(readFileSync(file, 'utf8')) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  return parsed.compilerOptions?.paths ?? {};
}
```

```ts
// src/lib/host.ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { HostInfo } from '../types.js';
import { StorybrokrError } from './errors.js';
import { readTsconfigPaths } from './tsconfig.js';

const MAIN_EXTS = ['ts', 'mts', 'js', 'mjs', 'cjs'];
const PREVIEW_EXTS = ['tsx', 'ts', 'jsx', 'js', 'mjs'];

function firstExisting(dir: string, base: string, exts: string[]): string | null {
  for (const ext of exts) {
    const file = join(dir, `${base}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Walk up from startPath until a directory containing `.storybook/` is found. */
export function findHostRoot(startPath: string): string | null {
  let dir = resolve(startPath);
  for (;;) {
    if (existsSync(join(dir, '.storybook'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Best-effort framework name from the main config text; 'unknown' if not found. */
export function detectFramework(mainSource: string): string {
  const objectForm = mainSource.match(/framework\s*:\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/s);
  if (objectForm) return objectForm[1];
  const stringForm = mainSource.match(/framework\s*:\s*['"`]([^'"`]+)['"`]/);
  if (stringForm) return stringForm[1];
  // getAbsolutePath('@storybook/nextjs') style
  const helperForm = mainSource.match(/framework[\s\S]{0,80}?\(\s*['"`](@storybook\/[a-z-]+)['"`]/);
  return helperForm ? helperForm[1] : 'unknown';
}

export function inspectHost(hostRoot: string): HostInfo {
  const storybookDir = join(hostRoot, '.storybook');
  const mainFile = firstExisting(storybookDir, 'main', MAIN_EXTS);
  if (!mainFile) {
    throw new StorybrokrError('HOST_INVALID', `${storybookDir} has no main.{${MAIN_EXTS.join(',')}}`);
  }
  const storybookBin = join(hostRoot, 'node_modules', '.bin', 'storybook');
  if (!existsSync(storybookBin)) {
    throw new StorybrokrError(
      'HOST_INVALID',
      `${hostRoot} has no node_modules/.bin/storybook — install the host's dependencies first`,
    );
  }
  const pkgFile = join(hostRoot, 'node_modules', 'storybook', 'package.json');
  const storybookVersion = existsSync(pkgFile)
    ? (JSON.parse(readFileSync(pkgFile, 'utf8')) as { version: string }).version
    : 'unknown';
  return {
    hostRoot,
    storybookDir,
    mainFile,
    previewFile: firstExisting(storybookDir, 'preview', PREVIEW_EXTS),
    managerFile: firstExisting(storybookDir, 'manager', PREVIEW_EXTS),
    framework: detectFramework(readFileSync(mainFile, 'utf8')),
    storybookBin,
    storybookVersion,
    tsconfigPaths: readTsconfigPaths(hostRoot),
  };
}

/** Resolve the host for a component path; an explicit root wins over walking up. */
export function resolveHost(pathArg: string, explicitHostRoot?: string): HostInfo {
  if (explicitHostRoot) return inspectHost(resolve(explicitHostRoot));
  const start = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const root = findHostRoot(existsSync(start) ? start : dirname(start));
  if (!root) {
    throw new StorybrokrError('HOST_NOT_FOUND', `no .storybook/ directory above ${start}`);
  }
  return inspectHost(root);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/tsconfig.test.ts src/lib/host.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/tsconfig.ts apps/storybrokr/src/lib/tsconfig.test.ts apps/storybrokr/src/lib/host.ts apps/storybrokr/src/lib/host.test.ts
git commit -m "feat(storybrokr): host detection with tsconfig alias parsing"
```

---

### Task 5: Child discovery through the import graph

**Files:**
- Create: `apps/storybrokr/src/lib/discover.ts`
- Test: `apps/storybrokr/src/lib/discover.test.ts`

**Interfaces:**
- Consumes: `StorybrokrError` (Task 2).
- Produces: `discoverStories(hostRoot: string, component: string, tsconfigPaths: Record<string, string[]>): DiscoveryResult` where `DiscoveryResult = { storyFiles: string[] /* relative to hostRoot, sorted, unique */; modulesVisited: number; unresolved: string[] }`. Throws `COMPONENT_NOT_FOUND` when the path is missing or no story files are reachable.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/discover.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from './errors.js';
import { discoverStories } from './discover.js';

/** Write a tree of files; keys are paths relative to the root. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sb-disc-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const PATHS = { '@/*': ['./src/*', './*'], '@core/*': ['./components/core/*'] };

describe('discoverStories', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('walks relative and alias imports transitively and keeps only story-bearing modules', () => {
    const root = tree({
      'components/core/organisms/calendar/section/CalendarSection.tsx':
        "import { CalendarHeader } from '../molecules/CalendarHeader/CalendarHeader';\nimport { Switch } from '@core/atoms/switch/Switch';\nimport { fmt } from '../utils/fmt';\nexport const CalendarSection = () => null;\n",
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx': 'export default {};\n',
      'components/core/organisms/calendar/section/CalendarSection.types.ts': 'export type P = {};\n',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.tsx':
        "import { CalendarViewTab } from '@core/atoms/CalendarViewTab/CalendarViewTab';\nexport const CalendarHeader = () => null;\n",
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx': '',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeaderWithTabs.stories.tsx': '',
      'components/core/organisms/calendar/utils/fmt.ts': 'export const fmt = () => 1;\n',
      'components/core/atoms/switch/Switch.tsx': 'export const Switch = () => null;\n',
      'components/core/atoms/switch/Switch.stories.tsx': '',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.tsx': 'export const CalendarViewTab = () => null;\n',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx': '',
      'components/core/atoms/Unrelated/Unrelated.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'components/core/organisms/calendar/section', PATHS);
    expect(result.storyFiles).toEqual([
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx',
      'components/core/atoms/switch/Switch.stories.tsx',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeaderWithTabs.stories.tsx',
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx',
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.modulesVisited).toBeGreaterThanOrEqual(5);
  });

  it('accepts a single story file as the component', () => {
    const root = tree({
      'src/Button.tsx': "import './Icon';\nexport const Button = () => null;\n",
      'src/Button.stories.tsx': '',
      'src/Icon.tsx': 'export const Icon = () => null;\n',
      'src/Icon.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src/Button.stories.tsx', {});
    expect(result.storyFiles).toEqual(['src/Button.stories.tsx']);
  });

  it('resolves index files, dynamic imports, and survives cycles', () => {
    const root = tree({
      'src/a/index.ts': "export * from './A';\n",
      'src/a/A.tsx': "import('../b');\nimport { B } from '../b';\nexport const A = () => null;\n",
      'src/a/A.stories.tsx': '',
      'src/b/index.ts': "import { A } from '../a';\nexport const B = () => null;\n",
      'src/b/index.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src/a', {});
    expect(result.storyFiles).toEqual(['src/a/A.stories.tsx', 'src/b/index.stories.tsx']);
  });

  it('logs unresolvable local specifiers without throwing and never enters node_modules', () => {
    const root = tree({
      'src/C.tsx': "import x from './missing';\nimport react from 'react';\nexport const C = () => null;\n",
      'src/C.stories.tsx': '',
      'node_modules/react/index.js': '',
      'node_modules/react/index.stories.js': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src', {});
    expect(result.storyFiles).toEqual(['src/C.stories.tsx']);
    expect(result.unresolved).toEqual(['src/C.tsx -> ./missing']);
  });

  it('throws COMPONENT_NOT_FOUND for a missing path or a path with no reachable stories', () => {
    const root = tree({ 'src/plain.ts': 'export const x = 1;\n' });
    roots.push(root);
    expect(() => discoverStories(root, 'src/nope', {})).toThrow(StorybrokrError);
    try {
      discoverStories(root, 'src', {});
    } catch (e) {
      expect((e as StorybrokrError).code).toBe('COMPONENT_NOT_FOUND');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/discover.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/discover.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { StorybrokrError } from './errors.js';

export interface DiscoveryResult {
  storyFiles: string[];
  modulesVisited: number;
  unresolved: string[];
}

const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
const STORY_RE = /\.stories\.(tsx|ts|jsx|js|mdx)$/;
const SKIP_RE = /\.(stories|test|spec|types)\./;
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveFile(base: string): string | null {
  for (const ext of ['', ...SOURCE_EXTS]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  for (const ext of SOURCE_EXTS) {
    const f = join(base, `index${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
}

function resolveAlias(spec: string, hostRoot: string, paths: Record<string, string[]>): string | null {
  for (const [pattern, targets] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*$/, '');
    if (!spec.startsWith(prefix)) continue;
    const rest = spec.slice(prefix.length);
    for (const target of targets) {
      const found = resolveFile(join(hostRoot, target.replace(/\*$/, ''), rest));
      if (found) return found;
    }
  }
  return null;
}

/** Local specifiers only: relative paths and tsconfig aliases. Bare packages return null. */
function resolveImport(fromFile: string, spec: string, hostRoot: string, paths: Record<string, string[]>) {
  if (spec.startsWith('.')) return { local: true, file: resolveFile(resolve(dirname(fromFile), spec)) };
  const viaAlias = resolveAlias(spec, hostRoot, paths);
  const isAliasShaped = Object.keys(paths).some((p) => spec.startsWith(p.replace(/\*$/, '')));
  return { local: isAliasShaped, file: viaAlias };
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
  }
  return [...out];
}

/** Sibling story files whose basename starts with the module's basename; index modules take the whole dir. */
function storyFilesFor(file: string): string[] {
  const dir = dirname(file);
  const base = basename(file).replace(/\.(tsx|ts|jsx|js)$/, '');
  return readdirSync(dir)
    .filter((f) => STORY_RE.test(f) && (base === 'index' || f.startsWith(`${base}.`)))
    .map((f) => join(dir, f));
}

export function discoverStories(
  hostRoot: string,
  component: string,
  tsconfigPaths: Record<string, string[]>,
): DiscoveryResult {
  const abs = resolve(hostRoot, component);
  if (!existsSync(abs)) {
    throw new StorybrokrError('COMPONENT_NOT_FOUND', `${component} does not exist under ${hostRoot}`);
  }
  const stories = new Set<string>();
  const queue: string[] = [];
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs)) {
      const full = join(abs, f);
      if (STORY_RE.test(f)) stories.add(full);
      else if (SOURCE_EXTS.some((e) => f.endsWith(e)) && !SKIP_RE.test(f) && statSync(full).isFile()) queue.push(full);
    }
  } else {
    if (STORY_RE.test(abs)) stories.add(abs);
    queue.push(abs);
  }

  const seen = new Set<string>();
  const unresolved: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file) || file.includes(`${'/'}node_modules${'/'}`)) continue;
    seen.add(file);
    for (const s of storyFilesFor(file)) stories.add(s);
    for (const spec of importsOf(file)) {
      const { local, file: target } = resolveImport(file, spec, hostRoot, tsconfigPaths);
      if (!local) continue;
      if (!target) {
        unresolved.push(`${relative(hostRoot, file)} -> ${spec}`);
        continue;
      }
      if (!target.includes(`${'/'}node_modules${'/'}`) && !seen.has(target)) queue.push(target);
    }
  }

  const storyFiles = [...stories].map((s) => relative(hostRoot, s)).sort();
  if (storyFiles.length === 0) {
    throw new StorybrokrError('COMPONENT_NOT_FOUND', `no *.stories.* files reachable from ${component}`);
  }
  return { storyFiles, modulesVisited: seen.size, unresolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/discover.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/discover.ts apps/storybrokr/src/lib/discover.test.ts
git commit -m "feat(storybrokr): transitive import-graph discovery of story-bearing children"
```

---

### Task 6: Ephemeral config directory generation

**Files:**
- Create: `apps/storybrokr/src/lib/instance.ts`
- Test: `apps/storybrokr/src/lib/instance.test.ts`

**Interfaces:**
- Consumes: `HostInfo`, `InstanceRecord` (Task 2).
- Produces: `instanceId(hostRoot, component): string` (12-char hex); `configDirFor(hostRoot, id): string`; `generateConfigDir(host: HostInfo, id: string, storyFiles: string[]): string` (returns the dir); `writeSidecar(configDir, record)`, `readSidecars(hostRoot): InstanceRecord[]`, `removeConfigDir(configDir)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/instance.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostInfo, InstanceRecord } from '../types.js';
import { configDirFor, generateConfigDir, instanceId, readSidecars, removeConfigDir, writeSidecar } from './instance.js';

function fakeHost(previewExt = 'js', withManager = false): HostInfo {
  const hostRoot = mkdtempSync(join(tmpdir(), 'sb-inst-'));
  mkdirSync(join(hostRoot, '.storybook'));
  writeFileSync(join(hostRoot, '.storybook', 'main.ts'), 'export default {};\n');
  writeFileSync(join(hostRoot, '.storybook', `preview.${previewExt}`), 'export default {};\n');
  if (withManager) writeFileSync(join(hostRoot, '.storybook', 'manager.ts'), '');
  return {
    hostRoot,
    storybookDir: join(hostRoot, '.storybook'),
    mainFile: join(hostRoot, '.storybook', 'main.ts'),
    previewFile: join(hostRoot, '.storybook', `preview.${previewExt}`),
    managerFile: withManager ? join(hostRoot, '.storybook', 'manager.ts') : null,
    framework: '@storybook/nextjs',
    storybookBin: join(hostRoot, 'node_modules', '.bin', 'storybook'),
    storybookVersion: '10.6.0',
    tsconfigPaths: {},
  };
}

describe('instance config dir', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('derives a stable 12-char id from host + component', () => {
    const a = instanceId('/h', 'src/Button');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(instanceId('/h', 'src/Button')).toBe(a);
    expect(instanceId('/h', 'src/Other')).not.toBe(a);
  });

  it('writes main.ts that imports the host main and overrides stories, staticDirs and nextConfigPath', () => {
    const host = fakeHost();
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', ['src/Button.stories.tsx', 'src/Icon.stories.tsx']);
    expect(dir).toBe(configDirFor(host.hostRoot, 'abc123abc123'));
    expect(dir).toBe(join(host.hostRoot, 'node_modules', '.cache', 'storybrokr', 'abc123abc123'));
    const main = readFileSync(join(dir, 'main.ts'), 'utf8');
    expect(main).toContain(`import host from ${JSON.stringify(host.mainFile)};`);
    expect(main).toContain("import { resolve as pathResolve } from 'node:path';");
    expect(main).not.toContain('require(');
    expect(main).toContain('"../../../../src/Button.stories.tsx"');
    expect(main).toContain('"../../../../src/Icon.stories.tsx"');
    expect(main).toContain('staticDirs');
    expect(main).toContain('nextConfigPath');
    expect(main).toContain('export default config;');
  });

  it('re-exports the host preview with its own extension and only writes manager when the host has one', () => {
    const host = fakeHost('tsx', true);
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', ['src/A.stories.tsx']);
    const preview = readFileSync(join(dir, 'preview.tsx'), 'utf8');
    expect(preview).toContain(`export * from ${JSON.stringify(host.previewFile)};`);
    expect(preview).toContain(`export { default } from ${JSON.stringify(host.previewFile)};`);
    expect(existsSync(join(dir, 'manager.ts'))).toBe(true);
    const noManager = fakeHost();
    roots.push(noManager.hostRoot);
    const dir2 = generateConfigDir(noManager, 'abc123abc123', ['src/A.stories.tsx']);
    expect(existsSync(join(dir2, 'manager.ts'))).toBe(false);
  });

  it('round-trips sidecars and removes the dir', () => {
    const host = fakeHost();
    roots.push(host.hostRoot);
    const dir = generateConfigDir(host, 'abc123abc123', ['src/A.stories.tsx']);
    const record = {
      id: 'abc123abc123',
      hostRoot: host.hostRoot,
      component: 'src',
      framework: '@storybook/nextjs',
      port: 6100,
      url: 'http://127.0.0.1:6100',
      pid: null,
      status: 'starting',
      createdAt: '2026-09-06T00:00:00.000Z',
      lastTouchedAt: '2026-09-06T00:00:00.000Z',
      ttlMinutes: 30,
      storyFiles: ['src/A.stories.tsx'],
      stories: [],
      configDir: dir,
    } satisfies InstanceRecord;
    writeSidecar(dir, record);
    expect(readSidecars(host.hostRoot)).toEqual([record]);
    removeConfigDir(dir);
    expect(existsSync(dir)).toBe(false);
    expect(readSidecars(host.hostRoot)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/instance.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/instance.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import type { HostInfo, InstanceRecord } from '../types.js';

export const SIDECAR = 'storybrokr.json';

export function instanceId(hostRoot: string, component: string): string {
  return createHash('sha256').update(`${hostRoot}\n${component}`).digest('hex').slice(0, 12);
}

export function configDirFor(hostRoot: string, id: string): string {
  return join(hostRoot, 'node_modules', '.cache', 'storybrokr', id);
}

/** The generated main.ts: host main spread with stories/staticDirs/nextConfigPath rewritten. */
function renderMain(host: HostInfo, configDir: string, storyFiles: string[]): string {
  const rel = storyFiles.map((f) => {
    const r = relative(configDir, join(host.hostRoot, f)).split('\\').join('/');
    return r.startsWith('.') ? r : `./${r}`;
  });
  return `// Generated by storybrokr — an ephemeral single-component Storybook config.
// Inherits the host's .storybook/main and overrides only what must change.
// Uses node:path (not require): Storybook loads this file as ESM.
import { resolve as pathResolve } from 'node:path';
import host from ${JSON.stringify(host.mainFile)};

const HOST_SB = ${JSON.stringify(host.storybookDir)};
const abs = (p: string): string => (p.startsWith('/') ? p : pathResolve(HOST_SB, p));
const hostFramework =
  typeof host.framework === 'string' ? { name: host.framework, options: {} } : host.framework;
const options = (hostFramework as { options?: Record<string, unknown> }).options ?? {};
const nextConfigPath = options.nextConfigPath;

const config = {
  ...host,
  stories: ${JSON.stringify(rel, null, 2)},
  staticDirs: (host.staticDirs ?? []).map((d: unknown) =>
    typeof d === 'string' ? abs(d) : { ...(d as { from: string; to: string }), from: abs((d as { from: string }).from) },
  ),
  framework: {
    ...hostFramework,
    options: {
      ...options,
      ...(typeof nextConfigPath === 'string' ? { nextConfigPath: abs(nextConfigPath) } : {}),
    },
  },
};

export default config;
`;
}

function renderReexport(target: string): string {
  return `// Generated by storybrokr — re-exports the host file unchanged.
export * from ${JSON.stringify(target)};
export { default } from ${JSON.stringify(target)};
`;
}

export function generateConfigDir(host: HostInfo, id: string, storyFiles: string[]): string {
  const dir = configDirFor(host.hostRoot, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.ts'), renderMain(host, dir, storyFiles));
  if (host.previewFile) {
    writeFileSync(join(dir, `preview${extname(host.previewFile)}`), renderReexport(host.previewFile));
  }
  if (host.managerFile) {
    writeFileSync(join(dir, `manager${extname(host.managerFile)}`), renderReexport(host.managerFile));
  }
  return dir;
}

export function writeSidecar(configDir: string, record: InstanceRecord): void {
  writeFileSync(join(configDir, SIDECAR), `${JSON.stringify(record, null, 2)}\n`);
}

/** Every sidecar under <hostRoot>/node_modules/.cache/storybrokr — the durable inventory. */
export function readSidecars(hostRoot: string): InstanceRecord[] {
  const base = join(hostRoot, 'node_modules', '.cache', 'storybrokr');
  if (!existsSync(base)) return [];
  const out: InstanceRecord[] = [];
  for (const entry of readdirSync(base)) {
    const file = join(base, entry, SIDECAR);
    if (!existsSync(file)) continue;
    try {
      out.push(JSON.parse(readFileSync(file, 'utf8')) as InstanceRecord);
    } catch {
      // A half-written sidecar is not an instance; skip it.
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function removeConfigDir(configDir: string): void {
  if (basename(join(configDir, '..')) !== 'storybrokr') {
    throw new Error(`refusing to remove ${configDir}: not under a storybrokr cache dir`);
  }
  rmSync(configDir, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/instance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/instance.ts apps/storybrokr/src/lib/instance.test.ts
git commit -m "feat(storybrokr): generate ephemeral config dirs that inherit the host storybook"
```

---

### Task 7: Free-port allocation

**Files:**
- Create: `apps/storybrokr/src/lib/ports.ts`
- Test: `apps/storybrokr/src/lib/ports.test.ts`

**Interfaces:**
- Produces: `findFreePort(start: number, end: number, reserved: Set<number>): Promise<number>` — first port in `[start, end]` that is not reserved and accepts a bind on 127.0.0.1; throws `NO_FREE_PORT`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ports.test.ts
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from './errors.js';
import { findFreePort } from './ports.js';

function occupy(port: number): Promise<Server> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

describe('findFreePort', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
  });

  it('skips reserved ports and ports something else is listening on', async () => {
    const busy = await occupy(6191);
    servers.push(busy);
    const port = await findFreePort(6190, 6193, new Set([6190]));
    expect(port).toBe(6192);
  });

  it('throws NO_FREE_PORT when the range is exhausted', async () => {
    await expect(findFreePort(6195, 6195, new Set([6195]))).rejects.toBeInstanceOf(StorybrokrError);
    await expect(findFreePort(6195, 6195, new Set([6195]))).rejects.toMatchObject({ code: 'NO_FREE_PORT' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/ports.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ports.ts
import { createServer } from 'node:net';
import { StorybrokrError } from './errors.js';

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function findFreePort(start: number, end: number, reserved: Set<number>): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (reserved.has(port)) continue;
    if (await canBind(port)) return port;
  }
  throw new StorybrokrError('NO_FREE_PORT', `no free port in ${start}-${end}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/ports.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/ports.ts apps/storybrokr/src/lib/ports.test.ts
git commit -m "feat(storybrokr): free-port allocation within the configured range"
```

---

### Task 8: Log buffer and the Storybook spawner

**Files:**
- Create: `apps/storybrokr/src/lib/logbuffer.ts`, `apps/storybrokr/src/lib/spawn.ts`
- Test: `apps/storybrokr/src/lib/logbuffer.test.ts`, `apps/storybrokr/src/lib/spawn.test.ts`

**Interfaces:**
- Consumes: `HostInfo` (Task 2).
- Produces:
  - `class LogBuffer { constructor(capacity = 2000); push(chunk: string): void; tail(n: number): string[]; onLine(cb: (line: string) => void): () => void; readonly lines: readonly string[] }`
  - `interface SpawnedProcess { pid: number; log: LogBuffer; exited: Promise<number | null>; kill(): Promise<void> }`
  - `interface Spawner { spawn(host: HostInfo, configDir: string, port: number): SpawnedProcess }`
  - `storybookSpawner: Spawner` (real child_process implementation, `--config-dir <dir> --port <port> --exact-port --ci --no-open --disable-telemetry`, cwd host root, `CI=1 FORCE_COLOR=0`, log file `<configDir>/storybook.log`)
  - `commandSpawner(command: string, args: string[]): Spawner` — test seam that runs any command instead of the host binary.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/logbuffer.test.ts
import { describe, expect, it } from 'vitest';
import { LogBuffer } from './logbuffer.js';

describe('LogBuffer', () => {
  it('splits chunks into lines, keeps a partial trailing line, and caps capacity', () => {
    const buf = new LogBuffer(3);
    buf.push('a\nb\nc');
    expect(buf.lines).toEqual(['a', 'b']);
    buf.push('c-rest\nd\n');
    expect(buf.lines).toEqual(['b', 'cc-rest', 'd']);
    expect(buf.tail(2)).toEqual(['cc-rest', 'd']);
  });

  it('notifies line listeners and lets them unsubscribe', () => {
    const buf = new LogBuffer();
    const seen: string[] = [];
    const off = buf.onLine((l) => seen.push(l));
    buf.push('one\ntwo\n');
    off();
    buf.push('three\n');
    expect(seen).toEqual(['one', 'two']);
  });
});
```

```ts
// src/lib/spawn.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostInfo } from '../types.js';
import { commandSpawner } from './spawn.js';

const host = (root: string): HostInfo => ({
  hostRoot: root,
  storybookDir: join(root, '.storybook'),
  mainFile: join(root, '.storybook', 'main.ts'),
  previewFile: null,
  managerFile: null,
  framework: 'unknown',
  storybookBin: '/nonexistent',
  storybookVersion: '0',
  tsconfigPaths: {},
});

describe('commandSpawner', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('captures stdout+stderr into the log buffer and the log file, and resolves the exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-spawn-'));
    dirs.push(dir);
    const spawner = commandSpawner(process.execPath, ['-e', 'console.log("hello"); console.error("warn"); process.exit(3)']);
    const proc = spawner.spawn(host(dir), dir, 6100);
    expect(proc.pid).toBeGreaterThan(0);
    expect(await proc.exited).toBe(3);
    expect(proc.log.lines).toEqual(expect.arrayContaining(['hello', 'warn']));
    expect(readFileSync(join(dir, 'storybook.log'), 'utf8')).toContain('hello');
  });

  it('kill() terminates a long-running child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-spawn-'));
    dirs.push(dir);
    const spawner = commandSpawner(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const proc = spawner.spawn(host(dir), dir, 6100);
    await proc.kill();
    expect(await proc.exited).toBeNull(); // killed by signal → no exit code
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/logbuffer.test.ts src/lib/spawn.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/logbuffer.ts
export class LogBuffer {
  private readonly buf: string[] = [];
  private partial = '';
  private readonly listeners = new Set<(line: string) => void>();

  constructor(private readonly capacity = 2000) {}

  get lines(): readonly string[] {
    return this.buf;
  }

  push(chunk: string): void {
    const text = this.partial + chunk;
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    for (const line of parts) {
      this.buf.push(line);
      if (this.buf.length > this.capacity) this.buf.shift();
      for (const cb of this.listeners) cb(line);
    }
  }

  tail(n: number): string[] {
    return this.buf.slice(Math.max(0, this.buf.length - n));
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
```

```ts
// src/lib/spawn.ts
import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { HostInfo } from '../types.js';
import { LogBuffer } from './logbuffer.js';

export interface SpawnedProcess {
  pid: number;
  log: LogBuffer;
  exited: Promise<number | null>;
  kill(): Promise<void>;
}

export interface Spawner {
  spawn(host: HostInfo, configDir: string, port: number): SpawnedProcess;
}

export const STORYBOOK_ARGS = (configDir: string, port: number): string[] => [
  'dev',
  '--config-dir',
  configDir,
  '--port',
  String(port),
  '--exact-port',
  '--ci',
  '--no-open',
  '--disable-telemetry',
];

function wrap(child: ChildProcess, configDir: string): SpawnedProcess {
  const log = new LogBuffer();
  const file = createWriteStream(join(configDir, 'storybook.log'), { flags: 'a' });
  const onData = (b: Buffer) => {
    const s = b.toString();
    log.push(s);
    file.write(s);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      file.end();
      resolve(code);
    });
  });
  return {
    pid: child.pid ?? -1,
    log,
    exited,
    kill: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const dead = await Promise.race([exited.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 5000))]);
      if (!dead) child.kill('SIGKILL');
      await exited;
    },
  };
}

/** Runs an arbitrary command in place of the host's storybook binary (tests). */
export function commandSpawner(command: string, args: string[]): Spawner {
  return {
    spawn(host, configDir) {
      const child = spawn(command, args, {
        cwd: host.hostRoot,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return wrap(child, configDir);
    },
  };
}

/** The real thing: the host's own node_modules/.bin/storybook. */
export const storybookSpawner: Spawner = {
  spawn(host, configDir, port) {
    const child = spawn(host.storybookBin, STORYBOOK_ARGS(configDir, port), {
      cwd: host.hostRoot,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return wrap(child, configDir);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/logbuffer.test.ts src/lib/spawn.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/logbuffer.ts apps/storybrokr/src/lib/logbuffer.test.ts apps/storybrokr/src/lib/spawn.ts apps/storybrokr/src/lib/spawn.test.ts
git commit -m "feat(storybrokr): log ring buffer and storybook process spawner"
```

---

### Task 9: Readiness and the story index

**Files:**
- Create: `apps/storybrokr/src/lib/readiness.ts`
- Test: `apps/storybrokr/src/lib/readiness.test.ts`

**Interfaces:**
- Consumes: `LogBuffer` (Task 8), `StoryEntry` (Task 2), `StorybrokrError` (Task 2).
- Produces:
  - `parseIndex(json: unknown, port: number): StoryEntry[]` — from Storybook's `/index.json` (`entries` keyed by id with `type`, `title`, `name`, `importPath`); keeps `type === 'story'`; builds `url` and `iframeUrl`.
  - `fetchStories(port): Promise<StoryEntry[] | null>` — null when the server does not answer 200 yet.
  - `waitForReady(opts: { port; log: LogBuffer; exited: Promise<number | null>; timeoutMs; pollMs? }): Promise<StoryEntry[]>` — resolves when index answers AND the `Local:` banner has appeared; rejects `BOOT_FAILED` (process exit or failure pattern) or `BOOT_TIMEOUT`, both carrying `log.tail(50)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/readiness.test.ts
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LogBuffer } from './logbuffer.js';
import { parseIndex, waitForReady } from './readiness.js';

const INDEX = {
  v: 5,
  entries: {
    'core-atoms-button--primary': { id: 'core-atoms-button--primary', type: 'story', title: 'Core/Atoms/Button', name: 'Primary', importPath: './src/Button.stories.tsx' },
    'core-atoms-button--docs': { id: 'core-atoms-button--docs', type: 'docs', title: 'Core/Atoms/Button', name: 'Docs', importPath: './src/Button.stories.tsx' },
  },
};

function serveIndex(port: number, ready: () => boolean): Promise<Server> {
  return new Promise((res) => {
    const s = createServer((req, r) => {
      if (req.url === '/index.json' && ready()) {
        r.writeHead(200, { 'content-type': 'application/json' });
        r.end(JSON.stringify(INDEX));
      } else {
        r.writeHead(503);
        r.end();
      }
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

const never = new Promise<number | null>(() => {});

describe('readiness', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
  });

  it('parseIndex keeps stories only and builds both URLs', () => {
    expect(parseIndex(INDEX, 6100)).toEqual([
      {
        id: 'core-atoms-button--primary',
        title: 'Core/Atoms/Button',
        name: 'Primary',
        importPath: './src/Button.stories.tsx',
        url: 'http://127.0.0.1:6100/?path=/story/core-atoms-button--primary',
        iframeUrl: 'http://127.0.0.1:6100/iframe.html?id=core-atoms-button--primary&viewMode=story',
      },
    ]);
  });

  it('resolves once the index answers and the banner has printed, in either order', async () => {
    let ready = false;
    servers.push(await serveIndex(6181, () => ready));
    const log = new LogBuffer();
    const p = waitForReady({ port: 6181, log, exited: never, timeoutMs: 5000, pollMs: 20 });
    log.push('│   - Local:   http://localhost:6181/   │\n');
    ready = true;
    const stories = await p;
    expect(stories).toHaveLength(1);
  });

  it('rejects BOOT_FAILED with a log tail when the process exits first', async () => {
    const log = new LogBuffer();
    log.push('Error: boom\n');
    const exited = Promise.resolve(1);
    await expect(waitForReady({ port: 6182, log, exited, timeoutMs: 5000, pollMs: 20 })).rejects.toMatchObject({
      code: 'BOOT_FAILED',
      logTail: ['Error: boom'],
    });
  });

  it('rejects BOOT_TIMEOUT when nothing becomes ready in time', async () => {
    const log = new LogBuffer();
    await expect(waitForReady({ port: 6183, log, exited: never, timeoutMs: 150, pollMs: 20 })).rejects.toMatchObject({
      code: 'BOOT_TIMEOUT',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/readiness.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/readiness.ts
import type { StoryEntry } from '../types.js';
import { StorybrokrError } from './errors.js';
import type { LogBuffer } from './logbuffer.js';

interface IndexJson {
  entries?: Record<string, { id: string; type: string; title: string; name: string; importPath: string }>;
}

export function parseIndex(json: unknown, port: number): StoryEntry[] {
  const entries = (json as IndexJson).entries ?? {};
  const base = `http://127.0.0.1:${port}`;
  return Object.values(entries)
    .filter((e) => e.type === 'story')
    .map((e) => ({
      id: e.id,
      title: e.title,
      name: e.name,
      importPath: e.importPath,
      url: `${base}/?path=/story/${e.id}`,
      iframeUrl: `${base}/iframe.html?id=${e.id}&viewMode=story`,
    }));
}

export async function fetchStories(port: number): Promise<StoryEntry[] | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/index.json`);
    if (!res.ok) return null;
    return parseIndex(await res.json(), port);
  } catch {
    return null;
  }
}

const BANNER_RE = /Local:\s+http/;
const FAILURE_RE = /\b(EADDRINUSE|Cannot find module|SB_[A-Z_]+_\d+|Error: Failed to)\b/;

export interface WaitOptions {
  port: number;
  log: LogBuffer;
  exited: Promise<number | null>;
  timeoutMs: number;
  pollMs?: number;
}

export async function waitForReady(opts: WaitOptions): Promise<StoryEntry[]> {
  const poll = opts.pollMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let exitCode: number | null | undefined;
  opts.exited.then((code) => {
    exitCode = code;
  });
  let failure: string | null = null;
  const off = opts.log.onLine((line) => {
    if (failure === null && FAILURE_RE.test(line)) failure = line;
  });
  try {
    for (;;) {
      if (exitCode !== undefined) {
        throw new StorybrokrError('BOOT_FAILED', `storybook exited with code ${exitCode} before becoming ready`, opts.log.tail(50));
      }
      if (failure !== null) {
        throw new StorybrokrError('BOOT_FAILED', `storybook reported a failure: ${failure}`, opts.log.tail(50));
      }
      const bannerSeen = opts.log.lines.some((l) => BANNER_RE.test(l));
      const stories = bannerSeen ? await fetchStories(opts.port) : null;
      if (stories) return stories;
      if (Date.now() > deadline) {
        throw new StorybrokrError('BOOT_TIMEOUT', `storybook did not become ready within ${opts.timeoutMs} ms`, opts.log.tail(50));
      }
      await new Promise((r) => setTimeout(r, poll));
    }
  } finally {
    off();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/readiness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/readiness.ts apps/storybrokr/src/lib/readiness.test.ts
git commit -m "feat(storybrokr): readiness detection and story index parsing"
```

---

### Task 10: The registry

**Files:**
- Create: `apps/storybrokr/src/server/registry.ts`
- Test: `apps/storybrokr/src/server/registry.test.ts`

**Interfaces:**
- Consumes: `InstanceRecord`, `DaemonConfig` (Task 2), `stateFile` (Task 3), `StorybrokrError` (Task 2).
- Produces: `class Registry` with
  - `constructor(opts: { home: string; config: DaemonConfig; now?: () => Date })`
  - `list(): InstanceRecord[]`, `get(id: string): InstanceRecord | undefined`, `find(hostRoot, component): InstanceRecord | undefined`, `resolve(idOrPath: string, hostRoot?: string): InstanceRecord` (throws `INSTANCE_NOT_FOUND`)
  - `add(record): void` (throws `INSTANCE_CAP_REACHED` when `status ∈ {starting, ready}` count ≥ cap), `update(id, patch: Partial<InstanceRecord>): InstanceRecord`, `remove(id): void`, `touch(id): void`
  - `portsInUse(): Set<number>`, `idleInstances(): InstanceRecord[]` (ready, ttl > 0, idle longer than ttl)
  - `load(): void` / `save(): void` (JSON at `stateFile(home)`, atomic write via temp file + rename)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/registry.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import type { InstanceRecord } from '../types.js';
import { DEFAULT_CONFIG } from './config.js';
import { Registry } from './registry.js';

function rec(id: string, extra: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    id,
    hostRoot: '/h',
    component: `src/${id}`,
    framework: 'x',
    port: 6100,
    url: 'http://127.0.0.1:6100',
    pid: 1,
    status: 'ready',
    createdAt: '2026-09-06T00:00:00.000Z',
    lastTouchedAt: '2026-09-06T00:00:00.000Z',
    ttlMinutes: 30,
    storyFiles: [],
    stories: [],
    configDir: `/h/node_modules/.cache/storybrokr/${id}`,
    ...extra,
  };
}

describe('Registry', () => {
  const homes: string[] = [];
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'sb-reg-'));
    homes.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('adds, finds by host+component, resolves by id or path, and persists atomically', () => {
    const h = home();
    const reg = new Registry({ home: h, config: DEFAULT_CONFIG });
    reg.add(rec('a1'));
    expect(reg.find('/h', 'src/a1')?.id).toBe('a1');
    expect(reg.resolve('a1').id).toBe('a1');
    expect(reg.resolve('src/a1', '/h').id).toBe('a1');
    expect(() => reg.resolve('zzz')).toThrow(StorybrokrError);
    expect(existsSync(join(h, 'state.json'))).toBe(true);
    const again = new Registry({ home: h, config: DEFAULT_CONFIG });
    again.load();
    expect(again.list().map((r) => r.id)).toEqual(['a1']);
    expect(JSON.parse(readFileSync(join(h, 'state.json'), 'utf8')).instances).toHaveLength(1);
  });

  it('enforces the instance cap over starting+ready only', () => {
    const reg = new Registry({ home: home(), config: { ...DEFAULT_CONFIG, instanceCap: 2 } });
    reg.add(rec('a'));
    reg.add(rec('b', { status: 'starting', port: 6101 }));
    reg.add(rec('c', { status: 'failed', port: 6102 }));
    expect(() => reg.add(rec('d', { port: 6103 }))).toThrow(/INSTANCE_CAP_REACHED|cap/);
  });

  it('reports ports in use and idle instances relative to an injected clock', () => {
    let now = new Date('2026-09-06T01:00:00.000Z');
    const reg = new Registry({ home: home(), config: DEFAULT_CONFIG, now: () => now });
    reg.add(rec('a', { lastTouchedAt: '2026-09-06T00:00:00.000Z' })); // 60 min idle
    reg.add(rec('b', { port: 6101, lastTouchedAt: '2026-09-06T00:50:00.000Z' })); // 10 min idle
    reg.add(rec('c', { port: 6102, ttlMinutes: 0, lastTouchedAt: '2026-09-06T00:00:00.000Z' })); // pinned
    expect([...reg.portsInUse()].sort()).toEqual([6100, 6101, 6102]);
    expect(reg.idleInstances().map((r) => r.id)).toEqual(['a']);
    reg.touch('a');
    expect(reg.get('a')?.lastTouchedAt).toBe(now.toISOString());
    expect(reg.idleInstances()).toEqual([]);
    now = new Date('2026-09-06T03:00:00.000Z');
    expect(reg.idleInstances().map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('update merges and remove drops', () => {
    const reg = new Registry({ home: home(), config: DEFAULT_CONFIG });
    reg.add(rec('a', { status: 'starting' }));
    expect(reg.update('a', { status: 'ready', pid: 42 })).toMatchObject({ status: 'ready', pid: 42 });
    reg.remove('a');
    expect(reg.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/registry.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/registry.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StorybrokrError } from '../lib/errors.js';
import { stateFile } from '../lib/paths.js';
import type { DaemonConfig, InstanceRecord } from '../types.js';

interface StateFile {
  version: 1;
  instances: InstanceRecord[];
}

export interface RegistryOptions {
  home: string;
  config: DaemonConfig;
  now?: () => Date;
}

const ACTIVE = new Set(['starting', 'ready']);

export class Registry {
  private readonly byId = new Map<string, InstanceRecord>();
  private readonly file: string;
  private readonly config: DaemonConfig;
  private readonly now: () => Date;

  constructor(opts: RegistryOptions) {
    this.file = stateFile(opts.home);
    this.config = opts.config;
    this.now = opts.now ?? (() => new Date());
  }

  list(): InstanceRecord[] {
    return [...this.byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): InstanceRecord | undefined {
    return this.byId.get(id);
  }

  find(hostRoot: string, component: string): InstanceRecord | undefined {
    return this.list().find((r) => r.hostRoot === hostRoot && r.component === component);
  }

  /** Accepts an instance id, or a component path (optionally scoped to a host). */
  resolve(idOrPath: string, hostRoot?: string): InstanceRecord {
    const byId = this.byId.get(idOrPath);
    if (byId) return byId;
    const byPath = this.list().find(
      (r) => r.component === idOrPath && (hostRoot === undefined || r.hostRoot === hostRoot),
    );
    if (byPath) return byPath;
    throw new StorybrokrError('INSTANCE_NOT_FOUND', `no instance matches ${idOrPath}`);
  }

  add(record: InstanceRecord): void {
    const active = this.list().filter((r) => ACTIVE.has(r.status)).length;
    if (ACTIVE.has(record.status) && active >= this.config.instanceCap) {
      throw new StorybrokrError(
        'INSTANCE_CAP_REACHED',
        `instance cap of ${this.config.instanceCap} reached; run \`storybrokr down\` on one first`,
      );
    }
    this.byId.set(record.id, record);
    this.save();
  }

  update(id: string, patch: Partial<InstanceRecord>): InstanceRecord {
    const current = this.byId.get(id);
    if (!current) throw new StorybrokrError('INSTANCE_NOT_FOUND', `no instance ${id}`);
    const next = { ...current, ...patch };
    this.byId.set(id, next);
    this.save();
    return next;
  }

  remove(id: string): void {
    this.byId.delete(id);
    this.save();
  }

  touch(id: string): void {
    this.update(id, { lastTouchedAt: this.now().toISOString() });
  }

  portsInUse(): Set<number> {
    return new Set(this.list().filter((r) => ACTIVE.has(r.status)).map((r) => r.port));
  }

  /** Ready instances whose TTL is set and whose idle time exceeds it. */
  idleInstances(): InstanceRecord[] {
    const nowMs = this.now().getTime();
    return this.list().filter(
      (r) => r.status === 'ready' && r.ttlMinutes > 0 && nowMs - Date.parse(r.lastTouchedAt) > r.ttlMinutes * 60_000,
    );
  }

  load(): void {
    if (!existsSync(this.file)) return;
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StateFile;
    this.byId.clear();
    for (const r of parsed.instances ?? []) this.byId.set(r.id, r);
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const body: StateFile = { version: 1, instances: this.list() };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/server/registry.ts apps/storybrokr/src/server/registry.test.ts
git commit -m "feat(storybrokr): instance registry with cap, idle detection, and atomic persistence"
```

---

### Task 11: The broker (up / down / touch / reconcile / reap)

**Files:**
- Create: `apps/storybrokr/src/server/broker.ts`
- Test: `apps/storybrokr/src/server/broker.test.ts`

**Interfaces:**
- Consumes: `Registry` (Task 10), `Spawner`/`SpawnedProcess` (Task 8), `waitForReady`/`fetchStories` (Task 9), `discoverStories` (Task 5), `generateConfigDir`/`writeSidecar`/`readSidecars`/`removeConfigDir`/`instanceId` (Task 6), `findFreePort` (Task 7), `inspectHost`/`resolveHost` (Task 4), types (Task 2).
- Produces: `class Broker` with
  - `constructor(opts: { registry: Registry; spawner: Spawner; config: DaemonConfig; now?: () => Date; inspect?: typeof inspectHost })`
  - `up(req: UpRequest): Promise<InstanceRecord>` — full §6 flow; returns existing `ready`/`starting` match (touched) without spawning
  - `down(id: string): Promise<void>`, `downAll(): Promise<void>`, `touch(id)`, `get(id)`, `list()`, `logs(id, tail): string[]`, `logStream(id): LogBuffer | undefined`
  - `reconcile(): Promise<void>` — on daemon start: adopt live PIDs whose `/index.json` answers, drop the rest (config dirs removed)
  - `reapIdle(): Promise<InstanceRecord[]>` — stops idle instances, returns them
  - `inspectHost(path: string): HostInfo`
  - `wasCreated: boolean` on the returned record is NOT stored; `up` returns `{ record, created }` so the HTTP layer can pick 201 vs 200: signature is `up(req): Promise<{ record: InstanceRecord; created: boolean }>`.

The unit test drives the broker with the `commandSpawner` from Task 8 running a tiny fake Storybook: a Node one-liner that serves `/index.json` on the requested port and prints the `Local:` banner. That exercises spawn, readiness, index parsing, dedupe, down, and reap without Storybook.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/broker.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandSpawner, type Spawner } from '../lib/spawn.js';
import type { HostInfo } from '../types.js';
import { Broker } from './broker.js';
import { DEFAULT_CONFIG } from './config.js';
import { Registry } from './registry.js';

/** A fake host with one component that imports a child; both have stories. */
function fakeHost(): string {
  const root = mkdtempSync(join(tmpdir(), 'sb-broker-'));
  mkdirSync(join(root, '.storybook'));
  writeFileSync(join(root, '.storybook', 'main.ts'), "export default { framework: '@storybook/react-vite', stories: [] };\n");
  writeFileSync(join(root, '.storybook', 'preview.ts'), 'export default {};\n');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.bin', 'storybook'), '');
  mkdirSync(join(root, 'src', 'Button'), { recursive: true });
  writeFileSync(join(root, 'src', 'Button', 'Button.tsx'), "import '../Icon/Icon';\nexport const Button = 1;\n");
  writeFileSync(join(root, 'src', 'Button', 'Button.stories.tsx'), '');
  mkdirSync(join(root, 'src', 'Icon'));
  writeFileSync(join(root, 'src', 'Icon', 'Icon.tsx'), 'export const Icon = 1;\n');
  writeFileSync(join(root, 'src', 'Icon', 'Icon.stories.tsx'), '');
  return root;
}

/** Fake storybook: reads PORT from argv via the spawner's args, serves index.json, prints the banner. */
const FAKE_SB = `
const http = require('node:http');
const port = Number(process.env.SB_PORT);
http.createServer((req, res) => {
  if (req.url === '/index.json') { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({ v: 5, entries: { 'button--primary': { id: 'button--primary', type: 'story', title: 'Button', name: 'Primary', importPath: './src/Button/Button.stories.tsx' } } })); }
  else { res.writeHead(200); res.end('<html></html>'); }
}).listen(port, '127.0.0.1', () => console.log('  - Local:   http://localhost:' + port + '/'));
setInterval(() => {}, 1000);
`;

/** Wraps commandSpawner so the fake gets its port through SB_PORT. */
function fakeSpawner(): Spawner {
  return {
    spawn(host: HostInfo, configDir: string, port: number) {
      const inner = commandSpawner(process.execPath, ['-e', FAKE_SB]);
      process.env.SB_PORT = String(port);
      return inner.spawn(host, configDir, port);
    },
  };
}

describe('Broker', () => {
  const dirs: string[] = [];
  const brokers: Broker[] = [];
  afterEach(async () => {
    for (const b of brokers) await b.downAll();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    brokers.length = 0;
  });

  function make(configOverrides = {}, now: () => Date = () => new Date()) {
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = { ...DEFAULT_CONFIG, portRangeStart: 6150, portRangeEnd: 6159, readinessTimeoutMs: 10_000, ...configOverrides };
    const registry = new Registry({ home, config, now });
    const broker = new Broker({ registry, spawner: fakeSpawner(), config, now });
    brokers.push(broker);
    return { broker, registry };
  }

  it('up discovers stories, spawns, waits for readiness, and returns a ready record with story URLs', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make();
    const { record, created } = await broker.up({ component: 'src/Button', hostRoot: host });
    expect(created).toBe(true);
    expect(record.status).toBe('ready');
    expect(record.port).toBe(6150);
    expect(record.storyFiles).toEqual(['src/Button/Button.stories.tsx', 'src/Icon/Icon.stories.tsx']);
    expect(record.stories[0].iframeUrl).toBe('http://127.0.0.1:6150/iframe.html?id=button--primary&viewMode=story');
    expect(record.configDir).toBe(join(host, 'node_modules', '.cache', 'storybrokr', record.id));
  });

  it('a second up for the same component returns the same instance without spawning', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make();
    const first = await broker.up({ component: 'src/Button', hostRoot: host });
    const second = await broker.up({ component: 'src/Button', hostRoot: host });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(broker.list()).toHaveLength(1);
  });

  it('down stops the process and removes the config dir; reapIdle stops idle ones', async () => {
    const host = fakeHost();
    dirs.push(host);
    let now = new Date();
    const { broker } = make({ ttlMinutes: 1 }, () => now);
    const { record } = await broker.up({ component: 'src/Button', hostRoot: host });
    now = new Date(now.getTime() + 2 * 60_000);
    const reaped = await broker.reapIdle();
    expect(reaped.map((r) => r.id)).toEqual([record.id]);
    expect(broker.list().filter((r) => r.status === 'ready')).toEqual([]);
  });

  it('marks BOOT_FAILED with a log tail when the process dies', async () => {
    const host = fakeHost();
    dirs.push(host);
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = { ...DEFAULT_CONFIG, portRangeStart: 6160, portRangeEnd: 6161 };
    const registry = new Registry({ home, config });
    const broker = new Broker({ registry, spawner: commandSpawner(process.execPath, ['-e', 'console.error("Error: Failed to load config"); process.exit(1)']), config });
    brokers.push(broker);
    await expect(broker.up({ component: 'src/Button', hostRoot: host })).rejects.toMatchObject({ code: 'BOOT_FAILED' });
    expect(broker.list()[0]).toMatchObject({ status: 'failed', error: { code: 'BOOT_FAILED' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/broker.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/broker.ts
import { discoverStories } from '../lib/discover.js';
import { StorybrokrError, toErrorBody } from '../lib/errors.js';
import { inspectHost as defaultInspect, resolveHost } from '../lib/host.js';
import { configDirFor, generateConfigDir, instanceId, readSidecars, removeConfigDir, writeSidecar } from '../lib/instance.js';
import type { LogBuffer } from '../lib/logbuffer.js';
import { findFreePort } from '../lib/ports.js';
import { fetchStories, waitForReady } from '../lib/readiness.js';
import type { SpawnedProcess, Spawner } from '../lib/spawn.js';
import type { DaemonConfig, HostInfo, InstanceRecord, UpRequest } from '../types.js';
import type { Registry } from './registry.js';

export interface BrokerOptions {
  registry: Registry;
  spawner: Spawner;
  config: DaemonConfig;
  now?: () => Date;
  inspect?: typeof defaultInspect;
}

function isAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Broker {
  private readonly registry: Registry;
  private readonly spawner: Spawner;
  private readonly config: DaemonConfig;
  private now: () => Date;
  private readonly inspect: typeof defaultInspect;
  private readonly procs = new Map<string, SpawnedProcess>();

  constructor(opts: BrokerOptions) {
    this.registry = opts.registry;
    this.spawner = opts.spawner;
    this.config = opts.config;
    this.now = opts.now ?? (() => new Date());
    this.inspect = opts.inspect ?? defaultInspect;
  }

  list(): InstanceRecord[] {
    return this.registry.list();
  }

  get(idOrPath: string, hostRoot?: string): InstanceRecord {
    const r = this.registry.resolve(idOrPath, hostRoot);
    this.registry.touch(r.id);
    return this.registry.get(r.id) as InstanceRecord;
  }

  touch(id: string): InstanceRecord {
    this.registry.touch(this.registry.resolve(id).id);
    return this.registry.get(id) as InstanceRecord;
  }

  logs(idOrPath: string, tail = 200): string[] {
    const r = this.registry.resolve(idOrPath);
    return this.procs.get(r.id)?.log.tail(tail) ?? [];
  }

  logStream(idOrPath: string): LogBuffer | undefined {
    return this.procs.get(this.registry.resolve(idOrPath).id)?.log;
  }

  inspectHost(path: string): HostInfo {
    return resolveHost(path);
  }

  async up(req: UpRequest): Promise<{ record: InstanceRecord; created: boolean }> {
    const host = req.hostRoot ? this.inspect(req.hostRoot) : resolveHost(req.component);
    const component = req.component.replace(/\/+$/, '');
    const existing = this.registry.find(host.hostRoot, component);
    if (existing && (existing.status === 'ready' || existing.status === 'starting')) {
      this.registry.touch(existing.id);
      if (req.wait !== false && existing.status === 'starting') await this.awaitReady(existing.id);
      return { record: this.registry.get(existing.id) as InstanceRecord, created: false };
    }
    if (existing) this.registry.remove(existing.id);

    const discovery = discoverStories(host.hostRoot, component, host.tsconfigPaths);
    const id = instanceId(host.hostRoot, component);
    const port = await findFreePort(this.config.portRangeStart, this.config.portRangeEnd, this.registry.portsInUse());
    const configDir = generateConfigDir(host, id, discovery.storyFiles);
    const nowIso = this.now().toISOString();
    const record: InstanceRecord = {
      id,
      hostRoot: host.hostRoot,
      component,
      framework: host.framework,
      port,
      url: `http://127.0.0.1:${port}`,
      pid: null,
      status: 'starting',
      createdAt: nowIso,
      lastTouchedAt: nowIso,
      ttlMinutes: req.ttlMinutes ?? this.config.ttlMinutes,
      storyFiles: discovery.storyFiles,
      stories: [],
      configDir,
    };
    this.registry.add(record);
    writeSidecar(configDir, record);

    const proc = this.spawner.spawn(host, configDir, port);
    this.procs.set(id, proc);
    this.registry.update(id, { pid: proc.pid });
    proc.exited.then((code) => {
      const current = this.registry.get(id);
      if (current && current.status === 'ready') {
        this.registry.update(id, { status: 'failed', exitCode: code, error: { code: 'BOOT_FAILED', message: `storybook exited with code ${code}` } });
      }
    });

    const readiness = this.watchReadiness(id, proc);
    if (req.wait === false) return { record: this.registry.get(id) as InstanceRecord, created: true };
    await readiness;
    return { record: this.registry.get(id) as InstanceRecord, created: true };
  }

  private readonly pending = new Map<string, Promise<void>>();

  private watchReadiness(id: string, proc: SpawnedProcess): Promise<void> {
    const record = this.registry.get(id) as InstanceRecord;
    const p = waitForReady({ port: record.port, log: proc.log, exited: proc.exited, timeoutMs: this.config.readinessTimeoutMs })
      .then((stories) => {
        const updated = this.registry.update(id, { status: 'ready', stories, lastTouchedAt: this.now().toISOString() });
        writeSidecar(record.configDir, updated);
      })
      .catch((err: unknown) => {
        const body = toErrorBody(err);
        this.registry.update(id, { status: 'failed', error: body });
        void proc.kill();
        throw err;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  private async awaitReady(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (p) await p;
  }

  async down(idOrPath: string): Promise<void> {
    const r = this.registry.resolve(idOrPath);
    await this.stop(r);
  }

  async downAll(): Promise<void> {
    for (const r of this.registry.list()) await this.stop(r);
  }

  private async stop(r: InstanceRecord): Promise<void> {
    const proc = this.procs.get(r.id);
    if (proc) await proc.kill();
    else if (isAlive(r.pid)) {
      try {
        process.kill(r.pid as number, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    this.procs.delete(r.id);
    this.registry.update(r.id, { status: 'stopped' });
    try {
      removeConfigDir(r.configDir);
    } catch {
      // the host may have been deleted; nothing to clean
    }
    this.registry.remove(r.id);
  }

  /** Stop ready instances idle past their TTL; returns what was stopped. */
  async reapIdle(): Promise<InstanceRecord[]> {
    const idle = this.registry.idleInstances();
    for (const r of idle) await this.stop(r);
    return idle;
  }

  /** On daemon start: adopt instances that are alive and answering, drop the rest. */
  async reconcile(): Promise<void> {
    this.registry.load();
    const known = new Map(this.registry.list().map((r) => [r.id, r]));
    for (const r of this.registry.list()) {
      for (const side of readSidecars(r.hostRoot)) if (!known.has(side.id)) known.set(side.id, side);
    }
    for (const r of known.values()) {
      const alive = isAlive(r.pid) && (await fetchStories(r.port)) !== null;
      if (alive) {
        if (!this.registry.get(r.id)) this.registry.add(r);
        this.registry.update(r.id, { status: 'ready' });
      } else {
        if (this.registry.get(r.id)) this.registry.remove(r.id);
        try {
          removeConfigDir(configDirFor(r.hostRoot, r.id));
        } catch {
          // nothing to clean
        }
      }
    }
  }
}

export { StorybrokrError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/broker.test.ts`
Expected: PASS (4 tests). `waitForReady` only fetches the index after the `Local:` banner, and the fake prints the banner from the `listen` callback, so there is no race.

Spec deviation, recorded: §7.1 says a stopped record lingers as `stopped` for one reaper tick. `stop()` above drops the record immediately instead: the caller of `down` receives 204 and already knows the final state, and an immediate drop keeps `ls` and the e2e assertions exact. Edit `docs/superpowers/specs/2026-09-06-storybrokr-design.md` §7.1 "Stopping" to say the record is removed as soon as the process is gone and the config dir deleted, and include that edit in this task's commit.

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/server/broker.ts apps/storybrokr/src/server/broker.test.ts
git commit -m "feat(storybrokr): broker orchestrating discover, spawn, readiness, reaping, and reconcile"
```

---

### Task 12: Daemon HTTP server and routes

**Files:**
- Create: `apps/storybrokr/src/server/routes.ts`, `apps/storybrokr/src/server/daemon.ts`, `apps/storybrokr/src/server/start.ts`
- Test: `apps/storybrokr/src/server/daemon.test.ts`

**Interfaces:**
- Consumes: `Broker` (Task 11), `Registry` (Task 10), `loadConfig` (Task 3), `paths` (Task 3), `toErrorBody`/`httpStatusFor` (Task 2), `DaemonInfo` (Task 2).
- Produces:
  - `createDaemon(opts: { home: string; broker: Broker; config: DaemonConfig; token?: string }): Daemon` where `Daemon = { start(port?: number): Promise<DaemonInfo>; stop(): Promise<void>; url: string; token: string }`. `start` binds `127.0.0.1` on `port` (0 = ephemeral), writes `daemon.json` (`{ port, token, pid, startedAt }`, mode 0600), takes `daemon.lock` (exclusive create; throws if held by a live PID), starts the reaper timer; `stop` stops all instances, clears the timer, removes `daemon.json` and `daemon.lock`.
  - Routes (all `/v1/...`, JSON, `Authorization: Bearer <token>` required except `GET /v1/health`):
    - `GET /v1/health` → `{ ok: true, version, pid, uptimeMs, instances: n }`
    - `POST /v1/instances` body `UpRequest` → 201 `{ record }` created / 200 existing
    - `GET /v1/instances` → `{ instances: InstanceRecord[] }`
    - `GET /v1/instances/:id` → `{ record }` (touches)
    - `DELETE /v1/instances/:id` → 204
    - `POST /v1/instances/:id/touch` → `{ record }`
    - `GET /v1/instances/:id/logs?tail=200` → `{ lines: string[] }`; with `?follow=1` → `text/event-stream`, one `data:` event per line, plus the current tail first
    - `POST /v1/hosts/inspect` body `{ path }` → `{ host: HostInfo }`
    - `POST /v1/shutdown` → 202 then `stop()`
    - Errors → `httpStatusFor(code)` with body `ErrorBody`; unknown routes 404 `{ code: 'NOT_FOUND' }`; missing/invalid token 401 `{ code: 'UNAUTHORIZED' }`.
  - `src/server/start.ts`: entry for the detached process — reads `STORYBROKR_HOME`, `loadConfig`, builds Registry/Broker with `storybookSpawner`, `await broker.reconcile()`, `createDaemon(...).start(process.env.STORYBROKR_PORT ? Number(...) : 0)`, handles SIGTERM/SIGINT → `stop()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/daemon.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Spawner } from '../lib/spawn.js';
import type { InstanceRecord } from '../types.js';
import { Broker } from './broker.js';
import { DEFAULT_CONFIG } from './config.js';
import { createDaemon, type Daemon } from './daemon.js';
import { Registry } from './registry.js';

const neverSpawner: Spawner = { spawn: () => { throw new Error('spawn not expected'); } };

describe('daemon', () => {
  const homes: string[] = [];
  const daemons: Daemon[] = [];
  afterEach(async () => {
    for (const d of daemons) await d.stop().catch(() => {});
    daemons.length = 0;
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  async function boot(broker?: Broker) {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const b = broker ?? new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const daemon = createDaemon({ home, broker: b, config: DEFAULT_CONFIG });
    daemons.push(daemon);
    const info = await daemon.start(0);
    return { home, daemon, info, broker: b };
  }

  it('writes daemon.json (0600) and the lock, serves health without a token, and rejects others without it', async () => {
    const { home, daemon, info } = await boot();
    expect(info.port).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'))).toMatchObject({ port: info.port, token: daemon.token });
    expect(statSync(join(home, 'daemon.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, 'daemon.lock'))).toBe(true);
    const health = await fetch(`${daemon.url}/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, instances: 0 });
    const noAuth = await fetch(`${daemon.url}/v1/instances`);
    expect(noAuth.status).toBe(401);
  });

  it('routes instances CRUD to the broker and maps error codes to statuses', async () => {
    const record = { id: 'r1', hostRoot: '/h', component: 'src/X', framework: 'x', port: 6100, url: 'http://127.0.0.1:6100', pid: 1, status: 'ready', createdAt: 'c', lastTouchedAt: 't', ttlMinutes: 30, storyFiles: [], stories: [], configDir: '/h/node_modules/.cache/storybrokr/r1' } as InstanceRecord;
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const up = vi.spyOn(broker, 'up').mockResolvedValue({ record, created: true });
    vi.spyOn(broker, 'list').mockReturnValue([record]);
    vi.spyOn(broker, 'get').mockImplementation((id) => { if (id === 'r1') return record; throw Object.assign(new Error('nope'), { code: 'INSTANCE_NOT_FOUND', status: 404 }); });
    const down = vi.spyOn(broker, 'down').mockResolvedValue();
    const { daemon } = await boot(broker);
    const h = { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' };

    const created = await fetch(`${daemon.url}/v1/instances`, { method: 'POST', headers: h, body: JSON.stringify({ component: 'src/X', hostRoot: '/h' }) });
    expect(created.status).toBe(201);
    expect(up).toHaveBeenCalledWith({ component: 'src/X', hostRoot: '/h' });
    expect(((await created.json()) as { record: InstanceRecord }).record.id).toBe('r1');

    expect((await (await fetch(`${daemon.url}/v1/instances`, { headers: h })).json()) as unknown).toEqual({ instances: [record] });
    expect((await fetch(`${daemon.url}/v1/instances/r1`, { headers: h })).status).toBe(200);
    const missing = await fetch(`${daemon.url}/v1/instances/zz`, { headers: h });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
    expect((await fetch(`${daemon.url}/v1/instances/r1`, { method: 'DELETE', headers: h })).status).toBe(204);
    expect(down).toHaveBeenCalledWith('r1');
  });

  it('refuses to start twice on the same home while the lock holder is alive', async () => {
    const { home } = await boot();
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const second = createDaemon({ home, broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }), config: DEFAULT_CONFIG });
    await expect(second.start(0)).rejects.toThrow(/already running/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/daemon.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/server/routes.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpStatusFor, toErrorBody } from '../lib/errors.js';
import type { UpRequest } from '../types.js';
import type { Broker } from './broker.js';

export interface RouteContext {
  broker: Broker;
  version: string;
  startedAt: number;
  pid: number;
  shutdown: () => void;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function sendError(res: ServerResponse, err: unknown): void {
  const body = toErrorBody(err);
  send(res, httpStatusFor(body.code), body);
}

/** Dispatches one request. Auth has already been checked by the caller. */
export async function handle(ctx: RouteContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean); // ['v1', 'instances', ':id', 'logs']
  const method = req.method ?? 'GET';
  try {
    if (parts[0] !== 'v1') return send(res, 404, { code: 'NOT_FOUND', message: 'unknown route' });

    if (method === 'GET' && parts[1] === 'health' && parts.length === 2) {
      return send(res, 200, { ok: true, version: ctx.version, pid: ctx.pid, uptimeMs: Date.now() - ctx.startedAt, instances: ctx.broker.list().length });
    }
    if (parts[1] === 'instances') {
      if (parts.length === 2 && method === 'POST') {
        const body = (await readJson(req)) as unknown as UpRequest;
        const { record, created } = await ctx.broker.up(body);
        return send(res, created ? 201 : 200, { record });
      }
      if (parts.length === 2 && method === 'GET') return send(res, 200, { instances: ctx.broker.list() });
      const id = decodeURIComponent(parts[2] ?? '');
      if (parts.length === 3 && method === 'GET') return send(res, 200, { record: ctx.broker.get(id) });
      if (parts.length === 3 && method === 'DELETE') {
        await ctx.broker.down(id);
        return send(res, 204);
      }
      if (parts.length === 4 && parts[3] === 'touch' && method === 'POST') return send(res, 200, { record: ctx.broker.touch(id) });
      if (parts.length === 4 && parts[3] === 'logs' && method === 'GET') {
        const tail = Number(url.searchParams.get('tail') ?? '200');
        if (url.searchParams.get('follow') !== '1') return send(res, 200, { lines: ctx.broker.logs(id, tail) });
        const stream = ctx.broker.logStream(id);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        for (const line of ctx.broker.logs(id, tail)) res.write(`data: ${JSON.stringify(line)}\n\n`);
        const off = stream?.onLine((line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
        req.on('close', () => off?.());
        return;
      }
    }
    if (parts[1] === 'hosts' && parts[2] === 'inspect' && method === 'POST') {
      const { path } = await readJson(req);
      return send(res, 200, { host: ctx.broker.inspectHost(String(path)) });
    }
    if (parts[1] === 'shutdown' && method === 'POST') {
      send(res, 202, { ok: true });
      setImmediate(ctx.shutdown);
      return;
    }
    return send(res, 404, { code: 'NOT_FOUND', message: `no route for ${method} ${url.pathname}` });
  } catch (err) {
    sendError(res, err);
  }
}
```

```ts
// src/server/daemon.ts
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { daemonFile, lockFile } from '../lib/paths.js';
import type { DaemonConfig, DaemonInfo } from '../types.js';
import { VERSION } from '../version.js';
import type { Broker } from './broker.js';
import { handle } from './routes.js';

export interface Daemon {
  start(port?: number): Promise<DaemonInfo>;
  stop(): Promise<void>;
  readonly url: string;
  readonly token: string;
}

export interface DaemonOptions {
  home: string;
  broker: Broker;
  config: DaemonConfig;
  token?: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Exclusive lock: creates daemon.lock with our pid; a stale lock (dead pid) is reclaimed. */
function acquireLock(home: string): void {
  const file = lockFile(home);
  mkdirSync(home, { recursive: true });
  if (existsSync(file)) {
    const other = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(other) && other !== process.pid && pidAlive(other)) {
      throw new Error(`storybrokr daemon already running (pid ${other}) for ${home}`);
    }
    rmSync(file, { force: true });
  }
  const fd = openSync(file, 'wx');
  writeFileSync(fd, String(process.pid));
}

export function createDaemon(opts: DaemonOptions): Daemon {
  const token = opts.token ?? randomBytes(24).toString('hex');
  let server: Server | null = null;
  let url = '';
  let reaper: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  const stop = async (): Promise<void> => {
    if (reaper) clearInterval(reaper);
    reaper = null;
    await opts.broker.downAll();
    if (server) await new Promise<void>((r) => server?.close(() => r()));
    server = null;
    rmSync(daemonFile(opts.home), { force: true });
    rmSync(lockFile(opts.home), { force: true });
  };

  return {
    get url() {
      return url;
    },
    token,
    async start(port = 0) {
      acquireLock(opts.home);
      const ctx = { broker: opts.broker, version: VERSION, startedAt, pid: process.pid, shutdown: () => void stop() };
      server = createServer((req, res) => {
        const isHealth = req.url === '/v1/health';
        const auth = req.headers.authorization ?? '';
        if (!isHealth && auth !== `Bearer ${token}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'missing or invalid bearer token' }));
          return;
        }
        void handle(ctx, req, res);
      });
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, '127.0.0.1', () => resolve());
      });
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      url = `http://127.0.0.1:${boundPort}`;
      const info: DaemonInfo = { port: boundPort, token, pid: process.pid, startedAt: new Date(startedAt).toISOString() };
      writeFileSync(daemonFile(opts.home), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
      reaper = setInterval(() => void opts.broker.reapIdle(), opts.config.reaperIntervalMs);
      reaper.unref();
      return info;
    },
    stop,
  };
}
```

```ts
// src/server/start.ts — entry of the detached daemon process
import { homeDir } from '../lib/paths.js';
import { storybookSpawner } from '../lib/spawn.js';
import { Broker } from './broker.js';
import { loadConfig } from './config.js';
import { createDaemon } from './daemon.js';
import { Registry } from './registry.js';

const home = homeDir();
const config = loadConfig(home);
const registry = new Registry({ home, config });
const broker = new Broker({ registry, spawner: storybookSpawner, config });
await broker.reconcile();
const daemon = createDaemon({ home, broker, config });
const info = await daemon.start(process.env.STORYBROKR_PORT ? Number(process.env.STORYBROKR_PORT) : 0);
console.log(`storybrokr daemon listening on http://127.0.0.1:${info.port} (pid ${info.pid})`);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void daemon.stop().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/daemon.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/server/routes.ts apps/storybrokr/src/server/daemon.ts apps/storybrokr/src/server/start.ts apps/storybrokr/src/server/daemon.test.ts
git commit -m "feat(storybrokr): loopback daemon with bearer auth, JSON routes, SSE logs, and lock file"
```

---

### Task 13: Daemon client with auto-start

**Files:**
- Create: `apps/storybrokr/src/client/index.ts`
- Test: `apps/storybrokr/src/client/index.test.ts`

**Interfaces:**
- Consumes: `DaemonInfo`, `UpRequest`, `InstanceRecord`, `HostInfo` (Task 2), `paths` (Task 3), `loadConfig` (Task 3), `StorybrokrError` (Task 2).
- Produces: `class DaemonClient` with `static async connect(opts?: { home?: string; autoStart?: boolean; startCommand?: () => void }): Promise<DaemonClient>`; methods `up(req): Promise<{ record; created }>`, `list()`, `get(id)`, `down(id)`, `touch(id)`, `logs(id, tail?)`, `follow(id, onLine): Promise<() => void>`, `inspectHost(path)`, `health()`, `shutdown()`. Every non-2xx response becomes a `StorybrokrError` with the body's code. `connect` reads `daemon.json`; if unreachable and `autoStart !== false`, it runs `startCommand` (default: spawns `node dist/server/start.js` detached with `STORYBROKR_HOME`), polls `/v1/health` for `autoStartWaitMs`, then retries; failure → `DAEMON_UNAVAILABLE`.

- [ ] **Step 1: Write the failing test**

```ts
// src/client/index.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import type { Spawner } from '../lib/spawn.js';
import { Broker } from '../server/broker.js';
import { DEFAULT_CONFIG } from '../server/config.js';
import { createDaemon, type Daemon } from '../server/daemon.js';
import { Registry } from '../server/registry.js';
import { DaemonClient } from './index.js';

const neverSpawner: Spawner = { spawn: () => { throw new Error('unexpected'); } };

describe('DaemonClient', () => {
  const homes: string[] = [];
  const daemons: Daemon[] = [];
  afterEach(async () => {
    for (const d of daemons) await d.stop().catch(() => {});
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('connects via daemon.json, sends the token, and maps error bodies to StorybrokrError', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const daemon = createDaemon({ home, broker, config: DEFAULT_CONFIG });
    daemons.push(daemon);
    await daemon.start(0);
    const client = await DaemonClient.connect({ home, autoStart: false });
    expect((await client.health()).ok).toBe(true);
    expect(await client.list()).toEqual([]);
    await expect(client.get('nope')).rejects.toBeInstanceOf(StorybrokrError);
    await expect(client.get('nope')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('auto-starts through the injected startCommand and then connects', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const startCommand = vi.fn(async () => {
      const registry = new Registry({ home, config: DEFAULT_CONFIG });
      const daemon = createDaemon({ home, broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }), config: DEFAULT_CONFIG });
      daemons.push(daemon);
      await daemon.start(0);
    });
    const client = await DaemonClient.connect({ home, startCommand });
    expect(startCommand).toHaveBeenCalledTimes(1);
    expect((await client.health()).ok).toBe(true);
  });

  it('fails with DAEMON_UNAVAILABLE when auto-start is off and nothing is listening', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    await expect(DaemonClient.connect({ home, autoStart: false })).rejects.toMatchObject({ code: 'DAEMON_UNAVAILABLE' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/client/index.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/client/index.ts
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ErrorBody, StorybrokrError } from '../lib/errors.js';
import { daemonFile, homeDir } from '../lib/paths.js';
import { loadConfig } from '../server/config.js';
import type { DaemonInfo, HostInfo, InstanceRecord, UpRequest } from '../types.js';

export interface ConnectOptions {
  home?: string;
  autoStart?: boolean;
  startCommand?: () => void | Promise<void>;
}

function readInfo(home: string): DaemonInfo | null {
  const file = daemonFile(home);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

async function healthy(info: DaemonInfo | null): Promise<boolean> {
  if (!info) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Default auto-start: run the built daemon entry detached, inheriting STORYBROKR_HOME. */
function spawnDetachedDaemon(home: string): void {
  const entry = join(dirname(fileURLToPath(import.meta.url)), 'server', 'start.js');
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, STORYBROKR_HOME: home },
  });
  child.unref();
}

export class DaemonClient {
  private constructor(
    readonly home: string,
    private info: DaemonInfo,
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.info.port}`;
  }

  static async connect(opts: ConnectOptions = {}): Promise<DaemonClient> {
    const home = opts.home ?? homeDir();
    let info = readInfo(home);
    if (await healthy(info)) return new DaemonClient(home, info as DaemonInfo);
    if (opts.autoStart === false) {
      throw new StorybrokrError('DAEMON_UNAVAILABLE', `no storybrokr daemon is listening for ${home}`);
    }
    await (opts.startCommand ?? (() => spawnDetachedDaemon(home)))();
    const deadline = Date.now() + loadConfig(home).autoStartWaitMs;
    while (Date.now() < deadline) {
      info = readInfo(home);
      if (await healthy(info)) return new DaemonClient(home, info as DaemonInfo);
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new StorybrokrError('DAEMON_UNAVAILABLE', `storybrokr daemon did not come up for ${home}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.info.token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new StorybrokrError('DAEMON_UNAVAILABLE', `daemon at ${this.url} is not answering: ${(err as Error).message}`);
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as T | ErrorBody;
    if (!res.ok) {
      const e = json as ErrorBody;
      throw new StorybrokrError(e.code ?? 'INTERNAL', e.message ?? `HTTP ${res.status}`, e.logTail);
    }
    return json as T;
  }

  health() {
    return this.request<{ ok: boolean; version: string; pid: number; uptimeMs: number; instances: number }>('GET', '/v1/health');
  }
  async up(req: UpRequest): Promise<{ record: InstanceRecord; created: boolean }> {
    const res = await fetch(`${this.url}/v1/instances`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { record: InstanceRecord } | ErrorBody;
    if (!res.ok) {
      const e = json as ErrorBody;
      throw new StorybrokrError(e.code ?? 'INTERNAL', e.message ?? `HTTP ${res.status}`, e.logTail);
    }
    return { record: (json as { record: InstanceRecord }).record, created: res.status === 201 };
  }
  async list(): Promise<InstanceRecord[]> {
    return (await this.request<{ instances: InstanceRecord[] }>('GET', '/v1/instances')).instances;
  }
  async get(id: string): Promise<InstanceRecord> {
    return (await this.request<{ record: InstanceRecord }>('GET', `/v1/instances/${encodeURIComponent(id)}`)).record;
  }
  down(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/instances/${encodeURIComponent(id)}`);
  }
  async touch(id: string): Promise<InstanceRecord> {
    return (await this.request<{ record: InstanceRecord }>('POST', `/v1/instances/${encodeURIComponent(id)}/touch`)).record;
  }
  async logs(id: string, tail = 200): Promise<string[]> {
    return (await this.request<{ lines: string[] }>('GET', `/v1/instances/${encodeURIComponent(id)}/logs?tail=${tail}`)).lines;
  }
  /** Streams log lines via SSE; resolves with a function that closes the stream. */
  async follow(id: string, onLine: (line: string) => void): Promise<() => void> {
    const controller = new AbortController();
    const res = await fetch(`${this.url}/v1/instances/${encodeURIComponent(id)}/logs?follow=1`, {
      headers: { authorization: `Bearer ${this.info.token}` },
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    void (async () => {
      let buf = '';
      const dec = new TextDecoder();
      while (reader) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith('data: ')) onLine(JSON.parse(frame.slice(6)) as string);
        }
      }
    })();
    return () => controller.abort();
  }
  async inspectHost(path: string): Promise<HostInfo> {
    return (await this.request<{ host: HostInfo }>('POST', '/v1/hosts/inspect', { path })).host;
  }
  shutdown(): Promise<void> {
    return this.request<void>('POST', '/v1/shutdown').then(() => undefined);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/client/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/client/index.ts apps/storybrokr/src/client/index.test.ts
git commit -m "feat(storybrokr): daemon client with token auth, SSE follow, and auto-start"
```

---

### Task 14: CLI commands and output formatting

**Files:**
- Create: `apps/storybrokr/src/commands/_shared/output.ts`, `apps/storybrokr/src/commands/up.ts`, `ls.ts`, `get.ts`, `down.ts`, `open.ts`, `logs.ts`, `touch.ts`, `doctor.ts`, `daemon.ts`, `mcp.ts`
- Modify: `apps/storybrokr/src/cli.ts` (register every command)
- Test: `apps/storybrokr/src/commands/_shared/output.test.ts`, `apps/storybrokr/src/commands/up.test.ts`

**Interfaces:**
- Consumes: `DaemonClient` (Task 13), `StorybrokrError`/`toErrorBody` (Task 2), `InstanceRecord` (Task 2).
- Produces:
  - `output.ts`: `printJson(value)`, `printInstanceTable(records: InstanceRecord[])`, `printInstance(record)` (URL, status, framework, story count, then one line per story: `id  iframeUrl`), `fail(err: unknown, json: boolean): never` (prints message or JSON body to stderr, exits 1), `resolveComponent(pathArg: string): { component: string; hostRoot: string }` (turns the user's path into a host-relative component path by walking up with `findHostRoot`).
  - Every command file exports `register<Name>(program: Command, connect: () => Promise<DaemonClient>)` and a pure `run<Name>(client, opts)` action so tests drive the action with a fake client.
  - `src/mcp.ts` command: `registerMcp(program)` runs `runStdio()` from Task 15 (no daemon connect up front; the MCP server connects lazily per tool call).
  - `src/commands/daemon.ts`: `daemon start` (foreground: same as `server/start.ts` but in-process), `daemon stop` (client.shutdown), `daemon status` (health or "not running").

- [ ] **Step 1: Write the failing tests**

```ts
// src/commands/_shared/output.test.ts
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstanceRecord } from '../../types.js';
import { printInstance, printInstanceTable, resolveComponent } from './output.js';

const rec: InstanceRecord = {
  id: 'abc', hostRoot: '/h', component: 'src/Button', framework: '@storybook/react-vite', port: 6100, url: 'http://127.0.0.1:6100', pid: 1, status: 'ready',
  createdAt: 'c', lastTouchedAt: 't', ttlMinutes: 30, storyFiles: ['src/Button/Button.stories.tsx'],
  stories: [{ id: 'button--primary', title: 'Button', name: 'Primary', importPath: './src/Button/Button.stories.tsx', url: 'http://127.0.0.1:6100/?path=/story/button--primary', iframeUrl: 'http://127.0.0.1:6100/iframe.html?id=button--primary&viewMode=story' }],
  configDir: '/h/node_modules/.cache/storybrokr/abc',
};

describe('output', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('prints a table row per instance and a detail block with one line per story', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstanceTable([rec]);
    const table = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(table).toMatch(/abc/);
    expect(table).toMatch(/src\/Button/);
    expect(table).toMatch(/ready/);
    log.mockClear();
    printInstance(rec);
    const detail = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(detail).toContain('http://127.0.0.1:6100');
    expect(detail).toContain('button--primary');
    expect(detail).toContain('iframe.html?id=button--primary');
  });

  it('resolveComponent turns any path into a host-relative component', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-out-'));
    dirs.push(root);
    mkdirSync(join(root, '.storybook'));
    mkdirSync(join(root, 'src', 'Button'), { recursive: true });
    expect(resolveComponent(join(root, 'src', 'Button'))).toEqual({ component: 'src/Button', hostRoot: root });
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'src'));
    expect(resolveComponent('Button')).toEqual({ component: 'src/Button', hostRoot: root });
    cwd.mockRestore();
  });
});
```

```ts
// src/commands/up.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { runUp } from './up.js';

const rec = { id: 'abc', status: 'ready', url: 'http://127.0.0.1:6100', stories: [], storyFiles: [], component: 'src/Button', hostRoot: '/h' } as unknown as InstanceRecord;

describe('runUp', () => {
  it('sends component + hostRoot + ttl + wait to the client and returns the record', async () => {
    const up = vi.fn(async () => ({ record: rec, created: true }));
    const client = { up } as unknown as DaemonClient;
    const out = await runUp(client, { component: 'src/Button', hostRoot: '/h', ttl: 5, wait: false });
    expect(up).toHaveBeenCalledWith({ component: 'src/Button', hostRoot: '/h', ttlMinutes: 5, wait: false });
    expect(out).toEqual({ record: rec, created: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/commands`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/commands/_shared/output.ts
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { StorybrokrError, toErrorBody } from '../../lib/errors.js';
import { findHostRoot } from '../../lib/host.js';
import type { InstanceRecord } from '../../types.js';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const STATUS_COLOR: Record<InstanceRecord['status'], (s: string) => string> = {
  starting: chalk.yellow,
  ready: chalk.green,
  failed: chalk.red,
  stopped: chalk.gray,
};

export function printInstanceTable(records: InstanceRecord[]): void {
  if (records.length === 0) {
    console.log(chalk.gray('no instances'));
    return;
  }
  const rows = records.map((r) => [r.id, STATUS_COLOR[r.status](r.status.padEnd(8)), String(r.port), r.component, chalk.gray(r.hostRoot)]);
  const widths = [12, 8, 5, Math.max(...rows.map((r) => r[3].length))];
  console.log(chalk.bold(['ID'.padEnd(widths[0]), 'STATUS'.padEnd(widths[1]), 'PORT'.padEnd(widths[2]), 'COMPONENT'.padEnd(widths[3]), 'HOST'].join('  ')));
  for (const r of rows) console.log([r[0].padEnd(widths[0]), r[1], r[2].padEnd(widths[2]), r[3].padEnd(widths[3]), r[4]].join('  '));
}

export function printInstance(r: InstanceRecord): void {
  console.log(`${chalk.bold(r.id)}  ${STATUS_COLOR[r.status](r.status)}  ${r.framework}`);
  console.log(`  url        ${chalk.cyan(r.url)}`);
  console.log(`  component  ${r.component}  (${r.hostRoot})`);
  console.log(`  stories    ${r.stories.length} from ${r.storyFiles.length} files`);
  for (const s of r.stories) console.log(`    ${s.id.padEnd(48)} ${chalk.gray(s.iframeUrl)}`);
  if (r.error) {
    console.log(chalk.red(`  error      ${r.error.code}: ${r.error.message}`));
    for (const line of r.error.logTail ?? []) console.log(chalk.gray(`    ${line}`));
  }
}

export function fail(err: unknown, json: boolean): never {
  const body = toErrorBody(err);
  if (json) console.error(JSON.stringify(body));
  else {
    console.error(chalk.red(`${body.code}: ${body.message}`));
    for (const line of body.logTail ?? []) console.error(chalk.gray(`  ${line}`));
  }
  process.exit(1);
}

/** User path (absolute, cwd-relative, or host-relative) → host root + host-relative component. */
export function resolveComponent(pathArg: string): { component: string; hostRoot: string } {
  const abs = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const start = existsSync(abs) ? abs : dirname(abs);
  const hostRoot = findHostRoot(start);
  if (!hostRoot) throw new StorybrokrError('HOST_NOT_FOUND', `no .storybook/ directory above ${abs}`);
  return { component: relative(hostRoot, abs).split('\\').join('/'), hostRoot };
}
```

```ts
// src/commands/up.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { fail, printInstance, printJson, resolveComponent } from './_shared/output.js';

export interface UpOptions {
  component: string;
  hostRoot?: string;
  ttl?: number;
  wait?: boolean;
}

export async function runUp(client: DaemonClient, opts: UpOptions): Promise<{ record: InstanceRecord; created: boolean }> {
  return client.up({ component: opts.component, hostRoot: opts.hostRoot, ttlMinutes: opts.ttl, wait: opts.wait !== false });
}

export function registerUp(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('up <path>')
    .description('Boot (or reuse) a single-component Storybook for the component at <path>')
    .option('--host <dir>', 'host repo root (default: walk up from <path> to the nearest .storybook/)')
    .option('--ttl <minutes>', 'idle minutes before the instance is reaped; 0 = never', (v) => Number(v))
    .option('--no-wait', 'return as soon as the instance is registered instead of waiting for ready')
    .option('--json', 'print the instance record as JSON')
    .action(async (path: string, o: { host?: string; ttl?: number; wait: boolean; json?: boolean }) => {
      try {
        const target = o.host ? { component: path.replace(/\/+$/, ''), hostRoot: o.host } : resolveComponent(path);
        const client = await connect();
        const { record } = await runUp(client, { ...target, ttl: o.ttl, wait: o.wait });
        if (o.json) printJson(record);
        else printInstance(record);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

```ts
// src/commands/ls.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, printInstanceTable, printJson } from './_shared/output.js';

export function registerLs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('ls')
    .description('List brokered instances')
    .option('--json', 'print JSON')
    .action(async (o: { json?: boolean }) => {
      try {
        const instances = await (await connect()).list();
        if (o.json) printJson(instances);
        else printInstanceTable(instances);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

```ts
// src/commands/get.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, printInstance, printJson } from './_shared/output.js';

export function registerGet(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('get <id-or-path>')
    .description('Show one instance, including its story URLs')
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, o: { json?: boolean }) => {
      try {
        const record = await (await connect()).get(idOrPath);
        if (o.json) printJson(record);
        else printInstance(record);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

```ts
// src/commands/down.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerDown(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('down [id-or-path]')
    .description('Stop an instance and remove its config dir')
    .option('--all', 'stop every instance')
    .action(async (idOrPath: string | undefined, o: { all?: boolean }) => {
      try {
        const client = await connect();
        const targets = o.all ? (await client.list()).map((r) => r.id) : idOrPath ? [idOrPath] : [];
        if (targets.length === 0) throw new Error('give an instance id/path or --all');
        for (const t of targets) await client.down(t);
        console.log(`stopped ${targets.length} instance${targets.length === 1 ? '' : 's'}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
```

```ts
// src/commands/open.ts
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

export function registerOpen(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('open <id-or-path>')
    .description('Open an instance in the browser')
    .option('--story <id>', 'open one story instead of the manager')
    .action(async (idOrPath: string, o: { story?: string }) => {
      try {
        const record = await (await connect()).get(idOrPath);
        const story = o.story ? record.stories.find((s) => s.id === o.story) : undefined;
        if (o.story && !story) throw new Error(`no story ${o.story} in ${record.id}`);
        const url = story ? story.url : record.url;
        console.log(url);
        openUrl(url);
      } catch (err) {
        fail(err, false);
      }
    });
}
```

```ts
// src/commands/logs.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerLogs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('logs <id-or-path>')
    .description("Show an instance's Storybook output")
    .option('--tail <n>', 'lines to show', (v) => Number(v), 200)
    .option('--follow', 'keep streaming new lines')
    .action(async (idOrPath: string, o: { tail: number; follow?: boolean }) => {
      try {
        const client = await connect();
        const record = await client.get(idOrPath);
        for (const line of await client.logs(record.id, o.tail)) console.log(line);
        if (o.follow) {
          const stop = await client.follow(record.id, (line) => console.log(line));
          process.on('SIGINT', () => {
            stop();
            process.exit(0);
          });
          await new Promise(() => {});
        }
      } catch (err) {
        fail(err, false);
      }
    });
}
```

```ts
// src/commands/touch.ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerTouch(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('touch <id-or-path>')
    .description("Reset an instance's idle timer")
    .action(async (idOrPath: string) => {
      try {
        const r = await (await connect()).touch(idOrPath);
        console.log(`${r.id} touched at ${r.lastTouchedAt}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
```

```ts
// src/commands/doctor.ts
import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveHost } from '../lib/host.js';
import { fail, printJson } from './_shared/output.js';

/** Runs in-process (no daemon) so it works even when the daemon cannot start. */
export function registerDoctor(program: Command): void {
  program
    .command('doctor [path]')
    .description('Check that a host repo can be brokered: .storybook, storybook binary, framework, tsconfig paths')
    .option('--json', 'print JSON')
    .action((path: string | undefined, o: { json?: boolean }) => {
      try {
        const host = resolveHost(path ?? process.cwd());
        if (o.json) return printJson(host);
        console.log(`${chalk.green('ok')}  host       ${host.hostRoot}`);
        console.log(`${chalk.green('ok')}  main       ${host.mainFile}`);
        console.log(`${host.previewFile ? chalk.green('ok') : chalk.yellow('--')}  preview    ${host.previewFile ?? 'none'}`);
        console.log(`${chalk.green('ok')}  storybook  ${host.storybookVersion} (${host.storybookBin})`);
        console.log(`${host.framework === 'unknown' ? chalk.yellow('??') : chalk.green('ok')}  framework  ${host.framework}`);
        console.log(`${chalk.green('ok')}  aliases    ${Object.keys(host.tsconfigPaths).join(', ') || 'none'}`);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

```ts
// src/commands/daemon.ts
import type { Command } from 'commander';
import { DaemonClient } from '../client/index.js';
import { homeDir } from '../lib/paths.js';
import { storybookSpawner } from '../lib/spawn.js';
import { Broker } from '../server/broker.js';
import { loadConfig } from '../server/config.js';
import { createDaemon } from '../server/daemon.js';
import { Registry } from '../server/registry.js';
import { fail } from './_shared/output.js';

export function registerDaemon(program: Command): void {
  const cmd = program.command('daemon').description('Manage the broker daemon');
  cmd
    .command('start')
    .description('Run the daemon in the foreground')
    .option('--port <n>', 'listen port (default: ephemeral, recorded in daemon.json)', (v) => Number(v), 0)
    .action(async (o: { port: number }) => {
      try {
        const home = homeDir();
        const config = loadConfig(home);
        const registry = new Registry({ home, config });
        const broker = new Broker({ registry, spawner: storybookSpawner, config });
        await broker.reconcile();
        const daemon = createDaemon({ home, broker, config });
        const info = await daemon.start(o.port);
        console.log(`storybrokr daemon listening on http://127.0.0.1:${info.port} (pid ${info.pid}, home ${home})`);
        for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => void daemon.stop().finally(() => process.exit(0)));
        await new Promise(() => {});
      } catch (err) {
        fail(err, false);
      }
    });
  cmd
    .command('stop')
    .description('Stop the daemon and every instance')
    .action(async () => {
      try {
        await (await DaemonClient.connect({ autoStart: false })).shutdown();
        console.log('daemon stopping');
      } catch (err) {
        fail(err, false);
      }
    });
  cmd
    .command('status')
    .description('Show daemon health')
    .action(async () => {
      try {
        const client = await DaemonClient.connect({ autoStart: false });
        const h = await client.health();
        console.log(`running  ${client.url}  pid ${h.pid}  up ${Math.round(h.uptimeMs / 1000)}s  instances ${h.instances}`);
      } catch {
        console.log('not running');
      }
    });
}
```

```ts
// src/commands/mcp.ts
import type { Command } from 'commander';
import { runStdio } from '../mcp/server.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Serve the MCP stdio interface (thin client of the daemon)')
    .action(async () => {
      await runStdio();
    });
}
```

```ts
// src/cli.ts (replace the Task 1 stub)
import { createCli } from '@helmsmith/cli-kit';
import { DaemonClient } from './client/index.js';
import { registerDaemon } from './commands/daemon.js';
import { registerDoctor } from './commands/doctor.js';
import { registerDown } from './commands/down.js';
import { registerGet } from './commands/get.js';
import { registerLogs } from './commands/logs.js';
import { registerLs } from './commands/ls.js';
import { registerMcp } from './commands/mcp.js';
import { registerOpen } from './commands/open.js';
import { registerTouch } from './commands/touch.js';
import { registerUp } from './commands/up.js';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'storybrokr',
  version: VERSION,
  description: 'Broker ephemeral single-component Storybook instances from an existing Storybook.',
});

const connect = () => DaemonClient.connect();

registerUp(program, connect);
registerLs(program, connect);
registerGet(program, connect);
registerDown(program, connect);
registerOpen(program, connect);
registerLogs(program, connect);
registerTouch(program, connect);
registerDoctor(program);
registerDaemon(program);
registerMcp(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 4: Run tests and a manual smoke**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/commands && pnpm --filter @helmsmith/storybrokr build && node apps/storybrokr/bin/storybrokr.mjs --help`
Expected: PASS (3 tests); help lists up, ls, get, down, open, logs, touch, doctor, daemon, mcp.

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/commands apps/storybrokr/src/cli.ts
git commit -m "feat(storybrokr): CLI commands as thin daemon clients with table and JSON output"
```

---

### Task 15: MCP stdio server

**Files:**
- Create: `apps/storybrokr/src/mcp/server.ts`
- Test: `apps/storybrokr/src/mcp/server.test.ts`

**Interfaces:**
- Consumes: `DaemonClient` (Task 13), `toErrorBody` (Task 2).
- Produces: `buildMcpServer(connect: () => Promise<DaemonClient>): McpServer` registering `storybrokr_up`, `storybrokr_list`, `storybrokr_get`, `storybrokr_down`, `storybrokr_logs`, `storybrokr_touch`, `storybrokr_inspect_host`; `runStdio(): Promise<void>` connecting it to `StdioServerTransport`. Tool results are `{ content: [{ type: 'text', text: JSON }] }`; failures set `isError: true` with the `ErrorBody` JSON. SDK 1.30: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, raw zod-shape `inputSchema` (zod 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/mcp/server.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import { StorybrokrError } from '../lib/errors.js';
import type { InstanceRecord } from '../types.js';
import { buildMcpServer } from './server.js';

const rec = { id: 'abc', status: 'ready', url: 'http://127.0.0.1:6100', stories: [], storyFiles: [], component: 'src/Button', hostRoot: '/h' } as unknown as InstanceRecord;

async function connected(fake: Partial<DaemonClient>) {
  const server = buildMcpServer(async () => fake as DaemonClient);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

describe('MCP server', () => {
  it('exposes the seven tools', async () => {
    const client = await connected({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['storybrokr_down', 'storybrokr_get', 'storybrokr_inspect_host', 'storybrokr_list', 'storybrokr_logs', 'storybrokr_touch', 'storybrokr_up']);
  });

  it('storybrokr_up forwards arguments and returns the record as JSON text', async () => {
    const up = vi.fn(async () => ({ record: rec, created: true }));
    const client = await connected({ up } as Partial<DaemonClient>);
    const result = await client.callTool({ name: 'storybrokr_up', arguments: { component: 'src/Button', hostRoot: '/h', ttlMinutes: 5 } });
    expect(up).toHaveBeenCalledWith({ component: 'src/Button', hostRoot: '/h', ttlMinutes: 5, wait: true });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ created: true, record: { id: 'abc' } });
    expect(result.isError).toBeFalsy();
  });

  it('errors come back as isError with the error body', async () => {
    const get = vi.fn(async () => { throw new StorybrokrError('INSTANCE_NOT_FOUND', 'no instance zz'); });
    const client = await connected({ get } as Partial<DaemonClient>);
    const result = await client.callTool({ name: 'storybrokr_get', arguments: { id: 'zz' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({ code: 'INSTANCE_NOT_FOUND', message: 'no instance zz' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/mcp/server.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DaemonClient } from '../client/index.js';
import { toErrorBody } from '../lib/errors.js';
import { VERSION } from '../version.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failed = (err: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(toErrorBody(err)) }], isError: true });

async function guard(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return failed(err);
  }
}

export function buildMcpServer(connect: () => Promise<DaemonClient>): McpServer {
  const server = new McpServer({ name: 'storybrokr', version: VERSION });

  server.registerTool(
    'storybrokr_up',
    {
      description:
        'Boot (or reuse) an ephemeral Storybook containing only one component and its child components, derived from the host repo\'s existing .storybook. Returns the instance with a per-story iframeUrl you can screenshot.',
      inputSchema: {
        component: z.string().describe('Story-file path or folder, relative to the host repo root (e.g. components/core/atoms/button)'),
        hostRoot: z.string().optional().describe('Host repo root; default walks up from component to the nearest .storybook/'),
        ttlMinutes: z.number().int().min(0).optional().describe('Idle minutes before reaping; 0 = never'),
        wait: z.boolean().optional().describe('Wait for readiness (default true)'),
      },
    },
    async ({ component, hostRoot, ttlMinutes, wait }) =>
      guard(async () => (await connect()).up({ component, hostRoot, ttlMinutes, wait: wait !== false })),
  );

  server.registerTool('storybrokr_list', { description: 'List brokered Storybook instances.', inputSchema: {} }, async () =>
    guard(async () => (await connect()).list()),
  );

  server.registerTool(
    'storybrokr_get',
    { description: 'Get one instance by id or component path, including its story URLs.', inputSchema: { id: z.string() } },
    async ({ id }) => guard(async () => (await connect()).get(id)),
  );

  server.registerTool(
    'storybrokr_down',
    { description: 'Stop an instance and remove its config dir.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      guard(async () => {
        await (await connect()).down(id);
        return { stopped: id };
      }),
  );

  server.registerTool(
    'storybrokr_logs',
    { description: "Tail an instance's Storybook output.", inputSchema: { id: z.string(), tail: z.number().int().min(1).max(2000).optional() } },
    async ({ id, tail }) => guard(async () => ({ lines: await (await connect()).logs(id, tail ?? 200) })),
  );

  server.registerTool(
    'storybrokr_touch',
    { description: "Reset an instance's idle timer.", inputSchema: { id: z.string() } },
    async ({ id }) => guard(async () => (await connect()).touch(id)),
  );

  server.registerTool(
    'storybrokr_inspect_host',
    { description: 'Pre-flight a host repo: .storybook presence, storybook binary/version, framework, tsconfig aliases.', inputSchema: { path: z.string() } },
    async ({ path }) => guard(async () => (await connect()).inspectHost(path)),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildMcpServer(() => DaemonClient.connect());
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/mcp/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/mcp/server.ts apps/storybrokr/src/mcp/server.test.ts
git commit -m "feat(storybrokr): MCP stdio server exposing the seven broker tools"
```

---

### Task 16: Fixture host and the e2e suite

**Files:**
- Create: `apps/storybrokr/tests/e2e/fixtures/host-react-vite/{package.json,vite.config.ts,tsconfig.json,.storybook/main.ts,.storybook/preview.ts,src/components/Button/Button.tsx,src/components/Button/Button.stories.tsx,src/components/Icon/Icon.tsx,src/components/Icon/Icon.stories.tsx,src/components/Panel/Panel.tsx,src/components/Panel/Panel.stories.tsx}`
- Create: `apps/storybrokr/tests/e2e/up-down.test.ts`, `apps/storybrokr/tests/e2e/daemon.test.ts`, `apps/storybrokr/tests/e2e/mcp.test.ts`, `apps/storybrokr/tests/e2e/external-host.test.ts`, `apps/storybrokr/tests/e2e/render.test.ts`
- Modify: `pnpm-workspace.yaml` (add the fixture glob)

**Interfaces:**
- Consumes: `helpers.ts` (Task 1: `runCli`, `runJson`, `makeHome`, `FIXTURE_HOST`, `sleep`), the built CLI, `@modelcontextprotocol/sdk` client.
- Produces: the fixture package `@helmsmith/storybrokr-fixture-react-vite` (private) whose `Panel` composes `Button` and `Icon` via a relative import and an `@ui/*` alias.

- [ ] **Step 1: Add the workspace glob**

In `pnpm-workspace.yaml` add, after `'apps/*'`:
```yaml
  # storybrokr's e2e host: a private package so pnpm installs its Storybook
  # and gives it its own node_modules/.bin/storybook. Never published.
  - 'apps/storybrokr/tests/e2e/fixtures/*'
```

- [ ] **Step 2: Create the fixture package**

```json
// tests/e2e/fixtures/host-react-vite/package.json
{
  "name": "@helmsmith/storybrokr-fixture-react-vite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Minimal react-vite Storybook host that storybrokr's e2e suite brokers. Not published.",
  "devDependencies": {
    "@storybook/react-vite": "^10.6.0",
    "@vitejs/plugin-react": "^6.1.1",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "storybook": "^10.6.0",
    "typescript": "^7.0.2",
    "vite": "^8.2.2"
  }
}
```

```ts
// tests/e2e/fixtures/host-react-vite/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react()] });
```

```json
// tests/e2e/fixtures/host-react-vite/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "types": ["node"],
    "paths": { "@ui/*": ["./src/components/*"] }
  },
  "include": ["src", ".storybook", "vite.config.ts"]
}
```

```ts
// tests/e2e/fixtures/host-react-vite/.storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  staticDirs: ['../public'],
};
export default config;
```

```ts
// tests/e2e/fixtures/host-react-vite/.storybook/preview.ts
import type { Preview } from '@storybook/react-vite';

const preview: Preview = { parameters: { layout: 'centered' } };
export default preview;
```

Create an empty `public/.gitkeep` so `staticDirs` resolves.

```tsx
// src/components/Button/Button.tsx
export function Button({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}
// src/components/Button/Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
const meta: Meta<typeof Button> = { title: 'Atoms/Button', component: Button };
export default meta;
export const Primary: StoryObj<typeof Button> = { args: { label: 'Primary' } };
export const Secondary: StoryObj<typeof Button> = { args: { label: 'Secondary' } };

// src/components/Icon/Icon.tsx
export function Icon({ name }: { name: string }) {
  return <span aria-label={name}>★</span>;
}
// src/components/Icon/Icon.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';
const meta: Meta<typeof Icon> = { title: 'Atoms/Icon', component: Icon };
export default meta;
export const Star: StoryObj<typeof Icon> = { args: { name: 'star' } };

// src/components/Panel/Panel.tsx — composes Button (relative) and Icon (alias)
import { Icon } from '@ui/Icon/Icon';
import { Button } from '../Button/Button';
export function Panel({ title }: { title: string }) {
  return (
    <section>
      <h2><Icon name="panel" /> {title}</h2>
      <Button label="Go" />
    </section>
  );
}
// src/components/Panel/Panel.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel } from './Panel';
const meta: Meta<typeof Panel> = { title: 'Organisms/Panel', component: Panel };
export default meta;
export const Default: StoryObj<typeof Panel> = { args: { title: 'Panel' } };
```

Run: `pnpm install && pnpm --filter @helmsmith/storybrokr-fixture-react-vite exec storybook --version`
Expected: install adds the fixture; the command prints `10.6.x`.

- [ ] **Step 3: Write the e2e tests (they fail until the whole CLI is wired)**

```ts
// tests/e2e/up-down.test.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

describe('storybrokr up / ls / get / logs / down against the fixture host', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('boots Panel with its Button and Icon children and reports story URLs', async () => {
    const t0 = Date.now();
    const record = await runJson<InstanceRecord>(['up', 'src/components/Panel', '--host', FIXTURE_HOST], { home });
    console.log(`fixture up ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    expect(record.status).toBe('ready');
    expect(record.storyFiles).toEqual([
      'src/components/Button/Button.stories.tsx',
      'src/components/Icon/Icon.stories.tsx',
      'src/components/Panel/Panel.stories.tsx',
    ]);
    const ids = record.stories.map((s) => s.id).sort();
    expect(ids).toEqual(['atoms-button--primary', 'atoms-button--secondary', 'atoms-icon--star', 'organisms-panel--default']);
    expect(record.stories[0].iframeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/iframe\.html\?id=.*&viewMode=story$/);
    expect(existsSync(join(record.configDir, 'main.ts'))).toBe(true);
    const iframe = await fetch(record.stories.find((s) => s.id === 'organisms-panel--default')?.iframeUrl ?? '');
    expect(iframe.status).toBe(200);
  });

  it('a second up reuses the instance; ls and get see it; logs has the banner', async () => {
    const again = await runJson<InstanceRecord>(['up', 'src/components/Panel', '--host', FIXTURE_HOST], { home });
    const list = await runJson<InstanceRecord[]>(['ls'], { home });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(again.id);
    const got = await runJson<InstanceRecord>(['get', again.id], { home });
    expect(got.stories.length).toBe(4);
    const logs = await runCli(['logs', again.id, '--tail', '500'], { home });
    expect(logs.stdout).toMatch(/Local:/);
  });

  it('down stops it and removes the config dir', async () => {
    const [rec] = await runJson<InstanceRecord[]>(['ls'], { home });
    const down = await runCli(['down', rec.id], { home });
    expect(down.code).toBe(0);
    expect(existsSync(rec.configDir)).toBe(false);
    expect(await runJson<InstanceRecord[]>(['ls'], { home })).toEqual([]);
    await expect(fetch(`${rec.url}/index.json`)).rejects.toThrow();
  });

  it('reports COMPONENT_NOT_FOUND for a path without stories', async () => {
    const r = await runCli(['up', 'src/nothing-here', '--host', FIXTURE_HOST, '--json'], { home });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr)).toMatchObject({ code: 'COMPONENT_NOT_FOUND' });
  });
});
```

```ts
// tests/e2e/daemon.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson, sleep } from './helpers.js';

describe('daemon lifecycle', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('the first command auto-starts the daemon and status reports it', async () => {
    expect((await runCli(['daemon', 'status'], { home })).stdout).toMatch(/not running/);
    await runJson<InstanceRecord[]>(['ls'], { home });
    expect((await runCli(['daemon', 'status'], { home })).stdout).toMatch(/running/);
  });

  it('a new daemon adopts a still-running instance after the old daemon is killed', async () => {
    const rec = await runJson<InstanceRecord>(['up', 'src/components/Button', '--host', FIXTURE_HOST], { home });
    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGKILL'); // daemon dies; its child Storybook keeps running (detached from the daemon's fate)
    await sleep(500);
    const list = await runJson<InstanceRecord[]>(['ls'], { home }); // auto-starts a new daemon → reconcile
    expect(list.map((r) => r.id)).toEqual([rec.id]);
    expect(list[0].status).toBe('ready');
    await runCli(['down', rec.id], { home });
  });

  it('reaps an idle instance when its ttl elapses', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ reaperIntervalMs: 500 }));
    await runCli(['daemon', 'stop'], { home });
    const rec = await runJson<InstanceRecord>(['up', 'src/components/Icon', '--host', FIXTURE_HOST, '--ttl', '0.02'], { home });
    expect(rec.status).toBe('ready');
    await sleep(3000); // ttl 0.02 min = 1.2 s, reaper every 0.5 s
    expect(await runJson<InstanceRecord[]>(['ls'], { home })).toEqual([]);
  });
});
```

Note for the adopt test: the daemon must spawn instances so they survive its own death. In `src/lib/spawn.ts` add `detached: true` to the `spawn` options and call `child.unref()` **only in `storybookSpawner`** (the fake `commandSpawner` stays attached so unit tests clean up on their own). `kill()` stays as written: `storybook dev` handles SIGTERM itself and its esbuild/webpack helpers exit with it.

```ts
// tests/e2e/mcp.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';
import { BIN, FIXTURE_HOST, makeHome, runCli } from './helpers.js';

describe('MCP stdio surface', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('storybrokr_up over MCP boots the fixture and returns story URLs', async () => {
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, 'mcp'],
      env: { ...process.env, STORYBROKR_HOME: home } as Record<string, string>,
    });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('storybrokr_up');
    const result = await client.callTool({ name: 'storybrokr_up', arguments: { component: 'src/components/Button', hostRoot: FIXTURE_HOST } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content as { text: string }[])[0].text) as { record: { status: string; stories: { iframeUrl: string }[] } };
    expect(body.record.status).toBe('ready');
    expect(body.record.stories[0].iframeUrl).toMatch(/iframe\.html/);
    await client.callTool({ name: 'storybrokr_down', arguments: { id: 'src/components/Button' } });
    await client.close();
  });
});
```

```ts
// tests/e2e/external-host.test.ts — opt-in: STORYBROKR_E2E_HOST=/path/to/a/real/host
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { makeHome, runCli, runJson } from './helpers.js';

const HOST = process.env.STORYBROKR_E2E_HOST;
const COMPONENT = process.env.STORYBROKR_E2E_COMPONENT ?? 'components/core/organisms/calendar/section';

describe.skipIf(!HOST)('external host (opt-in)', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it(`brokers ${COMPONENT} from ${HOST}`, async () => {
    const t0 = Date.now();
    const rec = await runJson<InstanceRecord>(['up', COMPONENT, '--host', HOST as string], { home });
    console.log(`external host ready in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${rec.stories.length} stories`);
    expect(rec.status).toBe('ready');
    expect(rec.stories.length).toBeGreaterThan(0);
    await runCli(['down', rec.id], { home });
  });
});
```

```ts
// tests/e2e/render.test.ts — opt-in: STORYBROKR_E2E_RENDER=1 and a resolvable `playwright`
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

const enabled = process.env.STORYBROKR_E2E_RENDER === '1';

describe.skipIf(!enabled)('headless render (opt-in)', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('renders the Panel story with its children inside the ephemeral instance', async () => {
    const require = createRequire(process.env.STORYBROKR_PLAYWRIGHT_DIR ? `${process.env.STORYBROKR_PLAYWRIGHT_DIR}/` : import.meta.url);
    const { chromium } = require('playwright') as typeof import('playwright');
    const rec = await runJson<InstanceRecord>(['up', 'src/components/Panel', '--host', FIXTURE_HOST], { home });
    const story = rec.stories.find((s) => s.id === 'organisms-panel--default');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(story?.iframeUrl ?? '');
    // Wait for real content, not a Suspense fallback: the button text proves the child rendered.
    await page.waitForFunction(() => document.querySelector('#storybook-root button')?.textContent === 'Go', null, { timeout: 30_000 });
    expect(await page.textContent('#storybook-root h2')).toContain('Panel');
    await browser.close();
    await runCli(['down', rec.id], { home });
  });
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `pnpm --filter @helmsmith/storybrokr test:e2e`
Expected: PASS for version, up-down (4), daemon (3), mcp (1); external-host and render report as skipped. Each `up` logs its ready time.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/storybrokr/tests apps/storybrokr/src/lib/spawn.ts
git commit -m "feat(storybrokr): react-vite fixture host and end-to-end suite (cli, daemon, mcp)"
```

---

### Task 17: SKILL.md, README, CI gate, changeset

**Files:**
- Create: `apps/storybrokr/SKILL.md`, `apps/storybrokr/README.md`, `.changeset/storybrokr-initial.md`
- Modify: `.github/workflows/ci.yml` (one step after "Vitest — run package suites")

**Interfaces:** none (documentation and pipeline).

- [ ] **Step 1: Write `SKILL.md`** (frontmatter mirrors pritty's shape)

```markdown
---
name: storybrokr
description: Broker an ephemeral Storybook for ONE component (plus its child components) from a repo's existing .storybook, then screenshot or inspect its stories. Fires when the user wants to see, verify, screenshot, or design-check a single component, story, or UI change — phrases like "show me the Button", "screenshot this component's states", "does the calendar section render", "design check-in", "open storybook for just this component", "verify the UI change visually". Runs as a CLI (`storybrokr up <path>`) and as MCP tools (`storybrokr_up`, `storybrokr_get`, `storybrokr_down`, ...). Boots in seconds instead of the minutes a full Storybook takes.
---

# storybrokr

Boots a throwaway Storybook that contains only one component and the components it imports, using the host repo's own `.storybook/` config, addons, and theme. Instances are owned by a local daemon, so they survive your session and are reused across calls.

## When to fire

- The user wants to look at, screenshot, or verify one component or story.
- A design check-in on a UI change.
- You need a stable URL for one story to hand to Playwright or Chrome DevTools.

Do not use it to browse a whole design system: that is what the host's full Storybook is for.

## The loop

1. `storybrokr up <path-to-component-folder-or-story-file> --json` → an instance record. `stories[]` has one entry per story with:
   - `url` — the Storybook manager with that story selected
   - `iframeUrl` — the story alone, no chrome: use this for screenshots
2. Load `iframeUrl` in a browser. **Wait for real content**, not `#storybook-root` having a child: hosts often show a Suspense fallback ("Loading translations…") first. Wait until the text you expect appears.
3. `storybrokr down <id>` when done, or let the 30-minute idle TTL reap it. A second `up` for the same component reuses the instance.

## Commands

| Command | Purpose |
|---|---|
| `storybrokr up <path> [--host <dir>] [--ttl <min>] [--no-wait] [--json]` | Boot or reuse |
| `storybrokr ls [--json]` / `get <id> [--json]` | Inspect |
| `storybrokr down <id \| --all>` | Stop |
| `storybrokr logs <id> [--follow]` | Storybook output |
| `storybrokr doctor [<path>]` | Pre-flight a host |
| `storybrokr daemon start\|stop\|status` | Daemon control |
| `storybrokr mcp` | MCP stdio server |

## MCP tools

`storybrokr_up { component, hostRoot?, ttlMinutes?, wait? }`, `storybrokr_list {}`, `storybrokr_get { id }`, `storybrokr_down { id }`, `storybrokr_logs { id, tail? }`, `storybrokr_touch { id }`, `storybrokr_inspect_host { path }`. Results are the instance record as JSON text; failures set `isError` with `{ code, message, logTail? }`.

## Instance record

```json
{ "id": "…", "hostRoot": "…", "component": "components/core/atoms/button", "framework": "@storybook/nextjs",
  "port": 6100, "url": "http://127.0.0.1:6100", "status": "ready",
  "storyFiles": ["…/Button.stories.tsx"],
  "stories": [{ "id": "core-atoms-button--primary", "title": "Core/Atoms/Button", "name": "Primary",
                "url": "http://127.0.0.1:6100/?path=/story/core-atoms-button--primary",
                "iframeUrl": "http://127.0.0.1:6100/iframe.html?id=core-atoms-button--primary&viewMode=story" }] }
```

## Error codes

`HOST_NOT_FOUND`, `HOST_INVALID`, `COMPONENT_NOT_FOUND`, `INSTANCE_CAP_REACHED`, `NO_FREE_PORT`, `BOOT_FAILED` (log tail attached), `BOOT_TIMEOUT` (log tail attached), `INSTANCE_NOT_FOUND`, `DAEMON_UNAVAILABLE`. Run `storybrokr doctor <path>` when a host fails.
```

- [ ] **Step 2: Write `README.md`** with these sections, mirroring the other apps: **Why** (lead with the spike table: full app-ui Storybook 38.1s to ready vs 6.6s / 5.5s for CalendarSection + 15 children, 2368 vs 83 index entries), **Install** (`npm i -g @helmsmith/storybrokr`, Node ≥ 24), **Quick start** (`storybrokr up components/core/atoms/button`), **How it works** (config dir under `node_modules/.cache/storybrokr/<id>/`, inherits host main/preview, overrides `stories`; daemon on loopback with a token; idle reaping), **Commands** (same table as SKILL.md), **MCP** (how to register `storybrokr mcp` in Claude Code: `claude mcp add storybrokr -- storybrokr mcp`), **Configuration** (`~/.storybrokr/config.json` keys and defaults from §4.2; `STORYBROKR_HOME`), **Limits** (no file watching for new children; loopback only; frameworks exercised: react-vite in CI, nextjs opt-in), **Contributing** (`pnpm --filter @helmsmith/storybrokr test`, `test:e2e`, opt-in env vars).

- [ ] **Step 3: Add the CI step**

In `.github/workflows/ci.yml`, after the "Vitest — run package suites" step:
```yaml
      - name: storybrokr end-to-end
        # Spawns the built CLI against the react-vite fixture host: daemon
        # auto-start, up/ls/down, reconcile, TTL reaping, and the MCP stdio
        # surface. Ports 6100-6199 on the runner's loopback.
        run: pnpm --filter @helmsmith/storybrokr test:e2e
```

- [ ] **Step 4: Add the changeset**

```markdown
---
"@helmsmith/storybrokr": minor
---

Initial release: broker ephemeral single-component Storybook instances from an existing host Storybook — daemon, CLI, and MCP server.
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr test && pnpm --filter @helmsmith/storybrokr test:e2e && pnpm check apps/storybrokr && pnpm release:plan`
Expected: typecheck clean; unit/integration green; e2e green; Biome clean for the new app; `release:plan` lists `@helmsmith/storybrokr` as publishable (no private runtime deps) and does not list the fixture.

```bash
git add apps/storybrokr/SKILL.md apps/storybrokr/README.md .github/workflows/ci.yml .changeset/storybrokr-initial.md
git commit -m "docs(storybrokr): SKILL.md, README, e2e CI gate, and initial changeset"
```

Then follow the `superpowers:finishing-a-development-branch` skill to open the PR from `feat/storybrokr`. The first npm publish is a separate, deliberate step: add `@helmsmith/storybrokr` to `PUBLISH_PKGS` in the Makefile and run `make publish-dry` before `make publish`.

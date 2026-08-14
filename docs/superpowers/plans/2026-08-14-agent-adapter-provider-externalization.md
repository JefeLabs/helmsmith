# agent-adapter Provider Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@helmsmith/agent-adapter` load only the adapters a host explicitly registers, so a host installs only the SDKs it actually uses.

**Architecture:** Delete the side-effect barrel that eagerly imports all 11 adapters. Each adapter becomes a subpath export (`./adapters/<spec.type>`) exposing an explicit `register*()` function rather than registering at import time. Capability data splits into two planes: a static `ADAPTER_CATALOG` at root (what exists — searchable with nothing loaded) and registry introspection (what this host registered). `AgentSpecType` opens via declaration merging so external packages can register adapters without casts.

**Tech Stack:** TypeScript 5.6 (ESM, `.ts` extension specifiers, unbuilt — `main` points at source), vitest 4.1.9, pnpm workspaces, Biome for lint/format.

**Spec:** `docs/superpowers/specs/2026-07-26-adapter-provider-externalization-design.md`

## Global Constraints

- **Hard cutover, single PR.** The package is `private: true` with only `workspace:*` consumers. No deprecation shims, no `./all` compat entry.
- **Subpath names mirror `spec.type` exactly:** `./adapters/<spec.type>`, e.g. `./adapters/claude-sdk`. Never provider shorthand.
- **No behavior change inside any adapter.** Factory bodies move but are not edited.
- **`harness-core` must stay AWS-free** — it never registers `bedrock-sdk`.
- **Registrar naming:** `register` + PascalCase of the type. `claude-sdk` → `registerClaudeSdk`; `claude-agent-sdk` → `registerClaudeAgentSdk`; `bedrock-sdk` → `registerBedrockSdk`; `opencode-cli` → `registerOpenCodeCli`.
- **Run tests from the package directory:** `cd platform/core/agent-adapter-lib && npx vitest run`.
- **Import specifiers keep the `.ts` extension** (`./registry.ts`), matching the existing codebase.
- The 11 adapter types, verbatim: `claude-sdk`, `claude-agent-sdk`, `claude-code-cli`, `opencode-cli`, `copilot-sdk`, `copilot-cli`, `gemini-cli`, `gemini-sdk`, `openai-sdk`, `codex-cli`, `bedrock-sdk`.

---

### Task 1: Make the package's tests runnable in CI

`agent-adapter-lib/package.json` has no `test` script and no `vitest` devDependency, so the repo-wide `pnpm -r --if-present test` **silently skips all ~20 of its test files**. Every later task in this plan depends on TDD against this package, so this is fixed first.

**Files:**
- Modify: `platform/core/agent-adapter-lib/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm --filter @helmsmith/agent-adapter test` runs the suite.

- [ ] **Step 1: Confirm the suite is currently skipped**

Run: `cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith && pnpm --filter @helmsmith/agent-adapter test`

Expected: pnpm reports no `test` script (skipped), NOT a passing suite. This is the bug.

- [ ] **Step 2: Add the test script and vitest devDependency**

In `platform/core/agent-adapter-lib/package.json`, add to `scripts`:

```json
"test": "vitest run"
```

and add to `devDependencies` (keep the existing entries, alphabetical order):

```json
"vitest": "^4.1.9"
```

- [ ] **Step 3: Install and run the full suite to establish the baseline**

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
pnpm install
pnpm --filter @helmsmith/agent-adapter test
```

Expected: the suite runs and **passes**. Record the test-file and test counts — every later task must keep this green. If anything fails here, stop and report: the baseline is broken before any of this plan's changes.

- [ ] **Step 4: Commit**

```bash
git add platform/core/agent-adapter-lib/package.json pnpm-lock.yaml
git commit -m "test(agent-adapter): run the suite in CI

The package had no test script, so 'pnpm -r --if-present test' skipped
every test file in it."
```

---

### Task 2: Make registry registration idempotent by factory identity

Spec §3.5. Once registration is explicit, two packages in one process legitimately register the same adapter (`pritty` imports `harness-core`; both want `claude-sdk`). Today that warns on every boot.

**Files:**
- Modify: `platform/core/agent-adapter-lib/src/registry.ts:63-72`
- Test: `platform/core/agent-adapter-lib/src/registry.test.ts` (modify the existing `overwrites the existing factory with a warning` case at line 112)

**Interfaces:**
- Consumes: nothing.
- Produces: `registerAdapter(type, factory, capabilities)` — unchanged signature; re-registering an identical `factory` reference is now a silent no-op.

- [ ] **Step 1: Write the failing tests**

Replace the existing `it('overwrites the existing factory with a warning', ...)` block in `src/registry.test.ts` with these two cases. Keep the surrounding `describe` and its `beforeEach(() => _clearRegistry())`, and keep the file's existing stub-adapter/capabilities helpers — reuse whatever the neighbouring tests already use to build a factory and a capabilities object.

```ts
it('does not warn when the same factory reference is registered twice', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const factory = makeFactory();

  registerAdapter('claude-sdk', factory, makeCaps());
  registerAdapter('claude-sdk', factory, makeCaps());

  expect(warn).not.toHaveBeenCalled();
  expect(getAdapterFactory('claude-sdk')?.factory).toBe(factory);
  warn.mockRestore();
});

it('warns and overwrites when a different factory replaces an existing one', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const first = makeFactory();
  const second = makeFactory();

  registerAdapter('claude-sdk', first, makeCaps());
  registerAdapter('claude-sdk', second, makeCaps());

  expect(warn).toHaveBeenCalledTimes(1);
  expect(getAdapterFactory('claude-sdk')?.factory).toBe(second);
  warn.mockRestore();
});
```

If `makeFactory` / `makeCaps` helpers do not already exist in the file, add them above the `describe`:

```ts
const makeFactory = (): AdapterFactory => () => ({}) as unknown as AgentAdapter;
const makeCaps = (): AdapterCapabilities => ({
  reportsUsage: false,
  supportsStreaming: false,
  supportsToolUse: false,
  toolUseMode: 'none',
  supportsExtendedThinking: false,
  supportsCancellation: false,
  supportsCapture: false,
  supportsJsonMode: false,
  supportsSessionResume: false,
});
```

Ensure `vi` is in the vitest import list and that `AdapterFactory`, `AgentAdapter`, and `AdapterCapabilities` are imported as types.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/registry.test.ts`

Expected: FAIL — `does not warn when the same factory reference is registered twice` fails with `expected "warn" to not be called at all, but was called 1 time`.

- [ ] **Step 3: Make registration identity-aware**

In `src/registry.ts`, replace the body of `registerAdapter` (currently lines 68-71):

```ts
export function registerAdapter(
  type: AgentSpecType,
  factory: AdapterFactory,
  capabilities: AdapterCapabilities,
): void {
  const existing = _registry.get(type);
  if (existing && existing.factory !== factory) {
    console.warn(`[agent-adapter/registry] overwriting existing factory for type '${type}'`);
  }
  _registry.set(type, { factory, capabilities });
}
```

Update the doc comment above it to say: re-registering the same factory reference is a silent no-op; replacing it with a different factory warns and overwrites, which is what lets test doubles and plugin replacement stay visible.

Do **not** add a module-level `registered` boolean inside the adapter modules instead. It would survive `_clearRegistry()`, so any test that clears and re-registers would silently run against an empty registry.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd platform/core/agent-adapter-lib && npx vitest run`

Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add platform/core/agent-adapter-lib/src/registry.ts platform/core/agent-adapter-lib/src/registry.test.ts
git commit -m "feat(agent-adapter): idempotent registration by factory identity

Re-registering the same factory is a silent no-op; a different factory for
the same type still warns. Explicit registration means two packages in one
process legitimately register the same adapter."
```

---

### Task 3: Split capability data into catalog and registry planes

Spec §3.4. `CAPABILITY_MATRIX` becomes `ADAPTER_CATALOG` in its own module, keyed by `string` (required by Task 8's open union, which narrows `AgentSpecType` per host). `listAdapterTypes()` starts reading the runtime registry, and `getCapabilities()` is added.

**Files:**
- Create: `platform/core/agent-adapter-lib/src/catalog.ts`
- Create: `platform/core/agent-adapter-lib/src/catalog.test.ts`
- Modify: `platform/core/agent-adapter-lib/src/capabilities.ts` (remove the matrix; rewrite `listAdapterTypes`; add `getCapabilities`)
- Modify: `platform/core/agent-adapter-lib/src/capabilities.test.ts`
- Modify: `platform/core/agent-adapter-lib/src/create-agent.ts:19,70-79,112-123`
- Modify: `platform/core/agent-adapter-lib/src/index.ts:44`
- Modify: all 11 `src/adapters/*/index.ts` (the `CAPABILITY_MATRIX[...]` reference in each `registerAdapter` call and in each adapter class's `capabilities` field)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface AdapterCatalogEntry { type: string; capabilities: AdapterCapabilities }`
  - `export const ADAPTER_CATALOG: Readonly<Record<string, AdapterCatalogEntry>>` — 11 entries, static, no adapter or SDK imports.
  - `export function listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[]` — now reads the **registry**.
  - `export function getCapabilities(type: AgentSpecType): AdapterCapabilities | undefined` — reads the **registry**.

- [ ] **Step 1: Write the failing catalog test**

Create `src/catalog.test.ts`:

```ts
/**
 * The catalog is the "what exists" plane: static data, readable with zero
 * adapters registered and zero provider SDKs loaded.
 */

import { describe, expect, it } from 'vitest';
import { ADAPTER_CATALOG } from './catalog.ts';

const ALL_TYPES = [
  'claude-sdk',
  'claude-agent-sdk',
  'claude-code-cli',
  'opencode-cli',
  'copilot-sdk',
  'copilot-cli',
  'gemini-cli',
  'gemini-sdk',
  'openai-sdk',
  'codex-cli',
  'bedrock-sdk',
];

describe('ADAPTER_CATALOG', () => {
  it('describes all 11 built-in adapters', () => {
    expect(Object.keys(ADAPTER_CATALOG).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('keys each entry by its own type', () => {
    for (const [key, entry] of Object.entries(ADAPTER_CATALOG)) {
      expect(entry.type, `entry under '${key}'`).toBe(key);
    }
  });

  it('carries a full capability descriptor per entry', () => {
    for (const [key, entry] of Object.entries(ADAPTER_CATALOG)) {
      expect(typeof entry.capabilities.supportsStreaming, key).toBe('boolean');
      expect(['autonomous', 'host-loop', 'none'], key).toContain(entry.capabilities.toolUseMode);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/catalog.test.ts`

Expected: FAIL — `Failed to resolve import "./catalog.ts"`.

- [ ] **Step 3: Create the catalog module**

Create `src/catalog.ts`. Move the entire `CAPABILITY_MATRIX` object literal — `capabilities.ts:32-190` — out of `capabilities.ts`, keeping **all 11 entries with their existing comments verbatim**, since those comments record which real CLI/SDK version each descriptor was verified against (e.g. "Verified against the REAL `codex` CLI v0.133.0"). Wrap each descriptor in an entry:

```ts
/**
 * ADAPTER_CATALOG — the "what exists" plane.
 *
 * Static data describing every built-in adapter. Readable with zero adapters
 * registered and zero provider SDKs installed, which is what lets a host ask
 * "what could I use?" before deciding what to import. The registry answers the
 * different question of "what did this host actually register" (capabilities.ts).
 *
 * Keyed by `string`, not `AgentSpecType`: by construction this table describes
 * adapters whose modules the host has deliberately NOT imported, so their types
 * are not members of that host's narrowed `AgentSpecType` (agent.ts).
 *
 * Built-in adapters draw their descriptor from here at registration time.
 * EXTERNAL adapters are not in this table — they pass their own descriptor to
 * registerAdapter() and appear in registry introspection only.
 */

import type { AdapterCapabilities } from './agent.ts';

export interface AdapterCatalogEntry {
  type: string;
  capabilities: AdapterCapabilities;
}

export const ADAPTER_CATALOG: Readonly<Record<string, AdapterCatalogEntry>> = {
  'claude-sdk': {
    type: 'claude-sdk',
    capabilities: {
      reportsUsage: true,
      supportsStreaming: true,
      supportsToolUse: true, // host-loop: adapter surfaces tool-use events; host re-invokes
      toolUseMode: 'host-loop',
      supportsExtendedThinking: true,
      supportsCancellation: true,
      supportsCapture: true,
      supportsJsonMode: false, // Anthropic uses tool-use for structured output
      supportsSessionResume: false,
    },
  },
  // ... the remaining 10 entries. Each is the descriptor already at
  // capabilities.ts:32-190, moved unchanged and wrapped in { type, capabilities },
  // with its verification comment carried over.
};
```

- [ ] **Step 4: Run the catalog test to verify it passes**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/catalog.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing tests for the registry-backed helpers**

In `src/capabilities.test.ts`, replace any test asserting `listAdapterTypes()` returns 11 types from the static matrix, and add:

```ts
import { _clearRegistry, registerAdapter } from './registry.ts';
import { ADAPTER_CATALOG } from './catalog.ts';
import { getCapabilities, listAdapterTypes } from './capabilities.ts';

describe('registry-backed introspection', () => {
  beforeEach(() => _clearRegistry());

  it('returns nothing when the host has registered nothing', () => {
    expect(listAdapterTypes()).toEqual([]);
    expect(getCapabilities('claude-sdk')).toBeUndefined();
  });

  it('reports only what this host registered', () => {
    registerAdapter('claude-sdk', makeFactory(), ADAPTER_CATALOG['claude-sdk'].capabilities);
    registerAdapter('codex-cli', makeFactory(), ADAPTER_CATALOG['codex-cli'].capabilities);

    expect(new Set(listAdapterTypes())).toEqual(new Set(['claude-sdk', 'codex-cli']));
    expect(getCapabilities('claude-sdk')?.toolUseMode).toBe('host-loop');
  });

  it('filters registered adapters by capability', () => {
    registerAdapter('claude-sdk', makeFactory(), ADAPTER_CATALOG['claude-sdk'].capabilities);
    registerAdapter('codex-cli', makeFactory(), ADAPTER_CATALOG['codex-cli'].capabilities);

    expect(listAdapterTypes({ toolUseMode: 'autonomous' })).toEqual(['codex-cli']);
  });
});
```

Reuse the same `makeFactory` helper shape as Task 2.

- [ ] **Step 6: Run to verify they fail**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/capabilities.test.ts`

Expected: FAIL — `getCapabilities` is not exported, and `listAdapterTypes()` returns 11 static types instead of `[]`.

- [ ] **Step 7: Rewrite capabilities.ts against the registry**

`src/capabilities.ts` keeps `intersectCapabilities` exactly as it is, drops the `CAPABILITY_MATRIX` export entirely, and gains:

```ts
import type { AdapterCapabilities, AgentSpecType } from './agent.ts';
import { getAdapterFactory, registeredAdapterTypes } from './registry.ts';

export type { AdapterCapabilities } from './agent.ts';

/**
 * Capabilities of an adapter THIS HOST registered, or undefined if it did not.
 * For "what adapters exist at all", read ADAPTER_CATALOG (catalog.ts).
 */
export function getCapabilities(type: AgentSpecType): AdapterCapabilities | undefined {
  return getAdapterFactory(type)?.capabilities;
}

/**
 * Registered adapter types whose capabilities match every key in the filter.
 * An empty or absent filter returns every registered type.
 *
 * This answers "what can this host do", not "what exists" — a host that
 * registered two adapters gets two results. Use ADAPTER_CATALOG to browse
 * everything without registering anything.
 */
export function listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[] {
  const types = registeredAdapterTypes();
  if (!filter || Object.keys(filter).length === 0) return types;

  const keys = Object.keys(filter) as (keyof AdapterCapabilities)[];
  return types.filter((type) => {
    const caps = getAdapterFactory(type)?.capabilities;
    return caps !== undefined && keys.every((key) => caps[key] === filter[key]);
  });
}
```

- [ ] **Step 8: Update every CAPABILITY_MATRIX reference**

Run: `cd platform/core/agent-adapter-lib && grep -rn "CAPABILITY_MATRIX" src/`

For each hit, replace `CAPABILITY_MATRIX['<type>']` with `ADAPTER_CATALOG['<type>'].capabilities` and fix the import to `import { ADAPTER_CATALOG } from '../../catalog.ts';` (adapters) or `'./catalog.ts'` (root-level modules).

In `src/index.ts:44`, change the capabilities export line to:

```ts
export { getCapabilities, intersectCapabilities, listAdapterTypes } from './capabilities.ts';
export { ADAPTER_CATALOG, type AdapterCatalogEntry } from './catalog.ts';
```

In `src/create-agent.ts`: delete the `CAPABILITY_MATRIX` import (line 19), delete the `checkCapabilityMismatch` helper (lines 70-79) and its call, and delete the redundant static-vs-registered reconciliation block (lines 115-123). `createAgent` already holds `entry` from `getAdapterFactory`, so `entry.capabilities` is the authoritative descriptor and the static cross-check has no purpose. Leave `WorkdirNotARepoError` handling untouched.

- [ ] **Step 9: Run the full suite**

Run: `cd platform/core/agent-adapter-lib && npx vitest run && npx tsc --noEmit`

Expected: PASS, and typecheck clean. `src/index.test.ts:44-45` will still reference `CAPABILITY_MATRIX` and `listAdapterTypes()` returning 11 — update those two assertions now to use `ADAPTER_CATALOG` and to expect the registry-backed count given the barrel is still in place (11 at this point; Task 5 inverts it to 0).

- [ ] **Step 10: Commit**

```bash
git add platform/core/agent-adapter-lib/src
git commit -m "refactor(agent-adapter): split capability data into catalog and registry planes

ADAPTER_CATALOG (static, string-keyed) answers 'what adapters exist' and is
readable with nothing registered. listAdapterTypes/getCapabilities now read
the runtime registry and answer 'what can this host do'. Built-ins draw their
descriptor from the catalog at registration, so the two cannot drift."
```

---

### Task 4: Convert all 11 adapters to exported `register*()` functions

Spec §3.2. The barrel keeps working by calling the new functions, so the tree stays green through this task.

**Files:**
- Modify: all 11 `platform/core/agent-adapter-lib/src/adapters/*/index.ts` (the trailing `registerAdapter(...)` call in each)
- Modify: `platform/core/agent-adapter-lib/src/adapters/index.ts`
- Test: `platform/core/agent-adapter-lib/src/adapters/registrars.test.ts` (create)

**Interfaces:**
- Consumes: `ADAPTER_CATALOG` from Task 3.
- Produces, per adapter module — for example `./adapters/codex-cli/index.ts`:
  - `export const codexCliFactory: AdapterFactory`
  - `export const codexCliCapabilities: AdapterCapabilities`
  - `export function registerCodexCli(): void`

  Full registrar list: `registerClaudeSdk`, `registerClaudeAgentSdk`, `registerClaudeCodeCli`, `registerOpenCodeCli`, `registerCopilotSdk`, `registerCopilotCli`, `registerGeminiCli`, `registerGeminiSdk`, `registerOpenAiSdk`, `registerCodexCli`, `registerBedrockSdk`.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/registrars.test.ts`:

```ts
/**
 * Every adapter exposes an explicit registrar that registers exactly its own
 * type — and importing the module registers nothing on its own.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { _clearRegistry, getAdapterFactory, registeredAdapterTypes } from '../registry.ts';
import { registerBedrockSdk } from './bedrock-sdk/index.ts';
import { registerClaudeAgentSdk } from './claude-agent-sdk/index.ts';
import { registerClaudeCodeCli } from './claude-code-cli/index.ts';
import { registerClaudeSdk } from './claude-sdk/index.ts';
import { registerCodexCli } from './codex-cli/index.ts';
import { registerCopilotCli } from './copilot-cli/index.ts';
import { registerCopilotSdk } from './copilot-sdk/index.ts';
import { registerGeminiCli } from './gemini-cli/index.ts';
import { registerGeminiSdk } from './gemini-sdk/index.ts';
import { registerOpenAiSdk } from './openai-sdk/index.ts';
import { registerOpenCodeCli } from './opencode-cli/index.ts';

const REGISTRARS: [string, () => void][] = [
  ['claude-sdk', registerClaudeSdk],
  ['claude-agent-sdk', registerClaudeAgentSdk],
  ['claude-code-cli', registerClaudeCodeCli],
  ['opencode-cli', registerOpenCodeCli],
  ['copilot-sdk', registerCopilotSdk],
  ['copilot-cli', registerCopilotCli],
  ['gemini-cli', registerGeminiCli],
  ['gemini-sdk', registerGeminiSdk],
  ['openai-sdk', registerOpenAiSdk],
  ['codex-cli', registerCodexCli],
  ['bedrock-sdk', registerBedrockSdk],
];

describe('adapter registrars', () => {
  beforeEach(() => _clearRegistry());

  it.each(REGISTRARS)('registerAdapter for %s registers exactly that type', (type, register) => {
    register();
    expect(registeredAdapterTypes()).toEqual([type]);
    expect(getAdapterFactory(type)).toBeDefined();
  });

  it('is idempotent — calling a registrar twice registers once and does not throw', () => {
    registerCodexCli();
    registerCodexCli();
    expect(registeredAdapterTypes()).toEqual(['codex-cli']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/adapters/registrars.test.ts`

Expected: FAIL — `registerCodexCli` and the other ten are not exported.

- [ ] **Step 3: Convert each adapter module**

For each of the 11 modules, the trailing `registerAdapter(...)` call becomes three exports. The factory body is **moved verbatim** — do not edit any factory logic. Worked example for `src/adapters/codex-cli/index.ts` (currently line 242):

```ts
export const codexCliFactory: AdapterFactory = (spec, deps) => {
  const cliSpec = spec as CodexCliSpec;
  // Precedence must match resolveApiKey: spec → broker → env. Only an explicit
  // spec.apiKey short-circuits; when a broker is present we defer to lazy
  // resolution so the broker is PREFERRED over env (token rotation).
  if (cliSpec.apiKey) return new CodexCliAdapter(cliSpec, deps, cliSpec.apiKey);
  if (deps.credentialBroker) {
    return new LazyCodexCliAdapter(cliSpec, deps, deps.credentialBroker);
  }
  const envKey = process.env[CODEX_API_KEY_ENV];
  if (envKey) return new CodexCliAdapter(cliSpec, deps, envKey);
  throw new MissingCredentialError(
    'No OpenAI API key found for codex-cli adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("openai"), or the OPENAI_API_KEY environment variable.',
  );
};

export const codexCliCapabilities = ADAPTER_CATALOG['codex-cli'].capabilities;

export function registerCodexCli(): void {
  registerAdapter('codex-cli', codexCliFactory, codexCliCapabilities);
}
```

Add `import type { AdapterFactory } from '../../registry.ts';` where it isn't already imported.

Two modules need extra care:
- `bedrock-sdk/index.ts:378` — its factory is a one-liner arrow with a leading comment; keep the comment attached to `bedrockSdkFactory`.
- `codex-cli` and `openai-sdk` reference `LazyCodexCliAdapter` / `LazyOpenAiSdkAdapter`, which are declared *after* the current `registerAdapter` call. `const` declarations are not hoisted, but the factory body only runs when called, so a `const ...Factory = (spec, deps) => { ... }` placed at the same position still resolves them at call time. Leave the class declarations where they are.

- [ ] **Step 4: Update the barrel to call the registrars**

Rewrite `src/adapters/index.ts` so the tree stays green — this file is deleted in Task 5:

```ts
/**
 * Adapter barrel — INTERIM. Deleted in the cutover task; exists only so the
 * tree stays green while adapters are converted to explicit registrars.
 */

import { registerBedrockSdk } from './bedrock-sdk/index.ts';
import { registerClaudeAgentSdk } from './claude-agent-sdk/index.ts';
import { registerClaudeCodeCli } from './claude-code-cli/index.ts';
import { registerClaudeSdk } from './claude-sdk/index.ts';
import { registerCodexCli } from './codex-cli/index.ts';
import { registerCopilotCli } from './copilot-cli/index.ts';
import { registerCopilotSdk } from './copilot-sdk/index.ts';
import { registerGeminiCli } from './gemini-cli/index.ts';
import { registerGeminiSdk } from './gemini-sdk/index.ts';
import { registerOpenAiSdk } from './openai-sdk/index.ts';
import { registerOpenCodeCli } from './opencode-cli/index.ts';

registerClaudeSdk();
registerClaudeAgentSdk();
registerClaudeCodeCli();
registerOpenCodeCli();
registerCopilotSdk();
registerCopilotCli();
registerGeminiCli();
registerGeminiSdk();
registerOpenAiSdk();
registerCodexCli();
registerBedrockSdk();
```

- [ ] **Step 5: Run the full suite**

Run: `cd platform/core/agent-adapter-lib && npx vitest run && npx tsc --noEmit`

Expected: PASS. `registrars.test.ts` passes 12 cases, and every pre-existing test still passes because the barrel still registers all 11.

- [ ] **Step 6: Commit**

```bash
git add platform/core/agent-adapter-lib/src/adapters
git commit -m "refactor(agent-adapter): explicit register*() per adapter

Each adapter exports its factory, capabilities, and a registrar instead of
registering as an import side effect. The barrel now calls the registrars and
is removed in the cutover."
```

---

### Task 5: Cut over — subpath exports, no barrel, empty dependencies

Spec §3.1, §3.2. This is the task that delivers the actual win.

**Files:**
- Modify: `platform/core/agent-adapter-lib/package.json`
- Modify: `platform/core/agent-adapter-lib/src/index.ts:12-13`
- Delete: `platform/core/agent-adapter-lib/src/adapters/index.ts`
- Modify: `platform/core/agent-adapter-lib/src/index.test.ts`

**Interfaces:**
- Consumes: the registrars from Task 4.
- Produces: `@helmsmith/agent-adapter/adapters/<type>` resolves for all 11 types; the root entry registers nothing.

- [ ] **Step 1: Invert the root smoke test**

Rewrite `src/index.test.ts` — its header comment and its central assertion both invert:

```ts
/**
 * Public-surface smoke test.
 *
 * Importing the root barrel must expose createAgent and the registry API, and
 * must register NOTHING. The host decides which adapters exist by importing
 * their subpath entries and calling the registrars.
 */

import { describe, expect, it } from 'vitest';
import * as lib from './index.ts';

describe('public surface', () => {
  it('exports createAgent + the registry API', () => {
    expect(typeof lib.createAgent).toBe('function');
    expect(typeof lib.getAdapterFactory).toBe('function');
    expect(typeof lib.registerAdapter).toBe('function');
  });

  it('registers no adapters on import', () => {
    expect(lib.registeredAdapterTypes()).toEqual([]);
    expect(lib.listAdapterTypes()).toEqual([]);
  });

  it('still describes all 11 adapters in the static catalog', () => {
    expect(Object.keys(lib.ADAPTER_CATALOG)).toHaveLength(11);
  });

  it('re-exports the error taxonomy', () => {
    expect(lib.AdapterError).toBeDefined();
    expect(lib.AuthError).toBeDefined();
    expect(lib.WorkdirNotARepoError).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/index.test.ts`

Expected: FAIL — `registers no adapters on import` fails because the barrel still registers 11.

- [ ] **Step 3: Delete the barrel**

Delete `src/adapters/index.ts`, and delete lines 12-13 of `src/index.ts`:

```ts
// Side-effect: register all 11 built-in adapter factories.
import './adapters/index.ts';
```

Update the module doc comment at the top of `src/index.ts` to say importing this module registers nothing, and that adapters are registered by importing `@helmsmith/agent-adapter/adapters/<spec.type>` and calling its registrar.

- [ ] **Step 4: Add the subpath exports and clean the manifest**

In `platform/core/agent-adapter-lib/package.json`, replace `exports` with:

```json
"exports": {
  ".": "./src/index.ts",
  "./conformance": "./src/conformance/index.ts",
  "./adapters/claude-sdk": "./src/adapters/claude-sdk/index.ts",
  "./adapters/claude-agent-sdk": "./src/adapters/claude-agent-sdk/index.ts",
  "./adapters/claude-code-cli": "./src/adapters/claude-code-cli/index.ts",
  "./adapters/opencode-cli": "./src/adapters/opencode-cli/index.ts",
  "./adapters/copilot-sdk": "./src/adapters/copilot-sdk/index.ts",
  "./adapters/copilot-cli": "./src/adapters/copilot-cli/index.ts",
  "./adapters/gemini-cli": "./src/adapters/gemini-cli/index.ts",
  "./adapters/gemini-sdk": "./src/adapters/gemini-sdk/index.ts",
  "./adapters/openai-sdk": "./src/adapters/openai-sdk/index.ts",
  "./adapters/codex-cli": "./src/adapters/codex-cli/index.ts",
  "./adapters/bedrock-sdk": "./src/adapters/bedrock-sdk/index.ts"
},
"sideEffects": false,
```

Delete the entire `dependencies` block (`@helmsmith/agent-auth` and `zod` are unimported; `@anthropic-ai/sdk` moves below). Add `@anthropic-ai/sdk` to `peerDependenciesMeta` as optional so all five peers are consistent:

```json
"peerDependencies": {
  "@anthropic-ai/sdk": "^0.30.1",
  "@anthropic-ai/claude-agent-sdk": "^0.3.195",
  "@aws-sdk/client-bedrock-runtime": "^3.1076.0",
  "@google/genai": "^2.10.0",
  "openai": "^6.45.0"
},
"peerDependenciesMeta": {
  "@anthropic-ai/sdk": { "optional": true },
  "@anthropic-ai/claude-agent-sdk": { "optional": true },
  "@aws-sdk/client-bedrock-runtime": { "optional": true },
  "@google/genai": { "optional": true },
  "openai": { "optional": true }
},
```

Add `@anthropic-ai/sdk: "^0.30.1"` to `devDependencies` so the lib's own tests still resolve it.

- [ ] **Step 5: Make OpenCodeServer reachable from its adapter entry**

Spec §3.2 requires `OpenCodeServer` to be published from `./adapters/opencode-cli` rather than the root. The implementation file does not need to move — `src/opencode-server.ts` imports only `node:` builtins (`child_process`, `fs`, `os`, `path`), so it is safe at any entry. Re-export it from the adapter module instead.

Append to `src/adapters/opencode-cli/index.ts`:

```ts
// Interface-agnostic helper for spawning / attaching to a long-running
// `opencode serve`. Published here rather than from the root so hosts that
// never use opencode do not see it on their surface.
export {
  OpenCodeServer,
  OpenCodeServerError,
  type OpenCodeServerHandle,
  type OpenCodeServerOptions,
  type OpencodeProviderEntry,
} from '../../opencode-server.ts';
```

Leave the root re-export in `src/index.ts:70-76` in place for now, but mark it:

```ts
// DEPRECATED: import from '@helmsmith/agent-adapter/adapters/opencode-cli'.
// Removed once harness-pipeline-cli migrates (see Task 7).
```

- [ ] **Step 6: Verify**

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
pnpm install
cd platform/core/agent-adapter-lib && npx vitest run && npx tsc --noEmit
```

Expected: PASS. Consumers are still broken at this point — that is Task 7. Do not fix them here.

- [ ] **Step 7: Commit**

```bash
git add platform/core/agent-adapter-lib/package.json platform/core/agent-adapter-lib/src pnpm-lock.yaml
git commit -m "feat(agent-adapter)!: subpath exports, side-effect-free root

Root registers nothing and loads no provider SDKs. Adapters are reachable at
./adapters/<spec.type>. dependencies is now empty: agent-auth and zod were
unimported, and @anthropic-ai/sdk becomes an optional peer like the rest."
```

---

### Task 6: Rewrite the failure messages

Spec §3.6.

**Files:**
- Modify: `platform/core/agent-adapter-lib/src/create-agent.ts:104-110`
- Modify: `platform/harness/harness-core/src/binding-to-spec.ts:207-213`
- Test: `platform/core/agent-adapter-lib/src/create-agent.test.ts`

**Interfaces:**
- Consumes: `registeredAdapterTypes()`.
- Produces: no new exports; message content only.

- [ ] **Step 1: Write the failing test**

Add to `src/create-agent.test.ts` (it already has a `_clearRegistry` pattern and a git-workdir fixture — reuse them; `createAgent` validates the workdir before looking up the factory, so the workdir must be a real repo):

```ts
it('names the exact subpath and registrar for an unregistered type', () => {
  _clearRegistry();
  registerClaudeSdk();

  let message = '';
  try {
    createAgent({ spec: { type: 'bedrock-sdk', model: 'm', region: 'us-east-1' }, workdir: repoDir });
  } catch (err) {
    message = (err as Error).message;
  }

  expect(message).toContain("'bedrock-sdk'");
  expect(message).toContain('@helmsmith/agent-adapter/adapters/bedrock-sdk');
  expect(message).toContain('registerBedrockSdk');
  expect(message).toContain('claude-sdk'); // reports what IS registered
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd platform/core/agent-adapter-lib && npx vitest run src/create-agent.test.ts`

Expected: FAIL — the message still says "Adapters are self-registered in Phases B–D′".

- [ ] **Step 3: Derive the fix from the type**

Add above `createAgent` in `src/create-agent.ts`:

```ts
/** 'claude-agent-sdk' → 'ClaudeAgentSdk'. Mirrors the registrar naming. */
function registrarName(type: string): string {
  return type
    .split('-')
    .map((part) => (part === 'sdk' ? 'Sdk' : part === 'cli' ? 'Cli' : part[0].toUpperCase() + part.slice(1)))
    .join('');
}
```

Replace the throw at lines 104-110:

```ts
const entry = getAdapterFactory(spec.type);
if (!entry) {
  const registered = registeredAdapterTypes();
  throw new Error(
    `No adapter factory registered for spec.type '${spec.type}'.\n` +
      `Register it at your entry point:\n` +
      `  import { register${registrarName(spec.type)} } from '@helmsmith/agent-adapter/adapters/${spec.type}';\n` +
      `  register${registrarName(spec.type)}();\n` +
      `Currently registered: ${registered.length > 0 ? registered.join(', ') : '(none)'}`,
  );
}
```

Import `registeredAdapterTypes` alongside `getAdapterFactory`.

Note: `registrarName('opencode-cli')` yields `OpencodeCli`, but the registrar is `registerOpenCodeCli`. Special-case it:

```ts
const REGISTRAR_OVERRIDES: Record<string, string> = { 'opencode-cli': 'OpenCodeCli' };
```

and check the override first in `registrarName`. Add a unit test asserting `opencode-cli` produces `registerOpenCodeCli`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd platform/core/agent-adapter-lib && npx vitest run`

Expected: PASS.

- [ ] **Step 5: Amend the bindingToSpec bedrock message**

In `platform/harness/harness-core/src/binding-to-spec.ts`, replace the throw at lines 208-212:

```ts
if (providerId === 'bedrock') {
  throw new Error(
    `bindingToSpec: bedrock bindings carry no AWS region. Register the adapter ` +
      `at your entry point and construct the spec directly:\n` +
      `  import { registerBedrockSdk } from '@helmsmith/agent-adapter/adapters/bedrock-sdk';\n` +
      `  registerBedrockSdk();\n` +
      `  createAgent({ spec: { type: 'bedrock-sdk', model, region }, workdir });\n` +
      `Or remove bedrock:* entries from this agent's accepts list.`,
  );
}
```

`harness-core` must NOT import or register `bedrock-sdk` itself — that would pull `@aws-sdk` into every `harness-core` consumer.

- [ ] **Step 6: Run harness-core's tests**

Run: `cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith && pnpm --filter @helmsmith/harness-core test`

Expected: PASS. If a test asserts the old bedrock message text, update it to match the new wording.

- [ ] **Step 7: Commit**

```bash
git add platform/core/agent-adapter-lib/src platform/harness/harness-core/src/binding-to-spec.ts
git commit -m "feat(agent-adapter): self-fixing message for unregistered types

Names the exact subpath and registrar and lists what is registered. The
bindingToSpec bedrock hint follows suit so harness-core stays AWS-free."
```

---

### Task 7: Migrate the consumers

Spec §4. Composition roots register; libraries do not.

**Files:**
- Create: `platform/harness/harness-core/src/register-binding-adapters.ts`
- Modify: `platform/harness/harness-core/src/index.ts`
- Modify: `platform/harness/harness-pipeline-cli/src/index.ts`
- Modify: `apps/pritty/src/ai.ts`
- Modify: `platform/core/agent-adapter-langchain-lib/src/harness-chat-model.test.ts:26,36,128`
- Modify: `platform/context/context-loader-core/package.json`

**Interfaces:**
- Consumes: the 11 registrars, `ADAPTER_CATALOG`.
- Produces: `registerBindingAdapters(): void` exported from `@helmsmith/harness-core`.

- [ ] **Step 1: Write the failing test for harness-core's registrar set**

Create `platform/harness/harness-core/src/register-binding-adapters.test.ts`:

```ts
/**
 * harness-core registers exactly the adapters bindingToSpec can emit — and
 * deliberately NOT bedrock-sdk, which would pull @aws-sdk into every consumer.
 */

import { describe, expect, it } from 'vitest';
import { registeredAdapterTypes } from '@helmsmith/agent-adapter';
import { registerBindingAdapters } from './register-binding-adapters.ts';

describe('registerBindingAdapters', () => {
  it('starts from an empty registry — importing adapter modules registers nothing', () => {
    expect(registeredAdapterTypes()).toEqual([]);
  });

  it('registers exactly the four types bindingToSpec emits', () => {
    registerBindingAdapters();
    expect(new Set(registeredAdapterTypes())).toEqual(
      new Set(['claude-sdk', 'openai-sdk', 'copilot-sdk', 'opencode-cli']),
    );
  });

  it('does not register bedrock-sdk', () => {
    registerBindingAdapters();
    expect(registeredAdapterTypes()).not.toContain('bedrock-sdk');
  });

  it('is safe to call twice', () => {
    registerBindingAdapters();
    registerBindingAdapters();
    expect(registeredAdapterTypes()).toHaveLength(4);
  });
});
```

`_clearRegistry` is deliberately **not** used here: it is internal to the lib and not exported from `@helmsmith/agent-adapter`. It isn't needed — vitest isolates modules per test file, and under this design importing an adapter module registers nothing, so the registry starts empty and the first test asserts exactly that. The remaining cases are order-independent because `registerBindingAdapters()` is idempotent (Task 2).

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith && pnpm --filter @helmsmith/harness-core test`

Expected: FAIL — `./register-binding-adapters.ts` does not exist.

- [ ] **Step 3: Create the harness-core registrar**

Create `platform/harness/harness-core/src/register-binding-adapters.ts`:

```ts
/**
 * The adapter set harness-core's bindingToSpec can produce.
 *
 * Kept beside the mapper that defines it, so the inventory and the mapping
 * cannot drift. bedrock-sdk is deliberately absent: bindingToSpec throws for
 * bedrock bindings and tells the caller to register it themselves, which keeps
 * @aws-sdk out of every harness-core consumer.
 */

import { registerClaudeSdk } from '@helmsmith/agent-adapter/adapters/claude-sdk';
import { registerCopilotSdk } from '@helmsmith/agent-adapter/adapters/copilot-sdk';
import { registerOpenAiSdk } from '@helmsmith/agent-adapter/adapters/openai-sdk';
import { registerOpenCodeCli } from '@helmsmith/agent-adapter/adapters/opencode-cli';

export function registerBindingAdapters(): void {
  registerClaudeSdk();
  registerOpenAiSdk();
  registerCopilotSdk();
  registerOpenCodeCli();
}
```

Export it from `platform/harness/harness-core/src/index.ts`:

```ts
export { registerBindingAdapters } from './register-binding-adapters.ts';
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith && pnpm --filter @helmsmith/harness-core test`

Expected: PASS.

- [ ] **Step 5: Migrate harness-pipeline-cli**

In `platform/harness/harness-pipeline-cli/src/index.ts`, add to the existing `@helmsmith/harness-core` import:

```ts
import { registerBindingAdapters } from '@helmsmith/harness-core';
```

Call it once at the top of `runHarnessPipeline`, before the loop that calls `createAgent` (currently the loop at lines 194-213):

```ts
registerBindingAdapters();
```

Also change its `OpenCodeServer` import from the root entry to `@helmsmith/agent-adapter/adapters/opencode-cli`.

`harness-pipeline-cli` is the only consumer of the root `OpenCodeServer` re-export, so once this import moves, delete the deprecated re-export block from `platform/core/agent-adapter-lib/src/index.ts:70-76` (added with its deprecation note in Task 5 Step 5). Confirm before deleting:

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
git grep -n "OpenCodeServer" -- '*.ts' | grep -v agent-adapter-lib/src
```

Every remaining hit must import from `@helmsmith/agent-adapter/adapters/opencode-cli`.

- [ ] **Step 6: Migrate pritty**

In `apps/pritty/src/ai.ts`, add above the function containing the `createAgent` calls (lines 84, 92, 100):

```ts
import { registerClaudeSdk } from '@helmsmith/agent-adapter/adapters/claude-sdk';
import { registerCopilotSdk } from '@helmsmith/agent-adapter/adapters/copilot-sdk';
import { registerOpenAiSdk } from '@helmsmith/agent-adapter/adapters/openai-sdk';

registerClaudeSdk();
registerCopilotSdk();
registerOpenAiSdk();
```

Place the three calls at module scope, immediately after the imports — this file is pritty's composition root for adapters.

- [ ] **Step 7: Migrate the langchain lib's test**

`agent-adapter-langchain-lib` registers nothing (it is a library; its caller supplies the spec). Only its test references the old matrix. In `src/harness-chat-model.test.ts`, replace all three `CAPABILITY_MATRIX['claude-sdk']` uses (lines 26, 36, 128) with `ADAPTER_CATALOG['claude-sdk'].capabilities` and update the import.

Add a note to the package README stating that consumers must register the adapters their specs use, because this library deliberately does not.

- [ ] **Step 8: Drop the unused dependency**

Remove `"@helmsmith/agent-adapter": "workspace:*"` from `platform/context/context-loader-core/package.json` — no source file imports it (only a docstring mentions it).

Then audit the remaining declarations:

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
for p in platform/harness/harness-server platform/harness/harness-cli apps/taskmaster; do
  echo "== $p"; grep -rn "from '@helmsmith/agent-adapter" $p/src 2>/dev/null | head -3
done
```

Drop the dependency from any package with no hits that also does not re-export the lib's types. Leave packages that reach it transitively through `harness-core` alone — they inherit `registerBindingAdapters()`.

- [ ] **Step 9: Verify the whole workspace**

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
pnpm install && pnpm typecheck && pnpm test
```

Expected: PASS across all packages.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: migrate consumers to explicit adapter registration

harness-core exports registerBindingAdapters() covering exactly the four types
bindingToSpec emits. pritty registers its three. langchain-lib registers
nothing by design. context-loader-core drops an unused dependency."
```

---

### Task 8: Open the type registry via declaration merging

Spec §3.3. Type-level only — no runtime change. Done after the runtime cutover so it lands on stable ground.

**Files:**
- Modify: `platform/core/agent-adapter-lib/src/agent.ts:19-31, 37-43, 230-241`
- Modify: all 11 `src/adapters/*/index.ts` (add augmentation; receive the moved spec interface)
- Test: `platform/core/agent-adapter-lib/src/agent-spec-registry.test-d.ts` (create)

**Interfaces:**
- Consumes: nothing at runtime.
- Produces:
  - `export interface AgentSpecRegistry {}` — augmented by each adapter module.
  - `export type AgentSpecType = keyof AgentSpecRegistry & string`
  - `export type AgentSpec = AgentSpecRegistry[AgentSpecType]`
  - `export interface BaseSpec` — **must be exported**; it is currently module-private at `agent.ts:37` and the moved spec interfaces extend it.
  - Each adapter module re-exports its own spec interface, e.g. `export interface OpenAiSdkSpec extends BaseSpec { … }` from `./adapters/openai-sdk`.

- [ ] **Step 1: Write the failing type test**

Create `src/agent-spec-registry.test-d.ts`:

```ts
/**
 * The host's type universe mirrors its runtime registry: importing an adapter
 * module widens AgentSpecType; not importing one keeps its spec unusable.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { AgentSpecType } from './agent.ts';
import './adapters/codex-cli/index.ts';
import './adapters/claude-sdk/index.ts';

describe('AgentSpecRegistry', () => {
  it('includes types whose modules were imported', () => {
    expectTypeOf<'codex-cli'>().toMatchTypeOf<AgentSpecType>();
    expectTypeOf<'claude-sdk'>().toMatchTypeOf<AgentSpecType>();
  });

  it('excludes types whose modules were not imported', () => {
    // @ts-expect-error bedrock-sdk's module is not imported in this file
    const t: AgentSpecType = 'bedrock-sdk';
    void t;
  });
});
```

Enable type testing by adding `typecheck: { enabled: true, include: ['**/*.test-d.ts'] }` to a new `platform/core/agent-adapter-lib/vitest.config.ts`, following the shape used in `platform/harness/harness-server/vitest.config.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd platform/core/agent-adapter-lib && npx vitest run --typecheck`

Expected: FAIL — `AgentSpecType` is still a closed union, so the `@ts-expect-error` is unused and reports "Unused '@ts-expect-error' directive".

- [ ] **Step 3: Open the union in agent.ts**

Replace the closed `AgentSpecType` union (lines 19-31) with:

```ts
/**
 * Open adapter-type registry. Each adapter module augments this interface, so a
 * host's type universe mirrors its runtime registry: import two adapters and
 * AgentSpecType has exactly two members. External packages augment it too.
 */
export interface AgentSpecRegistry {}

export type AgentSpecType = keyof AgentSpecRegistry & string;
```

Export `BaseSpec` (line 37: `interface BaseSpec {` → `export interface BaseSpec {`).

Replace the `AgentSpec` union (lines 230-241) with:

```ts
export type AgentSpec = AgentSpecRegistry[AgentSpecType];
```

Then move each of the 11 spec interfaces (`ClaudeSdkSpec` at line 45 through `BedrockSdkSpec` at line 212) out of `agent.ts` into its own adapter module, and delete them from `agent.ts`.

- [ ] **Step 4: Add the augmentation to each adapter module**

In each adapter module, alongside the moved interface. Example for `src/adapters/openai-sdk/index.ts`:

```ts
import type { BaseSpec } from '../../agent.ts';

/** OpenAI Chat Completions — in-process, host-loop tool use. */
export interface OpenAiSdkSpec extends BaseSpec {
  type: 'openai-sdk';
  // ... remaining fields moved verbatim from agent.ts
}

declare module '../../agent.ts' {
  interface AgentSpecRegistry {
    'openai-sdk': OpenAiSdkSpec;
  }
}
```

Note the path is `'../../agent.ts'` from an adapter module, not `'../agent.ts'`.

- [ ] **Step 5: Re-point the root type exports**

`src/index.ts` currently re-exports all 11 spec types from `./agent.ts` (lines 16-42). Remove the 11 spec-type names from that export list — they now live on their adapter entries. Keep `AgentSpecType`, `AgentSpec`, `BaseSpec`, and every non-spec type. `tsc` will find each consumer that imported a spec type from root; re-point those imports to the adapter entry.

- [ ] **Step 6: Run both suites**

```bash
cd platform/core/agent-adapter-lib && npx vitest run --typecheck && npx tsc --noEmit
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(agent-adapter): open AgentSpecType via declaration merging

Each adapter module augments AgentSpecRegistry and owns its spec interface, so
a host's type universe mirrors its runtime registry and external packages can
register adapters without casts."
```

---

### Task 9: Lock it in — zero-SDK smoke test and exports coverage

Spec §5. These are the regression tests for the bug this whole plan exists to fix.

**Files:**
- Create: `platform/core/agent-adapter-lib/src/exports-coverage.test.ts`
- Create: `platform/core/agent-adapter-lib/src/zero-sdk.test.ts`

**Interfaces:**
- Consumes: `ADAPTER_CATALOG`, the package manifest.
- Produces: nothing.

- [ ] **Step 1: Write the exports-coverage test**

Create `src/exports-coverage.test.ts`:

```ts
/**
 * Every catalog entry must have a subpath export. Catches the twelfth adapter
 * added later without a matching exports key.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADAPTER_CATALOG } from './catalog.ts';

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));

describe('exports map', () => {
  it('has a subpath entry for every catalog type', () => {
    const missing = Object.keys(ADAPTER_CATALOG).filter(
      (type) => manifest.exports[`./adapters/${type}`] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('has no adapter subpath without a catalog entry', () => {
    const orphans = Object.keys(manifest.exports)
      .filter((key) => key.startsWith('./adapters/'))
      .map((key) => key.replace('./adapters/', ''))
      .filter((type) => ADAPTER_CATALOG[type] === undefined);
    expect(orphans).toEqual([]);
  });

  it('declares itself side-effect free', () => {
    expect(manifest.sideEffects).toBe(false);
  });

  it('declares no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });
});
```

- [ ] **Step 2: Write the zero-SDK smoke test**

Create `src/zero-sdk.test.ts`:

```ts
/**
 * The regression that matters most: the root entry must not reach any optional
 * provider SDK. Before this refactor, importing the root barrel pulled all 11
 * adapters, three of which statically import an optional peer
 * (bedrock-sdk/index.ts:40, gemini-sdk/index.ts:21, openai-sdk/index.ts:21) —
 * so a host without those peers installed crashed at module load.
 *
 * The check runs in a subprocess with the peers made unresolvable, which is the
 * closest thing to a real host that never installed them. Verified against Node
 * v26.5.0, which strips TypeScript types natively.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OPTIONAL_PEERS = [
  '@aws-sdk/client-bedrock-runtime',
  '@google/genai',
  'openai',
  '@anthropic-ai/sdk',
  '@anthropic-ai/claude-agent-sdk',
];

const ROOT_ENTRY = new URL('./index.ts', import.meta.url).href;

describe('root entry', () => {
  it('imports cleanly with no optional peer resolvable', () => {
    const script = `
      const Module = require('node:module');
      const orig = Module._resolveFilename;
      const blocked = ${JSON.stringify(OPTIONAL_PEERS)};
      Module._resolveFilename = function (req, ...rest) {
        if (blocked.includes(req)) {
          const e = new Error("Cannot find package '" + req + "'");
          e.code = 'MODULE_NOT_FOUND';
          throw e;
        }
        return orig.call(this, req, ...rest);
      };
      import(${JSON.stringify(ROOT_ENTRY)})
        .then((m) => {
          if (m.registeredAdapterTypes().length !== 0) {
            console.error('root registered adapters: ' + m.registeredAdapterTypes().join(', '));
            process.exit(1);
          }
          console.log('OK');
        })
        .catch((err) => { console.error(err.message); process.exit(1); });
    `;
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '-e', script], {
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('OK');
  });

  it('has no adapters barrel left to import', () => {
    expect(existsSync(new URL('./adapters/index.ts', import.meta.url))).toBe(false);
  });
});
```

This asserts two things at once: the root graph never touches an optional peer, and it registers nothing.

- [ ] **Step 3: Run and confirm both pass**

Run: `cd platform/core/agent-adapter-lib && npx vitest run`

Expected: PASS, full suite green.

- [ ] **Step 4: Confirm the whole workspace is green**

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/helmsmith
pnpm install && pnpm typecheck && pnpm test && pnpm check
```

Expected: PASS. `pnpm check` runs Biome; fix any formatting it flags with `pnpm check:fix`.

- [ ] **Step 5: Commit**

```bash
git add platform/core/agent-adapter-lib/src
git commit -m "test(agent-adapter): lock in zero-SDK root and exports coverage

The root entry must import cleanly with no optional peers resolvable, and
every catalog type must have a subpath export."
```

---

## Verification checklist

After Task 9, confirm the goals in spec §2 actually hold:

- [ ] `cd platform/core/agent-adapter-lib && node -e "console.log(require('./package.json').dependencies)"` prints `undefined` or `{}`.
- [ ] `pnpm typecheck && pnpm test` green across the workspace.
- [ ] A host importing only `./adapters/codex-cli`, `./adapters/copilot-cli`, and `./adapters/gemini-cli` needs none of the five optional peers installed — the three CLI adapters have no external imports (`opencode-cli` uses only `node:` builtins; the other CLI adapters are type-only).
- [ ] `git grep -n "CAPABILITY_MATRIX"` returns nothing.
- [ ] `git grep -rn "adapters/index.ts"` returns nothing.

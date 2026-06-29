# Phase 0 Agent-Adapter PRD Rebuild — Task Report

**Branch:** `agent-adapter-prd-rebuild`  
**Scope:** `core/agent-auth-lib/` only

---

## 0.1 — Fetch-injectable copilot-api helpers ✅

**Files changed:** `src/copilot-api.ts`, `src/index.ts`

- `getCopilotSessionToken(store, githubToken, fetchFn?: typeof fetch = fetch)` — threaded `fetchFn`; default preserves back-compat for all existing callers.
- `callCopilot(store, messages, model?, fetchFn?: typeof fetch = fetch)` — same pattern; threads `fetchFn` into both `getCopilotSessionToken` and `postChat` calls.
- `postChat(token, messages, model, fetchFn: typeof fetch = fetch)` — now accepts `fetchFn`; was private/unexported, no callers outside the module.
- **New export:** `getCopilotCredential(store, githubToken, fetchFn?)` — calls `getCopilotSessionToken`, then reads the store's `github-copilot` entry and returns `{ apiKey: <copilotToken>, expiresAt: <ISO string from copilotTokenExpiresAt * 1000> }`.

**Tests added (`src/copilot-api.test.ts` — 9 tests):**
- `getCopilotSessionToken`: cache-hit (token >5min left → 0 fetch calls), cache-miss (→ 1 fetch to `COPILOT_TOKEN_URL`), expired (<5min → refresh), non-ok status throws.
- `getCopilotCredential`: cache-miss (returns exchanged apiKey + ISO expiresAt), cache-hit (0 fetch calls).
- `callCopilot`: 401-retry path → injected fetch called exactly 4 times (token exchange, chat→401, re-exchange, retry→200); non-401 error throws; missing cred throws without any fetch call.

---

## 0.2 — Broker returns the exchanged Copilot session token ✅

**Files changed:** `src/file-broker.ts`

- `FileBroker` constructor now accepts an optional second argument `options?: FileBrokerOptions` with `{ fetchFn?: typeof fetch }`. Existing `new FileBroker(path)` callers are fully back-compatible.
- For `provider === 'github-copilot'` (after REPLACE_ME validation): constructs `new AuthStore(this.path)`, calls `getCopilotCredential(store, entry.apiKey, this.fetchFn)`, and returns `{ provider: 'github-copilot', apiKey: <exchanged session token>, expiresAt, source: 'host-file', tokenType: 'copilot-session' }`.
- All other providers: unchanged path, returns raw `entry.apiKey`.
- The 0600 permission assertion runs first, before any exchange attempt.

**Tests added (`src/file-broker.test.ts` — 8 tests):**
- `github-copilot`: returns EXCHANGED session token (asserts `cred.apiKey !== RAW_GITHUB_TOKEN`), `tokenType: 'copilot-session'`, `expiresAt` defined; cache-hit returns cached token with 0 fetch calls; REPLACE_ME throws before any fetch call.
- Non-copilot (`anthropic`, `openai`): raw apiKey returned, fetch stub never called.
- Back-compat: `new FileBroker(path)` (no options) still works for non-copilot.
- Error cases: unknown provider throws, bad permissions throw.

---

## 0.3 — Widen broker param to `string` ✅ (with one external ripple — STOP)

**Files changed:** `src/types.ts`, `src/file-broker.ts`, `src/binding-resolver.test.ts`

- `CredentialBroker.getCredential(provider: string)` and `refresh?(provider: string)` widened in `types.ts`. `Provider` type kept exported.
- `FileBroker.getCredential(provider: string)` widened; internal `provider as Provider` cast added at return-site to satisfy `Credential.provider: Provider`.
- `src/binding-resolver.test.ts:224` — `calls: Provider[]` → `calls: string[]` (within `agent-auth-lib`, fixing the type mismatch introduced by widening).

**Root typecheck ripple (STOPPED — do not touch external package):**

`pnpm typecheck` (root) reports **1 error** outside `agent-auth-lib`:

```
harness/harness-core typecheck: src/orchestrator.test.ts(18,9):
  error TS2322: Type '(provider: string) => Promise<{ provider: string; apiKey: string; source: "env"; }>'
    is not assignable to type '(provider: string) => Promise<Credential>'.
```

**Root cause:** `dummyBroker` in that test has `async getCredential(p) { return { provider: p, apiKey: 'test', source: 'env' } }`. With the widened interface, TypeScript infers `p: string` and `{ provider: string }` is not assignable to `Credential.provider: Provider`.

**One-line fix** (NOT applied — awaiting team decision on whether to proceed with 0.3): cast `return { provider: p as Provider, ... }` in `harness/harness-core/src/orchestrator.test.ts`. No other files in the monorepo had errors.

`pnpm --filter @helmsmith/agent-auth typecheck` → **0 errors**.

---

## Verification Summary

| Check | Result |
|---|---|
| `pnpm --filter @helmsmith/agent-auth typecheck` | ✅ 0 errors |
| Root `pnpm typecheck` | ⚠️ 1 error in `harness-core` (0.3 ripple, external — see above) |
| `pnpm --filter @helmsmith/agent-auth exec vitest run` | ✅ 5 files, **90 tests** passed (baseline was 73) |
| Biome check (all 6 changed files) | ✅ clean |
| Cache-hit proof | `getCopilotSessionToken` cache-hit test: `mockFetch` call count = 0 |
| Broker-returns-exchanged proof | `file-broker.test.ts` asserts `cred.apiKey === EXCHANGED_SESSION_TOKEN !== RAW_GITHUB_TOKEN` |

---

## Files Changed (git add scope)

```
core/agent-auth-lib/src/copilot-api.ts          (0.1: fetchFn injection + getCopilotCredential)
core/agent-auth-lib/src/copilot-api.test.ts     (0.1: 9 new tests)
core/agent-auth-lib/src/file-broker.ts          (0.2: options/fetchFn + copilot exchange; 0.3: string param)
core/agent-auth-lib/src/file-broker.test.ts     (0.2: 8 new tests)
core/agent-auth-lib/src/types.ts                (0.3: CredentialBroker widened to string)
core/agent-auth-lib/src/binding-resolver.test.ts (0.3: calls: string[] fix within agent-auth-lib)
core/agent-auth-lib/src/index.ts               (0.1: export getCopilotCredential)
```

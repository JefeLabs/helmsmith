# HELM-T7: context-loader-cli SIGTERM test fails — bun starves the in-loop signal handler

**Labels:** `bug` · `area:context` · `runtime` · `bun`
**Status:** ✅ RESOLVED (test asserts the runtime-true contract; limitation documented)
**CI exclusion:** none
**Surfaced by:** running the full workspace suite (`pnpm -r --if-present test`).

## Symptom

`context/context-loader-cli` → `src/uds-event-emitter.test.ts` →
*"emits a cancelled event on SIGTERM …"* failed **deterministically** (3/3 in
isolation — an earlier "flaky/load" read was wrong; the `pnpm --filter … exec`
re-runs had matched **zero** test files and exited 0 vacuously):

```
AssertionError: expected [ +0, 143, 1 ] to include -1
  expect([0, 143, 1]).toContain(code);   // code was null → captured as -1
```

A second manifestation of the same root cause: `harness/harness-server` →
`loader-spawn.test.ts` → *"cancel() sends SIGTERM and surfaces a cancelled event"* —
**flaky** (passed one full-suite run, failed the next). It spawns the loader and
asserts the child's `cancelled` event arrives, which depends on bun delivering the
signal mid-walk (`expected undefined to be defined`).

## Root cause (bun runtime limitation)

The CLI ships on bun (`bin: src/bin.ts`, shebang `#!/usr/bin/env bun`), and the test
spawns it via `bun bin.ts` — correct. The CLI registers a proper SIGTERM handler
(`bin.ts:393`) that aborts ingest, emits a `cancelled` event, and exits 0/143/1.

But **bun does not deliver a signal to a JS handler while the event loop is
continuously busy** — Node runs the handler between loop turns; bun doesn't. Probes
(handler registered, then a busy loop, then SIGTERM):

| Runtime | busy loop + SIGTERM listener | handler ran? | exit |
|---|---|---|---|
| node | — | ✅ | `code 7` |
| bun  | `setImmediate` yield | ❌ | `code null, signal SIGTERM` |
| bun  | `setTimeout(0)` yield | ❌ | `code null, signal SIGTERM` |
| bun  | `await Promise.resolve()` | ❌ | `code null, signal SIGTERM` |
| bun  | `process.nextTick` yield | ❌ | `code null, signal SIGTERM` |
| bun  | **idle** (`setInterval`) | ✅ | `code 7` |

Reproducing the test exactly (mock embedder + walk of `/`): the worker is
signal-terminated at **~1 ms**, the handler never runs, **no `cancelled` event** is
emitted. No JS-level yield strategy avoids it — only a genuinely idle loop gets
signal delivery. So a "yield more" CLI fix is not viable.

## Fix

Two parts — the CLI test asserts the runtime-true contract, and the orchestrator is
made to surface the event reliably (the real fix for consumers).

### context-loader-cli (test asserts the achievable contract)

The CLI alone can't deliver a graceful cancel under a bun hot loop, so the test
asserts the **guaranteed** behavior and checks the graceful path only when it ran:

- `spawnCli` now resolves `{ code, signal }` (was `code ?? -1`, which hid the signal).
- The cancel test accepts a graceful exit (`code ∈ {0,143,1}`) **or** `signal ===
  'SIGTERM'` within the grace window — both mean "stopped promptly". The
  `cancelled`-event assertions run only on the graceful branch.
- `bin.ts` documents the bun signal-starvation caveat next to the handler.

### harness-server (product fix — reliable `cancelled` event)

`spawnLoaderJob().cancel()` previously just sent SIGTERM and **depended on the child
loader to echo back a `cancelled` event** — exactly what bun can't guarantee. Now the
parent (which *initiated* the cancel) **surfaces the `cancelled` event itself**, then
sends SIGTERM. All events flow through a shared `dispatch()` that **de-dupes**
`cancelled`, so if the child also emits one (when bun does run the handler) consumers
still see exactly one. Applied to both direct and tmux spawn modes.

This closes the gap for the real consumer path: anything driving the loader through
harness-server (jobs-tui, SSE, harness-cli) now gets a reliable `cancelled` signal on
cancel, regardless of runtime — no longer dependent on the starved in-loop handler.

Verified (Node 22, bun 1.3.14): context-loader-cli UDS test 3/3 + suite 14/14;
harness-server loader-spawn 5/5 (was flaky) + typecheck 0; full workspace suite green.

## Residual note

Direct CLI invocation (no orchestrator) still can't emit a `cancelled` event when bun
signal-terminates a continuously-busy worker — the job stops, but that event is
best-effort at the CLI layer. The orchestrator path above is the one consumers use,
and it is now reliable.

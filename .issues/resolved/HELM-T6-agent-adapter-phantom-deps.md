# HELM-T6: bundled CLIs miss inlined-lib third-party deps (phantom)

**Labels:** `bug` · `area:apps` · `runtime`
**Status:** ✅ RESOLVED
**CI exclusion:** none

## Resolution

Fixed in branch `fix/helm-t6-agent-adapter-deps`. Scope was narrower than the report
feared — only two apps reach undeclared externals from inlined workspace libs:

- **pritty** (statically imports agent-adapter's adapters + the TUI stack): declared
  `@anthropic-ai/sdk` + `@langchain/core` (agent-adapter's externals) and
  `@opentui/core` + `@opentui/react` + `react` (tui-view-components' externals).
  `node bin/pritty.mjs --help` now runs (was crashing on `@anthropic-ai/sdk`, then
  `@opentui/react`).
- **taskmaster**: declared `react` — a latent `@opentui/react` peer gap from HELM-T1
  (which added `@opentui/*` but not its `react` peer). `import('react')` resolves now,
  so the `connect` TUI no longer dies on missing react.

Not affected: **skillzkit** re-declares agent-adapter's types locally (no import);
**taskmaster** never imports agent-adapter's anthropic/langchain path.

Verified (Node 22): both CLIs launch; full `pnpm -r typecheck` 0; tests pritty
118/118, taskmaster 1199/1199.

### Out of scope (separate, optional) — note for later

`discord-timetracker` bundles an optional **DynamoDB** backend importing
`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` without declaring them. It's
lazy (default backend is sqlite via `bun:sqlite`; `--help` works), so it only affects
users who select the dynamo backend — worth declaring as `optionalDependencies` if
that backend is supported, but it's not this bug.

---

_Original report below._

**Repro:** `bun apps/pritty/bin/pritty.mjs --help` →
`error: Cannot find module '@anthropic-ai/sdk' from .../pritty/dist/cli.js`

## Summary

Apps that consume `@ecruz165/agent-adapter` and bundle it (tsup `noExternal:
[/^@ecruz165\//]`) inline agent-adapter's source, which `import`s third-party
packages that tsup keeps **external**. Those externals aren't declared by the
consuming app, so under strict pnpm they can't be resolved at runtime → the CLI
crashes on first load of that path.

agent-adapter's leaking externals: `@anthropic-ai/sdk`, `@langchain/core`,
`@langchain/langgraph`, `zod`.

## Affected

- **pritty** — confirmed: crashes at `--help` (loads the path eagerly).
- **taskmaster** — likely latent: also consumes agent-adapter; `--help` works but an
  AI-scoring command would hit the same missing module. (Its e2e tests don't cover
  the AI path, so it's green today.)
- Any other agent-adapter consumer whose bundle reaches the import.

Same class as the `@opentui` phantom dep fixed in HELM-T1, and the `@inquirer`
phantom deps fixed in HELM-T2 — a workspace lib is inlined, but its third-party
deps don't travel with it.

## Options

1. **Declare the deps in each consumer** (`@anthropic-ai/sdk`, `@langchain/*`, `zod`)
   — quick but whack-a-mole; must track agent-adapter's externals.
2. **Bundle agent-adapter's third-party deps into the consumer** (tsup: don't keep
   them external) — fixes all consumers at the build level.
3. **Publish/consume agent-adapter as built (not inlined source)** so its own
   `dependencies` install normally for consumers — the most correct long-term fix,
   tied to the deferred `@ecruz165 → @jefelabs` publish work.

## Acceptance criteria

- [ ] Each agent-adapter-consuming CLI runs its agent/AI path without a
      `Cannot find module` error (verify `pritty` and `taskmaster` at minimum).
- [ ] A regression test or smoke check that loads the agent-adapter path.

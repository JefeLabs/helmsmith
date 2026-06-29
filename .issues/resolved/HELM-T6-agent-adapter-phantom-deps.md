# HELM-T6: bundled CLIs miss agent-adapter's third-party deps (phantom)

**Labels:** `bug` · `area:apps` · `area:agent-adapter` · `runtime`
**Status:** Open
**CI exclusion:** none (not exercised by current tests — surfaces at CLI runtime)
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

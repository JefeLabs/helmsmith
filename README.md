# helmsmith

Unified monorepo for the **AgentX** ecosystem — the former `agentx-platform` and
`agentx-toolbox` repos merged (history-preserving) into a single pnpm workspace,
alongside the Java/Maven control plane.

## Layout

| Group | What lives here | Rule |
|-------|-----------------|------|
| `core/` | Cross-cutting libraries: `agent-auth`, `agent-adapter`, `cli-kit`, `tui-view-components` | Anyone may depend on these |
| `harness/` | Harness family: `harness-core`, `harness-cli`, `harness-pipeline-cli`, `harness-server`, `workspace-cli` | Depends on `core/` |
| `context/` | Context ingestion + edge context: `context-loader-core`, `context-loader-cli`, `edge-context-cli`, `edge-context-server` | Depends on `core/` |
| `memory/` | Edge memory: `edge-memory-cli`, `edge-memory-server` | Depends on `core/` (and, narrowly, `context/context-loader-core` for the embedder client) |
| `skillzkit/` | `skillzkit` app + `skillzkit-types` (source of truth for the Java catalog schema) | Depends on `core/` |
| `web/` | `controlplane-ui` (React frontend for the control plane) | — |
| `apps/` | Standalone CLI tools: `toolz`, `gitradar`, `pritty`, `taskmaster`, `gittyup`, `discord-timetracker`, `mech-pencil` | Depend on `core/` |
| `controlplane/` | Java / Spring Boot (Maven). **Not** a pnpm workspace member. | — |
| `examples/`, `workspace-template/` | Demo scripts and the cloneable artifact scaffold | — |

## Toolchain

- **Node** ≥ 20, **Bun** ≥ 1.3, **pnpm** 9.15.9 (TS workspace)
- **JDK 21** + Maven (`controlplane/`)
- Lint/format: Biome · Versioning: Changesets

## Common commands

```bash
pnpm install            # install the whole TS workspace
pnpm -r run build       # build all packages that define a build script
pnpm typecheck          # typecheck all packages
pnpm test               # run the test suite
pnpm check              # biome lint + format check

# control plane (separate build)
cd controlplane && ./mvnw verify
```

> Packages are still published under the legacy `@jefelabs/*` scope; a rename to
> `@jefelabs/*` is a planned follow-up (see `docs/`).

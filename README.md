# helmsmith

Unified monorepo for the **AgentX** ecosystem — the former `agentx-platform` and
`agentx-toolbox` repos merged (history-preserving) into a single pnpm workspace,
alongside the Java/Maven control plane.

## Layout

| Group | What lives here | Rule |
|-------|-----------------|------|
| `platform/core/` | Cross-cutting libraries: `agent-auth`, `agent-adapter`, `cli-kit`, `tui-view-components` | Anyone may depend on these |
| `platform/harness/` | Harness family: `harness-core`, `harness-cli`, `harness-pipeline-cli`, `harness-server`, `workspace-cli` | Depends on `platform/core/` |
| `platform/context/` | Context ingestion + edge context: `context-loader-core`, `context-loader-cli`, `edge-context-cli`, `edge-context-server` | Depends on `platform/core/` |
| `platform/memory/` | Edge memory: `edge-memory-cli`, `edge-memory-server` | Depends on `platform/core/` (and, narrowly, `platform/context/context-loader-core` for the embedder client) |
| `platform/skillzkit/` | `skillzkit` app + `skillzkit-types` (source of truth for the Java catalog schema) | Depends on `platform/core/` |
| `platform/controlplane/` | The control plane deployment unit: `ui/` (React, pnpm member) + `service/` (Java / Spring Boot, Maven — **not** a pnpm member). One Docker image bundles both. | — |
| `apps/` | Standalone CLI tools: `toolz`, `gitradar`, `pritty`, `taskmaster`, `gittyup`, `timetracker`, `mech-pencil` | Depend on `platform/core/` |
| `examples/`, `workspace-template/` | Demo scripts and the cloneable artifact scaffold | — |

## Toolchain

- **Node** ≥ 20, **Bun** ≥ 1.3, **pnpm** 9.15.9 (TS workspace)
- **JDK 21** + Maven (`platform/controlplane/service/`)
- Lint/format: Biome · Versioning: Changesets

## Common commands

```bash
pnpm install            # install the whole TS workspace
pnpm -r run build       # build all packages that define a build script
pnpm typecheck          # typecheck all packages
pnpm test               # run the test suite
pnpm check              # biome lint + format check

# control plane (separate build)
cd platform/controlplane/service && ./mvnw verify
```

> Packages are still published under the legacy `@helmsmith/*` scope; a rename to
> `@helmsmith/*` is a planned follow-up (see `docs/`).

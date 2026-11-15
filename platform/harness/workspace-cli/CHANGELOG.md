# @helmsmith/workspace

## 0.1.3

### Patch Changes

- f957f17: The devcontainer template's `neo4j-edge` sidecar moves from Neo4j 5 (5.26) to Neo4j 2026 (`neo4j:2026-community`). An existing `neo4j-edge-data` volume keeps working: Neo4j 2026 opens a database written by 5.26 as-is. New databases default to Cypher 25; the queries edge-context-server runs pass unchanged under it.

## 0.1.2

### Patch Changes

- 1cd231a: Dependency update: `commander` 15.1.

## 0.1.1

### Patch Changes

- 98ba4c1: Installing from npm now gets OpenTUI 0.5.10 and React 19.2.9, the versions these CLIs are built and tested with. The packages asked for `@opentui/core` and `@opentui/react` as `^0.5.10`, which on a 0.x version allows any 0.5.x, so a fresh install picked the newest one (0.5.17 as of this release). That version requires Node 26.4 or later, so `npm install` printed an `EBADENGINE` warning on Node 24, and the terminal UI ran on an OpenTUI version that was never tested here. Both are now exactly `0.5.10`. `react` was `^19.2.9` and resolved to 19.3.1; it is now exactly `19.2.9`.

## 0.1.0

### Minor Changes

- df686c3: **Breaking:** the `agentx-workspace` bin is now `helmsmith-workspace` (`workspace` is unchanged). `AGENTX_PLATFORM_ROOT` and `AGENTX_TMUX_SESSION` are now `HELMSMITH_PLATFORM_ROOT` and `HELMSMITH_TMUX_SESSION`. The default tmux session is `helmsmith`. Newly procured workspaces reference `helmsmith/*` images (`helmsmith/worker`, `helmsmith/harness-server`, …) and name job containers `helmsmith-job-<id>`. Rebuild local images under the new names before using a new workspace.

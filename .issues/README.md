# .issues

Markdown issues for the pre-existing toolbox failures surfaced (not caused) by the
monorepo merge. They were invisible because `agentx-toolbox` shipped without CI.

Each issue is **excluded in `.github/workflows/ci.yml`** so CI reflects merge
health. **Closing an issue → remove its CI `--filter='!…'` exclusion.**

These are flat-file issues (the authoring session's `gh` CLI was a different
account with no access to `JefeLabs/helmsmith`). Each file maps 1:1 to a GitHub
Issue / Jira ticket for import.

| ID | Package | Kind | Status |
|----|---------|------|--------|
| [HELM-T1](./HELM-T1-taskmaster.md) | taskmaster | typecheck + tests | ✅ resolved (exclusions removed) |
| [HELM-T2](./HELM-T2-gittyup.md) | gittyup | typecheck | open — typecheck excluded |
| [HELM-T3](./HELM-T3-mech-pencil.md) | mech-pencil | typecheck | open — typecheck excluded |
| [HELM-T4](./HELM-T4-gitradar.md) | gitradar | flaky test | open — test excluded |
| [HELM-T5](./HELM-T5-opentui-react-esm.md) | @opentui/react (tui) | upstream ESM bug | open — not CI-blocking |

## Fixed during the merge (no issue needed)

- **skillzkit** `fs.test.ts` and **harness-server** `loader-spawn.ts` — *merge-induced*
  cross-group path breakage (domain grouping split `context/` from `harness/`/
  `skillzkit/`), not app debt. Fixed; both pass (`harness-server` 141/141,
  `skillzkit` 216/216).
- **edge-memory-server** — failed only on Node 26 (no `better-sqlite3` prebuilt);
  passes on the CI-pinned Node 22.

## Out of scope (tracked in ../docs/MONOREPO-MIGRATION.md)

`@ecruz165/* → @jefelabs/*` scope rename; extracting `createHttpEmbedderClient`
into `core/` to sever the memory→context edge.

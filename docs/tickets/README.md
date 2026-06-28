# Fix-up tickets

Pre-existing toolbox app failures surfaced (not caused) by the monorepo merge —
they were invisible because `agentx-toolbox` shipped without CI. Each is tracked
here and **excluded in `.github/workflows/ci.yml`** so CI reflects merge health.
Close a ticket → remove its CI `--filter='!…'` exclusion.

These are markdown tickets (the `gh` CLI in the authoring session was a different
account with no access to `JefeLabs/helmsmith`). Port to GitHub Issues / Jira as
desired — each section maps 1:1 to an issue.

| ID | Package | Kind | CI exclusion to remove on close |
|----|---------|------|----------------------------------|
| [HELM-T1](./helm-t1-taskmaster.md) | taskmaster | typecheck + tests | typecheck **and** test |
| [HELM-T2](./helm-t2-gittyup.md) | gittyup | typecheck | typecheck |
| [HELM-T3](./helm-t3-mech-pencil.md) | mech-pencil | typecheck | typecheck |
| [HELM-T4](./helm-t4-gitradar-flaky.md) | gitradar | flaky test | test |

## Already fixed during the merge (no ticket needed)

- **skillzkit** `fs.test.ts` and **harness-server** `loader-spawn.ts` — were
  *merge-induced* cross-group path breakage (domain grouping split `context/`
  from `harness/`/`skillzkit/`), not app debt. Fixed in the merge branch; both
  now pass (`harness-server` 141/141, `skillzkit` 216/216).
- **edge-memory-server** — failed only on Node 26 (no `better-sqlite3` prebuilt);
  passes on the CI-pinned Node 22.

## Not in scope of these tickets

The `@ecruz165/* → @jefelabs/*` scope rename and extracting
`createHttpEmbedderClient` into `core/` are tracked in
[`../MONOREPO-MIGRATION.md`](../MONOREPO-MIGRATION.md) as deferred follow-ups.

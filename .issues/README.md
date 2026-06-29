# .issues

Markdown issues for the pre-existing toolbox failures surfaced (not caused) by the
monorepo merge. They were invisible because `agentx-toolbox` shipped without CI.

CI is currently **exclusion-free** — every package typechecks and every test suite
runs in `.github/workflows/ci.yml`. **All filed issues are resolved** (see below).
**If a future issue needs a CI `--filter='!…'` exclusion, removing that exclusion
is part of closing it.**

These are flat-file issues (the authoring session's `gh` CLI was a different
account with no access to `JefeLabs/helmsmith`). Each file maps 1:1 to a GitHub
Issue / Jira ticket for import.

### Convention: marking an issue resolved

When an issue is fixed, **`git mv` its file into [`resolved/`](./resolved/)** (e.g.
`.issues/resolved/HELM-T1-taskmaster.md`), set its `Status:` to `✅ RESOLVED` with a
short resolution note, remove its `ci.yml` exclusion, and move its row to the
Resolved table below. This keeps the open list = the live backlog while preserving
the full record (and git history follows the move).

### Open

_None — all filed issues resolved. 🎉_

### Resolved

| ID | Package | Kind | Resolution |
|----|---------|------|------------|
| [HELM-T1](./resolved/HELM-T1-taskmaster.md) | taskmaster | typecheck + tests | ✅ fixed; CI exclusions removed (`401116f`) |
| [HELM-T2](./resolved/HELM-T2-gittyup.md) | gittyup | typecheck | ✅ fixed; typecheck exclusion removed |
| [HELM-T3](./resolved/HELM-T3-mech-pencil.md) | mech-pencil | typecheck | ✅ fixed; last typecheck exclusion removed |
| [HELM-T4](./resolved/HELM-T4-gitradar.md) | gitradar | flaky test | ✅ fixed (deterministic fake-timers); last CI exclusion removed |
| [HELM-T5](./resolved/HELM-T5-opentui-react-esm.md) | @opentui/react (tui) | upstream / Bun | ✅ apps self-contained under Bun (vendored-bun bin bootstrap) |
| [HELM-T6](./resolved/HELM-T6-agent-adapter-phantom-deps.md) | pritty / taskmaster | phantom deps | ✅ declared inlined-lib externals (anthropic/langchain/opentui/react) |

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

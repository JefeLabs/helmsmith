# Monorepo migration: agentx-platform + agentx-toolbox → helmsmith

This repo was assembled by merging two source repos into one pnpm workspace,
**preserving full git history** (via `git filter-repo` path rewrites + merge of
unrelated histories).

- `agentx-platform` (branch `develop`, 220 commits) → core/harness/context/memory/web + controlplane
- `agentx-toolbox` (branch `main`, 132 commits) → core libs + skillzkit/ + apps/

Total history: **353 commits** (`git log` and `git blame` follow files across the rename).

## Decisions made during the merge

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base repo | `helmsmith` (was empty) | Neutral ground under the JefeLabs org |
| Layout | Domain grouping (`core` / `harness` / `context` / `memory` / `skillzkit` / `web` / `apps`) | Reflects the real dependency graph |
| `core/` membership | Only the 4 cross-cutting libs (`agent-auth`, `agent-adapter`, `cli-kit`, `tui-view-components`) | Dependency reach, not naming |
| Duplicate `agent-auth` / `agent-adapter` | Kept **platform's** copies | platform's `agent-auth` is a strict superset (has `github-creds.*`); `agent-adapter` source was byte-identical |
| `context-loader-core` placement | `context/` | Used deeply by context; memory uses it for only one helper (`createHttpEmbedderClient`) |
| tsconfig base | Platform style with `verbatimModuleSyntax: false` | Safe union — doesn't break either side |
| pnpm | pinned `9.15.9` | Matches the newer of the two source pins |

## Deferred follow-ups (intentionally NOT done in the merge)

1. **npm scope rename `@ecruz165/*` → `@jefelabs/*`.**
   The org is JefeLabs and the Java `groupId` is already `com.jefelabs.agentx`, but
   every TS package is still `@ecruz165/*`. Do this as its own focused PR: rename
   `name` in every `package.json`, update all internal imports, and reconcile the
   publish target (see #4). Kept separate so the merge diff stays reviewable.

2. **Extract `createHttpEmbedderClient` into a tiny `core/` lib.**
   `memory/edge-memory-server` depends on `context/context-loader-core` solely for the
   embedder HTTP client. Extracting that one helper (e.g. `core/embedder-client-lib`)
   removes the only cross-domain dependency arrow and lets both context and memory
   depend on a small focused package.

3. **Update CI workflow paths.** `.github/workflows/ci.yml` came from platform and
   references the old `packages/*` layout. Update path filters/globs for the new
   `core|harness|context|memory|skillzkit|web|apps/*` groups, and add the toolbox
   apps to the JS job (toolbox had no CI of its own).

4. **Reconcile publish config.** Platform published `access: public` (npm); toolbox
   published `access: restricted` (GitHub Packages). Changesets is currently set to
   `restricted` as the conservative default — decide the real target alongside #1.

5. **Audit `scripts/sync-skills.mjs` and example scripts** for any hard-coded
   `packages/*` paths now that packages moved into domain groups.

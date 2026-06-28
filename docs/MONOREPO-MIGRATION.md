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
   `packages/*` paths now that packages moved into domain groups. *(Done — see
   the `ci:`/`fix(scripts):` commits.)*

## Verification status (full build/typecheck/test sweep)

A complete sweep was run after the merge. Honest results:

- **Workspace resolution:** ✅ all 25 packages link, no duplicate names.
- **Typecheck:** **22 / 25 pass.** The 3 failures are pre-existing app-code
  issues in toolbox apps (which never had CI):
  - `apps/taskmaster` — many type errors (zod overloads, missing props, a
    `ParsedSection` not found, JSX consumed from `tui-view-components` source).
  - `apps/gittyup` — missing `@inquirer/{core,ansi,figures}` deps + implicit-any.
  - `apps/mech-pencil` — `TS2352` bad cast in `src/pen/builder.test.ts`.
  - (`agent-adapter` + `edge-context-server` previously failed on a DOM-lib
    regression introduced by the unified `tsconfig.base.json`; fixed by adding
    `DOM`/`DOM.Iterable` to `lib`.)
- **Test:** **0 / 21 suites run** — all blocked at the SAME startup error:
  `vitest@4.1.9` requires `vite@^6`, but `vite@5.4.21` resolved (pulled by
  `web/controlplane-ui`). No test bodies executed. Fix requires aligning the
  vite/vitest versions (either downgrade vitest to a vite-5-compatible line, or
  upgrade vite to 6 and migrate controlplane-ui). Decision pending.
- **Build:** partial — TS/tsup builds pass; `apps/mech-pencil`'s `bun build`
  sub-step needs the `bun` npm package's postinstall (an environment/approval
  step pnpm gates), unrelated to the merge.
- **Java controlplane:** not run here (`cd controlplane && ./mvnw test`).

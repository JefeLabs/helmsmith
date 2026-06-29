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

1. ✅ **DONE — scope/namespace rename.** Three identities, intentionally independent:
   - **npm scope:** `@ecruz165/* → @helmsmith/*` across all 25 packages + every
     import, `workspace:*` dep, `tsup` `noExternal` regex, and `pnpm --filter` arg.
     Product-branded for public-npm publishing (see #4).
   - **Java:** `com.jefelabs.agentx → com.jefelabs.helmsmith` (package + Maven
     `groupId`).
   - **GitHub org** stays `JefeLabs` (owns the repo).
   Verified: `pnpm -r typecheck` 0 + full suite 3324 / 0 failed; `./mvnw test` BUILD
   SUCCESS (2/2).

2. **Extract `createHttpEmbedderClient` into a tiny `core/` lib.**
   `memory/edge-memory-server` depends on `context/context-loader-core` solely for the
   embedder HTTP client. Extracting that one helper (e.g. `core/embedder-client-lib`)
   removes the only cross-domain dependency arrow and lets both context and memory
   depend on a small focused package.

3. **Update CI workflow paths.** `.github/workflows/ci.yml` came from platform and
   references the old `packages/*` layout. Update path filters/globs for the new
   `core|harness|context|memory|skillzkit|web|apps/*` groups, and add the toolbox
   apps to the JS job (toolbox had no CI of its own).

4. ✅ **DONE (target chosen + config reconciled) — `@helmsmith` on public npm.**
   Was inconsistent (platform `public`/npm, toolbox `restricted`/GitHub Packages).
   Reconciled: publishable packages → `publishConfig.access: "public"` (public npm),
   vestigial publishConfig stripped from private packages, changesets `access:
   public`. Source-first libs keep `exports` → `./src/*.ts` for in-repo dev but carry
   a `publishConfig` **dist-override** (main/types/exports → `./dist`); `@helmsmith/
   cli-kit` `npm publish --dry-run` ships the built `dist`.
   **Remaining (own PR + external setup):** (a) the CLIs still declare their
   `@helmsmith/*` libs as runtime deps — to publish each cleanly, either make it
   self-contained (`tsup noExternal`; 5 of 9 already bundle) or publish the libs it
   depends on (incl. `tui-view-components`, which needs a multi-entry `dist` build for
   its 9 subpath exports); (b) actual `npm publish` needs the `helmsmith` npm org +
   token created on your side.

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
- **Test:** initially **0 / 21 suites ran** — all blocked at the same startup
  error: `vitest@4.1.9` requires `vite@^6` but `vite@5.4.21` resolved (pulled by
  `web/controlplane-ui`). **Fixed** by adding a `vite: ^6` pnpm override (keeps
  `vitest@4`, what the tests target). `controlplane-ui` rebuilt clean on vite 6
  (plugin-react 4.7 + tailwindcss/vite 4 both support it).
  After the vite fix: **13 / 21 packages fully pass.**
- **Merge-induced test breakage found + fixed:** `context-loader-cli` and
  `context-loader-core` had hard-coded `../../harness-core` relative paths that
  assumed the old flat `packages/*` sibling layout. Domain grouping split them
  (`context/` vs `harness/`), so those paths pointed at a nonexistent dir and
  ingestion found 0 files. Repointed to `../../../harness/harness-core` (and one
  `../../../../harness/harness-core`). Now: `context-loader-cli` 14/14,
  `context-loader-core` 12 files pass. (A repo-wide sweep confirmed no other
  cross-group `../../` paths are broken — `harness-server`'s is correct because
  harness-server and harness-core stayed in the same group.) Test packages: **15 / 21.**
- **`edge-memory-server` (3/12 files) — diagnosed: environment, not the merge.**
  The 3 failing files all use `better-sqlite3`, whose native binding never built.
  Two layers: (a) pnpm gates dependency build scripts, so `better-sqlite3`'s
  prebuilt-binary fetch never ran — added `onlyBuiltDependencies` (better-sqlite3,
  esbuild, bun) to package.json's `pnpm` field to allow it; (b) the dev machine
  runs **Node 26**, which has no better-sqlite3 11.10 prebuilt and fails to
  compile against Node 26's V8. **CI pins Node 22** (prebuilts exist) so CI is
  unaffected. To run these tests locally, use Node 22 (`nvm use 22`).
  ✅ **Confirmed:** on Node 22, `edge-memory-server` passes **12/12 files**.
  - ⚠️ **pnpm settings location gotcha:** `overrides` / `onlyBuiltDependencies`
    must live in `package.json`'s `pnpm` field for the pinned pnpm 9.15.9 — it
    does NOT read them from `pnpm-workspace.yaml` (despite a deprecation warning
    suggesting otherwise; that's pnpm-10 behavior). Move them when upgrading to
    pnpm 10.
- **Build:** partial — TS/tsup builds pass; `apps/mech-pencil`'s `bun build`
  sub-step needs the `bun` npm package's postinstall (an environment/approval
  step pnpm gates), unrelated to the merge.
- **Java controlplane:** not run here (`cd controlplane && ./mvnw test`).

### Final suite tally (Node 22, the CI-pinned runtime)

- **Typecheck:** 22 / 25 packages at merge time (fails: taskmaster, gittyup,
  mech-pencil) — all since fixed; now **25 / 25**.
- **Test:** 19 / 21 packages deterministic green at merge time; the rest fixed via
  the tickets below. Current full sweep: **3324 passed / 0 failed / 23 skipped**.
- **controlplane (Java):** `./mvnw -B -ntp test` → BUILD SUCCESS (2/2).

> The numbers above are the immediate post-merge snapshot. They were later driven to
> all-green and **CI was confirmed green** — see "CI: from unverified to verified
> green" below.

> Note: an initial parallel sweep over-counted test failures (5) due to
> load-flakiness + two merge path bugs since fixed; per-package isolation +
> CI-accurate re-runs give the numbers above.

## Backlog → tickets (all resolved)

The merge surfaced the toolbox's own backlog (invisible until it was put under CI),
and — once CI could actually run each stage — several issues that were red in CI but
green locally. **All are resolved**; full write-ups in
[`.issues/resolved/`](../.issues/resolved/). CI is now **exclusion-free** — the early
`--filter='!…'` scopes were removed as each ticket closed.

| Ticket | Package | Kind |
|--------|---------|------|
| HELM-T1 | taskmaster | typecheck + tests (TUI deps / react-reconciler, zod-v4, init-wizard mock) |
| HELM-T2 | gittyup | typecheck (undeclared `@inquirer/*` deps) |
| HELM-T3 | mech-pencil | typecheck (`TS2352` cast) |
| HELM-T4 | gitradar | flaky `db-watcher.test.ts` under load → deterministic fake-timers |
| HELM-T5 | tui apps | `@opentui/react` is Bun-only → apps self-contained via a vendored-Bun launcher |
| HELM-T6 | pritty / taskmaster | phantom deps → declared the inlined libs' third-party externals |
| HELM-T7 | context-loader-cli / harness-server | bun starves in-loop SIGTERM → orchestrator surfaces `cancelled` |
| HELM-T8 | cli-kit | **CI-red:** dist-typed exports unresolvable in a clean checkout → source-first |
| HELM-T9 | gitradar | **CI-red:** `getISOWeek` was timezone-dependent → compute in UTC |
| HELM-T10 | gitradar | **CI-red:** functional suite scanned hardcoded local repos → self-contained fixtures |

**Two "failures" turned out to be merge-induced and were fixed (no ticket):**
- `skillzkit/fs.test.ts` expected `apps/skillzkit` — stale after the move to
  `skillzkit/skillzkit`; regex repointed. Now 216/216.
- `harness-server/loader-spawn.ts` resolved `context-loader-cli` via a sibling
  path that broke when domain grouping split `harness/` from `context/`; repointed
  to `context/context-loader-cli`. Now 141/141.

## CI: from unverified to verified green

For most of this work the "both jobs green" claim was **unverified**: the session's
default `gh` account (`edwin-skoolscout`) 404s on this private repo, so CI status
couldn't be checked. Switching to the `ecruz165` account (which has access) revealed
CI had in fact been **red on every push to `main`**. A claim no one can verify is
"unknown," not "true" — checking it was the first real fix.

The `js` job runs no build step (`install → typecheck → vitest`), so each failure
masked the next and greening it was a serial cascade — three failures that were all
**green locally but red in CI**:

1. **HELM-T8 (typecheck).** `tsc` couldn't resolve `@ecruz165/cli-kit`'s types — it
   pointed `types` at `dist/`, which a clean checkout never builds (a stale local
   `dist/` had masked it). Made cli-kit source-first (`exports: "./src/index.ts"`),
   matching the other 18 libs.
2. **HELM-T9 (vitest).** With typecheck green, vitest ran and gitradar's `getISOWeek`
   failed under UTC: it read a UTC instant with local date getters, so a `…T00:00:00Z`
   date rolled back a day off-UTC. Switched to UTC getters.
3. **HELM-T10 (vitest, bun).** Then gitradar's `test:bun` functional suite failed —
   it scanned hardcoded `/Users/edwincruz/...` repos absent in CI. Rebuilt on
   self-contained git fixtures generated in `beforeAll`.

(HELM-T7 — bun starving an in-loop SIGTERM handler — was found in the same push-and-
watch loop and fixed by having harness-server surface the `cancelled` event from the
parent.)

**Result: both jobs verified green** on the `ecruz165` account — js (Node 22) full
sweep 3324 passed / 0 failed / 23 skipped, controlplane (JDK 21) Maven 2/2. The
reusable lesson: *local green ≠ CI green*. Verifying meant reproducing CI's
environment (clean checkout with no `dist/`, `TZ=UTC`) **and** watching the actual run
rather than trusting the workflow file.

## Merge status: COMPLETE ✅

The repo consolidation is done and verified end-to-end. All breakage attributable
to the merge has been found and fixed:

- history-preserving merge of both repos into the domain layout (353 commits);
- unified workspace config (pnpm/biome/tsconfig/changesets/gitignore);
- DOM `lib` restored in the shared tsconfig;
- `vite@^6` override so vitest 4 runs (controlplane-ui rebuilds clean on vite 6);
- domain-grouping path breakage repaired in `context-loader-{cli,core}`,
  `harness-server` (loader-spawn), and `skillzkit` (fs.test);
- CI + dev scripts repointed to the new layout;
- native-build allowlist added; CI JS job is **exclusion-free** (every package
  typechecks and every suite runs);
- the full HELM-T1…T10 backlog is resolved, including the CI-red cascade above.

Both CI jobs are **verified green** on their CI runtimes (js on Node 22, controlplane
on JDK 21) — confirmed against the actual GitHub Actions run via the `ecruz165`
account, not assumed (see the CI section above). See git log `5f3a85a..HEAD` for the
full trail.

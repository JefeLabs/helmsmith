# workbrokr, storybrokr, pritty — Critical Review

**Date:** 2026-10-18 · **Reviewed at:** helmsmith `main` aea8f97 (storybrokr 0.3.0, workbrokr 0.2.0, pritty 0.0.1) · **Sources:** `apps/storybrokr/src`, `apps/workbrokr/src`, `apps/pritty/src` and `dist`, `docs/superpowers/specs/2026-10-17-workbrokr-design.md` (Spec 1 incl. §18 Amendment A), `docs/superpowers/specs/2026-10-18-storybrokr-worktree-isolation-design.md` (Spec 2), skoolscout-com `helmsmith.config.ts` · **Method:** one lead read of the specs and the integration seams, three independent fresh-context reads (one per app), every reported finding re-checked against the cited lines by the lead; the ones marked **ran** were reproduced on throwaway fixtures. Nothing in either repository was edited.

---

## 1. Executive summary

The three tools are in very different states.

- **workbrokr** works for the happy path that was proven live on skoolscout, but one bug is a silent data-loss defect that fires on every `work start` there: the submodule repair runs `git checkout -f` against the **main checkout's** submodules (W1). Four more high-severity defects leave efforts stuck or slots double-leased when a start is killed, a push is rejected, a sync conflict is resolved, or a stack is running on a wildcard address (W2–W5). The reaper the spec relies on never runs on its own (W6).
- **storybrokr** implements Spec 2 mostly as written, but two scoping holes defeat its purpose: `down --all --host` stops every instance on the machine, and `up` ignores `STORYBROKR_HOST` in both the CLI and the MCP server (S1–S2). A repeat `up` never applies the lease's TTL, so "TTL equals the lease" does not hold (S3). Daemon-restart adoption is unreliable (S4).
- **pritty** cannot run from its built output (`openai` is imported but not declared), `commit` commits working-tree content instead of the index, `rebase` never reaches git because simple-git blocks the editor variable, and `pr` lists the wrong commit range (P1–P4). None of its three commands has a test.
- **§18 Amendment A** names four functions that do not exist, prescribes a `git log` range that reproduces P4, specifies a closed-PR check that cannot be implemented without creating a PR, and omits the packaging facts (Bun runtime, undeclared and unpublished dependencies) that gate "publish 0.1.0".

The pattern across all three is the same one the flow-spec review found in August: the surface (flags, config keys, spec sections) is wider than what the code does, and the gaps sit exactly where no test runs.

**Do first, regardless of the rest:** stop `repairSubmodules` running against skoolscout (W1). It already ran during the #5464 post-merge proof.

---

## 2. Where the code lives

| Concern | Location |
|---|---|
| workbrokr verbs (start/finish/reap/retire/promote/audit) | `apps/workbrokr/src/lib/effort.ts` (1,303 lines) |
| workbrokr git wrapper, registry, guards, config | `apps/workbrokr/src/core/{git,registry,guards,config}.ts` |
| workbrokr → storybrokr CLI client | `apps/workbrokr/src/lib/storybrokr.ts` |
| storybrokr broker, registry, daemon | `apps/storybrokr/src/server/{broker,registry,daemon,start}.ts` |
| storybrokr CLI target resolution | `apps/storybrokr/src/commands/_shared/output.ts`, `commands/{up,down}.ts` |
| storybrokr spawn, ports, discovery | `apps/storybrokr/src/lib/{spawn,ports,discover,host,instance}.ts` |
| pritty commands | `apps/pritty/src/commands/{commit,pr,rebase}.ts` |
| pritty git / GitHub / auth / config | `apps/pritty/src/{git,github,auth,config,ai}.ts`, `bin/pritty.mjs`, `tsup.config.ts` |

---

## 3. workbrokr

### 3.1 Findings

| # | Sev | Where | Finding | Confirmed |
|---|---|---|---|---|
| W1 | **Critical** | `core/git.ts:183-218`, called from `lib/effort.ts:337` and `:360` | `repairSubmodules` writes `<wt>/<sub>/.git` as a gitfile pointing at the main checkout's `.git/modules/<sub>`, then runs `git checkout -f` there. That module's config carries `core.worktree = ../../../<sub>`, which resolves to the **main checkout's** submodule working tree. Uncommitted edits there are reverted and the worktree's submodule directory stays empty. skoolscout marks `.scripts` and `.docs` `ignore = dirty`, so `git status` never shows the loss. | **ran** (fixture: edit reverted `EDITED-UNCOMMITTED` → `v1`; worktree submodule dir empty) |
| W2 | High | `lib/effort.ts:1063-1072` | `reapLeases` walks leases only. An effort killed (SIGKILL/SIGHUP; only SIGINT/SIGTERM are handled) before its first lease stays `starting` forever: start, retire refuse it, finish fails in git. Only a hand edit of the registry clears it. | read |
| W3 | High | `lib/effort.ts:1012-1020`; `core/git.ts:141-146` | `finish` stops services and releases every lease **before** `g.push`. A rejected push leaves an active effort holding nothing, which reap never touches. `worktreeAdd` checks local branches only, so a branch that exists only on origin (e.g. after `retire` deleted the local copy while the PR was open) is recreated from `origin/<base>` and its push is then rejected. | read; reviewer ran the origin-only case |
| W4 | High | `core/guards.ts:78-90` | The pre-commit hook refuses staged paths inside another open effort's scope with no merge-in-progress check. Resolving the sync conflict that `SYNC_CONFLICT` tells the user to resolve stages every file `origin/<base>` brought in, so the resolving commit is refused; the only way out is `--no-verify`. | read; reviewer ran (exit 2) |
| W5 | High | `lib/effort.ts:153-159` | `portBusy` binds `127.0.0.1` only. On macOS a listener on `0.0.0.0`, `::`, `::1` or `localhost` reads as free (Docker publishes on `0.0.0.0`), so a hand-started stack's slot is leased again. Same bug in storybrokr `lib/ports.ts:4-10` (S6). | reviewer ran, both apps |
| W6 | Medium | `lib/effort.ts` (no call), `core/registry.ts:210-214` | Spec §8.4: reap "runs from a launchd timer and as a pre-flight inside `work start`". Neither exists; only `work reap` and the MCP tool reap. Expired leases still count as taken, so nine abandoned efforts exhaust the slots with no hint to reap. | read |
| W7 | Medium | `core/config.ts:71-77` | `PORT_STORYBOOK` is set from the storybrokr instance port, then the per-service loop overwrites it when the manifest declares a `storybook` port service. skoolscout does (`ports.services.storybook.base: 6100`): fullstack efforts get `6100+slot`, frontend efforts get `""`. | read + manifest |
| W8 | Medium | `lib/effort.ts:555-565`, `core/guards.ts:62-76` | Every effort on an area takes the area's commons lease; the hook refuses a lease held from another worktree. Two task efforts on one commons-owning area lock each other out. | reviewer ran |
| W9 | Medium | `lib/effort.ts:691-718` | `promote` changes mode and scopes before claiming the slot. "No free slot" or a failed start leaves a fullstack effort with no `SLOT`. CLI/MCP accept `--story` for promote but it is never read. | reviewer ran |
| W10 | Medium | `core/refresh.ts:154`, `lib/effort.ts:579-581` | Refresh state is saved whether or not the DB reset ran; frontend mode never runs it. A frontend start after a migration change consumes the marker, and the next fullstack start skips the reset. State is per worktree, the database per slot. Contradicts §8.1 step 5. | reviewer traced |
| W11 | Low | `lib/effort.ts:1164-1181` | `retire` brings Storybook down before the dirty/unpushed refusals. | read |
| W12 | Low | `lib/effort.ts:987` | `finish --into-area` derives the parent branch from the **task's** type; a `fix/` task next to a `feature/` area effort targets the wrong branch or refuses with a misleading `EFFORT_OPEN`. | reviewer traced |
| W13 | Low | `core/registry.ts:28-29` | Lock stale threshold 30 s, wait 5 s: after a holder dies every command fails for up to 30 s, and two waiters can both judge the lock stale. | reviewer traced |
| W14 | Low | `commands/hook.ts:113-117`, `lib/effort.ts:765-766` | Commits extend registry leases but never storybrokr's TTL; promote's keep-alive is always skipped as "too recent". | reviewer traced |

### 3.2 Spec 2 §3.5 drift in `lib/storybrokr.ts`

- `downHost` and `touch` are optional, return `void`, and discard exit codes (`:87-96`); the spec has `downHost(): Promise<string[]>` with the ids logged at finish. `version()` is missing; the gate lives inside `up()`. `up` has no `includeChildren` option.
- `downHost` runs `storybrokr down --host …`, and the storybrokr CLI's `connect()` **auto-starts a daemon** when none is listening (`apps/storybrokr/src/client/index.ts:94-115`). `effort.ts:1014`, `:1079`, `:1164` call it for every effort with no mode check, so a backend-only `work finish` spawns a storybrokr daemon.
- `touchEffort` is synchronous and `storybrokrCli.touch` uses `spawnSync`, so the "fire-and-forget" at `effort.ts:145` blocks the event loop for one CLI round trip every 60 s of activity.

### 3.3 Spec 1 drift

- §8.6 audit: no finding for a diff that left its scope, no age on dirty/unpushed work, no storybrokr port-range warning (decision 14).
- §8.5 archive layout is `.slot-archive/<area>/<stamp>/`, not `<area>-<stamp>/`.
- §7.2 has no `--force` to silence the push warning.
- §5.3 lists two hook refusals; the code has a third (another effort's scope), which causes W4.

### 3.4 Sound

- Registry writes are mkdir-locked with tmp+rename and covered by a real six-process allocation test (`core/registry.multiprocess.test.ts`).
- `retire` refuses dirty and unpushed worktrees before anything destructive, and deletes only local branches that are fully on origin (known annoyance: a remote branch GitHub auto-deleted after merge keeps the local one).
- `finish` refuses a dirty worktree unless `--park`, and `--park` commits before anything is removed.

---

## 4. storybrokr

### 4.1 Findings

| # | Sev | Where | Finding | Confirmed |
|---|---|---|---|---|
| S1 | High | `commands/down.ts:24-28` | `down --all --host <dir>` stops every instance on the machine: the `--all` branch runs first with an unfiltered `client.list()`. Spec §3.1 says it equals `down --host <dir>`. | read; reviewer ran |
| S2 | High | `commands/up.ts:68-70`, `mcp/server.ts:67-68` | `up` never consults `STORYBROKR_HOST`; only `resolveTarget` (used by get/down/check/…) does. From `<wt>` with `STORYBROKR_HOST=<wt>/app-ui`, `up src/components/Button` fails `HOST_NOT_FOUND` while `check` with the same path works; an MCP server whose cwd is the main checkout boots the main checkout's instance (exactly §3.1's warning, decision 14). workbrokr is unaffected because it passes `--host`. | read; reviewer ran |
| S3 | Med-high | `server/broker.ts:119-138` | A repeat `up` on a `starting` or unchanged `ready` instance only calls `registry.touch(id)`, which takes no TTL. `work start --join --story` attaching a 2 h lease to a hand-booted 30 min instance leaves it at 30 min. | read; reviewer ran (`created:false`, `ttlMinutes` 30) |
| S4 | Med-high | `lib/spawn.ts:138-148`, `server/broker.ts:320-342` | Children are `detached: true` **with piped stdio**, so after the daemon exits they die with EPIPE on their next log line. Adopted records get no exit watcher (a dead one stays `ready` and holds its port). `reconcile` adopts a mid-boot instance as `ready` with `stories: []`, and `check` on it exits 0 with zero stories. | read; reviewer ran the EPIPE case |
| S5 | Medium | `server/start.ts:12-14`, `commands/daemon.ts:29-31` | `reconcile` runs before the daemon lock. A second `daemon start` (or two CLIs auto-starting) rewrites `state.json` and deletes config dirs of instances still booting, then fails "already running". | read |
| S6 | Medium | `lib/ports.ts:4-10` | `canBind` tries `127.0.0.1` only; Storybook listens on `::`. A second home or an orphaned Storybook can be handed a busy port → `BOOT_FAILED`, no retry. | reviewer ran |
| S7 | Medium | `lib/discover.ts:87` | Leaf-file discovery uses `startsWith(base)`: `up src/Button.tsx` includes `ButtonGroup.stories.tsx` as a root story. Spec §3.3 lists only `Button.stories.tsx` and `Button.variants.stories.tsx`. | read; reviewer ran |
| S8 | Medium | `server/broker.ts:283-317` | `stop()` is not exclusive: `reapIdle` snapshots then awaits each stop up to 5 s, during which an `up` can touch and return the record; `down` racing a recreating `up` can delete the new record and config dir because `procs.delete` works by id. | reviewer traced |
| S9 | Low | `server/broker.ts:127` | Legacy records default `includeChildren` to `false`; Spec 2 §6 / decision 13 say `true`. Rarely reachable (graceful stop kills every instance). | read |
| S10 | Low | `server/broker.ts:131-134` | An explicit `includeChildren` flip restarts on a new port even when the story list is identical; §3.3 says restart only when the list differs. | reviewer traced |
| S11 | Low (design) | `server/registry.ts:66-74` | Hint fallthrough reaches other worktrees on destructive calls: `STORYBROKR_HOST=A down <comp>` with no instance in A and one in B stops B's. Follows the spec, but reopens §1's gap for `down`/`check`. | read |
| S12 | Low | `lib/host.ts:13-20` | `realpathOrResolve` falls back to `resolve()`, so `/tmp/wt` never matches a stored `/private/tmp/wt` once the directory is gone. The orphan reaper still catches it. | reviewer traced |
| S13 | Low | `server/inspector.ts:102-157` | No worker cancellation in `check`: one rejected `acquire` fails `Promise.all` while the other workers keep settling. `checkConcurrency` from `config.json` is not range-checked. | reviewer traced |

### 4.2 Test gaps

- The e2e `--concurrency` case (`tests/e2e/inspect.test.ts:32-47`) checks one story, so parallel check never runs against a real browser.
- The unit harness (`inspector.test.ts:72`) returns the same context from every `acquire`; isolation is asserted only by call count.
- Untested: orphan reap after `rm -rf <worktree>`, MCP with `STORYBROKR_HOST` in the server environment, repeat-up TTL, `down --all --host`, the legacy default, reconcile refreshing stories.
- `tests/e2e/helpers.ts:30` passes `process.env` through; a shell that ran `work env` changes the ambiguity and cwd assertions in `worktrees.test.ts`.

### 4.3 Sound

- `Registry.resolve` precedence (id → strict host → hint → unscoped with `INSTANCE_AMBIGUOUS`) matches §3.1 exactly; `normalizeComponent` rejects paths outside the host; `instanceId` includes the realpath'd host, so two worktrees of one repo get distinct ids.

---

## 5. pritty

### 5.1 Findings

| # | Sev | Where | Finding | Confirmed |
|---|---|---|---|---|
| P1 | **Critical** | `dist/cli.js:2156`, `package.json`, `tsup.config.ts`, `bin/pritty.mjs` | The bundle inlines `@helmsmith/agent-adapter`, which imports `openai` top-level; `openai` is not a declared dependency, so `node bin/pritty.mjs --version` dies with `Cannot find package 'openai'`. The bin always re-execs under the vendored **Bun** because `cli.ts` imports the TUI statically (`@opentui/react` ×21 in the bundle), so `pr` cannot run under Node. `agent-adapter`, `agent-auth` and `tui-view-components` are `workspace:*` and **unpublished** (npm 404), so a published tarball cannot be installed even though their code is bundled. `@langchain/core` and `cli-table3` are never imported. | **ran** |
| P2 | **Critical** | `src/git.ts:93-99`, `src/ai.ts:241`, `src/commands/commit.ts:136-146` | `git.commit(message, files)` becomes `git commit -m … -- <files>`, git's `--only` mode, which records the **working-tree** content of each path and ignores the index. A partially staged file is committed whole, with hunks the model never saw. The model's returned `files` are cast unvalidated: it can name an unstaged tracked file (committed from disk), return `[]` (falls through to a plain `git commit` of everything staged), or omit files (left staged, success reported). Text inside a diff can steer all of this. | reviewer ran each case; git semantics confirmed |
| P3 | **Critical** | `src/git.ts:159-183`, `src/commands/rebase.ts:125-141` | simple-git 3.36.0's unsafe-operations plugin refuses `GIT_SEQUENCE_EDITOR` (and an inherited `GIT_EDITOR`/`PAGER`) unless `allowUnsafeEditor` is enabled; `createGit` does not enable it. `rebaseWithPlan` therefore returns `ok:false` before git runs, and pritty prints "Your branch is now in a paused rebase state" over an untouched repo. Behind that guard: reword/squash messages go on the todo line where git ignores them; the plan check (`ai.ts:434-455`) tests length and membership only, so a plan that repeats A and omits B passes and loses B; order is unchecked. | **ran** (`Use of "GIT_EDITOR" is not permitted without enabling allowUnsafeEditor`) |
| P4 | High | `src/git.ts:109`, `:129` | `git.log({from, to})` emits `from...to`, which for `git log` is the **symmetric difference**: on a branch whose base has moved, base-only commits feed the PR prompt, the "no commits" check and rebase plans. `changedFilesBetween` uses the two-dot `git diff`, so CODEOWNERS reviewers include files changed only on the base. The two are wrong in opposite directions. | simple-git source (`rangeOperator = symmetric !== false ? "..." : ".."`); reviewer ran |
| P5 | High | `src/commands/pr.ts:49-66` | Any configured `baseBranch` is replaced by GitHub's default unless `--base` is passed; the comment claims the override applies only to the schema default, the code does not check. `baseBranch: develop` in a `main`-default repo opens the PR against `main` with a dim note. | read |
| P6 | High | `src/commands/pr.ts:74-85`, `:183-213` | The duplicate check only warns; the push and the model call happen before `createPR`, which GitHub then rejects (422). A second `--auto-approve` run exits 1 after pushing and paying for generation. Token/lookup failures at `:64` and `:83` are swallowed, so a token without repo access is discovered after the push. | read |
| P7 | High | `src/github.ts:45-50`, `platform/core/agent-auth-lib/src/github-device-flow.ts:68` | Token order is Copilot device-flow token → `GITHUB_TOKEN` → `GH_TOKEN`. The Copilot token is global (one identity for every repo), is requested with scope `read:user` only (cannot create pull requests), and `GH_TOKEN` is ignored whenever `auth.json` exists. The push uses git's own credentials, so push and PR can be different accounts. A remote URL with an embedded token fails `parseGitHubRemote` and is printed in full to stderr (`pr.ts:45`), which §18.3 copies into `PRITTY_FAILED`. | read; reviewer ran the URL case |
| P8 | Medium | `src/git.ts:64-67` | `status.staged` omits renames: a rename-only index reports "No staged files", and renames stay staged after a run. | reviewer ran |
| P9 | Medium | `src/cli.ts`, `src/commands/_shared/ticket-context.ts:49` | No `--json`. `--auto-approve` does not skip the stale-ticket `confirm()`. With stdin closed inquirer throws "User force closed the prompt" and writes escape codes to stdout. All human output goes to stdout. | reviewer ran |
| P10 | Medium | `src/config.ts:108-119`, `src/pr-template.ts:52`, `src/codeowners.ts:51` | Config, template and CODEOWNERS are read from `cwd`, not the repo root; from a subdirectory pritty silently uses defaults. `preCommit`, `prePush`, `skipHooks`, `autoApprove`, `dryRun`, `verbose` are parsed and **never read** (`pritty init` writes hooks that never run; README row says ⏳). | grep |
| P11 | Medium | `src/ai.ts:219` | The first 12,000 chars of the staged diff go to the provider unredacted (a staged `.env` reaches it); no timeout or abort signal on `adapter.invoke`. | reviewer traced |
| P12 | Low | `src/categorizer.ts:24`; `src/git.ts:75-78` | Default category order puts `src/**` first, so `src/foo.test.ts` and `src/x.stories.tsx` land in `app`. On a detached HEAD `getCurrentBranch` returns a short SHA: `pr` pushes it; `rebase` passes the protected-branch check. | reviewer ran |

### 5.2 Tests

118 unit tests pass. They cover parsers, ticket adapters and provider selection. Nothing tests `commit`, `pr`, `rebase`, any `GitOps` method except `parseGitHubRemote`, `github.ts`, model-output parsing, or rebase-plan validation. `tests/e2e` holds only a README. Every confirmed defect above is in untested code. The CLI ships under Bun while vitest runs under Node, so the tested runtime is not the shipped one.

---

## 6. §18 Amendment A, against the code

Line numbers: §18 is `2026-10-17-workbrokr-design.md:367-438` (the file has 438 lines; no copy on disk reaches line 583).

| § | Problem |
|---|---|
| 18.2.3, 18.2.4, 18.3.3 | Names `getCommitsSinceBase`, `getDiffStatSinceBase`, `pushBranch` and `g.behindCount`. None exist; pritty has `log`, `changedFilesBetween`, `push`, workbrokr has `commitsNotOn`/`unpushedCount`. Mark them as new or use the real names. |
| 18.2.3 | Prescribes `origin/<base>...HEAD` for the commit list. Three dots mean "since the merge base" for `git diff` and "symmetric difference" for `git log` — it would reproduce P4. Correct: `log origin/<base>..HEAD`, `diff origin/<base>...HEAD`. |
| 18.3.4 | "Verify it is still open through `pritty pr --no-push --json`" cannot distinguish *closed* from *absent*: under `--auto-approve` pritty would create a new PR, which the same step says to refuse without `--force`. Needs a non-creating query (`pritty pr --dry-run --json` returning the existing PR, or an explicit `pritty pr --check`). |
| 18.2.1 | Short-circuit "for `(head, base)`": `listOpenPRsForHead` filters by head only. Add `base`. |
| 18.2.2 | Does not mention P2/P3/P4: a `--title/--body-file` path still lists commits with the symmetric range and still pushes before the duplicate check (P6). The amendment should state that P4 and P6 are prerequisites, not just `--json`. |
| 18.2.6 | Correct on the token order; should also say the Copilot token's `read:user` scope cannot create PRs today, which makes "unverified" settled. |
| 18.2.8 | Guards a `skipHooks` bypass that does not exist (P10). Either drop it or state that the key is inert today and the refusal is forward-looking. |
| 18.2.9 | "workbrokr only needs the published binary" omits: that binary requires Bun at runtime (P1); `openai` must be declared; the three bundled `workspace:*` packages must move to `devDependencies` or be published; the `/core` export must be reachable without importing the TUI, which the current `cli.ts` prevents. |
| 18.3 step 3, 18.6 decision 4 | "the pre-push hook runs once under workbrokr's identity": workbrokr has no identity; the push uses git's credential helper (`gh` active account unless `GH_TOKEN` is set). State that `work pr` inherits `GH_TOKEN` for both the push and pritty's API call. |
| 18.3 step 5 | `cwd = effort.worktree` is right and makes 18.2.5 (repo-root lookup) necessary only for humans; say so. |
| 18.4 | Table is correct (`develop`/`edwin-skoolscout`, `main`/`ecruz165`). |

---

## 7. Recommendations, prioritized

1. **W1 — today.** Make `repairSubmodules` never touch the main checkout: either `git submodule update --init` run inside the worktree, so the linked worktree gets its own module directories and `core.worktree` instead of borrowing the main checkout's, or leave repair to the project's refresh step (skoolscout already ships `worktree-submodules.sh`) and delete the function. Add a test that edits a main-checkout submodule file and asserts it survives `work start`.
2. **W3, W2.** `finish`: push first, release leases after; on push failure leave leases intact and the effort active with a clear message. `reap`: also walk efforts (`starting` past grace with no leases → parked). `worktreeAdd`: fetch and start from `origin/<branch>` when it exists.
3. **W4.** Hook: when `MERGE_HEAD` exists, limit scope checks to paths that differ from both parents (`git diff --name-only HEAD MERGE_HEAD -- <staged>`), or skip the other-effort scope check for merge commits.
4. **W5, S6.** Probe `0.0.0.0` and `::` as well as `127.0.0.1` (or use `lsof -nP -iTCP:<port> -sTCP:LISTEN` on macOS).
5. **W6.** Reap pre-flight in `start`; ship the launchd plist or drop the claim from §8.4.
6. **S1, S2, S3.** `down --all` must respect `--host`; `up` must consult `STORYBROKR_HOST` through `resolveTarget`'s rules; repeat `up` must apply `ttlMinutes` when given (raise, never lower, or document).
7. **S4, S5.** Spawn adopted-capable children with `stdio: 'ignore'` + log files (or don't adopt); watch adopted pids; take the daemon lock before `reconcile`.
8. **pritty, before any §18 work:** declare `openai`, move bundled workspace packages to devDependencies, split the TUI out of `cli.ts` so Node can run `pr`; replace path-restricted commits with index-restricted ones (`git commit` of a temporary index built with `git read-tree`/`update-index` from the staged blobs, or `git stash`-free `--only` on files you first verify are fully staged); enable `allowUnsafeEditor` or run the rebase through `child_process` directly; fix the ranges; honor configured `baseBranch`; validate model output against the staged set. Then write the tests that would have caught each.
9. **§18:** rewrite 18.2.3, 18.3.4 and 18.2.9 per §6 above; add P2–P6 to 18.2 as prerequisites; add the fixture tests to 18.5.

---

## 8. Unconfirmed (what would settle each)

- Whether a `proc.kill` leaves a Node grandchild alive when the host's `.bin/storybook` shim does not `exec` (inspect skoolscout `app-ui/node_modules/.bin/storybook`, `ps` after `down`).
- Whether deleting a config dir during boot (S5) breaks the running Storybook (second `daemon start` while an instance boots).
- Whether `BrowserPool`'s open count goes negative after a browser crash and relaunch.
- Whether `storybrokr up` via `spawnSync` with no timeout hangs `work start` when the daemon hangs.
- Whether `retire` refuses forever after a squash merge plus a pruned remote branch (falls back to comparing against `origin/<base>`).
- Whether `addLabels` creates labels the model invents; whether a CODEOWNERS entry naming the PR author fails the whole reviewer request.

---

## 9. Reproductions

Lead-run repros (scratch, outside the repo): `submodule-repro/` (W1), `pritty-rebase-repro/` + `rebase-probe.mts` (P3), `node bin/pritty.mjs --version` (P1). Reviewer probes: `scripts/` (workbrokr W2, W3, W4, W5, W7, W8, W9), `sbreview/probe.test.ts` (S1, S3, S4, S7), `pritty-review/scripts/` (P2, P4, P7, P8, P9, P12). All under `/private/tmp/claude-501/-Users-edwincruz-Development-Workspaces-skoolscout-skoolscout-com--claude-worktrees-automations/d798aaae-b719-4777-a9d4-049e26557789/scratchpad/`; they do not survive the session and are listed only so the steps can be re-run from the descriptions above.

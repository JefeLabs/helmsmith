# workbrokr Phase 1b: skoolscout-com adoption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skoolscout-com the first project that runs on `work`: a manifest that reproduces today's slot contract, hooks that refuse commits on develop/stage/prod, the two port guards that close the slot-0 hole, and `make` wrappers so old habits land in the registry.

**Architecture:** Nothing in the application changes. `helmsmith.config.ts` declares what `slot.mk` hard-codes today (same bases, same formula), `work start` writes the `.slot` marker that `slot.mk` already honours, so every existing make target keeps working inside an area worktree without edits. The runner's `execPsql` and the backend's `ide` profile refuse a reserved slot's ports when they run from a linked worktree. `make worktree-new|worktree-remove|slot-status` become wrappers that call `work`.

**Tech Stack:** skoolscout-com (Makefiles, TypeScript e2e runner, Spring Boot `ide` profile), `@helmsmith/workbrokr` built from the helmsmith checkout.

**Spec:** `docs/superpowers/specs/2026-10-17-workbrokr-design.md` §13 (this repo). Depends on phase 1 (`2026-10-17-workbrokr-phase-1.md`) being built; it does not need it published.

## Global Constraints

- No work on develop: every change here is made on branch `chore/platform/tooling` in worktree `.claude/worktrees/platform/tooling` of skoolscout-com, created by hand once in Task 0 (the last worktree ever created by hand there) and thereafter driven by `work`.
- Slot 0 ports (3000, 8443, 5432, 8081, 9222) and names (`app-service`, `skoolscout-postgres-ide`) stay exactly as they are; the manifest's bases equal `slot.mk`'s and Task 3 pins that with a check.
- `slot.mk`'s resolution order is unchanged; `.slot` written by `work start` is what makes an area worktree resolve.
- skoolscout-com gates: `cd app-ui && npm run check`, `cd app-test-e2e-runner && npx tsc --noEmit -p tsconfig.json`, app-service `./mvnw -q test -Dtest=<new tests>` then the architecture tests (`./mvnw -q test -Dtest='*ArchitectureTest,*ArchUnit*'`), Biome from inside each package.
- Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR against develop, merge commit, promotion by branch PRs.

## Review Focus

1. A `make` run from a package subdirectory inside an area worktree must still resolve the slot from the worktree's `.slot` (Task 3 check runs `make -C app-ui slot-print`).
2. `execPsql` with no `SLOT`, no DSN and a linked worktree must refuse, not default to 5432 (Task 4 test).
3. The backend guard must not fire for slot 0 in the main checkout (Task 5 test with a `.git` directory, not file).
4. `work start` must not break `make e2e-servers-start`'s own port kill (`SS_FE_PORT`/`SS_BE_PORT` come from the same slot; Task 6 runs it once).
5. The hooks must be inert in a clone that has not run `work init` (no `core.hooksPath`): Task 2 verifies a commit in a fresh clone still works.

---

### Task 0: Bootstrap worktree and the `work` binary

**Files:** none committed.

- [ ] **Step 1:** From the skoolscout-com main checkout: `git fetch origin develop && git worktree add .claude/worktrees/platform/tooling -b chore/platform/tooling origin/develop` and seed it: `make worktree-seed DIR=.claude/worktrees/platform/tooling`.
- [ ] **Step 2:** Build and link the CLI from helmsmith: `cd ~/Development/Workspaces/jefelabs/helmsmith-workbrokr && pnpm install && pnpm --filter @helmsmith/workbrokr build && npm link ./apps/workbrokr` (or `npm i -g ./apps/workbrokr`). Verify `work --version` and `workbrokr --version` print the same version from any directory.
- [ ] **Step 3:** Record in the ledger that this worktree was created by hand and why.

---

### Task 1: The manifest

**Files:**
- Create: `helmsmith.config.ts` (repo root of skoolscout-com)

- [ ] **Step 1: Write the manifest**

```ts
// helmsmith.config.ts — read by `work` (@helmsmith/workbrokr). Project facts only; the tool knows none of them.
// Bases equal slot.mk's; `make slot-check` fails if they drift.
export default {
  project: 'skoolscout-com',
  baseBranch: 'develop',
  protectedBranches: ['develop', 'stage', 'prod'],
  worktreeRoot: '.claude/worktrees',
  branch: { types: ['feature', 'chore', 'fix'] },
  slots: { count: 10, reserved: [0] },
  ports: {
    services: {
      postgres: { base: 5432 },
      backend: { base: 8443 },
      frontend: { base: 3000 },
      pgadmin: { base: 8081 },
      cdp: { base: 9222 },
      storybook: { base: 6100 },
    },
  },
  // Start order = key order. Every command is an existing make target; SLOT comes from the
  // worktree's .slot marker that `work start` writes, so no SLOT= is passed.
  services: {
    postgres: {
      start: 'make -C app-service db-up',
      stop: 'make -C app-service db-down',
      health: 'pg_isready -h 127.0.0.1 -p ${PORT_POSTGRES} -q',
      reset: 'make -C app-service db-reset',
      healthTimeoutMs: 120000,
    },
    backend: {
      start: 'make -C app-service dev',
      stop: 'make -C app-service dev-stop',
      health: "curl -sk -o /dev/null -w '%{http_code}' -H 'Host: demo-org.skoolscout.com.local' https://127.0.0.1:${PORT_BACKEND}/api/mtauth/v1/public/tenant-by-host",
      healthyCodes: [200],
      healthTimeoutMs: 300000,
    },
    frontend: {
      start: 'make -C app-ui dev-e2e',
      stop: 'make -C app-ui dev-stop',
      health: "curl -sk -o /dev/null -w '%{http_code}' https://demo-org.skoolscout.com.local:${PORT_FRONTEND}/auth/sign-in",
      healthyCodes: [200, 307],
      healthTimeoutMs: 300000,
    },
    pgadmin: { start: 'true', stop: 'true', health: 'true' },
    cdp: { start: 'true', stop: 'true', health: 'true' },
  },
  storybook: { hostRoot: 'app-ui' },
  logs: { dir: '.logs' },
  env: {
    file: '.env.slot',
    template: {
      SLOT: '${SLOT}',
      SS_PG_PORT: '${PORT_POSTGRES}',
      SS_BE_PORT: '${PORT_BACKEND}',
      SS_FE_PORT: '${PORT_FRONTEND}',
      SS_PGADMIN_PORT: '${PORT_PGADMIN}',
      SS_CDP_PORT: '${PORT_CDP}',
      PORT_STORYBOOK: '${PORT_STORYBOOK}',
      LOG_DIR: '${LOG_DIR}',
    },
  },
  refresh: [
    { when: 'app-ui/package-lock.json', run: 'make -C app-ui install' },
    { when: 'app-test-e2e-runner/package-lock.json', run: 'make -C app-test-e2e-runner install' },
    { when: 'app-service/pom.xml', run: 'make -C app-service install' },
    { when: 'app-service/src/main/resources/db/migration/**', mark: 'db-reset' },
    { when: 'app-ui/.storybook/**', run: 'make -C app-ui storybook-css' },
    { always: true, run: 'rm -f app-test-e2e-runner/.e2e-cache/auth/*.json' },
    { always: true, run: 'rm -rf app-ui/.next' },
  ],
  scopes: {
    frontend: [
      'app-ui/app/discover-schools/{group}/{section}/**',
      'app-ui/components/discover-schools/{section}/**',
      'app-ui/app/api/{section}/**',
      'app-test-e2e-runner/tests/tests-discover-schools-{group}/{section}/**',
    ],
    backend: [
      'app-service/src/main/java/com/skoolscout/app/api/{module}/**',
      'app-service/src/main/java/com/skoolscout/app/modules/{module}/**',
      'app-service/src/test/java/com/skoolscout/app/modules/{module}/**',
    ],
  },
  // {group} = org | family (the route group), {section} = the route segment; module = the backend package.
  areas: {
    'org/applications': { module: 'registration_students' },
    'org/candidates': { module: 'candidate' },
    'org/candidates-advisors': { module: 'counselor' },
    'org/automations': { module: 'automations' },
    'org/messaging': { module: 'messaging' },
    'org/team': { module: 'team' },
    'org/forms': { module: 'forms' },
    'org/files': { module: 'files' },
    'org/programs': { module: 'programs' },
    'org/network': { module: 'mycontact' },
    'org/office-hours': { module: 'orgevent' },
    'org/schools-candidates': { module: 'schoolscandidates' },
    'org/schools-recruiting': { module: 'schoolsv2' },
    'org/social': { module: 'social' },
    'org/to-dos': { module: 'todo' },
    'org/dashboard': { module: 'dashboard' },
    'org/advertising': { module: 'advertising' },
    'org/awaiting-approval': { module: 'joinrequests' },
    'family/my-applications': { module: 'registration_students' },
    'family/my-schools': { module: 'schoolscandidates' },
    'family/my-events': { module: 'globalcalendar' },
    'family/my-files': { module: 'files' },
    'family/my-contacts': { module: 'mycontact' },
    'family/my-profile': { module: 'student' },
    'family/my-preferences': { module: 'preferences' },
    'family/my-to-dos': { module: 'todo' },
    'family/my-school-visits': { module: 'schoolvisits' },
    'family/mock-interview': { module: 'mockinterview' },
    'family/test-prep': { module: 'testprep' },
    'family/schedule-meeting': { module: 'orgevent' },
    'family/dashboard': { module: 'dashboard' },
    'family/help': { module: 'support' },
    'platform/auth': { commons: ['auth'] },
    'platform/proxy': { commons: ['proxy'] },
    'platform/core-ui': { commons: ['core-ui'] },
    'platform/infra': { commons: ['infra'] },
    'platform/tooling': { commons: ['tooling'] },
  },
  commons: {
    auth: ['app-ui/app/api/auth/**', 'app-ui/app/auth/**', 'app-ui/auth.ts', 'app-service/src/main/java/com/skoolscout/app/mtauth/**', 'app-service/src/main/resources/application-mtauth-host.yml'],
    proxy: ['app-ui/app/api/proxy/**', 'app-ui/proxy.ts', 'app-ui/libs/withViewerHost.ts'],
    'core-ui': ['app-ui/components/core/**', 'app-ui/components/platform/**', 'app-ui/app/globals.css', 'app-ui/public/locales/**'],
    infra: ['.infra/**', '.github/**', 'docker-compose*.yml'],
    tooling: ['slot.mk', 'Makefile', '*/Makefile', '.scripts-tools/**', 'helmsmith.config.ts', '.helmsmith/**', 'app-test-e2e-runner/tests/helpers/**'],
  },
  expiry: { slotHours: 12, commonsHours: 4, storybookHours: 2 },
  archive: {
    paths: ['app-test-e2e-runner/test-results', 'app-test-e2e-runner/latest', 'app-test-e2e-runner/.maturity', 'app-service/target/trace-logs'],
    keepDays: 30,
    keepPerArea: 5,
  },
};
```
Two areas share a module in places (`org/applications` and `family/my-applications` both name `registration_students`): a fullstack effort on either holds the backend scope and blocks a fullstack effort on the other, which is the intended consequence; two frontend efforts on them do not conflict.

- [ ] **Step 2: Verify it loads** — `work status --json` from the tooling worktree prints `{ "project": "skoolscout-com", "areas": [...] }` with no error; `work env --area org/applications` is refused with `EFFORT_NOT_FOUND` (no effort yet), proving the manifest parsed. Make `make -C app-service db-up|db-down|db-reset|dev-stop` and `make -C app-ui dev-stop` exist: read `app-service/Makefile` and `app-ui/Makefile`; where a target is missing, add it as a thin alias of the existing compose/kill logic (`db-up` = the compose up already inside `dev`'s prerequisites; `dev-stop` = kill the pid file the dev target writes, or `lsof -t -i tcp:$(SS_BE_PORT)` **only when `.slot` resolves to a non-zero slot**).
- [ ] **Step 3: Commit** — `chore(tooling): helmsmith.config.ts, the slot contract as a manifest`.

---

### Task 2: Hooks

**Files:**
- Create: `.helmsmith/hooks/pre-commit`, `.helmsmith/hooks/pre-push` (generated), `docs/runbooks/work-hooks.md`

- [ ] **Step 1:** `work init --project skoolscout-com --base-branch develop --no-manifest` is not a flag; instead run the hook installer alone: `workbrokr hook install` is not a verb either. Add to phase 1 Task 15 a `work hooks install` subcommand (one line: calls `installHooks(repoRoot)`); then here run `work hooks install`, which writes the two scripts and sets `core.hooksPath` in this clone.
- [ ] **Step 2:** Prove it: in the tooling worktree `git commit --allow-empty -m test` succeeds (branch `chore/platform/tooling`); `git -C <main checkout> commit --allow-empty -m test` is refused with `develop ... protected` (then nothing to undo). In a fresh `git clone` to a temp dir (no `core.hooksPath`), an empty commit on develop succeeds: the hooks are opt-in per clone until `work hooks install` runs there.
- [ ] **Step 3:** `docs/runbooks/work-hooks.md`: one page: what the hooks refuse, how to install them in a clone, how to bypass in an emergency (`git -c core.hooksPath= commit`, logged as an exception in the PR).
- [ ] **Step 4:** Commit — `chore(tooling): commit hooks that refuse work on protected branches`.

---

### Task 3: `slot.mk` shim and make wrappers

**Files:**
- Modify: `slot.mk` (append `slot-check`), `Makefile:415-560` (`slot-status`, `worktree-new`, `worktree-remove` bodies), `CLAUDE.md:50-75`

- [ ] **Step 1: `slot-check`** appended to `slot.mk`:
```make
.PHONY: slot-check
slot-check: ## Fail if slot.mk's ports disagree with helmsmith.config.ts for this slot
	@command -v work >/dev/null || { echo "work is not installed (npm i -g @helmsmith/workbrokr)"; exit 1; }
	@env_json=$$(work env --project-root '$(SLOT_ROOT)' --slot $(SLOT) --json) || exit 1; \
	  for pair in SS_PG_PORT=PORT_POSTGRES SS_BE_PORT=PORT_BACKEND SS_FE_PORT=PORT_FRONTEND; do \
	    mk=$${pair%%=*}; wk=$${pair##*=}; \
	    want=$$(printf '%s' "$$env_json" | sed -nE "s/.*\"$$wk\": *\"?([0-9]+)\"?.*/\1/p"); \
	    have=$$(printf '%s' "$$(make -s slot-print SLOT=$(SLOT) | sed -nE "s/^$$mk=([0-9]+)$$/\1/p")"); \
	    [ "$$want" = "$$have" ] || { echo "❌ $$mk: slot.mk says $$have, manifest says $$want"; exit 1; }; \
	  done; echo "✓ slot $(SLOT): slot.mk and helmsmith.config.ts agree"
```
This needs `work env --slot N` to answer without an effort (phase 1 Task 12: add `--slot <n>` and `--project-root <dir>` to `work env`, computing the vars from the manifest alone). Add that to phase 1 before executing this task.
- [ ] **Step 2: Wrappers.** `worktree-new` prints `worktree-new is retired: run work start --area <area> --type <type> --mode <mode>` and exits 1 (areas replace names; no silent translation). `worktree-remove` keeps working for leftovers but first prints `prefer: work retire --area <area>`. `slot-status`: when `work` is on PATH, run `work status` and exit; else the existing body.
- [ ] **Step 3: CLAUDE.md** "Parallel stacks (slots)" section: replace the resolution paragraph with: `work start --area <area> --type <type> --mode <fullstack|frontend>` is the only way to begin; slot 0 is the human's; inside an area worktree pass nothing; `work status`, `work finish`, `work audit`; `make slot-check` after editing either file; never run `npx playwright test` directly (use `make e2e-story`).
- [ ] **Step 4: Verify** — `make slot-check SLOT=3` passes; from `app-ui/` inside an area worktree with `.slot` = 3, `make slot-print` shows `SS_FE_PORT=3003`.
- [ ] **Step 5: Commit** — `chore(tooling): slot-check; worktree-new retired in favour of work start`.

---

### Task 4: Runner port guard

**Files:**
- Modify: `app-test-e2e-runner/tests/helpers/db.ts:56-135`
- Create: `app-test-e2e-runner/tests/helpers/slot-guard.ts`, `app-test-e2e-runner/tests/helpers/slot-guard.spec.ts` (a Playwright unit-style spec under the runner's own config, since the runner has no vitest; or `node --test` if the runner's `tsx` is available: pick whichever the runner already runs in CI and note it)

- [ ] **Step 1: Failing test** — `assertNotReservedPort({ port: 5432, gitDir: '/repo/.git/worktrees/x', reserved: [5432] })` throws `/slot 0|reserved/`; with `gitDir: '/repo/.git'` it returns; with port 5437 in a worktree it returns.
- [ ] **Step 2: Implement** `slot-guard.ts`:
```ts
import { execFileSync } from "node:child_process";
export const RESERVED_SLOT0_PORTS = [5432, 8443, 3000];
export function linkedWorktreeGitDir(cwd = process.cwd()): string {
  return execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, stdio: "pipe" }).toString().trim();
}
/** A linked worktree may never dial slot 0's ports: that is the human's stack. */
export function assertNotReservedPort(o: { port: number; gitDir: string; reserved?: number[] }): void {
  const reserved = o.reserved ?? RESERVED_SLOT0_PORTS;
  if (o.gitDir.includes("/worktrees/") && reserved.includes(o.port)) {
    throw new Error(
      `refusing port ${o.port} from a linked worktree: that is slot 0, the human's stack. ` +
        "Run through make (e2e-story / e2e-servers-start) inside a work-started worktree so SLOT resolves.",
    );
  }
}
```
In `execPsql`, after `dbPort` is resolved: `assertNotReservedPort({ port: Number(dbPort), gitDir: linkedWorktreeGitDir() })`.
- [ ] **Step 3: Run** the guard test → PASS; `npx tsc --noEmit -p tsconfig.json` clean; run one db-backed story through make on a leased slot to prove nothing regressed (`make e2e-story STORY=mark-signin FAST=1` in an area worktree started with `work start --mode fullstack`).
- [ ] **Step 4: Commit** — `fix(e2e): refuse slot 0's ports from a linked worktree`.

---

### Task 5: Backend port guard (ide profile)

**Files:**
- Create: `app-service/src/main/java/com/skoolscout/app/config/SlotGuard.java`, `app-service/src/test/java/com/skoolscout/app/config/SlotGuardTest.java`

- [ ] **Step 1: Failing test** (plain JUnit, no Spring context):
```java
class SlotGuardTest {
  @TempDir Path dir;
  @Test void refusesSlotZeroPortsFromALinkedWorktree() throws IOException {
    Files.writeString(dir.resolve(".git"), "gitdir: /repo/.git/worktrees/x\n");
    assertThatThrownBy(() -> SlotGuard.check(dir, "jdbc:postgresql://localhost:5432/skoolscout_db", 8443))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("slot 0");
  }
  @Test void allowsSlotZeroInTheMainCheckoutAndOtherSlotsAnywhere() throws IOException {
    Files.createDirectory(dir.resolve(".git"));
    assertThatCode(() -> SlotGuard.check(dir, "jdbc:postgresql://localhost:5432/skoolscout_db", 8443)).doesNotThrowAnyException();
    Files.delete(dir.resolve(".git"));
    Files.writeString(dir.resolve(".git"), "gitdir: /repo/.git/worktrees/x\n");
    assertThatCode(() -> SlotGuard.check(dir, "jdbc:postgresql://localhost:5437/skoolscout_db", 8448)).doesNotThrowAnyException();
  }
}
```
- [ ] **Step 2: Implement** `SlotGuard`: `@Component @Profile("ide")`, implements `InitializingBean`; `afterPropertiesSet` calls `check(Path.of(System.getProperty("user.dir")), datasourceUrl, serverPort)` with values injected from `spring.datasource.url` and `server.port`. `check`: walk up from `dir` to the first `.git`; if it is a regular file whose content starts with `gitdir:` and contains `/worktrees/` → linked worktree; parse the JDBC URL's port; if linked and (dbPort == 5432 or serverPort == 8443) → `throw new IllegalStateException("refusing to start from a linked worktree on slot 0's ports (db " + dbPort + ", server " + serverPort + "): that is the human's stack; start through `work start --mode fullstack` so SLOT resolves")`.
- [ ] **Step 3: Run** `./mvnw -q test -Dtest=SlotGuardTest` → PASS; then every architecture test; then start the backend in an area worktree through `work start --mode fullstack` and confirm it boots on 8443+N.
- [ ] **Step 4: Commit** — `fix(app-service): refuse slot 0's ports from a linked worktree in the ide profile`.

---

### Task 6: Prove the loop and retire the old spec's claims

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-parallel-slots-design.md` (header pointer), `stackbrokr.config.ts` (header comment: superseded by `helmsmith.config.ts`; file kept until stackbrokr ships)

- [ ] **Step 1:** From the tooling worktree: `work finish --area platform/tooling` is not yet possible (this worktree was made by hand); instead `work audit --json` lists it as `foreign-branch`? No: its branch `chore/platform/tooling` matches `<type>/<area>` for a declared area, so audit is clean. Run `work start --area org/team --type chore --mode fullstack` in a second shell: a slot is leased, `.slot` written, `make -C app-test-e2e-runner e2e-servers-start` is **not** needed (the runner started the stack); run `make e2e-story STORY=mark-signin FAST=1` inside that worktree → green; `work finish --area org/team` → leases gone, branch pushed; `work retire --area org/team`.
- [ ] **Step 2:** Pointers in the two files; one paragraph each.
- [ ] **Step 3:** Full gates (Global Constraints) and commit — `docs(tooling): parallel-slots spec and stackbrokr manifest point at helmsmith.config.ts`.
- [ ] **Step 4:** Push `chore/platform/tooling`, open the PR against develop with the migration notes (manifest, hooks opt-in per clone, `worktree-new` retired, the two guards), merge on green, promote per the usual branch PRs.

---

## Self-review

**Spec §13 coverage:** manifest (Task 1), slot.mk shim and wrappers (Task 3), stackbrokr.config.ts superseded (Task 6), the two guards (Tasks 4, 5), existing worktrees already cleaned (none to migrate). Two additions this plan pushes back into phase 1, both small: `work hooks install` (Task 2) and `work env --slot N --project-root` (Task 3); add them to phase 1's Tasks 15 and 12 before execution.

**Placeholders:** none; every command names an existing or newly aliased make target, and Task 1 Step 2 says what to do when an alias is missing.

**Review Focus:** each of the five is pinned to a task (3, 4, 5, 6, 2).

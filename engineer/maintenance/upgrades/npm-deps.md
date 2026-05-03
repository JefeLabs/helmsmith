---
type: upgrader
description: Tactfully upgrade npm dependencies by library-family groupings, proceeding from lowest to highest risk. Topology-aware (single-package, workspaces, Nx, Turbo). One grouping at a time, fully resolve all issues (lint, types, tests, builds) before moving to the next. Never blindly run `npm update`.
argument-hint: [<package-path> | all]
allowed-tools: Read, Write, Edit, Bash, mcp__context7__*
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection — both layers), `engineer/maintenance/upgrades/_context.md`
> (upgrade archetype patterns + per-topology branching),
> `product/strategy/_context.md`.
>
> This is the npm/JS counterpart to
> `/engineer:maintenance:upgrades:gradle-deps`,
> `/engineer:maintenance:upgrades:maven-deps`, and
> `/engineer:maintenance:upgrades:infra-deps`. Same principles, same rigor,
> adapted to the JS ecosystem's package-manager + workspace-tool
> diversity.

Tactfully upgrade npm dependencies by **library-family groupings**,
proceeding from lowest risk to highest. Upgrade one grouping at a
time, fully resolve all issues (lint, types, tests, builds) before
moving to the next. Never blindly `npm update` the whole tree.

**Invoke with:** `/engineer:maintenance:upgrades:npm-deps` + optional
argument:

- **Single package path:** `/engineer:maintenance:upgrades:npm-deps app-ui`
- **All packages:** `/engineer:maintenance:upgrades:npm-deps all`
- **No argument:** defaults to `all` — upgrades every package in
  the project

## Step 0.0 — Topology detection (full: outer + inner)

This routine has the most complex topology because npm/JS has the
most diverse project structures. **Detection runs in two layers**.

### Layer 1 — Outer: where are the npm project root(s)?

```bash
# Find package.json files (excluding nested node_modules)
find . -maxdepth 4 -name "package.json" -not -path "*/node_modules/*" \
  -not -path "*/.next/*" -not -path "*/dist/*" -not -path "*/build/*" \
  | xargs grep -l '"name"' 2>/dev/null | sort
```

**Outer topology variations**:

- **Single npm project at repo root**: `./package.json`
- **Single npm project in subdirectory**: `./<subdir>/package.json`
- **Multiple independent npm projects**: rare in modern repos;
  treat each as its own upgrade session
- **Polyglot monorepo**: npm coexists with Maven/Gradle/etc. Find
  the npm root(s); ignore the rest for this routine.

If multiple npm roots are found, prompt the user to pick one or
process sequentially with separate branches.

### Layer 2 — Inner: what's the topology within the npm root?

This is where npm's complexity shows. Detection in priority order:

```bash
NPM_ROOT=<detected from outer>
cd "$NPM_ROOT"

# 1. Workspace tool detection (highest priority — overrides workspaces)
[ -f "nx.json" ]         && echo "TOPOLOGY=nx"
[ -f "turbo.json" ]      && echo "TOPOLOGY=turbo"
[ -f "rush.json" ]       && echo "TOPOLOGY=rush"
[ -f "lerna.json" ]      && echo "TOPOLOGY=lerna"

# 2. Workspaces declaration in root package.json
node -e 'const pkg = require("./package.json"); console.log(pkg.workspaces ? "TOPOLOGY=workspaces" : "")' 2>/dev/null

# 3. pnpm workspaces (separate config file)
[ -f "pnpm-workspace.yaml" ] && echo "TOPOLOGY=pnpm-workspaces"

# 4. Single-package fallback (no workspace setup)
# If none of the above produced output → TOPOLOGY=single-package
```

**Inner topology variations**:

| Topology | Detection signal | Workspace files |
|----------|------------------|-----------------|
| `single-package` | None of the below | One `package.json`; one lockfile |
| `workspaces` | `package.json` `"workspaces"` field | Root + per-workspace `package.json`; one hoisted lockfile |
| `pnpm-workspaces` | `pnpm-workspace.yaml` | Root + per-workspace `package.json`; one `pnpm-lock.yaml` |
| `nx` | `nx.json` | Per-project `package.json`; nx.json declares projects + targets |
| `turbo` | `turbo.json` | Per-package `package.json`; turbo.json declares pipeline |
| `rush` | `rush.json` | Per-project `package.json`; rush.json declares projects |
| `lerna` | `lerna.json` | Per-package `package.json`; lerna.json declares packages |

### Package manager detection (independent of topology)

```bash
[ -f "package-lock.json" ]  && PM=npm
[ -f "pnpm-lock.yaml" ]     && PM=pnpm
[ -f "yarn.lock" ]          && PM=yarn

# Cross-check with packageManager field if present
node -e 'console.log((require("./package.json").packageManager||"").split("@")[0])' 2>/dev/null
```

If multiple lockfiles exist, that's a project-config bug — ask
the user which is canonical and remove the others as a separate
cleanup commit before upgrading.

### Detection output

```
npm project detected:
- Root:           <path>
- Topology:       <single-package | workspaces | pnpm-workspaces | nx | turbo | rush | lerna>
- Package manager: <npm | pnpm | yarn>
- Workspaces:     <list of workspace paths when applicable>

Targeting: <user-selected package or "all">
```

## Per-topology branching

Different topologies require different commands at every step.
The routine uses these substitutions throughout:

### Build commands

| Topology | Command |
|----------|---------|
| single-package | `npm run build` (or pnpm/yarn equivalent) |
| workspaces (npm) | `npm run build --workspaces --if-present` |
| workspaces (pnpm) | `pnpm -r build` |
| workspaces (yarn) | `yarn workspaces foreach -A run build` |
| nx | `nx run-many --target=build --all` |
| turbo | `turbo run build` |
| rush | `rush build` |
| lerna | `lerna run build` |

### Test commands

| Topology | Command |
|----------|---------|
| single-package | `npm test` (or pnpm/yarn equivalent) |
| workspaces (npm) | `npm test --workspaces --if-present` |
| workspaces (pnpm) | `pnpm -r test` |
| workspaces (yarn) | `yarn workspaces foreach -A run test` |
| nx | `nx run-many --target=test --all` |
| turbo | `turbo run test` |
| rush | `rush test` |
| lerna | `lerna run test` |

### Type-check commands

| Topology | Command |
|----------|---------|
| All (when project uses TypeScript) | `npx tsc --noEmit` from each TS project root |
| nx | `nx run-many --target=typecheck --all` |
| turbo | `turbo run typecheck` |

### Outdated detection

| Package manager | Command |
|-----------------|---------|
| npm | `npm outdated --json` |
| pnpm | `pnpm outdated --format json` |
| yarn (v1) | `yarn outdated --json` |
| yarn (berry) | `yarn npm audit --json` (no native outdated; use `yarn upgrade-interactive` or external tool) |

For workspace-aware outdated:
- npm workspaces: `npm outdated --workspaces --json`
- pnpm: `pnpm outdated --format json -r`
- yarn workspaces: per-workspace
- nx/turbo: per-project

### Commit conventions

| Topology | Convention |
|----------|------------|
| single-package | `chore: upgrade <grouping>` |
| workspaces | `chore(<workspace>): upgrade <grouping>` |
| nx/turbo/rush/lerna | `chore(<project>): upgrade <grouping>` |

## Principles

1. **Group by family.** Upgrade related libraries together
   (`@storybook/*`, `@heroui/*`, `react` + `react-dom`, etc.).
2. **Low-to-high risk, always.** Process groupings in strict risk
   order — never jump ahead.
3. **Resolve before advancing.** Every grouping must
   lint+typecheck+test+build (per topology) before touching the
   next.
4. **One grouping, one commit.** Clean git history for easy
   bisect.
5. **Respect peer-dependency constraints.** When peer deps are
   unsatisfied, that's a signal — don't force it with
   `--force` or `--legacy-peer-deps`. Resolve the root cause.
6. **Preserve constraint style.** If `package.json` uses caret
   ranges (`^1.2.3`), keep caret. If it uses exact pins
   (`1.2.3`), keep exact. Style-changing is a separate concern.
7. **Don't cross the Node line.** Upgrading the Node version
   (`engines.node` / `.nvmrc`) is NEVER combined with dep
   upgrades — separate ticket.
8. **Skip prereleases.** Filter alpha/beta/rc/canary/next versions.

## Phase 0: Reconnaissance

### 0.1 Detect topology and inventory

(Done in Step 0.0. Capture topology + package manager.)

```bash
# Wrapper version
case "$PM" in
  npm)  npm --version ;;
  pnpm) pnpm --version ;;
  yarn) yarn --version ;;
esac
node --version
```

### 0.2 Validate Baseline

**Do not upgrade on top of a broken project.**

#### Clean install

```bash
# Per package manager
case "$PM" in
  npm)  rm -rf node_modules && npm ci ;;
  pnpm) rm -rf node_modules && pnpm install --frozen-lockfile ;;
  yarn) rm -rf node_modules && yarn install --frozen-lockfile ;;
esac
```

`ci` / `--frozen-lockfile` ensures lockfile integrity (no
unauthorized updates during install).

#### Lint, type-check, build, test

Run per topology branching tables above. Capture results:

```
Baseline (<root>, topology=<X>):
- Install:                  PASS
- Lint:                     PASS
- Type check (tsc --noEmit): PASS
- Build:                    PASS
- Tests:                    X passed, Y failed, Z skipped
- Baseline commit:          <sha>
```

**If baseline is broken:** Stop immediately. Do not upgrade.

#### Phase 1.5 readiness — consumer apps

In **workspaces / nx / turbo** topologies, identify "consumer
apps" — the entry-point packages that other workspaces feed
into. These are typically apps with `next start`, `vite preview`,
or similar commands.

```bash
# In nx
nx show projects --type=app

# In turbo (look for packages with "start" script)
node -e '
const pkgs = require("./turbo.json").pipeline;
const fs = require("fs");
// list workspace package.json files; filter for those with "start" script
' 2>/dev/null

# In workspaces (manual heuristic)
node -e '
const w = require("./package.json").workspaces;
// Iterate workspaces; check each for "start" script
'
```

This list informs Phase 1.5 (Consumer App Verification) for
upgrades that affect runtime behavior.

### 0.3 Collect Outdated Dependencies

Per package manager (see "Outdated detection" table above). Parse
JSON output for systematic processing.

For monorepo topologies, aggregate outdated across all
workspaces/projects. The same dep at the same version in 5
workspaces is one upgrade target (5 edits per grouping).

### 0.4 Check Security Vulnerabilities

```bash
case "$PM" in
  npm)  npm audit --json ;;
  pnpm) pnpm audit --json ;;
  yarn) yarn npm audit --recursive --json ;;
esac
```

Note vulnerabilities. Per the upgrade archetype: **vulns elevate
the affected grouping by ONE tier; never jump the queue**.

### 0.5 Build the Grouping Plan

Apply family-grouping rules:

**Auto-detect groupings by these rules**:

1. **Scoped families** — every `@scope/*` is its own grouping:
   - `@storybook/*` (Storybook)
   - `@heroui/*` (HeroUI v3)
   - `@tanstack/*` (TanStack Query, Table, etc.)
   - `@radix-ui/*` (Radix primitives)
   - `@types/*` (DefinitelyTyped — special; usually patches/minors
     only; skip if the typed library itself isn't being bumped)
   - `@sentry/*`, `@datadog/*`, `@mui/*`, etc.

2. **Prefix families** — non-scoped libs sharing a prefix:
   - `eslint-*` (ESLint plugins)
   - `prettier-*`
   - `webpack-*`
   - `babel-*`

3. **Framework families** — known co-dependent libs:
   - `react` + `react-dom` + `@types/react` + `@types/react-dom`
   - `next` + `eslint-config-next`
   - `vue` + `vue-router` + `@vue/*`
   - `svelte` + `@sveltejs/*`
   - `astro` + `@astrojs/*`

4. **Build-tool families**:
   - `vite` + `@vitejs/*`
   - `webpack` + `webpack-cli` + loaders
   - `tsup` standalone
   - `esbuild` standalone

5. **Test-framework families**:
   - `vitest` + `@vitest/*`
   - `jest` + `@jest/*` + `babel-jest`
   - `playwright` + `@playwright/*`
   - `cypress` + `@cypress/*`

6. **Standalone packages** — everything else, grouped individually
   or by ad-hoc co-evolution (e.g., `axios`, `zod`, `dayjs`).

When a family contains a mix of bump types (some patch, one major),
classify the entire family by its highest bump type.

### 0.6 Sort Groupings into Execution Order

Standard tier structure (low risk → high risk):

#### Tier 1 — Patches (Lowest Risk)

| Order | Category |
|-------|----------|
| 1.1 | `@types/*` patches |
| 1.2 | Test framework patches |
| 1.3 | Build tool patches |
| 1.4 | Lint/format tool patches |
| 1.5 | UI component family patches (`@storybook/*`, `@heroui/*`, `@radix-ui/*`) |
| 1.6 | SDK / utility patches (axios, zod, dayjs, etc.) |
| 1.7 | i18n patches |
| 1.8 | Misc standalone patches |

#### Tier 2 — Minors (Low-Medium Risk)

| Order | Category |
|-------|----------|
| 2.1 | `@types/*` minors |
| 2.2 | Test framework minors |
| 2.3 | Build tool minors |
| 2.4 | Lint/format minors |
| 2.5 | UI component family minors |
| 2.6 | SDK / utility minors |
| 2.7 | i18n minors |
| 2.8 | Other standalone minors |

#### Tier 3 — Majors (High Risk)

**Strict ordering within Tier 3. Each line is sequential.**

| Order | Category | Why this position |
|-------|----------|-------------------|
| 3.1 | Dev tool majors (eslint, prettier, biome) | Lowest blast radius — config changes |
| 3.2 | Test framework majors (vitest, jest, playwright) | Test rewrites possible; isolated from runtime |
| 3.3 | Build tool majors (vite, webpack, tsup, esbuild) | Build pipeline changes; rebuild-only |
| 3.4 | TypeScript major (`typescript` package) | Type-system changes; widespread |
| 3.5 | UI component family majors (`@storybook/*`, `@heroui/*`, `@radix-ui/*`) | Component API changes; widespread |
| 3.6 | SDK majors (`@sentry/*`, `@datadog/*`, AWS SDK) | Runtime API changes |
| 3.7 | i18n majors (`next-intl`, `i18next`) | Translation API + typing |
| 3.8 | React major (`react`, `react-dom`, `@types/react`) | Runtime + every component compatibility |
| 3.9 | Next.js / Vue / framework major | Highest blast radius — build + runtime + routing |

Reordering Tier 3 is a guard rail violation. The order is
designed to surface risk progressively.

#### Tier 4 — Security Remediation (after all tiers)

Re-audit and fix remaining vulnerabilities.

### 0.7 Present the Grouping Plan

Present the sorted plan as a numbered checklist showing tier,
grouping name, package count, and bump types. Mark security-
flagged groupings with elevation note.

## Phase 1: Execute Groupings (in tier order)

For each grouping in tier order:

### Step 1 — Update version

Edit `package.json` for each affected workspace/project:

```bash
# Per package manager
case "$PM" in
  npm)  npm install <pkg>@<new-version> --save ;;
  pnpm) pnpm add <pkg>@<new-version> ;;
  yarn) yarn add <pkg>@<new-version> ;;
esac
```

Preserve constraint style (caret stays caret; pin stays pin).

For monorepos with the same dep across multiple workspaces, edit
each workspace OR use the workspace-aware command:

```bash
# pnpm — bump in all workspaces declaring it
pnpm -r update <pkg>@<new-version>

# nx — use migration generators when the lib provides them
nx migrate <pkg>@<new-version>
nx migrate --run-migrations
```

### Step 2 — Install

```bash
case "$PM" in
  npm)  npm install ;;
  pnpm) pnpm install ;;
  yarn) yarn install ;;
esac
```

If install fails with peer-dependency errors:
- **Read the error carefully** — peer constraints reveal the
  intended compat matrix
- **Don't use `--force` / `--legacy-peer-deps`** — these mask
  problems
- **Skip the grouping** if peer constraints can't be satisfied
  cleanly; document as "pending peer-compatible companion"

### Step 3 — Type check

```bash
# Single TS project
npx tsc --noEmit

# Multi-project (per topology)
# nx:    nx run-many --target=typecheck
# turbo: turbo run typecheck
```

Resolve type errors. If they're breaking-change-related (renamed
types, removed exports), either:
1. Apply the migration (preferred when straightforward)
2. Skip and document as a major-migration follow-up

### Step 4 — Lint

```bash
# Per project's lint command
npm run lint
# or biome / eslint directly
```

### Step 5 — Build

Per topology branching (Build commands table above).

Build failures often indicate:
- Module resolution changed (CJS/ESM interop)
- Tree-shaking changed (export structure)
- Bundler plugin compatibility broke

### Step 6 — Component pattern change detection (UI family bumps)

When upgrading UI component families (`@heroui/*`, `@radix-ui/*`,
`@mui/*`, `@chakra-ui/*`), watch for **component pattern changes**
between versions:

| Pattern change | Detection | Migration |
|----------------|-----------|-----------|
| Flat → Compound | Single `<Card>` → `<Card.Root><Card.Header>...` | Refactor consumers |
| Props → Children | `<Modal title="X">` → `<Modal><Modal.Title>X</Modal.Title>` | Refactor consumers |
| Single → Slots | `<Select>` → `<Select.Trigger />`, `<Select.Content />` | Refactor consumers |
| Variant API | `variant="primary"` → `<Button.Primary>` | Refactor consumers |

These changes propagate widely and may make a "minor" bump
effectively a major migration. Read changelogs before assuming
the bump is safe.

### Step 7 — Tailwind / CSS integration change detection

When upgrading UI families, also watch CSS integration changes:

- Tailwind preset changes (preset config moved to a different
  package or restructured)
- CSS-in-JS engine changes (emotion → vanilla-extract, etc.)
- Theme provider API changes
- Token system changes

Verify the project's Tailwind config / CSS setup still applies.

### Step 8 — CJS interop check (build-output libraries)

When upgrading libraries that produce build outputs (compiled
distributions consumed by the project's bundler), check the
output for CJS/ESM dual-format:

```bash
# Inspect node_modules/<pkg>/package.json
cat node_modules/<pkg>/package.json | jq '{main, module, types, exports}'
```

If the package switched from CJS-only to ESM-only (or vice
versa), the bundler may need configuration. A library bumping
to ESM-only when the project's bundler is CJS-only breaks at
runtime, not build time.

### Step 9 — Phase 1.5: Consumer App Verification (workspace topologies)

For workspaces / nx / turbo, after a grouping that affects
runtime (UI families, framework, runtime SDKs), verify that
**consumer apps still start** in addition to the build passing:

```bash
# Identify consumer apps from Phase 0 readiness check
# For each consumer app:
cd <consumer-app-path>
npm run start &  # or pnpm start / yarn start
SERVER_PID=$!
npx wait-on http://localhost:<port> --timeout 60000
curl -sf http://localhost:<port> | head -20
kill $SERVER_PID
```

If the project has E2E tests in mock mode (no backend dependency),
run those:

```bash
# Common pattern
SKIP_WEBSERVER=true npm run test:regression
```

This catches runtime regressions that builds miss (broken
component renders, missing exports, hydration mismatches).

In single-package topology, Phase 1.5 is skipped — there's no
consumer/library distinction.

### Step 10 — Test

```bash
# Per topology branching (Test commands table)
npm test  # or workspace-aware variant
```

### Step 11 — Commit

```
chore(<workspace>): upgrade <grouping>

<package>: <old> → <new>
<package>: <old> → <new>

Validation:
- Install:           PASS
- Type check:        PASS
- Lint:              PASS
- Build:             PASS
- Tests:             X passed
- Consumer apps (P1.5): <PASS|N/A>
```

For single-package: `chore: upgrade <grouping>` (no scope).
For workspace topologies: scope per "Commit conventions" table.

### Step 12 — Advance

Automatically proceed to the next grouping.

## Major Bump Pre-Flight (Tier 3 only)

Before any Tier 3 major bump:

### Fetch Migration Guide via context7

```
mcp__context7__resolve-library-id → "react" | "next" | "@storybook/react" | etc.
mcp__context7__query-docs → "<library> migration v<old> to v<new>"
```

Key things to extract for each library type:

**React majors** (16 → 17, 17 → 18, 18 → 19):
- Concurrent features (18+)
- Server Components (19+)
- Removed lifecycle methods
- Deprecated APIs becoming hard errors

**Next.js majors**:
- App Router vs Pages Router (12 → 13)
- React Server Components changes
- Caching behavior (14 → 15)
- ESM-only dependencies

**Storybook majors** (6 → 7, 7 → 8, 8 → 9):
- CSF format changes (CSF2 → CSF3)
- Story args/argTypes API
- Builder changes (webpack → vite)
- Test runner integration

**TypeScript majors**:
- Strictness defaults
- Removed deprecated options (`suppressImplicitAnyIndexErrors`,
  etc.)
- New errors revealed by stricter inference

### Check engines.node compatibility

```bash
node -e 'console.log(require("./package.json").engines)'
```

Some library majors require newer Node:

| Library | Min Node |
|---------|----------|
| Next.js 15 | 18.18 |
| Storybook 8 | 18.0 |
| Vite 5 | 18.0 |
| TypeScript 5 | 14.17 |

If the project's `engines.node` is below the minimum, that's a
SEPARATE migration. Don't bundle it.

### Component-pattern-change reconnaissance

For UI family majors, do a sweep of the codebase for usage
patterns that the new version changes:

```bash
# Example: HeroUI v2 → v3 changed Modal API
grep -rn "<Modal title=" --include="*.tsx" --include="*.ts" .
# All these need migration to compound API
```

Estimate the migration cost from the count. If too high, defer
the major to a dedicated migration PR rather than in-cycle.

## Phase 2: Security Remediation

After all family groupings:

```bash
case "$PM" in
  npm)  npm audit --json ;;
  pnpm) pnpm audit --json ;;
  yarn) yarn npm audit --recursive --json ;;
esac
```

For remaining vulnerabilities:
- Patch/minor within an already-upgraded package: apply directly
- Major bump for the fix: full Phase 1 cycle for that single
  grouping
- **Never use `npm audit fix --force`** — ignores semver and
  breaks things silently
- Vulns with no fix available: document with severity + exploit
  context

## Phase 3: Final Verification

Run the full gate one last time:

```bash
# Per topology
case "$PM" in
  npm)  npm ci ;;
  pnpm) pnpm install --frozen-lockfile ;;
  yarn) yarn install --frozen-lockfile ;;
esac

# Lint, type-check, build, test (per topology branching tables)
npm run lint
npx tsc --noEmit
# build per topology
# test per topology

# Outdated re-check
case "$PM" in
  npm)  npm outdated ;;
  pnpm) pnpm outdated ;;
  yarn) yarn outdated ;;
esac

# Audit re-check
npm audit  # or pnpm/yarn equivalent
```

Compare before/after:
- Outdated count: fewer (ideally zero)
- Vulnerability count: fewer (ideally zero)
- Lint/type-check/build/test: PASS

## Phase 4: Report

```
## npm Dependency Upgrade Report for <root>

### Topology
- Package manager: <npm|pnpm|yarn>
- Inner topology:  <single-package|workspaces|nx|turbo|...>
- Workspaces:      <list when applicable>

### Completed Groupings (in execution order)
| # | Tier | Grouping | Packages | Status |
|---|------|----------|----------|--------|
| 1 | 1.1 | @types/* patches            | 4 | DONE |
| 2 | 1.2 | vitest + @vitest/* patches  | 3 | DONE |
| 3 | 2.5 | @storybook/* minors         | 12 | DONE |
| 4 | 2.5 | @heroui/* minors            | 8 | DONE |
| 5 | 3.5 | @storybook/* major (8 → 9)  | 12 | SKIPPED — CSF3 migration needed |
| 6 | 3.8 | react + react-dom 18 → 19   | 4 | SKIPPED — Server Components migration |
...

### Skipped / Pinned
| Grouping | Reason |
|----------|--------|
| @storybook/* major | CSF3 migration affects 47 stories; needs dedicated PR |
| react 18 → 19 | Server Components opt-in needed in app router; major migration |

### Security
- Vulnerabilities before: X
- Vulnerabilities after:  Y
- Remaining: <details>

### Final Gate
- Install:           PASS
- Lint:              PASS
- Type check:        PASS
- Build:             PASS (per topology)
- Tests:             X passed
- Consumer apps (P1.5): <PASS|N/A>
```

## Multi-package Mode (`all`)

When the user specifies `all` or omits the argument:

1. **Detect all workspaces/projects** per topology layer
2. **Run Phase 0 across all** — aggregate outdated lists; identify
   shared families (deps that appear in multiple workspaces)
3. **Build cross-workspace grouping plan** — shared families are
   one logical grouping executed workspace-by-workspace
4. **Execute in risk order across workspaces** — each grouping
   gates per workspace independently
5. **If one workspace fails a grouping, skip for that workspace
   only** — others continue
6. **Commit per workspace per grouping** — `chore(<workspace>): ...`

For single-package, `all` is equivalent to the single package.

## Guard Rails

- **Never use `npm audit fix --force`** — ignores semver
- **Never use `--legacy-peer-deps`** — masks peer conflicts
- **Never use `--force` on install** — same issue
- **Always run `tsc --noEmit` after install** — catches type
  changes early
- **Never blindly bump `engines.node` / `.nvmrc`** — separate
  migration
- **Never blindly upgrade React** — Server Components, concurrent
  features, etc. need migration discipline
- **Watch for component pattern changes** — flat-to-compound API
  migrations turn "minor" bumps into widespread refactors
- **Watch CJS/ESM interop** — package format changes break
  bundlers silently
- **Plugin/preset versions are versions too** — `eslint-*`,
  `babel-*`, etc. need the same grouping discipline
- **One grouping, one commit** — never combine in one commit
- **Rollback is normal** — if a grouping can't resolve cleanly,
  skip and document
- **Never reorder risk tiers** — the low-to-high order is the
  routine's identity
- **Skip prereleases** — alpha/beta/rc/canary/next versions
  filtered unless project already uses them for that package

## Rollback

If a grouping fails mid-resolution:

```bash
# Discard package.json + lockfile changes
git checkout -- package.json package-lock.json pnpm-lock.yaml yarn.lock
git checkout -- '**/package.json'  # workspace package.json files

# Refresh node_modules from committed state
rm -rf node_modules
case "$PM" in
  npm)  npm ci ;;
  pnpm) pnpm install --frozen-lockfile ;;
  yarn) yarn install --frozen-lockfile ;;
esac
```

If the entire upgrade session needs to be undone:

```bash
git log --oneline -20
# Ask user before resetting
```

Never force-reset without user confirmation.

## Interaction with Sibling Upgrade Commands

This routine is one of the dep-upgrade family in
`engineer/maintenance/upgrades/`. **Never interleave** sister upgraders:

| Routine | Scope | Branch convention |
|---|---|---|
| `/engineer:maintenance:upgrades:npm-deps` | npm/JS (this routine) | `chore/npm-upgrade-<date>` |
| `/engineer:maintenance:upgrades:gradle-deps` | Gradle/JVM | `chore/gradle-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:maven-deps` | Maven/JVM | `chore/maven-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:infra-deps` | Infra | `chore/infra-deps-upgrade-<date>` |

Run one to completion (CI green or all groupings committed),
push and open the PR, THEN start the next. The
`polyglot-maintenance-cycle` workflow's state machine enforces
this — it won't start a sister upgrade routine until the current
one's branch is committed/PR'd.

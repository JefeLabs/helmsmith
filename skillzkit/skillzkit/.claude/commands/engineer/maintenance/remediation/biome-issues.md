---
type: remediator
description: Systematically resolve Biome lint errors and warnings across the codebase. Work rule-by-rule, prioritizing auto-fixable rules first, then manual fixes grouped by impact. Promotes warn → error after cleanup to prevent regression.
argument-hint: [<rule-name>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/remediation/_context.md`
> (remediation archetype patterns), `product/strategy/_context.md`.
>
> This routine assumes a project with **Biome configured** (a
> `biome.json` at the project root). It reads rule severities and
> auto-fix metadata from Biome's output. The specific rules and
> counts surfaced will vary by project; the structure below is
> the canonical workflow.

Systematically resolve Biome lint errors and warnings. Work
rule-by-rule, prioritizing auto-fixable rules first, then manual
fixes grouped by impact.

**Invoke with:** `/engineer:maintenance:remediation:biome-issues` +
optional rule name (e.g., `noUnusedImports`)

## Step 0.0 — Topology detection

Detect which directories contain Biome-managed code. This routine
is structurally agnostic to repository topology, but command paths
and verification commands need to be adapted:

```bash
# Find biome.json files (each indicates a Biome-configured project root)
find . -maxdepth 4 -name "biome.json" -not -path "*/node_modules/*"
```

For each Biome root found, the routine targets that root for its
work. When multiple Biome configs exist (rare; usually monorepos
with per-package overrides), the routine prompts the user to pick
or runs sequentially.

Detection output:

```
Biome roots detected:
- ./app-ui/biome.json
- (single configured project)

Targeting: app-ui/
```

The remainder of this document uses `<biome-root>` to refer to
the targeted directory; substitute the actual path in commands.

## Rule Inventory

Rule counts and severity vary by project; capture the current
state at the start of each run. The example tables below reflect
a project mid-cleanup (the SkoolScout `app-ui/` codebase, when
this routine was first written). Treat them as illustrative; run
the assessment command (Step 1 below) to get current counts.

### Errors (must fix — block CI)

| Rule | Auto-fix | Category |
|------|----------|----------|
| `style/useSingleVarDeclarator` | Yes | Split `const a, b` into separate declarations |
| `style/noDefaultExport` | No | Convert to named exports (skip framework-required defaults) |
| `style/useFilenamingConvention` | No | Rename files to match convention rules |
| `correctness/noInnerDeclarations` | No | Move function/var declarations out of blocks |
| `style/noParameterAssign` | No | Stop reassigning function parameters |
| `suspicious/useIterableCallbackReturn` | No | Add return in array callbacks |
| `suspicious/noSelfCompare` | No | Remove `x === x` comparisons |
| `correctness/noInvalidUseBeforeDeclaration` | No | Reorder declarations |
| `style/useDefaultParameterLast` | No | Move default params to end |
| `suspicious/noShadowRestrictedNames` | No | Rename shadowed builtins |
| `correctness/noInvalidPositionAtImportRule` | No | Fix CSS @import ordering |

### Warnings (should fix — clean up incrementally)

| Rule | Auto-fix | Category |
|------|----------|----------|
| `correctness/noUnusedImports` | Yes | Remove dead imports |
| `suspicious/noExplicitAny` | No | Replace `any` with proper types |
| `correctness/noUnusedFunctionParameters` | Yes | Prefix unused params with `_` |
| `correctness/noUnusedVariables` | No | Remove or use dead variables |
| `correctness/useExhaustiveDependencies` | No | Fix React hook deps |
| `suspicious/noArrayIndexKey` | No | Use stable keys instead of index |
| `correctness/useHookAtTopLevel` | No | Move hooks out of conditionals |
| `complexity/useOptionalChain` | Yes | Convert `a && a.b` to `a?.b` |
| `suspicious/noGlobalIsNan` | Yes | Use `Number.isNaN()` |
| `style/noNonNullAssertion` | No | Replace `!` with proper checks |
| `performance/noImgElement` | No | Use framework-appropriate Image |
| `performance/noDelete` | No | Use destructuring or Map |
| `complexity/noBannedTypes` | No | Replace `{}`, `Function`, `Object` |

## Phase 0 — Reconnaissance: Assess Current State

```bash
cd <biome-root>
npx biome lint . --diagnostic-level=error 2>&1 \
  | grep -oE 'lint/[a-zA-Z]+/[a-zA-Z]+' \
  | sort | uniq -c | sort -rn
```

This produces the actual rule-by-rule count for the current
project state. Compare to the rule inventory above to classify
errors vs warnings.

Document the discovery in the routine's report:

```
Biome Issues Discovery — <date>

Project: <biome-root>
Biome version: <captured from biome --version>

Errors:
  <rule-1>: <count>
  <rule-2>: <count>
  ...

Warnings:
  <rule-1>: <count>
  ...

Total errors:   <sum>
Total warnings: <sum>
```

## Phase 1 — Auto-fixable Rules

Apply Biome's safe auto-fixes in bulk. Rules with auto-fix support
can be resolved without per-file inspection.

```bash
# Dry-run first to review what changes
cd <biome-root>
npx biome lint . --fix --dry-run 2>&1 | tail -20

# Apply safe fixes
npx biome lint . --fix
```

**Rules typically resolved**: `noUnusedImports`,
`useSingleVarDeclarator`, `noUnusedFunctionParameters`,
`useOptionalChain`, `noGlobalIsNan`.

After applying:

1. Run `npx tsc --noEmit` — verify no type errors introduced
2. Run the project's build command — verify it passes
3. Commit: `style: apply Biome auto-fixes (<list of rules>)`

## Phase 2 — `noDefaultExport` (manual)

**Important**: framework-required default exports are exempt:

- **Next.js**: `app/**/page.tsx`, `app/**/layout.tsx`,
  `app/**/loading.tsx`, `app/**/error.tsx`,
  `app/**/not-found.tsx`, `app/**/template.tsx`,
  `app/**/route.ts`
- **Storybook**: meta default exports in `*.stories.tsx`
- **Other frameworks**: document per-framework exemptions in the
  project's CLAUDE.md or `biome.json`

For each batch (~20-30 files at a time):

1. Find targets:
   ```bash
   npx biome lint <scope-dir> --diagnostic-level=error 2>&1 \
     | grep noDefaultExport
   ```
2. Convert `export default function Foo` → `export function Foo`
3. Update all import sites: `import Foo from` →
   `import { Foo } from`
4. Run `npx tsc --noEmit` after each batch
5. Commit: `refactor: convert default exports to named exports in <area>`

## Phase 3 — `useFilenamingConvention` (manual)

Follow the convention rules from the project's `biome.json`.
Common conventions:

- `.tsx` → PascalCase or kebab-case
- `.ts` → PascalCase or kebab-case
- `use*.ts` / `use*.tsx` → camelCase (hooks)
- Everything else → kebab-case

For each batch:

1. `git mv` the file to the correct name (use `git mv` not `mv`
   — case-insensitive filesystems on macOS need git's tracking)
2. Update all import references
3. Update barrel `index.ts` files
4. Run `npx tsc --noEmit`
5. Commit: `refactor: rename files to match Biome naming convention in <area>`

## Phase 4 — Correctness Errors (manual)

Work through remaining error-level rules in priority order:

1. **`noInnerDeclarations`** — move function declarations to
   module scope or convert to `const` arrow functions
2. **`noParameterAssign`** — create local copies:
   `const localParam = param`
3. **`noInvalidUseBeforeDeclaration`** — reorder code so
   declarations come before use
4. **`noSelfCompare`** — usually NaN checks; replace with
   `Number.isNaN()`
5. **`useDefaultParameterLast`** — reorder function parameters
6. **Others** — fix individually

## Phase 5 — Warnings Cleanup (incremental — ongoing)

Tackle warning-level rules from highest count down. These don't
block CI but improve code quality:

1. **`noExplicitAny`** — add proper types. Start with public API
   surfaces.
2. **`noUnusedVariables`** — remove dead code or prefix with `_`
3. **`useExhaustiveDependencies`** — audit hook deps **carefully**
   (don't blindly add — see guard rails)
4. **`noArrayIndexKey`** — add stable `id` or `key` fields to data
5. **`useHookAtTopLevel`** — restructure conditional hook calls
6. **Remaining** — fix individually

## Step-by-Step Workflow

When invoked, follow this loop:

### 1. Pick the Target Rule

If a specific rule was provided in the invocation (`$ARGUMENTS`),
work on that one. Otherwise, follow the phase order above. Prefer
auto-fixable rules first.

### 2. Scope the Work

Find all affected files for the target rule:

```bash
cd <biome-root>
npx biome lint . --max-diagnostics=5000 --diagnostic-level=error 2>&1 \
  | grep "<rule-name>" | grep "^ at " \
  | awk '{print $2}' | cut -d: -f1 | sort -u
```

### 3. Fix in Batches

- **Auto-fixable**: Run `npx biome lint . --fix` scoped to the rule
- **Manual**: Fix 20-30 files per batch. Group by directory.

### 4. Verify After Each Batch

```bash
cd <biome-root>
npx tsc --noEmit                                 # Type check
npx biome lint . --diagnostic-level=error 2>&1 \
  | grep -c "<rule-name>"                        # Count remaining
```

### 5. Commit Each Batch

Use conventional commits:
- `style:` for formatting/import changes
- `refactor:` for code structure changes (renames, export conversions)
- `fix:` for correctness issues

Topology-aware commit scope (per `engineer/maintenance/_context.md`):
- Single-package: `chore: ...`
- Workspaces: `chore(<workspace>): ...`
- Nx/Turbo: `chore(<project>): ...`

### 6. Repeat Until Clean

Continue until the target rule has zero violations, then move to
the next rule.

## Promotion Strategy — Anti-Drift Discipline

As each rule reaches zero violations, **promote it from `warn` to
`error`** in `biome.json` to prevent regression:

```bash
# In biome.json, change:
"noUnusedImports": "warn"
# to:
"noUnusedImports": "error"
```

Commit: `chore: promote Biome rule <rule-name> from warn to error`

This is the routine's anti-drift mechanism — once cleaned up, the
bar stays raised. The next time someone introduces a violation,
CI fails before the PR merges rather than the violation
accumulating silently.

## Guard Rails

- **Never auto-fix `useExhaustiveDependencies`** — blindly adding
  deps causes infinite loops. Audit each case manually.
- **Never convert framework-required default exports** — document
  per-framework exemptions; respect them.
- **Always run `tsc --noEmit` after fixes** — Biome fixes can
  break TypeScript.
- **Always run the project's build before committing large
  batches** — catch build-tool errors (Turbopack, Vite, etc.) early.
- **Batch size ~20-30 files** — small enough to review, large
  enough to make progress.
- **3-strike rule** — if a batch can't pass verification after 3
  fix attempts, skip and document in the report. Never
  auto-revert.
- **Never cross routine scope** — Biome remediator does NOT fix
  dependency-upgrade-shaped issues, atomic-design issues, or
  test-coverage gaps. Document out-of-scope findings; don't act
  on them.

## Discovery vs execution gap

This routine has historically been implicit on the discovery →
user-checkpoint pattern (per `remediation/_context.md`). When the
project has a small number of issues (<50 total), proceeding
directly to Phase 1 is reasonable. When the project has many
issues (hundreds/thousands), surface the discovery report and
ask the user which rules to address this run before proceeding.

## Final Verification Gate

**Mandatory before reporting completion. Do not skip any step.**

### 1. Lint Check

```bash
cd <biome-root>
npx biome lint . --diagnostic-level=error 2>&1 | grep -E "^(Checked|Found)"
# Must show: Found 0 errors.
```

### 2. Clean Build

```bash
cd <project-root>

# Clean previous build artifacts (paths ecosystem-specific)
# Common patterns:
#   rm -rf <biome-root>/.next       (Next.js)
#   rm -rf <biome-root>/dist        (Vite/tsup)
#   rm -rf <biome-root>/build       (CRA)
rm -rf <biome-root>/.next <biome-root>/node_modules/.cache

# Fresh install (use the project's install command)
# Common: make install / npm i / pnpm install / yarn

# Production build (use the project's build command)
# Common: npm run build / make build / pnpm build
```

Build must exit 0 with no build-tool errors.

### 3. Start Dev Server & Confirm Rendering

```bash
# Start dev server (project's dev command)
# Common: npm run dev / pnpm dev / make dev

# Wait for ready
npx wait-on http://localhost:3000 --timeout 120000

# Confirm app renders (not blank/error)
curl -sf http://localhost:3000 | grep -q '<div id="__next"\|<div id="root"\|<body' \
  && echo "PASS: App renders" || echo "FAIL: App not rendering"
```

If a browser-automation MCP (Chrome DevTools, Playwright) is
available, take a screenshot to visually confirm.

### 4. Run E2E Regression Tests

If the project has e2e tests:

```bash
cd <e2e-root>  # may differ from <biome-root>
# Use the project's regression test command
# Common: SKIP_WEBSERVER=true npm run test:regression
```

Must show: passed, 0 failures.

### 5. Report

Only after all 4 gates pass, send completion report with:

- **Lint summary**: `Found 0 errors` output
- **Build status**: build command exit code 0
- **Dev server**: confirmed rendering
- **E2E regression**: all tests passed
- **Rules promoted**: list of rules moved from `warn` → `error`
- **Commits created**: list with conventional commit messages
- **Any deviations**: explain anything skipped or done differently

**If any gate fails**: do not report completion. Fix the issue,
re-run the failing gate, and only then proceed.

## Completion Criteria

The remediator is done when:

```bash
cd <biome-root>
npx biome lint . --diagnostic-level=error 2>&1 | grep "Found 0 errors"
```

All previously-warned rules have been promoted to error in
`biome.json`, preventing regression. The app builds, renders, and
passes e2e regression.

## Cross-routine awareness

This routine produces output relevant to other routines:

- **After biome cleanup**, the codebase is in a stable state for
  dependency upgrades. Run `/engineer:maintenance:upgrades:npm-deps` next
  if both are on the maintenance plan.
- **Before atomic-design remediation** is the wrong order — Biome
  fixes file naming and exports that atomic-design also touches;
  run Biome first.
- **`noUnusedImports` cleanup** may surface unused dependencies
  that the future `unused-dependencies` cleanup routine would
  remove. Note for follow-up; don't act on it here.

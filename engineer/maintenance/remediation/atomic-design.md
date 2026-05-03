---
type: remediator
description: Systematically scan the components directory for atomic-design convention violations, report findings, and — with user approval — refactor components into compliance. Project-specific: rules and structure adapt to the project's atomic-design taxonomy.
argument-hint: [<scope>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/remediation/_context.md`
> (remediation archetype patterns), `product/strategy/_context.md`.
>
> **This routine is project-specific.** Atomic-design rules vary
> by project (some use Brad Frost's 5-tier model strictly; some
> add layers; some use different terminology). The structure
> below — rule numbering, severity classification, phased
> execution, 3-tier verification — is the portable template.
> The specific rules (AD-1 through AD-15 in the source project)
> are illustrative; projects adopting this routine adapt the
> rules to their own taxonomy.
>
> **Originating project**: SkoolScout's `app-ui/`, with 5 distinct
> apps (`admin`, `discover-schools`, `discover-students`,
> `platform`, `public`) plus shared `core/`. Other projects with
> atomic-design adopt the structure and rewrite the rules.

Systematically scan the components directory for atomic-design
convention violations, report findings, and — with user approval
— refactor components into compliance. Works in scan-first,
fix-later batches so every change is reviewable.

**Invoke with:** `/engineer:maintenance:remediation:atomic-design` +
optional scope (e.g., `core/atoms` or `<feature-name>`)

## Step 0.0 — Topology detection

Detect components root and atomic-design configuration:

```bash
# Find components directory (project-specific path)
# Common: app-ui/components, src/components, packages/ui/src
find . -type d -name "components" -not -path "*/node_modules/*" \
  -not -path "*/.next/*" -maxdepth 5

# Look for atomic-design taxonomy markers
find . -name "CLAUDE.md" -path "*/components/*" -maxdepth 5
```

The routine assumes:

1. **A `components/` directory** at a known location (configurable)
2. **Atomic-design taxonomy** documented in a project file (often
   `components/CLAUDE.md` or similar)
3. **A multi-app structure** where some components are shared
   (often `core/`) and others are app-specific

When the project's structure differs, the routine's rules need
adaptation. Document the project-specific assumptions at the top
of the routine's invocation report.

## Project-Specific Architecture (originating example)

The originating project has **5 distinct applications** under
`app-ui/components/` plus shared `core/`. Other projects adapt:

| App directory | Purpose |
|---------------|---------|
| `admin/` | Admin-only components |
| `discover-schools/` | School discovery feature |
| `discover-students/` | Student discovery feature |
| `platform/` | Platform infrastructure (auth, payments) |
| `public/` | Public-facing pages (no auth) |

Plus `core/` which holds **globally shared** components.

### Atomic Design Levels (per Brad Frost)

| Level | Definition | Classification test | Examples |
|-------|-----------|---------------------|----------|
| **Atoms** | Foundational building blocks that cannot be broken down further without losing functionality. Stateless, single-purpose. | Can this be decomposed into smaller UI elements? If no → atom. | Button, Icon, Avatar, Input, Link, Rating, Chip, Badge |
| **Molecules** | Simple groups of atoms functioning together as a unit. Follow single responsibility — "do one thing and do it well." | Does it combine 2-3 atoms into a functional whole? If yes → molecule. | Search form, Card, FormField, DateDisplay, TagGroup |
| **Organisms** | Complex UI components that form **distinct sections** of an interface. Compose molecules, atoms, and/or other organisms. | Does it represent a standalone, recognizable section? If yes → organism. Organisms CAN compose other organisms. | Header, Navbar, Sidebar, ProductGrid, StudentProfile, Calendar |
| **Templates** | Page-level layouts that place organisms into a spatial structure. Show the **content skeleton** — where things go, not what they say. Use placeholder content. | Does it define *where content goes* without caring *what content is*? If yes → template. | ContentLayout, WorkspaceLayout, SectionLayout, TwoColumnTemplate |
| **Pages** | Specific instances of templates filled with **real representative content**. What users actually see. Test whether the design system serves real content. | Does it compose a template + organisms + real data? If yes → page. Multiple pages can instantiate the same template with different content. | HomeDashboard, MyEventsCalendarLayout, CandidateDetails |

### Placement Rules

- **Atoms and molecules → `core/` always.** These are the shared
  design vocabulary. If an atom or molecule lives inside a feature
  directory (`<feature>/atoms/`, `<feature>/molecules/`), it is a
  violation — it should be moved to `core/atoms/` or
  `core/molecules/` so all apps can reuse it.
- **Organisms → `core/` OR feature directory.** An organism reused
  across apps belongs in `core/organisms/`. One specific to a
  single app (e.g., a school-specific navbar) legitimately lives
  in that app's `organisms/` directory.
- **Templates → `core/templates/` OR feature directory.** Templates
  define layout structure with placeholder content. They should
  NOT fetch data or contain business logic.
- **Pages → feature `pages/` directories OR app-router directories.**
  Pages are templates filled with real content and data.
- **Feature directory structure** follows a standard layout. Each
  feature owns its full atomic stack plus data fetching:
  ```
  <feature>/
  ├── organisms/       ← feature-specific organisms (pure view)
  ├── templates/       ← feature-specific layout skeletons
  ├── pages/           ← templates + organisms + real data
  ├── hooks/           ← TanStack Query hooks
  ├── mocks/           ← MSW handlers + fixtures
  │   ├── fixtures.ts
  │   ├── handlers.ts
  │   └── index.ts
  └── README.md
  ```
  `hooks/` and `mocks/` live at the feature root, NOT nested
  inside `section/` or `organisms/`.

## Conventions Enforced (project-specific rules)

These rules come from the originating project's
`components/CLAUDE.md` and `app-ui/CLAUDE.md`. Other projects
adopting this routine rewrite the rules to match their own
conventions while preserving the structure (numbered rules,
severity classification, phased execution).

| # | Rule | Where checked | Severity |
|---|------|---------------|----------|
| AD-1 | **Atoms must be stateless, single-purpose UI elements** — no composition of other atoms, no data fetching | `core/atoms/` | error |
| AD-2 | **Molecules compose 2-3 atoms** — must import from `core/atoms/`; if they compose other molecules or organisms, they belong at a higher level | `core/molecules/` | error |
| AD-3 | **Organisms are complex, self-contained UI sections** — compose atoms, molecules, and/or other organisms. Form distinct sections. Must not fetch data. Organisms CAN compose other organisms. | `core/organisms/` + feature dirs | error |
| AD-4 | **Templates define content skeleton, not content itself** — place organisms into spatial layout with placeholder content. Must NOT fetch data or contain business logic. | `core/templates/` + feature dirs | error |
| AD-5 | **core/ components are pure view components** — no `useQuery`, `useMutation`, `useSuspenseQuery`, or direct fetch calls | `core/**` | error |
| AD-6 | **Feature data fetching uses flat `hooks/` + `mocks/` at feature root** — no nested `section/` wrapper | feature dirs | error |
| AD-7 | **Every visual component has a `.stories.tsx`** | all `.tsx` components | warn |
| AD-8 | **Every component directory has an `index.ts` barrel** | all component dirs | warn |
| AD-9 | **Named exports only** — no `export default` except Storybook meta and Next.js special files | all `.tsx`/`.ts` | error |
| AD-10 | **No component duplication** — feature components must not duplicate `core/` components | feature dirs | error |
| AD-11 | **Atoms and molecules must live in `core/`** — feature directories must NOT contain `atoms/` or `molecules/` subdirectories | feature dirs | error |
| AD-12 | **File naming** — `.tsx` = PascalCase or kebab-case; hooks = `use*.ts` camelCase; barrel = `index.ts` | all | warn |
| AD-13 | **`features/` directory must not exist** — `components/features/` is invalid; relocate contents to app or core | `features/` | error |
| AD-14 | **Non-special components in `app/` route directories must be classified** — `.tsx` files in `app/` that are NOT framework special files (`page.tsx`, `layout.tsx`, etc.) are misplaced; classify and move to `components/` | `app/**` | warn |
| AD-15 | **Templates must not fetch data; pages must not live in `organisms/`** — apply Brad Frost classification test | all feature dirs | warn |

## Principles

1. **Scan everything, fix nothing** until the user sees the full
   report and approves
2. **Batch by violation type** — one rule at a time, not one file
   at a time
3. **Verify after every batch** — `npx tsc --noEmit` + `npx biome check .`
   must pass
4. **One commit per batch** — clean git history for easy rollback
5. **Never move a file without updating all import references** —
   use grep to find every consumer
6. **Prompt before destructive changes** — moving components
   between atomic levels or deleting duplicates requires explicit
   user approval
7. **Atoms and molecules belong in `core/`** — feature directories
   should only contain organisms, templates, sections, and hooks

## Phase 0 — Reconnaissance: Full Scan

### Step 0.1 — Inventory all component directories

```bash
# Configurable; default is app-ui/components in the originating project
find <components-root> -type d -not -path '*/node_modules/*' \
  -not -path '*/.next/*' | sort
```

### Step 0.2 — Run violation checks

For each rule, scan programmatically. Examples:

**AD-1 — Atoms composing atoms:**
```bash
grep -rn "from.*@core/atoms\|from.*core/atoms\|from.*\.\./\.\." \
  <components-root>/core/atoms/ \
  --include="*.tsx" --include="*.ts" \
  | grep -v "index.ts" | grep -v ".stories."
```

**AD-5 — Data fetching in core/:**
```bash
grep -rn "useQuery\|useMutation\|useSuspenseQuery\|fetch(" \
  <components-root>/core/ --include="*.tsx" --include="*.ts" \
  | grep -v ".stories." | grep -v ".test." | grep -v "node_modules"
```

**AD-7 — Missing stories:**
```bash
find <components-root> -name "*.tsx" \
  -not -name "*.stories.tsx" -not -name "*.test.tsx" \
  -not -name "index.tsx" \
  | while read f; do
    dir=$(dirname "$f")
    base=$(basename "$f" .tsx)
    if [ ! -f "$dir/$base.stories.tsx" ] && [ ! -f "$dir/${base,,}.stories.tsx" ]; then
      echo "MISSING STORY: $f"
    fi
  done
```

**AD-8 — Missing barrel files:**
```bash
find <components-root> -type d -mindepth 2 | while read d; do
  if [ -z "$(ls "$d"/*.tsx 2>/dev/null)" ]; then continue; fi
  if [ ! -f "$d/index.ts" ]; then echo "MISSING BARREL: $d"; fi
done
```

(Additional rule scans similar — adapt patterns to the rule's
detection logic.)

### Step 0.3 — Discovery report → user approval

Present findings to the user as a discovery report:

```
Atomic Design Convention — Discovery Report

Project: <components-root>
Rules version: <project's CLAUDE.md hash>

Errors:
  AD-1 (atoms composing atoms): N violations
    <list affected files>
  AD-5 (data fetching in core): N violations
    <list>
  ...

Warnings:
  AD-7 (missing stories): N components
  AD-8 (missing barrels): N directories
  ...

Total: N error violations, N warning violations across N files

Proceed with remediation?
  [a]ll      Fix everything
  [e]rrors   Fix errors only; defer warnings
  [s]elect   Pick specific rules to address
  [n]one     Stop; review the report
```

**No files are modified until the user approves.**

## Phase 1 — Fix Error-Level Violations

Per the user's selection, work through error rules in priority
order:

1. **Structural violations first** (AD-13: `features/` removal,
   AD-11: feature-local atoms/molecules → core)
   - File relocations with all import-reference updates
   - Use `git mv` (never plain `mv` — case-sensitivity issues on
     macOS)
   - 3-tier verification per relocation:
     - `npx tsc --noEmit` (types)
     - Storybook screenshot before/after (isolated rendering)
     - Page-level rendering check (real app context)
   - Commit per logical group: `refactor: move <area> per AD-<rule>`

2. **Behavioral violations** (AD-5: data fetching out of core,
   AD-1: atom decomposition, AD-3: organism scope)
   - Surface the structural decision to the user
   - Apply the agreed-upon fix
   - Verify and commit

3. **Surface-level violations** (AD-9: default-export
   conversion) — this overlaps with biome `noDefaultExport`; if
   biome cleanup ran first, this should be empty

### File Relocation 3-Tier Verification

For every file relocation:

```bash
# 1. Type check
npx tsc --noEmit
# Must pass before committing

# 2. Storybook isolated rendering check
# Capture a screenshot of the component's primary story before move
# Move the file; update imports
# Capture screenshot after move
# Compare with pixelmatch — must be identical (0 diff)

# 3. Page-level verification
# Find a page in the real app that consumes the moved component
# Build the page; render in dev server
# Visit the page; verify nothing visually broken
# (Use Chrome DevTools MCP or Playwright MCP if available)
```

If any tier fails:
- Document the failure
- Apply 3-strike rule: retry up to 3 times with adjusted approach
- After 3 strikes, **flag for manual review**, skip — never
  auto-revert

### Page Verification Report Format

```
Page Verification:
  PASS   /<page-path>          (imports <component> via <path>)
  PASS   /<another-page>       (imports <component-2>)
  ERROR  /<page-path>          → fixed: missing barrel export in core/molecules
  PASS   /<page-path>          (retry 1)
```

### Cleanup

After the batch is committed and verified:

```bash
rm -rf <components-root>/.screenshots/relocation-before
rm -rf <components-root>/.screenshots/relocation-after
rm -rf <components-root>/.screenshots/relocation-diff
```

## Phase 2 — Fix Warning-Level Violations

### Batch 2.1 — AD-8: Missing Barrel Files

For each component directory without `index.ts`:

1. Identify the primary export(s) in the directory
2. Create `index.ts` with named re-exports
3. No need to update consumers (barrel just adds a cleaner import path)
4. Commit: `chore: add missing barrel files in <area>`

### Batch 2.2 — AD-7: Missing Stories

**Delegate to a story-generation routine** if the project has
one (e.g., `/frameworks:storybook:stories:gen-missing`). That
routine provides comprehensive coverage analysis and
CSF-format generation. The integration:

```bash
# In atomic-design.md routine, AD-7 phase
/frameworks:storybook:stories:gen-missing <atomic-category>
```

After gen-missing completes, atomic-design's verification step
re-runs to confirm AD-7 violations cleared.

When no such routine exists:
- Create stories manually with appropriate props/variants
- Match the project's Storybook title hierarchy convention
- Commit per area: `chore: add missing Storybook stories for <area>`

### Batch 2.3 — AD-12: File Naming Fixes

For each file with naming violations:

1. `git mv` to the correct name (PascalCase for `.tsx`, camelCase
   for hooks)
2. Update all import references
3. Update barrel files
4. Verify: `npx tsc --noEmit`
5. Commit: `refactor: fix file naming convention in <area>`

## Phase 3 — Final Verification Gate

**Mandatory before reporting completion. Do not skip any step.**

### 1. Re-run the Full Scan

Run all Phase 0 checks again. Violation count for every fixed
rule must be **0**.

### 2. Biome Check

```bash
cd <components-root>
npx biome check . 2>&1 | grep -E "^(Checked|Found)"
# Must show: Found 0 errors
```

### 3. TypeScript Check

```bash
cd <project-root>
npx tsc --noEmit
# Must exit 0
```

### 4. Clean Build

```bash
cd <project-root>
# Use project's build command
# Common: npm run build / pnpm build / make build
# Must exit 0
```

### 5. Report

Present the final summary:

```
┌──────────────────────────────────────────────────┐
│           ATOMIC DESIGN REMEDIATION REPORT        │
├────────┬──────────┬───────────┬──────────────────┤
│ Rule   │ Before   │ After     │ Status           │
├────────┼──────────┼───────────┼──────────────────┤
│ AD-1   │ N        │ 0         │ ✓ Fixed          │
│ AD-5   │ N        │ 0         │ ✓ Fixed          │
│ ...    │ ...      │ ...       │ ...              │
└────────┴──────────┴───────────┴──────────────────┘

Commits: <list each commit hash + message>
Skipped: <list any violations intentionally skipped + reason>
```

## Cross-Routine Awareness

After completion, **invoke component-dedup with `all` scope** to
catch any new duplicates introduced by relocations:

```bash
/engineer:maintenance:remediation:component-dedup all
```

This composition is documented and intentional — when atoms/
molecules move from features into `core/`, they may collide with
existing core atoms/molecules. The dedup remediator catches these
and proposes consolidation.

## Guard Rails

- **Never auto-fix AD-5 (data fetching in core/)** — always
  present the structural decision to the user
- **Never auto-fix AD-10 (duplicates)** — always show the diff
  and let the user decide
- **Never move framework-required files** — `page.tsx`,
  `layout.tsx`, `route.ts` (Next.js); equivalents in other
  frameworks
- **Always run `tsc --noEmit` after moves** — file moves break
  TypeScript module resolution easily
- **Always use `git mv`** — plain `mv` causes tracking issues on
  case-insensitive filesystems (macOS)
- **Batch size ~20-30 files** — small enough to review, large
  enough to make progress
- **3-strike rule** — if a batch can't pass verification after 3
  fix attempts, skip and document; never auto-revert
- **Feature-local atoms/molecules are violations** — only
  organisms and templates may live in feature directories
- **`features/` directory is invalid** — relocate to appropriate
  app directory or `core/` depending on reuse scope; user decides
  placement
- **Never commit a relocation without 3-tier verification** —
  `tsc --noEmit` confirms types, Storybook screenshots confirm
  isolated rendering, page-level checks confirm the component
  works in the real app. All three must pass.

## Completion Criteria

The remediator is done when:

1. All error-level violations are either fixed or explicitly
   skipped with user approval
2. Warning-level violations are fixed or deferred with documentation
3. `npx biome check .` shows 0 errors
4. `npx tsc --noEmit` exits 0
5. Build command exits 0
6. Every fix has its own commit with a conventional commit message

## Adapting to your project

When adopting this routine for a project with different
atomic-design conventions:

1. **Replace the rule table** (AD-1 through AD-15) with rules
   matching your project's taxonomy
2. **Replace the "Project-Specific Architecture" section** with
   your project's app structure
3. **Adjust path references** (`<components-root>` placeholder
   throughout) to your actual paths
4. **Document the rules source** in your project (often
   `components/CLAUDE.md` or equivalent) so the routine reads
   from a known location

The phased execution structure (reconnaissance → user approval →
errors-first → warnings → final gate), the 3-strike rule, the
3-tier verification, and the cross-routine composition with dedup
remain portable across projects.

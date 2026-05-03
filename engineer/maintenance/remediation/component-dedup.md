---
type: remediator
description: Scan components for duplicates, present candidates to the user for approval, then consolidate with visual regression verification. Scan-first, fix-later — no files modified until user reviews discovery report and selects which duplicates to consolidate.
argument-hint: [<scope> | all]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/remediation/_context.md`
> (remediation archetype patterns), `product/strategy/_context.md`.
>
> **This routine assumes a `<components-root>` directory** with
> a default-scope subdirectory (typically `core/`) and additional
> feature/app directories. The originating project uses
> `app-ui/components/` with `core/` as default scope. Other
> projects adapt the path; the structure is portable.

Scan components for duplicates, present candidates to the user
for approval, then consolidate with visual regression verification.

**Invoke with:** `/engineer:maintenance:remediation:component-dedup` +
optional scope

## Step 0.0 — Topology detection

Detect components root and Storybook configuration:

```bash
# Find components directory
# Common: app-ui/components, src/components, packages/ui/src
COMPONENTS_ROOT=$(find . -type d -name "components" \
  -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -maxdepth 5 | head -1)

# Find Storybook config — prefer manifest if available
if [ -f product/.pencil-storybook.json ]; then
  STORYBOOK_CONFIG=$(jq -r '.storybook.configDir // empty' product/.pencil-storybook.json)
else
  STORYBOOK_CONFIG=$(find . -type d -name ".storybook" -maxdepth 3 | head -1)
fi

# Confirm Storybook is running for visual verification phase
# (will check at Phase 2; not required at Phase 0)
```

Document detection in the routine's report:

```
Components root:    <path>
Storybook config:   <path or "not found">
Default scope:      <path>/core
```

## Arguments

`$ARGUMENTS` — optional scope filter:

- **Atomic layer**: `atoms`, `molecules`, `organisms`
- **Pattern group**: `cards`, `button`, `modal`
- **Expanded scope**: `all` — scan all of `<components-root>`
  (not just `core/`). Used when invoked from
  `/engineer:maintenance:remediation:atomic-design` after relocations.
- **Empty** — scan `core/` only (default)

## Phase 1 — Discovery (read-only)

### 1. Build the component file index

Collect every `.tsx` component file (excluding stories, tests,
types, examples, helpers, index files):

```bash
# Default scope: core/ only
SCAN_ROOT="<components-root>/core"

# Expanded scope: if $ARGUMENTS is "all", scan everything
if [ "$ARGUMENTS" = "all" ]; then
  SCAN_ROOT="<components-root>"
fi

find $SCAN_ROOT -name "*.tsx" \
  -not -name "*.stories.tsx" \
  -not -name "*.test.tsx" \
  -not -name "*.types.tsx" \
  -not -name "*.example.tsx" \
  -not -name "index.tsx" \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/design-system/*" \
  | sort
```

If `$ARGUMENTS` is provided (and not `all`), filter results to
only paths containing that term (case-insensitive).

### 2. Detect exact filename duplicates

Group the files by **base filename** (e.g., `Card.tsx`). Any
filename that appears in 2+ locations is a potential duplicate.

For each duplicate set:

1. Read each file and compare the exported component name and
   props interface
2. Classify as:
   - **EXACT** — same component name, same or nearly identical
     implementation
   - **NEAR** — same filename, different implementation or
     extended version
   - **FALSE POSITIVE** — same filename but clearly different
     component (e.g., `Card.tsx` in different feature contexts)

### 3. Detect semantic duplicates

Look for components with different names but overlapping purpose.
Check these known pattern groups:

| Pattern group | Search terms |
|---------------|-------------|
| Buttons | `Button`, `Btn`, `CTA`, `Action`, `IconButton` |
| Cards | `Card`, `Panel`, `Tile`, `Box` |
| Modals/Dialogs | `Modal`, `Dialog`, `Drawer`, `Sheet`, `Overlay` |
| Inputs | `Input`, `TextField`, `TextArea`, `Field` |
| Badges/Tags | `Badge`, `Tag`, `Chip`, `Label`, `Pill` |
| Typography | `Title`, `Heading`, `Text`, `Caption`, `Subtitle` |
| Navigation | `Link`, `NavLink`, `BackLink`, `Breadcrumb` |
| Lists | `List`, `ListItem`, `Row`, `Item` |
| Avatars | `Avatar`, `UserIcon`, `ProfilePic` |
| Alerts | `Alert`, `Toast`, `Notification`, `Banner` |
| Loaders | `Spinner`, `Loader`, `Loading`, `Skeleton` |
| Tooltips | `Tooltip`, `Popover`, `HoverCard` |
| Selects | `Select`, `Dropdown`, `Picker`, `Combobox`, `Autocomplete` |
| Copy | `Copy`, `Clipboard` |
| Close | `Close`, `Dismiss`, `CloseButton` |

For each group with 2+ matches in different directories:

1. Read the component files
2. Compare props interfaces and rendered output
3. Classify as EXACT, NEAR, or FALSE POSITIVE

### 4. Detect root-level orphans

Components placed directly in `atoms/`, `molecules/`, or
`organisms/` (not in a subdirectory) that also have a copy inside
a subdirectory of the same layer. These are migration artifacts
where the file was copied to a subdirectory but the original was
never deleted.

```bash
# Find root-level .tsx files in each layer
ls <components-root>/core/atoms/*.tsx 2>/dev/null
ls <components-root>/core/molecules/*.tsx 2>/dev/null
ls <components-root>/core/organisms/*.tsx 2>/dev/null
```

For each root-level file, check if a file with the same name
exists in any subdirectory of that layer.

### 5. Check import usage for each duplicate

For every confirmed duplicate (EXACT or NEAR), find which import
path is actually used in the codebase:

```bash
grep -r "from.*<path-fragment>" \
  --include="*.tsx" --include="*.ts" <project-root>/ \
  | grep -v node_modules | grep -v .next \
  | grep -v .stories. | grep -v .test.
```

Determine:

- **Active path** — the import used by consuming components
- **Orphan path** — the duplicate that nothing imports (safe to
  delete)
- **Split usage** — both paths are imported by different consumers
  (needs consolidation)

### 6. Discovery report

Generate the report and present to user:

```
╔═══════════════════════════════════════════════════════════════╗
║  Component Deduplication Report — Discovery                   ║
║  Scanned: <N> component files across atoms/molecules/organisms║
╠═══════════════════════════════════════════════════════════════╣

── EXACT DUPLICATES (safe to consolidate) ──────────────────────

  1. <ComponentName>
     ├─ KEEP:   <path> (imported by N files)
     ├─ DELETE: <path> (imported by 0 files)
     ├─ Stories: <list story IDs for both versions>
     └─ Action: Delete orphan, no import updates needed

  2. <ComponentName>
     ├─ PATH A: <path> (imported by N files)
     ├─ PATH B: <path> (imported by M files)
     ├─ Stories: <list story IDs for both versions>
     └─ Action: Consolidate to <recommended path>, update M imports

── NEAR DUPLICATES (review before consolidating) ──────────────

  3. <ComponentA> vs <ComponentB>
     ├─ <path-a>: <brief description of implementation>
     ├─ <path-b>: <brief description of differences>
     ├─ Delta: <what path-b adds: extra props, variants, styles>
     ├─ Stories: <list story IDs for both versions>
     └─ Recommendation: <merge / keep both / extract shared base>

── ROOT-LEVEL ORPHANS ──────────────────────────────────────────

  4. <filename>
     ├─ ROOT:   <root-level path>
     ├─ SUBDIR: <subdirectory path>
     └─ Action: Delete root-level file, update imports if any

── SUMMARY ─────────────────────────────────────────────────────

  Exact duplicates:    <count>
  Near duplicates:     <count>
  Root-level orphans:  <count>
  Total files to clean: <count>
  Import updates needed: <count>

╚═══════════════════════════════════════════════════════════════╝
```

**After printing the discovery report, ASK the user which
duplicates to consolidate before proceeding to Phase 2.** The
user may choose all, a subset, or none. If none, stop here.

## Phase 2 — Visual Baseline Capture (before consolidation)

**Prerequisites:** Storybook must be running. Check via the
manifest's URL when available, otherwise default port:

```bash
if [ -f product/.pencil-storybook.json ]; then
  LOCAL_URL=$(jq -r '.storybook.localUrl // "http://localhost:6006"' product/.pencil-storybook.json)
else
  LOCAL_URL="http://localhost:6006"
fi

curl -sf "$LOCAL_URL" > /dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"
```

If not running, tell the user to start it (use the manifest's
`startCommand` if available, otherwise `cd <project> && npm run storybook`)
and wait. **Components without stories skip visual verification
(report as "NO STORIES — verify manually").**

### 7. Find all stories for each duplicate pair

For each duplicate selected for consolidation, find ALL Storybook
stories that render either version:

```bash
curl -sf http://localhost:6006/index.json | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data.get('entries', data.get('stories', {}))
stories = sorted([k for k, v in entries.items() if v.get('type') == 'story'])
for s in stories: print(s)
" | grep -i "<component-name>"
```

Also find stories from **consuming components** — components
that import the duplicate. These are the stories most likely to
visually regress:

```bash
# For each file that imports the duplicate
grep -rl "from.*<duplicate-import-path>" \
  --include="*.tsx" <components-root>/ | grep -v node_modules
# Then find stories for those consuming components
```

### 8. Capture BEFORE screenshots

For every story found in step 7 (both the duplicate's own stories
and consuming component stories):

```bash
mkdir -p <components-root>/.screenshots/dedup-before
```

Use Playwright MCP or Chrome DevTools MCP to:

1. Navigate to `http://localhost:6006/iframe.html?id=<STORY_ID>&viewMode=story`
2. Wait for content to render (8s timeout for first, 5s for subsequent)
3. Take a screenshot saved to `<components-root>/.screenshots/dedup-before/<STORY_ID>.png`

Log what was captured:

```
Captured BEFORE screenshots:
  <component>:    <N stories>
  <component>:    <N stories>
  Consuming:      <M stories>
  Total:          <T screenshots>
```

## Phase 3 — Consolidate

For each selected duplicate:

### a. Pick the canonical version

Decision criteria (in priority order):
1. The version with active imports (more consumers)
2. The version with better implementation (props interface, types,
   accessibility)
3. The version in the architecturally correct location (`core/`
   over feature directory for shared atoms/molecules)
4. When tied, ask the user

### b. Merge unique features into canonical

If the duplicate has features the canonical lacks:

1. **Extra props** — add them to the canonical's props interface
2. **Extra variants** — add variant definitions
3. **Extra CSS classes** — merge Tailwind classes
4. **Extra stories** — keep them, update imports to canonical path
5. **Different default values** — use the canonical's defaults
   unless the duplicate's are objectively better

Document every merge decision.

### c. Update imports

Find all files importing from the duplicate's path and update to
canonical:

```bash
grep -rl "from.*<old-import-path>" \
  --include="*.tsx" --include="*.ts" <project-root>/ \
  | grep -v node_modules | grep -v .next
```

For each file, update the import path.

### d. Delete the duplicate

```bash
git rm <duplicate-file>
# Also delete associated .types.ts, .test.tsx, .stories.tsx,
# index.ts if they only served the duplicate
```

### e. Update barrel files

If the canonical directory has an `index.ts`, ensure it exports
the component. If the deleted directory had an `index.ts` that
other files imported, update those imports.

## Phase 4 — Visual Verification with Retry

### 10. Capture AFTER screenshots

After consolidation, capture screenshots of the SAME stories from
step 8:

```bash
mkdir -p <components-root>/.screenshots/dedup-after
```

Navigate to each story and screenshot to
`<components-root>/.screenshots/dedup-after/<STORY_ID>.png`.

### 11. Compare BEFORE vs AFTER

For each story, run pixelmatch:

```bash
mkdir -p <components-root>/.screenshots/dedup-diff
npx pixelmatch \
  <components-root>/.screenshots/dedup-before/<STORY_ID>.png \
  <components-root>/.screenshots/dedup-after/<STORY_ID>.png \
  <components-root>/.screenshots/dedup-diff/<STORY_ID>.png 0.1
```

Classify results:

- **PASS** — 0 differing pixels (identical rendering)
- **ACCEPTABLE** — < 50 differing pixels (sub-pixel rendering,
  font smoothing)
- **DRIFT** — 50-500 differing pixels (minor visual change —
  needs review)
- **REGRESSION** — 500+ differing pixels (significant visual
  change — must fix)

### 12. Retry loop for DRIFT / REGRESSION

**Max retries: 3 per component.**

For each story with DRIFT or REGRESSION:

#### a. Diagnose the visual diff

Read the diff image to understand what changed visually.

Compare the BEFORE and AFTER screenshots side-by-side to identify:

- Missing border, shadow, or spacing
- Different font size or color
- Missing icon or element
- Layout shift
- Missing variant/state that the deleted version provided

#### b. Identify the root cause

Cross-reference the visual diff with the merge decisions from
step 9b. Common causes:

| Visual symptom | Likely cause | Fix |
|---------------|-------------|-----|
| Missing border | Duplicate had extra CSS class (e.g., `border-2`) | Add class to canonical |
| Different spacing | Props had different default padding/margin | Match the duplicate's defaults |
| Missing element | Duplicate rendered extra child (icon, badge) | Add conditional render to canonical |
| Color mismatch | Different Tailwind color token | Update to match |
| Layout shift | Different flex/grid config | Match the duplicate's layout classes |
| Missing variant | Consuming component passed a prop only the duplicate supported | Add prop to canonical's interface |

#### c. Apply the fix

Edit the canonical component to resolve the visual regression.
Keep changes minimal — only fix what the diff shows.

#### d. Re-screenshot and re-compare

Capture a new AFTER screenshot for just the affected stories;
re-run pixelmatch.

#### e. Evaluate

- If now PASS or ACCEPTABLE → move to next story
- If still DRIFT/REGRESSION → increment retry counter, go to step 12a
- If max retries (3) exhausted → flag for manual review, **do NOT
  revert automatically**

### 13. Verification report

After all stories pass or exhaust retries:

```
╔═══════════════════════════════════════════════════════════════╗
║  Dedup Consolidation — Visual Verification                    ║
╠═══════════════════════════════════════════════════════════════╣

── <ComponentName> ─────────────────────────────────────────────

  Consolidated: <old-path> → <canonical-path>
  Imports updated: <N> files
  Features merged: <list or "none (exact duplicate)">

  Visual results:
    PASS        core-atoms-button-rounded-close--default       (0 px)
    PASS        core-atoms-button-rounded-close--large         (0 px)
    ACCEPTABLE  discover-schools-card--with-actions             (12 px)
    PASS (r2)   core-molecules-cards-card--with-header          (0 px, fixed on retry 2)

  Retries:
    core-molecules-cards-card--with-header
      r1: 342 px — missing border-2 class → added to canonical
      r2: 0 px — PASS

── FLAGGED FOR MANUAL REVIEW ───────────────────────────────────

  core-organisms-student-card--compact (482 px after 3 retries)
    Last diff: <components-root>/.screenshots/dedup-diff/core-organisms-student-card--compact.png
    Suspect: layout uses entirely different grid structure

── OVERALL ─────────────────────────────────────────────────────

  Components consolidated: <N>
  Stories verified:        <N>
  Passed first try:        <N>
  Passed after retry:      <N>
  Flagged for review:      <N>
  Files deleted:           <N>
  Imports updated:         <N>

╚═══════════════════════════════════════════════════════════════╝
```

## Phase 5 — Cleanup

### 14. Build verification

After all consolidations, verify the project still builds:

```bash
cd <project-root>
# Use project's build command
# Common: npm run build / pnpm build / make build
```

If build fails, the error is likely a missed import update. Fix it.

### 15. Lint check

```bash
cd <biome-root>
npx biome check . 2>&1 | head -30
```

Fix any errors.

### 16. Screenshot cleanup (optional)

Ask the user before cleaning up:

```bash
rm -rf <components-root>/.screenshots/dedup-before
rm -rf <components-root>/.screenshots/dedup-after
rm -rf <components-root>/.screenshots/dedup-diff
```

## Cross-Routine Awareness

This routine is invoked **as a downstream pipeline step** by
`/engineer:maintenance:remediation:atomic-design` after its relocations
complete:

```bash
# atomic-design's Phase 1 ends with:
/engineer:maintenance:remediation:component-dedup all
```

The `all` scope is essential — atomic-design's relocations move
components from feature directories into `core/`, which may
introduce new duplicates that the default `core/`-only scope
wouldn't catch on its own.

When invoked standalone (without atomic-design upstream), the
default `core/` scope is appropriate.

## Guard Rails

- **Phase 1 is always read-only.** No files are modified until
  the user approves consolidation targets.
- **Phase 2-4 require Storybook running** on the configured port.
  Components without stories skip visual verification (report as
  "NO STORIES — verify manually").
- **The retry loop is capped at 3 attempts** to prevent infinite
  loops. After 3 retries, the diff is flagged for manual review
  — never auto-reverted.
- **Near duplicates may need the user's input** on which version
  to keep. Ask before merging if the trade-off is ambiguous (e.g.,
  version A has better accessibility but version B has more
  variants).
- **Run after any migration batch** to catch new duplicates
  introduced during refactoring.
- **Cross-reference with the project's known-globals list** —
  components listed as global but with duplicates are priority
  fixes.
- **Components in `design-system/` are excluded** (those are
  documentation/showcase only).
- **Default scope: `core/` only.** Feature directories are excluded
  by default because they may legitimately wrap core components.
- **Expanded scope: `all`.** Pass `all` as an argument to scan
  across the entire `<components-root>`. Essential after
  atomic-design relocations.
- **Consuming component stories are included** in visual
  verification because they may render differently after import
  path changes (e.g., if the canonical version has slightly
  different defaults).

## Adapting to your project

When adopting this routine for a project with different paths or
conventions:

1. Replace `<components-root>` placeholder with your actual path
2. Replace `<project-root>` placeholder with your actual path
3. Adjust the default scope if `core/` isn't the right default
   subdirectory
4. Adjust the pattern-group vocabulary if your project uses
   different component naming conventions
5. Document Storybook URL/port if it differs from `localhost:6006`

The phased structure (discovery → user approval → consolidation
→ visual verification with retry → cleanup), the 3-retry budget,
the diagnostic table, and the cross-routine invocation contract
remain portable.

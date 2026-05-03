---
description: Generate comprehensive inventory and quality metrics for Storybook stories. Coverage by component, category breakdown, addon usage, story-to-component ratio, MDX coverage, comparison with live Storybook index. Reads from filesystem AND running Storybook (when available) to surface gaps and quality concerns. The reporting command — read-only, no modifications.
argument-hint: [--format markdown|json|console] [--scope <category-or-component>] [--include-mdx] [--include-chromatic]
allowed-tools: Read, Write, Edit, Bash
---

Generate a comprehensive inventory of Storybook stories with
quality metrics, coverage analysis, and gap identification.
Read-only; no modifications to project state.

This is the reporting command. It surfaces what exists, what's
missing, and where coverage is uneven. Used periodically (e.g.,
end of sprint, before architecture review) to assess design
system health.

## Phase 0: pre-flight

Per `frameworks/storybook/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists with required fields
3. Storybook running is OPTIONAL (catalog can work
   filesystem-only; comparing with live index is bonus)

## Phase 1: filesystem inventory

Walk the component organization to enumerate components and
stories:

```bash
COMPONENT_ROOT=$(jq -r '.componentOrganization.componentRoot' product/.pencil-storybook.json)
STORIES_GLOB=$(jq -r '.storybook.storiesGlob' product/.pencil-storybook.json)
MDX_GLOB=$(jq -r '.storybook.mdxGlob // empty' product/.pencil-storybook.json)

# Find all components
COMPONENTS=$(find "$COMPONENT_ROOT" -name "*.tsx" \
  ! -name "*.stories.*" ! -name "*.test.*" \
  ! -name "use*.tsx" ! -name "index.tsx" \
  ! -name "types.tsx" ! -name "*.mock.*" \
  ! -path "*/mocks/*" ! -path "*/test/*" \
  ! -path "*/__tests__/*")

# Find all stories
STORIES=$(find "$COMPONENT_ROOT" -name "*.stories.tsx" -o -name "*.stories.ts")

# Find all MDX
if [ -n "$MDX_GLOB" ]; then
  MDX_FILES=$(find "$COMPONENT_ROOT" -name "*.mdx")
fi
```

### Per-component metrics

For each component file, derive:

```bash
COMPONENT_NAME=$(basename "$COMPONENT_FILE" .tsx)
COMPONENT_DIR=$(dirname "$COMPONENT_FILE")
ATOMIC_LEVEL=$(derive_atomic_level "$COMPONENT_FILE")
SECTION=$(derive_section "$COMPONENT_FILE")

# Story file existence
STORY_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.stories.tsx"
HAS_STORY=$([ -f "$STORY_FILE" ] && echo "yes" || echo "no")

# Story count from CSF exports
if [ "$HAS_STORY" = "yes" ]; then
  STORY_COUNT=$(grep -c "^export const " "$STORY_FILE")
fi

# MDX existence
MDX_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.mdx"
HAS_MDX=$([ -f "$MDX_FILE" ] && echo "yes" || echo "no")

# Component file metrics
LOC=$(wc -l < "$COMPONENT_FILE")
HAS_INTERACTIONS=$(grep -qE "(onClick|onChange|onSubmit)" "$COMPONENT_FILE" && echo "yes" || echo "no")
HAS_FETCH=$(grep -qE "(fetch|useQuery|useSWR|axios)" "$COMPONENT_FILE" && echo "yes" || echo "no")
```

## Phase 2: live Storybook comparison (when running)

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)

if curl -sf "$LOCAL_URL" > /dev/null 2>&1; then
  LIVE_AVAILABLE=true
  
  # Fetch story index
  INDEX=$(curl -sf "${LOCAL_URL}/index.json")
  
  # Live stories registered in Storybook
  LIVE_STORY_IDS=$(echo "$INDEX" | jq -r '.entries // .stories | to_entries | map(select(.value.type == "story")) | .[].key' | sort)
  LIVE_STORY_COUNT=$(echo "$LIVE_STORY_IDS" | wc -l)
  
  # Live docs entries
  LIVE_DOC_IDS=$(echo "$INDEX" | jq -r '.entries | to_entries | map(select(.value.type == "docs")) | .[].key' | sort)
  LIVE_DOC_COUNT=$(echo "$LIVE_DOC_IDS" | wc -l)
fi
```

When live data available, compare filesystem inventory with
live registration:
- Stories in files but not in live index (HMR didn't pick up;
  build error; misnamed export)
- Stories in live index but not in files (cached; needs
  Storybook restart)

## Phase 3: aggregate metrics

```bash
# By atomic level
ATOMS_TOTAL=$(count_components "$COMPONENTS" "atoms")
ATOMS_WITH_STORIES=$(count_components_with_stories "$COMPONENTS" "atoms")
ATOMS_WITH_MDX=$(count_components_with_mdx "$COMPONENTS" "atoms")
# ... molecules, organisms, templates

# By section
SECTIONS=$(get_unique_sections "$COMPONENTS")
for SECTION in $SECTIONS; do
  SECTION_TOTAL=$(count_components_in_section "$SECTION")
  SECTION_WITH_STORIES=$(count_components_with_stories_in_section "$SECTION")
done

# Quality metrics
TOTAL_COMPONENTS=$(echo "$COMPONENTS" | wc -l)
TOTAL_STORY_FILES=$(echo "$STORIES" | wc -l)
TOTAL_STORY_COUNT=$(sum_story_counts)
STORY_TO_COMPONENT_RATIO=$(echo "scale=2; $TOTAL_STORY_COUNT / $TOTAL_COMPONENTS" | bc)

TOTAL_MDX=$(echo "$MDX_FILES" | wc -l)
MDX_COVERAGE=$(echo "scale=2; $TOTAL_MDX / $TOTAL_COMPONENTS * 100" | bc)
```

### Addon usage stats

For each addon in the manifest's addons:

```bash
for ADDON in $(jq -r '.addons | keys[]' product/.pencil-storybook.json); do
  case "$ADDON" in
    msw)
      # Stories that use msw parameters
      MSW_USAGE=$(grep -lE "msw:\s*\{" $STORIES 2>/dev/null | wc -l)
      ;;
    test)
      # Stories with play functions
      PLAY_USAGE=$(grep -lE "play:\s*async" $STORIES 2>/dev/null | wc -l)
      ;;
    designs)
      # Stories with design parameter
      DESIGN_USAGE=$(grep -lE "design:\s*\{" $STORIES 2>/dev/null | wc -l)
      ;;
    a11y)
      # All stories get a11y addon by default; this is informational
      A11Y_USAGE="all (default)"
      ;;
    chromatic)
      # Stories with chromatic-specific parameters
      CHROMATIC_USAGE=$(grep -lE "chromatic:\s*\{" $STORIES 2>/dev/null | wc -l)
      ;;
  esac
done
```

## Phase 4: optional Chromatic data

When `--include-chromatic`:

```bash
# Invoke chromatic command's data layer (or query Chromatic API)
CHROMATIC_DATA=$(/frameworks:storybook:chromatic --json 2>/dev/null)

CHROMATIC_BASELINE_COVERAGE=$(echo "$CHROMATIC_DATA" | jq -r '.baselineCoverage.withBaseline')
CHROMATIC_MISSING=$(echo "$CHROMATIC_DATA" | jq -r '.baselineCoverage.missingBaseline')
CHROMATIC_UNREVIEWED=$(echo "$CHROMATIC_DATA" | jq -r '.latestBuild.unreviewedCount')
```

## Phase 5: report generation

### Console (default)

```
=== Storybook Catalog ===
Project:          SkoolScout
Storybook:        10.3.4 (@storybook/nextjs)
Catalog run:      2026-05-03 17:35

OVERVIEW:
  Components total:      247
  Component files:       components/ (recursive)
  Story files:           241  (98% coverage)
  MDX docs:              156  (63% coverage)
  Total story exports:   1,247
  Story-to-component:    5.0 stories/component (avg)

LIVE COMPARISON:
  Storybook running:     ✓ http://localhost:6006
  Live story count:      1,243  (vs 1,247 in files)
  Discrepancies:
    - 4 stories in files not in live index (HMR pickup pending or build error)

COVERAGE BY ATOMIC LEVEL:
                Components  Stories  MDX   Coverage  Story-Avg
  atoms:        45          43       28    96%       4.3
  molecules:    87          86       52    99%       5.2
  organisms:    78          77       45    99%       5.4
  templates:    12          12       8     100%      6.1
  (uncategorized): 25       23       23    92%       4.7

COVERAGE BY SECTION:
                Components  With Stories
  Public:       40          38   (95%)
  Admin:        62          61   (98%)
  Discover:     78          78   (100%)
  Platform:     67          64   (96%)

GAPS:

Components without stories (6):
  - components/admin/atoms/notification-pill/NotificationPill.tsx
  - components/admin/atoms/state-badge/StateBadge.tsx
  - components/discover/molecules/filter-bar/FilterBar.tsx
  - (3 more)

Components without MDX docs (91):
  Most concerning:
    - components/core/templates/dashboard/Dashboard.tsx (template needs docs)
    - (others listed)

ADDON USAGE:

Addon                Coverage
  a11y               all (default)
  test (play funcs)  127 / 1,247 stories  (10%)
  msw (mocks)        38 / 1,247 stories   (3%)
  designs            12 / 1,247 stories   (1%)
  chromatic          all (default)

CHROMATIC INTEGRATION (--include-chromatic):
  Project URL:           https://www.chromatic.com/...
  Latest build:          #87 passed (2h ago)
  Stories with baseline: 245 / 247  (99%)
  Missing baselines:     2
  Unreviewed changes:    0

QUALITY OBSERVATIONS:

  ⚠ Story-to-component ratio low (5.0 average)
    Some components have only Default story; consider adding
    variant stories for components with multiple sizes/colors/states.

  ⚠ Test addon usage low (10%)
    Many interactive components have no play functions.
    Consider adding interaction tests via:
      /frameworks:storybook:stories:gen <component>

  ✓ MDX coverage healthy at 63%
    Templates and complex organisms are documented.

  ✓ Live registration matches files closely (4 discrepancies
    likely HMR pending; not an issue.)

NEXT STEPS:

  - Run /frameworks:storybook:stories:gen-missing for the
    6 components without stories
  - Run /frameworks:storybook:stories:doc <component> for
    high-priority undocumented components
  - Run /frameworks:storybook:verify:health to check overall
    quality across stories
  - Run /frameworks:storybook:chromatic for visual regression
    health (or use --include-chromatic on next catalog run)
```

### Markdown (`--format markdown`)

Same content but in markdown for rendering elsewhere (PR
comments, documentation systems, periodic reports). Includes
collapsible sections for long lists.

### JSON (`--format json`)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-05-03T17:35:00Z",
  "project": {
    "name": "SkoolScout",
    "storybookVersion": "10.3.4",
    "framework": "@storybook/nextjs"
  },
  "overview": {
    "totalComponents": 247,
    "storyFiles": 241,
    "mdxDocs": 156,
    "totalStoryExports": 1247,
    "storyToComponentRatio": 5.04
  },
  "liveComparison": {
    "available": true,
    "url": "http://localhost:6006",
    "liveStoryCount": 1243,
    "discrepancies": [...]
  },
  "coverageByAtomicLevel": {
    "atoms": { "total": 45, "withStories": 43, "withMdx": 28, "coveragePct": 96, "avgStories": 4.3 },
    "molecules": {...},
    "organisms": {...},
    "templates": {...}
  },
  "coverageBySection": {...},
  "gaps": {
    "componentsWithoutStories": [...],
    "componentsWithoutMdx": [...]
  },
  "addonUsage": {...},
  "qualityObservations": [...]
}
```

## Scope filtering

When `--scope <category-or-component>` provided, the catalog
narrows to that scope:

```bash
/frameworks:storybook:catalog --scope atoms
# Only reports on atoms

/frameworks:storybook:catalog --scope Discover
# Only reports on Discover section

/frameworks:storybook:catalog --scope Button
# Only reports on Button-related components
```

Useful for sub-team reports or focused quality reviews.

## Cross-namespace integration

This command is invoked by:
- Quarterly architecture review workflows (when built)
- Pre-deploy checks ("are we ready to publish a Storybook
  update?")
- Onboarding documentation (snapshot of current state)
- The `engineer/maintenance/remediation/storybook-drift`
  routine for periodic comprehensive checks

## What this command does NOT do

- **Modify any state.** Read-only.
- **Run quality checks.** Surfaces metrics; doesn't audit
  individual stories. For audits, use
  `/frameworks:storybook:verify:*` commands.
- **Generate missing stories.** Surfaces gaps; user runs
  `/frameworks:storybook:stories:gen-missing` to address.
- **Report on components in projects without Storybook.**
  Activation gate ensures storybook binding active.

## Examples

```bash
# Full catalog
/frameworks:storybook:catalog

# Scoped to atoms
/frameworks:storybook:catalog --scope atoms

# Markdown for sharing
/frameworks:storybook:catalog --format markdown > storybook-catalog.md

# Including Chromatic stats
/frameworks:storybook:catalog --include-chromatic

# JSON for CI / dashboards
/frameworks:storybook:catalog --format json > catalog.json
```

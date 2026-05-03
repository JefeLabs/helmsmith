---
description: Find components in the project without stories and generate them. Discovers component files that lack a sibling .stories.tsx, classifies what to generate, prompts for batch confirmation, then delegates to /frameworks:storybook:stories:gen for each. Useful for catching up after a sprint of component work or onboarding a project to Storybook.
argument-hint: [scope] [--limit N] [--dry-run] [--by-category]
allowed-tools: Read, Write, Edit, Bash
---

Find components without stories and generate them. The
discovery + batch-generate pattern catches up story coverage
after periods of component work outpacing story authoring.

Composes with `/frameworks:storybook:stories:gen` — this command
identifies what's missing; gen handles each individual
generation.

## Phase 0: discovery

1. Read `product/.pencil-storybook.json`. If missing, auto-trigger
   init for required fields.
2. Verify `componentOrganization.componentRoot` exists on disk.
3. Read suite content sources for delegated gen invocations:
   `.pencil-tone.json`, `.pencil-editorial.json`,
   `.pencil-brand.json`.

## Phase 1: enumerate component files

List all `.tsx` (and `.jsx` for non-TypeScript projects) files
under the component root, excluding non-component files:

```bash
COMPONENT_ROOT=$(jq -r '.componentOrganization.componentRoot' product/.pencil-storybook.json)

find "$COMPONENT_ROOT" -name "*.tsx" \
  ! -name "*.stories.*" \
  ! -name "*.test.*" \
  ! -name "*.spec.*" \
  ! -name "use*.tsx" \
  ! -name "index.tsx" \
  ! -name "types.tsx" \
  ! -name "*.mock.tsx" \
  ! -path "*/mocks/*" \
  ! -path "*/test/*" \
  ! -path "*/__tests__/*" \
  | sort
```

### Scope filtering

If `$ARGUMENTS[0]` is provided, narrow the enumeration:

| Scope | Behavior |
|-------|----------|
| `<category>` (atoms, molecules, organisms, templates) | filter to that atomic category |
| `<feature>` (matches a feature section in manifest) | filter to that feature section |
| `<path>` (relative to component root) | scan only within that path |
| (empty) | scan everything |

```bash
case "$1" in
  atoms|molecules|organisms|templates)
    find "$COMPONENT_ROOT" -path "*/${1}/*" -name "*.tsx" ...
    ;;
  *)
    # Check if scope is a known feature section
    SECTION_PATH=$(jq -r ".componentOrganization.featureSections.\"$1\" // empty" \
                       product/.pencil-storybook.json)
    if [ -n "$SECTION_PATH" ]; then
      find "$SECTION_PATH" -name "*.tsx" ...
    else
      # Treat as path
      find "${COMPONENT_ROOT}/${1}" -name "*.tsx" ...
    fi
    ;;
esac
```

## Phase 2: classify each candidate

For each candidate file, determine:

### Has existing story?

```bash
COMPONENT_PATH="$f"
COMPONENT_DIR=$(dirname "$f")
COMPONENT_NAME=$(basename "$f" .tsx)

if [ -f "${COMPONENT_DIR}/${COMPONENT_NAME}.stories.tsx" ] || \
   [ -f "${COMPONENT_DIR}/${COMPONENT_NAME}.stories.ts" ]; then
  STATUS="HAS_STORY"
else
  STATUS="MISSING"
fi
```

### Looks like a component file?

Read the file and check:

- Has a `default export` of a function/class returning JSX, OR
- Has a named export matching the filename returning JSX
- Imports `react` or has JSX usage

If the file is named like a component but doesn't actually
export one (e.g., a constants file, a type-only file), classify
as `NOT_A_COMPONENT` and skip.

```bash
# Heuristic check
if grep -qE "(export default|export const $COMPONENT_NAME|export function $COMPONENT_NAME)" "$f" && \
   grep -qE "(return <|return \\(|=> <|=> \\()" "$f"; then
  IS_COMPONENT=true
else
  IS_COMPONENT=false
fi
```

### Atomic level / category

Derive from path per `componentOrganization` (same logic as
`storybook:stories:gen`).

### Complexity hint

Quick heuristic for sorting/budget:

```bash
LOC=$(wc -l < "$f")
PROP_COUNT=$(grep -c "^\s*\(props\|interface.*Props\|type.*Props\)" "$f")
HAS_FETCH=$(grep -qE "(fetch|useQuery|useSWR|axios)" "$f" && echo 1 || echo 0)

# Simple complexity score
if [ "$LOC" -lt 50 ]; then COMPLEXITY="simple"
elif [ "$LOC" -lt 150 ]; then COMPLEXITY="medium"
else COMPLEXITY="complex"
fi
```

Used for ordering (simple components first) and time estimates.

## Phase 3: produce inventory report

Build a structured inventory:

```
=== Story Coverage Inventory ===
Scanned:    components/  (recursive)
Excluded:   stories, tests, hooks, index, types, mocks
Total:      247 component files

Status:
  HAS_STORY:        198  (80.2%)
  MISSING:          47   (19.0%)
  NOT_A_COMPONENT:  2    (0.8%)
```

### Missing stories grouped by category

```
=== Missing Stories: 47 ===

Atoms (8):
  - components/core/atoms/icon-badge/IconBadge.tsx        [simple]
  - components/core/atoms/spinner/Spinner.tsx             [simple]
  - components/core/atoms/divider/Divider.tsx             [simple]
  - components/core/atoms/kbd/Kbd.tsx                     [simple]
  ...

Molecules (12):
  - components/core/molecules/breadcrumbs/Breadcrumbs.tsx [medium]
  - components/core/molecules/empty-state/EmptyState.tsx  [medium]
  ...

Organisms (15):
  - components/core/organisms/profile-card/ProfileCard.tsx [complex, fetches]
  ...

Public (6):
Admin (4):
Discover Schools (2):
```

If `--by-category` flag is provided, group results by atomic
category (the format above). Otherwise list flat with category
annotations.

## Phase 4: confirmation

```
Proposed actions:

Generate stories for 47 components.

Estimated time: ~12 minutes
  (simple: 30s each, medium: 60s, complex: 90s + verification)

Limit:  N components per batch (interrupt-friendly)
Strategy:
  1. Sort by complexity (simple → complex)
  2. Process sequentially via /frameworks:storybook:stories:gen
  3. After each successful generation, lint
  4. Verify generated story renders (if Storybook running)

Continue? [Y/skip-batch/cancel]
```

`--limit N` caps the batch size. Useful for incremental work
across sessions.

`--dry-run` produces only the inventory report, no generation.

## Phase 5: dispatch to gen for each missing

Process each missing component:

```bash
for COMPONENT in "${MISSING[@]}"; do
  echo "Generating story for: $COMPONENT"

  # Delegate to gen
  /frameworks:storybook:stories:gen "$COMPONENT"

  # Track result
  if [ $? -eq 0 ]; then
    GENERATED+=("$COMPONENT")
  else
    FAILED+=("$COMPONENT")
  fi

  # Verify story registered (if Storybook running)
  if storybook_is_running; then
    sleep 3  # let HMR pick up the new file
    verify_story_in_index "$COMPONENT"
  fi
done
```

Process sequentially; never parallel. If gen fails for any
component, the failure is recorded but the batch continues with
the next component (3-strike rule applies — if 3 consecutive
generations fail, stop and surface).

### Per-component decisions during gen

Each gen invocation may surface its own prompts (e.g., "MSW
handler file missing, generate stub?"). The batch flow
processes these one at a time:

> Generating story for: components/core/molecules/profile-card/ProfileCard.tsx
>
> Component fetches data; MSW handlers expected at
> components/core/molecules/profile-card/mocks/handlers.ts
> but file is missing. Generate handler stub now? [Y/n/skip-this-component/skip-all-msw]
>
> Choice: Y

Available choices that affect batch behavior:
- `Y` / `n` — apply to this component only
- `skip-this-component` — abandon gen for this component, move
  to next
- `skip-all-msw` — answer `n` for remaining components without
  re-prompting

## Phase 6: post-batch verification

After the batch completes:

### Catalog refresh

```bash
# If Storybook is running, query the index for the new total
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
curl -sf "$LOCAL_URL" > /dev/null 2>&1 && {
  STORY_COUNT_AFTER=$(curl -sf "${LOCAL_URL}/index.json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data.get('entries', data.get('stories', {}))
print(len([k for k, v in entries.items() if v.get('type') == 'story']))
")
}
```

### Lint pass on all generated files

```bash
LINT_CMD=$(jq -r '.lint.command' product/.pencil-storybook.json)
LINT_DIR=$(jq -r '.lint.workingDir' product/.pencil-storybook.json)

(cd "$LINT_DIR" && $LINT_CMD)
```

If lint reports failures across multiple generated files,
surface as a batch:

> Lint failed on 3 of 47 generated story files. Review:
>   - components/core/atoms/spinner/Spinner.stories.tsx (2 issues)
>   - components/core/molecules/breadcrumbs/Breadcrumbs.stories.tsx (1 issue)
>   - components/core/molecules/empty-state/EmptyState.stories.tsx (1 issue)
>
> Apply auto-fixes? [Y/n/show-details]

## Phase 7: report

```
=== Gen-Missing Report ===
Scope:           atoms,molecules
Total scanned:   247 components
Already covered: 198
Generated:       45 stories
Failed:          2 stories
Skipped (NOT_A_COMPONENT): 2

Newly covered:
  Atoms: 8/8
  Molecules: 11/12 (1 failed)
  Organisms: 14/15 (1 failed)
  ...

Failed (require manual investigation):
  components/core/molecules/breadcrumbs/Breadcrumbs.tsx
    Reason: Component shape unclear — exports default a
            higher-order function, not a component directly.
            Run /frameworks:storybook:stories:gen with explicit path
            after refactor or pass --component-of <name>.

  components/core/organisms/data-grid/DataGrid.tsx
    Reason: Lint failed after generation; story has unresolvable
            type errors. Review manually.

Storybook coverage:
  Before: 198 / 247 (80.2%)
  After:  243 / 247 (98.4%)

Lint:
  All generated files pass: yes
  Issues auto-fixed: 4
```

If Storybook is running, the report includes verified-rendering
counts:

```
Verified rendering: 43 / 45 generated stories registered in Storybook index
                    (2 require Storybook restart — file system
                     watching missed them)
```

## Composition

Common follow-ups:

- `/frameworks:storybook:verify:health <category>` to verify generated
  stories actually render
- `/frameworks:storybook:catalog` to see updated coverage stats
- `/frameworks:storybook:stories:doc <component>` to add MDX docs to the
  newly generated stories

## Cross-routine integration

The `engineer/maintenance/remediation/atomic-design.md` routine invokes
this command as part of AD-7 violation cleanup (components
should have stories). The integration:

```bash
# In atomic-design.md
/frameworks:storybook:stories:gen-missing molecules
```

After gen-missing completes, atomic-design's verification step
re-runs to confirm AD-7 violations cleared.

## What this command does NOT do

- **Generate stories for non-components.** Files that look
  component-shaped but don't actually export components are
  surfaced and skipped.
- **Override the gen command's per-component prompts.** Each
  delegated gen invocation handles its own prompts; this
  command tracks the batch.
- **Modify components.** Generates story files only. If a
  component's shape makes story generation impossible (failed
  detection), surfaces and moves on.
- **Auto-resolve lint failures.** Auto-fixes are offered when
  lint reports auto-fixable issues; non-auto-fixable issues
  require manual review.

## Examples

```bash
# Generate stories for everything missing
/frameworks:storybook:stories:gen-missing

# Limit to atoms
/frameworks:storybook:stories:gen-missing atoms

# Limit to a feature section (manifest-defined)
/frameworks:storybook:stories:gen-missing "Discover Schools"

# Dry-run to see what would happen
/frameworks:storybook:stories:gen-missing --dry-run

# Cap batch size (work incrementally)
/frameworks:storybook:stories:gen-missing --limit 10

# Group by category in the report
/frameworks:storybook:stories:gen-missing --by-category
```

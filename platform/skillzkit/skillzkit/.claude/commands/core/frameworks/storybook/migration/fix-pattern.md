---
description: Document or look up known migration fix patterns. The known-gotchas registry lives in product/.pencil-storybook.json and accumulates project-specific migration issues. This command writes new gotchas via --add-gotcha, looks up existing gotchas by component or symptom, and formats them for surfacing during migration:verify failures.
argument-hint: [component] [--add-gotcha] [--symptom <text>] [--gotcha-id <id>] [--list] [--remove <id>]
allowed-tools: Read, Write, Edit, Bash
---

Manage the project's known migration gotchas registry.
Documents patterns the team encounters during migrations so
future migrations benefit from prior learning.

The registry lives in `product/.pencil-storybook.json` under
`knownGotchas`. The suite ships with empty array; projects
accumulate their own gotchas.

## Modes

### Lookup by component — `<component>`

```bash
/core:frameworks:storybook:migration:fix-pattern Button
```

Returns all gotchas matching the component (or wildcards
matching). Useful when verifying a migration and a component
fails: lookup before debugging.

### Lookup by symptom — `--symptom <text>`

```bash
/core:frameworks:storybook:migration:fix-pattern --symptom "border-radius"
```

Searches gotcha issue/fix text for the term. Returns matching
gotchas regardless of component.

### Lookup by ID — `--gotcha-id <id>`

```bash
/core:frameworks:storybook:migration:fix-pattern --gotcha-id heroui-v3-button-ghost-radius
```

Returns the specific gotcha with full details.

### Add — `--add-gotcha`

Walks through gotcha documentation interactively:

```
=== Add Migration Gotcha ===

Framework affected (e.g., heroui, tailwind, next.js, react):
> heroui

Version (e.g., v3, 3.4+, all):
> v3

Component affected (or 'all' if cross-component):
> Button

Issue description:
  What broke or changed unexpectedly during migration?
> Button ghost variant uses different border-radius in v3

Fix description:
  How was this resolved? Be specific about the code change.
> Update theme spacing scale; v2 used radius-md (8px) for ghost
> variant; v3 uses radius-sm (4px). Either update the theme
> token to restore old radius, or accept v3 default and update
> design specs.

Generated gotcha ID: heroui-v3-button-ghost-radius

Add to knownGotchas? [Y/n]
```

After confirmation, writes to `.pencil-storybook.json`:

```jsonc
{
  "knownGotchas": [
    {
      "id": "heroui-v3-button-ghost-radius",
      "framework": "heroui",
      "version": "v3",
      "component": "Button",
      "issue": "Button ghost variant uses different border-radius in v3",
      "fix": "Update theme spacing scale; v2 used radius-md (8px) for ghost variant; v3 uses radius-sm (4px). Either update the theme token to restore old radius, or accept v3 default and update design specs.",
      "addedDate": "2026-05-03",
      "addedBy": "<git user.email if available>"
    }
  ]
}
```

### List — `--list`

```bash
/core:frameworks:storybook:migration:fix-pattern --list
```

Shows all gotchas grouped by framework + version:

```
=== Known Migration Gotchas (12 total) ===

heroui v3 (5 gotchas):
  - heroui-v3-button-ghost-radius
    Component: Button
    Issue: Button ghost variant uses different border-radius
    Added: 2026-05-03

  - heroui-v3-card-padding
    Component: Card
    Issue: Card padding shifted from p-4 to p-3
    Added: 2026-05-04

  ... (etc.)

tailwind v4 (3 gotchas):
  - tailwind-v4-theme-directive
    Component: all
    Issue: @theme directive replaces tailwind.config.js theme block
    ...

next.js 15 (4 gotchas):
  ...
```

### Remove — `--remove <id>`

```bash
/core:frameworks:storybook:migration:fix-pattern --remove heroui-v3-button-ghost-radius
```

Deletes the gotcha. Useful when a gotcha was documented for a
specific framework version that's no longer in use, or when
the underlying issue is fixed upstream.

## Phase 0: pre-flight

1. Verify `.pencil-storybook.json` exists.
2. Read `knownGotchas` array.

## Phase 1: dispatch by mode

```bash
case "$MODE" in
  add-gotcha)
    interactive_add
    ;;
  list)
    show_all_grouped
    ;;
  lookup-component|lookup-symptom|lookup-id)
    perform_lookup
    ;;
  remove)
    confirm_and_remove "$ID"
    ;;
esac
```

## Add mode — interactive walkthrough

The fields in order:

1. **Framework** — single value (heroui, tailwind, next.js,
   react, etc.). Suggested completions from existing gotchas
   in the registry.

2. **Version** — version constraint string. Common patterns:
   - Specific: `v3`, `3.4.0`
   - Range: `3.4+`, `>=3.0`
   - All: `all`

3. **Component** — component name OR `all` for cross-component
   gotchas. Suggested completions from manifest's component
   manifest.

4. **Issue** — what broke or changed. Encouraged to be
   specific (not "Buttons broken" but "Button ghost variant
   border-radius shifted from 8px to 4px").

5. **Fix** — how to resolve. Encouraged to include:
   - The specific code change
   - Whether this is a theme update vs component code change
   - Cross-references to ADRs if applicable
   - Caveats (e.g., "fix only applies if you want to preserve
     v2 visual behavior; alternative is accepting v3 default")

After collection, generate the ID:

```bash
# Generate ID: <framework>-<version-slug>-<component-slug>-<issue-keyword>
# Lowercase, hyphenated, predictable
ID="${framework}-${version_slug}-${component_slug}-${issue_keyword}"
```

The ID generation is deterministic enough to be predictable
from the inputs, but the user can override:

```
Generated gotcha ID: heroui-v3-button-ghost-radius

Use this ID? [Y / type custom]
```

## Lookup mode — by component

```bash
COMPONENT="$1"

MATCHES=$(jq --arg c "$COMPONENT" '
  .knownGotchas[]?
  | select(.component == $c or .component == "all")
' product/.pencil-storybook.json)
```

Returns all matching gotchas with full detail. If multiple
match (different framework/version targeting the same
component), order by addedDate descending.

```
=== Gotchas matching: Button ===

heroui-v3-button-ghost-radius
  Framework:     heroui v3
  Component:     Button
  Issue:         Button ghost variant uses different border-radius in v3
  Fix:           Update theme spacing scale; v2 used radius-md (8px)
                 for ghost variant; v3 uses radius-sm (4px). Either
                 update the theme token to restore old radius, or
                 accept v3 default and update design specs.
  Added:         2026-05-03

heroui-v2-button-padding
  Framework:     heroui v2
  Component:     Button
  Issue:         Button padding inconsistent across sizes in v2.4
  Fix:           Use Button size="md" with explicit padding override
                 in stories that hit the inconsistency.
  Added:         2025-12-15
```

## Lookup mode — by symptom

```bash
SYMPTOM="$1"

MATCHES=$(jq --arg s "$SYMPTOM" '
  .knownGotchas[]?
  | select(
      (.issue | test($s; "i")) or
      (.fix | test($s; "i"))
    )
' product/.pencil-storybook.json)
```

Useful when migration:verify surfaces an unfamiliar failure
and you want to check if anyone else has hit similar.

## Cross-namespace integration

This command is invoked by `migration:verify` when failures
match patterns:

```
core-atoms-button--ghost
  Failed at:  Loop 4 (pixel)
  Matching gotcha:
    [from /core:frameworks:storybook:migration:fix-pattern lookup]
    heroui-v3-button-ghost-radius
    ...
```

When the migration:verify command finds matching gotchas, it
calls this command's lookup logic to format the gotcha for
display. The integration keeps gotcha formatting in one place.

## Schema considerations

The `knownGotchas` array is part of `.pencil-storybook.json`
schema. When adding a gotcha, validate against the schema:

- `id` — required, string, hyphenated lowercase
- `framework` — required, string
- `version` — optional, string (defaults to "all" if not
  provided)
- `component` — optional, string (defaults to "all" if not
  provided)
- `issue` — required, string, descriptive
- `fix` — required, string, actionable
- `addedDate` — auto-populated, ISO date
- `addedBy` — auto-populated from git user.email when
  available

## What this command does NOT do

- **Auto-fix migrations.** It documents and looks up patterns;
  applying fixes is the user's job (or `/verify:fix` for some
  cases).
- **Sync with external gotcha sources.** Each project's
  registry is local. There's no central "all heroui gotchas
  ever" database — the registry is intentionally project-
  specific.
- **Validate gotcha applicability.** A gotcha for heroui v3
  might be irrelevant if the project just migrated to v4. The
  user manages the registry's relevance.
- **Replace official upgrade guides.** Gotchas supplement
  framework docs; they don't replace them. context7 MCP
  (`/core:tools:context7`) is the way to look up official docs.

## Examples

```bash
# Document a gotcha you just found
/core:frameworks:storybook:migration:fix-pattern --add-gotcha

# Look up gotchas for a component
/core:frameworks:storybook:migration:fix-pattern Button

# Search by symptom
/core:frameworks:storybook:migration:fix-pattern --symptom "border-radius"

# Find a specific gotcha
/core:frameworks:storybook:migration:fix-pattern --gotcha-id heroui-v3-button-ghost-radius

# List all gotchas
/core:frameworks:storybook:migration:fix-pattern --list

# Remove obsolete gotcha
/core:frameworks:storybook:migration:fix-pattern --remove heroui-v2-button-padding
```

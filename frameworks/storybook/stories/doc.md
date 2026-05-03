---
description: Generate MDX documentation for a component beyond what autodocs provides. Outputs a .mdx file with structured documentation (overview, usage, API reference, accessibility notes, related components) that integrates with Storybook's docs viewer.
argument-hint: <component-name-or-path> [--update] [--sections overview,usage,api,a11y,related]
allowed-tools: Read, Write, Edit, Bash
---

Generate MDX documentation for a component. While autodocs
produces basic API documentation automatically, MDX lets you add
narrative documentation, inline examples, structured guidance,
and cross-references that autodocs alone can't provide.

This command produces a `.mdx` file alongside the component and
its stories. Storybook 8+ picks up MDX files automatically when
they reference an existing story file.

## Phase 0: discovery

1. Read `product/.pencil-storybook.json`. If missing, auto-trigger
   init for required fields (storybook, componentOrganization,
   addons).
2. Verify `@storybook/addon-docs` (or equivalent) is in the
   manifest's addons:
   ```bash
   DOCS_ADDON=$(jq -r '.addons.docs // empty' product/.pencil-storybook.json)
   test -n "$DOCS_ADDON" || {
     echo "Docs addon not detected in manifest. MDX docs require"
     echo "@storybook/addon-docs. Install and re-run /frameworks:storybook:init"
     echo "to update the manifest."
     exit 1
   }
   ```
3. Read suite content sources for content generation:
   `.pencil-tone.json`, `.pencil-editorial.json`,
   `.pencil-brand.json`.

## Phase 1: locate the component

Same logic as `/frameworks:storybook:stories:gen` Phase 1. The component
must already have a story file — MDX docs reference stories.

```bash
# Verify story file exists
COMPONENT_DIR=$(dirname "$COMPONENT_PATH")
COMPONENT_NAME=$(basename "$COMPONENT_PATH" .tsx)
STORY_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.stories.tsx"

test -f "$STORY_FILE" || {
  echo "No story file found at $STORY_FILE"
  echo "Generate stories first via /frameworks:storybook:stories:gen"
  exit 1
}
```

## Phase 2: analyze the component

Read the component source AND the story file. Extract:

### From the component

- Props interface with full descriptions
- Default values
- JSDoc comments at component level (treat as overview source)
- Accessibility-relevant code (`aria-*` attributes, role usage,
  keyboard handlers)

### From the story file

- Story title (for the MDX `Meta` reference)
- Generated variants (for reference in usage examples)
- Custom decorators or render functions (which may indicate
  setup requirements)

### Existing MDX file

```bash
MDX_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.mdx"
test -f "$MDX_FILE" && EXISTING=true || EXISTING=false
```

If exists and `--update` was NOT provided, prompt:

> MDX file already exists at `<path>`. Choose:
>   1. Update — refresh sections that look stale
>   2. Replace — overwrite entirely
>   3. Cancel
> [1/2/3]

## Phase 3: section selection

Default sections (when `--sections` not provided):

1. **Overview** — what the component is, when to use it
2. **Usage** — basic examples, common patterns
3. **API** — props reference (often supplements autodocs)
4. **Accessibility** — keyboard support, ARIA notes, screen
   reader behavior
5. **Related** — cross-references to related components

`--sections overview,usage` limits to specific sections.

## Phase 4: generate MDX content

### Frontmatter / Meta

```mdx
import { Meta, Story, Canvas, Controls, ArgTypes } from "@storybook/blocks";
import * as ComponentNameStories from "./ComponentName.stories";

<Meta of={ComponentNameStories} />

# ComponentName

<Subtitle>Brief one-liner from JSDoc or story description</Subtitle>
```

### Overview section

Pull from the component's JSDoc (if present) or generate based
on detected component shape:

```mdx
## Overview

ComponentName is a <atomic-level> for <inferred purpose>. Use it when:

- <inferred use case 1>
- <inferred use case 2>
- <inferred use case 3>

Don't use it for:

- <inferred anti-use case 1, when applicable>

### When to choose this vs alternatives

If the component sits in a category with related components
(other atoms in the same group), surface alternatives:

> If you need a click target with no visual emphasis, see
> [Link](?path=/docs/core-atoms-link--docs).
> If you need a click target carrying state, see
> [ToggleButton](?path=/docs/core-atoms-togglebutton--docs).
```

### Usage section

```mdx
## Usage

### Basic

<Canvas of={ComponentNameStories.Default} />

```tsx
import { ComponentName } from "@/components/core/atoms/component-name/ComponentName";

<ComponentName label="Submit" />
```

### Variants

<Canvas of={ComponentNameStories.AllVariants} />

Pick the variant that matches the action's emphasis:

- `solid` — primary actions, single per page
- `bordered` — secondary actions
- `flat` — tertiary actions, dense UI

### Sizes

<Canvas of={ComponentNameStories.AllSizes} />

Default to `md`. Use `sm` in dense layouts (data tables,
toolbars). Use `lg` for hero CTAs and confirmation actions.
```

The Canvas blocks reference stories from the `.stories.tsx`
file. The narrative around them gets generated from:

- Tone JSON (formality, technical density influences phrasing)
- Editorial JSON (sentence length, capitalization)
- Component shape (variants → recommended uses)

When tone/editorial sources don't exist, fall back to neutral
professional voice.

### API section

```mdx
## API

<ArgTypes of={ComponentNameStories} />

### Notable props

#### `variant`

The visual style. Accepts `"solid" | "bordered" | "flat" |
"light" | "ghost"`. Default: `"solid"`.

When choosing, consider visual hierarchy:
- Page has one primary action → `solid`
- Page has secondary actions → `bordered`
- Inline actions in dense UI → `flat`

#### `isLoading`

Boolean. When `true`, the component shows a spinner and
disables interaction. The label remains visible behind the
spinner so layout doesn't shift.
```

The "Notable props" subsections are generated for props with
non-trivial behavior (enums with multiple options, booleans
that affect layout, props that interact with other props).
Trivial props (a `className` passthrough, `id`) don't need
narrative beyond the autodocs entry.

### Accessibility section

```mdx
## Accessibility

<details>
  <summary>Keyboard support</summary>

  | Key | Action |
  |-----|--------|
  | `Enter` / `Space` | Activate |
  | `Tab` | Move focus to next focusable |
  | `Shift+Tab` | Move focus to previous focusable |

</details>

### ARIA

The component renders as `<button>` by default, providing
implicit `role="button"`. When rendered as `<a>` (via the
`as` prop), focus and keyboard handling switch to link
semantics.

When `isLoading` is true, the component sets
`aria-busy="true"` and `aria-disabled="true"`. The visible
label is preserved for screen reader context.

### Screen reader

VoiceOver: "<label>, button" / "<label>, link"
NVDA: same
JAWS: same

### Color contrast

All variants meet WCAG 2.1 AA contrast (4.5:1 for body text,
3:1 for large text and UI components) at every size on both
default backgrounds. Verified via the `@storybook/addon-a11y`
panel.
```

Detection of accessibility content:

- ARIA attributes in component source → ARIA notes
- Keyboard handlers (`onKeyDown`, `onKeyUp`) → keyboard support
- Focus management code → focus notes
- The component's variant/size matrix → contrast scope

When the component is purely presentational (no interaction),
the section narrows to ARIA and contrast.

### Related components section

```mdx
## Related

- [Link](?path=/docs/core-atoms-link--docs) — for navigation
  rather than action
- [IconButton](?path=/docs/core-atoms-iconbutton--docs) — for
  actions with no label, only icon
- [ButtonGroup](?path=/docs/core-molecules-buttongroup--docs) —
  for multiple related actions in a row
```

Detection:

- Components in the same atomic category that share prop names
- Compound siblings (e.g., `Button.Group` ↔ `ButtonGroup`)
- Components imported by/from this component (consumers and
  dependencies)

If no clear related components are found, this section is
omitted (don't fabricate relationships).

## Phase 5: write MDX file

```bash
MDX_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.mdx"
```

For update mode, preserve manual sections:

- Sections with content the user clearly wrote (long-form
  prose, specific examples not derivable from component shape)
- Custom Canvas blocks pointing to story IDs not generated by
  gen
- Hand-authored ARIA notes that go beyond what's detectable

Replace:

- The auto-generated overview when component shape changed
- ArgTypes block (always regenerated; pulls live from stories
  file)
- Canvas blocks pointing to gen-generated story IDs (refresh in
  case story names changed)

Detection of "manual section" vs "generated section": presence
of a `<!-- gen:hash:XXXXX -->` marker. Sections we generate
include this marker; sections without are treated as manual.

## Phase 6: verify MDX renders

If Storybook is running, verify the new docs page is reachable:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
DOCS_ID=$(derive_docs_id "$STORY_TITLE")  # e.g., "core-atoms-button--docs"

curl -sf "${LOCAL_URL}/index.json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data.get('entries', data.get('stories', {}))
target = '$DOCS_ID'
if target in entries and entries[target].get('type') == 'docs':
    print('REGISTERED')
else:
    print('NOT_REGISTERED')
"
```

If not registered after 5 seconds, surface for user attention
(may need Storybook restart for docs auto-detection).

## Phase 7: report

```
=== MDX Doc Generation Report ===
Component:     Button (components/core/atoms/button/Button.tsx)
Title:         Core/Atoms/Button
MDX file:      components/core/atoms/button/Button.mdx
Sections:      5 generated (overview, usage, api, a11y, related)

Detected for content:
  Atomic level:        atom
  Variants:            solid, bordered, flat, light, ghost
  Sizes:               sm, md, lg
  Has aria attributes: yes (3)
  Has keyboard:        yes (Enter, Space)
  Related found:       3 (Link, IconButton, ButtonGroup)

Lint:          pass
Docs page:     registered (verified) at
               http://localhost:6006/?path=/docs/core-atoms-button--docs
```

## Cross-namespace effects

- **`product/design/patterns`** — when a pattern's MDX docs reference a
  Pencil pattern (e.g., "implements the CTA pattern"), the
  cross-reference is two-way; Pencil pattern docs may
  reference back to the component's MDX
- **`product/design/foundations/a11y`** — accessibility section pulls
  conventions from the project's a11y foundation when defined
- **`engineer/maintenance/remediation/storybook-drift`** — drift
  detection includes "MDX docs out of sync with current
  component API"; refreshes via this command

## What this command does NOT do

- **Generate documentation for components without stories.**
  Story file is a prerequisite; MDX references the stories.
- **Replace autodocs.** MDX is supplemental; the autodocs
  panel still picks up component props and renders them. MDX
  adds the narrative.
- **Generate accessibility audit results.** That's
  `/frameworks:storybook:verify:a11y`. Doc generation captures known a11y
  facts (keyboard support, ARIA usage); audit catches what's
  broken.
- **Cross-link components arbitrarily.** Related components
  are detected from prop similarity, compound relationships,
  and imports. Speculative cross-references are surfaced for
  user confirmation, not auto-included.

## Examples

```bash
# Generate full MDX docs for a component
/frameworks:storybook:stories:doc Button

# Update existing MDX (refresh autodetected sections)
/frameworks:storybook:stories:doc Button --update

# Limit to specific sections
/frameworks:storybook:stories:doc Button --sections overview,usage

# Just the API reference (useful when component API changed)
/frameworks:storybook:stories:doc Button --update --sections api
```

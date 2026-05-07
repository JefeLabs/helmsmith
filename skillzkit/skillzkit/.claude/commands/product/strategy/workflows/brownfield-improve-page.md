---
type: workflow
outcome: Refresh an existing page
description: Refresh an existing page — visual polish, content updates, layout improvements. The brand stays the same; the page evolves.
estimatedDuration: 1-4 hours per page
phases: 6
prerequisites:
  - design/pages/<page-slug>.pen exists
  - src/pages/<page-slug>.tsx (or equivalent) exists
  - product/.pencil-brand.json defines the brand
---

# Workflow — Brownfield: Improve Page

> **When to use**: incremental improvement to an existing page —
> tightening visual hierarchy, refreshing content sections, fixing
> usability issues, updating to use new patterns.
>
> **When NOT to use**:
> - Adding a brand-new page → use `brownfield-add-feature`
> - Rebuilding from scratch → use `brownfield-add-feature` and
>   delete the old page after
> - Brand-level changes affecting many pages → use `brand-refresh`

## Outputs of a complete run

- Updated `design/pages/<page-slug>.pen` (refined design)
- Updated `src/pages/<page-slug>.tsx` (regenerated React)
- `design/.diffs/<page-slug>-vs-prior.html` (visual diff for review)

## Phase 1 — Identify scope

**Prerequisite**: page exists in `design/pages/` and `src/pages/`.

Decide what needs to change:

- **Visual polish** (spacing, typography, contrast tweaks): minor
- **Content section update** (replace hero copy, add testimonial,
  remove pricing tier): moderate
- **Layout restructure** (new section order, different
  responsive behavior, altered information density): significant
- **Pattern adoption** (replace inline section with a pattern from
  `patterns/`): moderate

The scope guides Phase 3 — minor polish goes through `--in` refine;
significant restructure may need to start from a fresh exploration.

**Action**: write down (mentally or in a notes file) what's
changing and why.

**Mark complete**: `/core:workflows:manage complete identify-scope`

## Phase 2 — Capture current state

**Prerequisite**: Phase 1 done.

Capture a snapshot of the current page for diff comparison after
the refresh.

```bash
# If the page is in production:
/product:strategy:tokens-from <production-url> --out design/.snapshots/<page-slug>-before.json

# OR — if the page has an existing Figma design source (.fig file),
# this path is higher fidelity. open-pencil extracts structured
# tokens directly from the design document:
/product:strategy:tokens-from path/to/page-design.fig --out design/.snapshots/<page-slug>-before.json

# Or capture screenshot via Pencil (if .pen rendering is canonical):
# (This is a hypothetical; the actual tool would be a screenshot
# of the existing .pen render)
```

Also capture the current `.pen` as a backup:

```bash
cp design/pages/<page-slug>.pen design/.snapshots/<page-slug>-before.pen
```

**Mark complete**: `/core:workflows:manage complete capture-current`

## Phase 3 — Refine the page

**Prerequisite**: Phase 2 done.

Choose the right tool based on Phase 1 scope:

### Minor polish

```bash
/product:design:design-page <page-slug> --in design/pages/<page-slug>.pen \
                                --refine "specific changes — e.g. tighten section spacing, restore contrast on body text, replace stock icon with custom"
```

`--in` reads the existing `.pen` and refines in place. The output
overwrites the input (with the prior captured in
`design/.snapshots/`).

### Content section update

Same `--in --refine` approach but with more substantive prompt:

```bash
/product:design:design-page <page-slug> --in design/pages/<page-slug>.pen \
                                --refine "replace pricing-tier section with new 4-tier comparison, update hero copy to 'Now with X', add testimonial-grid below pricing"
```

### Layout restructure

For more significant changes, start from a fresh exploration:

```bash
# 1. Run explore with the new layout intent:
/product:design:explore "user can scan the dashboard and act on critical items in <2s" --based-on design/pages/<page-slug>.pen

# 2. Pick a row, run design-page with the existing brand:
/product:design:design-page <page-slug> --based-on design/explorations/<story>.pen#row-2 \
                                --replace
```

The `--replace` flag overwrites the existing `.pen` instead of
keeping the prior version (which would create two pages competing
for the same slug).

### Pattern adoption

If the goal is to replace inline composition with imported patterns:

```bash
/product:design:design-page <page-slug> --in design/pages/<page-slug>.pen \
                                --refine "extract hero, footer, and FAQ sections to reference patterns/hero, patterns/footer, patterns/faq instead of inline"
```

This shifts the `.pen` from inline composition to pattern imports.
After Phase 5 build, the React will compose patterns rather than
re-implementing.

**Mark complete**: `/core:workflows:manage complete refine-page`

## Phase 4 — Visual diff

**Prerequisite**: Phase 3 done.

Compare the refined page to the prior version:

```bash
/product:design:diff design/.snapshots/<page-slug>-before.pen design/pages/<page-slug>.pen
```

This produces `design/.diffs/<page-slug>-vs-prior.html` with:
- Side-by-side renders at canonical breakpoints
- Pixel-level diff overlays
- Token-level diff (new / removed / changed token references)
- Summary of structural changes

Review the diff before proceeding. If it shows unintended
regressions, return to Phase 3 with a refined prompt.

**Renderer choice**: by default `/product:design:diff` uses Pencil's
renderer for both inputs. If you anticipate exporting this page to
`.fig` for designer review (Phase 6 ship), pass
`--renderer open-pencil` so the diff renderer matches the export
renderer — eliminates "looks fine in Pencil, looks different in
Figma" surprises.

**Mark complete**: `/core:workflows:manage complete visual-diff`

## Phase 5 — Build React

**Prerequisite**: Phase 4 reviewed and approved.

Regenerate the React:

```bash
/core:frameworks:heroui:build-components <page-slug>
```

The build manifest tracks which components were affected. If the
page changes affected only the page-level composition (no atoms
modified), only the page-level React rebuilds. If atoms changed,
they rebuild and the build manifest's `consumedBy` array surfaces
other affected pages.

**Tip**: review the consumer count from the build manifest. If your
page change affected a shared atom, other pages may need re-render
too.

**Mark complete**: `/core:workflows:manage complete build`

## Phase 6 — Audit + ship

```bash
/audit
```

Specific things to watch for after a page improvement:

- **Plane 1 lints**: did the refine introduce inline arbitrary values?
  Common when free-form prompts inject hex colors or pixel values.
- **Plane 2**: page `.pen` ahead of components — if the refine
  introduced new component variants, they need to land in the
  components `.pen` first.
- **Plane 7a (composition)**: did the refine inline a section that
  has a pattern? Audit suggests pattern adoption.

Address `fail`-severity findings. Then ship.

**Mark complete**: `/core:workflows:manage complete ship`

## Workflow complete

The page is refreshed. State logs the workflow run for history.

## Resume points

- **Paused after Phase 1 (scope)**: scope identified, no changes
  made. Resume goes to capture-current.
- **Paused after Phase 2 (capture)**: snapshot exists. Resume goes
  to refine.
- **Paused after Phase 3 (refine)**: page updated. Resume goes to
  visual diff.
- **Paused after Phase 4 (diff)**: diff reviewed. Resume goes to
  build.

## Troubleshooting

- **Refine produces unintended changes elsewhere**: the prompt was
  too broad. Re-run with a more specific scope describing only the
  intended sections.
- **Diff shows the same content rendered differently**: token shift
  somewhere upstream. Check brand JSON timestamps; if foundations
  changed since last build, that's expected — the diff is showing
  the page catching up to the new tokens.
- **Build fails with "atom not found"**: the refine introduced a
  reference to an atom that doesn't exist. Either add the atom to
  `design/heroui/components/<group>.pen` and rebuild, or change the
  refine to use an existing atom.
- **Diff is huge for a "minor" polish**: the refine cascaded
  unexpectedly. Review the prompt; "tighten spacing" can land as
  "redo all spacing tokens." Use `--surgical` flag (when
  implemented) or scope the prompt to specific selectors.

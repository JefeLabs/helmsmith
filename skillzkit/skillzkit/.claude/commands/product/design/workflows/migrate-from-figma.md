---
type: workflow
outcome: Bring Figma system into Pencil
description: Bring an existing Figma design system into Pencil. For teams that designed-first-in-Figma and now want code-level design-system tooling. Different from migrate-to-pencil — this assumes Figma sources but no shipped product code yet.
estimatedDuration: 1 day for the migration; ongoing for evolution
phases: 5
prerequisites:
  - Existing Figma design system files (.fig)
  - open-pencil installed (brew install open-pencil OR npm install -g @open-pencil/cli)
  - Pencil CLI or MCP server installed
  - No production code yet (or production code intended to be regenerated)
---

# Workflow — Migrate from Figma

> **When to use**: a team designed first in Figma. The design
> system exists as `.fig` files (a foundations file, components
> file, templates file, page sources). Now scaling and want
> Pencil-driven code generation, fleet-wide consistency, and the
> formal design-to-code pipeline.
>
> **When NOT to use**:
> - Already shipped product UI exists → use `migrate-to-pencil`
>   instead (assumes shipped code as the baseline)
> - No design system, just scattered Figma frames → start with
>   `greenfield`; cherry-pick from Figma via tokens-from later
> - Want to keep Figma as source of truth → don't migrate. Use
>   `figma-roundtrip` for review cycles instead.

## Outputs of a complete run

- `design/foundations/*.pen` (converted from Figma foundations file)
- `design/heroui/components/*.pen` (converted from Figma components
  file; framework name varies by project)
- `design/templates/*.pen` (converted from Figma templates file, if
  present)
- `product/.pencil-brand.json` (extracted from converted foundations)
- `app/globals.css` `@theme` (token writes from extracted brand)
- `design/.figma-migration-log.md` (per-file conversion + reconcile
  notes)

## Phase 1 — Inventory Figma sources

**Prerequisite**: existing Figma design system; designer / design-
ops contact who can identify the source files.

Identify the canonical `.fig` files for the design system. A
typical structure:

- **Foundations file** — color tokens, typography, spacing scale,
  radius scale, motion tokens. Sometimes split: separate files for
  colors, typography, etc.
- **Components file** — atom + molecule definitions (buttons,
  forms, cards, etc.). May span multiple files.
- **Templates file** — full-page layouts (landing, dashboard, auth).
- **Page sources** — actual product pages composed from the above.

If files are scattered or duplicated:

- **Pick the canonical version** for each. The migration commits
  to one source per category. Future evolution happens in Pencil,
  not in the prior Figma sources.
- **Note duplications** in the migration log for the team's
  awareness — the migrated state is single-source-of-truth, the
  Figma duplicates become reference material.

If the team uses Figma's library/team/branch features:

- The library `.fig` is the foundations + components source
- Team files consume the library; those become page sources
- Branches are working state — migrate from main, not branches

**Action**: list the `.fig` files going into the migration with
their roles (foundation / component / template / page).

**Mark complete**: `/core:workflows:manage complete inventory`

## Phase 2 — Convert .fig → .pen

**Prerequisite**: Phase 1 done; `.fig` files available locally.

Convert each `.fig` to `.pen` using open-pencil:

```bash
mkdir -p design/foundations design/heroui/components design/templates

# Foundations:
open-pencil convert path/to/foundations.fig --to pen \
  --out design/foundations/_imported.pen

# Components:
open-pencil convert path/to/components.fig --to pen \
  --out design/heroui/components/_imported.pen

# Templates (if present):
open-pencil convert path/to/templates.fig --to pen \
  --out design/templates/_imported.pen

# Pages (one per page):
for fig in path/to/pages/*.fig; do
  basename=$(basename "$fig" .fig)
  open-pencil convert "$fig" --to pen \
    --out "design/pages/${basename}.pen"
done
```

The conversion is round-trip fidelity — Figma variables, component
variants, auto-layout all preserve.

The `_imported.pen` files are intermediate. Phase 3 reconciles
them into Pencil's foundation / component conventions.

**Mark complete**: `/core:workflows:manage complete convert-fig`

## Phase 3 — Reconcile foundations

**Prerequisite**: Phase 2 done; `_imported.pen` files exist.

Figma's organization rarely matches Pencil's foundation conventions
exactly. Reconcile:

### 3a — Extract brand JSON from imported foundations

```bash
/product:strategy:tokens-from design/foundations/_imported.pen \
  --target all \
  --apply-to brand-json
```

This populates `product/.pencil-brand.json` with the high-confidence
tokens (primary, secondary, fonts, etc.) from the imported design
system. Lower-confidence extractions surface for explicit ack.

### 3b — Split _imported.pen into canonical foundations

The `_imported.pen` likely contains all token categories in one
file. Split into Pencil's per-category foundation files:

```bash
# Generate canonical foundation files using the brand JSON:
/product:design:foundations:colors
/product:design:foundations:typography
/product:design:foundations:spaces
/product:design:foundations:icons
# ... etc.
```

These commands read brand JSON (now populated) and produce
canonical foundation `.pen` files. The output supplants
`_imported.pen` for ongoing work.

### 3c — Mark imported as locked

The `_imported.pen` files become reference, not source:

```bash
mkdir -p design/.figma-import
mv design/foundations/_imported.pen design/.figma-import/
mv design/heroui/components/_imported.pen design/.figma-import/
mv design/templates/_imported.pen design/.figma-import/
```

The reference copies stay in `.figma-import/` for diff comparison
during component migration in Phase 4.

### 3d — Verify token integrity

Run `tokens-from` on both the original `.fig` and the new canonical
foundations, compare:

```bash
open-pencil variables path/to/foundations.fig --json > /tmp/figma-tokens.json
/product:design:foundations:colors  # ensures the canonical .pen is current
# Compare via diff:
jq '.[] | .name' /tmp/figma-tokens.json | sort > /tmp/figma-token-names.txt
jq '.[] | .name' product/.pencil-colors.json | sort > /tmp/pencil-token-names.txt
diff /tmp/figma-token-names.txt /tmp/pencil-token-names.txt
```

Anything in the original `.fig` that's missing from the Pencil
state is a fidelity loss. Surface and decide:

- **Add the missing tokens** to brand JSON + foundations (most
  common)
- **Accept the loss** if the token wasn't load-bearing (e.g. a
  one-off color used in a single deprecated component)

**Mark complete**: `/core:workflows:manage complete reconcile-foundations`

## Phase 4 — Reconcile components

**Prerequisite**: Phase 3 done.

The Figma components file imports as a single `_imported.pen`. Need
to split into Pencil's component group convention (buttons.pen,
forms.pen, surfaces.pen, etc.).

Two paths depending on alignment:

### Path A — Figma organization mostly matches Pencil's

If the Figma file organizes components into pages similar to
Pencil's groupings (a "Buttons" page with all button variants, a
"Forms" page with inputs, etc.), the split is mechanical:

```bash
# Use open-pencil to extract per-page subsets:
open-pencil eval design/.figma-import/_imported.pen \
  -c "exportPages(['Buttons']) → design/heroui/components/buttons.pen"
# (repeat per group)
```

### Path B — Figma organization differs from Pencil's

Re-generate components from canonical foundations using Pencil's
patterns, treating the Figma `_imported.pen` as visual reference:

```bash
for group in surfaces buttons forms feedback overlays navigation; do
  /core:frameworks:heroui:components:$group \
    --inherit-from design/.figma-import/_imported.pen
done
```

The `--inherit-from` flag (when implemented) treats the Figma
import as a visual style reference — the generated components
match the imported visual style while conforming to Pencil's
canonical structure.

### 4c — Build React from canonical components

```bash
/core:frameworks:heroui:build-components --foundation-only --rebuild
```

This produces React components from the canonical (Pencil-shaped)
component `.pen`s, not from the Figma imports.

**Mark complete**: `/core:workflows:manage complete reconcile-components`

## Phase 5 — Audit + verify

**Prerequisite**: Phase 4 done.

Run the full audit:

```bash
/audit
```

Migration-from-Figma watch-fors:

- **Plane 3 (token drift)**: brand JSON and `@theme` should match
  the Figma extraction. Drift here means the conversion left
  tokens behind.
- **Plane 1 design-layer (when open-pencil installed)**: Figma
  source files often have contrast issues that survived to the
  `.pen` import. Surface them now; defer fixes to a brand-refresh
  if structural changes are warranted.
- **Plane 7c (brand-fit)**: if audience-regulation is k-12 / etc.,
  the imported templates may be missing required variants.

Address `fail`-severity findings.

Visual diff between original Figma and new Pencil state:

```bash
# For each component group, render both and compare:
for group in buttons forms surfaces; do
  open-pencil export design/.figma-import/_imported.pen \
    --format png --filter "page:$group" \
    --out /tmp/figma-$group.png
  open-pencil export design/heroui/components/$group.pen \
    --format png --out /tmp/pencil-$group.png
  # Use any pixel-diff tool to compare
done
```

Fidelity loss is expected — Pencil's canonical structure differs
from the Figma original. The diff is for awareness, not blocking.

**Mark complete**: `/core:workflows:manage complete audit-verify`

## Workflow complete

The Figma design system is now in Pencil. The team can use
brownfield workflows for ongoing evolution, brand-refresh for
system-wide updates, and figma-roundtrip when designers want to
review/iterate in Figma (now with Pencil as source of truth).

The original Figma files become reference. They don't update with
ongoing Pencil work. If the team wants to keep them in sync (for
designers who continue working in Figma), use `figma-roundtrip`
to push Pencil changes back to Figma after each significant
change.

## Resume points

- **Paused after Phase 1 (inventory)**: file list captured;
  resume runs convert.
- **Paused after Phase 2 (convert)**: `.pen` imports exist;
  resume goes to reconcile-foundations.
- **Paused after Phase 3 (reconcile foundations)**: brand JSON
  populated, foundations canonical; resume goes to components.
- **Paused after Phase 4 (reconcile components)**: components
  canonical and built; resume runs audit.

## Troubleshooting

- **Conversion drops Figma variant model**: open-pencil's `.fig`
  codec preserves variants, but Pencil's component model differs.
  After conversion, the variants survive as named frames; the
  reconcile step (Phase 4) maps them to Pencil's variant
  conventions. Some manual mapping may be required for variant
  schemas that don't translate (e.g. Figma boolean variants vs
  Pencil enum variants).
- **Component instances become detached**: the converted `.pen`
  has the visual fidelity but instance ↔ master relationships may
  not perfectly translate. The reconcile step in Path B (re-
  generate from foundations) is the cleanest path; Path A
  (mechanical split) preserves instances better but requires
  Figma's organization to align with Pencil's.
- **Token names collide**: Figma's `Accent/500` and Pencil's
  `--color-accent-500` are conceptually the same but the naming
  conventions differ. The `tokens-from` extraction normalizes;
  if collision happens, the brand JSON write surfaces it for
  manual reconciliation.
- **Source Figma files get updated mid-migration**: the migration
  is a snapshot. If designers update the source files during the
  migration cycle, capture those updates as a separate
  `figma-roundtrip` cycle after the migration completes — don't
  redo the migration.
- **No clear "canonical" Figma file** (multiple competing
  versions): pick one. The migration commits to single source of
  truth. Document the choice + reasoning in the migration log so
  future contributors understand which version is canonical.

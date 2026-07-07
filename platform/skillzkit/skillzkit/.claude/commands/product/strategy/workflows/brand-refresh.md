---
type: workflow
outcome: Apply a brand refresh
description: System-wide brand update or rebrand. New colors, new fonts, new imagery direction. Cascades across foundations, components, patterns, templates, and pages with regression-protection at each step.
estimatedDuration: 3-7 days; high stakes (regression risk)
phases: 8
prerequisites:
  - product/.pencil-brand.json exists with current brand state
  - Foundations + components + at least some patterns exist
  - Some pages exist (otherwise this is greenfield)
---

# Workflow — Brand Refresh

> **When to use**: rebrand, brand evolution, design-system-wide
> modernization. The change cascades across many artifacts; this
> workflow stages the cascade with safety checkpoints.
>
> **When NOT to use**:
> - Small visual tweaks → `brownfield-improve-page`
> - Single page refresh → `brownfield-improve-page`
> - New feature in existing brand → `brownfield-add-feature`

## Outputs of a complete run

- New `product/.pencil-brand.json` (with old version archived)
- New `app/globals.css` `@theme` (with old archived)
- Refreshed `design/foundations/*.pen` (every file)
- Rebuilt `src/components/*` (every component)
- Regenerated `design/patterns/*.pen` (every pattern)
- Regenerated `design/templates/*.pen` (every template)
- For each existing page: regenerated `.pen` and rebuilt React
- Comprehensive `design/.diffs/<artifact>.html` for every changed
  artifact (the regression review packet)

## Stakes

This workflow regenerates a lot. Things that can break:

- Production pages with hand-edits get overwritten
- Custom atoms not in the design system get stranded
- Pages with hard-coded brand colors regress
- Stakeholder-approved visual decisions get forgotten

Use this workflow only when a brand-level change is genuinely
required. The regression-protection phases are non-skippable for
production projects.

## Phase 1 — Pre-refresh audit + snapshot

**Prerequisite**: existing project with established brand state.

Capture baseline before any change:

```bash
# 1. Run audit on current state — establishes drift baseline:
/audit --json --out design/.snapshots/pre-refresh-audit.json

# 2. Snapshot every artifact for diff comparison later:
mkdir -p design/.snapshots/pre-refresh
cp -r design/foundations design/.snapshots/pre-refresh/
cp -r design/heroui design/.snapshots/pre-refresh/
cp -r design/patterns design/.snapshots/pre-refresh/
cp -r design/templates design/.snapshots/pre-refresh/
cp -r design/pages design/.snapshots/pre-refresh/

# 3. Snapshot brand JSON + @theme:
cp product/.pencil-brand.json design/.snapshots/pre-refresh/brand.json
cp app/globals.css design/.snapshots/pre-refresh/globals.css
```

Address all `fail`-severity audit findings before proceeding.
Drift now will compound through the refresh.

**Optional — `.fig` archival.** Stakeholders often want a `.fig`
snapshot of the pre-refresh state for reference (and for showing
the before/after in stakeholder presentations). Export key
foundations and a few representative pages:

```bash
mkdir -p design/.snapshots/pre-refresh-fig
for pen in design/foundations/*.pen design/pages/landing.pen design/pages/dashboard.pen; do
  /product:design:export "$pen" --to figma --include-tokens \
    --out "design/.snapshots/pre-refresh-fig/$(basename $pen .pen).fig"
done
```

The `.fig` archive is more durable than `.pen` snapshots for
long-term reference because `.fig` is a cross-tool format.

**Mark complete**: `/core:workflows:manage complete pre-refresh-snapshot`

## Phase 2 — Define refresh scope

**Prerequisite**: Phase 1 done.

What's actually changing? Brand refreshes vary widely:

- **Color-only**: palette modernization, accent shift, dark-mode add.
  Cascades to foundations + components + (most) patterns + (some)
  templates.
- **Typography refresh**: new display + body font pairing. Cascades
  similarly but typography drifts more visibly.
- **Full visual refresh**: colors + fonts + imagery direction.
  Cascades everywhere.
- **Strategic rebrand**: new brand name, new positioning, new
  audience. Treat as semi-greenfield: some artifacts can be reused;
  most need fresh treatment.

The scope determines which select commands run in Phase 3:
- Color-only → only `colors-select`
- Typography refresh → only `fonts-select`
- Full → all four select commands
- Strategic rebrand → research + all four select commands

**Action**: write down the scope.

**Mark complete**: `/core:workflows:manage complete define-scope`

## Phase 3 — Re-run selection (with locks lifted)

**Prerequisite**: Phase 2 done.

Foundations bootstrapped via `migrate-to-pencil` are typically
locked. Lift locks for the foundations that need to change:

```bash
# Unlock specific foundations (manual edit in brand JSON, or):
/product:strategy:remove --token-lock primary    # if token-level locks exist
```

Then re-run selection commands per the scope. Use `--dry-run` first
to preview the diff, then confirm:

```bash
# Dry-run first:
/product:design:foundations:colors-select --dry-run \
  --informed-by design/research/<industry>.json \
  --strategy <strategy>

# Review the diff. Then commit:
/product:design:foundations:colors-select \
  --informed-by design/research/<industry>.json \
  --strategy <strategy>

# Repeat for fonts-select, imagery-select per scope:
/product:design:foundations:fonts-select  --dry-run  ...
/product:design:foundations:imagery-select --dry-run ...
```

Each select command writes atomically to brand JSON + `@theme`. The
prior values are recoverable via git revert if needed.

**Mark complete**: `/core:workflows:manage complete re-select`

## Phase 4 — Cascade through foundations

**Prerequisite**: Phase 3 done.

Re-render every foundation `.pen` to match new brand state:

```bash
/product:design:foundations:colors
/product:design:foundations:typography
/product:design:foundations:icons
/product:design:foundations:imagery
/product:design:foundations:logos
/product:design:foundations:spaces
/product:design:foundations:grids
/product:design:foundations:motion
/product:design:foundations:z-index
/product:design:foundations:a11y
/product:design:foundations:density
/product:design:foundations:i18n
```

Some foundations re-write tokens (motion, z-index, a11y, density,
i18n) — these are no-op if scope didn't touch them.

**Critical check**: run audit's Plane 3d (contrast revalidation):

```bash
/audit --plane 3
```

A new palette may produce contrast violations that didn't exist
before. **Fix these now** by adjusting the palette in
`colors-select` and re-running. Don't proceed past Phase 4 with
contrast violations.

**Earlier-catch via design-layer lint** (when open-pencil is
installed): `open-pencil lint <foundation>.pen --rule color-contrast`
catches contrast issues directly in the foundation `.pen` files
before they cascade into components — surfacing problems one
phase earlier than Plane 3d would. Run this after each
`foundations:colors` re-render:

```bash
for pen in design/foundations/colors.pen design/foundations/typography.pen; do
  open-pencil lint "$pen" --rule color-contrast --json
done
```

**Mark complete**: `/core:workflows:manage complete foundation-cascade`

## Phase 5 — Component rebuild

**Prerequisite**: Phase 4 done; contrast OK.

Rebuild every component to use new tokens:

```bash
/core:frameworks:heroui:build-components --foundation-only --rebuild
```

The `--rebuild` flag forces regeneration even when component hashes
haven't changed (since the tokens they reference have).

After the rebuild, the build manifest's `consumedBy` arrays show
which patterns / templates / pages will need re-render in
subsequent phases.

Run visual diff for each component:

```bash
# For each component group:
for comp in surfaces buttons forms feedback overlays navigation data-display; do
  /product:design:diff design/.snapshots/pre-refresh/heroui/components/$comp.pen \
                design/heroui/components/$comp.pen \
                --out design/.diffs/components-$comp.html
done
```

Review each diff. Visual changes are expected; structural changes
(new variants, removed states) need explicit acknowledgment.

**Mark complete**: `/core:workflows:manage complete component-rebuild`

## Phase 6 — Pattern + template cascade

**Prerequisite**: Phase 5 done.

Re-run patterns + templates that the build manifest's `consumedBy`
showed as affected:

```bash
# Re-recommend (research data may also need updating)
/product:strategy:re-recommend

# Then re-generate the recommended set per the manifest
# (This part is manual — iterate through the manifest)
```

Run visual diff for each pattern + template:

```bash
for pattern in hero footer cta feature-grid pricing-tier faq states; do
  /product:design:diff design/.snapshots/pre-refresh/patterns/$pattern.pen \
                design/patterns/$pattern.pen \
                --out design/.diffs/patterns-$pattern.html
done
```

Templates are next:

```bash
for tpl in landing-page error-page auth dashboard settings pricing legal; do
  /product:design:diff design/.snapshots/pre-refresh/templates/$tpl.pen \
                design/templates/$tpl.pen \
                --out design/.diffs/templates-$tpl.html
done
```

Stakeholder review checkpoint: stop here, package the diffs, get
sign-off before regenerating production pages. This is the last
chance to revert the refresh cleanly via git.

**For stakeholders who prefer to review in Figma**: alongside the
HTML diff packets, export the same set to `.fig` for in-Figma
review:

```bash
for tpl in landing-page auth dashboard pricing; do
  /product:design:export design/templates/$tpl.pen --to figma \
    --out design/.diffs/templates-$tpl-after.fig
done
```

Designers / brand stakeholders compare the `.fig` files against
the pre-refresh `.fig` archive from Phase 1 in their preferred
tool. Feedback comes back as edited `.fig` files — bring changes
back via `/product:design:export --from-fig --diff-merge` BEFORE Phase 7
(page regeneration). The `figma-roundtrip` workflow documents the
full async-review loop if review will span multiple sessions.

**Mark complete**: `/core:workflows:manage complete pattern-template-cascade`

## Phase 7 — Page regeneration

**Prerequisite**: Phase 6 done; stakeholder sign-off received.

For each existing page, regenerate against new brand state.

**Critical**: pages with hand-edits need careful handling. Audit
should have flagged any `@pencil-locked` pages — these are
intentionally hand-edited and should be re-finalized through
`brownfield-improve-page` later, not auto-regenerated here.

```bash
# Auto-regenerate non-locked pages:
for page in $(ls design/pages/ | grep -v '@pencil-locked'); do
  /product:design:design-page $(basename $page .pen) \
                      --in design/pages/$page \
                      --refresh-tokens-only
done

# Then rebuild React:
/core:frameworks:heroui:build-components --rebuild
```

The `--refresh-tokens-only` flag (when implemented) regenerates the
page applying new tokens but preserving structure / content. This
is the safest option for production pages.

For pages that can't be auto-regenerated cleanly, queue them for
`brownfield-improve-page` workflow after this refresh completes.

Visual diff every regenerated page:

```bash
for page in design/pages/*.pen; do
  basename=$(basename $page .pen)
  /product:design:diff design/.snapshots/pre-refresh/pages/$basename.pen $page \
                --out design/.diffs/pages-$basename.html
done
```

**Mark complete**: `/core:workflows:manage complete page-regeneration`

## Phase 8 — Final audit + ship

**Prerequisite**: Phase 7 done.

Comprehensive audit against new state:

```bash
/audit --strict
```

This time, treat any `fail` or `warn` finding as a ship-blocker.
The refresh is high-stakes; ship clean or don't ship.

Compare against the pre-refresh audit snapshot:

```bash
diff design/.snapshots/pre-refresh-audit.json \
     <(/audit --json)
```

Surface anything new that wasn't there before. New drift introduced
by the refresh is the most likely culprit.

If audit clean, package the refresh:

```bash
# Diff report (the stakeholder review packet):
ls design/.diffs/

# Migration log:
echo "Brand refresh complete: $(date)" >> design/.refresh-log.md
```

Ship via your project's PR / merge process. Recommend:
- One mega-PR containing everything (atomic visual change)
- Feature flag for the new look-and-feel (if your stack supports it)
- Phased rollout starting with internal users

**Mark complete**: `/core:workflows:manage complete ship`

## Workflow complete

The brand refresh is shipped. Update the brand-refresh log
`design/.refresh-log.md` with the date, scope, and any post-ship
follow-ups.

## Resume points

- **Paused after any phase**: state preserves the artifacts
  generated; resume continues from the next phase. The snapshot at
  Phase 1 means rollback is always possible via git revert.

## Troubleshooting

- **Phase 4 produces contrast violations**: the new palette doesn't
  satisfy AA. Either iterate `colors-select` toward higher-contrast
  candidates or change the affected `--color-content-*` mappings.
- **Phase 5 rebuild produces too-many phantom utility warnings**: the
  rebuild detected lots of inline arbitrary values in component
  code. These were pre-existing; the rebuild made them visible.
  Address as separate cleanup, not refresh-blocker.
- **Phase 6 templates regenerate with content lost**: template
  generation is structural; content (specific copy, real customer
  testimonials, hero imagery) lives in pages, not templates. The
  loss is from regenerating without `--in`. Use `--in` on the
  prior `.pen` to preserve content.
- **Phase 7 page diffs are huge for pages that should be unchanged**:
  most often the `--refresh-tokens-only` flag isn't implemented,
  and the regeneration also changed structure. Roll back, use
  `/product:design:design-page <page> --in <page>.pen --refine "apply new
  tokens"` instead.
- **Stakeholder rejects after Phase 6**: revert the entire refresh
  via git. The Phase 1 snapshot is the rollback baseline. Lessons
  feed into a re-attempt, not a fix-forward.

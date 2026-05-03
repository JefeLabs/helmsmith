---
description: Scaffold the full design system — research, foundations, components, patterns, and templates — into design/ as .pen files. Knows the dependency graph and runs commands in correct order. Supports research-driven mode that consults patterns:select and templates:select before generating.
argument-hint: [brand-name] [--primary <hex>] [--secondary <hex>] [--no-dark] [--phases foundations,components,patterns,templates] [--with-research <industry>] [--strategy match-conventions|differentiate|hybrid] [--informed-by <research-json>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Scaffold the entire Pencil design system in dependency order. This
is the orchestrator that knows about all 65 commands and the four-
tier architecture (foundations → components → patterns → templates).

For greenfield projects, scaffold runs the full pipeline. For
existing projects, see `/product:design:bootstrap-from-existing` instead.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Read `design/.product-dependencies.json` (the structural manifest
   declaring what each artifact requires + produces). If absent,
   load the default at `product/design/.product-dependencies.json` (committed
   with the suite).
3. Resolve brand:
   - If `product/.pencil-brand.json` exists, use it.
   - Otherwise prompt for brand inputs (name + primary + secondary +
     industry + audience + tone). `$ARGUMENTS` flags fill in
     non-interactively.
4. Resolve `--phases`:
   - Default: `foundations,components,patterns,templates` (full
     pipeline)
   - `--phases foundations,components` skips patterns + templates
   - `--phases patterns,templates` assumes lower tiers exist
5. Resolve research mode:
   - `--with-research <industry>` runs `/product:strategy:research` first
   - `--informed-by <research-json>` uses an existing JSON
   - Neither: **universal mode** — selects all baseline patterns +
     templates regardless of category
6. Verify Pencil access (MCP server connected, or CLI on PATH).

## Build order — dependency-driven

```
foundations (no deps) → components (need foundations) →
  patterns (need foundations + components) →
  templates (need all of the above)
```

Within each tier, intra-tier dependencies are followed:
`components/buttons` requires `components/surfaces`;
`patterns/pricing` requires `patterns/pricing-tier` + `patterns/faq`.

## Phase 0 — Research (only when --with-research or --informed-by)

When research mode is active:

1. **If `--with-research <industry>`**: invoke `/product:strategy:research
   <industry>` to capture competitor / industry / trend data.
   Generates `design/research/<industry-slug>.json` plus narrative
   and visual artifacts.

2. **If `--informed-by <research-json>`**: skip research execution;
   use the provided JSON.

3. Run `/product:design:patterns:select --informed-by <research-json>
   --strategy <strategy>` → produces
   `product/.pencil-recommended-patterns.md`.

4. Run `/product:design:templates:select --informed-by <research-json>
   --strategy <strategy>` → produces
   `product/.pencil-recommended-templates.md`.

5. Read both manifests to determine which patterns + templates the
   rest of scaffold actually generates. Skipped entries are
   skipped; required + recommended are queued.

In **universal mode** (no research), scaffold queues all patterns
and templates from the catalog. Same end-result quantity, no
research justification.

## Phase 1 — Foundations

Generate in dependency order:

```
1. /product:design:foundations:colors-select   [--informed-by]
2. /product:design:foundations:fonts-select    [--informed-by]
3. /product:design:foundations:icons-select
4. /product:design:foundations:imagery-select  [--informed-by]
5. /product:design:foundations:colors          (renders the .pen)
6. /product:design:foundations:typography      (renders)
7. /product:design:foundations:icons           (renders)
8. /product:design:foundations:imagery         (renders)
9. /product:design:foundations:logos           (renders)
10. /product:design:foundations:spaces         (renders)
11. /product:design:foundations:grids          (renders)
12. /product:design:foundations:motion         (writes tokens + renders)
13. /product:design:foundations:z-index        (writes tokens + renders)
14. /product:design:foundations:a11y           (writes tokens + renders)
15. /product:design:foundations:density        (writes tokens + renders)
16. /product:design:foundations:i18n           (writes tokens + font-loading + renders)
```

Steps 1–4 are **selection** commands that write to brand JSON +
`@theme`. Steps 5–16 render visualizations of committed state.
Selection requires review pauses; rendering doesn't.

When research is active, selection commands receive
`--informed-by <research-json>` to surface category-conventional
candidates alongside brief-driven candidates.

## Phase 2 — Components

Generate in dependency order:

```
1. /frameworks:heroui:components:surfaces       (Card, Container)
2. /frameworks:heroui:components:buttons        (depends on surfaces, motion, a11y)
3. /frameworks:heroui:components:forms          (depends on buttons, a11y)
4. /frameworks:heroui:components:selection      (depends on forms)
5. /frameworks:heroui:components:feedback       (depends on motion, a11y)
6. /frameworks:heroui:components:overlays       (depends on motion, z-index, a11y)
7. /frameworks:heroui:components:navigation     (depends on buttons, surfaces)
8. /frameworks:heroui:components:data-display   (depends on surfaces, density)
9. /frameworks:heroui:components:date-time      (depends on selection, i18n)
10. /frameworks:heroui:components:color-system  (visual reference)
11. /frameworks:heroui:components:charts        (depends on surfaces, colors)
12. /frameworks:heroui:components:media         (depends on surfaces, motion)
```

This phase produces both `.pen` files AND React components (via
`/frameworks:heroui:build-components --foundation-only`). The React must exist
before patterns and templates can compose it.

## Phase 3 — Patterns

Generate from the recommended-patterns manifest (or all patterns in
universal mode):

```
1. /product:design:patterns:states           (cross-cutting; consumed by all)
2. /product:design:patterns:hero
3. /product:design:patterns:footer
4. /product:design:patterns:cta
5. /product:design:patterns:feature-grid
6. /product:design:patterns:pricing-tier
7. /product:design:patterns:faq
8. /product:design:patterns:testimonial
9. /product:design:patterns:banner
10. /product:design:patterns:stat-section
```

After all patterns generate, run `/frameworks:heroui:build-components
--include-patterns` to produce React for them. Default ON during
scaffold (so templates have buildable patterns); skip with
`--no-build-patterns` for visual-only mode.

## Phase 4 — Templates

Generate from the recommended-templates manifest:

```
1. /product:design:templates:landing-page
2. /product:design:templates:error-page
3. /product:design:templates:auth         (with --with-passkeys, --with-guardian-consent per brand)
4. /product:design:templates:dashboard    (when product type ≠ marketing-only)
5. /product:design:templates:settings
6. /product:design:templates:list
7. /product:design:templates:detail
8. /product:design:templates:profile      (with --with-guardian-access for K-12)
9. /product:design:templates:onboarding
10. /product:design:templates:pricing
11. /product:design:templates:marketing
12. /product:design:templates:documentation (when product has docs)
13. /product:design:templates:confirmation
14. /product:design:templates:legal       (terms, privacy, cookie + K-12 disclosures)
```

Templates aren't built to React by default — they're per-page
artifacts. For React on a specific template, run
`/product:design:design-page <template-name>` then
`/frameworks:heroui:build-components <page-slug>` after scaffold completes.

## Execution

Prefer **Path C (tasks file)** for full scaffold runs — significantly
more efficient. Each task gets its own editor instance, sharing
brand JSON state across tasks.

1. Build `product/.pencil-tasks.json` by interpolating each command's
   embedded prompt with brand JSON + research data. Tasks are
   ordered per the dependency graph.

   ```jsonc
   [
     {
       "phase": "foundations",
       "command": "colors-select",
       "out": null,
       "model": "claude-sonnet-4-7",
       "prompt": "<colors-select prompt with --informed-by injected>"
     },
     {
       "phase": "foundations",
       "command": "colors",
       "out": "design/foundations/colors.pen",
       "prompt": "<colors render prompt>",
       "dependsOn": ["colors-select"]
     }
   ]
   ```

2. Run:

   ```bash
   pencil --tasks product/.pencil-tasks.json
   ```

3. After completion, screenshot every `.pen` for review at
   `design/.previews/`.

4. Walk component + pattern React output and run lint / type-check.

## Reporting

The block below is **one illustrative shape** of a scaffold
completion report — for a project that ran research, all 4 phases,
and saw substantive output. Adapt the report to what actually
happened: a scaffold that skipped research has nothing to say
about Phase 0; a partial scaffold reports only the phases it
actually ran; a re-run on an existing project should emphasize
what *changed* over what was produced from scratch.

```
✅ Scaffold complete

Phase 0 — Research:                   ✓ design/research/b2b-ed-tech.json
Phase 1 — Foundations (16 tasks):     ✓ all
Phase 2 — Components (12 tasks):      ✓ all  →  src/components/* (React)
Phase 3 — Patterns (10 tasks):        ✓ 8 generated, 2 skipped per recommendation
Phase 4 — Templates (14 tasks):       ✓ 11 generated, 3 skipped (industry-divergent)

Brand state committed:
  product/.pencil-brand.json
  app/globals.css (@theme)

Recommendations applied:
  product/.pencil-recommended-patterns.md
  product/.pencil-recommended-templates.md

Build artifacts:
  product/.pencil-component-manifest.json (12 components, 10 patterns)
  src/components/* (React, 47 files)
  src/patterns/* (React, 10 files)

📝 Next steps:
  /product:design:design-page <page-name>     # for each production page
  /audit                       # validate the system
```

## Idempotency

- **Default (refine in place)**: existing `.pen` files passed via
  `--in <existing>` + `--out <same>`, letting Pencil refine rather
  than overwrite. Brand JSON + `@theme` preserved unless explicitly
  changed.
- **`--force-recreate`**: regenerates everything from scratch.
  Destructive on brand JSON if user-edited.
- **`--phases <list>`**: runs only specified phases. Useful after
  manual edits to lower tiers ("re-render dependent components").

## Failure handling

If any task fails:

1. Failure logged with task name + error
2. Subsequent tasks depending on the failed one are **skipped**
   (marked blocked)
3. Independent subsequent tasks continue
4. Final report surfaces failed + blocked counts

To retry failed + blocked:

```bash
pencil --tasks product/.pencil-tasks.json --retry-blocked
```

## Two non-scaffold modes

For non-greenfield situations:

- **Migrating an existing product into Pencil**: use
  `/product:design:bootstrap-from-existing <product-url>` — runs
  `tokens-from` on the existing site, seeds brand JSON, creates
  Pencil-managed state matching the existing design.
- **Refreshing recommendations after research changes**: use
  `/product:strategy:re-recommend` to re-run patterns:select +
  templates:select without rebuilding everything else.

---
type: workflow
description: Setup a new design system from scratch. Brand definition through production-ready foundation, components, patterns, templates, and the first production page.
estimatedDuration: 4-8 hours interactive
phases: 10
prerequisites:
  - Pencil CLI or MCP server installed
  - LLM provider credentials configured
  - Empty or new project repo (no design/ folder, or empty design/)
---

# Workflow — Greenfield

> **When to use**: starting a new product from zero. No existing
> brand, no existing pages, nothing in `design/`.
>
> **When NOT to use**: any existing product UI worth preserving —
> use `migrate-to-pencil` instead.

## Outputs of a complete run

- `product/.pencil-brand.json` (brand state)
- `design/foundations/*.pen` (16 foundation files)
- `app/globals.css` `@theme` block (tokens written)
- `design/heroui/components/*.pen` (12 component group files)
- `src/components/*` (React components)
- `design/research/<industry>.{md,pen,json}` (if research run)
- `product/.pencil-recommended-patterns.md`
- `product/.pencil-recommended-templates.md`
- `design/patterns/*.pen` (8–10 pattern files based on selection)
- `design/templates/*.pen` (5–14 template files based on selection)
- `design/briefs/<first-page>.md`
- `design/pages/<first-page>.pen`
- `src/pages/<first-page>.tsx`

## Phase 1 — Brand foundation

**Prerequisite**: empty `design/` folder, or `design/` doesn't exist.

**Action**: define core brand inputs.

```bash
# Interactive (recommended for first run):
/product:strategy:scaffold

# Non-interactive (when inputs are known):
/product:strategy:scaffold "Acme" --primary "#0A84FF" --secondary "#7C3AED" --no-dark
```

The `scaffold` command's Phase 1 prompts for: brand name,
industry, audience, audience-regulation, primary + secondary
colors, fonts, dark-mode support, multilingual scripts.

After this phase, `product/.pencil-brand.json` exists with the
core brand fields populated.

**Mark complete**: `/workflows:manage complete brand-foundation`

**Optional — early stakeholder review.** If brand inputs warrant
buy-in before committing to component generation, export the brand
JSON's foundation directions to `.fig` for stakeholder review:

```bash
# Render a quick foundations.pen preview, then export:
/product:design:foundations:colors
/product:design:export design/foundations/colors.pen --to figma --include-tokens
```

Stakeholders review the `.fig` in Figma, return feedback. Bring
changes back via `/product:design:export --from-fig --diff-merge` before
proceeding to Phase 2. This adds 1-2 days but reduces the
likelihood of having to rework foundations after Phase 5.

## Phase 2 — Research (recommended)

**Decision**: do you want competitive / industry research before
foundations?

- **Yes** (default for B2B / consumer products): research surfaces
  category conventions and differentiation opportunities. Adds
  ~1 hour.
- **No** (when industry is novel or budget is tight): foundations
  driven by brief alone. Brand decisions are less data-driven.

```bash
# Yes:
/product:strategy:research "B2B ed-tech" --depth standard --competitors <urls>

# No: skip
/workflows:manage complete research --skip
```

After research completes:
- `design/research/<industry>.json` exists
- `design/research/<industry>.md` (narrative summary)
- `design/research/<industry>.pen` (visual comparison grid)

**Mark complete**: `/workflows:manage complete research`

## Phase 3 — Foundation selection

**Prerequisite**: Phase 1 complete. Phase 2 outputs available if run.

Run the four selection commands. Each writes to brand JSON +
`@theme` atomically. Use `--informed-by` if research was run.

```bash
# Run in this order — each pauses for review:
/product:design:foundations:colors-select  --informed-by design/research/<industry>.json
/product:design:foundations:fonts-select   --informed-by design/research/<industry>.json
/product:design:foundations:icons-select
/product:design:foundations:imagery-select --informed-by design/research/<industry>.json
```

For each select command, review candidates and confirm the choice.
The chosen tokens persist atomically.

**Tip**: pass `--dry-run` first to preview the diff if you're
careful about the brand JSON state.

**Mark complete**: `/workflows:manage complete foundation-selection`

## Phase 4 — Foundation rendering

**Prerequisite**: Phase 3 complete (brand JSON + `@theme` populated).

Render the foundation `.pen` files for visual reference. Some
foundations also write additional tokens (motion, z-index, a11y,
density, i18n).

```bash
# Pure render (read brand JSON, produce .pen):
/product:design:foundations:colors
/product:design:foundations:typography
/product:design:foundations:icons
/product:design:foundations:imagery
/product:design:foundations:logos
/product:design:foundations:spaces
/product:design:foundations:grids

# Token-writing + render:
/product:design:foundations:motion
/product:design:foundations:z-index
/product:design:foundations:a11y
/product:design:foundations:density
/product:design:foundations:i18n  # follow the font-loading strategy in the output
```

These are mostly parallelizable — run them in batches if the
Pencil CLI's task file mode is set up.

**Mark complete**: `/workflows:manage complete foundation-rendering`

## Phase 5 — Component generation

**Prerequisite**: Phase 4 complete.

Generate component `.pen` files in dependency order. Each command
produces visual specs; React generation happens at the end of this
phase.

```bash
# In dependency order (per .product-dependencies.json):
/frameworks:heroui:components:surfaces
/frameworks:heroui:components:buttons
/frameworks:heroui:components:forms
/frameworks:heroui:components:selection
/frameworks:heroui:components:feedback
/frameworks:heroui:components:overlays
/frameworks:heroui:components:navigation
/frameworks:heroui:components:data-display
/frameworks:heroui:components:date-time
/frameworks:heroui:components:color-system
/frameworks:heroui:components:charts
/frameworks:heroui:components:media

# Then build React for the foundation:
/frameworks:heroui:build-components --foundation-only
```

After this, `src/components/*` contains the React components and
`product/.pencil-build-manifest.json` exists with foundation
component entries.

**Parallelization note**: the commands above are listed
sequentially for clarity, but the dependency graph allows
substantial parallelism. `surfaces` has no dependencies on other
components, so it must run first; once it's done, `buttons`,
`feedback`, `data-display`, and `media` can run in parallel
(none depend on each other); `forms` depends on `buttons` so it
runs after; `selection` depends on `forms`; and so on per
`.product-dependencies.json`. The agent should batch parallel-safe
commands rather than executing them one at a time. Phase 4
(foundation rendering) is even more parallel-friendly — most
foundations have no inter-foundation dependencies and can all run
concurrently.

**Mark complete**: `/workflows:manage complete component-generation`

## Phase 6 — Pattern + template selection

**Prerequisite**: Phase 5 complete. Phase 2 research available
(strongly recommended for selection).

```bash
/product:design:patterns:select   --informed-by design/research/<industry>.json --strategy hybrid
/product:design:templates:select  --informed-by design/research/<industry>.json --product-type saas
```

These produce `product/.pencil-recommended-patterns.md` and
`product/.pencil-recommended-templates.md` — manifests with
required / recommended / skipped entries. Review these before
proceeding.

**If no research was run**: select commands recommend the universal
catalog (everything). Customize via `--force` / `--exclude` flags.

**Mark complete**: `/workflows:manage complete pattern-template-selection`

## Phase 7 — Pattern generation

**Prerequisite**: Phase 6 complete.

Generate the patterns marked as required / recommended:

```bash
# states is universal — always required:
/product:design:patterns:states

# The rest depend on selection. Common required:
/product:design:patterns:hero
/product:design:patterns:footer
/product:design:patterns:cta
/product:design:patterns:feature-grid
/product:design:patterns:pricing-tier
/product:design:patterns:faq
/product:design:patterns:testimonial
/product:design:patterns:banner
/product:design:patterns:stat-section
```

Optionally build React for patterns:

```bash
/frameworks:heroui:build-components --include-patterns
```

**Mark complete**: `/workflows:manage complete pattern-generation`

## Phase 8 — Template generation

**Prerequisite**: Phase 7 complete.

Generate templates marked as required / recommended in Phase 6.
Common ones for SaaS products:

```bash
/product:design:templates:landing-page
/product:design:templates:error-page
/product:design:templates:auth                  # add --with-passkeys, --with-guardian-consent per brand
/product:design:templates:dashboard
/product:design:templates:settings
/product:design:templates:pricing
/product:design:templates:legal                 # add k-12 variants if applicable
```

Templates aren't built into React by default — they're per-page
artifacts consumed when actual production pages are designed.

**Mark complete**: `/workflows:manage complete template-generation`

## Phase 9 — Audit

**Prerequisite**: Phases 1–8 complete.

Run the full audit to catch any drift from the generation pipeline:

```bash
/audit
```

Address all `fail`-severity findings before proceeding. Specifically
watch for:
- Plane 3 contrast violations (palette has insufficient contrast)
- Plane 7c brand-fit failures (k-12 / regulated audience missing
  required variants)
- Plane 1 design-layer lint (when open-pencil is installed) —
  catches issues in the `.pen` files themselves: contrast in
  component variant frames, naming inconsistencies, layout
  primitives that violate accessibility patterns

Warnings are fine to defer — log them as follow-up tasks.

**Mark complete**: `/workflows:manage complete audit`

## Phase 10 — First production page

**Prerequisite**: Phases 1–9 complete. Audit passed (no fails).

Now design and ship the first real production page. The full per-
page pipeline:

```bash
# 1. Capture the page's intent:
/product:strategy:brief

# 2. Derive user stories:
/product:strategy:user-stories <brief-slug>

# 3. Low-fi structural exploration:
/product:design:explore "<story>"

# 4. (Optional, only for greenfield brand-direction refinement)
#    High-fi direction-set exploration:
/product:design:design-page --based-on design/explorations/<story>.pen \
                    --page-set saas --directions 3
# Review, pick a direction, then:
/product:design:design-page --finalize <direction>

# 5. Per-page production design:
/product:design:design-page <page-name> --based-on design/explorations/<story>.pen

# 6. Build React:
/frameworks:heroui:build-components <page-slug>
```

After this, the first real product page is shipped.

**Optional — designer handoff.** If your team has designers who
prefer to review pages in Figma rather than Pencil, hand off the
finalized page via `.fig` for review. If feedback comes back as an
edited `.fig`, use `/product:design:export --from-fig --diff-merge` to
bring changes back surgically. See `figma-roundtrip` workflow for
the full review-and-iterate loop.

**Mark complete**: `/workflows:manage complete first-production-page`

## Workflow complete

State is moved to `history` with `status: "complete"`. The project
is now fully Pencil-managed and ready for ongoing brownfield work
(adding more features, improving pages, etc.).

## Resume points

Common pause points and how to resume:

- **Paused after Phase 1**: brand is defined; resume runs Phase 2 prompt.
- **Paused after Phase 4**: foundations rendered; pick up at component
  generation.
- **Paused mid-Phase 5**: workflow tracks which components are done;
  resume continues from the next undone component.
- **Paused after Phase 6**: recommendation manifests are written but
  patterns / templates not generated. Resume continues at the first
  recommended pattern.
- **Paused after Phase 9 (audit)**: all foundation work done; resume
  prompts for the first production page brief.

## Troubleshooting

- **Audit fails after Phase 5**: most often a contrast issue from
  `colors-select` choices. Re-run `/product:design:foundations:colors-select`
  with adjusted palette and re-render.
- **Pattern selection has zero recommended patterns**: research
  produced empty `patternFrequency`. Fix by re-running
  `/product:strategy:research --update` with more competitor URLs, or fall back
  to universal-catalog mode (run all patterns regardless).
- **Template select recommends very few templates**: product-type
  inference picked the wrong type. Override with explicit
  `--product-type saas` (or app, marketing, content, commerce,
  hybrid).
- **Foundation rendering fails on i18n**: most likely the font
  loading strategy isn't fully configured. Read
  `design/foundations/i18n.pen` for the chosen strategy and confirm
  `app/globals.css` has matching `@font-face` declarations.

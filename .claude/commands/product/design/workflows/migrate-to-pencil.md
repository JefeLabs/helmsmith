---
type: workflow
outcome: Bring existing UI into Pencil
description: Bring an existing product into Pencil. Capture current design state without breaking production; lock the foundations to existing values; map current pages to template archetypes for future evolution.
estimatedDuration: 1-2 days for migration; ongoing for evolution
phases: 5
prerequisites:
  - Existing production product with public-facing UI
  - Pencil CLI or MCP server installed
  - Optional&#58; Playwright for headless capture (or pre-captured screenshots)
---

# Workflow — Migrate to Pencil

> **When to use**: existing product going into Pencil for the first
> time. Production UI exists; you want Pencil-managed state to
> reflect that without overwriting it. After migration, future
> work uses the brownfield workflows.
>
> **When NOT to use**:
> - Truly greenfield (no existing UI) → use `greenfield`
> - Rebrand of existing product → use `migrate-to-pencil` first to
>   capture current state, then `brand-refresh` to evolve

## Outputs of a complete run

- `product/.pencil-brand.json` (extracted from existing product)
- `app/globals.css` `@theme` (extracted tokens, may merge with
  existing theme)
- `design/foundations/*.pen` (locked to existing state)
- `product/.pencil-archetype-map.json` (existing pages → template
  archetypes)
- `product/.pencil-bootstrap-report.md` (migration summary)

## Phase 1 — Discovery

**Prerequisite**: existing production product accessible.

Identify what to capture:

- **Public marketing surface**: home + pricing + about + contact +
  blog index (typical: 3-5 pages)
- **Authenticated product** (if applicable): need
  `--auth-cookies <path>` for capture
- **Documentation site** (if separate): typically captured separately

Decide depth:

- `quick` (~3 pages): captures essential brand state. Good for fast
  migration when pages are similar to each other.
- `standard` (~5 pages, default): adds dashboard or content samples.
- `deep` (~8 pages): adds documentation, careers, blog post. Best
  for products with significant variation across page types.

**Action**: list the URLs to capture; obtain `--auth-cookies` if
needed (Playwright `storageState` JSON).

**Higher-fidelity alternative — when Figma source files exist.**
If the project has existing Figma design files (a foundations file,
components file, templates file, or page sources), capture from
those instead of from production URLs. open-pencil extracts
structured tokens directly from the `.fig`, much higher fidelity
than DOM walking:

```bash
# Per Figma file:
/product:strategy:tokens-from path/to/foundations.fig --apply-to brand-json
/product:strategy:tokens-from path/to/components.fig  --accumulate-into-research <industry>
```

If the team has *both* Figma sources AND production code, capture
from both — Figma gives the design tokens, production tells you
what's actually shipped. The bootstrap phase reconciles
discrepancies.

If the team has Figma sources but **no production code**, this is
a different workflow — see `migrate-from-figma` instead. That
workflow is for design-system-first teams; this one is for
shipped-product-first teams.

**Mark complete**: `/core:workflows:manage complete discovery`

## Phase 2 — Bootstrap

**Prerequisite**: Phase 1 done. URLs and cookies ready.

Run the bootstrap command:

```bash
/product:design:bootstrap-from-existing https://your-product.com \
  --brand-name "YourBrand" \
  --depth standard \
  --auth-cookies ./auth-state.json \
  --lock-existing
```

The `--lock-existing` flag is **critical for production migrations**.
It marks all extracted state as `@pencil-locked` so subsequent
Pencil commands won't overwrite without explicit override. Without
it, a future `colors-select` could regenerate the brand and break
production.

The bootstrap captures and writes:
- Per-page screenshots (for visual reference)
- Extracted tokens via `tokens-from` (palette, typography, spacing,
  radius)
- Inferred audience-regulation (heuristic, surfaced for confirmation)
- Detected framework (HeroUI / shadcn / MUI / etc.)

Review the extracted brand JSON before proceeding. Confirm:
- Primary / secondary colors look right
- Font families correctly identified
- Audience-regulation matches what you know
- Framework detection is accurate

**Mark complete**: `/core:workflows:manage complete bootstrap`

## Phase 3 — Foundation locking

**Prerequisite**: Phase 2 done; bootstrap report reviewed.

The bootstrap produced foundation `.pen` files reflecting current
state. Verify them:

```bash
# Inspect the bootstrap report:
cat product/.pencil-bootstrap-report.md

# Visually review each foundation:
# (Open design/foundations/*.pen in Pencil)
```

If any foundation looks wrong (e.g. extracted palette missed a
critical color, or font detection picked wrong family), fix it
manually before proceeding. The lock prevents accidental override
later.

For tokens that exist in code but weren't auto-extracted, manually
add them to brand JSON + `@theme` and re-render the foundation:

```bash
# After manual brand JSON edit:
/product:design:foundations:colors  # re-render with the corrected state
```

**Mark complete**: `/core:workflows:manage complete foundation-locking`

## Phase 4 — Archetype mapping

**Prerequisite**: Phase 3 done.

The bootstrap should have produced
`product/.pencil-archetype-map.json` mapping captured URLs to
template archetypes (marketing-landing, pricing, signin, dashboard,
etc.).

Review the mapping. For each captured URL:
- Confirm the archetype is correct (sometimes auto-detection picks
  the wrong one — e.g. tags a custom dashboard as "list")
- Note any custom page types not in the canonical archetype set
  (these become custom templates if you generate them)

For each archetype that has a corresponding Pencil template
(landing-page, pricing, auth, dashboard, etc.), the existing page's
state is now mapped. Future evolution of those pages goes through
the brownfield workflows.

For custom archetypes not in the canonical set:
- Decide whether to fit them to an existing template (close enough)
- Or generate a custom template via `/product:design:design-page <type>`
  later

**Mark complete**: `/core:workflows:manage complete archetype-mapping`

## Phase 5 — Audit + verify

**Prerequisite**: Phase 4 done.

Run audit against the migrated state to catch any drift between
the captured `.pen` files and the existing code:

```bash
/audit
```

Migration-specific watch-fors:

- **Plane 1 (code drift)**: lots of inline arbitrary values likely.
  These are pre-existing — log as cleanup work but don't fix
  immediately (would risk regression).
- **Plane 1 design-layer (when open-pencil installed)**: the
  bootstrap-extracted `.pen` files may have low-confidence color
  contrast or naming inconsistencies inherited from the source.
  These are pre-existing too — log for the next foundations review,
  don't block migration on them.
- **Plane 3 (token drift)**: code references tokens that aren't
  in the foundation. These are **expected** — the foundation
  reflects what was extractable from public CSS; some code uses
  tokens that didn't surface. Add them to brand JSON / `@theme`.
- **Plane 7c (brand-fit)**: if you confirmed audience-regulation
  is k-12 / healthcare / etc., audit will surface required template
  variants that don't yet exist. These are future work, not
  migration blockers.

Address `fail`-severity findings if they affect actual production
behavior. Defer warnings.

**Mark complete**: `/core:workflows:manage complete verify`

## Workflow complete

The existing product is now in Pencil's state. You can:

- **Add new features**: use `brownfield-add-feature`
- **Improve existing pages**: use `brownfield-improve-page` (the
  pages from the archetype map)
- **Refresh the brand**: use `brand-refresh` (foundations are locked,
  but `brand-refresh` includes the unlock + re-evolution flow)

## Resume points

- **Paused after Phase 1 (discovery)**: URLs identified; resume runs
  bootstrap.
- **Paused after Phase 2 (bootstrap)**: extraction complete; resume
  runs foundation locking review.
- **Paused after Phase 3 (locking)**: foundations confirmed; resume
  goes to archetype mapping review.

## Troubleshooting

- **Bootstrap fails with "anti-bot detected"**: many production
  sites detect headless browsers. Capture screenshots manually
  (browser → save) and pass `--screenshots <dir>` to bootstrap.
- **Token extraction picked obviously wrong values**: tokens-from is
  heuristic (k-means + OCR for screenshots, computed-style for URLs).
  Manually correct the brand JSON values; the extraction is a
  starting point, not gospel.
- **Authenticated capture fails**: `--auth-cookies` requires a
  Playwright `storageState` JSON. Generate via:
  ```javascript
  // setup.spec.ts (run once with credentials)
  await context.storageState({ path: 'auth-state.json' });
  ```
- **Existing code uses different framework than detected**: bootstrap
  detection is best-effort. If it picks "shadcn" but you're really
  on "HeroUI", manually update brand JSON's `framework` field
  before proceeding.
- **No `@theme` in existing project**: most pre-Tailwind-v4 projects
  don't have `@theme`. Bootstrap creates it from extracted tokens.
  This is fine — the new theme block won't conflict with existing
  CSS as long as the cascade is correct.

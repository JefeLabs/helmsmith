---
description: Migrate an existing product into Pencil-managed state. Captures the current design (tokens, fonts, imagery, page archetypes) and seeds Pencil's manifests so the existing system becomes the foundation rather than getting overwritten. Used when a project predates Pencil — existing services in production are the canonical case.
argument-hint: <product-url> [--brand-name <name>] [--auth-cookies <path>] [--depth quick|standard|deep] [--lock-existing]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Migrate an existing product into Pencil-managed state. The
`/product:strategy:scaffold` command assumes greenfield — it generates from
research and brief. This command does the opposite: it ingests an
existing product, extracts its design state, and seeds the
Pencil manifests so future Pencil work treats the existing design
as the starting point instead of overwriting it.

For teams with multiple existing services, this is how each service
gets into the Pencil pipeline without losing what's already shipped.

## When to use this vs `/product:strategy:scaffold`

| Situation | Use |
| --------- | --- |
| Brand new project, no existing UI | `scaffold` |
| Existing product, want to add Pencil | `bootstrap-from-existing` |
| Mid-project, partial design exists | `bootstrap-from-existing --partial` |
| Rebrand of existing product | `scaffold --force-recreate` (intentional reset) |

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve inputs:
   - **Product URL** (required): the production site to ingest.
     For products with an authenticated surface (most apps), this
     should be the marketing/auth URL — authenticated pages need
     the `--auth-cookies` flag.
   - **`--brand-name <name>`**: pre-fills brand JSON. Default
     inferred from page title.
   - **`--auth-cookies <path>`**: path to a cookie jar file (Playwright
     storage state JSON) for authenticated capture. Without this,
     auth-walled pages can't be captured.
   - **`--depth`**: same as `/product:strategy:research` — how many pages to
     ingest. Default `standard` (~5 pages).
   - **`--lock-existing`**: marks all extracted state as
     `@pencil-locked` so subsequent Pencil commands won't overwrite
     it without explicit override. Recommended for production
     migrations to prevent surprise regressions.
3. Verify Playwright + tokens-from + research available.

## Phase 1 — Capture existing design

For each captured page (per `--depth`):

1. **Run `/product:strategy:tokens-from <page-url>`** to extract:
   - Color palette (computed from rendered CSS variables + RGB
     samples)
   - Typography (font families, sizes, weights, line-heights from
     computed style)
   - Spacing rhythm (common padding/margin values, gap values)
   - Border radius patterns
   - Shadow / elevation patterns

2. **Capture page screenshots** at canonical 3 breakpoints
   (mobile 390, tablet 768, desktop 1440) for visual reference.

3. **Detect frameworks** from the page source:
   - HeroUI v3? (looks for `[data-heroui-*]` attributes,
     specific class patterns)
   - Tailwind v4? (looks for `@theme` reference in inline CSS)
   - shadcn/ui? Material UI? Chakra? Radix? Other?
   - Pencil-recommended path is HeroUI v3 + Tailwind v4. If the
     existing site uses something else, that's a fundamental
     migration decision — surface as a warning.

## Phase 2 — Aggregate to brand state

Aggregate the per-page extractions into single brand state:

1. **Color palette consolidation**:
   - Pages may sample slightly different shades. Cluster nearby
     hues into single tokens. Example: if pages show
     `#0A84FF`, `#0B83FF`, `#0A85FE` for what's clearly the
     accent, normalize to one value.
   - Identify ramps: are there 50/100/...700/900 variants visible,
     or just one shade per color?
   - Detect dark-mode if present.

2. **Typography consolidation**:
   - Identify fontDisplay / fontBody / fontMono.
   - Detect if multiple sizes per family or just one (some
     products use a single Inter family for everything).

3. **Imagery direction inference**:
   - Sample images across pages.
   - Classify: photography / illustration / abstract / mixed.
   - Inspect content (people / abstract / mixed).

4. **Audience-regulation detection** (heuristic, surface for confirm):
   - K-12 indicators: presence of "FERPA", "COPPA", "parental",
     "guardian", "student", "teacher" in page copy.
   - Healthcare indicators: "HIPAA", "PHI", "patient" without
     trivial usage.
   - Financial indicators: "FDIC", "SOC 2", "PCI", "KYC".
   - Government indicators: ".gov" domain, "Section 508",
     "accessibility statement" prominence.
   - Surface findings as confirmation prompt; user accepts/rejects.

## Phase 3 — Write brand JSON + @theme

Atomically write the inferred state:

1. **`product/.pencil-brand.json`** — pre-populated from extraction:

   ```json
   {
     "name": "<brand-name>",
     "industry": "<inferred or prompted>",
     "tagline": "<extracted from meta description>",
     "audience": "<prompted>",
     "audienceRegulation": "<inferred + confirmed>",
     "primary": "<extracted>",
     "secondary": "<extracted>",
     "fontDisplay": "<extracted>",
     "fontBody": "<extracted>",
     "fontMono": "<extracted or 'system-mono'>",
     "imagery": {
       "direction": "<inferred>",
       "representation": "<inferred>"
     },
     "i18n": {
       "scripts": ["<inferred from page languages>"],
       "rtl": "<true if any RTL pages found>"
     },
     "_origin": "bootstrap-from-existing",
     "_originUrl": "<source product URL>",
     "_originDate": "<ISO date>",
     "_locked": <if --lock-existing>
   }
   ```

2. **`@theme` source CSS**: write extracted tokens. If the project
   already has a `@theme` block, prompt before overwriting:
   - "Found existing @theme with N tokens — merge or replace?"
   - **Merge** (default): keep existing tokens, add new ones,
     warn on conflicts.
   - **Replace**: overwrite with extracted state. Destructive.

## Phase 4 — Generate the existing-state .pen files

For each foundation, generate a `.pen` reflecting the extracted
state (NOT a fresh design):

```
1. Generate design/foundations/colors.pen showing the extracted palette
2. Generate design/foundations/typography.pen showing extracted fonts
3. Generate design/foundations/imagery.pen showing imagery direction
4. Generate design/foundations/spaces.pen with the inferred rhythm
5. ...
```

These foundation `.pen` files are the **as-is** record. They
document what the system currently is, not what's aspired to.

If `--lock-existing` is set, mark each `.pen`'s frame metadata
with `@pencil-locked`. Subsequent Pencil commands won't overwrite
without `--force`.

## Phase 5 — Map page archetypes to templates

For each captured page, classify it into a Pencil template archetype:

- Marketing page → `templates/landing-page` or `templates/marketing`
  (per content)
- Pricing page → `templates/pricing`
- Sign-in / sign-up → `templates/auth`
- Dashboard → `templates/dashboard`
- Settings → `templates/settings`
- List view → `templates/list`
- Detail view → `templates/detail`
- Documentation → `templates/documentation`
- Other → custom (flagged for review)

Write the mapping to `product/.pencil-archetype-map.json`:

```json
{
  "https://product.com/": "templates/landing-page",
  "https://product.com/pricing": "templates/pricing",
  "https://product.com/signin": "templates/auth#signin",
  ...
}
```

This map is consulted later by `/product:design:design-page` to know which
template a specific page should refine into.

## Phase 6 — Generate the bootstrap report

Write `product/.pencil-bootstrap-report.md`:

```markdown
# Pencil bootstrap report — <brand-name>

**Source**: <product-url>
**Date**: <ISO>
**Pages captured**: <n>
**Mode**: <lock-existing / migrate-and-evolve>

## Extracted brand state
- Primary: <hex>
- Secondary: <hex>
- Display font: <family>
- Body font: <family>
- Imagery direction: <direction>
- Audience regulation: <inferred + confirmed>

## Captured pages (archetype mapping)
| URL | Archetype |
| --- | --------- |
| ... | ...       |

## Foundation .pen files generated
- design/foundations/colors.pen (lock: <yes/no>)
- design/foundations/typography.pen (lock: <yes/no>)
- ...

## Detected framework
- UI library: <HeroUI v3 / shadcn / MUI / etc.>
- CSS approach: <Tailwind v4 / Tailwind v3 / CSS modules / etc.>

## Recommended next steps
1. Review the foundation .pen files at design/foundations/
2. Review brand JSON at product/.pencil-brand.json
3. Run `/audit` to identify any drift between extracted state
   and current code
4. To evolve the design system from this baseline, unlock the
   foundations selectively and run `/product:design:foundations:colors-select`
   etc. with `--seed-from <existing-token>` to regenerate from a
   starting point.
5. To add patterns or templates that don't exist yet, run
   `/product:design:patterns:select` or `/product:design:templates:select` to identify
   candidates and `/product:design:patterns:<name>` / `/product:design:templates:<name>`
   to generate.
```

## Reporting

```
✅ Bootstrap complete: <brand-name>
   Source:           https://product.com
   Pages captured:   5 (depth: standard)
   Framework:        HeroUI v3 + Tailwind v4 ✓ (matches Pencil stack)
   
   Brand state:
     Primary:        #0A84FF
     Secondary:      #66B2FF
     Display font:   Inter Display
     Body font:      Inter
     Audience:       k-12 (FERPA/COPPA detected; user confirmed)
   
   Foundation .pen files:
     ✓ design/foundations/colors.pen (locked)
     ✓ design/foundations/typography.pen (locked)
     ✓ design/foundations/imagery.pen (locked)
     ✓ design/foundations/spaces.pen (locked)
   
   Archetype mapping:
     ✓ product/.pencil-archetype-map.json (5 pages mapped)

📝 Next steps:
   - Review product/.pencil-bootstrap-report.md
   - Run /audit to validate the extracted state matches code
   - To evolve, unlock specific foundations and run their -select commands
```

## What this command does NOT do

- Does not auto-generate React. The bootstrap is a **state
  capture**; the existing React in the repo continues to work.
  Pencil's React generation only kicks in when subsequent commands
  (`build-components`) are run.
- Does not handle authenticated-only products well — must provide
  `--auth-cookies` for any pages behind login.
- Does not preserve animations / motion tokens beyond what's
  computable from CSS — runtime-driven motion (Framer Motion,
  React Spring) is invisible to static extraction.
- Does not handle multi-brand monorepos — run once per brand.
- Does not detect every framework correctly. The framework
  detection is heuristic; if the result is wrong, the user can
  override with `--framework <name>`.

---
description: Generate the imagery foundations page — a creative direction reference showing vendor sources, asset categories with sample compositions, color treatment, license + rights notes, and search-term references. Renders the direction recorded by `/product:design:foundations:imagery-select`.
argument-hint: [--direction <name>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/imagery.pen` — the visual creative
direction document that content producers reference when sourcing
images for the design system. Reads the imagery direction recorded in
brand JSON by `/product:design:foundations:imagery-select` and renders it as a
single foundation page.

Unlike `colors.pen` or `typography.pen`, this foundation page does not
show real assets — the command intentionally does not download or
embed images (per the imagery-select / fonts-select pattern). It uses
the same gray-rectangle-with-diagonal-line placeholder convention as
`/product:design:explore`, annotated with sourcing instructions so the page
functions as a producer-facing brief.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Load `product/.pencil-brand.json`. The `imagery` section must be
   populated — if absent, instruct the user to run
   `/product:design:foundations:imagery-select` first and stop.
3. Pull the `audience-regulation` value from the brief or brand JSON
   if present — it drives the rights checklist contents in Section 5.
4. If MCP: `get_guidelines({ category: "guide", name: "Imagery" })`.

## Embedded prompt

> Build a Pencil page named **`Foundations / Imagery`** for the
> **{{brand}}** design system. The page is the canonical reference for
> the creative direction — it describes how imagery is sourced,
> treated, and applied across the product, not specific images.
>
> Page layout: a single 1440-wide frame, 64px outer padding, 80px
> between sections. Render once on Light and once on Dark, stacked
> vertically. The Dark variant matters because brand-tinted overlays
> and color treatments read differently on dark surfaces — content
> producers need both references.
>
> All image content uses the **placeholder convention**: gray rectangle
> with a diagonal line corner-to-corner. Never use real photographs,
> AI-generated samples, or licensed imagery — this page is a *direction
> document*, not a portfolio.
>
> ### Section 1 — Direction summary
>
> A header card spanning the full width on `--surface-raised`, showing
> the recorded direction at-a-glance:
>
> - **Direction name** (h2): `{{imagery.direction}}`
> - **Strategy** badge: `{{imagery.strategy}}`
> - **Style** badge: `{{imagery.style}}`
> - **Composition** badge: `{{imagery.composition}}`
> - **Representation** badge: `{{imagery.representation}}`
> - **AI-gen status** badge: "Allowed" or "Not used" per
>   `{{imagery.aiGenAllowed}}`
> - **Color-treatment swatch**: a 240×120 placeholder rectangle with
>   the recorded treatment applied (overlay color, opacity, blend
>   mode), labeled with the treatment name
>
> ### Section 2 — Vendor sources
>
> A horizontal row of vendor cards, one per entry in
> `{{imagery.vendors}}`. Each card (240×200):
>
> - Vendor name (h4)
> - License summary (body-sm), with a colored badge:
>   - **Green**: free, no attribution required (Pixabay, unDraw,
>     Hero Patterns)
>   - **Amber**: free with attribution (Unsplash, Storyset, Humaaans)
>   - **Red**: paid / subscription (Adobe Stock, Getty, Shutterstock)
>   - **Blue**: AI-generated (Adobe Firefly, Midjourney, DALL-E)
> - **Scope**: chip group listing which categories this vendor serves
>   (e.g. "hero, section-break")
> - **Account requirement** note (body-sm): "Free signup",
>   "Adobe CC required", "API key for CMS integration", etc.
>
> If `{{imagery.vendors}}` exceeds 5, wrap to a second row.
>
> ### Section 3 — Asset category gallery
>
> One row per category in `{{imagery.categoryGuidelines}}`, in this
> order (skip categories not defined for this direction):
>
> 1. hero
> 2. section-break
> 3. spot-illustration
> 4. empty-state
> 5. error-state
> 6. avatar-placeholder
> 7. pattern-background
> 8. icon-illustration
> 9. data-viz-imagery
> 10. video-thumbnail
>
> Each row is 240px tall and has two zones:
>
> **Left zone** (840px wide) — sample compositions:
> Three placeholder rectangles at the appropriate aspect ratio for the
> category:
> - hero: 16:9 wide
> - section-break: 4:1 wide horizontal strip
> - spot-illustration: 1:1 square
> - empty-state: 1:1 square
> - error-state: 1:1 square
> - avatar-placeholder: 1:1 small circle
> - pattern-background: 4:1 wide tileable strip
> - data-viz-imagery: 16:9 wide
> - video-thumbnail: 16:9 wide
>
> Each placeholder shows:
> - The diagonal-line gray-rectangle convention
> - The recorded color treatment applied as an overlay
> - For categories with typical text overlay (hero), a sample
>   title "The {{brand}} mission" in display-xl, with text shadow
>   appropriate to the treatment
> - A small vendor caption underneath each sample
>
> **Right zone** (520px wide) — spec card:
> - Category name (h4)
> - **Source**: vendor + search term / collection ID / pack name from
>   `{{imagery.categoryGuidelines[category]}}`
> - **Treatment**: specific color treatment, opacity, blend mode,
>   overlay rules
> - **Composition rules**: framing, focal point position, full-bleed
>   vs contained, safe area for text overlay
> - **Restrictions**: bullet list — "no minors", "no recognizable
>   brands", "model release required", "no editorial-context
>   imagery", etc.
> - **Recommended source dimensions**: e.g. "2400×1200 source served
>   at 1440 / 768 / 390 viewport widths"
>
> ### Section 4 — Color treatment showcase
>
> A 4-column grid demonstrating `{{imagery.colorTreatment}}` applied to
> the same base placeholder so the transformation is visible:
>
> 1. **Original** — placeholder with diagonal line, no treatment
> 2. **Treatment applied** — the recorded treatment (brand-tinted
>    overlay, duotone, monochrome, desaturated, etc.)
> 3. **Hover variant** — slight intensity shift demonstrating
>    interactive states (overlay opacity +10%, or saturation +15%)
> 4. **With text overlay** — full hero composition combining the
>    treatment with a display-xl title and body-md subtitle
>
> Below the grid, a small CSS-technique reference card (in mono font)
> showing the implementation hint:
>
> - For brand-tinted overlay:
>   `background: linear-gradient(rgba(<accent>, 0.3), rgba(<accent>, 0.3)), url(...)`
> - For duotone:
>   `filter: grayscale(1) contrast(1.2)` + colored overlay with
>   `mix-blend-mode: screen`
> - For monochrome: `filter: grayscale(1)`
> - For desaturated: `filter: saturate(0.4)`
>
> The reference is informational — components implement these per
> their needs; this page only shows the intended visual outcome.
>
> ### Section 5 — Rights checklist
>
> A boxed checklist on `--surface-raised`, full-width, listing rights
> requirements for any imagery published under this direction. Render
> as actual checkboxes (unchecked, since this is a per-publication
> exercise):
>
> Standard items:
> - [ ] Vendor allows commercial use for {{brand}}'s context
> - [ ] Attribution applied where required (list specific vendors
>       requiring attribution from `{{imagery.vendors}}`)
> - [ ] No recognizable people requiring model release (or releases
>       on file)
> - [ ] No editorial-only images used in commercial context
> - [ ] If AI-generated: disclosure applied per platform requirement
>
> If `audience-regulation` is set, append the matching items:
>
> - **k-12**: "Photo subject is not an identifiable minor (or
>   illustration is used instead)" + "FERPA / COPPA review for any
>   image showing a real student"
> - **healthcare-hipaa**: "Subject is not an identifiable patient" +
>   "No imagery suggests endorsement by a real provider"
> - **financial-services**: "No real account screens, transaction
>   data, or recognizable institution branding"
> - **government**: "No imagery suggests partisan endorsement"
>
> Below the checklist, render `{{imagery.rightsNotes}}` as bullet
> points in body-sm with a "Direction-specific notes" header.
>
> ### Section 6 — Search reference quick card
>
> A compact reference card on `--surface-raised`, formatted as a
> two-column table for fast lookup during content production:
>
> | Category | Source → starting point |
> | -------- | ----------------------- |
> | hero     | Unsplash → "abstract gradient blue" |
> | spot-illustration | Storyset → Isometric pack, finance |
> | empty-state | Storyset → Isometric pack, "no data" variants |
> | ... | ... |
>
> Pull rows from `{{imagery.categoryGuidelines}}`. Use mono font for
> the search terms so they read as copy-paste-ready.
>
> ### Section 7 — Anti-patterns
>
> A small "Avoid" section at the bottom (full width, on
> `--danger-50` background tint to signal restriction). Three to four
> anti-patterns derived from the strategy:
>
> - **Universal** (always include): "Stock-photo clichés — verify
>   uniqueness via Google reverse image search before using any
>   photographic hero"
> - **For abstract-only directions** (when
>   `representation: abstract-only`): "Photographs of identifiable
>   people in any context — illustration or abstract only"
> - **For illustrated directions**: "Mixing photographic and
>   illustrated spots within the same page section — pick one mode
>   per page"
> - **For free-stock directions**: "Falling back to lower-tier
>   sources during deadline pressure — direction inconsistency
>   compounds page-over-page"
> - **For licensed directions**: "Using free-stock for 'just one'
>   image to save budget — undermines the licensed strategy"
> - **For ai-generated directions**: "Generating imagery of real
>   people, copyrighted characters, or branded products"
> - **For k-12 audiences**: "Real photos of children even with
>   model releases — illustration is the safe default"
>
> Each anti-pattern is rendered as a placeholder rectangle with a
> red strikethrough overlay and the rule text in body-sm beneath it.
>
> ### Naming
>
> - Frame names use kebab-case
> - Section frames: `direction-summary`, `vendor-sources`,
>   `category-gallery`, `treatment-showcase`, `rights-checklist`,
>   `search-reference`, `anti-patterns`
> - Per-category rows: `category-hero`, `category-spot-illustration`, etc.
> - Vendor cards: `vendor-{{name}}` (kebab-cased name)
> - Anti-pattern items: `avoid-{{shortname}}`
> - All placeholders use Pencil tokens (`--content-3` for the
>   diagonal line, `--surface` for the rectangle fill) — never
>   hard-coded hex.

## Execution

```bash
pencil --out design/foundations/imagery.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page root. Confirm:
- Direction summary card present with all 7 fields populated.
- Vendor sources row contains one card per recorded vendor with
  matching license-color badge.
- Asset category gallery has one row per category in
  `{{imagery.categoryGuidelines}}` — no missing rows.
- Color treatment showcase shows all four stages (original →
  treatment → hover → with text).
- Rights checklist includes the audience-regulation items if
  `audience-regulation` is set.
- Search reference card lists every category from the guidelines.
- Anti-patterns section is present with strikethrough placeholders.
- Light and Dark variants both render — color treatments must look
  visibly different across the two surfaces.
- All image content is placeholder-rendered (diagonal-line gray
  rectangles), no real assets embedded.

If any section is missing or any category row is absent, refine in
place. If the page extends beyond a reasonable scroll length (>4000px
tall), confirm with the user that the verbose output is acceptable —
this page is intentionally reference-rich because it serves content
producers, not engineers.

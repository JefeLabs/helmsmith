---
description: Generate either (a) a direction-evaluation file showing N color/font directions × M representative page tiers in a single .pen for brand-direction refinement, or (b) a single high-fidelity page with full atomic decomposition for production. Two distinct outputs from one command, selected by mode.
argument-hint: <page-type or description> [--based-on <exploration-pen-path>[#row-X]] [--directions <n>] [--page-set marketing|product|content|commerce|saas|<custom-list>] [--finalize <direction-name>] [--variant <name>] [--breakpoints desktop,tablet,mobile] [--depth atoms|molecules|organisms|templates|all] [--no-decomposition] [--out <path>] [--inherit-from <file.pen>] [--dry-run] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate one of two distinct artifacts depending on mode:

1. **Direction-Set evaluation** (`--page-set <preset>` with
   `--directions N`): A grid of N brand-direction candidates × four
   page tiers (Homepage, Secondary, Tertiary, Template) all in one
   `.pen` file. Each row is one direction's treatment applied
   consistently across the page tier set. Used for **brand-direction
   refinement** — the question this artifact answers is "which
   treatment holds up across our whole site?", not "what does this
   specific page look like?"

2. **Per-page production design** (default `<page-type>` mode): A
   single high-fidelity page with the full atomic decomposition
   (Atoms / Molecules / Organisms / Templates / Pages canvases).
   Used after a direction is finalized — produces the artifact
   `/core:frameworks:heroui:build-components` reads.

The two outputs serve different stages of the pipeline. Mixing them
(per-page output × multi-direction) makes weak comparisons because
one page can't capture treatment effects across content depth.

The pipeline progression:

```
explore                            (low-fi structural alternatives — pick row)
  ↓
design-page --page-set --based-on  (high-fi DIRECTION refinement — pick direction)
  ↓
design-page --finalize <direction> (commit brand-JSON + @theme)
  ↓
design-page <page-type>            (per-page production design w/ atomic decomp)
  ↓
build-components                   (React from finalized state)
```

The direction-refinement detour (steps 2–3) is **skippable** when
brand colors and fonts are already settled. Established projects
typically start at step 4. New projects or rebrands benefit from
the full sequence.

Default output path varies by mode:
- Direction-Set: `design/directions/<brand-slug>.pen`
- Per-page: `design/pages/<page-slug>.pen`

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Load `product/.pencil-brand.json` (or prompt for the minimum: `brand`,
   `primary`, `iconLibrary`).
3. **Inventory existing design-system files** so we can inherit, not
   regenerate:
   - List `design/foundations/*.pen` and `design/components/*.pen`.
   - For each found file, run `get_editor_state({ include_schema: false })`
     against it (or `pencil --in <file>.pen --query 'list-frames'` headless)
     to extract every component frame name and its node id.
   - Build a manifest `product/.pencil-component-manifest.json` that maps
     semantic names (`button-primary-md`, `text-field-default`) to source
     `.pen` paths + node ids. The embedded prompt will reference this
     manifest so generated atoms instantiate the canonical versions instead
     of inventing new ones.
4. Resolve the page type:
   - First positional arg in `$ARGUMENTS`. If it matches a built-in (see
     Phase 1), use that recipe. Otherwise treat as a free-text description
     and synthesize the decomposition.
5. Resolve flags:
   - `--based-on <exploration-pen-path>[#row-X]` → read the chosen
     structural skeleton from a `/product:design:explore` output. The path is
     either a `.pen` file (uses row A by default) or a `.pen#row-B`
     fragment to pick a specific row. When set, the page's structural
     bones (screen flow, layout, organism placement) are inherited
     from the exploration row instead of being synthesized fresh.
   - `--directions <n>` → number of high-fidelity color/font
     directions to render in Direction-Set mode. Default `3` when
     `--page-set` is set; max 5. Has no effect in Per-page mode.
     Pick `2` when the brand brief is unusually clear and a third
     direction would just dilute the comparison; `3` (default) for
     most situations; `4-5` only when the brand intentionally wants
     to span a wider stylistic range and the user has time for the
     longer review.
   - `--page-set <preset|custom>` → triggers Direction-Set mode and
     selects which four page tiers to populate. Built-in presets:
     - `marketing` → homepage=landing, secondary=features, tertiary=pricing or about, template=footer-template
     - `product` → homepage=dashboard, secondary=settings, tertiary=detail, template=app-shell-template
     - `content` → homepage=article-list, secondary=article-detail, tertiary=author-page, template=article-template
     - `commerce` → homepage=storefront, secondary=product-detail, tertiary=cart-checkout, template=product-template
     - `saas` → homepage=landing, secondary=signup, tertiary=onboarding, template=dashboard-template
     - **Custom**: comma-separated quad — `--page-set "homepage:landing,secondary:pricing,tertiary:blog-post,template:article-template"` (slot name + `:` + page archetype). All four slots required when using custom syntax.
   - `--finalize <direction-name>` → consolidates one direction from
     an existing direction-set `.pen` as canonical. Reads the
     direction's recorded tokens, writes them to brand JSON + `@theme`
     atomically, prunes unchosen directions from the file. After
     finalize, run per-page `design-page` calls for production
     design.
   - `--breakpoints` → comma list, default `desktop,mobile` (add tablet on
     opt-in for layout-sensitive pages).
   - `--depth` → which atomic levels to render. Default `all`.
     `atoms` = atoms only. `molecules` = atoms + molecules. `organisms` =
     atoms + molecules + organisms. `templates` = adds wireframe.
     `all` = adds the pages canvas.
   - `--no-decomposition` → render only the `Pages` canvas (skip Atoms /
     Molecules / Organisms / Templates entirely). Useful when you just want
     a visual mock without the breakdown.
   - `--inherit-from` → an existing `.pen` to use as the component source
     instead of the auto-detected manifest. Useful for repos with a
     monolithic UI-kit `.pen`.

### Modes

The flags compose into three operational modes:

| Mode | Trigger | Output | Atomic decomp? |
| ---- | ------- | ------ | -------------- |
| **Direction-Set** | `--page-set <preset>` (typically with `--based-on`, `--directions N`) | Direction-evaluation grid: rows × directions, columns × page tiers, all in one `.pen` at `design/directions/<brand-slug>.pen`. **Still exploratory** — no commitment to components. | NO — pages canvas only, single breakpoint (desktop) |
| **Per-page** | `<page-type>` only (default) | Single high-fidelity page at `design/pages/<page-slug>.pen` for production design. Reads finalized brand JSON + `@theme`. | YES (Atoms / Molecules / Organisms / Templates / Pages) |
| **Finalize** | `--finalize <direction-name>` on existing direction-set `.pen` | Atomic commit: writes brand JSON + `@theme`, prunes unchosen directions. After finalize, per-page production design runs against committed state. | (operates on existing `.pen`) |

Mode-specific notes:

- **Direction-Set mode** answers "which brand treatment works across
  our site?" by rendering the same four page tiers (Homepage,
  Secondary, Tertiary, Template) in N candidate directions
  side-by-side. Atomic decomposition is intentionally skipped — these
  pages are evaluation artifacts, not build inputs. Single breakpoint
  (desktop 1440) keeps the comparison readable.
- **Per-page mode** is the production-design entry point. Use after
  a direction is finalized — it reads brand JSON's locked tokens,
  applies them to one specific page, and produces the multi-canvas
  decomposition that `/core:frameworks:heroui:build-components` consumes.
- **Finalize mode** transitions from exploration to commitment. It
  operates on an existing direction-set `.pen` and atomically writes
  the chosen direction's tokens to brand JSON + `@theme`. Don't
  combine `--page-set` and `--finalize` in the same call.

The typical end-to-end flow:

```
1. /product:design:design-page --based-on explore.pen --page-set saas --directions 3
   → design/directions/<brand>.pen (3 directions × 4 page tiers grid)

2. Review in Pencil; pick direction "B"

3. /product:design:design-page --finalize B
   → atomically writes brand JSON + @theme

4. /product:design:design-page <page-type>  (run per-page for each page in production scope)
   → design/pages/<page-slug>.pen (full atomic decomposition, single direction)

5. /core:frameworks:heroui:build-components <page-slug>
```

## Phase 0 — Read structural skeleton (only when `--based-on` is set)

When `--based-on <path>[#row-X]` is provided, read the chosen
exploration row from the `/product:design:explore` output and extract its
**structural skeleton**:

1. Open the exploration `.pen`. If the path includes `#row-X`, target
   that row; otherwise default to row A.
2. Walk the row's screen frames. For each screen:
   - Extract the **layout shape** (header / sidebar / content / footer
     positions; column counts; full-bleed vs contained).
   - Extract the **organism placement** (which page-section primitive
     occupies each region — nav, hero, feature-grid, footer, etc.).
   - Extract the **screen sequence** (which screens appear in what
     order; transition labels between them).
   - Extract any **annotations** indicating responsive transitions
     (`stacks below md`, `nav links → drawer at sm`, etc.).
3. Discard everything else from the exploration row — the wireframe
   placeholders, the gray-only palette, the FA icons, the sketchy
   typography. Only the structure carries forward.
4. The downstream prompt uses this skeleton to constrain organism
   placement and screen flow, while applying the design system's
   real fonts, colors, components, and treatments at high fidelity.

**Why this matters**: without `--based-on`, design-page is free to
synthesize the structure from the page-type recipe (Phase 1). With
`--based-on`, the exploration's structural decisions are honored,
turning design-page into a high-fidelity *rendering* of those
decisions rather than a fresh synthesis.

If the exploration `.pen` is missing or unreadable, prompt the user
to verify the path and stop. Don't fall back to direct mode silently
— that would discard the user's structural decision.

## Phase 1 — Page-type recipes

If the page type matches one of these built-ins, use the listed canonical
decomposition. Free-text page types skip this phase and have their
decomposition inferred by the AI in Phase 3.

| Type             | Variants                                | Canonical organisms                                                  |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `dashboard`      | analytics • ops • admin • user         | top-nav, sidebar, page-header, stat-row, chart-grid, data-table, activity-feed |
| `settings`       | account • billing • integrations • team | top-nav, settings-sidebar, page-header, section-form, danger-zone |
| `profile`        | public • edit                          | top-nav, profile-header, tabs, content-grid, sidebar-meta            |
| `pricing`        | saas • marketplace                      | top-nav, hero, billing-toggle, tier-cards, feature-comparison, faq, footer |
| `auth`           | sign-in • sign-up • forgot • mfa        | brand-mark, auth-card, oauth-row, divider, footer-links              |
| `onboarding`     | welcome • setup • invite               | progress-stepper, content-card, action-row, skip-link                |
| `inbox`          | email • notifications                   | top-nav, sidebar-folders, list-pane, detail-pane, action-toolbar     |
| `detail`         | product • record • article              | top-nav, breadcrumbs, page-header, gallery-or-hero, body-content, sidebar-meta, related-section |
| `list`           | table • cards • kanban                 | top-nav, page-header, filter-toolbar, list-or-grid, pagination, empty-state |
| `wizard`         | linear • branching                      | progress-stepper, step-content, action-row, summary-side-panel       |
| `search`         | results • empty • zero-state           | search-bar, filter-rail, result-list, pagination, suggestion-block   |
| `error`          | 404 • 403 • 500 • offline              | minimal-toolbar, error-card, action-row                              |

For free-text page types ("a school district admin page that shows enrollment
trends"), infer organisms by decomposing the description into nouns (sections)
and verbs (actions), then map each to HeroUI v3 organisms in Phase 3.

## Phase 2 — Plan the file structure

Build a single `.pen` file at `design/pages/<page-slug>.pen` with these
**Pencil pages** (each is its own canvas — multi-page beats one tall page
because each atomic level deserves room to breathe):

1. **`Atoms`** — every atomic instance used on the page, grouped by type
2. **`Molecules`** — composed units of 2+ atoms
3. **`Organisms`** — page sections
4. **`Templates`** — wireframe / layout skeleton of the page
5. **`Pages`** — final designs at every requested breakpoint

`--depth` and `--no-decomposition` skip pages from the bottom of the list
upward (so `--depth molecules` keeps Atoms + Molecules only).

## Phase 3 — Embedded prompt (the meat)

> Build a multi-page Pencil document at **`design/pages/{{page-slug}}.pen`**
> for **{{brand}}**. The page being designed is **{{page-type}}**
> (variant: **{{variant}}**). Use HeroUI v3 compound APIs and reference
> tokens from `_context.md`. Light + Dark side by side on every canvas
> (skip Dark if `supportsDark: false`).
>
> When the manifest at `product/.pencil-component-manifest.json` lists a
> matching component, **instantiate from that source** rather than drawing
> a new one. Treat the manifest entries as a published library — preserve
> their node ids in the inserted instance metadata so downstream tools can
> trace each instance back to its canonical definition.
>
> ### Page 1 — `Atoms`
>
> A single 1440-wide canvas. Render six horizontal shelves, each labeled
> with the atom category, separated by 64px vertical gaps. For each atom
> instance, place it on a faint grid background with a 12px caption below
> showing the compound API call.
>
> Categories (omit any that the page does not actually use):
>
> 1. **Typography** — every text style instance found on the page (e.g.
>    `display-lg`, `h2`, `body-md`, `caption`). One specimen per style with
>    the token name as label.
> 2. **Buttons** — every button variant + color + size combo used. Annotate
>    with `<Button.Root variant="..." color="..." size="...">`.
> 3. **Inputs** — every form-input atom: `Input`, `TextField`, `NumberField`,
>    `SearchField`, `TextArea`, `Checkbox`, `RadioGroup`, `Switch`, in
>    whichever sizes/states the page uses.
> 4. **Icons** — every icon literal used, at the size used. Render with the
>    `iconLibrary` resolved from brand JSON (FA / lucide / heroicons /
>    gravity-ui). Caption with the icon name + import path.
> 5. **Indicators** — `Avatar`, `Badge`, `Chip`, `Kbd`, `Spinner`, `Tag`.
> 6. **Surfaces & rules** — every surface depth used (`--surface`,
>    `--surface-raised`, etc.) and separators present on the page. Render
>    each as a small swatch with the token name.
>
> Each instance gets a thin border and a 4-state row beside it: default,
> hover, focus, disabled (only the states actually used on the page).
>
> ### Page 2 — `Molecules`
>
> Composed units — exactly 2+ atoms working together. One row per molecule,
> labeled with a name and an inline composition diagram (e.g.
> `SearchField = Input + Icon + CloseButton`). Render the molecule once in
> isolation, then once with a 200% zoom call-out next to it for clarity.
>
> Default molecules to look for (only render those the page actually uses):
>
> - **Form field** = Label + Input + Description + FieldError
> - **Search bar** = SearchField + (optional) leading filter Dropdown +
>   trailing Button
> - **Nav item** = Icon + Label + (optional) Badge + (optional) chevron
> - **Tab** = Label + (optional) Icon + (optional) Badge + Indicator slot
> - **Breadcrumb segment** = Link + Separator
> - **Card header** = Avatar + Stack(Title, Description) + ActionMenu
> - **Stat card** = Label + Value + Delta + Sparkline
> - **List item** = leading Avatar/Icon + Stack(Title, Description) +
>   trailing Action/Chevron/Switch
> - **Empty-state row** = Icon + Stack(Title, Description) + CTA
> - **Toast row** = Icon + Stack(Title, Description) + CloseButton
> - **Pricing-tier item** = Check Icon + Feature label
> - **Filter chip** = Chip + leading Avatar/Icon + close X
> - **Pagination control** = Prev Button + Page Buttons + Ellipsis +
>   Next Button
> - **Toolbar group** = ButtonGroup or ToggleButtonGroup with Separator
>
> If the page uses a molecule not in this list, infer it from context and
> add it with the same naming convention (kebab-case, role-based name).
>
> ### Page 3 — `Organisms`
>
> Larger sections — typically a molecule grouped with surrounding chrome
> (heading, layout, surface). For each organism:
>
> **Classify first.** Apply the Large Organism test from `_context.md`
> rule 8: width > 800px, OR a page-section primitive (nav bar, hero,
> sidebar, footer, app shell, dashboard layout container, sectioned
> content region, full-width banner), OR contains 3+ molecules in a
> single layout, OR appears on the Pages canvas at near-full viewport
> width. If any criterion matches, the organism is **Large** and must
> render at all three canonical breakpoints. Otherwise render once at
> its default width.
>
> **For Large Organisms — render three breakpoint frames side by side:**
>
> | Label              | Viewport | Use                                   |
> | ------------------ | -------- | ------------------------------------- |
> | `<organism>-mobile` | 390px   | iPhone-class portrait                 |
> | `<organism>-tablet` | 768px   | iPad portrait / md breakpoint exactly |
> | `<organism>-desktop`| 1440px  | canonical desktop                     |
>
> Show the actual responsive transitions between frames — what
> collapses, stacks, hides, or shifts orientation. Annotate transitions
> with arrows or callouts (`stacks below md`, `nav links → drawer
> trigger at sm`, `sidebar hides at lg`, `4-col grid → 1-col stack`).
>
> **For non-Large organisms** — render once at default width (the
> width it appears on the page). If the organism still exceeds 400px
> width, follow rule 7 (one default frame + at least one narrow
> variant showing the layout transition).
>
> Spec column (280px wide) to the right of each organism row,
> regardless of breakpoint count, showing:
>
> - The compound HeroUI structure (e.g. `<Card.Root> <Card.Header>
>   <Card.Title /> <Card.Description /> </Card.Header> <Card.Content>
>   <DataTable /> </Card.Content> </Card.Root>`)
> - The molecules + atoms it depends on (a small bullet list)
> - Responsive behavior summary (`mobile: stacks vertically; tablet:
>   2-col grid; desktop: 3-col grid + sidebar`)
> - Tier classification (`Large` or `Standard`) with the specific
>   criterion that matched, so reviewers can verify the call
>
> Default organism set comes from the recipe in Phase 1 if the page
> type is built-in. For free-text pages, infer organisms by walking
> the page's sections and grouping cohesive content blocks (one
> organism per section). Most page-section organisms (nav, hero,
> footer) qualify as Large by definition; reusable cards and
> compound widgets usually qualify by width or molecule count.
>
> ### Page 4 — `Templates`
>
> The wireframe / layout skeleton of the page. Render at every requested
> breakpoint side by side. Each frame is **gray placeholder boxes only** —
> no styling, no real content. Each box is labeled with the organism name
> it represents (`nav`, `page-header`, `stat-row`, `data-table`, `footer`).
> Show the column grid overlay (from `foundations/grids.pen`) underneath
> the placeholder boxes so the responsive grid alignment is visible.
>
> Annotate any responsive change with arrows: "stacks below md", "drawer
> below sm", "hides at sm", etc.
>
> ### Page 5 — `Pages`
>
> The final designs at every requested breakpoint, side by side. Each
> frame is named after its viewport: `{{page-slug}}-desktop`,
> `-tablet`, `-mobile`. Use real content inferred from the page type
> and brand context, not lorem. Each frame is the composition of
> organisms in the order specified by the recipe (or inferred for
> free-text, or extracted from the exploration skeleton when
> `--based-on` is set).
>
> Above each frame, a 24px caption: `{{page-slug}} / {{breakpoint}} /
> {{viewport-width}}`.
>
> ### Multi-direction rendering (Direction-Set mode only — when `--page-set` is set)
>
> **In Direction-Set mode, this command produces a fundamentally
> different output than per-page mode.** The `.pen` is structured as a
> **direction-evaluation grid**:
>
> - **Rows** = brand directions (A, B, C — typically 3, max 5)
> - **Columns** = page tiers (Homepage, Secondary, Tertiary, Template)
> - **Single breakpoint** = desktop 1440 (responsive review is a
>   different concern from direction review)
> - **No atomic decomposition** — Atoms / Molecules / Organisms /
>   Templates canvases are skipped entirely. The file contains only
>   the rendered grid plus headers and reference cards.
>
> ### Grid structure
>
> Page dimensions: `1440px outer padding 64px + (4 page columns ×
> 1440 + 80px gaps) = 6080px wide × (N directions × 920 + 200) tall`.
> Wide is intentional — the grid is meant to be scrolled horizontally
> in Pencil, with each row representing one direction's full hand.
>
> #### Row structure (one row per direction)
>
> Each row is 920px tall. Left-most column (240px wide, full row
> height) is the **direction header card**:
>
> - Direction letter and name (h2): "A — Canonical (brand-JSON)" or
>   "B — Editorial Serif" or "C — Duotone Saturated"
> - Direction tokens (mono font, body-sm): inline `tokens.json`
>   reference listing accent / secondary / fontDisplay / fontBody /
>   colorTreatment for this direction
> - 2–3 line summary describing what this direction prioritizes and
>   trades off
> - "Recommended for review" tag if this direction matches some quality
>   heuristic (e.g. highest accessibility AA/AAA pass rate across
>   tiers)
>
> The remaining row width is divided into **four page columns**, each
> 1440px wide with 80px gaps between them. Each column renders one
> page tier in this direction's treatment:
>
> 1. **Homepage** — the brand's primary entry point. Marketing-tier
>    landing or the product's main interactive surface. Hero, primary
>    nav, key CTAs, footer.
> 2. **Secondary** — second-tier nav destination. Features page,
>    pricing, settings landing, etc. depending on `--page-set`.
> 3. **Tertiary** — deep content. Blog post, product detail, settings
>    sub-page, etc. The "leaves" of the navigation tree.
> 4. **Template** — a reusable layout pattern. Footer-template,
>    article-template, dashboard-shell-template, etc. Demonstrates how
>    the direction holds in non-marketing contexts.
>
> Each page column renders as a complete page with real content,
> respecting all `_context.md` rules (theme tokens, no inline styling,
> HeroUI compound API references). Above each page, a 24px caption:
> `<tier-name> / <page-archetype>`.
>
> #### Direction A is canonical
>
> The first direction (A) **must** use brand-JSON's persisted tokens
> exactly. Mark its header card with a "Canonical (brand-JSON)" badge.
> This gives reviewers a baseline — direction A is "what we have
> today"; B, C, etc. are alternatives.
>
> #### Subsequent directions are organic alternatives
>
> Each subsequent direction varies one or more dimensions from the
> canonical:
>
> - **Direction B**: alternative color treatment (e.g. duotone
>   instead of brand-tinted; monochrome instead of full-color)
> - **Direction C**: alternative font pairing (e.g. serif-sans-contrast
>   instead of single-voice; editorial display instead of technical
>   sans)
> - **Direction D** (if `directions ≥ 4`): alternative palette energy
>   (saturated vs. muted, warm vs. cool)
> - **Direction E** (if `directions ≥ 5`): radical contrast — any
>   defensible combination distinctly different from A–D
>
> ### Critical: directions don't write to the design system
>
> In Direction-Set mode, the alternate directions (B, C, D, E) are
> **scoped entirely to this `.pen` file**. They do not write to brand
> JSON, do not extend `@theme`, do not modify foundation `.pen` files.
> The `tokens.json` reference per direction header is **informational
> only** — it describes what the direction *would* commit if
> finalized, not what the system has committed.
>
> Only `--finalize` writes to the design system. This separation is
> what makes direction exploration safe and reversible.
>
> ### Tokens.json reference shape (per direction)
>
> Each direction header card embeds a small JSON block (rendered in
> mono, body-sm, on `--surface-raised`) describing the tokens:
>
> ```json
> {
>   "directionLetter": "B",
>   "directionName": "Editorial Serif",
>   "wouldCommit": {
>     "primary": "#0A2E1C",
>     "secondary": "#D4A84F",
>     "fontDisplay": "Fraunces",
>     "fontBody": "Inter",
>     "colorTreatment": "duotone-warm"
>   },
>   "varies": ["fontDisplay", "colorTreatment"]
> }
> ```
>
> The `varies` list calls out which dimensions this direction shifted
> from canonical, making the comparison reading easier.
>
> ### Naming (Direction-Set mode)
>
> - Page-level `.pen` frame: `directions-{{brand-slug}}`
> - Per-row direction strip: `direction-A-canonical`, `direction-B-<name>`, etc.
> - Per-row header cards: `direction-{{letter}}-header`
> - Per-tier page frames: `direction-{{letter}}-{{tier-slot}}-{{archetype}}`
>   (e.g. `direction-B-homepage-landing`, `direction-B-template-article-template`)
> - All placeholder image content uses the same diagonal-line
>   convention from `/product:design:explore` and `/product:design:foundations:imagery`.
>
> ### Cross-page navigation hints (Per-page mode only)
>
> On the `Pages` canvas of a per-page production design, every
> organism gets a small floating label (only visible in inspect mode,
> not in the rendered design) linking back to its definition on the
> `Organisms` canvas. Pencil supports prototype links between pages —
> wire each organism instance with a "Go to definition" link that
> jumps to the matching frame on `Organisms`. Same for organisms →
> molecules → atoms. Direction-Set mode skips this entirely (no
> atomic decomposition exists).
>
> ### Naming (Per-page mode)
>
> - Page-level frame names: `{{page-slug}}-{{breakpoint}}`
> - Organism frame names: kebab-case role names (`nav`, `page-header`,
>   `stat-row`)
> - Molecule frame names: kebab-case role + `-molecule` suffix (only when
>   ambiguous with an atom: `tab-molecule`)
> - Atom frame names: BEM block (`button`, `input`, `chip`)

## Phase 4 — Execution

Prefer **Path A (MCP)** over **Path B (CLI)** for this command — multi-page
generation benefits from `get_editor_state` introspection between page
generations to ensure consistency (e.g. an organism on the `Organisms`
canvas should use the exact same Card frame the manifest pointed to).

```bash
# CLI fallback if MCP not available
pencil --out design/pages/{{page-slug}}.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

When refining an existing page-design `.pen` (the file already exists),
always pass `--in` to read the current state. Specifically: when a user
asks for a change to "the dashboard" and `design/pages/dashboard.pen`
exists, edit in place — don't regenerate from scratch. The atomic
decomposition is expensive to recompute and the user may have hand-edited
specific frames.

## Phase 4.5 — Finalize a direction (only when `--finalize` is set)

When invoked with `--finalize <direction-name>`, the command operates
on an **existing direction-set `.pen`** (typically at
`design/directions/<brand-slug>.pen`) and consolidates one direction
into the design system's canonical state. This is the transition
from exploration to commitment.

1. Locate the direction-set `.pen`. By default, the most recent
   `design/directions/*.pen`. Override with `--in <path>` if multiple
   exist.
2. Confirm the file is a direction-set `.pen` (has multiple direction
   rows on its grid). If it's a per-page production `.pen` instead,
   error out — finalize is for direction-set evaluation files only.
3. Locate the direction row matching `<direction-name>`. Match against
   the direction header card's name (case-insensitive,
   kebab-tolerant — "duotone-editorial" matches "Duotone Editorial",
   "B" matches by letter alone if unambiguous).
4. If no match, list available direction names + letters and stop.
5. **Read the chosen direction's tokens** from its inline
   `tokens.json` reference embedded in the header card:
   - primary, secondary, fontDisplay, fontBody, colorTreatment
6. Surface a confirmation prompt:

```
Finalize direction "B — Editorial Serif" from
design/directions/{{brand-slug}}.pen?

This will:
- Apply direction B's tokens to brand JSON and @theme:
    primary:        was #0A84FF      → #0A2E1C
    secondary:      was #66B2FF      → #D4A84F
    fontDisplay:    was Inter Display → Fraunces
    fontBody:       was Inter         → Inter (unchanged)
    colorTreatment: was brand-tinted-overlay → duotone-warm
- Refresh foundation manifests (typography, colors)
- Optionally: prune unchosen direction rows from the source .pen
  (--prune flag) so it becomes a record of "what we picked" rather
  than "what we considered"

This commits direction B to the design system. Build-components
will read from this canonical state on next run. Continue? [y/N]
```

**`--dry-run` behavior**: when set, step 7 below does NOT execute.
Instead, the command prints the full diff that would be written to
brand JSON, `@theme`, and foundation manifests, plus the metadata
changes to the direction-set `.pen`. The user reviews and re-runs
without `--dry-run` to actually commit. This is the safe-rehearsal
path before any production-affecting finalize.

```
DRY RUN — finalize would write:

product/.pencil-brand.json:
  primary:        was #0A84FF      → #0A2E1C
  secondary:      was #66B2FF      → #D4A84F
  fontDisplay:    was Inter Display → Fraunces
  colorTreatment: was brand-tinted-overlay → duotone-warm

app/globals.css @theme block:
  + 9 token additions
  ~ 12 token replacements

product/.pencil-typography.json: refresh
product/.pencil-colors.json:     refresh

design/directions/<brand>.pen metadata:
  + finalized: true
  + finalizedDirection: "B"
  + finalizedAt: <ISO>
  briefSlug: carried forward from research → "saved-searches"

To actually finalize, re-run without --dry-run.
```

7. On confirmation, atomically:
   - **Apply tokens** to brand JSON (replacing `primary`,
     `secondary`, `fontDisplay`, `fontBody`, `imagery.colorTreatment`)
   - **Update `@theme` block** to match (the same atomic-write pattern
     used by `colors-select` and `fonts-select`)
   - **Refresh foundation manifests**
     (`product/.pencil-typography.json`, `.pencil-colors.json`)
   - **Mark the direction-set `.pen` metadata**: `finalized: true`,
     `finalizedDirection: "B"`, `finalizedAt: <ISO date>` — the file
     becomes a historical record of what was committed
   - **If `--prune`**: delete the unchosen direction rows from the
     `.pen`, leaving only direction B
   - **Write a `briefSlug` reference** if a brief is linked: extract
     from the Direction-Set `.pen`'s metadata (which would have been
     populated when it was generated from a brief-derived
     exploration). This `briefSlug` later flows into per-page `.pen`s
     and the build manifest, closing the audit loop's brief-drift
     check.
8. Print a summary of what changed:

```
✅ Finalized direction B — Editorial Serif
   Source:   design/directions/{{brand-slug}}.pen
   Tokens applied to brand JSON and @theme:
     primary:        was #0A84FF, now #0A2E1C
     fontDisplay:    was Inter Display, now Fraunces
     colorTreatment: was brand-tinted-overlay, now duotone-warm
   briefSlug:        carried forward from direction-set source

   Direction-set .pen:
     finalized: true
     finalizedDirection: "B"
     finalizedAt: 2026-05-02T18:42:00Z

   {{ if --prune: }}
     Pruned direction rows from .pen: A, C, D

📝 Next: per-page production design

   /product:design:design-page <page-type>     # for each page in production scope
   /core:frameworks:heroui:build-components <page-slug>  # generate React after design
```

**This is destructive on brand JSON + `@theme`** — finalize cannot be
undone except by reverting git. The atomic-write pattern ensures
partial state never persists, but committed git history is the only
rollback path.

**Why finalize operates on direction-set files, not per-page files**:
the direction-set `.pen` is where direction comparison happened, so
that's where the choice exists to commit. Per-page production design
runs *after* finalize and reads the already-committed brand JSON.
Finalizing a per-page file would mix concerns — that file is one
page's atomic decomposition, not a direction comparison.

## Phase 5 — Verify

After generation, run these checks in order. If any fails, run a single
refinement pass to fix and re-verify; if it still fails, report the gap to
the user with a screenshot rather than looping.

1. **Page count** — exactly 5 Pencil pages exist (or fewer if `--depth`
   trimmed the bottom). Confirm via `get_editor_state`.
2. **Atom uniqueness** — no atom appears on the `Pages` canvas without a
   matching entry on the `Atoms` canvas. Walk both, diff by frame name.
3. **Organism consistency** — every organism on the `Pages` canvas has a
   matching definition on `Organisms` with the same compound structure.
4. **Breakpoint coverage** — `Pages` and `Templates` both have one frame
   per requested breakpoint, named correctly.
5. **Manifest fidelity** — every atom instance on `Atoms` either references
   a manifest source (preserved node id in metadata) or is flagged
   `synthesized: true` so the user can see what was generated fresh.
6. **Screenshot each canvas** to `design/.previews/{{page-slug}}/` named
   `atoms.png`, `molecules.png`, `organisms.png`, `templates.png`,
   `pages.png`.

## Reporting

End with this summary block:

```
✅ design/pages/{{page-slug}}.pen
   Atoms:      <count>  (synthesized: <n>, inherited: <n>)
   Molecules:  <count>
   Organisms:  <count>
   Templates:  <breakpoints>
   Pages:      <breakpoints>

🖼  design/.previews/{{page-slug}}/{atoms,molecules,organisms,templates,pages}.png

⚠️  Synthesized atoms not yet in the design system:
   - <atom-name>  → consider adding to design/components/<group>.pen
   - ...
```

The "Synthesized atoms not yet in the design system" section is the most
useful output of the whole command — it surfaces every atom that the page
needed but the design system didn't already provide, so the design system
can grow deliberately instead of through component sprawl.

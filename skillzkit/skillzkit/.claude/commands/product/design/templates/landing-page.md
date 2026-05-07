---
description: Generate a complete responsive landing page template using HeroUI v3 components.
argument-hint: [--variant saas|product|agency|docs] [--with-pricing] [--with-testimonials] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/landing.pen` — a production-ready landing page
template that composes the components from this design system. It should
look like the marketing site for **{{brand}}**, not a generic stock layout.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Confirm foundations and components have been generated (`design/components/
   buttons.pen` etc. exist). If they don't, suggest running
   `/product:strategy:scaffold --only foundations,components` first — but proceed
   anyway with token-driven defaults.
3. If MCP: `get_guidelines({ category: "guide", name: "Landing Page" })` and
   incorporate any returned structure / copy guidance.
4. Variant defaults to `saas` unless `$ARGUMENTS` says otherwise.
5. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["landing-page"]`.
   See SEO + AIO contract section below for what to apply. When
   missing, fall back to baseline correctness (single H1, alt text,
   sequential heading cascade) and surface the recommendation to
   run `/product:strategy:seo`.

## Embedded prompt

> Build a Pencil page named **`Templates / Landing`** for **{{brand}}** —
> tagline: *"{{tagline}}"*. Variant: **{{variant}}**.
>
> Render the page **three times** at different viewport widths, side by
> side: `Mobile (390)`, `Tablet (768)`, `Desktop (1440)`. Each is a separate
> top-level frame so the responsive behavior is visible at a glance.
>
> Use real copy (not lorem) inferred from the brand's tagline and variant.
> Use HeroUI v3 components by name — Buttons, Card, Surface, etc. — and
> reference token variables for every color/spacing decision.
>
> ### Section order (top to bottom)
>
> **1. Top nav (sticky)**
> Compose with `Toolbar`, `Link`, `Button`, optional `Dropdown` for product
> menu. Left: logo (use the mark from `foundations/logos.pen`). Center
> (desktop only): primary nav links — `{{variant === 'saas' ? 'Product /
> Solutions / Pricing / Customers / Docs' : variant === 'product' ?
> 'Features / How it works / FAQ' : variant === 'agency' ? 'Work / Services
> / About / Contact' : 'Guides / API / Reference / Changelog'}}`. Right:
> `Sign in` link + `Get started` Button (primary/solid). Mobile: hamburger
> Drawer trigger.
>
> **2. Hero**
> - Eyebrow chip ("Now in beta" / version tag)
> - Display-2xl headline (one line desktop, two on mobile) — write copy
>   from the tagline
> - Body-lg subheadline, max-width 640
> - Primary CTA Button + secondary "ghost / link" Button side by side
> - Below CTAs: a small social-proof row — "Trusted by" + 4–6 monochrome
>   logo placeholders
> - Hero visual: large rounded Surface (`--radius-2xl`) on the right
>   (desktop) / below CTAs (mobile) showing a product screenshot mock — a
>   composed dashboard inside it (use Card + Table + Chart skeleton from
>   data-display)
>
> **3. Logo bar** (only if `--with-logos` or default)
> Single row of 6 customer/partner logos in `--content-3`, no chrome.
>
> **4. Feature triad**
> Three Card.Root cards in a row (stack on mobile). Each: icon (lucide
> 32px in accent-tinted Surface), feature title (h3), description
> (body-md), small trailing Link "Learn more →".
>
> **5. "How it works" — 3-step**
> Numbered steps (`01 / 02 / 03`) in display-lg, each with a heading +
> description + small Surface mockup. Stack vertically on mobile, side by
> side on desktop with connecting separator lines.
>
> **6. Bento feature grid**
> A 2×3 (desktop) / 1×6 (mobile) grid of Surface cards at varying spans:
> - Large card (col-span-2 desktop): a "headline feature" with mock
>   visualization
> - Medium cards: 4 supporting features each with icon + title + body
>   copy + tiny visual
> Use varying tints (accent, neutral, secondary) to add visual rhythm
> without clashing.
>
> **7. Testimonials** (only if `--with-testimonials` or variant is `saas`)
> Three quote Cards in a row: avatar + name + role + company logo + quote
> body + 5-star rating chip. On mobile, becomes a horizontal-scroll row
> with ScrollShadow on the edges.
>
> **8. Pricing** (only if `--with-pricing` or variant is `saas`)
> Three pricing Cards (Free / Pro / Team or similar) in a row. Middle
> card highlighted with `--accent` outline + "Most popular" Badge above
> Card.Header. Each card: tier name, price (display-lg with small
> "/month" caption), CTA Button, separator, feature list with Check
> icons. Toggle for monthly/annual at the top using a ToggleButtonGroup.
>
> **9. FAQ**
> Accordion (`splitted` variant) with 6 common questions. Single-open
> mode.
>
> **10. CTA banner**
> Full-bleed Surface tinted `--accent-50` (light) / `--accent-900` (dark),
> centered headline + body + dual Button (primary CTA + secondary link).
>
> **11. Footer**
> Multi-column: brand mark + tagline (left), then 4 link columns
> (Product / Company / Resources / Legal), then a newsletter signup
> (TextField + Button) on the right. Bottom row: copyright + social
> icons (lucide `twitter`, `github`, `linkedin`, `youtube`) + theme
> toggle Switch (light/dark).
>
> ### Responsive rules to obey
> - Mobile: single column, sections stack, nav collapses to Drawer,
>   hero visual moves below CTAs, all grids → 1 column.
> - Tablet: 2-column grids where desktop has 3, nav still collapses,
>   hero stays 2-column at narrower split.
> - Desktop: full layout as described.
>
> ### Naming
> - Page-level frame: `landing-desktop`, `landing-tablet`, `landing-mobile`.
> - Section frames: `nav`, `hero`, `logo-bar`, `feature-triad`,
>   `how-it-works`, `bento`, `testimonials`, `pricing`, `faq`, `cta-banner`,
>   `footer`.

## Execution

```bash
pencil --out design/templates/landing.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Landing pages are typically the highest-leverage SEO surface — they
catch organic search traffic and ad-driven traffic alike, and AI
search engines cite them heavily for product-relevant questions.
The design must support both targets.

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` per page; the H1 must
contain the `primaryKeyword` (or close variant). Section frames
become `<h2>`; sub-sections within a section become `<h3>`. No
heading level skips. The hero's display headline maps to H1; the
nav `Sign in` / `Get started` links don't promote to headings.

**Primary keyword placement** — `primaryKeyword` must appear in:
- The H1 (hero display headline)
- The first 100 words of body content (hero subhead is ideal)
- The page title slot (page-frame metadata)
- The meta description slot (page-frame metadata)

**Meta description slot** — write a hero-subhead-derived meta
description into the page-frame metadata (`design/templates/
landing.pen` page frame). Length per `metaDescriptionLength`
(default 150-160 chars). Front-load with primary keyword.

**Structured data emission points** — design must include the
content that supports each schema in `archetypeTargets.structuredData`:
- `Organization` (site-wide; site footer or header is enough)
- `Product` — feature-list section provides product info
- `FAQ` — when `faq-schema` is in `aioPatterns`, the FAQ
  accordion (section #9 in default layout) provides the data
- `BreadcrumbList` — typically not needed for top-level landing
- `Article` — when the landing leans editorial / thought-
  leadership

The build-components command emits JSON-LD reading the design's
content at these slots. Design-side requirement is *content
presence*, not JSON-LD authoring.

**AIO patterns** — when `archetypeTargets.aioPatterns` includes:

- `faq-schema` — FAQ section is **required** in the design
  (section #9 in default layout); 5-7 questions minimum;
  questions are real questions users ask (not "Why is X great?"
  marketing-question phrasing)
- `comparison-table` — when the page has a "vs competitors" or
  "feature comparison" section, render as an actual `<table>`,
  not a row of cards. Tables are AIO-citation-friendly; cards
  are decoration.
- `definitive-headings` — section H2s phrased as definitive
  statements ("Save searches in seconds" not "About saved
  searches")
- `factual-density` — feature descriptions include specific facts
  ("Save up to 200 filters per workspace") not vague claims
  ("Powerful filtering")
- `citation-ready` — feature lists structured as bullets or
  numbered lists where applicable

**Internal linking** — minimum `archetypeTargets.internalLinksMin`
internal links (default 3 for landing pages). Footer link columns
provide bulk; in-content links to features/docs/pricing add
value.

**Image alt text** — every `<Image>` element in the design
includes alt text in its metadata. The hero product mock, customer
logos, feature icons, and any decorative imagery all get alt text.
Decorative-only images can have `alt=""` (empty alt text)
explicitly — but the metadata field must be present.

When `.pencil-seo.json` is missing, apply baseline correctness:
single H1, sequential heading cascade, alt text on all images.
Surface a note in the report.



Screenshot all three viewport frames. Spot-check: nav collapses on mobile,
hero CTAs stack on mobile, pricing cards reflow correctly, footer columns
collapse to accordion-style stack on mobile.

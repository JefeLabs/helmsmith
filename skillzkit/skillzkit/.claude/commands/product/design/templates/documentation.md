---
description: Generate the documentation template — three-pane layout with section nav tree (left), content (center), and table of contents (right). Covers technical docs, API references, and developer-facing content. Highly relevant for npm package documentation.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/documentation.pen` — the documentation
shell with the canonical three-pane layout. This is the standard
modern docs pattern (Stripe, Tailwind, Next.js, Vercel — all use
variations of this).

Particularly relevant for npm package documentation — published
libraries, internal SDK references, and any developer-facing
documentation site benefit from this layout.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["documentation"]`.
   Documentation is one of the **highest-leverage AIO surfaces** —
   AI search engines cite documentation extensively when answering
   technical questions. See SEO + AIO contract section below.

## Embedded prompt

> Build a Pencil page named **`Templates / Documentation`** for
> **{{brand}}**. Render at the canonical 3 breakpoints.
>
> ### Layout (three panes)
>
> Composition (desktop):
> - **Top header** (60px): brand mark + global search + GitHub link
>   + theme toggle + version selector
> - **Left nav tree** (280px wide): hierarchical section navigation
> - **Main content** (flexible width, max 720px): the actual docs
> - **Right TOC** (240px wide): in-page table of contents anchored
>   to current page's headings
>
> Total max width: 1440. Content area centered with the three panes.
>
> ### Top header
>
> - Brand lockup + product/package name
> - **Search input** (center, prominent): cmd-K hint, opens
>   command-palette-style search overlay
> - **Version selector** (when applicable): "v2.x" dropdown
> - **GitHub link** (icon button)
> - **Theme toggle** (light / dark / system)
> - On scroll: shrinks slightly, becomes sticky
>
> ### Left nav tree
>
> Hierarchical section list:
>
> ```
> Getting started
>   Introduction
>   Installation
>   Quick start
>   Configuration
>
> Core concepts
>   Architecture
>   Lifecycle
>   Data flow
>
> Guides
>   Authentication
>   Deployment
>   Migration
>
> API reference
>   Functions
>   Components
>   Hooks
>   Types
>
> Resources
>   Changelog
>   Migration guides
>   Examples
>   Community
> ```
>
> Each top-level section is collapsible. Active page highlighted
> with `--color-accent-100` background + `--color-accent-700` text.
> Parent sections of active page expanded by default.
>
> Sticky on scroll, independent scroll from main content.
>
> ### Main content area
>
> Long-form content with proper typographic hierarchy:
> - Page title (h1, display-lg or display-md)
> - Optional subtitle / lead paragraph (body-lg, `--color-content-2`)
> - Section headings (h2, h3, h4) with anchor link icons
>   (visible on heading hover)
> - Body text (body-md, generous line-height ~1.7)
> - **Code blocks**: `--color-surface-raised` background,
>   monospace font, language label top-right, copy button
> - **Inline code**: subtle background highlight
> - **Callouts** / admonitions: bordered boxes with icon for
>   "Note", "Tip", "Warning", "Important", "Deprecated"
> - **Tables**: standard data-display Table component
> - **Images**: rounded corners, `--color-separator` border for
>   screenshots
> - **Footer-of-page actions**: "Was this helpful?" with thumbs
>   up/down + "Edit on GitHub" link + previous/next page nav
>
> ### Right TOC (in-page contents)
>
> Sticky panel listing the current page's h2 and h3 headings:
> - "On this page" header (uppercase tracking)
> - List of headings as anchor links
> - Active heading highlighted as user scrolls (intersection
>   observer driven)
> - h3 indented under h2 parents
>
> Hidden on tablet/mobile.
>
> ### Section 5 — Per-content-type reference
>
> Reference cards showing how different docs page types compose:
>
> **API reference page**:
> - Heading: function/component name
> - Code signature block at top
> - Parameters table
> - Returns section
> - Examples section (multiple code blocks with descriptions)
> - "See also" related-link list at bottom
>
> **Guide page**:
> - Heading + lead paragraph
> - Step-by-step content with numbered headings
> - Inline code, callouts, screenshots
> - "What's next" footer with related guide links
>
> **Concept page**:
> - Heading + lead paragraph
> - Diagram / illustration
> - Sectioned explanation
> - Code examples for clarity
> - Cross-references to related concepts and guides
>
> **Changelog page**:
> - Reverse-chronological version entries
> - Each entry: version + date + breaking/added/changed/fixed
>   sections
> - Migration links for breaking changes
>
> ### Section 6 — Search overlay
>
> A modal-style overlay that opens on cmd-K or search input click:
> - Centered card (max-width 640)
> - Search input at top with placeholder
> - Results list below: organized by type (guides / api / examples)
> - Each result: type badge + title + matched-snippet
> - Keyboard navigation: arrow keys move selection, Enter opens
> - Recent searches when input empty
>
> Library: Algolia DocSearch, FlexSearch, or custom — annotate
> recommended choice per scale.
>
> ### Section 7 — Code-block variants
>
> Reference card showing canonical code-block patterns:
>
> - **Single-language**: standard block with language label
> - **Multi-language tabs**: tabs for the same example in
>   different languages (e.g. JS / TS / Python)
> - **Inline diff**: + and - lines highlighted with red/green
>   subtle backgrounds
> - **Filename header**: small filename strip above the block
>   ("app/page.tsx")
> - **Copy button**: top-right, icon-only, becomes "Copied" on click
>
> ### Section 8 — Mobile / tablet behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): three-pane layout as described
> - Tablet (768): nav tree collapses to drawer (toggle in header),
>   right TOC hidden, main content full-width
> - Mobile (390): nav tree as off-canvas drawer, right TOC hidden,
>   main content full-width with reduced padding, top-of-page
>   "On this page" collapsible accordion replacing right TOC
>
> ### Naming
> - Frame names: `documentation-{{breakpoint}}` (main shell)
> - Per-content-type frames: `docs-{{type}}` (`-api`, `-guide`,
>   `-concept`, `-changelog`)
> - Reference frames: `search-overlay`, `code-block-variants`

## Execution

```bash
pencil --out design/templates/documentation.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Documentation is the AIO-heaviest archetype. AI search engines
cite documentation pages aggressively when answering technical
questions because docs are factually dense, definitively phrased,
and citation-ready by nature. This is the surface where AIO
investment compounds most.

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` per page (the doc
title). Each major section is `<h2>`; subsections `<h3>`; sub-
subsections `<h4>`. Documentation has the most heading depth of
any archetype; cascade discipline matters more here. The right-
pane TOC reads from H2 + H3 only (H4+ are in-section detail).

**Primary keyword placement** — for each doc page in the cluster,
its `primaryKeyword` (the topic — e.g. "saved searches API",
"webhook configuration") must appear in:
- The H1 (doc title)
- The first 100 words of body content
- The page title slot
- Section H2s where naturally relevant

**Meta description** — concrete summary of what the page
documents. "Reference for the saved-searches API including
endpoints, request/response formats, and rate limits."
`metaDescriptionLength` from archetype targets (default 150-160).

**Structured data emission points** — design must support each
schema in `archetypeTargets.structuredData`:
- `Article` — site-wide for doc pages; carries author, datePublished,
  dateModified
- `HowTo` — when the doc is a step-by-step procedure (numbered
  steps); the step content provides the structured-data
- `Q&A` — Q&A patterns in doc pages (when the page is structured
  as questions and answers)
- `BreadcrumbList` — required on all doc pages (Home > Docs >
  Section > Page); the left-nav-tree provides the breadcrumb data
- `Organization` — site-wide

**AIO patterns** — documentation typically gets the heaviest AIO
treatment:

- `structured-qa` — when applicable, structure content as
  question-answer pairs. "What does saved-searches API do?
  ... [answer]" outperforms narrative prose for AI citation.
- `explicit-definitions` — every technical term is defined inline
  on first use. "A *saved search* is a reusable filter
  combination. ..." Define jargon, don't assume. AI search
  engines extract these definitions cleanly when explicit.
- `date-stamped-facts` — version-specific or time-sensitive facts
  carry dates. "As of v2.3 (March 2026), the saved-searches API
  supports nested filters." Without dates, AI search engines may
  cite outdated information.
- `numbered-lists` — procedures are numbered lists, not prose
  paragraphs. "1. Create the API key. 2. Configure the webhook.
  3. ..." The numbered structure is HowTo-schema-extractable.
- `factual-density` — documentation should be factually dense by
  nature; this just means resist narrative padding. Each sentence
  should carry a fact, definition, example, or relationship.
- `comparison-table` — when documenting alternatives or
  configurations, a table beats prose. "Compare deployment modes:"
  followed by a 4-column table outperforms three paragraphs.
- `citation-ready` — code examples, API tables, configuration
  options structured as tables or bullets where applicable.

**Internal linking** — documentation is high-link-density by
design. Minimum `internalLinksMin` (default 5 for docs); often
much higher in practice. Cross-references between related doc
pages strengthen topical authority and help users navigate.

**Code examples + tables** — first-class content. Code blocks
preserve formatting in the design; tables for parameters,
options, and return values use real `<table>` markup not
visual-only layouts.

**Image alt text** — diagrams and screenshots get descriptive
alt text. "Diagram showing API request flow: client → gateway →
authentication service → backend." Not "diagram.png".

**Cluster topology** — when `strategy.contentCluster.pillars`
includes documentation pillars, the design's left-nav-tree
reflects the topology. Pillar pages live at top-level; cluster
pages nest under their pillar.

When `.pencil-seo.json` is missing, apply baseline correctness:
single H1, full heading cascade, code blocks preserved, alt text.
Surface the note recommending `/product:strategy:seo`.



Screenshot the page. Confirm: three-pane layout rendered at
desktop, drawer-collapsing nav at tablet/mobile, 4 content-type
references (API, guide, concept, changelog), search overlay,
code-block variants reference.

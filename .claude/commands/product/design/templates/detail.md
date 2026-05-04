---
description: Generate the detail page template — entity record view with main content, sidebar metadata, action toolbar, and related-records section. Used for any "view one thing" page (customer record, project detail, ticket, article).
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/detail.pen` — the canonical record-view
template. This is the "view one of X" page that every product has:
customer record, project detail, ticket detail, blog post, etc.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `templates/dashboard.pen` for the app-shell chrome that
   wraps detail pages in authenticated contexts.
4. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["detail"]`.
   Detail pages bifurcate by context: public-facing detail pages
   (e.g. blog post, product item) are SEO-relevant; in-app detail
   pages (e.g. customer record, project detail) are SEO-neutral
   (behind auth). The contract below applies to public-facing
   detail; in-app detail uses baseline correctness only.

## Embedded prompt

> Build a Pencil page named **`Templates / Detail`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Layout
>
> Inside the dashboard chrome, the detail page composition:
>
> Composition (desktop):
> - **Page header bar** (top of content area): breadcrumbs +
>   record title + status badge + action toolbar (right-aligned)
> - **Main content area**: 65–70% width, scrollable body content
> - **Sidebar** (right, 30–35% width): metadata, related items,
>   activity feed
>
> Total max width: same as parent dashboard content area.
>
> ### Page header
>
> - Breadcrumbs: "Records › Customers › Acme Corp"
> - Title row: record name (h1, display-md) + status badge + (when
>   editable) inline-edit pencil icon
> - Subtitle / metadata: small body-sm row below title showing
>   creation date, owner, last-updated timestamp
> - **Action toolbar** (right side):
>   - Primary action button (e.g., "Edit", "Send", "Archive")
>   - Secondary actions: 1–2 outline buttons
>   - Overflow menu (3-dot icon): less-common actions
>
> ### Main content area
>
> Composition varies by entity type, but common sections:
>
> - **Description / body**: long-form content (rich text)
> - **Key fields card**: 4–8 critical attributes in a 2-column
>   grid
> - **Sub-section tabs**: tabs for related views ("Overview",
>   "Activity", "Files", "Comments")
> - **Section content per tab**:
>   - Overview: summary + key metrics
>   - Activity: chronological event feed
>   - Files: file list / grid
>   - Comments: threaded comments with reply
>
> ### Sidebar
>
> Sticky panel (scrolls with content but stays visible at top):
>
> - **Status panel**: current status, owner, key dates, priority
> - **Quick actions**: 3–5 inline buttons for common operations
> - **Related records**: list of linked entities
> - **Tags**: chip group with add/remove
> - **Custom fields**: workspace-specific attributes
>
> ### Section 4 — Per-entity-type rendering examples
>
> Render the detail template specialized for 4 common entity types:
>
> **Customer record (B2B SaaS / CRM)**:
> - Header: company name + plan badge + ARR
> - Main: company info card + activity timeline + contacts table
> - Sidebar: account owner, plan + billing, integrations connected
>
> **Project / task detail (project mgmt)**:
> - Header: project name + status (Active / On hold / Done)
> - Main: description + tasks list (sub-table) + milestones
> - Sidebar: dates, owner, members, tags
>
> **Article / content detail (CMS)**:
> - Header: title + draft/published status + publication date
> - Main: cover image + body content + author bio
> - Sidebar: SEO metadata, categories, related articles
>
> **Ticket detail (support)**:
> - Header: ticket # + status + priority
> - Main: original message + threaded conversation + internal notes
> - Sidebar: requester info, assignee, SLA timer, related tickets
>
> ### Section 5 — Empty / loading / error states
>
> Reference each state per `patterns/states.pen`:
>
> - **Loading**: full skeleton (header + main + sidebar) with
>   appropriate placeholder shapes
> - **Error**: section-error variant — record failed to load, retry
>   CTA, doesn't disrupt the chrome
> - **Not found**: redirects to error template (404 page)
> - **Permission denied**: page-level error with "Request access"
>   CTA
>
> ### Section 6 — Inline editing patterns
>
> A reference card showing detail-page inline-edit patterns:
>
> | Pattern              | When to use                                |
> | -------------------- | ------------------------------------------ |
> | **Click-to-edit**    | Single-field updates (title, status)       |
> | **Edit drawer**      | Multi-field forms (full record edit)       |
> | **Inline form mode** | Toggle entire detail page into editable form |
> | **Tag chip add**     | Lists where users append (tags, members)   |
>
> ### Section 7 — Action toolbar reference
>
> Patterns for right-side action toolbar:
>
> - **Primary action only** (1 button + overflow): simplest case
> - **Primary + 1 secondary** (2 buttons + overflow): common
> - **Primary + 2 secondary**: max before becoming overwhelming;
>   move tertiary actions into overflow menu
> - **Status-driven actions**: actions change based on record state
>   (e.g., "Send" → "Resend" after sent)
>
> ### Section 8 — Responsive behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): main + sidebar side by side
> - Tablet (768): main + sidebar stack vertically (sidebar below
>   main, becomes a "Details" section)
> - Mobile (390): same as tablet but sidebar collapses to a
>   bottom-sheet drawer triggered by a "Details" button in the
>   header
>
> ### Naming
> - Frame names: `detail-{{entity-type}}-{{breakpoint}}`
> - Reference frames: `inline-edit-patterns`, `action-toolbar-patterns`

## Execution

```bash
pencil --out design/templates/detail.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Detail pages cover two contexts with different SEO profiles:

- **Public-facing detail** (blog post, marketplace item, public
  profile, knowledge-base article) — SEO + AIO matter; the
  contract below applies in full
- **In-app detail** (customer record, project detail, ticket
  detail in authenticated app) — SEO-neutral (behind auth);
  baseline correctness only (single H1, alt text, semantic
  structure for accessibility)

The variant determines which mode applies. When the design
generates both contexts in one `.pen` file, the public-facing
frame applies the full contract; the in-app frame applies
baseline only.

### Public-facing detail contract

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` (the item's name or
title). The H1 must be highly specific to the item ("How saved
searches work in {{brand}}" not "Article"). Sidebar metadata
items are not headings (`<dt>`/`<dd>` or list items). Section
headings within the body are `<h2>`; sub-sections `<h3>`. The
related-records section's "Related" or "You might also like"
header is `<h2>`.

**Primary keyword placement** — item-specific keyword in:
- The H1 (item name)
- The first 100 words of body content
- The page title
- The meta description
- The URL slug (when configurable)

**Meta description** — item-specific summary. For a blog post,
the post's lede paragraph; for a product item, the item's primary
description. Length per `metaDescriptionLength`.

**Structured data emission points** — varies by detail subtype:

For **blog post detail**:
- `Article` (or `BlogPosting` for blog-specific) — author, date
  published, date modified, headline, image
- `Person` — author byline
- `BreadcrumbList` — Home > Blog > Category > Post
- `Organization` — site-wide

For **product / item detail** (e.g. e-commerce, marketplace):
- `Product` — name, description, image, brand, sku
- `Offer` — price, availability, url
- `AggregateRating` — when item has reviews
- `Review` — individual reviews when displayed
- `BreadcrumbList`

For **knowledge-base / docs-style detail** (overlaps with
documentation archetype):
- `Article` + `HowTo` (when applicable)
- `Q&A` when content is question-answer structured

The design must include the content that supports the structured
data — author byline + dates for blog; price + availability
indicator for product item; review section when AggregateRating
applies.

**AIO patterns** — varies by subtype:

- `definitive-headings` — H1 and H2s as definitive statements
- `factual-density` — for product items, specific facts
  (dimensions, materials, compatibility); for blog posts,
  specific claims with sources
- `date-stamped-facts` — date prominently displayed; "as of"
  qualifiers when claims are time-bound
- `comparison-table` — when the detail page compares the item to
  alternatives (common in product reviews, feature comparisons)
- `citation-ready` — structured content (bullet specs, tables for
  comparisons, numbered steps for how-tos)
- `explicit-definitions` — when technical terms appear, define
  inline

**Internal linking** — related-records section provides bulk
internal linking. Minimum `internalLinksMin`. Cross-link to
parent category page, related items, and (for blog) author's
other posts.

**Image alt text** — required for hero image, all body images,
related-record thumbnails, author avatar. For product items, alt
text describes the item specifically; for blog post images,
alt text describes the depicted content.

**Sidebar metadata** — sidebar items (publish date, author,
category, tags, etc.) use semantic markup (`<dl>`/`<dt>`/`<dd>`
or appropriate list elements). The metadata is machine-readable,
not just visually present.

### In-app detail (behind auth)

For in-app detail pages (customer record, project detail in
authenticated app), apply only baseline correctness:

- One H1 (the record's identifier or name)
- Heading cascade without skips
- Alt text on images
- Semantic structure for screen readers

Skip the SEO-specific patterns (these pages aren't crawled).
ARIA and accessibility correctness still apply (and matter
substantially for in-app detail used by screen-reader users).

When `.pencil-seo.json` is missing for public-facing detail,
apply baseline correctness + structured-data-aware design (so
upgrading to a strategy later doesn't require redesign).
Surface the recommendation.



Screenshot the page. Confirm: 4 entity-type rendering examples
(customer, project, article, ticket) all rendered at desktop;
canonical 3 breakpoints rendered for the customer variant; reference
cards for inline edit + action toolbar present.

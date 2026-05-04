---
description: Build phase reference — SEO + AIO HTML emission for page-level builds in /core:frameworks:heroui:build-components. Covers semantic HTML emission, heading hierarchy preservation, meta tag emission, JSON-LD structured data (Organization, Article, FAQPage, Product, BreadcrumbList, HowTo), AIO patterns, image alt text, link semantics, llms.txt + robots.txt generation, and the post-emission verification step. Loaded by the orchestrator only when --depth pages produces page files; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — SEO + AIO HTML emission

For page-level builds, the design's content shape produced by
`product/design/templates/*` is the source of truth. This phase
translates the design into SEO-correct HTML — semantic tags,
JSON-LD structured data, meta tags, ARIA attributes — reading
both the design (for content) and `.pencil-seo.json` (for strategy).

When `archetypeTargets` is resolved in pre-flight step 8, apply
the rules below during page emission. When the strategy is
missing, emit baseline-correct HTML only.

## Semantic HTML emission

Even without a strategy, page builds emit semantic HTML by default:

- **`<header>`** for the page header / nav bar. The design's nav
  frame becomes `<header><nav>...</nav></header>`.
- **`<main>`** wrapping the page's primary content (everything
  between header and footer). Exactly one `<main>` per page.
- **`<article>`** when the design's main content is article-shaped
  (blog post, single-record detail page, documentation page).
  Optional otherwise.
- **`<section>`** for major content divisions (each section frame
  in the design becomes a `<section>`).
- **`<aside>`** for sidebars, related-content rails, in-page TOC
  panels.
- **`<footer>`** for the page footer.
- **`<nav>`** for any navigation cluster (top nav, breadcrumbs,
  side nav, footer link columns).

Avoid `<div>` for any content with semantic meaning. Reserve
`<div>` for layout-only wrappers. The design's frame names
(`hero`, `feature-triad`, `footer`, etc.) hint at the right
semantic tag — most "section frames" map cleanly to `<section>`.

## Heading hierarchy preservation

The design's heading content (from typography matching at Step 1.5)
maps to HTML heading tags by typography level:

- `display-2xl`, `display-xl`, `display-lg` → `<h1>` (typically
  one per page; the design's hero display headline)
- `display-md`, `display-sm`, `h1` → `<h1>` or `<h2>` depending
  on document structure
- `h2` → `<h2>`
- `h3` → `<h3>`
- ...continuing down

The build verifies:

- **Exactly one `<h1>`** per page emission. When the design has
  multiple display-2xl frames, the build picks the first or asks.
- **Sequential cascade**: H1 → H2 → H3 without skips. When the
  design has a level skip (display-2xl frame followed by an h3
  frame with no h2 between), the build either promotes the h3
  to h2 emission or surfaces a warning.
- **Heading content matches design content** verbatim when
  reasonable; when the design's text is "TITLE" placeholder, the
  build uses the page-frame metadata's `headingPrimary` value or
  warns.

## Meta tag emission

For each page in the build, emit `<head>` content from:

- **`<title>`** — read from page-frame metadata `pageTitle` field;
  fall back to the page's H1 content; warn if both are missing
- **`<meta name="description">`** — read from page-frame metadata
  `metaDescription` field; verify length matches archetype's
  `metaDescriptionLength` (warn if outside range)
- **`<meta name="viewport">`** — universal:
  `width=device-width, initial-scale=1`
- **`<link rel="canonical">`** — when strategy's
  `technical.canonicalUrlsPolicy` is `explicit-everywhere`, emit
  for every page. The canonical URL composes from
  brand JSON's site URL + the page's path.
- **Open Graph tags** (`og:title`, `og:description`, `og:image`,
  `og:url`) — emit for any public-facing page; values mirror
  title/description with `og:image` reading from the design's
  hero image
- **Twitter Card tags** (`twitter:card`, `twitter:title`,
  `twitter:description`, `twitter:image`) — emit alongside
  Open Graph; `twitter:card` is `summary_large_image` for pages
  with hero imagery

## JSON-LD structured data emission

For each page, emit `<script type="application/ld+json">` blocks
per `archetypeTargets.structuredData`. The build reads design
content and brand JSON to populate each schema:

**`Organization`** (site-wide; emitted on every page):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "{{brand.name}}",
  "url": "{{brand.siteUrl}}",
  "logo": "{{brand.siteUrl}}{{brand.logo.darkPath}}",
  "sameAs": [{{brand.socialProfiles}}]
}
</script>
```

**`Article`** (on article-shaped pages):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{page.h1}}",
  "datePublished": "{{page.metadata.datePublished}}",
  "dateModified": "{{page.metadata.dateModified}}",
  "author": { "@type": "Person", "name": "{{page.metadata.author}}" },
  "publisher": { "@type": "Organization", "name": "{{brand.name}}" },
  "image": "{{page.heroImageUrl}}"
}
</script>
```

**`FAQPage`** (when `aioPatterns` includes `faq-schema` and the
design has a FAQ section):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{{question text from design accordion item}}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{{answer text from design accordion content}}"
      }
    }
    // ... one per FAQ item
  ]
}
</script>
```

**`Product` + `Offer`** (on pricing pages and product detail
pages):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "{{product name from design}}",
  "description": "{{product description from design}}",
  "brand": { "@type": "Brand", "name": "{{brand.name}}" },
  "offers": {
    "@type": "Offer",
    "price": "{{tier price from design}}",
    "priceCurrency": "{{currency from design or brand}}",
    "url": "{{page url}}",
    "availability": "https://schema.org/InStock"
  }
}
</script>
```

**`BreadcrumbList`** (on nested pages with breadcrumb navigation
in the design):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "/" },
    { "@type": "ListItem", "position": 2, "name": "Docs", "item": "/docs" },
    { "@type": "ListItem", "position": 3, "name": "{{current page name}}" }
  ]
}
</script>
```

**`HowTo`** (when documentation has step-by-step content):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "{{procedure name from H1}}",
  "step": [
    { "@type": "HowToStep", "name": "{{step 1 heading}}", "text": "{{step 1 content}}" }
    // ... one per numbered step
  ]
}
</script>
```

When the design lacks the content needed for a declared schema
(e.g. archetype declares `Product` but the page has no price
data), surface a warning at build time and skip the schema rather
than emit malformed JSON-LD.

## AIO pattern emission

Per `archetypeTargets.aioPatterns`, the HTML emission applies
specific structures:

- **`faq-schema`** — FAQ accordion in design becomes `<dl>`/`<dt>`/
  `<dd>` semantically (or `<details>`/`<summary>` for native
  toggle behavior) plus the FAQPage JSON-LD above. Both
  semantic markup AND structured data; either alone is weaker.
- **`comparison-table`** — design's comparison content becomes
  real `<table>` with `<thead>`, `<tbody>`, `<th scope="col">`
  for column headers, `<th scope="row">` for row headers when
  applicable. Not `<div>` grids styled to look like tables.
- **`numbered-lists`** — procedural content becomes `<ol>`, not
  styled-`<ul>` or styled-`<div>` sequences.
- **`explicit-definitions`** — definition patterns become
  `<dl>`/`<dt>`/`<dd>` semantic markup. Inline definitions can
  use `<dfn>` for the term being defined.
- **`structured-qa`** — Q&A patterns use `<dl>` (questions in
  `<dt>`, answers in `<dd>`) plus FAQPage JSON-LD when at the
  page level.
- **`citation-ready`** — applies broadly; the build emits
  semantic structure (lists, tables, definitions) wherever
  the design has content that fits these structures.

## Image alt text emission

Every `<img>` tag emits with an `alt` attribute. The value
sources from (in order of preference):

1. The image element's `alt` metadata field in the design
2. The image element's caption text in the design
3. The image element's filename (last resort; surface warning)

Decorative images use `alt=""` (empty) explicitly when the design
flags them as decorative. Never omit the `alt` attribute entirely.

For images that are also linkable (logos linking to home, etc.),
the alt text describes the link destination, not the image
visual ("{{brand.name}} home" not "logo image").

## Link semantics

Internal links (same-domain) use the React framework's `<Link>`
component (Next.js, Remix, etc.) for client-side navigation. The
build resolves which framework's Link based on `package.json`.

External links emit with `rel="noopener noreferrer"` and `target="_blank"`
when the design indicates external. `rel="nofollow"` for
sponsored/UGC links when applicable.

## llms.txt + robots.txt generation

When `strategy.technical.llmsTxt.enabled` is true, the build
generates `public/llms.txt` (or framework-equivalent path) with
content like:

```
# {{brand.name}}
# {{strategy.technical.llmsTxt.summary}}

# Allowed
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

# Preferred entry points
- {{strategy.technical.llmsTxt.preferredEntryPoints[0]}}
- ...
```

Similarly, `public/robots.txt` generation reflects strategy
intent — allowed/blocked bots, sitemap reference, crawl-delay
when set.

These are static files generated at build time; they don't update
on each page build but on strategy change.

## Verification step

After page emission, verify:

- Exactly one `<h1>` per page
- Heading cascade has no level skips
- Every `<img>` has an `alt` attribute
- Required JSON-LD schemas per archetype emitted (warn on missing)
- Meta tags present (title, description, viewport, canonical
  when applicable)
- `<head>` is well-formed (no duplicate canonical, no conflicting
  Open Graph)

Emit a per-page SEO summary alongside the build report:

```
Page: src/app/features/saved-searches/page.tsx (landing-page archetype)
  ✓ One <h1>: "Save searches in seconds"
  ✓ Heading cascade: H1 → H2 (×4) → H3 (×6)
  ✓ Alt text: 8/8 images
  ✓ Meta description: 154 chars (target 150-160)
  ✓ Structured data: Organization, Product, FAQPage, BreadcrumbList
  ✓ AIO patterns applied: faq-schema, definitive-headings, comparison-table
  ⓘ Internal links: 4 (target ≥ 3)
```

Failures are warnings, not build-blocks (unless `--strict-seo`
flag is passed). The audit's Plane 9 catches drift over time;
this verification catches issues at emission time.
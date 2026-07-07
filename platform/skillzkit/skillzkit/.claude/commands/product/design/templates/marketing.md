---
description: Generate the consolidated marketing template — about, features, blog index, blog post, careers, contact pages all in one .pen with consistent marketing chrome (header nav + footer) and shared composition rules.
argument-hint: [--variants about,features,blog-index,blog-post,careers,contact] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/marketing.pen` — six marketing-page
templates in one file, sharing the marketing chrome (top nav +
footer) but specializing the content. These pages follow the same
patterns: hero + content sections + footer.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read patterns from `patterns/`: hero, feature-grid, testimonial,
   stat-section, footer, cta. All compose into these templates.
4. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["marketing"]`.
   Marketing pages are brand-led; SEO discipline is moderate
   (lighter than landing-page or documentation, but presence
   matters for organic discovery). See SEO + AIO contract below.

## Embedded prompt

> Build a Pencil page named **`Templates / Marketing`** for
> **{{brand}}**. Render at the canonical 3 breakpoints.
>
> ### Shared chrome (all variants)
>
> All marketing pages use the same chrome:
> - **Top nav** (sticky): brand mark + nav links (Product, Pricing,
>   About, Resources, Blog) + auth links (Sign in / Get started)
> - **Footer**: marketing footer pattern (`patterns/footer.pen`)
>
> ### Variant 1 — About page
>
> Composition:
> 1. **Hero (centered)**: "We're building [vision]" + brief mission
>    statement + team photo or illustration
> 2. **Mission section**: detailed mission (2–3 paragraphs)
> 3. **Values section**: 3–6 values as feature-grid pattern (icon +
>    title + description per value)
> 4. **Stats section** (compose `patterns/stat-section.pen` multi-row):
>    company stats (founded, team size, customers served, etc.)
> 5. **Team section**: 4–12 team members in a grid (avatar + name
>    + role + bio link). For K-12: leadership only, not full team
>    (privacy)
> 6. **Investors / partners**: logo wall (uses
>    `patterns/testimonial.pen` logo-wall variant)
> 7. **CTA**: mid-page CTA inviting careers / contact
>
> ### Variant 2 — Features page
>
> Composition:
> 1. **Hero**: "Everything you need to [outcome]" + brief subhead
> 2. **Featured capability**: large split-with-screenshot section
>    showing the marquee feature
> 3. **Feature grid**: compose `patterns/feature-grid.pen` 3×2 or
>    bento variant covering 6–9 secondary capabilities
> 4. **Comparison section** (optional): "vs. building it yourself"
>    or "vs. legacy alternative"
> 5. **Testimonial**: compose `patterns/testimonial.pen` single-
>    spotlight with feature-relevant customer quote
> 6. **CTA**: large mid-page CTA
> 7. **FAQ** (optional): feature-relevant FAQ accordion
>
> ### Variant 3 — Blog index
>
> Composition:
> 1. **Hero (compact)**: "Blog" / "Resources" heading + brief
>    description + search input
> 2. **Featured post**: large card with cover image + title + excerpt
>    + author + date + read time
> 3. **Recent posts grid**: 3-column grid of post cards (cover +
>    title + excerpt + author + date)
> 4. **Category filter chips**: tags like "Engineering", "Product",
>    "Customer stories" — clicking filters the grid
> 5. **Pagination**: numbered or load-more
> 6. **Newsletter CTA** (sidebar or footer): "Get our weekly
>    newsletter" + email input
>
> ### Variant 4 — Blog post
>
> Composition:
> 1. **Header**: post title (display-lg) + author bio + publication
>    date + read time + tags
> 2. **Cover image** (full-width or constrained, optional)
> 3. **Body content**:
>    - Long-form prose (max content width 720px, body-lg, generous
>      line-height)
>    - Section headings (h2, h3) with anchor link icons
>    - Pull quotes / callouts
>    - Code blocks (if technical content)
>    - Images with captions
>    - Inline links styled distinctively
> 4. **Author bio card** (end of post): photo + bio + social links
> 5. **Related posts**: 3-card grid
> 6. **Comments section** (optional): if product allows comments
> 7. **Newsletter / CTA**: contextual
>
> ### Variant 5 — Careers page
>
> Composition:
> 1. **Hero**: "Join us" + mission tie-in
> 2. **Why work here**: 4–6 reasons in feature-grid format
> 3. **Benefits section**: list of benefits (health, equity, time
>    off, learning budget, etc.) in 2–3 column grid
> 4. **Open positions**:
>    - Filter by department / location / type
>    - Job listing cards: title + department + location + type
>    - Each card click navigates to job detail
> 5. **Empty state**: "No open positions right now" with "Email
>    us your resume anyway" link
> 6. **Culture section** (optional): photos / stories
> 7. **CTA**: "We're always looking for great people"
>
> ### Variant 6 — Contact page
>
> Composition:
> 1. **Hero (compact)**: "Get in touch" + brief subhead
> 2. **Contact options grid**:
>    - **Sales**: contact form + book a demo link
>    - **Support**: link to help center + status page
>    - **Press**: email + media kit
>    - **General**: contact form
> 3. **Office locations** (if applicable): map + addresses
> 4. **FAQ** (optional): "Should I contact sales or support?" type
>    questions
>
> ### Section 7 — Marketing chrome reference
>
> A reference card for the consistent marketing chrome:
>
> **Top nav**:
> - Sticky on scroll (background becomes opaque after small scroll)
> - Mobile: hamburger toggle reveals off-canvas drawer with full nav
> - Active page link highlighted
>
> **Footer**:
> - Always uses `patterns/footer.pen` marketing variant
> - Newsletter signup row
> - Social icons + copyright + secondary legal links
>
> ### Section 8 — Responsive behavior
>
> A canonical-3-breakpoint render of one variant (Features) showing
> all sections collapsing predictably:
>
> - Desktop (1440): full-width hero, multi-column feature grid,
>   side-by-side comparison
> - Tablet (768): hero scales, feature grid 2-col, comparison stacks
> - Mobile (390): single-column throughout, feature grid 1-col,
>   nav becomes hamburger drawer
>
> ### Naming
> - Frame names: `marketing-{{variant}}-{{breakpoint}}`
>   (e.g. `marketing-about-desktop`, `marketing-blog-post-mobile`)
> - Chrome references: `marketing-top-nav`, `marketing-footer`

## Execution

```bash
pencil --out design/templates/marketing.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Marketing pages span six variants (about, features, blog index,
blog post, careers, contact). Each has slightly different SEO/AIO
profile, but the chrome (top nav + footer) is shared. The
contract below applies to all variants with variant-specific
adjustments noted.

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` per page. Page-specific:
- `about`: H1 = "About {{brand}}" or company-positioning headline
- `features`: H1 = feature-category-led headline
- `blog-index`: H1 = "Blog" or content-hub-positioning
- `blog-post`: H1 = the post title (concrete, specific)
- `careers`: H1 = "Careers at {{brand}}" or hiring-positioning
- `contact`: H1 = "Contact {{brand}}" or "Get in touch"

Section frames become `<h2>`; sub-sections `<h3>`.

**Primary keyword placement** — varies by variant:
- `about`: branded keywords ("{{brand}} company", "{{brand}}
  team") plus positioning keywords
- `features`: feature-category-led keywords
- `blog-index`: content-cluster keywords (when blog supports a
  cluster)
- `blog-post`: post-specific primary keyword in title + first 100
  words
- `careers`: "careers at {{brand}}" + role-category keywords
- `contact`: minimal SEO emphasis (navigational intent dominant)

**Meta description** — variant-specific:
- `about`: company positioning summary
- `features`: feature-led benefit summary
- `blog-index`: hub description
- `blog-post`: post-specific summary (the SEO-critical one for
  organic content discovery)
- `careers`: "Open roles at {{brand}}..." with role categories
- `contact`: "Get in touch with {{brand}}..."

**Structured data emission points** — design must support each
schema in `archetypeTargets.structuredData`:
- `Organization` — site-wide; about page provides extended data
  (founders, address, social profiles, logo)
- `Article` — blog posts and editorial about content; carries
  author, datePublished, dateModified
- `Person` — author bylines on blog posts; team profiles on
  about page
- `JobPosting` — careers page roles (high-leverage for
  Google for Jobs visibility)
- `LocalBusiness` — contact page when applicable (physical
  location)
- `BreadcrumbList` — blog posts especially (Home > Blog >
  Category > Post)

**AIO patterns** — moderate emphasis:
- `faq-schema` — FAQ section on pages where it fits (features
  pages especially); not required on all variants
- `definitive-headings` — applies to features and blog-post H2s
- `factual-density` — varies by variant; high for features and
  blog-post, low for about and contact
- `date-stamped-facts` — required for blog posts (datePublished
  + dateModified prominent in the design)
- `citation-ready` — blog posts especially benefit; structure
  with bullets/lists/tables where applicable

**Internal linking** — moderate; minimum `internalLinksMin`
(default 3). Blog posts link to related posts; features pages
cross-link to detail pages and pricing; about links to careers
and team profiles.

**Image alt text** — required throughout. Team photos, feature
screenshots, blog post hero images, office photos all carry
alt text.

**Author bylines on blog posts** — when the blog-post variant is
generated, design must include author byline (name + role +
optional avatar) and publish date prominently. The Person + Article
schemas read from this.

When `.pencil-seo.json` is missing, apply baseline correctness.



Screenshot the page. Confirm: all 6 variants rendered (about,
features, blog-index, blog-post, careers, contact), shared chrome
consistent across all, canonical 3 breakpoints rendered for the
features variant.

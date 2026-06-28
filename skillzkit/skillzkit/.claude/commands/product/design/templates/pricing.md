---
description: Generate the pricing template — full marketing pricing page composing the pricing-tier pattern with FAQ, comparison matrix, testimonials, and enterprise contact section.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/pricing.pen` — the canonical marketing
pricing page. Composes patterns from the patterns folder rather than
reinventing tier cards or FAQ accordions.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `patterns/pricing-tier.pen`, `patterns/faq.pen`,
   `patterns/testimonial.pen`, `patterns/cta.pen` (this template
   composes all four).
4. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["pricing"]`.
   Pricing pages benefit heavily from comparison-table AIO pattern
   and Product+Offer structured data. See SEO + AIO contract below.

## Embedded prompt

> Build a Pencil page named **`Templates / Pricing`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Section 1 — Hero (compact)
>
> A pricing-page hero, smaller than a marketing landing hero:
> - Heading: "Simple, transparent pricing" (or brand voice equivalent)
> - Subhead: 1-line value prop / commitment ("No hidden fees,
>   cancel anytime")
> - Billing-period toggle (monthly / annual) — references
>   `patterns/pricing-tier.pen` billing-toggle reference
> - Total height: ~280px
>
> ### Section 2 — Tier cards
>
> Compose `patterns/pricing-tier.pen` — render the 3-tier card
> layout with the brand's actual pricing structure.
>
> Below the cards, a small reassurance row:
> - "30-day money-back guarantee" + check icon
> - "No setup fees" + check icon
> - "Cancel anytime" + check icon
>
> ### Section 3 — Comparison matrix
>
> Compose the comparison-matrix variant from
> `patterns/pricing-tier.pen`. Sticky header row with tier names +
> CTAs stays visible as user scrolls feature comparisons.
>
> Categories (group rows by):
> - Core features
> - Collaboration
> - Security & compliance
> - Support
> - API & integrations
>
> Each category has a sticky group header.
>
> ### Section 4 — Trust signals (logo wall + testimonials)
>
> Compose `patterns/testimonial.pen` logo-wall variant — show
> recognized customers using {{brand}}.
>
> Below that, compose 2–3 case-study cards from
> `patterns/testimonial.pen` case-study variant. Stats per card
> ("60% reduction in onboarding time") drive credibility.
>
> ### Section 5 — Enterprise / contact-sales section
>
> A larger CTA section for the high-end tier:
> - Heading: "Need more? We have an enterprise plan."
> - Body: 2–3 lines listing enterprise capabilities (SSO, dedicated
>   support, SLA, custom contracts, on-prem)
> - Two actions: "Contact sales" (primary), "Book a demo" (secondary)
> - Optional: enterprise customer logos
>
> Use `patterns/cta.pen` mid-page section variant.
>
> ### Section 6 — FAQ
>
> Compose `patterns/faq.pen` accordion variant with pricing-specific
> questions:
>
> - "What payment methods do you accept?"
> - "Can I change plans later?"
> - "Is there a free trial?"
> - "How does billing work for teams?"
> - "What happens if I exceed plan limits?"
> - "Can I cancel anytime?"
> - "Do you offer discounts for nonprofits / education / startups?"
> - "Is my data secure?"
>
> Number of questions: 6–10.
>
> ### Section 7 — Footer
>
> Compose `patterns/footer.pen` marketing footer variant.
>
> ### Section 8 — Responsive behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): hero + 3-up tier cards + matrix + trust + CTA + FAQ + footer
> - Tablet (768): same sections, tier cards reduce to 2×2 grid OR
>   stack with most-popular on top
> - Mobile (390): tier cards stack vertically (most-popular first),
>   matrix becomes per-tier accordion, FAQ stays accordion
>
> ### Naming
> - Frame names: `pricing-page-{{breakpoint}}`
> - Section frames: `pricing-{{section}}` (`-hero`, `-tiers`,
>   `-matrix`, `-trust`, `-enterprise-cta`, `-faq`, `-footer`)

## Execution

```bash
pencil --out design/templates/pricing.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Pricing pages are conversion-focused but also high-AIO-value —
"how much does {{brand}} cost?" is a question users ask AI search
engines directly, and pricing pages with strong structured data
get cited in AI-generated answers. The discipline: comparison
table + Product/Offer schema + FAQ schema for common pricing
questions.

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` (e.g. "{{brand}}
pricing" or "Plans for every team"). Each tier's name (Free / Pro
/ Team) becomes `<h3>` within its tier card; the section
containing the tiers is wrapped in an `<h2>`. The FAQ accordion
items are `<h3>` per question. Comparison-matrix headings (when
present) are `<h3>` per category row.

**Primary keyword placement** — pricing-related keywords:
"{{brand}} pricing", "{{brand}} plans", "{{brand}} cost". Place
in H1, first 100 words, page title, meta description. Brand-
modified pricing keywords are typically lower-difficulty and
high-conversion-intent.

**Meta description** — concrete pricing summary. "Compare
{{brand}} plans: Free, Pro at $X/mo, Team at $Y/mo. View features,
limits, and FAQs." `metaDescriptionLength` from archetype targets.

**Structured data emission points** — pricing has the most
structured-data leverage of any archetype:

- `Product` (one per tier or for the product overall) — name,
  description, image, brand
- `Offer` (one per tier) — price, priceCurrency, availability,
  url. AggregateOffer when multiple tiers.
- `FAQPage` — the FAQ accordion's question-answer pairs become
  the FAQ schema entries
- `Organization` — site-wide
- `BreadcrumbList` — when pricing nests under a section

The design's tier cards must include all the data the Offer schema
needs: tier name, price (numeric), currency, billing period,
availability statement.

**AIO patterns** — pricing benefits from:

- `comparison-table` — **required**. The comparison matrix
  (typically below the tier cards) is the AIO-friendliest pricing
  content. Use real `<table>` markup with thead/tbody, not visual-
  only layout. Each row is a feature; each column is a tier; cells
  are checkmarks or specific values. AI search engines extract
  this cleanly.
- `faq-schema` — **required**. FAQ section answers common pricing
  questions. Real questions: "Can I change plans later?", "What's
  included in the free plan?", "Do you offer annual billing?",
  "Is there a free trial?", "What payment methods do you accept?".
  6-10 questions typical.
- `definitive-headings` — tier names + section H2s as definitive
  ("Choose your plan" not "Plans"; "What's included" not
  "Features")
- `factual-density` — tier descriptions include specific numbers
  ("Up to 5 users", "10,000 API calls/month", "Unlimited
  workspaces")
- `date-stamped-facts` — when prices have effective dates or
  promotional pricing, dates are explicit
- `citation-ready` — bullet lists of features per tier; tables
  for comparison

**Internal linking** — pricing should link to feature deep-dives,
documentation, customer stories, and contact-sales for
enterprise. Minimum `internalLinksMin`.

**Image alt text** — tier card icons or visuals get alt text.
Customer logos in social-proof rows get descriptive alt text per
logo.

**Currency handling** — prices include currency symbols and
codes (`$29 USD/mo` not just `$29`); when supporting multiple
currencies, design includes a currency-toggle that updates the
displayed price per tier. The Offer schema's priceCurrency reads
from this.

**Tier highlighting** — the "Most popular" tier (visually
emphasized in design) is a marketing signal, not an SEO signal.
SEO emission treats all tiers equally; the visual highlight is
purely UX.

When `.pencil-seo.json` is missing, apply baseline correctness:
single H1, comparison table as real `<table>`, alt text on icons.
Surface the SEO recommendation.



Screenshot the page. Confirm: hero + tier cards + matrix + trust +
enterprise CTA + FAQ + footer all present. Patterns from the
patterns folder are visibly composed (not reinvented). Rendered at
canonical 3 breakpoints.

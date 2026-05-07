---
description: Generate the testimonial pattern page (quote grid, single spotlight, video testimonial, logo wall, case-study card). Establishes reusable social-proof compositions for marketing pages and landing flows.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/testimonial.pen` — five testimonial-section
patterns covering the major social-proof use cases.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for `imagery.direction` —
   testimonials with photos respect the brand's imagery treatment;
   if `representation: abstract-only`, the photo variants are
   replaced with avatar-only versions.
3. Check brand JSON for `audience-regulation` — k-12 brands cannot
   use real photos of minors regardless of model release.

## Embedded prompt

> Build a Pencil page named **`Patterns / Testimonial`** for
> **{{brand}}**. Single 1440-wide canvas, 64px outer padding, 80px
> between sections. Render once on Light and once on Dark.
>
> ### Pattern 1 — Quote grid
>
> A 3-column grid of testimonial cards. Each card:
> - Quote (body-md, italic optional, 60–120 words)
> - Avatar (40px circle) + Name + Title/Company (body-sm)
> - Optional: company logo lockup at the bottom
> - Background: `--color-surface-raised` with subtle border
>
> Use when: marketing landing pages, mid-page social proof. Quote
> grids work well as an "after the value prop, before the pricing"
> trust block.
>
> Variants:
> - **Standard**: 3 testimonials, side by side
> - **Carousel**: 6+ testimonials in horizontal carousel (uses the
>   `carousel-card` variant from `frameworks/heroui/components/media.pen`)
> - **Mixed-source**: testimonials from different stakeholder types
>   (user, admin, executive) labeled by role
>
> ### Pattern 2 — Single-spotlight testimonial
>
> One large, prominent testimonial taking ~50% width:
> - Large quote (display-lg or h2, 30–60 words)
> - Avatar (80px circle) + Name + Title/Company
> - Optional: photo of the person (240×320 or rounded)
> - Optional: company logo prominently displayed
>
> Use when: anchor testimonial for the brand's marquee customer.
> Best for landing pages where one customer's story carries
> disproportionate weight.
>
> ### Pattern 3 — Video testimonial
>
> A play-button-overlaid placeholder (480×320) for video content:
> - Static thumbnail frame (placeholder rectangle with diagonal line)
> - Play button overlay (centered, semi-transparent backdrop)
> - Caption below: name + role + company
> - Optional accompanying transcript link for accessibility
>
> Use when: high-trust contexts where video carries more conviction
> than text (sales pages, case-study landings). Video testimonials
> require production budget — surface this trade-off clearly.
>
> Watch: this pattern is rare in research (~5% of competitors). If
> recommended via `patterns:select --strategy differentiate`, that's
> the differentiation point. Don't use without commissioned video.
>
> ### Pattern 4 — Logo wall
>
> A row or grid of customer logos:
> - Variants: 5-up single row, 4×2 grid, 6×3 dense grid
> - Logos rendered in monochrome (`--color-content-3` or
>   `--color-content-2`) so visual weight stays uniform
> - Optional small caption above: "Trusted by teams at..."
> - Optional click-to-case-study links per logo
>
> Use when: B2B marketing pages where customer recognition is
> itself the social proof. Logo walls are stronger than quotes for
> some audiences (procurement decision-makers, enterprise buyers).
>
> Restrictions: only use logos with explicit permission. Some
> companies prohibit logo usage in marketing materials regardless
> of vendor relationship. Check before adding.
>
> ### Pattern 5 — Case-study card
>
> A larger card combining logo + quote + outcome metric + CTA:
> - Customer logo (top-left)
> - Quote (body-md, 30–60 words)
> - Outcome metric (h2, e.g. "60% reduction in onboarding time")
> - Brief context (body-sm, 1–2 lines)
> - "Read full case study" CTA link
>
> Use when: marketing pages dedicated to customer success
> (case-study index, customer-stories sections). Case-study cards
> work well in 2-up or 3-up grids with mixed industries
> represented.
>
> ### Section 6 — Testimonial-card molecule reference
>
> Detailed breakdown of the canonical testimonial-card composition:
>
> Required:
> - Quote text
> - Attribution (name + title + company minimum)
>
> Optional but recommended:
> - Avatar (or company logo if photo unavailable)
> - Verifiable signal (LinkedIn link, company URL, video link)
> - Date / context (e.g. "Annual customer survey, 2025")
>
> Verifiable signals matter — anonymous testimonials are unconvincing.
> If a customer can't be named publicly (legal restrictions), the
> testimonial is weaker than industry research suggests it should be.
>
> ### Section 7 — Brand-fit considerations
>
> A reference card listing testimonial-pattern adjustments by brand:
>
> - **Audience-regulation = k-12**: NEVER use real photos of
>   minors. Use avatar illustrations, role-only labels ("4th-grade
>   teacher, Springfield ISD"), or quote-only formats.
> - **Audience-regulation = healthcare**: avoid identifiable
>   patient testimonials unless explicit HIPAA-compliant releases
>   exist. Default to provider testimonials.
> - **B2B with NDA-bound customers**: pattern shifts toward "logo
>   wall + role attributions" rather than named-person quotes.
> - **Consumer / community**: video testimonials and named
>   real-people quotes carry the most weight.
> - **Enterprise sales**: case-study cards with outcome metrics
>   beat anonymous quote grids.
>
> ### Section 8 — Responsive behavior
>
> A 3-row strip showing each pattern at desktop / tablet / mobile:
> - Quote grid: 3-col → 2-col → 1-col stack
> - Single-spotlight: 50/50 → stacked → stacked with smaller photo
> - Video: 480×320 → maintains aspect, scales width → full-width
>   tap target
> - Logo wall: 5-up → 4-up → 3×2 grid
> - Case-study card: 2-up grid → 1-col stack (preserves outcome
>   metric prominence)
>
> ### Naming
> - Pattern frames: `testimonial-{{pattern}}` (`-quote-grid`,
>   `-spotlight`, `-video`, `-logo-wall`, `-case-study`)
> - Molecule reference: `testimonial-card-canonical`
> - Brand-fit reference: `brand-fit-considerations`
> - Responsive cells: `testimonial-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/testimonial.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 testimonial patterns rendered, card
molecule reference, brand-fit considerations card, responsive matrix.
For k-12 brands, verify no photos of minors appear in any rendered
sample.

---
description: Generate the hero section patterns page (centered, split, image-left, image-right, video-bg, gradient-bg). Establishes reusable hero compositions that templates and pages compose, instead of every page reinventing.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/hero.pen` — six canonical hero-section
compositions that templates compose. Heroes are the highest-stakes
visual real estate; standardizing the composition options keeps
brand consistency without forcing every page to use the same hero.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for `imagery.direction` and
   `colorTreatment` — heroes apply the brand's recorded imagery
   treatment.

## Embedded prompt

> Build a Pencil page named **`Patterns / Hero`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between rows.
> Render once on Light and once on Dark.
>
> Six hero patterns, each rendered at full 1440 width × ~480 tall,
> with a 280px spec column on the right showing:
> - Pattern name (h4)
> - When to use (2–3 lines)
> - Composition rules
> - Atoms / molecules consumed
> - Responsive behavior (mobile, tablet, desktop)
>
> ### Pattern 1 — Centered hero
>
> Composition: vertical-stacked, center-aligned. Pre-headline
> (overline) + headline (display-2xl) + subheadline (body-lg) +
> primary CTA + secondary link. Optional small visual element above
> the pre-headline (logo lockup, eyebrow image, or illustrated icon).
>
> Use when: marketing landing, simple value prop, single message.
> Best for products that lead with copy over imagery.
>
> ### Pattern 2 — Split hero (text left, image right)
>
> Composition: 50/50 split. Left column: headline + subheadline +
> CTA group + optional secondary content (testimonial quote, badge
> row). Right column: hero imagery — placeholder rectangle with the
> brand's `imagery.direction` treatment applied.
>
> Use when: visual product demo (the hero image shows the product),
> persona-driven landings (the hero image shows the user).
>
> ### Pattern 3 — Image-left hero
>
> Mirror of Pattern 2 — image left, text right. Use sparingly:
> Western reading patterns expect text on the left. Best for hero
> imagery that's especially strong (full-bleed photography, custom
> illustration).
>
> ### Pattern 4 — Video background hero
>
> Full-bleed background video (placeholder rectangle with diagonal
> line + "VIDEO" caption + treatment overlay). Centered or
> bottom-left text content with strong overlay scrim ensuring AAA
> contrast. Includes a play/pause control respecting
> `prefers-reduced-motion`.
>
> Use when: brand has commissioned video content; product is itself
> visual (creative tools, design products); first impression matters
> more than scannable copy.
>
> Watch: video heroes are heavy (bandwidth, accessibility — must
> have static fallback for reduced-motion).
>
> ### Pattern 5 — Gradient background hero
>
> Full-bleed gradient using brand colors. Centered or left-aligned
> text content. No imagery — the gradient itself is the visual.
> Gradient interpolates between two brand-palette stops (e.g.
> `--color-accent-50` to `--color-accent-100`, or
> `--color-accent-700` to `--color-accent-900` for dark heroes).
>
> Use when: B2B SaaS marketing, technical products where photography
> would feel forced, brand is color-strong but imagery-sparse.
>
> ### Pattern 6 — Pattern background hero
>
> Full-bleed pattern background (Hero Patterns SVG, geometric
> repeats). Centered text content with a subtle pattern at low
> opacity behind it. The pattern adds texture without dominating
> the message.
>
> Use when: brand uses pattern-style imagery direction, or product
> is data/abstract-themed and patterns evoke that without literal
> imagery.
>
> ### Section 7 — Responsive matrix
>
> A 3×6 grid showing all six patterns at three breakpoints (mobile
> 390, tablet 768, desktop 1440). Patterns 2 and 3 collapse to
> stacked-vertical on mobile (text above image). Pattern 4 disables
> video on touch devices (per the motion foundation). Pattern 5 and
> 6 carry through identically — they don't have layout transitions,
> only resize.
>
> ### Section 8 — Composition rules (shared)
>
> A reference card listing rules every hero respects:
> - **Headline**: `display-2xl` desktop, `display-xl` tablet,
>   `display-lg` mobile (or `h1` if hero is below-the-fold)
> - **Vertical rhythm**: 16/24/32px gaps between pre-headline /
>   headline / subhead / CTA
> - **CTA group**: primary first, secondary as link or outline button
> - **Top-of-page heroes**: 480–640px tall on desktop, 360px tablet,
>   320px mobile
> - **Mid-page heroes**: 320–480px tall (lighter weight, won't
>   compete with the hero above)
> - **Always include**: meaningful headline, no lorem
> - **Never include**: more than one primary CTA per hero (paradox
>   of choice)
>
> ### Naming
> - Pattern frames: `hero-{{pattern}}` (e.g. `hero-centered`,
>   `hero-split-text-left`)
> - Spec columns: `hero-{{pattern}}-spec`
> - Responsive matrix cells: `hero-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/hero.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 6 hero patterns each with spec column,
3×6 responsive matrix, composition rules card. Each pattern uses
real brand-content copy (not lorem) and references the brand's
imagery direction treatment.

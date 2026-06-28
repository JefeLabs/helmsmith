---
description: Generate the pricing-tier pattern page (3-tier, 4-tier, comparison-matrix layouts). Establishes reusable pricing compositions with most-popular accent, billing-period toggle, and feature comparison.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/pricing-tier.pen` — three pricing-comparison
layouts plus the supporting molecules (tier card, feature row,
billing toggle).

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for accent and currency
   conventions (brand may carry currency / locale defaults).

## Embedded prompt

> Build a Pencil page named **`Patterns / Pricing Tier`** for
> **{{brand}}**. Single 1440-wide canvas, 64px outer padding, 80px
> between sections. Render once on Light and once on Dark.
>
> ### Pattern 1 — 3-tier card layout
>
> Three pricing cards side by side, each ~320px wide:
> - Header: tier name (h4) + tier description (body-sm,
>   `--color-content-2`)
> - Price: large display (display-xl) with currency + period
>   ("/month")
> - Primary CTA button (full-width inside card)
> - Feature checklist: 5–8 lines, each with check icon + feature name
> - Optional fine print: "Includes everything in [previous tier]" or
>   trial/limit notes
>
> The middle tier is the **recommended/most popular**:
> - Card is slightly taller (visually elevated)
> - Top ribbon: "Most popular" or "Recommended" with `--color-accent-600`
>   background
> - Border: `--color-accent-500` 2px (vs `--color-separator` for
>   others)
> - Primary CTA in solid `--color-accent-500` (others outline)
>
> Use when: three clear product tiers (Free / Pro / Enterprise is
> the canonical shape).
>
> ### Pattern 2 — 4-tier card layout
>
> Four pricing cards. Each card narrower (~280px) to fit in 1440
> with gaps. Same molecule as Pattern 1 but tighter:
> - Feature checklist 4–6 lines
> - Compact fine print
>
> Use when: more granular product tiers (Starter / Pro / Business /
> Enterprise).
>
> Watch: 4 tiers test users' working memory; consider whether 3
> tiers + an "Enterprise" link suffices.
>
> ### Pattern 3 — Feature comparison matrix
>
> A wide table:
> - First column: feature name
> - Subsequent columns: one per tier, with check / dash / specific
>   value (e.g. "10 GB" vs "Unlimited")
> - Sticky header row with tier names + prices + CTAs (so the CTA
>   stays visible as the user scrolls feature comparisons)
> - Row groupings: "Core features", "Collaboration", "Security",
>   etc. with sticky group headers
>
> Use when: feature differences between tiers are detailed enough
> that scannable cards undersell the offering. Common for B2B SaaS
> with security / compliance tiers.
>
> ### Section 4 — Billing period toggle
>
> A reference for the canonical billing-period toggle that sits
> above any pricing layout:
>
> - Two-state segmented control: "Monthly" | "Annual"
> - Annual variant shows discount badge: "Save 20%" or
>   "2 months free"
> - When toggled, all prices and CTAs update
> - Annotation showing the visual transition (price counter
>   animates, period label changes)
>
> ### Section 5 — Tier-card molecule reference
>
> Detailed breakdown of the canonical tier-card composition:
>
> Variants:
> - **Default tier**: outline border, outline CTA
> - **Recommended tier**: 2px accent border, "Most popular" ribbon,
>   solid CTA, optional slight elevation/shadow
> - **Custom-quote tier** (highest tier in many SaaS):
>   no specific price, "Contact sales" CTA, "Volume pricing" badge
>
> Per-card sections (top to bottom):
> 1. Optional ribbon ("Most popular")
> 2. Tier name
> 3. Tier description (1 line)
> 4. Price block:
>    - Large price + currency symbol
>    - Period ("/month" or "/user/month")
>    - Strikethrough monthly price when billed annually
> 5. Primary CTA
> 6. Divider
> 7. Feature heading: "What's included" or "Everything in [prev tier], plus:"
> 8. Feature checklist (max 8 lines per tier card)
> 9. Optional secondary link: "Compare all features"
>
> ### Section 6 — Feature checklist molecule
>
> A reference for the feature-row molecule used inside tier cards
> and the comparison matrix:
>
> Variants:
> - **Included**: check icon (`--color-success-600`) + feature name
> - **Not included**: dash icon (`--color-content-3`) + grayed-out feature
> - **Limited**: check icon + feature name + amount badge ("up to 10")
> - **New**: check icon + feature name + "New" pill
> - **Tooltip**: feature name with info icon → tooltip explanation
>
> ### Section 7 — Free / contact-sales edge cases
>
> Two reference cards:
>
> **Free tier**: zero price displayed as "$0" with explicit "Forever
> free" period; CTA is "Get started" (sign-up flow), not "Buy".
>
> **Contact-sales tier**: no price displayed. Instead: "Custom
> pricing" or "Let's talk". CTA is "Contact sales" (form / calendar
> link), and the feature list emphasizes enterprise capabilities
> (SSO, dedicated support, custom contracts).
>
> ### Section 8 — Responsive behavior
>
> A 3-row strip showing each pattern at desktop / tablet / mobile:
> - **3-tier** desktop: side-by-side. Tablet: same. Mobile: stacked
>   vertically, recommended tier first (so it's not buried below
>   the fold)
> - **4-tier** desktop: side-by-side. Tablet: 2×2 grid. Mobile:
>   stacked with horizontal scroll alternative
> - **Comparison matrix** desktop: full table. Tablet: 2 tiers
>   visible at a time with horizontal scroll. Mobile: per-tier
>   accordion (each tier expands to show its features as a list)
>
> ### Naming
> - Pattern frames: `pricing-{{pattern}}` (`-3-tier`, `-4-tier`,
>   `-comparison-matrix`)
> - Molecule references: `tier-card-default`, `tier-card-recommended`,
>   `tier-card-custom-quote`, `feature-row-included`, etc.
> - Reference frames: `billing-toggle`, `free-edge-case`,
>   `contact-sales-edge-case`
> - Responsive cells: `pricing-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/pricing-tier.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 3 pricing patterns rendered, billing
toggle reference present, tier-card and feature-row molecule
references present, free + contact-sales edge cases covered,
responsive matrix complete.

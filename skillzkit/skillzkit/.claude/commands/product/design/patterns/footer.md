---
description: Generate the footer pattern page (marketing footer, app footer, minimal footer). Establishes reusable footer compositions with nav, social, legal, newsletter signup. Templates compose these instead of reinventing.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/footer.pen` — three canonical footer
patterns covering the major use cases.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for brand mark, social links,
   and any tagline.

## Embedded prompt

> Build a Pencil page named **`Patterns / Footer`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between rows.
> Render once on Light and once on Dark.
>
> Three footer patterns, each rendered at 1440 × variable height
> with a 280px spec column.
>
> ### Pattern 1 — Marketing footer (full)
>
> Multi-column composition:
> - 5 columns: Brand block (logo + tagline + 1-line about),
>   Product (4–6 links), Resources (4–6 links), Company
>   (3–5 links), Legal (3–5 links).
> - **Newsletter row** below the columns: heading + email input +
>   subscribe button.
> - **Bottom bar**: copyright (left), social icons (center),
>   secondary legal links (right).
> - Background: `--color-neutral-50` light / `--color-neutral-900` dark.
> - Total height: ~480px.
>
> Use when: marketing site, landing pages, anywhere the user might
> want to discover more of the product.
>
> ### Pattern 2 — App footer (minimal)
>
> Single-row composition:
> - Logo lockup (left)
> - Inline links: Help, Status, Terms, Privacy (center)
> - Build version + last-deploy timestamp in monospace
>   (`--color-content-3`, body-sm) on the right
> - Background: same as page (no contrast shift)
> - Total height: ~64px (one row)
>
> Use when: inside the authenticated product, where users came to
> work — the footer should be helpful but not invite leaving.
>
> ### Pattern 3 — Minimal footer
>
> Two-line composition:
> - Line 1: Brand mark + copyright
> - Line 2: 3 inline links (Privacy, Terms, Contact)
> - Centered alignment
> - Total height: ~96px
>
> Use when: auth pages (sign-in, sign-up), focused single-step
> flows, error pages, anywhere a full marketing footer would
> overwhelm.
>
> ### Section 4 — Newsletter signup composition
>
> A standalone reference for the newsletter row (used inside
> Pattern 1, also reusable on its own as a CTA section):
>
> - Heading + 1-line value prop
> - Email input + Subscribe button (inline group)
> - Privacy line below: "We don't share your email. Unsubscribe
>   anytime."
> - Inline error / success states (uses `patterns/states.pen`
>   inline-error and inline-success variants)
>
> ### Section 5 — Social icon group
>
> A small reference showing the canonical social icon set:
> - Order: Twitter/X, LinkedIn, GitHub, YouTube, Facebook, Instagram,
>   plus brand-specific (Discord, Slack, Mastodon if applicable)
> - Size: `--icon-md` (20px)
> - Color: `--color-content-2` default, `--color-content-1` on hover
> - Spacing: `--space-md` (16px) between
> - Each icon has sr-only label ("Follow us on Twitter")
>
> ### Section 6 — Legal-link conventions
>
> Reference card listing standard legal links and when to include
> each:
> - Privacy Policy: always
> - Terms of Service: always
> - Cookie Policy: when site uses cookies (most B2B)
> - Accessibility Statement: WCAG-compliant products
> - Do Not Sell My Personal Info: required in California products
> - GDPR / Data Subject Rights: required in EU-serving products
> - DMCA: user-generated-content products
> - Acceptable Use Policy: SaaS products
>
> ### Section 7 — Responsive behavior
>
> A 3-row strip showing the marketing footer at three breakpoints:
> - Desktop (1440): 5-column layout
> - Tablet (768): 2-column layout (Product+Resources, Company+Legal),
>   brand block above as full-width
> - Mobile (390): single-column accordion (each section collapses
>   into a tappable header), social row at bottom
>
> ### Naming
> - Pattern frames: `footer-marketing`, `footer-app`, `footer-minimal`
> - Spec columns: `footer-{{pattern}}-spec`
> - Composition references: `newsletter-row`, `social-group`,
>   `legal-links`
> - Responsive cells: `footer-marketing-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/footer.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 3 footer patterns rendered, newsletter
+ social + legal-link references present, responsive matrix for
marketing footer covers all 3 canonical breakpoints.

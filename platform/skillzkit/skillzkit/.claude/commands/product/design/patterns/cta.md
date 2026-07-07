---
description: Generate the call-to-action pattern page (mid-page CTAs, banner CTAs, card CTAs, floating CTAs). Establishes reusable CTA compositions for breaking up long pages and driving conversion at the right rhythm.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/cta.pen` — five canonical CTA patterns
covering the placement options that compose into landing pages,
feature pages, and content pages.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for brand voice and tone.

## Embedded prompt

> Build a Pencil page named **`Patterns / CTA`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between rows.
> Render once on Light and once on Dark.
>
> Five CTA patterns, each rendered at appropriate width with a 280px
> spec column on the right.
>
> ### Pattern 1 — Mid-page section CTA
>
> Composition: full-width section, ~280px tall, with strong contrast
> (e.g. `--color-accent-700` background, `--color-accent-50` text).
> Centered: 1-line headline + 1-line subhead + 2 buttons (primary
> + secondary). Optional faint pattern overlay.
>
> Use when: breaking up a long marketing page mid-scroll. Place
> after a value-prop section to convert engaged readers before they
> bounce.
>
> Watch: don't use more than 2 mid-page CTAs per long page —
> conversion fatigue.
>
> ### Pattern 2 — Banner CTA
>
> Composition: thin horizontal bar (60–80px tall), full page width.
> Inline content: short message + button. Optional dismiss "×".
> Background: `--color-accent-100` (info) or `--color-warning-100`
> (urgency). Sticky positioning option for top-of-page or
> bottom-of-page placement.
>
> Use when: announcement (new feature, sale, deadline), upgrade
> nudge, deprecation notice.
>
> Variants: dismissible (with × close), persistent (no close),
> dismissed-with-cookie (remembers across sessions).
>
> ### Pattern 3 — Card CTA
>
> Composition: bordered card (320–480px wide), embedded in a column
> or grid. Content: small icon or pattern + heading + 1-line
> description + button. Used inside content flow, not as a
> page-spanning section.
>
> Use when: contextual CTAs within content (e.g. "Try the related
> feature" inside a feature description), discovery affordances in
> dashboards ("Connect your calendar" card on an empty schedule
> page — overlaps with empty-state pattern).
>
> ### Pattern 4 — Inline CTA
>
> Composition: a single sentence with an embedded link or button at
> the end. "Ready to get started? [Sign up free →]". Lighter weight
> than card or section CTAs.
>
> Use when: ending a content section, blog post conclusion, FAQ
> answer that wants to drive an action.
>
> ### Pattern 5 — Floating CTA (cookie/chat-style)
>
> Composition: fixed-positioned 320×variable card, typically
> bottom-right, with shadow and rounded corners. Includes a close
> "×". Often: chat-bubble lookalike with avatar + message + CTA.
>
> Use when: site-wide help affordances, chat-support entry, exit-
> intent capture (after delay or scroll trigger). The floating
> position is always interrupting — use sparingly.
>
> Watch: floating CTAs respect `prefers-reduced-motion` (no
> bouncing entries) and have a visible dismiss. Re-show timing
> should be generous (24+ hours after dismiss).
>
> ### Section 6 — CTA copy patterns
>
> A small reference card showing copy patterns by stakes:
>
> | Stakes        | Pattern                                    | Example                          |
> | ------------- | ------------------------------------------ | -------------------------------- |
> | Low (free)    | Action verb + benefit                      | "Start free trial"               |
> | Medium (paid) | Action verb + commitment hint              | "Get full access"                |
> | High (long)   | Action verb + outcome + reassurance        | "Talk to sales (5 min, no commitment)" |
> | Destructive   | Specific verb + object + reversibility     | "Delete project (you can undo)"  |
>
> Verbs to prefer: Start, Get, Try, See, Continue, Learn.
> Verbs to avoid: Click, Submit, OK (low signal), Next (no benefit).
>
> ### Section 7 — Hierarchy across CTAs in one page
>
> A reference card showing how multiple CTAs on one page should
> visually rank:
>
> - **Primary action**: solid `--color-accent-500` button, the most
>   visually prominent. ONE per page (max).
> - **Secondary action**: outline button or subtle background.
>   Multiple OK.
> - **Tertiary action**: text link with chevron. Many OK.
>
> If a page genuinely has two equally-weighted primary actions, that's
> usually a sign the page should be split into two flows.
>
> ### Section 8 — Responsive behavior
>
> A 3-row strip showing each pattern at desktop / tablet / mobile.
> Patterns 1, 2, 3, 5 reflow predictably (stack on mobile). Pattern 4
> (inline) scales naturally. Floating CTA in Pattern 5 may need to
> adjust position on mobile to avoid overlapping bottom-bar nav.
>
> ### Naming
> - Pattern frames: `cta-{{pattern}}` (e.g. `cta-section`, `cta-banner`)
> - Reference frames: `copy-patterns`, `hierarchy-card`
> - Responsive cells: `cta-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/cta.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 CTA patterns rendered, copy patterns
+ hierarchy cards present, responsive matrix covers all patterns.

---
description: Generate the FAQ pattern page (accordion-based, two-column, categorized layouts). Establishes reusable FAQ compositions for support pages, marketing FAQs, and inline help.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/faq.pen` — three FAQ layouts plus the
question-answer molecule reference.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.

## Embedded prompt

> Build a Pencil page named **`Patterns / FAQ`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between rows.
> Render once on Light and once on Dark.
>
> ### Pattern 1 — Accordion FAQ
>
> A vertical stack of question-answer pairs in accordion form:
> - Each row: question (h5) + chevron-down icon (right-aligned)
> - Click expands: row reveals answer below in body-md
> - Optional dividers between rows (`--color-separator`)
> - Default state: all collapsed
> - Variants: single-open (only one expanded at a time) vs
>   multi-open (any number expanded)
>
> Use when: marketing site FAQ, support pages, anywhere users want
> to scan questions and dive in selectively.
>
> Width: 800px max (centered) or full-page-width depending on
> context. Wider than 800px hurts scanability.
>
> ### Pattern 2 — Two-column FAQ
>
> Question-answer pairs displayed inline (no accordion):
> - 2 columns of pairs
> - Each pair: bold question + answer below in body-md
> - 32px gap between pairs vertically
> - Used when answers are short enough that scanning all of them
>   makes sense
>
> Use when: smaller FAQ sets (6–12 entries) where the answers are
> 1–2 lines each. Mostly mid-page sections within longer marketing
> pages.
>
> ### Pattern 3 — Categorized FAQ
>
> FAQ grouped into categories with anchor navigation:
> - **Left sidebar (240px)**: list of categories with anchor links
>   ("Account", "Billing", "Security", "API", etc.). Active section
>   highlighted as the user scrolls.
> - **Main content**: each category section has a heading + accordion
>   list of questions
> - Sticky sidebar on desktop scrolls with the page; collapses to
>   a top-of-page select on tablet/mobile
>
> Use when: large support / help-center FAQ with 30+ questions
> across multiple topics.
>
> ### Section 4 — Q&A molecule reference
>
> A breakdown of the canonical question-answer molecule:
>
> Composition:
> - **Question** (h5 weight, body-lg size or h5 outright). Tone:
>   conversational, written from the user's perspective ("How do I
>   change my password?" not "Password change procedures")
> - **Answer** (body-md). Tone: direct, helpful. Length 1–6 sentences.
>   Includes inline links to docs/articles where appropriate. Code
>   examples in `code` style if applicable.
> - **Optional related links** at the end: "Related: [link 1] •
>   [link 2]"
>
> Variants:
> - **Default (accordion)**: question + chevron, expands to reveal
>   answer
> - **Inline (two-column)**: question + answer always visible
> - **Card** (used in support landings): bordered card with question
>   as title, short answer, and "Read more" link to a full article
>
> ### Section 5 — Search-first FAQ pattern
>
> A reference for the modern alternative to listing FAQs:
> - Prominent search input at the top: "Search help articles..."
> - Below: a small "Popular questions" list (5–8 most-searched
>   questions linked to their answers)
> - Below that: "Browse by category" with category cards
>
> Use when: large support corpus where listing all questions is
> impractical. Combine with categorized pattern: search at top,
> categorized list below for browse-mode users.
>
> ### Section 6 — Composition rules (shared)
>
> Reference card:
> - **Question phrasing**: always from user perspective, never
>   "Why doesn't this work?" — instead "Why isn't [thing] working?"
> - **Answer length**: keep under 6 sentences for accordion FAQs.
>   If longer, link to a full article.
> - **Order**: most-asked first (use real analytics data, not
>   designer intuition). For new products without data, order by
>   user journey (sign-up questions first, billing later, advanced
>   topics last).
> - **Anti-pattern**: don't include questions that exist only because
>   the product has a confusing UX — fix the UX instead.
> - **Update tracking**: each Q&A should have a "Last updated" date
>   so users can trust freshness.
>
> ### Section 7 — Responsive behavior
>
> A 3-row strip showing each pattern at desktop / tablet / mobile:
> - **Accordion**: same UX across all breakpoints; container width
>   shrinks
> - **Two-column** desktop: 2-col. Tablet: 2-col. Mobile: 1-col.
> - **Categorized** desktop: sidebar + content. Tablet: collapsible
>   sidebar (toggle to show). Mobile: top-of-page select dropdown
>   replacing sidebar
>
> ### Naming
> - Pattern frames: `faq-{{pattern}}` (`-accordion`, `-two-column`,
>   `-categorized`)
> - Reference frames: `qa-molecule`, `search-first-faq`,
>   `composition-rules`
> - Responsive cells: `faq-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/faq.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 3 FAQ patterns rendered, Q&A molecule
reference present, search-first reference card, composition rules
+ responsive matrix complete.

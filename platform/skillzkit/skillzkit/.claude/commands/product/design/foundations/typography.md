---
description: Generate the typography foundations page (type scale, families, weights, line-heights).
argument-hint: [--display <font>] [--body <font>] [--mono <font>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/typography.pen` — every text token, paired with
its rendered specimen.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Load `product/.pencil-brand.json` for `fontDisplay`, `fontBody`, `fontMono`.
3. If MCP: `get_guidelines({ category: "guide", name: "Typography" })`.

## Embedded prompt

> Build a Pencil page named **`Foundations / Typography`** for the
> **{{brand}}** design system. Use `{{fontDisplay}}` for display and headings,
> `{{fontBody}}` for body and UI, `{{fontMono}}` for code.
>
> Page layout: a single 1440-wide frame, 64px outer padding, 80px between
> sections. Render once on Light and once on Dark, stacked vertically (not
> side by side — typography needs the horizontal room).
>
> ### Section 1 — Font families
> Three cards (`Display`, `Body`, `Mono`). Each card shows: family name,
> weight axis (200→900 for variable fonts), an `Aa` glyph at 96px, and the
> CSS variable name (`--font-display`, `--font-body`, `--font-mono`).
>
> ### Section 2 — Type scale
> Render every step with: token name, computed size / line-height, letter-
> spacing, weight, and a sample sentence ("The quick brown fox jumps over
> the lazy dog."). Use this scale (Tailwind v4-compatible):
>
> | Token         | Size  | Line  | Tracking | Weight | Use                |
> | ------------- | ----- | ----- | -------- | ------ | ------------------ |
> | display-2xl   | 72/80 | 1.05  | -0.04em  | 700    | Hero               |
> | display-xl    | 60/68 | 1.05  | -0.03em  | 700    | Hero (compact)     |
> | display-lg    | 48/56 | 1.1   | -0.02em  | 700    | Section opener     |
> | h1            | 36/44 | 1.15  | -0.02em  | 700    | Page title         |
> | h2            | 30/38 | 1.2   | -0.01em  | 600    | Section            |
> | h3            | 24/32 | 1.25  | -0.01em  | 600    | Subsection         |
> | h4            | 20/28 | 1.3   | -0.005em | 600    | Card title         |
> | h5            | 18/26 | 1.35  | 0        | 600    | Group label        |
> | h6            | 16/24 | 1.4   | 0        | 600    | Inline header      |
> | body-lg       | 18/28 | 1.55  | 0        | 400    | Lede paragraph     |
> | body-md       | 16/24 | 1.5   | 0        | 400    | Default body       |
> | body-sm       | 14/20 | 1.45  | 0        | 400    | Secondary text     |
> | caption       | 12/16 | 1.4   | 0.01em   | 500    | Captions / metadata|
> | overline      | 11/16 | 1.4   | 0.08em   | 600    | All-caps eyebrow   |
> | code          | 14/20 | 1.5   | 0        | 500    | Inline code        |
>
> ### Section 3 — Numerals & figures
> Render `0123456789` at 48px in tabular vs proportional, lining vs
> oldstyle. Label each variant with its CSS feature (`tabular-nums`,
> `oldstyle-nums`).
>
> ### Section 4 — Reading paragraph
> A 640px-wide column of placeholder lorem at `body-md`, with a callout
> showing optimal measure (50–75 characters per line).
>
> ### Naming
> Each row's frame is named after its token: `type / display-2xl`, etc.
> Tokens appear as text labels, never raw values, in the spec column.

## Execution

```bash
pencil --out design/foundations/typography.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page root. Every row in the type scale table must render with
its specimen sentence. If `{{fontDisplay}}` did not load (Pencil fallback to
system), refine in place with an explicit `font-family` instruction.

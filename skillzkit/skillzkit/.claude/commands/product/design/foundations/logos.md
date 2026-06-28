---
description: Generate the logo foundations page (variants, clear space, minimum size, do/don't).
argument-hint: [--logo-path <path>] [--wordmark-path <path>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/logos.pen` — brand mark variants and usage rules.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. If a logo path is provided in `$ARGUMENTS`, the command should also call
   the Pencil MCP `import_asset` tool (or CLI equivalent) to bring the SVG
   into the document. If no logo exists yet, generate a placeholder mark
   (geometric monogram from the first letter of `{{brand}}`).

## Embedded prompt

> Build a Pencil page named **`Foundations / Logos`** for the **{{brand}}**
> design system. Page is 1440-wide, sectioned vertically.
>
> ### Section 1 — Lockup variants
> Render six lockup variants on appropriate backgrounds:
>
> 1. **Primary** — full color, on `--surface` (light)
> 2. **Primary on dark** — full color, on `--surface` dark theme
> 3. **Monochrome black** — single-color black, on `--surface`
> 4. **Monochrome white** — single-color white, on `--accent-700`
> 5. **Mark only** — symbol/glyph without wordmark, both light and dark
> 6. **Wordmark only** — type-only, both light and dark
>
> Each variant gets a labeled card showing the lockup centered, the variant
> name underneath, and the file path it should be exported to:
> `assets/brand/{{brand-slug}}-<variant>.svg`.
>
> ### Section 2 — Clear space
> A diagram of the primary lockup with red guides showing the clear-space
> rule: minimum padding equal to the height of the lowercase `o` (or
> equivalent x-height unit) on all four sides. Annotate with the rule:
> "Clear space = 1× x-height of the wordmark."
>
> ### Section 3 — Minimum sizes
> A row of the mark rendered at 16px, 24px, 32px, 48px, 64px, 96px. Mark
> the smallest legible size with a green checkmark and label it
> "Minimum size — digital: 24px tall. Print: 0.5in / 12mm."
>
> ### Section 4 — Color tokens
> Reference card listing brand color tokens used in the mark:
> `--brand-primary` (= accent-500), `--brand-secondary` (= secondary-500),
> `--brand-ink` (= content-1), `--brand-paper` (= surface).
>
> ### Section 5 — Do / don't
> A 2×3 grid with three "Do" examples (left column, green check) and three
> "Don't" examples (right column, red cross). Cover:
> - Don't stretch / squash
> - Don't recolor outside the approved palette
> - Don't add effects (drop shadow, outer glow, gradient on mark)
> - Don't rotate
> - Don't place on busy / low-contrast backgrounds
> - Do maintain clear space
>
> ### Section 6 — Favicon & app icons
> A row showing the mark adapted for favicon (16, 32, 48), app icon (180,
> 512, 1024 with iOS-style 22% corner radius), and PWA maskable icon (with
> 80% safe area circle overlay). Each labeled with target file name:
> `favicon-16.png`, `apple-touch-icon-180.png`, `pwa-512-maskable.png`.

## Execution

```bash
pencil --out design/foundations/logos.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Confirm all six lockup variants are present and that minimum-
size and clear-space sections render with the correct annotations.

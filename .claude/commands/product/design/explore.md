---
description: Generate N structurally-different low-fidelity wireframe explorations for a user story in a single .pen file. Framework-agnostic, grayscale, FA icons. Each exploration occupies one horizontal row showing the screen flow left-to-right.
argument-hint: <user-story-text or @path/to/story.md> [--n 3] [--screens-per-exploration auto|<n>] [--device desktop|mobile|tablet] [--axes nav,steps,density,input,confirmation] [--no-icons] [--out <path>] [--name <slug>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate N structurally-different low-fidelity wireframe explorations for
a single user story. Output is one `.pen` file with N horizontal rows,
each row showing one exploration's screen flow left-to-right (storyboard
style). The point is to surface **meaningfully different approaches**
before committing to a direction — not to produce three lightly-restyled
versions of the same flow.

Default output: `design/explorations/<story-slug>.pen`.

## What makes this command different from `/product:design:design-page`

| Dimension              | `/product:design:design-page`                  | `/product:design:explore`                              |
| ---------------------- | -------------------------------------- | ---------------------------------------------- |
| Fidelity               | High-fidelity, design-system-faithful  | Low-fidelity wireframes, grayscale            |
| Component vocabulary   | HeroUI v3 compound APIs, BEM, tokens   | Geometric shapes, sketch labels, no APIs      |
| Output count           | 1 page, 1 visual approach              | N approaches in 1 file, side-by-side          |
| Decomposition          | Atoms → Molecules → Organisms → Pages | Just screens-in-flow per exploration row      |
| When to use            | After direction is locked              | Before direction is locked                    |
| Theme / tokens         | Required (`@theme`, foundations)       | Bypassed — pure structural exploration        |
| Icons                  | Resolves through `iconLibrary` setting | Always Font Awesome Solid (universal default) |

## Pre-flight

This command **does not** apply the framework-specific rules from
`_context.md` (compound APIs, BEM hints, variant catalogs, `@theme`
tokens). Explorations are pre-design — those rules don't fit yet. The
embedded prompt explicitly overrides them.

1. Read `product/strategy/_context.md` and `product/design/_context.md` only for the universal mechanics:
   Pencil invocation strategy, file layout conventions, brand inputs,
   verification step structure. Ignore rules 1–8 (compound, semantic
   variants, tokens, BEM, state coverage, theme coverage, breakpoints,
   canonical-3 — these are design-system rules, not exploration rules).
2. Resolve the story input:
   - First positional arg is free text → use directly.
   - Or matches `@<path>` → read that file.
   - Or `design/stories/<slug>.md` exists → read it.
   - Otherwise prompt the user.
3. Resolve flags:
   - `--n` — number of explorations. Default `3`, max `6`.
   - `--screens-per-exploration` — `auto` (default, infer from story
     complexity) or fixed integer. Auto typically picks 3–6 screens.
   - `--device` — viewport target. Default `desktop` (1440 wide
     screens). `mobile` uses 390-wide screens. `tablet` uses 768.
   - `--axes` — comma list of structural axes to vary across the N
     explorations (see Phase 2). Auto if not provided.
   - `--no-icons` — render without any icons (pure boxes and labels).
     Default is FA Solid icons where applicable.
   - `--out` — override the default output path.
   - `--name` — override the auto-derived story slug.
4. Compute the story slug if not provided. Take the first noun phrase
   of the story or its first 4–6 words, kebab-case it.
5. Verify Pencil access (MCP server > CLI > stop).

## Phase 1 — Story analysis

Parse the user story into structured pieces. The standard format is:

> "As a [persona], I want to [action] so that [benefit]."

Extract:
- **Persona** — who is doing this
- **Action** — the task (verb phrase)
- **Benefit** — what success looks like
- **Implied entry point** — where the user is when they start
  (e.g., "logged-in dashboard", "marketing site", "an email link")
- **Implied success state** — what the user sees when done
  (e.g., "confirmation message", "updated record", "downloaded file")
- **Implied edge cases** — error paths the story doesn't say but a
  designer must consider (validation failures, network errors,
  missing permissions)

Print a "Read of the story" block before generating, in the same
shape `/product:design:foundations:icons-select` uses, so the user can correct
miscalibration before any wireframes get drawn:

```
📖 Read of the story
   Persona:        New user, unauthenticated
   Action:         Sign up for an account using email or social
   Benefit:        Access the product without remembering another password
   Entry point:    Marketing site CTA, or auth wall on a deep link
   Success state:  Logged in, on first-run / onboarding
   Edge cases:     Email already registered, social-auth cancellation,
                   weak password, network failure during submit
```

If the user disagrees with any inference, they correct and re-run.

## Phase 2 — Exploration planning

The N explorations must vary along **distinct structural axes**, not
just visual ones. Pick N axes from this list (or accept `--axes`):

| Axis            | Variation examples                                           |
| --------------- | ------------------------------------------------------------ |
| `nav`           | Modal vs full-page vs drawer vs side-panel vs inline         |
| `steps`         | Single-screen vs wizard (linear) vs branching vs single-page-with-anchors |
| `density`       | Sparse (one decision per screen) vs dense (everything visible) |
| `input`         | Form-driven vs guided/conversational vs canvas/visual vs prompt-based |
| `confirmation`  | Inline vs separate confirm page vs optimistic with undo      |
| `feedback`      | Immediate per-field vs on-submit vs progressive milestone    |
| `entry`         | Single entry point vs multiple entry points vs context-aware |
| `progressive-disclosure` | All upfront vs reveal-on-need vs opt-in advanced     |

For N=3, a good default selection is `nav, steps, density` — these
yield the most structurally distinct results for most flows.

For each picked axis, choose the most contrasting values for the N
explorations. For a 3-exploration sign-up story varying on `steps`:

- A: **Single-screen** — all fields on one screen, submit once
- B: **Wizard** — 3 steps, one decision per screen, progress indicator
- C: **Progressive** — single screen but reveals fields as previous
  ones are completed

This is the planning output. Print it before generating:

```
🎨 Exploration plan (3 explorations × 4 screens each)
   A — "Form" (steps=single-screen)        sparse, all-at-once
   B — "Wizard" (steps=wizard)             one decision per screen, progress dots
   C — "Reveal" (steps=progressive)        single screen, fields appear as filled
```

Pause for user confirmation unless the input was already concrete
enough to skip review.

## Phase 3 — Embedded wireframe prompt

The prompt that gets sent to Pencil. This is the heart of the command.

> Build a single Pencil page named **`Exploration / {{story-slug}}`**.
> The page contains **{{n}} horizontal rows**, each row representing
> one exploration of the same user story:
>
> *"{{user-story}}"*
>
> ## Wireframe visual language (applies to every screen, every row)
>
> This is **low-fidelity exploration**, not design-system instantiation.
> Strict rules:
>
> - **Palette**: at most **4 depths of gray** — sufficient to
>   communicate direction (hierarchy, emphasis, depth, interactive
>   state) at low fidelity. Use exactly these:
>   - `#FFFFFF` — paper / page background
>   - `#E4E4E7` — light fill (containers, inputs, image placeholders, separators)
>   - `#71717A` — mid (borders, secondary text, icon strokes)
>   - `#18181B` — ink (primary text, primary action fills)
>
>   Each gray has one job. Pick the right depth for the role — don't
>   introduce a 5th value to make something "stand out". Adjust
>   contrast *within* the four instead (a primary action is the only
>   `#18181B` fill on a `#FFFFFF` page; a secondary action sits at
>   `#71717A` border on `#FFFFFF`; a tertiary at `#E4E4E7` fill).
>   **No brand colors. No tints.**
>
> - **Gradients are permitted only when the rendered design itself
>   implies one** — a hero with a fade-to-bottom overlay, a
>   gradient-fill button, a vignette behind floating content, a
>   skeleton-loading shimmer. In those cases, the gradient
>   interpolates between two of the four grays (e.g. `#E4E4E7 →
>   #71717A` for a subtle fade, `#18181B → transparent` for a
>   vignette, `#FFFFFF → #E4E4E7` for a section divider). The
>   gradient communicates intent at the design level — it is not an
>   addition to the palette and does not introduce a 5th gray.
> - **Typography**: only 3 sizes — `headline` (24/32 medium),
>   `body` (14/20 regular), `label` (11/16 medium uppercase tracked).
>   One sans-serif family throughout (Inter or whatever Pencil
>   defaults to). No type scale, no display sizes.
> - **Shapes**: rectangles, rounded rectangles (radius 4px or 8px max),
>   circles, straight lines. No shadows except a single subtle drop
>   shadow on elevated containers (cards, popovers).
> - **Text content**: descriptive labels, **not lorem ipsum**. A button
>   labeled "Save changes" not "Lorem ipsum". A form field labeled
>   "Email" not a gray rectangle. Real labels make the wireframe
>   readable.
> - **Image / media placeholders**: gray rectangle with a diagonal
>   line through it from corner to corner. Proportional to intended
>   final image. No real images, no Unsplash, no AI-generated.
> - **Avatars**: gray circle with initials or a single user-icon glyph.
> - **Icons**: {{icons-mode}}. Use Font Awesome Solid (free tier) for
>   any icon — `magnifying-glass`, `bars`, `user`, `chevron-down`,
>   `check`, `xmark`, etc. Render at 16 or 20px, monochrome
>   `#3F3F46`. **No custom illustrations.**
> - **No real component APIs** — these are wireframes, not React
>   components. Don't reference HeroUI, MUI, shadcn, or any framework.
>   Frame names use plain English (`button`, `text-input`, `nav-bar`)
>   not API names (`Button.Root`).
>
> ## Page layout
>
> Page dimensions: **{{2200 + (n × 120)}}px wide × {{n × 600 + 200}}px
> tall**, white background, 80px outer padding.
>
> ### Row structure (repeated N times, one per exploration)
>
> Each row is a horizontal band, **560px tall**, with these zones from
> left to right:
>
> 1. **Header column** (220px wide, full row height) — vertical block
>    on the far left containing:
>    - The exploration **letter + name** at the top (e.g. "A — Form"),
>      headline size, bold.
>    - The **axis variation** description (e.g. "steps = single-screen")
>      in label size, gray-500.
>    - A **2–3 line summary** of what this approach prioritizes
>      (e.g. "All-at-once. Fastest for confident users. Higher
>      cognitive load. Best for short forms.") in body size.
>    - At the bottom: a small **trade-offs** callout listing 2–3
>      bullets of what this approach gives up.
> 2. **Screens flow** (remaining width) — the user's journey through
>    the story, screens laid out **left to right** at
>    **{{device-width}}px wide each** ({{device-width === 1440 ?
>    'screens shown at 0.4× scale = 576px' : device-width === 768 ?
>    'screens shown at 0.6× scale = 460px' : '0.8× scale = 312px'}}
>    so they fit horizontally), with **48px gaps** between screens.
>    Each screen is a thin-bordered rectangle with the page chrome
>    rendered inside.
>
> ### Per-screen contents (every screen in every row)
>
> - **Title bar** at the top of the screen frame: screen number
>   (`1 / 4`), screen name (`Email entry`), state in corner
>   (`Empty`, `Filled`, `Loading`, `Error`, `Success`).
> - **Page chrome** appropriate to the device — minimal browser bar
>   for desktop (URL bar suggesting where the user is), status bar +
>   bottom indicator for mobile.
> - **Page content** — wireframe rendering of the screen using the
>   visual language above. Fill the screen frame with realistic
>   content blocks at the right hierarchy (heading, body, controls,
>   navigation).
> - **Annotation arrows** pointing to interactive elements with a
>   label (e.g. "Tap to expand", "Submit on Enter", "Validates on
>   blur"). Use `#71717A` thin lines, 11px italic labels.
>
> ### Between screens (within a row)
>
> A **transition arrow** between each pair of adjacent screens, with a
> label describing the trigger and any conditional outcome:
>
> - `→ Tap Continue`
> - `→ Submit form succeeds`
> - `→ Validation fails (back to screen 2)`
>
> Use a curved or right-angled arrow if a screen leads back to an
> earlier one (e.g. an error state returning the user to the previous
> step). The flow must be **legible left to right** — the success path
> goes forward; error / branch paths can curve back, but the dominant
> reading direction is forward.
>
> ### Edge cases and error states
>
> Each exploration **must include** at least one error / edge state
> screen (e.g. "Email already registered"), placed inline in the flow
> at the point where it would occur. Render it as a separate screen
> in the row with `Error` in its corner state badge. The transition
> arrow in/out of it makes the branching visible.
>
> Don't enumerate every possible edge state — just the **structurally
> revealing** one for this exploration. Different explorations may
> handle errors structurally differently (inline vs modal vs separate
> page) — that itself is part of the variation.
>
> ## Differences across rows (this is the whole point)
>
> The N explorations **must** be structurally different along the
> chosen axes. Surface-level visual variation (different button
> shapes, different gray shades) is not enough. Concrete checks:
>
> - If `steps` is varied, the screen counts and the role of each screen
>   should differ. A wizard has discrete advancement screens; a
>   single-screen approach has none.
> - If `nav` is varied, the chrome of each screen should reflect the
>   pattern. Modal explorations show a parent screen behind a dim
>   overlay; full-page explorations show the user fully on a new
>   route; drawer explorations show a panel sliding from one side.
> - If `density` is varied, the per-screen content count should
>   visibly differ — sparse screens have a lot of whitespace, dense
>   screens fill the frame.
>
> The **header column** for each row makes this variation explicit
> by stating the axis and value, so the reader compares
> intentionally, not by squinting.
>
> ## Naming
>
> - Page-level frame: `exploration-{{story-slug}}`
> - Row frames: `row-A`, `row-B`, `row-C`, …
> - Header columns: `row-A-header`, etc.
> - Screen frames: `row-A-screen-1`, `row-A-screen-2`, …
> - Annotation labels: kebab-cased role names
>   (`primary-action`, `error-message`, `progress-indicator`).

## Phase 4 — Execution

Use Path A (MCP) preferentially since explorations are visual-heavy
and benefit from `get_screenshot` introspection mid-build to verify
each row before moving on. CLI fallback works too.

```bash
pencil --out design/explorations/{{story-slug}}.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

After Pencil finishes, **screenshot each row independently** and save
to `design/explorations/.previews/{{story-slug}}/row-{A,B,C}.png`.
These per-row previews are useful for stakeholder review without
opening the full `.pen` file — paste them into a PR description, a
Slack thread, etc.

## Phase 5 — Verify

Screenshot the full page. Check:

1. N rows present, each with the correct header column + screen flow.
2. Every screen has a title bar with state badge.
3. Every screen has at least one annotation arrow with a label.
4. Every adjacent screen pair has a transition arrow with a label.
5. Each row has at least one error / edge state screen.
6. The variation across rows is structural, not just cosmetic
   (verify by reading the header summaries — they should describe
   different approaches, not different visual treatments).
7. **Palette discipline**: extract every unique fill / stroke / text
   color in the `.pen` and confirm the set is a subset of
   `{#FFFFFF, #E4E4E7, #71717A, #18181B}`. The only permitted
   exception is **gradient fills**, and only when:
   - The gradient interpolates between two of the four grays (no
     third color appears mid-gradient).
   - The element it fills genuinely implies a gradient at the design
     level (hero overlay, vignette, fade, shimmer, gradient button).
     Gradients used decoratively to "add visual interest" fail —
     wireframes communicate structure, not visual interest.

   If a 5th gray slipped in (a designer using `#A1A1AA` for "just
   slightly different gray"), refine in place: it should resolve to
   one of the four canonical grays based on the role.

If any check fails, run a single refinement pass; if it still fails,
stop and report.

## Reporting

End with:

```
✅ design/explorations/{{story-slug}}.pen
   Explorations: 3 (A — Form, B — Wizard, C — Reveal)
   Screens per row: 4 (avg)
   Edge states: 3 (one per row)
   Device: desktop (1440px screens at 0.4× scale)

🖼  Per-row previews:
   design/explorations/.previews/{{story-slug}}/row-A.png
   design/explorations/.previews/{{story-slug}}/row-B.png
   design/explorations/.previews/{{story-slug}}/row-C.png

📐 Variation axes covered:
   steps:    single-screen (A) ⇄ wizard (B) ⇄ progressive (C)
   nav:      consistent across rows (not the varied axis)
   density:  consistent across rows (not the varied axis)

📝 Suggested next:
   - Review with stakeholders, pick a direction
   - /product:design:design-page <type> --based-on design/explorations/{{story-slug}}.pen[#row-X]
     to promote the chosen exploration into a high-fidelity page
```

The `--based-on` flag on `design-page` doesn't exist yet — when one is
added, this command's output becomes the natural feed for it.

## Idempotency

Re-running with the same story slug:

1. Reads the existing `.pen` if present.
2. By default, **adds** a new row to the file rather than replacing
   it — exploration is iterative, you may want to add a 4th approach
   after seeing the first 3.
3. Pass `--replace` to wipe and regenerate from scratch.
4. Pass `--replace-row <letter>` to regenerate one specific row
   (e.g. "row B's wizard pattern wasn't quite right — try again").

## What this command does NOT do

- It does not produce framework-bound code or component references.
  Explorations are pre-framework artifacts.
- It does not apply `_context.md` rules 1–8 (compound APIs, BEM,
  variants, tokens, theme coverage, breakpoints). Wireframes don't
  carry that vocabulary yet.
- It does not consult the foundation manifests (typography, colors,
  icons, tokens). Foundations describe the design system; wireframes
  describe alternatives to the design itself.
- It does not write to the build manifest. Explorations are not
  tracked by `/audit` — they're throwaway-by-design until
  promoted to a page.
- It does not generate responsive variants. The output is a single
  device target. Use `--device mobile` for mobile flows, but each
  invocation is one device.

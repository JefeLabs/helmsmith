---
description: Generate the motion foundations page (duration tokens, easing curves, choreography rules, reduced-motion behavior). Establishes the @theme motion tokens every component references for transitions.
argument-hint: [--reduced-motion strict|standard]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/motion.pen` and write the motion tokens to
`@theme`. Without this foundation, every interactive component invents
its own duration and easing — the system feels uncoordinated within
five components.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Locate the `@theme` source CSS file (same detection as
   `colors-select`).
3. Resolve `--reduced-motion`:
   - `strict` (default for K-12 / accessibility-first products):
     `prefers-reduced-motion: reduce` collapses all durations to 0ms,
     transitions become instant.
   - `standard`: reduce-motion shortens durations by ~75% but keeps
     a small transition for spatial context.

## Token set written to `@theme`

```css
@theme {
  /* Motion durations */
  --motion-duration-instant: 0ms;
  --motion-duration-fast:    150ms;   /* hover, focus, small UI shifts */
  --motion-duration-base:    200ms;   /* default for most interactions */
  --motion-duration-slow:    300ms;   /* page transitions, large changes */
  --motion-duration-slower:  500ms;   /* dramatic emphasis, modals */
  --motion-duration-slowest: 700ms;   /* hero animations, attention pulls */

  /* Easings */
  --motion-ease-linear:      linear;
  --motion-ease-in:          cubic-bezier(0.4, 0, 1, 1);          /* accelerate (entering) */
  --motion-ease-out:         cubic-bezier(0, 0, 0.2, 1);          /* decelerate (default) */
  --motion-ease-in-out:      cubic-bezier(0.4, 0, 0.2, 1);        /* smooth both ends */
  --motion-ease-back-in:     cubic-bezier(0.68, -0.55, 0.27, 1);  /* slight overshoot in */
  --motion-ease-back-out:    cubic-bezier(0.18, 0.89, 0.32, 1.28);/* slight overshoot out */
  --motion-ease-spring:      cubic-bezier(0.5, 1.6, 0.6, 1);      /* bouncy, playful */

  /* Choreography — stagger delays for sequenced reveals */
  --motion-stagger-fast:     30ms;
  --motion-stagger-base:     50ms;
  --motion-stagger-slow:     80ms;

  /* Composite tokens — most components reference these */
  --motion-transition-fade:    opacity var(--motion-duration-base) var(--motion-ease-out);
  --motion-transition-slide:   transform var(--motion-duration-base) var(--motion-ease-out);
  --motion-transition-color:   background-color var(--motion-duration-fast) var(--motion-ease-out),
                               border-color var(--motion-duration-fast) var(--motion-ease-out),
                               color var(--motion-duration-fast) var(--motion-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  @theme {
    --motion-duration-instant: 0ms;
    --motion-duration-fast:    0ms;
    --motion-duration-base:    0ms;
    --motion-duration-slow:    0ms;
    --motion-duration-slower:  0ms;
    --motion-duration-slowest: 0ms;
  }
}
```

`standard` mode keeps `--motion-duration-fast: 50ms` and base/slow at
`80ms` instead of 0ms — a small motion preserves spatial context for
users who need it but tolerate some animation.

## Embedded prompt

> Build a Pencil page named **`Foundations / Motion`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between sections.
>
> ### Section 1 — Duration scale
> Six rows, one per duration (`instant`, `fast`, `base`, `slow`,
> `slower`, `slowest`). Each row shows: token name, value in ms, a
> 600px-wide animated demo strip (a circle moving left-to-right with
> that duration applied — Pencil supports motion via prototype links),
> and a "best for" caption (`hover` / `default` / `page transition` /
> `modals` / `hero attention`).
>
> ### Section 2 — Easing curves
> Seven cards (`linear`, `ease-in`, `ease-out`, `ease-in-out`,
> `back-in`, `back-out`, `spring`). Each card shows the cubic-bezier
> curve plotted on a 160×160 grid, the token name, the bezier values,
> and a one-line "feel" description (`accelerating, harsh end` /
> `decelerating, default` / `smooth both ends` / etc.).
>
> ### Section 3 — Composite transitions
> Three demo cards showing `--motion-transition-fade`,
> `--motion-transition-slide`, `--motion-transition-color` applied to
> sample atoms (a button that fades in, a card that slides up, a chip
> that color-shifts on state change). These are the tokens components
> reference 90% of the time.
>
> ### Section 4 — Choreography (stagger)
> A grid of 6 atoms appearing in sequence, with `--motion-stagger-base`
> between each. Show the stagger delay annotated with a callout. Used
> for list reveals, grid populations, and toast cascades.
>
> ### Section 5 — Reduced-motion behavior
> Side-by-side comparison: standard motion vs reduced-motion. A button
> hover state, a modal open, and a toast slide-in shown under both
> modes. Annotate the `prefers-reduced-motion` media query.
>
> ### Naming
> - Token labels reference the CSS variable, never raw ms values
> - Demo strip frames: `demo-{{token-name}}`
> - All transitions in the demos use the actual `@theme` token, not
>   inline cubic-bezier values

## Execution

```bash
pencil --out design/foundations/motion.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 6 duration rows, 7 easing cards, 3
composite-transition demos, 1 stagger demo, reduced-motion comparison
visible. The `@theme` write must be atomic — if either the CSS write
or the `.pen` generation fails, roll back both.

## Component contract

After this foundation is written, every component's transition must
reference these tokens. The Phase 3 lint sweep in `build-components`
extends to flag inline `transition: 200ms ease-out` and similar —
they should be `transition: var(--motion-transition-color)` or use
the duration/easing tokens directly.

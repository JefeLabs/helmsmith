---
description: Build phase reference — Path A, extend an existing component (Step 2 of /core:frameworks:heroui:build-components). Modification loop with BEFORE/AFTER snapshots, pixelmatch regression and design-fidelity gates, and a max-5 retry budget. Loaded by the orchestrator when a match was found and --mode permits extension; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — Path A: extend an existing component (Step 2)

Triggered when an existing match was found and `--mode` permits.

1. **Take BEFORE snapshots** (this is the regression baseline):
   - Storybook: for each existing story file
     (`<component>.stories.tsx`), run the Storybook test runner with
     Playwright and save screenshots into
     `tests/__regression__/<component>/before/storybook/`. One PNG
     per story variant.
   - Web app usages (only if `--web-app-url` is set): grep the codebase
     for imports of this component, derive the routes that render
     them, hit each route via Playwright, screenshot the bounding
     box of the component instance, save to
     `tests/__regression__/<component>/before/usages/`.
2. **Modification loop** (max 5 iterations):
   1. Make the targeted change. Constraints:
      - Only modify slots / classNames / variants — don't change the
        public API unless the Pencil frame mandates a new prop.
      - All new style decisions go through `tailwind-variants` slot
        composition; never inline `className` strings on rendered DOM
        of HeroUI components if a `classNames` prop slot exists.
      - Token references only — `bg-accent`, `text-content-1`,
        `border-separator`. No hex.
   2. **Take AFTER snapshots** identical to the BEFORE set: same
      Storybook stories, same web-app routes, save under `after/`.
   3. **Pixelmatch regression**:
      ```bash
      # For each story screenshot
      npx pixelmatch \
        tests/__regression__/<comp>/before/storybook/<story>.png \
        tests/__regression__/<comp>/after/storybook/<story>.png  \
        tests/__regression__/<comp>/diff/storybook/<story>.png   \
        $W $H $variance
      ```
      Exit code 0 = within threshold; non-zero = regression. Repeat
      for every web-app usage screenshot.
   4. **Pixelmatch design fidelity**:
      ```bash
      npx pixelmatch \
        tests/__pencil__/<comp>/design.png       \
        tests/__regression__/<comp>/after/storybook/<canonical>.png \
        tests/__pencil__/<comp>/diff.png         \
        $W $H $designVariance
      ```
      The "canonical" story is the one matching the Pencil frame variant
      (default state, primary color, md size, etc.).
   5. **Exit when both pass** (regression ≤ variance AND design fidelity
      ≤ designVariance). On failure, narrow the change: which specific
      style/slot caused the regression? Revert and try a smaller delta.
   6. **Responsive gate** (only if frame width > 400px) — after the main
      loop exits, run the responsive gate (`_build-phases/responsive.md`)
      against the modified component. If the gate fails, the existing
      component may have been responsive-incomplete before this change too —
      treat as a finding to surface, but block the build until fixed.
   7. **Hit max iterations**: stop, print the smallest-diff snapshot,
      ask the user how to proceed.
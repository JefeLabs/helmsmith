---
description: Build phase reference — responsive gate (Step 3.5 of /core:frameworks:heroui:build-components). Runs only for components whose default Pencil frame exceeds 400px width; verifies design-code parity (no missing/phantom breakpoint utilities), pixelmatches at every breakpoint width in scope, and runs layout-pathology checks. Loaded by the orchestrator after the main per-component build loop; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — responsive gate (Step 3.5)

Per `_context.md` rule 7: any component whose default Pencil frame
exceeds **400px in width** must pass at every Tailwind breakpoint in
its scope. This step runs only for those components and **must pass**
before Step 4 (interaction tests) starts.

1. **Compute the component's scope** (which breakpoints apply):
   - Read the manifest's usage map. Identify every page that uses this
     component.
   - Union the breakpoint sets of those pages. (Pages canvas frames
     declare which of `desktop / tablet / mobile` they exist at; map
     those onto the Tailwind ladder.)
   - Shared atoms with no page reference yet → full ladder
     (`xs, sm, md, lg, xl, 2xl`).
   - Components inside a fixed-width container (e.g. a 480px sidebar
     panel) → inherit the container's range, not the viewport's.

2. **Verify Pencil variants exist for every layout-transition
   breakpoint**:
   - Read the component canvas. Each frame should be labeled with a
     breakpoint range (`xs–sm`, `md`, `lg–2xl`).
   - Build the **expected transition set** from those labels: every
     boundary where one range ends and the next begins is a designed
     transition.
   - If the scope contains breakpoints not covered by any frame → stop
     and report. Ask the user to extend the `.pen` via
     `/product:design:design-page` or manual edit. **Never** synthesize
     responsive behavior from a single-frame design.

3. **Static check on the implementation** — design-code parity:
   - Scan the component file (and any `tailwind-variants` slot
     definitions) for breakpoint utilities (`sm:`/`md:`/`lg:`/`xl:`/`2xl:`)
     and container queries (`@container` + `@sm:` etc.).
   - **Fail on missing utility**: every transition in the expected set
     must have a corresponding utility prefix in the code. If the `.pen`
     shows a transition at md (e.g. `flex-col` → `flex-row`) but the
     code has no `md:` on the relevant property → design-code drift.
   - **Fail on phantom utility**: every breakpoint utility in the code
     must correspond to a transition in the expected set. Extra
     `xl:` prefix with no design transition at xl → developer added a
     non-designed responsive change. Either extend the `.pen` or
     remove the code.
   - Acceptable alternatives to breakpoint utilities for a given
     transition: container query (when the component lives in a
     fluid container), `useMediaQuery` / `useResponsiveValue`
     (when the transition needs genuinely different DOM, e.g. a
     desktop dropdown vs a mobile bottom sheet — same component, two
     trees).

4. **Visual + pathology check at every breakpoint width in scope**:

   For each test width in `[360, 640, 768, 1024, 1280, 1440]` ∩ scope:

   - Render the canonical story inside a wrapping div of that width
     (or set the Playwright viewport accordingly).
   - Pixelmatch against the matching Pencil variant for that
     breakpoint range. Save the diff to
     `tests/__pencil__/<comp>/responsive-<width>.diff.png`.
   - **Layout pathology checks** that pixelmatch can miss, applied at
     every width:
     - Horizontal overflow: `el.scrollWidth > containerWidth` → fail
     - Mid-word truncation without `truncate` / `line-clamp` → fail
     - Touch targets below 44px square (only enforced at `<md` widths
       where touch is the primary input) → fail
     - Hidden interactive content with no fallback (e.g. a
       desktop-only menu with no equivalent narrow-viewport surface)
       → fail
     - Overflowing fixed-positioned elements (popover, dropdown
       trigger going off-screen at narrow widths) → fail

5. **Loop the responsive fix** (max 3 iterations per breakpoint, across
   all breakpoints — so up to 3 × `len(scope)` total before timing
   out):
   - On gate failure at width `W`, identify whether it's a missing
     breakpoint utility, a wrong-direction reflow at that breakpoint,
     a hidden-chrome decision (secondary actions need to collapse to
     a Dropdown trigger at narrow widths), or a fundamental DOM
     shape mismatch (calls for `useMediaQuery`-driven dual-render).
   - Adjust `tailwind-variants` slots, JSX, or branching logic.
   - Re-run static + visual checks for **all** breakpoints, not just
     the failing one — fixes at one width can break another.
   - Exit when every width in scope passes.
   - On hit, ask the user with the smallest-diff summary across all
     breakpoints.

6. **Update Storybook stories to cover every breakpoint range**, one
   story per range (not mechanically per breakpoint):

   ```tsx
   // For a component with transitions at md and lg:
   export const Mobile: Story = {
     args: { /* same as Default */ },
     parameters: { viewport: { defaultViewport: 'iphone14' } },
     decorators: [(S) => <div className="w-[360px]"><S /></div>],
   };
   export const Tablet: Story = {
     args: { /* same as Default */ },
     decorators: [(S) => <div className="w-[768px]"><S /></div>],
   };
   export const Desktop: Story = {
     args: { /* same as Default */ },
     decorators: [(S) => <div className="w-[1440px]"><S /></div>],
   };
   ```

   The story names match the breakpoint ranges from the `.pen`'s
   labels (`Mobile` for `xs–sm`, `Tablet` for `md`, `Desktop` for
   `lg–2xl`, etc.). Future regression sweeps pick these up
   automatically.
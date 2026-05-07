---
type: workflow
outcome: Add a feature to existing project
description: Add a new feature, page, or capability to a project that already has Pencil set up. Brand is settled; foundations are stable; components exist.
estimatedDuration: 2-6 hours per feature
phases: 7
prerequisites:
  - product/.pencil-brand.json exists (brand is defined)
  - design/foundations/* exists (foundations are rendered)
  - design/heroui/components/* exists (components exist)
  - src/components/* exists (React foundation built)
---

# Workflow — Brownfield: Add Feature

> **When to use**: shipping a new feature in a Pencil-managed
> project. The design system is already set up; you're producing a
> new page (or set of pages) within that system.
>
> **When NOT to use**:
> - Greenfield setup → use `greenfield`
> - Iterating on a story already in flight → use `brownfield-improve-story`
> - System-wide brand refresh → use `brand-refresh`

## Outputs of a complete run

- `design/briefs/<feature-slug>.md` (brief + derived stories)
- `design/explorations/<feature-slug>.pen` (low-fi structural alts)
- `design/pages/<feature-slug>.pen` (high-fi production design)
- `src/pages/<feature-slug>.tsx` (or equivalent React)
- Optional new pattern instances if the feature needs them

## Phase 1 — Pre-flight audit

**Prerequisite**: brand + foundations + components established
(per the workflow prerequisites above).

Run audit first to catch any drift before you build on top of a
shaky base.

```bash
/audit
```

Address any `fail`-severity findings before proceeding. Warnings
can be deferred.

If `open-pencil` is installed, audit's Plane 1 augmentation runs
design-layer linting on existing `.pen` files (color contrast,
naming, layout, accessibility). This is opt-out via
`--no-design-lint` if pre-existing design-layer drift is high and
you want to address it separately from this feature work.

**Why first**: building a new feature on drift makes the new feature
inherit that drift. Catching it now is cheaper than catching it
later via the new feature's regressions.

**Mark complete**: `/core:workflows:manage complete pre-flight-audit`

## Phase 2 — Brief

Capture the feature's intent. The brief format prompts for goal,
inputs, outcomes, anti-goals (per `product/design/brief.md`).

```bash
/product:strategy:brief
# (Interactive — prompts for slug, goal, inputs, outcomes)
```

After this, `design/briefs/<feature-slug>.md` exists with intent
captured but stories not yet derived.

**Tip**: keep the brief focused on **outcomes** ("user can save a
search and find it later"), not **steps** ("user clicks button → form
opens → ..."). The steps come from the design phase, not the brief.

**Mark complete**: `/core:workflows:manage complete brief`

## Phase 3 — User stories

Derive formal user stories from the brief:

```bash
/product:strategy:user-stories <feature-slug>
```

Stories are written into the brief's "Derived user stories" section.
Review them — if any are vague or capture process instead of
outcome, refine the brief and re-run.

**Mark complete**: `/core:workflows:manage complete user-stories`

## Phase 4 — Exploration (low-fi)

Generate N structural alternatives for one of the user stories:

```bash
/product:design:explore "<one of the derived stories>"
```

This produces `design/explorations/<story-slug>.pen` with N rows
(default 3) showing distinct structural approaches. The exploration
is intentionally low-fidelity — strict 4-gray palette, FA Solid
icons — so reviewers focus on structure, not aesthetics.

**Decision**: pick one row before proceeding. Note the row index.

**Mark complete**: `/core:workflows:manage complete explore`

## Phase 5 — Page design (high-fi)

**Decision**: are you doing direction-set refinement, or going
direct?

- **Direct mode** (most brownfield features): brand is settled;
  apply the chosen exploration row in the brand's existing
  treatment.

  ```bash
  /product:design:design-page <page-slug> \
                      --based-on design/explorations/<story>.pen#row-2
  ```

- **Direction-set refinement** (only if this feature warrants
  brand-direction exploration — rare in brownfield): generate a
  multi-direction grid, pick one, finalize.

  ```bash
  /product:design:design-page --based-on design/explorations/<story>.pen \
                      --page-set saas --directions 3
  # Review the grid, pick direction B
  /product:design:design-page --finalize B
  # Then per-page design:
  /product:design:design-page <page-slug> --based-on design/explorations/<story>.pen
  ```

  Direction-set in brownfield is unusual — usually only when the
  feature is a major visual departure (e.g. a new product line
  within an existing brand).

After this phase, `design/pages/<page-slug>.pen` has the full atomic
decomposition (atoms, molecules, organisms, template, page).

**Mark complete**: `/core:workflows:manage complete design-page`

## Phase 6 — Build React

Generate the React for the new page:

```bash
/core:frameworks:heroui:build-components <page-slug>
```

This walks the page's atomic decomposition and produces:
- `src/pages/<page-slug>.tsx` (or your project's page directory)
- Any new atoms / molecules / organisms not already in
  `src/components/*` — flagged as synthesized

Review synthesized atoms — should they be promoted to the design
system? If yes, move their `.pen` definition to
`design/heroui/components/<group>.pen` and re-run scaffold for that
group.

**Mark complete**: `/core:workflows:manage complete build`

## Phase 7 — Audit + ship

Run the post-feature audit:

```bash
/audit
```

This catches:
- New patterns not registered (Plane 7a)
- New tokens that drifted from foundation (Plane 3)
- Inline arbitrary values from rushed implementation (Plane 1)
- Brief-outcome drift (Plane 6) if the brief had outcomes worth
  tracking

Address `fail`-severity findings. Warnings can be deferred but
should be logged for cleanup.

Then ship via your project's normal PR / merge process. The
`/product:strategy:ci.md` reference covers gating recommendations for
PR validation.

**Optional — designer review checkpoint.** Before merging, export
the finalized page to `.fig` for designer sign-off:

```bash
/product:design:export design/pages/<page-slug>.pen --to figma
```

If review surfaces changes, use `/product:design:export --from-fig
--diff-merge` to bring them back. The full review loop is
documented in the `figma-roundtrip` workflow — invoke it as a
nested workflow if review will span multiple sessions.

**Mark complete**: `/core:workflows:manage complete ship`

## Workflow complete

The feature is now part of the Pencil-managed system. Future
brownfield improvements (improve-page, improve-story) can target it.

## Resume points

- **Paused after Phase 2 (brief)**: stories not derived. Resume runs
  user-stories.
- **Paused after Phase 3 (stories)**: stories ready, exploration not
  run. Resume runs explore on one of the stories.
- **Paused after Phase 5 (design)**: page designed but not built.
  Resume runs build-components.
- **Paused mid-Phase 6 (build)**: build-components tracks per-component
  progress in the build manifest. Resume continues from the next
  unbuilt component.

## Troubleshooting

- **Phase 1 audit fails**: existing system has drift. Either fix it
  (rerun affected commands) or accept the drift if cosmetic — but
  don't ignore `fail`-severity findings; they'll cascade into the
  new feature.
- **Phase 4 exploration produces low-quality alternatives**: brief is
  too vague. Refine the brief (Phase 2 again) with more concrete
  inputs and re-run user-stories.
- **Phase 5 produces components that already exist**: the page used
  patterns / components without recognizing existing ones. This is
  Plane 7a (composition) territory — review the page's atomic
  decomposition and replace inline atoms with imports from existing
  components.
- **Phase 6 build fails on missing imports**: the page references
  patterns that haven't been built into React yet. Run
  `/core:frameworks:heroui:build-components --include-patterns` first to
  produce the React for any composed patterns.

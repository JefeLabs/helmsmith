---
type: workflow
description: Iterate on a user story already in flight. The brief exists, the design is partway done, feedback came in that requires going back upstream.
estimatedDuration: 1-3 hours per iteration
phases: 6
prerequisites:
  - design/briefs/<slug>.md exists
  - At least one downstream artifact exists (exploration or page)
---

# Workflow — Brownfield: Improve Story (Mid-Flight)

> **When to use**: stakeholder feedback on a work-in-progress story
> requires re-deriving downstream artifacts. The brief was OK but
> outcomes shifted; or stories were OK but exploration revealed a
> better structural approach; or the page design surfaced a story
> gap.
>
> **When NOT to use**:
> - Brief never started → use `brownfield-add-feature` from the start
> - Story complete and shipped → use `brownfield-improve-page`
> - Multiple stories all need rework → run this once per story, or
>   for systemic issues use `brand-refresh`

## Outputs of a complete run

- Updated `design/briefs/<slug>.md` (refined brief + re-derived stories)
- Updated `design/explorations/<story>.pen` (or new exploration)
- Updated `design/pages/<page-slug>.pen` (refined page)
- Updated `src/pages/<page-slug>.tsx` (regenerated React)

## Phase 1 — Identify what feedback changes

**Prerequisite**: brief exists; at least one downstream artifact
exists.

Categorize the feedback:

- **Outcome change**: a stated outcome is wrong or missing. Goes
  back to brief.
- **Persona / user-context change**: who's the audience changed.
  Goes back to brief or stories.
- **Story decomposition issue**: stories don't capture the actual
  flow well. Goes back to user-stories.
- **Structural feedback**: the layout / flow doesn't match the
  story. Goes back to explore.
- **Visual feedback**: the design doesn't feel right. Goes back to
  design-page.
- **Combination**: most real feedback is two of these. Identify each
  and address upstream-first.

The category determines how far up the pipeline you go. The flow
goes upstream-first because each step regenerates downstream.

**Action**: write down the feedback categorization.

**Mark complete**: `/workflows:manage complete identify-feedback`

## Phase 2 — Refine the upstream artifact

**Prerequisite**: Phase 1 done.

Based on Phase 1 categorization:

### If feedback is outcome-level

Refine the brief:

```bash
/product:strategy:brief <slug> --refine "the outcome 'user can save searches' was wrong — should be 'user can find their saved searches from any page'"
```

This rewrites `design/briefs/<slug>.md` with refined outcomes.

### If feedback is story-level

Re-derive stories from the existing brief:

```bash
/product:strategy:user-stories <slug>
```

The command re-reads the brief and generates fresh stories, which
might differ from the previous derivation if the brief was edited
or if the LLM got smarter on this run.

### If feedback is structural

Re-run exploration with the new constraints:

```bash
/product:design:explore "<refined story or original story with new constraint>" --based-on design/pages/<existing-page>.pen
```

The `--based-on` references the existing page so the exploration
shows alternatives that diverge from what's there.

### If feedback is visual / direction-level

Run a direction-set on the existing page:

```bash
/product:design:design-page --in design/pages/<page>.pen \
                    --based-on design/pages/<page>.pen \
                    --page-set saas --directions 3
```

Review directions, finalize the chosen one. This is unusual mid-
story; usually visual feedback is handled at design-page time.

### If feedback came back as a designer's edited `.fig`

A designer reviewed the work-in-progress export, iterated visually
in Figma, and sent back the modified `.fig`. This is a common
async pattern when designer and developer are different people.

```bash
# Surgical control — review each change before applying:
/product:design:export design/pages/<page>.pen --from-fig <designer-edit>.fig --diff-merge

# Or simple overwrite (with backup) when the changes are universally
# accepted and a quick pass is fine:
/product:design:export design/pages/<page>.pen --from-fig <designer-edit>.fig
```

After the import, the `.pen` carries the designer's edits and
Phase 3 onward (re-derive downstream) cascades from there. See
`figma-roundtrip` workflow for the full review-and-iterate loop
when the cycle spans multiple sessions.

**Mark complete**: `/workflows:manage complete refine-upstream`

## Phase 3 — Re-derive downstream artifacts

**Prerequisite**: Phase 2 done — upstream artifact refined.

Walk down the pipeline from the refined artifact, regenerating
each downstream artifact:

```
brief → user-stories → explore → design-page → build-components
```

Run only the steps below the refined artifact:

- If brief was refined: re-run user-stories, then re-run explore on
  any affected stories, then re-design pages.
- If stories were refined: re-run explore, then re-design pages.
- If exploration was refined: re-run design-page.
- If design-page was refined: re-run build-components.

```bash
# Example: brief was refined
/product:strategy:user-stories <slug>
# Pick the new / changed story
/product:design:explore "<the changed story>"
# Pick a row
/product:design:design-page <page-slug> --based-on design/explorations/<story>.pen#row-2 \
                                --replace
```

Use `--replace` flag at design-page when overwriting the existing
page. Without it, you'd get a competing page with the same slug.

**Mark complete**: `/workflows:manage complete re-derive`

## Phase 4 — Visual diff (was-vs-now)

**Prerequisite**: Phase 3 done.

Capture how the iteration changed things:

```bash
/product:design:diff design/.snapshots/<page>-before.pen design/pages/<page>.pen \
              --label-a "before-feedback" --label-b "after-iteration"
```

This produces an HTML report summarizing what changed. Useful for:
- Stakeholder review (showing them what their feedback produced)
- Self-review (catching unintended changes)
- Documentation (preserving the iteration history)

**Tip**: if you didn't snapshot before iterating, use git to recover
the prior `.pen` and run diff against that.

**Mark complete**: `/workflows:manage complete visual-diff`

## Phase 5 — Build React

```bash
/frameworks:heroui:build-components <page-slug>
```

Same as the build phase in other workflows. The build manifest
tracks the iteration's impact on shared components.

**Mark complete**: `/workflows:manage complete build`

## Phase 6 — Audit + verify

```bash
/audit
```

Specific watch-fors after iteration:

- **Plane 6 (brief drift)**: did the iteration introduce outcomes
  not addressed by components? Audit surfaces this if briefSlug
  threading is intact.
- **Plane 1 (code drift)**: did the iteration drop any references
  the previous code had?

If everything passes, the iteration is shipped via PR / merge.

**Mark complete**: `/workflows:manage complete verify`

## Workflow complete

The story has been re-derived and the affected artifacts updated.
The original story slug is preserved (so traceability is intact).

## Resume points

- **Paused after Phase 1 (categorize)**: feedback noted; resume
  picks up at refining the upstream artifact.
- **Paused after Phase 2 (refine upstream)**: the changed brief /
  story / exploration is updated. Resume picks up at re-deriving
  downstream.
- **Paused mid-Phase 3**: workflow tracks which downstream
  artifacts have been re-derived.

## Troubleshooting

- **Story re-derivation produces drastically different stories**:
  brief change was bigger than expected. Either accept the new
  stories (and update the work-in-progress) or refine the brief
  more conservatively.
- **Re-running explore on the same story produces nearly identical
  output**: LLM converged on the same answer. Pass
  `--seed-different` (when implemented) or refine the story
  prompt to get genuinely different alternatives.
- **Design-page --replace lost prior work**: this can happen if
  the prior page had hand-edits. Always snapshot before --replace,
  or use --in instead which refines in place.
- **Iteration broke previously-passing audit**: a downstream
  regeneration introduced drift. Walk back through Phases 3 and 4
  to find where; usually it's because a regenerated artifact lost
  a reference the prior had.

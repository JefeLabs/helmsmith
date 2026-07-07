---
type: workflow
outcome: Run a designer-Figma iteration
description: Designer-in-Figma iteration loop. Source of truth stays in Pencil; designer reviews and iterates in Figma. Tracks "out for review" state so async reviews spanning days don't lose context.
estimatedDuration: 1-5 days per cycle (mostly async wait for designer)
phases: 6
prerequisites:
  - design/pages/<artifact>.pen exists (or other .pen artifact)
  - open-pencil installed (brew install open-pencil OR npm install -g @open-pencil/cli)
  - Designer has Figma access
---

# Workflow — Figma Roundtrip

> **When to use**: source of truth stays in Pencil, but a designer
> prefers to review and iterate in Figma. The cycle has its own
> async cadence — export, hand off, wait days, receive feedback,
> import back. State tracking matters because review may span
> multiple work sessions.
>
> **When NOT to use**:
> - Designer is the same person as the developer → use any
>   brownfield workflow directly
> - Source of truth is moving to Figma → use export with
>   `--migrate-to-figma` (one-time export; not this workflow)
> - Quick visual sanity check → just run `/product:design:export --to figma`
>   without the workflow scaffolding

## Outputs of a complete cycle

- `<artifact>-out-<YYYY-MM-DD>.fig` (the export sent for review)
- `<artifact>-returned-<YYYY-MM-DD>.fig` (the designer's edited
  version, when received)
- Updated `<artifact>.pen` with accepted changes merged in
- `<artifact>-roundtrip-log.md` (decisions log: what was accepted,
  what was rejected, designer rationale)

## Phase 1 — Identify scope

**Prerequisite**: `.pen` artifact exists; designer has been
briefed on what to review.

Decide what's going for review:

- **Single page**: most common. One `.pen`, focused feedback.
- **Page + supporting components**: when the page exercises atoms
  the designer needs to also see in isolation.
- **Foundation review**: brand directions, color palette, type
  scale. Different audience (brand stakeholders typically) but
  same workflow.
- **Full template set**: rare. Multi-week review cycle.

Larger scopes mean longer turnaround and more diff-merge work on
return. Default to smallest meaningful scope.

**Action**: write down (or capture in workflow metadata) the
artifacts going for review.

**Mark complete**: `/core:workflows:manage complete identify-scope`

## Phase 2 — Pre-export preparation

**Prerequisite**: Phase 1 done.

Get the source `.pen` ready for export:

```bash
# 1. Ensure no in-flight changes:
git status design/

# 2. If there are uncommitted changes, decide whether to include
#    them in the review — commit if yes, stash if no.

# 3. Optional but recommended — run audit on the source first.
#    The designer shouldn't be reviewing pre-existing drift:
/audit
```

Address `fail`-severity findings. The designer's feedback should
be on intentional design choices, not pre-existing accidents.

**Mark complete**: `/core:workflows:manage complete pre-export-prep`

## Phase 3 — Export and hand off

**Prerequisite**: Phase 2 done.

Export to `.fig`:

```bash
/product:design:export design/pages/<artifact>.pen --to figma \
  --include-tokens \
  --out design/.review-out/<artifact>-out-$(date +%Y-%m-%d).fig
```

The `--include-tokens` flag bundles a token reference JSON, useful
for designer reference (and for the designer-side audit if they
care about token integrity).

Hand off the `.fig` to the designer. Two patterns:

- **File-based handoff**: send the `.fig` via Slack / Drive / email.
  Designer drags into Figma.
- **Workspace handoff**: ask the designer to upload the `.fig` to
  your team's Figma workspace; share the link with reviewers.

In both, the source-of-truth is the `.pen` file — the `.fig` is a
review artifact.

**Workflow state captures**: `outFor: <designer-name>`,
`outFile: design/.review-out/<artifact>-out-<date>.fig`,
`expectedReturn: <date>`, `status: out-for-review`.

**Mark complete**: `/core:workflows:manage complete export-and-hand-off`

## Phase 4 — Async wait + check-ins

**Prerequisite**: Phase 3 done.

This phase is the async wait. Workflow state preserves "out for
review" so resuming after time away surfaces the open review
clearly:

```
$ /core:workflows:manage status

Active workflow: figma-roundtrip-2026-05-02-100000
Currently:       Phase 4 — async wait
Out for review:  design/.review-out/landing-out-2026-05-02.fig
Sent to:         Designer Name
Expected return: 2026-05-09
```

If review is slow:

- **Day 3+ overdue**: send a check-in. Often the designer is
  waiting on a question they thought you'd see in their comments.
- **Week 2+ overdue**: pause the workflow and continue brownfield
  work in parallel — `/core:workflows:manage pause` saves the state for
  later resume without blocking.

When the designer returns the edited `.fig`:

```bash
# Save the returned file:
mkdir -p design/.review-in
cp <wherever-designer-sent-it>.fig \
   design/.review-in/<artifact>-returned-$(date +%Y-%m-%d).fig
```

**Mark complete**: `/core:workflows:manage complete review-returned`

## Phase 5 — Diff-merge import

**Prerequisite**: Phase 4 done.

Bring designer changes back surgically:

```bash
/product:design:export design/pages/<artifact>.pen \
  --from-fig design/.review-in/<artifact>-returned-<date>.fig \
  --diff-merge
```

The `--diff-merge` flag is the right default here — designer
edits are review feedback, not direct replacements. Each change
surfaces as accept/reject:

```
Diff-merge: ./<artifact>-returned-2026-05-09.fig
            → design/pages/<artifact>.pen

Changes detected: 14

  [1] Hero / desktop / 1440 — copy changed
      Old: "Welcome to Acme — designed for makers"
      New: "Built for builders. Designed for makers."

      [a] Accept   [r] Reject   [s] See full diff   [n] Note

  [2] Hero / mobile / 390 — image position changed
      Old: image right of text
      New: image below text

      [a] Accept   [r] Reject   [s] See full diff   [n] Note

  [3] FeatureGrid — column count changed
      Old: 3 cols at desktop
      New: 4 cols at desktop

      [a] Accept   [r] Reject   [s] See full diff   [n] Note

  ... (11 more)

Apply 11 of 14 accepted changes? [y/N]
```

The `[n] Note` option records a per-change note — useful for the
roundtrip log so future reviewers (or your future self) understand
why something was accepted or rejected.

After accept/reject, the merged `.pen` overwrites the original.
The pre-merge state is preserved as a backup.

Decisions are logged to `design/<artifact>-roundtrip-log.md`:

```markdown
# Figma roundtrip — landing.pen — 2026-05-09

Reviewer: Designer Name
Out:      2026-05-02
Returned: 2026-05-09

## Accepted (11)
- Hero copy: "Built for builders. Designed for makers."
- Hero mobile: image below text
- FeatureGrid: 3 → 4 columns at desktop
- ...

## Rejected (3)
- Footer color shift to --color-accent-700:
  Reason: would cascade to other pages — handle in next brand-refresh
- ...

## Notes
- Designer suggested testimonial placement variant — created as
  follow-up issue
```

**Mark complete**: `/core:workflows:manage complete diff-merge-import`

## Phase 6 — Re-build and verify

**Prerequisite**: Phase 5 done.

Regenerate the React for the updated `.pen`:

```bash
/core:frameworks:heroui:build-components <artifact-slug>
```

Then visual diff to confirm what shipped:

```bash
/product:design:diff design/.review-out/<artifact>-out-<date>.fig \
              design/pages/<artifact>.pen \
              --renderer open-pencil \
              --out design/.diffs/<artifact>-roundtrip.html
```

The `--renderer open-pencil` flag matters here: it ensures the
diff renderer matches the export renderer, so what the diff shows
matches what the designer would see if you re-exported.

Then audit:

```bash
/audit
```

Watch for new design-layer lint findings (when open-pencil is
installed) — designer changes sometimes introduce contrast or
naming issues the designer didn't notice.

**Mark complete**: `/core:workflows:manage complete rebuild-verify`

## Workflow complete

The roundtrip cycle is closed. The roundtrip log is committed for
reference. State moves to history.

For ongoing iteration with the same designer on this artifact,
start a new roundtrip workflow rather than reusing the same one —
each cycle is its own discrete loop.

## Resume points

- **Paused after Phase 1**: scope identified; resume goes to
  pre-export prep.
- **Paused mid-Phase 4 (waiting for designer)**: this is the
  expected pause point. `/core:workflows:manage status` shows "out for
  review" with the expected return date.
- **Paused after Phase 5**: changes merged; resume runs rebuild.

## Troubleshooting

- **Designer returns the wrong file format** (e.g. they exported
  a Figma frame as PNG instead of the file as `.fig`): explain the
  expected format, ask for re-export. The roundtrip needs `.fig`
  for diff-merge to work; PNG only enables visual reference.
- **Diff-merge surfaces zero changes**: designer didn't actually
  edit the `.fig`, or edited a different copy. Confirm with the
  designer; re-request if needed.
- **Diff-merge surfaces too many changes** (every frame "changed"):
  the export's source `.pen` and the returned `.fig` have
  different node IDs. This happens if the designer copy-pasted
  content into a fresh file rather than editing the original.
  Treat as a fresh design rather than a roundtrip — do a
  brownfield-improve-page workflow instead, using the returned
  `.fig` as `--inherit-from`.
- **Designer suggests changes that affect multiple pages**: those
  changes cascade beyond this artifact's scope. Reject in the
  diff-merge for this roundtrip; queue them as a separate
  `brand-refresh` workflow if they're system-wide, or a
  `brownfield-improve-page` cycle for each affected page.
- **Roundtrip log gets out of sync with reality**: the log is a
  snapshot at the time of merge. If the designer follows up with
  more changes after the merge is committed, start a fresh
  roundtrip rather than amending the prior log.

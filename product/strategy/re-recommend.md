---
description: Re-run patterns:select and templates:select to refresh recommendation manifests after research changes. Closes the idempotency gap — when /product:strategy:research is updated, the downstream recommendations need to refresh too.
argument-hint: [--informed-by <research-json>] [--strategy match-conventions|differentiate|hybrid] [--patterns-only] [--templates-only]
allowed-tools: Read, Write, Edit, Bash
---

Refresh the recommendation manifests after research output changes.
This is the small orchestrator that closes the idempotency gap:
when `/product:strategy:research` re-runs (because the landscape shifted, a
new competitor was added, or strategy changed), the downstream
manifests at `product/.pencil-recommended-patterns.md` and
`product/.pencil-recommended-templates.md` need to refresh too.

Without this command, users have to remember to re-run both
`patterns:select` and `templates:select` manually after each
research update — and they often won't, leaving the recommendation
manifests drifted from the current research.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Resolve research source:
   - `--informed-by <research-json>` — explicit path
   - Default: `design/research/<active-brief-industry>.json`
   - If neither exists, error out with instruction to run
     `/product:strategy:research` first
3. Resolve `--strategy`:
   - Default: read from prior recommendation manifest's frontmatter
     (preserves the user's previous choice)
   - Override: explicit flag
4. Read user-overrides from existing recommendation manifests:
   - `[user-forced]` and `[user-excluded]` tags from prior runs
   - Hand-edited additions/removals — preserve unless user passes
     `--reset-overrides`

## Phase 1 — Diff the research

Compare current research JSON to the version referenced by the
existing recommendation manifests:

1. **Read both research timestamps**: current and prior-recommended.
2. **Compute frequency deltas**: which patterns / templates moved
   between tiers (e.g. "feature-grid-bento went from 0.20 to 0.45 —
   was differentiation, now common").
3. **Identify new entries**: patterns or templates appearing in
   current research that weren't in prior.
4. **Identify removed entries**: items dropped from current
   research.
5. **Trend changes**: items where direction flipped (rising →
   declining or vice versa).

Print the diff before regenerating:

```
Research diff vs prior recommendations:

Tier transitions (frequency moved):
  feature-grid-bento:    0.20 → 0.45  niche → common
  hero-video-bg:         0.10 → 0.25  rare → niche
  testimonial-grid:      0.65 → 0.55  common → common (slight)

New entries (not in prior research):
  pattern: ai-feature-callout (freq 0.45, rising trend)

Trend changes:
  feature-grid-bento:    rising → stable
  skeumorphic-buttons:   declining → declining (no change, still avoid)

Continue with refresh? [Y/n]
```

## Phase 2 — Refresh patterns recommendations

Unless `--templates-only` is set:

1. Invoke `/product:design:patterns:select --informed-by <research-json>
   --strategy <strategy>`.
2. The select command runs its full pipeline (frequency
   classification, brand-fit filtering, manifest generation).
3. Preserve user-overrides from prior manifest:
   - `[user-forced]` items are forced again unless user removed them
   - `[user-excluded]` items stay excluded unless user removed them
4. Write updated `product/.pencil-recommended-patterns.md`.

## Phase 3 — Refresh template recommendations

Unless `--patterns-only` is set:

1. Invoke `/product:design:templates:select --informed-by <research-json>
   --strategy <strategy>`.
2. Same flow — preserve user-overrides, regenerate manifest.

## Phase 4 — Diff the recommendation changes

Show the user what changed between old and new recommendation
manifests:

```
Recommendation changes:

Patterns:
  + Added (was: skipped, now: recommended):
      patterns/ai-feature-callout (new in research)
  ↑ Promoted (was: recommended, now: required):
      patterns/feature-grid-bento (frequency rose to 0.45)
  ↓ Demoted (was: differentiation, now: skipped):
      patterns/hero-video-bg (still rare, but trend now stable not rising)

Templates:
  No changes.

User-overrides preserved:
  patterns/testimonial: [user-forced] (kept; was added manually)
```

## Phase 5 — Optional staleness check

After refresh, surface aging research:

```
ℹ️  Research age: 47 days (within freshness window)
```

If research is older than 6 months, suggest re-running
`/product:strategy:research <industry> --update` before relying on the
refreshed recommendations.

## Reporting

```
✅ Recommendations refreshed
   Research source:    design/research/b2b-ed-tech.json (3 days old)
   Strategy:           hybrid
   
   Patterns manifest:  product/.pencil-recommended-patterns.md
                       8 required → 9 required (+ ai-feature-callout)
                       3 recommended → 2 recommended (-bento promoted)
                       1 differentiation → 1 differentiation
                       
   Templates manifest: product/.pencil-recommended-templates.md
                       (no changes)
   
   User overrides preserved: 2 forced, 1 excluded

📝 Next steps:
   - Review manifest deltas in the changes section above
   - Run any newly-required commands:
     /product:design:patterns:ai-feature-callout (newly added)
   - For demoted items, decide whether to keep existing or remove:
     patterns/hero-video-bg (was differentiation, now skipped)
```

## When to use

- **After `/product:strategy:research <industry> --update`** — competitor
  data refreshed
- **After strategy change** — switching from match-conventions to
  differentiate
- **Periodic** — quarterly or per-major-release as a hygiene step
- **Before a major design refresh** — ensure recommendations
  reflect current category state

Don't use:
- After every minor brand JSON change (no impact on recommendations)
- For one-off pattern / template additions (just run the specific
  command directly with `--force` flag in select)

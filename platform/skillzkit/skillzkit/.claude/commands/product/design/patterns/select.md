---
description: Read research.json and recommend which patterns this project should generate, based on industry frequency and differentiation strategy. Outputs a manifest the user reviews; running the recommended patterns is a separate explicit step.
argument-hint: [--informed-by <research-json-path>] [--strategy match-conventions|differentiate|hybrid] [--out <path>] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash
---

Read research output and recommend which patterns this project
should render. Patterns appearing in 75%+ of competitors are
"conventions" (skipping them produces a site that feels off for the
category); patterns under 30% are "opportunities" for differentiation
or "dead patterns" depending on trend direction.

This command is a **selection helper, not a renderer**. It outputs a
manifest of recommended patterns; the user reviews and runs the
actual `/product:design:patterns:<name>` commands separately.

## Where this fits

```
research <industry>                   →   research.json
                                            ↓
patterns:select --informed-by         ◀── THIS — recommends
  research.json                              ↓
                                          recommended-patterns.md
                                            ↓
patterns:hero / patterns:cta / etc.   ◀── user invokes per recommendation
```

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve `--informed-by`:
   - Default: `design/research/<active-brief-industry>.json`
   - Or explicit path
   - If absent, instruct the user to run `/product:strategy:research` first
     and stop. Don't fall back to universal recommendations
     silently — the whole point is research-driven selection.
3. Resolve `--strategy`:
   - `match-conventions` (default for new brands): recommend all
     patterns at frequency ≥ 0.5; skip differentiation
     opportunities. Goal: launch a site that feels at-home in the
     category.
   - `differentiate`: recommend universal conventions (≥0.75) +
     1–3 differentiation opportunities. Goal: visibly distinct
     from category baseline.
   - `hybrid` (recommended for established brands): recommend
     conventions plus 1 well-justified opportunity. Goal: most of
     the brand's distinct-ness comes from execution quality, not
     pattern selection.

## Phase 1 — Read research data

Load the research JSON. Extract:

- `patternFrequency` per pattern
- `trends` array
- `differentiationOpportunities` array

Validate the file:
- Has `patternFrequency` keys
- Has at least 1 surveyed competitor
- Was researched within the last 12 months (older than that, warn —
  the landscape may have shifted)

## Phase 2 — Recommendation logic

Walk every pattern in `patternFrequency` and classify:

| Frequency tier  | Match-conventions | Differentiate | Hybrid |
| --------------- | ----------------- | ------------- | ------ |
| ≥ 0.75 (universal) | **REQUIRED**   | **REQUIRED**  | **REQUIRED** |
| 0.50 – 0.75 (common) | RECOMMENDED  | OPTIONAL      | RECOMMENDED |
| 0.30 – 0.50 (niche) | SKIP          | OPTIONAL      | OPTIONAL |
| < 0.30 (rare)      | SKIP           | DIFFERENTIATION-PICK | DIFFERENTIATION-PICK |

For DIFFERENTIATION-PICK candidates (only in `differentiate` and
`hybrid` strategies):
- Filter to patterns with `trends.direction == "rising"` (avoid
  picking dead patterns)
- Filter to patterns where the brand has the resources / context
  to execute well (e.g. video-hero needs commissioned content;
  don't recommend if budget unclear)
- Cap at 1 (hybrid) or 3 (differentiate)

## Phase 3 — Brand-fit filtering

Some recommendations get filtered based on brand context:

- **Audience-regulation = k-12**: skip `testimonial-photo-real-people`
  patterns (model release issues with minors); recommend
  `testimonial-quote-text-only` instead.
- **Industry = dev-tools**: prefer `hero-screenshot-with-code`
  variants of patterns over `hero-illustration` (engineers respond to
  product imagery).
- **Imagery direction = abstract-only**: skip patterns that require
  people imagery (some testimonial variants).
- **Brand age = greenfield**: lean toward conventions; differentiation
  picks should be small in number until brand has established
  ground.

These filters apply automatically based on brand JSON and brief
context.

## Phase 4 — Generate the manifest

Write `product/.pencil-recommended-patterns.md` (the human-readable
recommendation document):

```markdown
---
generatedAt: <ISO date>
industry: <industry>
strategy: <strategy>
researchAge: <days since research>
---

# Recommended Patterns for {{brand}}

Strategy: **{{strategy}}** — {{strategy-description}}

## Required (universal conventions in this industry)

These patterns appear in 75%+ of surveyed competitors. Skipping any
produces a site that "feels off" for the category.

- [ ] **hero-split-image-right** (80% of competitors)
      Run: `/product:design:patterns:hero` (then select the split-image-right variant)
- [ ] **feature-grid-3x2** (70%)
      Run: `/product:design:patterns:feature-grid`
- [ ] **pricing-3-tier** (80%)
      Run: `/product:design:patterns:pricing-tier`
- [ ] **faq-accordion** (85%)
      Run: `/product:design:patterns:faq`
- [ ] **footer-marketing** (95%)
      Run: `/product:design:patterns:footer`

## Recommended (common in industry)

Present in 50–75% of competitors. Inclusion is a brand-fit decision.

- [ ] **testimonial-grid** (65%) — high-trust signal for B2B
      Run: `/product:design:patterns:testimonial`
- [ ] **cta-section** (60%)
      Run: `/product:design:patterns:cta`
- [ ] **stat-section** (55%) — credibility signal
      Run: `/product:design:patterns:stat-section`

## Differentiation picks ({{strategy}} mode)

{{ if strategy == differentiate or hybrid }}
Selected from <30% adoption with rising trend signals:

- [ ] **feature-grid-bento** (20%, rising trend, conf 0.7)
      Differentiator: modern asymmetric layout signals
      "we keep up with current design"
      Risk: trend may be over-adopted in 18 months
      Run: `/product:design:patterns:feature-grid` (select bento variant)

- [ ] **hero-video-bg** (10%, stable)
      Differentiator: visual sophistication
      Required: brand has commissioned video content OR budget
      Run: `/product:design:patterns:hero` (select video-bg variant)
{{ else }}
None — `match-conventions` strategy skips differentiation picks.
{{ /if }}

## Skipped (low frequency, not differentiation-worthy)

- pricing-comparison-matrix (30%) — only useful when feature
  differences between tiers are detailed enough to warrant a table
- hero-illustration (15%) — declining trend in this category

## Cross-cutting state patterns (always required)

States patterns are universal regardless of industry:

- [ ] **states** — empty / loading / error / optimistic
      Run: `/product:design:patterns:states`

These aren't industry-specific because every product hits these
states.

---

## Summary

- Required: {{n-required}} patterns
- Recommended: {{n-recommended}} patterns
- Differentiation: {{n-differentiation}} patterns
- Total to render: {{n-total}}
- Skipped: {{n-skipped}}

To render all recommended patterns at once:

```bash
{{batch-command-or-instructions}}
```
```

## Phase 5 — Optionally render

Pass `--render-all` to invoke each recommended pattern command in
sequence. Default: print the manifest, let the user review, run
each pattern command separately. The manifest is a checklist.

## Reporting

```
✅ product/.pencil-recommended-patterns.md
   Strategy:        hybrid
   Industry:        B2B ed-tech (research age: 3 days)
   
   Recommendations:
     Required:        5 patterns
     Recommended:     3 patterns
     Differentiation: 1 pattern
     Skipped:         12 patterns (low-frequency, no trend signal)
     Total to render: 9
   
   States foundation: required (cross-cutting, always)

📝 Next steps:
   Review product/.pencil-recommended-patterns.md
   Run each unchecked pattern command, OR pass --render-all to batch
```

## Re-running

The recommendation manifest is regenerated each run (default
behavior). Hand-edits to the manifest (checked boxes, notes) are
preserved when `--update` is passed; otherwise the file is rewritten.

## Override paths

If the user disagrees with a recommendation:

- Force include: `--force <pattern-name>` adds a pattern regardless
  of frequency
- Force exclude: `--exclude <pattern-name>` removes a pattern from
  recommendations
- Both flags can be repeated

The manifest tracks user overrides explicitly so the override log
is auditable: "[user-forced]" or "[user-excluded]" tags appear next
to affected patterns.

---
description: Build phase reference — reporting, reverse-dependency tracking (consumedBy), and brief tracking (briefSlug) for /core:frameworks:heroui:build-components. Defines the summary block format, manifest schema with consumedBy arrays, and how the manifest threads briefSlug through to enable audit's brief-drift check. Loaded by the orchestrator at the end of every run; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — reporting

End every run with a summary block:

```
✅ Built/updated 17 components from design/pages/dashboard.pen

Cascade decisions:
  HeroUI v3:    11   (Button, Card, TextField, Select, Tabs, …)
  RAC:           3   (ToggleButton, DisclosurePanel, ProgressBar)
  react-aria:    2   (custom Toolbar with useFocusRing, Stepper with useNumberField)
  Custom:        1   (StatRow — pure composition, no behavior)

Visual regression:
  Storybook sweep:    348 stories, 3 regressed → see tests/__regression__/
  Web app sweep:      12 routes, 0 regressed
  Design fidelity:    page diff ≤ 4.2% (target ≤ 5.0%)

Responsive coverage:
  Components > 400px:           9 of 17
  Per-breakpoint coverage (in scope / passing):
    xs  (360):   9 / 9  ✅
    sm  (640):   7 / 7  ✅   (2 components not in sm scope)
    md  (768):   9 / 9  ✅
    lg  (1024):  9 / 9  ✅
    xl  (1280):  9 / 9  ✅
    2xl (1440):  6 / 6  ✅   (3 components not in 2xl scope)
  Layout-transition stories: 24 across 9 components
  Cross-breakpoint regression: 0 failures
  Design-code parity:          0 missing utilities, 0 phantom utilities

Foundation token resolution:
  Typography:  142 nodes, 140 matched (98.6%), 2 within tolerance, 0 failed
    └─ "h3" (title in StatCard) needed +1px size tolerance — review
  Icons:       38 nodes, 37 matched (97.4%), 1 fuzzy, 0 failed
    └─ "chevron-right" in Pagination resolved via SVG hash (1.8% pixel diff)
  Colors:      89 nodes, 89 matched (100.0%), 0 drift
  Radius:      31 nodes, 31 matched (100.0%)
  Shadow:      14 nodes, 14 matched (100.0%)
  Spacing:    216 nodes, 213 matched, 3 snapped (±1px), 0 failed

Theme extensions (added to app/globals.css @theme this run):
  --font-card-meta:    500 17px / 24px Inter        (StatCard.title)
  --color-accent-pressed: oklch(0.55 0.22 250)     (Button:active)
  --spacing-card-pad:  1.125rem                     (Card.Content)
  Foundation .pen files updated: typography.pen, colors.pen, spaces.pen
  Manifests refreshed: typography, colors, tokens

Arbitrary-value lint:
  Component files scanned: 17
  Hits in component code: 0  ✅
  Hits in story decorators (allowlisted): 9 — viewport widths only

Interaction tests:
  Playwright:  8 specs, 47 cases, 47 passing
  axe-core:    47 cases, 0 violations

⚠️  Open items:
  - StatRow.placeholder.svg created — replace with real chart component when available
  - Button hover regressed in 3 stories — likely from --accent token shift; review
    tests/__regression__/Button/diff/storybook/

Manifest written: product/.pencil-build-manifest.json
   Brief link:    {{briefSlug}}  (read from page .pen metadata)
```

The manifest is read on the next invocation so the command can skip
components that are already built and unchanged since the `.pen`'s
last-modified timestamp.

## Reverse-dependency tracking (`consumedBy`)

Every component / pattern entry in the build manifest carries a
`consumedBy` array listing what depends on it. This is the reverse
of `requires` — instead of "what does this component need?", it
answers "what would break if this component changes?".

```jsonc
{
  "components": {
    "Button": {
      "source":  "design/heroui/components/buttons.pen#button",
      "react":   "src/components/Button.tsx",
      "hash":    "sha256:abc123...",
      "requires": ["foundations/colors", "foundations/typography", "foundations/motion"],
      "consumedBy": [
        "patterns/hero",
        "patterns/cta",
        "patterns/footer",
        "patterns/pricing-tier",
        "templates/auth#signin",
        "templates/auth#signup",
        "templates/dashboard",
        "src/pages/landing.tsx",
        "src/pages/our-story.tsx"
      ]
    },
    "patterns/hero": {
      "source":  "design/patterns/hero.pen",
      "react":   "src/patterns/Hero/index.tsx",
      "hash":    "sha256:def456...",
      "requires": ["components/buttons", "components/surfaces", "foundations/typography"],
      "consumedBy": [
        "templates/landing-page",
        "templates/marketing#about",
        "templates/marketing#features"
      ]
    }
  }
}
```

`consumedBy` is computed at build time by:

1. Walking every page `.pen` for component / pattern usage
2. Walking the React source for `import` statements pointing at
   `@/components/*`, `@/patterns/*`, `@/templates/*`
3. Reading `design/.product-dependencies.json` for declared
   dependencies (templates' declared `requires` flow into the
   referenced components' `consumedBy` array)
4. Aggregating all references into a deduped sorted list per
   component / pattern

This data unlocks two important capabilities:

**Change-impact preview.** Before re-running build for a changed
component, the build prints what consumers will be affected:

```
About to rebuild Button (changed since last run)

Consumers (will be re-rendered when their .pen rebuilds):
  - patterns/hero               (3 variants affected)
  - patterns/cta                (5 variants affected)
  - patterns/footer
  - templates/auth (signin, signup)
  - templates/dashboard
  - 2 page-specific compositions

Continue? [Y/n]
```

This is especially useful with `--dry-run` for risk assessment
before a token-foundation change.

**Audit Plane 1 enrichment.** When code drift is detected on a
component, audit surfaces the consumer count alongside the drift
finding:

```
⚠️  Code drift: Button.tsx (changed; 9 consumers may be affected)
    Consumers: patterns/hero, patterns/cta, patterns/footer,
               patterns/pricing-tier, templates/auth#signin,
               templates/auth#signup, templates/dashboard,
               src/pages/landing.tsx, src/pages/our-story.tsx
```

The high consumer count signals "this drift has wide impact —
prioritize fixing it" vs. an isolated component with `consumedBy: []`
that's lower-stakes.

## Brief tracking (briefSlug)

When the page `.pen` was finalized via `/product:design:design-page --finalize`,
its metadata carries a `briefSlug` field pointing at the parent brief
(`design/briefs/<slug>.md`). The build manifest threads this through:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-05-02T18:42:00Z",
  "briefSlug": "saved-searches",        // ← carried forward from page .pen
  "page": "design/pages/dashboard.pen",
  "finalizedDirection": "B-duotone-editorial",
  "components": { /* ... */ }
}
```

`briefSlug` is informational at build time but enables the audit's
"implementation drift from brief" check to verify built components
still satisfy the brief's recorded outcomes. If the page `.pen` does
not have `briefSlug` metadata (e.g. it was generated before the
finalize flow existed, or via direct mode without `--based-on`), the
manifest records `briefSlug: null` and audit's brief-drift check
becomes a no-op for that page.
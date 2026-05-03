# Product persona — Audit plane definitions

> Plane definitions consumed by `/audit` for the product
> persona. Covers drift between code, design specs (`.pen`),
> and tokens (foundations + `@theme`); brief drift; composition
> drift; research staleness; brand-fit; feature-gap.
>
> Each plane below is a self-contained check sequence the audit
> dispatcher invokes. See `core/audit/audit.md` for the
> dispatch shell.

## Persona scope

| Plane | Name |
|-------|------|
| 1 | Code drift (component code vs `.pen`) |
| 2 | Design drift (`.pen` files vs pages and components) |
| 3 | Token drift (foundation ↔ `@theme` ↔ code) |
| 4 | Orphans |
| 5 | Lock divergence (informational) |
| 6 | Brief drift |
| 7 | Composition + research-staleness + brand-fit + feature-gap |

## Plane 1 — Code drift (component code vs `.pen`)

For each component listed in the build manifest:

1. **Hash the component file** (`src/components/<Component>.tsx` plus
   any sibling `.stories.tsx`, `.spec.tsx`, `.test.tsx`).
2. **Hash the source `.pen` frame** via `get_design_context({ nodeId })`
   on the manifest-recorded source.
3. **Compare against the manifest's recorded hashes** from the last
   `/frameworks:heroui:build-components` run.

Drift signatures:

| Code hash    | `.pen` hash  | Diagnosis                                                               | Severity |
| ------------ | ------------ | ----------------------------------------------------------------------- | -------- |
| changed      | unchanged    | Hand-edited away from canonical, OR a build was skipped                 | warn     |
| unchanged    | changed      | Design moved forward, code hasn't caught up                             | warn     |
| changed      | changed      | Both moved — was the code change paired with a re-build?                | info     |
| unchanged    | unchanged    | In sync                                                                 | ok       |

For each warn-severity component, run a deeper check before reporting:

- **Phantom-utility scan** — re-run the arbitrary-value lint regex
  (`(class(Name)?=|: ?")[^"]*\b(\w+-)\[[^\]]+\]`) against the current
  file. Hits indicate inline drift that bypasses the theme. Surface
  per file:line:column.
- **Phantom-breakpoint scan** — diff the breakpoint utilities present
  in code against the breakpoint transitions declared by the `.pen`'s
  responsive frames (per `_context.md` rule 7). Flag missing utilities
  (design has transition, code doesn't) and phantom utilities (code
  has breakpoint prefix, design doesn't).
- **Locked-component check** — if the file's top comment includes
  `@pencil-locked`, re-classify the warn as a locked-divergence
  notice (informational, not a failure). The user accepted the
  divergence; surface only as a reminder.
- **Motion inline-value scan** — regex
  `transition[^;]*\b\d{2,4}m?s\b|transition-(?:all|colors|opacity|transform)\s+\b\d{2,4}` —
  flags any inline duration in component code (e.g.
  `transition: 200ms ease-out`, `transition-colors duration-200`).
  These should reference motion tokens (`var(--motion-duration-base)`,
  `var(--motion-transition-color)`).
- **Z-index inline-value scan** — regex
  `z-index\s*:\s*\d+|className=[^"]*\bz-\[?\d+\]?\b` — flags any raw
  numeric z-index. These should reference z-index tokens
  (`z-modal`, `z-tooltip`).
- **I18n direction-property scan** — only runs when project declares
  multilingual support in brand JSON (`i18n.scripts` non-empty).
  Regex: `padding-(?:left|right)|margin-(?:left|right)|border-(?:left|right)|text-align\s*:\s*(?:left|right)|left:\s*0|right:\s*0` —
  flags physical-direction CSS properties. These should be logical
  properties (`padding-inline-start`, `margin-inline-end`,
  `text-align: start | end`, `inset-inline-start`).
- **Icon-flip-missing scan** — only when multilingual. For each
  directional icon import (chevron-left, chevron-right, arrow-back,
  arrow-forward), check the rendering uses the rtl-flip utility
  (`rtl:[transform:var(--i18n-icon-flip-rtl)]` or equivalent).
  Missing flip on a directional icon is a warn.
- **States-pattern reference check** — for each component classified
  as a list / form / async-fetch component (heuristic: imports
  `useQuery`, `useState` for collection data, contains `.map(`),
  verify it imports or composes from `@/patterns/states`. Components
  implementing empty / loading / error ad-hoc are warned —
  recommend extracting to the pattern.

### Plane 1 augmentation — open-pencil design-layer lint

The regex-based scans above operate on **React code**. When
**open-pencil** is available on PATH (Path D in `_context.md`), an
optional design-layer pass runs on the `.pen` files themselves:

```bash
open-pencil lint <pen-file> --rule color-contrast --json
open-pencil lint <pen-file> --rule naming        --json
open-pencil lint <pen-file> --rule layout        --json
open-pencil lint <pen-file> --rule accessibility --json
```

This catches drift in the design source that the code-side regex
sweeps can't see — e.g. a component frame whose internal text node
is set to a fill that fails AA contrast against the frame's
background, or a frame using non-canonical naming. The lint output
is merged into Plane 1 findings under a `source: design-layer`
sub-tag so the user can distinguish:

```
[Plane 1] WARN  design/heroui/components/buttons.pen
  source: design-layer (open-pencil)
  rule:   color-contrast
  frame:  button / secondary / disabled
  detail: text fill #B0B0B0 on background #F4F4F4 = 1.8:1 (AA requires 4.5:1)
```

Augmentation is **opt-in** when open-pencil is absent — Plane 1
runs without it, the `--no-design-lint` flag explicitly suppresses
it. When present, the augmentation runs by default. Surface
findings with the same severity model as code-layer Plane 1.

`--fix` for design-layer findings: **none**. Design-layer fixes go
through `/product:design:design-page <page> --in --refine "<fix>"` with the
visual gates. Audit prints the suggested invocation.

`--fix` for code drift: **none**. Code edits go through
`/frameworks:heroui:build-components` with the visual gates. Audit prints the
suggested invocation but does not run it.

## Plane 2 — Design drift (`.pen` files vs pages and components)

Two sub-checks.

### 2a — Page `.pen` ahead of components

For each `.pen` in `design/pages/*.pen`:

1. Compare its mtime / hash against the build manifest's recorded
   build time.
2. If the `.pen` is newer:
   - Read the manifest's component-usage map for that page.
   - For each affected component, check whether it's been rebuilt
     since the `.pen` change.
   - List unbuilt components per affected page.

Output: stale-page entries with the component fan-out.

```
⚠️  design/pages/dashboard.pen modified 2026-05-02
    Last built: 2026-04-25
    Components affected (12):
      StatRow, ChartGrid, ActivityFeed, … (full list)
    Suggested: /frameworks:heroui:build-components dashboard
```

### 2b — Foundation `.pen` ahead of manifest

For each foundation `.pen`:

1. Read its mtime.
2. Read the matching manifest's mtime
   (`product/.pencil-typography.json` etc).
3. If the `.pen` is newer than the manifest:
   - Re-extract the manifest in-memory (don't write yet).
   - Diff against the on-disk manifest.
   - Report tokens added, removed, modified.

```
⚠️  design/foundations/typography.pen modified 2026-05-02
    Manifest product/.pencil-typography.json last refreshed 2026-04-30
    Tokens added:    card-meta, table-header
    Tokens removed:  (none)
    Tokens modified: caption (line-height 16 → 18)
```

`--fix` for design drift: **manifest refresh only**. With `--fix`, the
audit re-extracts every stale manifest and writes it. Component
rebuilds are still the user's call — printed as suggested commands.

## Plane 3 — Token drift (foundation ↔ `@theme` ↔ code)

The most subtle plane, because three sources of truth interact:
foundation `.pen` declares the design intent, `@theme` block
implements it for Tailwind, components consume it via utilities.

### 3a — Foundation ↔ `@theme` parity

For every token declared in the foundation `.pen`s:
- Check whether `@theme` has the corresponding CSS variable.
- Missing in `@theme` → **foundation declares a token Tailwind cannot
  produce a utility for.** Suggest the additive `@theme` line.

For every token declared in `@theme`:
- Check whether some foundation `.pen` declares it.
- Missing in foundation → **the theme has a token with no design
  source.** Either was added to `@theme` directly without updating
  the `.pen`, or the `.pen` was edited and the token was lost.
  Suggest updating the foundation `.pen` to include it.

```
⚠️  Theme-foundation parity (3 mismatches)
    @theme has token, foundation does not:
      --color-accent-pressed   → add to design/foundations/colors.pen
      --spacing-card-pad       → add to design/foundations/spaces.pen
    Foundation has token, @theme does not:
      --radius-card            → add to app/globals.css @theme
```

`--fix` for parity:
- **Mirror foundation → `@theme`** (additive only, never destructive).
  Tokens that exist in the foundation but not in `@theme` get added
  to the `@theme` block with an origin comment
  (`/* Mirrored by /audit on 2026-05-02 */`).
- Mirroring `@theme → foundation` is **not** auto-fixed. The `.pen`
  is the design source of truth; adding a token there means a
  designer review. Surface as a suggestion only.

  (Note: "designer review" here means a human reviewing the
  design source — applies regardless of whether the org calls
  the role "designer" or "product designer" or splits across
  PM/UX/visual designer.)

### 3b — Code ↔ manifest parity

For every Tailwind utility used in component code that maps to a
named token (`bg-accent`, `text-h3`, `rounded-card`, `p-card-pad`):
- Check whether the manifest still has the underlying token.
- Missing → **code references a token that has been removed from
  the foundation** (or never existed). Surface per file:line.

```
⚠️  Code references missing tokens (2)
    src/components/Card.tsx:42  uses font-card-meta — not in typography manifest
    src/components/Stat.tsx:18  uses text-h7        — not in typography manifest
```

`--fix` for code-manifest parity: **none**. Either the token needs to
be added (extend the foundation) or the code needs to be changed
(re-run build-components with the design refreshed).

### 3c — Synthesized atoms not promoted

The `design-page` command flags atoms it had to synthesize because no
matching atom existed in the design system. This check finds those
flags from the build manifest and confirms whether they were
subsequently promoted into `design/components/*.pen`.

```
⚠️  Synthesized atoms not promoted (3)
    design/pages/dashboard.pen flagged 3 synthesized atoms during last build:
      StatChip       — similar to Chip + delta arrow; consider extending Chip
      SparklineMini  — no existing match; new atom
      DragHandle     — custom; consider adding to data-display.pen
    Suggested: review whether each is reusable. If yes, add to the
    relevant components/*.pen and re-run /product:strategy:scaffold --only components.
```

`--fix` for unpromoted atoms: **none**. Promotion is a design call.

### 3d — Contrast-grid revalidation (a11y foundation hook)

The a11y foundation declares a canonical contrast grid: every
accent-on-surface combination components actually use, with computed
WCAG AA / AAA badges. When palette changes happen (via
`colors-select` or direct `@theme` edits), audit re-computes
contrast ratios and surfaces violations.

For each pairing in the canonical grid:
- Compute relative luminance of foreground + background tokens
- Compute contrast ratio: `(L1 + 0.05) / (L2 + 0.05)`
- Flag pairings where ratio drops below thresholds:
  - body text < 4.5:1 → **fail-severity** (AA violation)
  - large text < 3:1 → **fail-severity**
  - non-text UI < 3:1 → **warn**
  - body text 4.5–7 → info (AA-only, AAA missed)

```
❌ Contrast violations (2)
    --color-content-2 on --color-surface     ratio 3.8 (need 4.5 for body AA)
      Used by: Card.Description, Stat.Caption, ListItem.Subtitle
      Fix: darken --color-content-2 (currently #707070, try #5A5A5A → ratio 5.4)

    --color-accent-300 on --color-surface    ratio 2.4 (need 3 for non-text AA)
      Used by: focus rings, divider accents, info-state outlines
      Fix: --color-accent-300 isn't suitable for these uses;
           switch to --color-accent-500 (ratio 5.2)
```

`--fix` for contrast: **none**. The fix is either palette adjustment
(re-run `colors-select`) or finding which pairings to drop from the
canonical grid (rare — usually palette is wrong).

## Plane 4 — Orphans

Files on disk with no manifest reference, or manifest entries pointing
at missing files.

- **Orphan `.pen` files**: any `.pen` in `design/` not referenced by
  any command, the build manifest, or the component manifest.
- **Orphan components**: any `.tsx` in `src/components/` (or the
  resolved target dir) not referenced by any `.pen` frame's
  manifest entry, no usage in pages, and not in a manual exclusion
  list.
- **Stale manifest entries**: manifest pointers to files that no
  longer exist on disk.

```
📎 Orphans (3)
    design/components/old-modal.pen      — no command references this file
    src/components/LegacyHeader.tsx      — no .pen frame, no page usage
    Manifest stale entry: product/.pencil-component-manifest.json#/atoms/SidebarOLD
```

`--fix` for orphans: **stale manifest entries only**. The audit prunes
dead manifest pointers. Files on disk are never auto-deleted — the
user might have tactical reasons for keeping them (work in progress,
deprecated but still imported elsewhere). Print the file paths and
let the user decide.

## Plane 5 — Lock divergence (informational)

Components marked `@pencil-locked` whose source `.pen` frame has
changed since the lock was applied. These are not failures — the
user explicitly opted out of regeneration — but they should be
visible so the lock can be reviewed periodically.

```
🔒 Locked components diverging from .pen (2)
    src/components/CustomEditor.tsx — locked 2026-03-15, .pen modified 2026-05-01
    src/components/LegacyChart.tsx  — locked 2026-01-10, .pen modified 2026-05-02
    These are intentional divergences. Review whether the lock should still apply.
```

No `--fix` action.

## Plane 6 — Brief drift (built component drift from brief outcomes)

For each component in the build manifest whose entry has a non-null
`briefSlug`:

1. Read the brief at `design/briefs/<briefSlug>.md`.
2. Read the brief's **Outcomes** section (the post-state the user
   experiences after completing the flow this component participates
   in).
3. Read the component's current code, story descriptions, and
   interaction-test cases.
4. **Heuristic match**: for each brief outcome, check whether the
   component's behavior plausibly produces it. This is a soft check
   — outcomes describe end-state, components are units of UI, so the
   match is rarely 1:1. Look for:
   - Persisted-state outcomes → form components have submit handlers,
     buttons trigger mutations
   - User-visible outcomes → display components render the new state
   - Side-effect outcomes → components emit events / call hooks the
     side-effect handlers consume
   - Knowledge outcomes → confirmation UI, success states, persisted
     metadata reflected in component props
5. Surface mismatches as **info-severity findings** (not warnings),
   because the heuristic is imperfect:

```
ℹ️  Brief drift: components missing outcomes from brief
    Brief: design/briefs/saved-searches.md (5 outcomes)
    Components built from this brief's pages: 12

    Possibly unaddressed outcomes:
      - "Activity log entry: user.savedSearch.created"
        → No component emits this event; check the form's submit
          handler or the activity-log subscriber.
      - "User can find their saved search from any page that has
        search capability."
        → No SavedSearchList component found in the manifest;
          confirm the global affordance exists.

    These are heuristic findings — review and dismiss if the outcomes
    are addressed elsewhere (server-side, in non-component code, or
    in a component the manifest does not cover).
```

`--fix` for brief drift: **none**. The fix is either to update the
component code (manual, through `/frameworks:heroui:build-components`) or to
update the brief if its outcomes were too aspirational.

If the page `.pen` was not finalized through `--based-on` →
`--finalize` flow (and therefore has no `briefSlug` metadata), this
plane is a no-op for that page's components. The audit summary
reports the no-op count so users can see how much of the system is
brief-tracked vs. brief-untracked.

## Plane 7 — Composition & recommendation drift

Three sub-checks covering integrity between research output,
recommendation manifests, and what was actually built.

### 7a — Pattern-composition check

Templates that don't reference any patterns are likely reinventing
sections that exist as patterns. For each `design/templates/*.pen`:

1. **Read template metadata** for declared pattern dependencies
   (`composes: ["patterns/hero", "patterns/footer"]` in frontmatter
   or via `.product-dependencies.json`).
2. **If no patterns declared**, scan the rendered React for
   composition heuristics:
   - Does the React import from `@/patterns/*`?
   - If not, does it inline section structures that match known
     pattern signatures (hero with image+headline+CTA; footer with
     multi-column nav; pricing card with tier columns)?
3. **Surface findings** as warns:

```
⚠️  Pattern reinvention detected
    Template: src/templates/marketing-features.tsx
    Inlined section: hero-style-split-image-right (lines 14-58)
    Recommended: replace with `import { Hero } from '@/patterns/hero'`
                 with variant="split-image-right"
    Why: a centralized pattern means visual consistency drift
         is bounded. Currently this template's hero will drift
         independently of others.
```

Skip this check when `patterns:select` recommended skipping the
relevant pattern (e.g. recommendation manifest excluded
`patterns/hero` for this product type). The template's inline
composition is then justified.

### 7b — Research-staleness check

Recommendation manifests reference `design/research/<industry>.json`.
Audit checks the JSON's `researchedAt` timestamp:

- **< 6 months old**: ok
- **6–12 months old**: info ("research aging — consider re-running")
- **12–24 months old**: warn ("research is stale; recommendations
  may not reflect current category")
- **> 24 months old**: warn (stronger language) + recommendation
  in summary to run `/product:strategy:research <industry> --update`

This matters because design conventions shift. A recommendation made
against research from 2023 may rule out patterns that have since
become category-standard. Audit surfaces the question; the user
decides whether to re-research.

### 7c — Brand-fit drift check

Brand JSON declares `audience-regulation` (none / k-12 / healthcare /
financial-services / government). Each value carries non-negotiable
template variant requirements that must be present in the build
manifest.

For **k-12** (FERPA + COPPA):
- `templates/auth` must include the `with-guardian-consent` variant
- `templates/profile` must include the `with-guardian-access` variant
- `templates/legal` must include the `parental-rights`,
  `ferpa-disclosure`, and `coppa-disclosure` variants
- `templates/onboarding` must include the `family-flow` variant

For **healthcare** (HIPAA):
- `templates/legal` must include a HIPAA-notice section in privacy
- Imagery direction must not include patient photos unless brand
  JSON explicitly lists HIPAA-compliant model release sources

For **financial-services** (KYC + various):
- `templates/legal` must include compliance-specific disclosures
- `templates/auth` must include MFA-required variant (no
  password-only)

For **government**:
- `templates/legal` must include accessibility statement
- All foundations must satisfy AA contrast minimum (foundation
  audit reading from a11y plane)

Missing variants for the declared regulation → **fail-severity**
finding (this is a compliance bug, not a style choice).

### 7d — Competitive-feature gap check (when research has `featureMatrix`)

When the research file has a `featureMatrix` (produced by
`/product:strategy:research --features`), this sub-check tracks whether
the product is closing or widening competitive gaps over time.
Skip when no featureMatrix exists.

For each feature in the matrix:

- **Table-stakes feature absent from product** (`classification:
  "table-stakes"` + `ourPosition: "absent"` or `"unknown"`):
  emit a **info-severity** finding listing the feature and the
  templates where competitors typically surface it. Severity is
  info because feature gaps are product strategy, not technical
  drift — the audit surfaces them; the user decides whether to
  close them.

- **Feature marked `"intentionally-omitted"`**: skip. The user
  has explicitly decided not to compete on this feature. No
  finding.

- **Common feature absent + flagged in templates manifest**:
  read `product/.pencil-recommended-templates.md` for "Feature
  gaps" annotations. If a flagged feature still lacks
  implementation across multiple iterations, escalate severity
  from info to warn so the gap doesn't drift forgotten.

- **Differentiation feature in product but not surfaced
  prominently**: when `ourPosition: "present"` and
  `classification: "differentiation-candidate"`, scan the
  template designs for the feature's prominence. If buried in a
  generic settings page when competitors with this feature give
  it dedicated marketing pages, emit a warn-severity finding
  recommending more prominent placement. This is heuristic —
  surfacing for review, not blocking.

Example finding:

```
[Plane 7d] INFO  Feature gap: in-app-messaging
  Frequency:  75% of surveyed competitors (3/4)
  ourPosition: unknown (matrix never populated)
  Affected templates: dashboard, settings (notifications)

  Competitor implementations:
    - competitor-a: "real-time chat in dashboard sidebar"
    - competitor-b: "thread-based messaging on dedicated page"
    - competitor-d: "AI-suggested replies, dashboard sidebar"

  Suggested action: update featureMatrix.in-app-messaging.ourPosition
  in design/research/<industry>.json to "present", "absent",
  "planned", or "intentionally-omitted" so this finding either
  resolves or escalates appropriately.
```

The `ourPosition: "unknown"` case is the most actionable — until
the user makes an explicit decision, every audit run repeats the
finding. Once the position is set, the finding resolves (for
"present" / "intentionally-omitted") or persists at appropriate
severity ("absent" with classification table-stakes stays as
info; with `ourPosition: "planned"` it stays as info but
acknowledges the user's intent).

`--fix` for Plane 7:

- 7a (pattern-composition): suggested invocation prints
  `/product:design:patterns:<pattern>` to generate the missing pattern,
  then manual refactor of the template
- 7b (research-staleness): prints
  `/product:strategy:research <industry> --update`
- 7c (brand-fit): prints the required template invocations with
  appropriate flags
  (e.g. `/product:design:templates:auth --with-guardian-consent`)
- 7d (feature-gap): no auto-fix possible — strategic decisions
  belong to the user. Audit prints the finding; user updates
  `ourPosition` in research.json or commits to a feature build.


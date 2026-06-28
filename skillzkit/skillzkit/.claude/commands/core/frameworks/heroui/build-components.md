---
description: Generate React components from a Pencil .pen file. Walks the atomic decomposition bottom-up, applies a HeroUI v3 → RAC → react-aria hooks → custom cascade, and gates every component on pixelmatch visual regression plus optional interaction tests.
argument-hint: <page-slug or .pen path> [--target <path>] [--storybook-path <path>] [--web-app-url <url>] [--variance 0.1] [--design-variance 0.05] [--type-tolerance loose|tight] [--icon-match exact|fuzzy] [--depth atoms|molecules|organisms|templates|pages] [--mode auto|extend|rebuild|inspect] [--no-interaction-tests] [--auto] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Read a Pencil `.pen` file produced by `/product:design:design-page` (or any file
that follows the same atomic-design layout — Atoms / Molecules / Organisms /
Templates / Pages) and generate the corresponding React components in the
target repo. Walk **bottom-up** (atoms first), apply the component cascade,
gate every step on pixelmatch visual regression, and run interaction tests
on anything stateful before proceeding to the next level.

> **Phase reference files.** Detailed algorithms for foundation token
> resolution, the two build paths, the responsive gate, interaction
> tests, reporting, and SEO emission live in
> `frameworks/heroui/_build-phases/*.md`. Each is loaded only when the
> corresponding phase runs.

## Stack assumptions

This command is HeroUI-v3 + Tailwind-v4 specific (matching `_context.md`).
The cascade is:

1. **HeroUI v3** components (`@heroui/react@beta`) — uses tailwind-variants
   + React Aria Components under the hood. **Always try this first.**
2. **react-aria-components (RAC)** — `react-aria-components` package, when
   HeroUI doesn't ship the primitive. Wrap with tailwind-variants for
   styling.
3. **react-aria hooks** — `@react-aria/*` `use-*` hooks, when RAC doesn't
   ship the composition you need. Build custom DOM + WAI-ARIA via the hook.
4. **Custom** — raw DOM + WAI-ARIA pattern guide. Last resort. Document why.

Custom components in this repo (whether wrapping RAC or fully custom) all
use the same toolchain: `tailwind-variants` (tv()) for slot/variant
composition, `tailwind-merge` (twMerge) inside `cn()` for class merging,
Tailwind v4 utilities, and `@theme` design tokens (CSS custom properties)
referenced via the existing `--accent`, `--surface`, etc. — never hex.

For non-runtime references: **Tailwind UI templates** are copy-paste
inspiration, not a dep. If a layout pattern matches a Tailwind UI template,
acknowledge that in a comment but reimplement using the local toolchain.

## Scope — what this command builds vs doesn't build

The Pencil suite has four artifact tiers; this command's scope
covers two of them:

| Tier            | Built by `build-components`?  | Why / where they're built       |
| --------------- | ----------------------------- | ------------------------------- |
| **Foundations** | No — produces tokens, not React. Foundation `.pen` files are visual reference only. The CSS tokens live in `@theme` (written by `colors-select`, `motion`, `z-index`, etc.). | Foundation commands write tokens directly to `@theme` source CSS. |
| **Components**  | **Yes — this is the primary scope**. Atomic + molecule + organism React components implementing HeroUI cascade. | This command. |
| **Patterns**    | **Yes — but as composed React using the components built in this run**. Patterns become React components that consume foundation tokens + atomic components. | This command, when invoked with `--include-patterns` or when a page being built consumes a pattern. |
| **Templates**   | No — produces full pages, not isolated React. Templates are built per-page via `/product:design:design-page <page-type>` → `/product:design:build-components <page-slug>`. | Per-page invocations of this command, where the page's build manifest pulls in pattern + component dependencies. |

### Patterns specifically

Patterns (`design/patterns/*.pen`) differ from components in two
ways:

1. **They're compositional** — a pattern like `hero-split-image-right`
   is the orchestrated arrangement of a `Heading` atom, a `Text`
   atom, a `Button` atom, an `Image` atom, and a `Container`
   organism. The pattern itself doesn't introduce new primitives;
   it just composes them.

2. **They produce content placeholder slots, not data**. The hero
   pattern's React component takes props (`heading`, `subhead`,
   `primaryCta`, `image`) — what the consuming page passes in.
   The pattern doesn't include real content; templates supply it.

When invoked with `--include-patterns`, this command:

- Walks `design/patterns/*.pen` files
- For each pattern, generates a React component at
  `src/patterns/<pattern-name>/index.tsx` that takes the
  appropriate props
- Treats the pattern's variants (e.g. hero's "centered" /
  "split-image-right" / "video-bg") as a `variant` prop using
  tailwind-variants, similar to how component variants are handled
- Writes a `patterns/<pattern-name>/types.ts` with the full prop
  signature
- Adds the pattern to `product/.pencil-build-manifest.json` so audit
  can verify pattern composition (templates that don't import any
  pattern get flagged)

Without `--include-patterns`, patterns are **visual-only artifacts**.
Templates that consume them inline the composition into the
template's own React (less reusable but lighter dependency graph).
For products where the same hero pattern
appears across many pages, `--include-patterns` is the right call;
for one-off marketing experiments where a pattern appears once,
inline composition is fine.

### When per-page builds need patterns

A per-page build (`/product:design:build-components <page-slug>`) reads the
page's `.pen` manifest. If the manifest references patterns
(e.g. the page composition includes `pattern-id: "hero-centered"`),
the build:

1. Checks if the pattern's React component already exists at
   `src/patterns/hero/index.tsx`
2. If yes: imports and uses it
3. If no: either fails with "Run `/product:design:build-components
   --include-patterns` first" or auto-builds the pattern (depending
   on `--auto-build-patterns` flag — default off for predictability)

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. Resolve the input source:
   - First positional arg matches `design/pages/<slug>.pen` → use that.
   - Or it matches an existing `.pen` path → use directly.
   - Otherwise stop and ask the user.
3. Read the component manifest if `product/.pencil-component-manifest.json`
   exists. This was written by `/product:design:design-page` and maps semantic
   names (`button-primary-md`, `text-field-default`) to source `.pen`
   paths + node ids. Use it as the canonical inventory.
4. **Extract foundation token manifests** from the foundation `.pen`
   files. These are the lookup tables for Step 1.5 token resolution.
   Run `get_editor_state` (or `pencil --in <file> --query`) against
   each foundation `.pen` and write a JSON manifest. Refresh only if
   the foundation `.pen` was modified after the manifest's mtime.

   - `design/foundations/typography.pen` →
     `product/.pencil-typography.json`. Extract every text style with
     its computed values:
     ```jsonc
     {
       "h3": {
         "fontFamily": "Inter",
         "fontSize": 24, "lineHeight": 32, "fontWeight": 600,
         "letterSpacing": "-0.01em",
         "tailwindClass": "text-2xl leading-8 font-semibold tracking-tight",
         "cssVar": "--font-h3"
       },
       "body-md": { … },
       …
     }
     ```
   - `design/foundations/icons.pen` + brand JSON's `iconMap` →
     `product/.pencil-icons.json`. Map every action name to library
     coordinates:
     ```jsonc
     {
       "edit":   { "name": "pen-to-square", "library": "fontawesome",
                   "family": "classic", "style": "solid",
                   "import": "import { faPenToSquare } from '@fortawesome/free-solid-svg-icons'" },
       "search": { "name": "magnifying-glass", … },
       …
     }
     ```
     If `iconLibrary` is `lucide`, the `import` field becomes
     `import { Pencil } from 'lucide-react'` etc.
   - `design/foundations/colors.pen` →
     `product/.pencil-colors.json`. Every named token with its `hex`,
     `var` (`--accent-500`), and Tailwind `class` (`accent-500`).
   - `design/foundations/spaces.pen` →
     `product/.pencil-tokens.json`. Spacing, radius, shadow scales.

   If any foundation `.pen` is missing, **stop and report** — the
   build cannot resolve tokens without the foundations. Suggest
   running `/product:strategy:scaffold --only foundations`.
5. Verify required tools (stop and explain on miss):
   - `pixelmatch` available (project dep `npm i pixelmatch pngjs` or
     global). Falls back to a small Node script we run inline if neither.
   - `@playwright/test` installed for screenshotting.
   - Storybook present at `--storybook-path` or auto-detected via
     `.storybook/main.ts`. If absent, note that Storybook regression
     gating will be skipped for new components (only design-fidelity
     gating runs).
   - `react-aria-components` and `tailwind-variants` resolvable from
     `package.json`.
   - **Component test runner** detection: prefer Playwright Component
     Tests when `playwright.config.ts` is present, then Storybook
     `play()` interactions, then Vitest + Testing Library as fallback.
     If a project-specific runner is configured (e.g. via a
     `componentTestRunner` field in `package.json`), use that.
6. Resolve the target directory:
   - `--target` flag wins.
   - Else read `tsconfig.json` paths and pick the first `@/components/*`
     or `$lib/components/*` alias.
   - Else default to `src/components/`.
7. Resolve flags:
   - `--variance` — pixelmatch threshold for storybook regression and
     extend-path gating. Default `0.1`.
   - `--design-variance` — match-against-Pencil-frame threshold. Default
     `0.05` (5%, because vector→pixel rendering is never exact).
   - `--depth` — limits how far up the hierarchy to build. Default `pages`.
   - `--mode auto|extend|rebuild|inspect` — `auto` (default) decides
     extend vs rebuild per-component; `extend` forces extension of any
     match; `rebuild` forces fresh implementations; `inspect` runs the
     plan and stops without writing.
   - `--auto` — skip the post-plan confirmation pause.
   - `--dry-run` — print everything, write nothing.
8. **Read SEO + AIO strategy** if `product/.pencil-seo.json` exists.
   For page-level builds (when `--depth pages` produces page
   files), the strategy informs HTML emission — semantic tags,
   heading hierarchy preservation, JSON-LD structured data,
   meta tags. Resolve the relevant archetype from the page
   frame's name or metadata, then load
   `archetypeTargets = strategy.perArchetypeTargets[archetype]`.
   When the strategy is missing, emit baseline-correct HTML
   (semantic tags, alt text, single H1, sequential cascade) and
   surface a note recommending `/product:strategy:seo`. The full
   emission rules live in `_build-phases/seo-aio.md` and are loaded
   when page emission runs.

## Phase 1 — Plan

1. Parse the `.pen` (via `get_editor_state` MCP call or `pencil --in
   <file> --query` headless) and emit five lists: atoms, molecules,
   organisms, templates, pages — each with frame name, dimensions,
   compound API spec (from the spec column on each canvas), and any
   manifest source ids.
2. **Topological sort** by dependency (an atom cannot depend on a
   molecule; a molecule's atoms must build first; etc.). Within each
   level, sort by usage count descending — the most-reused components
   build first so downstream reuse is maximal.
3. For each component, **scan the codebase for an existing match**.
   Match heuristics, in order:
   - Exact name match in the target directory (`components/Button.tsx`)
   - Re-export from `@heroui/react` for the equivalent name
   - Fuzzy match by compound-API shape (a `Card` with `Header / Title /
     Description / Content / Footer` slots → match anything matching
     ≥3 of those slot names)
   - Visual fuzzy match: render existing component in Storybook,
     pixelmatch against the Pencil frame at design-variance × 4
     threshold (looser, just "is this even close")
4. **Decide the cascade level** for each component:
   - If existing match found and `--mode` allows extension → Path A.
   - Else: try HeroUI v3, then RAC, then react-aria hook, then custom.
     Record which level fits and why.
5. **Print the plan** as a table with columns: Level, Component,
   Decision (extend `<path>` or new), Cascade (HeroUI v3 / RAC /
   react-aria / custom).
6. Unless `--auto` is set, **pause for user confirmation** before
   building. Print the count of components that will be created vs
   modified, plus a yes/no/edit prompt.

## Phase 2 — Build per component

Walk the sorted list. For each component:

### Step 1 — Identify and stage

- Locate the Pencil frame on the matching canvas (Atoms / Molecules /
  Organisms / Templates / Pages).
- Export the frame as PNG via `get_screenshot({ nodeId })` and save to
  `tests/__pencil__/<component>/design.png`. This is the
  match-against-design target.
- For components on Pages canvas, also export at all available
  breakpoints (desktop / tablet / mobile) — they become responsive
  acceptance targets.

### Step 1.5 — Foundation token resolution

Walks every node, matches against foundation manifests (typography,
icons, colors, radius, shadow, spacing), and writes
`tests/__pencil__/<comp>/tokens.json`. On any unresolved node, runs
the snap / extend-theme / fail flow.

> **Algorithm: `_build-phases/token-resolution.md`.**

**Hard contract**: any `"failed"` entry → stop and report. Never
generate code for a component with unresolved tokens.

### Step 2 — Path A: Extend an existing component

Triggered when a match was found and `--mode` permits. BEFORE/AFTER
snapshot loop with pixelmatch regression gating + design-fidelity
gating. Max 5 iterations.

> **Procedure: `_build-phases/extend-existing.md`.**

### Step 3 — Path B: Build a new component

Triggered when no match is found, or `--mode rebuild` is set. Applies
the HeroUI v3 → RAC → react-aria hooks → custom cascade in strict
order, builds inside-out with `tailwind-variants`, gates on design-
fidelity pixelmatch.

> **Procedure: `_build-phases/build-new.md`.**

### Step 3.5 — Responsive gate (>400px components only)

Per `_context.md` rule 7: components wider than 400px must pass every
Tailwind breakpoint in scope. Verifies design-code parity, pixelmatches
at every width, runs layout-pathology checks. **Must pass before Step
4.**

> **Gate: `_build-phases/responsive.md`.**

### Step 4 — Interaction tests

Triggered for interactive components. Skip with
`--no-interaction-tests`. Tests run via Playwright Component Tests,
Storybook `play()`, or the project runner. Always includes axe-core
a11y assertion.

> **Procedure: `_build-phases/interaction-tests.md`.**

## Phase 3 — Sweep

After every component on a level is built, before moving to the next level:

1. **Theme parity lint** (runs first — catches the cheapest failures
   first): grep every component file generated/modified in this run for
   Tailwind's arbitrary-value syntax — the `[xxx]` brackets after a
   utility prefix:

   ```bash
   # Match arbitrary-value classes inside className strings or tv() definitions
   rg -nP '(class(Name)?=|: ?")[^"]*\b(\w+-)\[[^\]]+\]' src/components/
   ```

   Any hit is a failure unless the file is in the exemption allowlist
   (`product/.pencil-arbitrary-allowlist.json` — environment decorators,
   one-off layout primitives the user has explicitly OK'd). Print every
   hit with file:line:column. The build does not proceed to visual
   regression while arbitrary values exist; fix them by extending the
   theme via the unresolved-node flow above, then re-run.

2. **Full Storybook regression sweep**: run the Storybook test runner
   across every story in the project, not just this command's targets.
   Pixelmatch every story against its committed baseline at `$variance`.
   Any unrelated regression means a shared token / utility change
   leaked. Stop and report.
3. **Cross-breakpoint regression**: re-run the Storybook test runner
   over every per-breakpoint story variant created in Step 3.5 — at
   each test width in `[360, 640, 768, 1024, 1280, 1440]` that has at
   least one story tagged for it. Pixelmatch against the matching
   Pencil variants. Catches the case where a token change broke a
   layout at one breakpoint that the others didn't surface.
4. **Web app regression** (if `--web-app-url`): hit canonical routes
   (read from `product/.pencil-routes.json` if present, else inferred
   from the manifest's usage map). Pixelmatch each route at the
   page's declared breakpoints — at minimum 390 (mobile), 768
   (tablet), 1440 (desktop). Pages that opt into more breakpoints
   (via the manifest) get tested at all of them.
5. **Move to next level** only if all four sweeps pass.

After all levels build, run a final **page-fidelity sweep**:

- For every page in the `Pages` canvas, hit the matching live route at
  the Pencil-specified breakpoints, screenshot, and pixelmatch against
  the Pencil page-frame export at `$designVariance × 1.5` (looser,
  because page composition has more entropy than atom rendering).
- Save all diffs to `tests/__pencil__/<page>/diffs/` for review.

## Reporting

End every run with a structured summary block, then write
`product/.pencil-build-manifest.json` with the `consumedBy`
reverse-dependency map and `briefSlug` provenance.

> **Format: `_build-phases/reporting.md`.**

## Idempotency

Re-running the command:

1. Reads `product/.pencil-build-manifest.json` from the previous run.
2. Diffs the current `.pen` against the manifest's recorded `.pen` hash.
   Components whose Pencil source frame is unchanged AND whose
   implementation file is unchanged AND whose tests still pass are
   skipped.
3. Components whose Pencil frame changed go through Phase 2 again,
   defaulting to **Path A (extend)** if they previously existed.
4. New components (added to the `.pen` since last run) go through
   Phase 2 with auto cascade selection.
5. Components removed from the `.pen` since last run are flagged for
   review but not deleted automatically — print a list and ask.

## Safety rails

- **Never modify files outside `--target`** (or its computed default)
  without explicit user confirmation.
- **Never overwrite a file whose top comment includes
  `@pencil-locked`** — this is the user's escape hatch for hand-edited
  components they don't want regenerated.
- **Always commit `tests/__pencil__/` and
  `tests/__regression__/before/`** to the repo (write a `.gitignore`
  entry that excludes only `after/` and `diff/` — the baselines belong
  in version control).
- On any pixelmatch failure that exhausts retries, **stop the entire
  command** and report — never silently move on. Visual regression
  gates exist to catch real problems.

## SEO + AIO HTML emission (page-level builds)

Runs only when `--depth pages` produces page files. Translates the
design into SEO-correct HTML using `.pencil-seo.json` (resolved in
pre-flight step 8) for strategy. When strategy is missing, emits
baseline-correct HTML only.

> **Rules: `_build-phases/seo-aio.md`.**
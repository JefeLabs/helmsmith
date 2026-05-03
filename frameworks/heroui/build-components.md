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
     `product/.pencil-colors.json`. Every named token with its hex
     and Tailwind class:
     ```jsonc
     {
       "accent-500": { "hex": "#0A84FF", "var": "--accent-500", "class": "accent-500" },
       "content-1":  { … },
       …
     }
     ```
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
   surface a note recommending `/product:strategy:seo`. See SEO + AIO
   HTML emission section below.

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
5. **Print the plan** as a table:

   ```
   Level     Component            Decision                              Cascade
   ────────  ───────────────────  ────────────────────────────────────  ──────────────────────────
   atom      Button               extend (components/ui/button.tsx)     HeroUI v3 (existing)
   atom      InputClearButton     new                                   RAC (no HeroUI primitive)
   atom      ColorSwatch          new                                   custom + use-checkbox-group
   molecule  SearchField          extend (components/ui/search.tsx)     HeroUI v3 (existing)
   organism  StatRow              new                                   custom (composition only)
   ...
   ```

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

**Runs before any code generation.** Walks every node in the Pencil
frame and matches it against the foundation manifests extracted in
pre-flight. Builds a per-component **token resolution table** that the
code-generation steps consume. Token references are mandatory; raw
values are drift.

#### Walk the frame

Use `get_design_context({ nodeId })` to enumerate every leaf node and
classify it:

| Node type           | Resolves against                              |
| ------------------- | --------------------------------------------- |
| Text                | `product/.pencil-typography.json`              |
| Icon (named or SVG) | `product/.pencil-icons.json` + brand `iconMap` |
| Fill / stroke color | `product/.pencil-colors.json`                  |
| Border radius       | `product/.pencil-tokens.json` → `radius.*`     |
| Drop shadow         | `product/.pencil-tokens.json` → `shadow.*`     |
| Spacing (gaps, padding, margin) | `product/.pencil-tokens.json` → `space.*` |

#### Typography matching

For each text node, extract the tuple
`(fontFamily, fontSize, lineHeight, fontWeight, letterSpacing, color)`.
Match against the typography manifest with these rules:

1. **Named-style match (preferred)** — if Pencil has a named text style
   on the node (e.g. the designer applied "h3" from the foundation
   library), use that name directly. No fuzzy logic needed.
2. **Value match** — otherwise compare the tuple against every entry in
   the manifest.
   - **Tight tolerance** (default if `--type-tolerance tight`): exact
     match on family + weight + tracking, ±1px on size and lineHeight.
   - **Loose tolerance** (`--type-tolerance loose`): ±2px on size, ±4px
     on lineHeight, ±100 on weight, exact tracking, exact family.
   - **Color is matched separately** — text color resolves through the
     color manifest, not the typography manifest.
3. **No match within tolerance** → enter the **unresolved-node flow**
   (see below). Don't silently record as drift — every unresolved node
   is an explicit decision point.

#### Unresolved-node flow (typography, icons, colors, radius, shadow, spacing)

When a node fails to resolve, the build presents three explicit paths.
The user picks one (or `--auto` mode picks a configured default — see
flag table below). The flow is identical for every token type;
typography is the example, but the same options apply to icons, colors,
radius, shadow, and spacing.

**Path 1 — Snap to the closest existing token.**
Offered when a token exists within **2× the tight tolerance** (so a
text style at 25/33 weight 600 with `h3` at 24/32 weight 600 is
snap-eligible). The build records the snap as drift in
`tests/__pencil__/<comp>/tokens.json` and uses the existing token.
Use this when the design is genuinely close and the difference is
within rounding error; not for legitimate new variants.

**Path 2 — Extend the theme.**
Adds a new token to the project's Tailwind v4 `@theme` block, updates
the matching foundation `.pen`, and refreshes the manifest. This is
the **preferred path** when the design uses a deliberate variant that
should live in the system, not a one-off.

The build proposes a token name derived from the node's role
(`card-meta` for metadata text in a card, `accent-pressed` for an
active-state color, `card-pad` for a card's specific padding).
The user confirms or edits the name, then:

1. **Locate the `@theme` source file**: search project CSS files for
   `@theme {` (typically `app/globals.css`, `src/app.css`, or
   `styles/globals.css`). If none found, create one at the canonical
   location and import it from the app entry.
2. **Append to `@theme`** with a comment marking the origin:
   ```css
   @theme {
     /* …existing tokens… */

     /* Added by /product:design:build-components for StatCard.title on 2026-05-02 */
     --font-card-meta: 500 17px / 24px Inter;
   }
   ```
3. **Update the foundation `.pen`** so the design source of truth is
   not behind the code:
   ```bash
   pencil --in design/foundations/typography.pen \
          --out design/foundations/typography.pen \
          --prompt "Add a new row to the type scale: card-meta, 500 17/24 Inter, tracking 0, used for card metadata. Render it in section 2 between body-md and caption."
   ```
4. **Refresh the manifest** by re-extracting from the updated `.pen`:
   `product/.pencil-typography.json` gets the new entry.
5. **Verify Tailwind picks it up** — run a token-availability check
   (`grep -r "font-card-meta" .next/build/...` or trigger a fresh
   Tailwind compile and check the output CSS). If the utility isn't
   generated, the `@theme` syntax was wrong and we roll back.
6. **Emit code referencing the new utility** as if it had always
   existed.

All five steps are **atomic** — if any one fails, all are rolled back.
The theme and the design system never partially diverge.

**Path 3 — Fail the build.**
For when the unresolved node is the result of a design mistake (the
designer used the wrong size by accident). Build stops; user fixes
the source `.pen` and re-runs.

**Defaults for `--auto` mode** (no interactive prompts):
- `--auto-snap on` (default): Path 1 picks automatically when in range.
- `--auto-extend off` (default): Path 2 always asks. Override with
  `--auto-extend on` for fully autonomous runs that grow the theme
  without confirmation.
- Otherwise → Path 3 fail.

#### Code emission rule (applies to typography, icons, colors, all)

Emit code with the resolved Tailwind class chain referencing theme
tokens. **Arbitrary-value Tailwind syntax (`[xxx]`) is forbidden in
component source.**

```tsx
// ✅ Resolved from manifest
<h3 className={cn(typography.h3, "text-content-1")}>Heading</h3>

// ✅ Or directly via auto-generated utilities (preferred)
<h3 className="font-h3 text-content-1">Heading</h3>

// ❌ Arbitrary values — fails Step 1.5 and the Phase 3 lint sweep
<h3 className="text-[24px] leading-8 font-[600] tracking-[-0.01em] text-[#0A0A0A]">Heading</h3>
```

The `typography` import is a const map generated once per project
(typically `lib/design/typography.ts`) that mirrors the type-scale
manifest. If it doesn't exist yet, generate it on first run. Newer
projects can skip the const map and use the `font-<token>` utilities
directly — Tailwind v4 generates them from `@theme`.

The same code-emission rule applies to every token type: `bg-accent`
not `bg-[#0A84FF]`, `rounded-md` not `rounded-[8px]`, `p-card-pad`
not `p-[18px]`, `shadow-2` not `shadow-[0px_4px_8px_rgba(0,0,0,0.1)]`.

#### Icon matching

For each icon node:

1. **Name match (preferred)** — Pencil icon nodes set by
   `/product:design:foundations:icons` have a `name` attribute (e.g.
   `pen-to-square`, `magnifying-glass`). Match directly against
   `product/.pencil-icons.json` and emit the import.
2. **Action-name lookup** — if the node is named with a semantic
   action (`edit`, `search`, `settings`) rather than a glyph name,
   resolve through brand JSON's `iconMap` to get the canonical glyph
   name, then look up the import.
3. **Fuzzy match (`--icon-match fuzzy`, off by default)** — if the
   node has neither a glyph name nor a recognized action name (raw
   SVG path import, or an icon from a sketch library):
   - Hash the SVG path data and look up against a precomputed hash
     table for the active icon library. Hash collisions are rare for
     library icons.
   - On hash miss, render every library icon at the same dimensions
     as the Pencil node and pixelmatch — closest match wins, but
     only commits if its diff is below 5% of the node area.
   - On match, emit the import + flag in the build manifest as a
     fuzzy resolution (so `pencil:audit` can re-check it later).
4. **No match** → record as drift. Default fail. Either add the icon
   to the design system (extend `foundations/icons.pen` and update
   `iconMap`) or replace it in the source design.

Emit code that imports from the active icon library and respects the
foundation's size scale:

```tsx
// ✅ Resolved — lucide example
import { Pencil } from 'lucide-react';
<Pencil className="h-icon-md w-icon-md" />   // sizes from --icon-md token

// ✅ Resolved — Font Awesome example
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenToSquare } from '@fortawesome/free-solid-svg-icons';
<FontAwesomeIcon icon={faPenToSquare} className="text-icon-md" />

// ❌ Inline SVG — fails Step 1.5 (loses traceability to the foundation)
<svg viewBox="0 0 24 24"><path d="M3 17.25V21h..." /></svg>

// ❌ Arbitrary size — fails the Phase 3 lint sweep
<Pencil className="h-[20px] w-[20px] text-[#0A84FF]" />
```

Sizes resolve through `--icon-{xs..3xl}` tokens declared in `@theme`,
which generate the `h-icon-*` / `w-icon-*` / `text-icon-*` utilities.
Never use arbitrary `h-[N]` values. Color inherits from `currentColor`
unless the design explicitly overrides — in which case the override
resolves through the color manifest.

If a design uses an icon size not in the foundation's size scale
(rare but happens — e.g. a 28px icon between `--icon-md` (20) and
`--icon-lg` (24)), the unresolved-node flow above applies: snap to
the closest existing size, extend the theme with a new size token,
or fail.

#### Color, radius, shadow, spacing

Same pattern, briefer:

| Token type | Source value in `.pen`            | Tolerance | Emit                            |
| ---------- | --------------------------------- | --------- | ------------------------------- |
| Color      | hex / rgba                        | exact     | `bg-accent-500`, `text-content-1` |
| Radius     | px                                | exact     | `rounded-md` (per `--radius-md`) |
| Shadow     | full CSS shadow string            | normalized exact (compare components) | `shadow-2` (per `--shadow-2`) |
| Spacing    | px (paddings, gaps, margins)     | snap to nearest if within ±1px | `p-4`, `gap-3` |

For spacing, the snap rule is important: a designer drawing 17px of
padding almost certainly meant 16 (`space-4`). Snapping ±1px is
benign and avoids junk drift reports. Anything ≥ 2px off is real
drift and fails the gate.

#### Output: the resolution table

Per component, write `tests/__pencil__/<comp>/tokens.json`:

```jsonc
{
  "typography": [
    { "node": "title",   "matched": "h3",      "method": "named",  "drift": null },
    { "node": "label",   "matched": "body-md", "method": "value",  "drift": null },
    { "node": "caption", "matched": "caption", "method": "value",  "drift": { "size": "+1px", "tolerated": true } }
  ],
  "icons": [
    { "node": "leadingIcon",  "matched": "pen-to-square", "method": "name", "drift": null },
    { "node": "trailingIcon", "matched": "chevron-right", "method": "fuzzy",
      "drift": { "pixelDiff": "1.8%", "tolerated": true } }
  ],
  "colors":  [ … ],
  "radius":  [ … ],
  "shadow":  [ … ],
  "spacing": [ … ],
  "summary": { "matched": 23, "drift": 1, "failed": 0 }
}
```

This table feeds the code-generation steps (Path A and Path B) — they
must reference token values from this table, never re-compute from
the raw frame. It's also written to the build manifest so
`/audit` can re-check matches over time.

If the table contains any `"failed"` entries, **stop here** and
report. Don't generate code for a component with unresolved tokens —
that's exactly the drift the gate exists to prevent.

### Step 2 — Path A: Extend an existing component

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
      loop exits, run Step 3.5 (Responsive gate) below against the
      modified component. If the gate fails, the existing component
      may have been responsive-incomplete before this change too —
      treat as a finding to surface, but block the build until fixed.
   7. **Hit max iterations**: stop, print the smallest-diff snapshot,
      ask the user how to proceed.

### Step 3 — Path B: Build a new component

Triggered when no match is found, or `--mode rebuild` is set.

1. **Apply the cascade** in strict order. Pick the first match and
   record the level used:

   | Level | Library | Heuristic |
   | ----- | ------- | --------- |
   | 1 | `@heroui/react@beta` | Component name or close synonym is exported from HeroUI v3. Use as-is with `classNames` overrides + `tailwind-variants` composition for any extension. |
   | 2 | `react-aria-components` | RAC exports a primitive matching the behavior (e.g. `<ToggleButton>`, `<DisclosurePanel>`). Wrap with `tv()` for styling, expose a `classNames` slot prop. |
   | 3 | `@react-aria/*` `use-*` hooks | Behavior available as a hook (`useButton`, `useTextField`, `useFocusRing`). Build custom DOM with the hook providing ARIA props. |
   | 4 | Custom + WAI-ARIA | None of the above fit. Build raw, follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) pattern for the component type. Document in a `// Reason:` comment why levels 1–3 didn't apply. |

2. **Build inside-out** (this matches the user's spec):
   - Identify the Pencil frame's box model: padding, border, margin,
     size (W × H), color (fill, stroke, text). Pull these from the
     frame metadata, not by visual inspection.
   - Identify state-dependent styling: hover, focus, active, disabled,
     loading, error.
   - Compose using `tailwind-variants`:
     ```tsx
     import { tv, type VariantProps } from 'tailwind-variants';
     import { Button as RACButton } from 'react-aria-components';
     import { cn } from '@/lib/utils';

     const button = tv({
       slots: { base: 'inline-flex items-center justify-center …', icon: 'h-4 w-4', label: '' },
       variants: {
         variant: { solid: { base: 'bg-accent text-accent-foreground …' }, … },
         size:    { sm: { base: 'h-8 px-3 text-sm' }, md: { base: 'h-10 px-4' }, … },
       },
       defaultVariants: { variant: 'solid', size: 'md' },
     });
     ```
   - **Placeholder images**: for any media slot in the design (avatars,
     hero images, product photos), emit a placeholder using a deterministic
     service URL derived from the slot name, OR write a local SVG
     placeholder to `public/placeholders/<slot>.svg` and reference it.
     Never inline `data:` URIs — they bloat the component.

3. **Build loop** (max 5 iterations):
   1. Write or update the implementation file.
   2. Write or update the Storybook story (`<component>.stories.tsx`)
      with one story per variant × state combination from the Pencil
      frame's matrix. Use `args` for variants, not separate stories
      per state when the same render serves both.
   3. Run `npm run build-storybook` (or `start-storybook` headless).
   4. Screenshot the canonical story via Playwright at the same
      dimensions as the Pencil frame.
   5. Pixelmatch against `tests/__pencil__/<comp>/design.png` with
      `$designVariance` threshold.
   6. **Exit when diff ≤ designVariance**. On failure, the diff PNG
      shows where pixels disagree — narrow to that region (padding off?
      wrong border-radius? off-by-one in font size?) and adjust.
   7. **Hit max iterations**: stop, print diff, ask the user.

### Step 3.5 — Responsive gate (>400px components only)

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

### Step 4 — Interaction tests

Triggered when the component has interactive behavior. Skip with
`--no-interaction-tests`.

Interactive component types and their canonical test sets:

| Component family       | Test cases                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| Button / IconButton    | click fires, Enter/Space activates, disabled blocks, aria-pressed (toggle)  |
| TextField / TextArea   | typing updates value, focus management, invalid state announces, clear works |
| Select / ComboBox      | open via click + keyboard, ↑↓ navigation, Enter selects, Esc closes, type-ahead |
| Dialog / AlertDialog   | focus trap, Esc closes, return-focus on close, aria-modal, body scroll lock |
| Drawer / Popover       | open/close, focus management, click-outside dismiss, aria-expanded         |
| Tabs                   | ←→ navigation, Home/End, aria-selected, panel association                  |
| Checkbox / Switch / Radio | space toggles, group navigation, aria-checked / aria-pressed              |
| Form                   | submit, validation messaging, focus-on-error                                |
| Table                  | sort triggers, selection (row + all), keyboard nav of cells (where applicable) |
| Disclosure / Accordion | toggle, multiple-vs-single mode, aria-expanded                              |

For each applicable case:

1. **Generate or update the test file**:
   - If Playwright Component Tests is set up: emit
     `<component>.spec.tsx`.
   - Else if a project-specific component test runner is configured:
     emit using its API.
   - Else: emit a Storybook `play()` function on the relevant story.
2. **Run the test loop** (max 5 iterations):
   1. Run the test runner.
   2. On failure, identify the failing assertion and fix the
      implementation (not the test). Rerun.
   3. Exit when all interaction tests pass.
3. **Always include axe-core a11y assertion** at the end of every
   interaction test:
   ```ts
   await expect(page).toPassA11yChecks(); // axe-core wrapper
   ```

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

End with a summary block:

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

### Reverse-dependency tracking (`consumedBy`)

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

### Brief tracking (briefSlug)

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

## SEO + AIO HTML emission

For page-level builds, the design's content shape produced by
`product/design/templates/*` is the source of truth. This command's job
is to translate the design into SEO-correct HTML — semantic tags,
JSON-LD structured data, meta tags, ARIA attributes — reading
both the design (for content) and `.pencil-seo.json` (for strategy).

When `archetypeTargets` is resolved in pre-flight step 8, apply
the rules below during page emission. When the strategy is
missing, emit baseline-correct HTML only.

### Semantic HTML emission

Even without a strategy, page builds emit semantic HTML by default:

- **`<header>`** for the page header / nav bar. The design's nav
  frame becomes `<header><nav>...</nav></header>`.
- **`<main>`** wrapping the page's primary content (everything
  between header and footer). Exactly one `<main>` per page.
- **`<article>`** when the design's main content is article-shaped
  (blog post, single-record detail page, documentation page).
  Optional otherwise.
- **`<section>`** for major content divisions (each section frame
  in the design becomes a `<section>`).
- **`<aside>`** for sidebars, related-content rails, in-page TOC
  panels.
- **`<footer>`** for the page footer.
- **`<nav>`** for any navigation cluster (top nav, breadcrumbs,
  side nav, footer link columns).

Avoid `<div>` for any content with semantic meaning. Reserve
`<div>` for layout-only wrappers. The design's frame names
(`hero`, `feature-triad`, `footer`, etc.) hint at the right
semantic tag — most "section frames" map cleanly to `<section>`.

### Heading hierarchy preservation

The design's heading content (from typography matching at Step 1.5)
maps to HTML heading tags by typography level:

- `display-2xl`, `display-xl`, `display-lg` → `<h1>` (typically
  one per page; the design's hero display headline)
- `display-md`, `display-sm`, `h1` → `<h1>` or `<h2>` depending
  on document structure
- `h2` → `<h2>`
- `h3` → `<h3>`
- ...continuing down

The build verifies:

- **Exactly one `<h1>`** per page emission. When the design has
  multiple display-2xl frames, the build picks the first or asks.
- **Sequential cascade**: H1 → H2 → H3 without skips. When the
  design has a level skip (display-2xl frame followed by an h3
  frame with no h2 between), the build either promotes the h3
  to h2 emission or surfaces a warning.
- **Heading content matches design content** verbatim when
  reasonable; when the design's text is "TITLE" placeholder, the
  build uses the page-frame metadata's `headingPrimary` value or
  warns.

### Meta tag emission

For each page in the build, emit `<head>` content from:

- **`<title>`** — read from page-frame metadata `pageTitle` field;
  fall back to the page's H1 content; warn if both are missing
- **`<meta name="description">`** — read from page-frame metadata
  `metaDescription` field; verify length matches archetype's
  `metaDescriptionLength` (warn if outside range)
- **`<meta name="viewport">`** — universal:
  `width=device-width, initial-scale=1`
- **`<link rel="canonical">`** — when strategy's
  `technical.canonicalUrlsPolicy` is `explicit-everywhere`, emit
  for every page. The canonical URL composes from
  brand JSON's site URL + the page's path.
- **Open Graph tags** (`og:title`, `og:description`, `og:image`,
  `og:url`) — emit for any public-facing page; values mirror
  title/description with `og:image` reading from the design's
  hero image
- **Twitter Card tags** (`twitter:card`, `twitter:title`,
  `twitter:description`, `twitter:image`) — emit alongside
  Open Graph; `twitter:card` is `summary_large_image` for pages
  with hero imagery

### JSON-LD structured data emission

For each page, emit `<script type="application/ld+json">` blocks
per `archetypeTargets.structuredData`. The build reads design
content and brand JSON to populate each schema:

**`Organization`** (site-wide; emitted on every page):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "{{brand.name}}",
  "url": "{{brand.siteUrl}}",
  "logo": "{{brand.siteUrl}}{{brand.logo.darkPath}}",
  "sameAs": [{{brand.socialProfiles}}]
}
</script>
```

**`Article`** (on article-shaped pages):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{page.h1}}",
  "datePublished": "{{page.metadata.datePublished}}",
  "dateModified": "{{page.metadata.dateModified}}",
  "author": { "@type": "Person", "name": "{{page.metadata.author}}" },
  "publisher": { "@type": "Organization", "name": "{{brand.name}}" },
  "image": "{{page.heroImageUrl}}"
}
</script>
```

**`FAQPage`** (when `aioPatterns` includes `faq-schema` and the
design has a FAQ section):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{{question text from design accordion item}}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{{answer text from design accordion content}}"
      }
    }
    // ... one per FAQ item
  ]
}
</script>
```

**`Product` + `Offer`** (on pricing pages and product detail
pages):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "{{product name from design}}",
  "description": "{{product description from design}}",
  "brand": { "@type": "Brand", "name": "{{brand.name}}" },
  "offers": {
    "@type": "Offer",
    "price": "{{tier price from design}}",
    "priceCurrency": "{{currency from design or brand}}",
    "url": "{{page url}}",
    "availability": "https://schema.org/InStock"
  }
}
</script>
```

**`BreadcrumbList`** (on nested pages with breadcrumb navigation
in the design):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "/" },
    { "@type": "ListItem", "position": 2, "name": "Docs", "item": "/docs" },
    { "@type": "ListItem", "position": 3, "name": "{{current page name}}" }
  ]
}
</script>
```

**`HowTo`** (when documentation has step-by-step content):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "{{procedure name from H1}}",
  "step": [
    { "@type": "HowToStep", "name": "{{step 1 heading}}", "text": "{{step 1 content}}" }
    // ... one per numbered step
  ]
}
</script>
```

When the design lacks the content needed for a declared schema
(e.g. archetype declares `Product` but the page has no price
data), surface a warning at build time and skip the schema rather
than emit malformed JSON-LD.

### AIO pattern emission

Per `archetypeTargets.aioPatterns`, the HTML emission applies
specific structures:

- **`faq-schema`** — FAQ accordion in design becomes `<dl>`/`<dt>`/
  `<dd>` semantically (or `<details>`/`<summary>` for native
  toggle behavior) plus the FAQPage JSON-LD above. Both
  semantic markup AND structured data; either alone is weaker.
- **`comparison-table`** — design's comparison content becomes
  real `<table>` with `<thead>`, `<tbody>`, `<th scope="col">`
  for column headers, `<th scope="row">` for row headers when
  applicable. Not `<div>` grids styled to look like tables.
- **`numbered-lists`** — procedural content becomes `<ol>`, not
  styled-`<ul>` or styled-`<div>` sequences.
- **`explicit-definitions`** — definition patterns become
  `<dl>`/`<dt>`/`<dd>` semantic markup. Inline definitions can
  use `<dfn>` for the term being defined.
- **`structured-qa`** — Q&A patterns use `<dl>` (questions in
  `<dt>`, answers in `<dd>`) plus FAQPage JSON-LD when at the
  page level.
- **`citation-ready`** — applies broadly; the build emits
  semantic structure (lists, tables, definitions) wherever
  the design has content that fits these structures.

### Image alt text emission

Every `<img>` tag emits with an `alt` attribute. The value
sources from (in order of preference):

1. The image element's `alt` metadata field in the design
2. The image element's caption text in the design
3. The image element's filename (last resort; surface warning)

Decorative images use `alt=""` (empty) explicitly when the design
flags them as decorative. Never omit the `alt` attribute entirely.

For images that are also linkable (logos linking to home, etc.),
the alt text describes the link destination, not the image
visual ("{{brand.name}} home" not "logo image").

### Link semantics

Internal links (same-domain) use the React framework's `<Link>`
component (Next.js, Remix, etc.) for client-side navigation. The
build resolves which framework's Link based on `package.json`.

External links emit with `rel="noopener noreferrer"` and `target="_blank"`
when the design indicates external. `rel="nofollow"` for
sponsored/UGC links when applicable.

### llms.txt + robots.txt generation

When `strategy.technical.llmsTxt.enabled` is true, the build
generates `public/llms.txt` (or framework-equivalent path) with
content like:

```
# {{brand.name}}
# {{strategy.technical.llmsTxt.summary}}

# Allowed
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

# Preferred entry points
- {{strategy.technical.llmsTxt.preferredEntryPoints[0]}}
- ...
```

Similarly, `public/robots.txt` generation reflects strategy
intent — allowed/blocked bots, sitemap reference, crawl-delay
when set.

These are static files generated at build time; they don't update
on each page build but on strategy change.

### Verification step

After page emission, verify:

- Exactly one `<h1>` per page
- Heading cascade has no level skips
- Every `<img>` has an `alt` attribute
- Required JSON-LD schemas per archetype emitted (warn on missing)
- Meta tags present (title, description, viewport, canonical
  when applicable)
- `<head>` is well-formed (no duplicate canonical, no conflicting
  Open Graph)

Emit a per-page SEO summary alongside the build report:

```
Page: src/app/features/saved-searches/page.tsx (landing-page archetype)
  ✓ One <h1>: "Save searches in seconds"
  ✓ Heading cascade: H1 → H2 (×4) → H3 (×6)
  ✓ Alt text: 8/8 images
  ✓ Meta description: 154 chars (target 150-160)
  ✓ Structured data: Organization, Product, FAQPage, BreadcrumbList
  ✓ AIO patterns applied: faq-schema, definitive-headings, comparison-table
  ⓘ Internal links: 4 (target ≥ 3)
```

Failures are warnings, not build-blocks (unless `--strict-seo`
flag is passed). The audit's Plane 9 catches drift over time;
this verification catches issues at emission time.


---
description: Build phase reference — foundation token resolution (Step 1.5 of /core:frameworks:heroui:build-components). Walks every node in the Pencil frame and matches it against the foundation manifests, builds a per-component token resolution table, and runs the unresolved-node flow when a node fails to match. Loaded by the orchestrator at Step 1.5; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — foundation token resolution (Step 1.5)

**Runs before any code generation.** Walks every node in the Pencil
frame and matches it against the foundation manifests extracted in
pre-flight. Builds a per-component **token resolution table** that the
code-generation steps consume. Token references are mandatory; raw
values are drift.

## Walk the frame

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

## Typography matching

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

## Unresolved-node flow (typography, icons, colors, radius, shadow, spacing)

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

## Code emission rule (applies to typography, icons, colors, all)

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

## Icon matching

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

## Color, radius, shadow, spacing

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

## Output: the resolution table

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
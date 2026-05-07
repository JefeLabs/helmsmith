---
description: Export a .pen file to Figma (via open-pencil's native .fig codec), to static HTML for stakeholder review, or to PDF for archival/print. Also handles the reverse — bringing a designer's edited .fig back into Pencil. Bridges Pencil-managed work with traditional design-tool review workflows.
argument-hint: <pen-file> [--to figma|html|pdf] [--out <path>] [--include-tokens] [--from-fig <path>] [--diff-merge]
allowed-tools: Read, Write, Edit, Bash
---

Export a Pencil `.pen` file to Figma, HTML, or PDF, and bring
designer-edited `.fig` files back into Pencil. Bridges
Pencil-managed work with traditional design-tool review.

This command is a thin orchestrator. The Figma path delegates to
**open-pencil**, an open-source MIT-licensed tool with a native
`.fig` codec that round-trips faithfully and preserves Display-P3
color. HTML and PDF paths use Pencil's own renderer and a headless
Chromium.

## Prerequisite — install open-pencil

The Figma path (and the round-trip flow) require the `open-pencil`
CLI on `PATH`:

```bash
# Homebrew (macOS):
brew install open-pencil

# npm (cross-platform):
npm install -g @open-pencil/cli

# Verify:
open-pencil --version
```

The CLI is ~7MB. It's the same tool whether you only want the
exporter or also want the desktop editor — only the CLI is
required for this command.

For HTML / PDF only, open-pencil is not required.

## When to use

- **`--to figma`**: a designer is reviewing brand directions,
  components, or pages and wants to redline in Figma's commenting
  tools. Or you want a `.fig` artifact for archival in a
  Figma-using organization.
- **`--to html`**: stakeholder review via a shareable link, or
  embedding designs in documentation. No tool installation
  required for the reviewer.
- **`--to pdf`**: handoff packets for legal / compliance review,
  archival, or print review.
- **`--from-fig <path>`**: a designer has edited the previously-
  exported `.fig` and sent it back. This brings their changes into
  the Pencil source of truth. Optionally pair with `--diff-merge`
  to surface changes as a proposed diff rather than overwriting.

For Sketch or Penpot users: this command no longer ships direct
exporters. The path is `.pen` → `.fig` (via this command) → import
into Sketch (Sketch's Figma import feature) or Penpot (Penpot's
Figma import). The `.fig` codec is the bridge format.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve inputs:
   - `<pen-file>` (required for export modes): path to the source
     `.pen`
   - `--to` (required for export): target format
   - `--from-fig <path>` (alternative to `--to`): inverse mode —
     read a `.fig` and write a `.pen`
   - `--out`: output path. Default for Figma:
     `<pen-file-basename>.fig`. Default for HTML / PDF:
     `<pen-file-basename>.{html,pdf}`. Default for `--from-fig`:
     overwrites the original `.pen` (use `--out` to write
     elsewhere).
   - `--include-tokens`: bundle a token reference JSON alongside
     the export. Auto-extracted from the produced file via
     `open-pencil variables`/`analyze`. Default off.
   - `--diff-merge`: only valid with `--from-fig`. Instead of
     overwriting the `.pen`, compute the structural diff between
     the original `.pen` and the returned `.fig`, surface the
     changes, and ask the user to accept/reject per section.

3. For Figma path: verify `open-pencil` is on PATH. If not, print
   the install command and stop.

4. For HTML / PDF: verify write permission on the output path.

## Phase 1 — Per-target export

### Target: Figma

The export is a single CLI invocation:

```bash
open-pencil convert <pen-file> --to fig --out <output>.fig
```

What this delivers:

- **Native `.fig` binary codec** — open-pencil's Kiwi-based codec
  round-trips faithfully. The same internal representations Figma
  uses are produced directly, not approximated through REST API
  translation.
- **Display-P3 color preservation** — open-pencil's color pipeline
  preserves wide-gamut color through the export. Brand palettes
  with P3-only colors stay intact.
- **Component variants** — Pencil component variant frames map to
  Figma's component variant model rather than getting flattened
  into separate frames.
- **Auto-layout** — preserved through the codec.
- **Variables** — Pencil's `@theme` tokens land as Figma variables
  with semantic names (`Accent/500`, not `#0A2E1C`).

What still doesn't survive — these are limits of `.fig` itself,
not the tooling:

- **Pencil motion tokens** — Figma's animation model is different.
  Motion tokens land as comments on the affected nodes for designer
  reference, but don't drive Figma's Smart Animate.
- **Pencil prototype links beyond basic navigation** — Figma's
  prototyping is more limited than Pencil's. Basic links survive;
  advanced flows degrade to comment annotations.

After conversion, the user uploads the `.fig` to Figma. The two
ways:

1. **Drag-and-drop** — open `figma.com`, drag the `.fig` file onto
   the workspace
2. **Figma desktop** — File → Open → select the `.fig`

The command prints both options at the end.

### Target: HTML

A static HTML render for stakeholder review without tool
installation. Unchanged from the prior implementation:

1. Build a single-file `.html` document with embedded CSS and SVG
2. For each Pencil page, render:
   - Container `<section>` with the page's name
   - Each frame as nested `<div>` with computed CSS
   - Text as `<p>` / `<h1>`-`<h6>` per font size hierarchy
   - Images as `<img>` with srcset for retina
   - Auto-layout converted to flex / grid
3. Token references converted to CSS custom properties (the
   exported HTML is a static snapshot, not theme-aware)
4. Optional sidebar with page navigation

What survives: visual rendering, layout, typography.
What doesn't: editability, theme flexibility, component identity.

### Target: PDF

Print-quality PDF for archival or print review.

1. Render the `.pen` to HTML first (per the HTML target above)
2. Use a headless Chromium (Puppeteer / Playwright) to render the
   HTML to PDF
3. Page sizing:
   - Default: A4 portrait per Pencil page
   - `--page-size <iso>` to override (A3, Letter, Legal, custom)
4. Optional: include a token reference appendix

What survives: rendering, layout, typography (embedded fonts).
What doesn't: interactivity, editability, theme flexibility.

## Phase 2 — Token export (when `--include-tokens`)

The token companion file is auto-extracted from the produced file
using open-pencil's analyze tooling:

```bash
# After Figma export:
open-pencil variables <output>.fig --json > <output>.tokens.json
open-pencil analyze colors <output>.fig --json >> <output>.tokens.json
open-pencil analyze typography <output>.fig --json >> <output>.tokens.json
open-pencil analyze spacing <output>.fig --json >> <output>.tokens.json
```

For HTML / PDF, the companion JSON is built from the source `.pen`
since open-pencil doesn't analyze HTML/PDF.

The format:

```jsonc
{
  "exportedFrom": "design/foundations/colors.pen",
  "exportedAt": "<ISO>",
  "exportedTo": "figma",
  "exportedFile": "design/foundations/colors.fig",
  "tokens": {
    "colors":     { "--color-accent-50": "#F4F1ED", "..." },
    "typography": { "--font-h1": "...", "..." },
    "spacing":    { "--space-card-pad": "16px", "..." },
    "variables":  { "<figma-variable-id>": "{ name, type, value }" }
  }
}
```

The token JSON is for human review and version control.

## Phase 3 — Round-trip: bringing edits back from Figma

The `--from-fig` flag inverts the flow. After a designer has
opened the exported `.fig` in Figma, made edits, and exported a
new `.fig` (File → Export → save as `.fig`), bring it back:

```bash
# Simple — overwrite the .pen with the returned .fig:
/product:design:export design/pages/landing.pen --from-fig ./reviewed-landing.fig

# Diff-merge — surface changes, accept/reject per section:
/product:design:export design/pages/landing.pen --from-fig ./reviewed-landing.fig --diff-merge
```

### Simple mode (default)

Single CLI invocation:

```bash
open-pencil convert <returned.fig> --to pen --out <pen-file>
```

The `.pen` file is overwritten with the converted output. The
prior `.pen` is preserved as `<pen-file>.pre-fig-<timestamp>.pen`
for safety.

After conversion, optionally re-run `open-pencil analyze` to
verify token integrity (the comparison surface from Phase 4 below).

### Diff-merge mode (`--diff-merge`)

Treats the returned `.fig` as a proposed change set rather than a
replacement.

1. Convert the returned `.fig` to a temp `.pen`:
   `open-pencil convert <returned.fig> --to pen --out /tmp/<slug>.pen`
2. Run a structural diff between the original `.pen` and the temp
   `.pen` using `/product:design:diff` (or `open-pencil`'s own analyze
   tooling):
   - Per-frame: which frames are new, removed, modified
   - Per-token: which tokens changed values or were renamed
   - Per-component-instance: which instances were swapped or
     reconfigured
3. Surface each change as an accept/reject decision:

```
Diff-merge: ./reviewed-landing.fig → design/pages/landing.pen

Changes detected:

  [1] Hero / desktop / 1440 — copy changed
      Old: "Welcome to Acme — designed for makers"
      New: "Built for builders. Designed for makers."

      [a] Accept   [r] Reject   [s] See full diff

  [2] FeatureGrid / mobile / 390 — column count changed
      Old: 1 column
      New: 2 columns (with reduced text size)

      [a] Accept   [r] Reject   [s] See full diff

  [3] Footer — new token reference --color-accent-700
      (Pencil .pen had --color-accent-600)

      [a] Accept   [r] Reject

  ...

Apply 7 of 9 accepted changes? [y/N]
```

Accepted changes are merged into the original `.pen` via
incremental `pencil --in ... --out ...` calls (or batched via the
tasks file). The final `.pen` reflects original + accepted.

This mode is the safer option for production pages with hand-edits.
The simple mode is fine for early-iteration pages where a complete
overwrite is the intent.

## Phase 4 — Verify

After any export or round-trip, run automated verification.

### After Figma export

Compare token sets between source and exported file:

```bash
# Source tokens:
open-pencil variables <pen-file>     --json | jq '.[] | .name' | sort > /tmp/source-tokens.txt

# Exported tokens:
open-pencil variables <output>.fig   --json | jq '.[] | .name' | sort > /tmp/exported-tokens.txt

# Diff:
diff /tmp/source-tokens.txt /tmp/exported-tokens.txt
```

Anything missing from the exported set is a fidelity loss the user
should know about. Most often this is motion tokens (expected) or
component variant overrides (unexpected — surface as a warning).

The command runs this automatically and surfaces results in the
final report (Phase 5 below).

### After round-trip (`--from-fig`)

Same comparison, but now between the returned `.fig` and the
target `.pen`:

```bash
open-pencil variables <returned.fig> --json > /tmp/returned-tokens.json
open-pencil variables <pen-file>     --json > /tmp/pen-tokens.json
# Diff the two
```

Surface any tokens the designer dropped or added so the user can
review. Designers don't always realize they're dropping a token
when they delete a node.

### After HTML / PDF

No automated verify — these are visual outputs. Print the file
location and let the user open and review.

## Reporting

```
✅ Exported design/foundations/colors.pen → Figma

   Source:           design/foundations/colors.pen
   Output:           design/foundations/colors.fig (via open-pencil)
   Pages exported:   1 (Foundations / Colors)
   Frames exported:  47 (codec: native .fig binary)
   Token export:     12 styles, 89 variables

   Verify (token set):
   ✓ All 89 tokens present in .fig
   ⚠ Motion tokens (4): not represented in .fig (expected — Figma
     animation model differs from Pencil motion tokens)

   Distribute:
   - Drag colors.fig onto figma.com, OR
   - File → Open in Figma desktop, OR
   - Share the file via your team's storage

📝 To bring designer edits back:
   /product:design:export design/foundations/colors.pen --from-fig <reviewed-file>.fig --diff-merge
```

For round-trip:

```
✅ Round-trip applied: ./reviewed-colors.fig → design/foundations/colors.pen

   Mode:                 diff-merge
   Changes detected:     9
   Changes accepted:     7
   Changes rejected:     2

   Backup:               design/foundations/colors.pen.pre-fig-2026-05-02-153000.pen

   Verify (token set):
   ✓ All 89 tokens still present
   ⚠ 1 new token introduced: --color-accent-650
     Add to product/.pencil-brand.json + foundations/colors.pen if intentional

📝 Next steps:
   - Review design/foundations/colors.pen
   - Run /audit if structural changes warrant
   - Commit the updated .pen
```

## What this command does NOT do

- **Does not upload to Figma's hosted workspace.** Open-pencil
  produces a local `.fig` file. Distribution (drag-and-drop, or
  Figma desktop "Open") is the user's step. This is intentional —
  no Figma API key, no workspace configuration, no auth concerns.
- **Does not export Sketch or Penpot directly.** Use `.fig` as
  intermediate and import via the destination tool's Figma-import
  feature.
- **Does not preserve Pencil-specific features that don't have
  Figma equivalents** (motion semantics beyond comments,
  conditional frames beyond named variants, advanced prototype
  flows). The codec preserves what `.fig` represents; what `.fig`
  doesn't represent is annotated as comments where possible.
- **Does not handle proprietary fonts in destinations that lack
  the font installed.** Fonts are referenced by name; missing
  fonts fall back to the destination's system stack. This is a
  Figma limitation, not an export limitation.
- **Does not auto-merge round-trip changes without `--diff-merge`.**
  Simple `--from-fig` mode overwrites; the prior is preserved as a
  backup. Use `--diff-merge` for surgical control.
- **Does not cross-reference other Pencil artifacts.** Each export
  is a single `.pen` → single `.fig` operation. Multi-file
  workflows scaffold with a shell script.

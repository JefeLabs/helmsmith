# Storybook Migration — Sub-Namespace Context (`frameworks/storybook/migration/`)

> Read this in addition to `frameworks/storybook/_context.md`
> whenever any `/frameworks:storybook:migration:*` command runs.
>
> This sub-namespace owns framework-version migration
> verification — the work of confirming that a component
> rendered identically before and after a framework upgrade.
> Distinct from drift remediation (which handles ongoing
> hygiene) and verify (which handles general correctness).

## What this sub-namespace is for

Two commands:

- **`/frameworks:storybook:migration:verify`** — orchestrated
  verification that a story's migration produced no regressions
  via 5 sequential loops (functional, font, spacing, pixel,
  color) with 3-retry budget per loop
- **`/frameworks:storybook:migration:fix-pattern`** — document
  or look up known migration gotchas

Migration verification is the most complex sub-namespace
because migrations have a high cost of regression — a button
that renders 2 pixels differently after migration affects every
page. The 5-loop pattern catches different classes of
regression with appropriate tooling per loop.

## What "migration" means in this context

A framework migration is a deliberate upgrade or framework
swap that touches the rendering layer:

- HeroUI v2 → v3 (component compound pattern changes)
- Storybook 8 → 9 (config format changes)
- Tailwind v3 → v4 (theme directive changes)
- React 18 → 19 (concurrent features, suspense behavior)
- Next.js 14 → 15 (App Router maturity, Turbopack)
- Switching from Material UI to HeroUI

Migrations touch many components simultaneously. Manual review
is impractical; automated verification with structured loops
is the only sustainable approach.

## The 5-loop pattern

Each loop catches a specific class of regression and uses
appropriate tooling. Loops run sequentially; failure in any
loop blocks subsequent loops (no point checking color when
the component doesn't render).

### Loop 1 — Functional

**Catches**: component renders at all? Does it produce something
visible?

**Method**: Playwright screenshot capture. If screenshot fails
or comes back blank, functional loop fails.

**Retry budget**: 3 attempts (sometimes first attempt fails on
webpack hot reload glitch; retries handle that)

**Tooling**: Playwright CLI (sufficient; MCP not needed)

### Loop 2 — Font

**Catches**: did the component end up with the wrong fonts?
Font fallbacks rendering instead of intended fonts?

**Method**: Chrome DevTools MCP query for `document.fonts`
collection plus computed style on key text elements.
Compares fonts loaded in before vs after.

**Retry budget**: 3 attempts

**Tooling**: Chrome DevTools MCP preferred (richer font query);
Playwright scripting fallback if MCP unavailable

**Why this matters**: web fonts are notoriously fragile during
upgrades. A missing `@font-face` rule, a wrong `font-display`,
a CSS specificity change can swap the rendered font without
causing any other failure. Visual diff catches this but slowly;
explicit font query catches it immediately.

### Loop 3 — Spacing

**Catches**: did padding, margins, gaps change between before
and after? Same content, but laid out 4 pixels differently?

**Method**: Chrome DevTools MCP query for computed styles on
key layout elements (padding, margin, gap, height, width).
Compares before vs after with tolerance.

**Retry budget**: 3 attempts

**Tooling**: Chrome DevTools MCP preferred; Playwright fallback

**Why this matters**: Tailwind spacing scale changes between
versions. Theme directive changes can shift the entire spacing
scale. Spacing diffs cascade — a 2px change in Button padding
becomes a 4px change in any container with multiple buttons.

### Loop 4 — Pixel

**Catches**: any visual difference not caught by the structured
loops above. The catch-all visual regression check.

**Method**: pixelmatch diff between before/after screenshots
with the manifest's threshold.

**Retry budget**: 3 attempts (anti-aliasing variations cause
sporadic single-pixel drift; retries average out)

**Tooling**: pixelmatch CLI

**Classification per the manifest's matchClassification**:
- 0 diff pixels: MATCH (pass)
- 1-49 diff pixels: WARN (pass with note)
- 50+ diff pixels: DIFF (fail)

### Loop 5 — Color

**Catches**: color shifts that aren't full-pixel diffs (e.g., a
slight hue change from #4F46E5 to #4338CA — 50+ pixels DIFF
but reading the diff as "colors got slightly different" needs
explicit color analysis).

**Method**: ImageMagick `compare` with color metric, plus
unique-color enumeration. Compares color palettes between
before and after.

**Retry budget**: 3 attempts

**Tooling**: ImageMagick CLI (optional — if absent, this loop
is skipped with a warning, not failed)

**Why this matters**: brand color updates often happen DURING
framework migrations (someone tweaked theme tokens while
upgrading). Pixel diffs surface the change but don't tell you
if it's "the navy got darker" vs "everything looks broken."
Color loop classifies.

## Retry budget across loops

Each loop has 3 attempts. Failure logic:

```
Loop attempt 1 → fail
Loop attempt 2 → fail
Loop attempt 3 → fail
   ↓
Loop FAILED. Stop loop sequence.
```

Total worst-case: 5 loops × 3 attempts = 15 attempts per story.
Realistic typical: 1 attempt per loop = 5 total when migration
went cleanly.

Reasons retries help:
- Webpack/vite HMR glitch on first attempt (common)
- Network resource (font, image) racing the screenshot
- Chrome DevTools MCP query before page settled
- Browser process leftover from previous run (mitigated by
  pre-flight cleanup)

## Activation gate

All migration commands check the framework binding manifest
before proceeding. Plus they require BOTH before/ AND after/
screenshot directories OR equivalent state from a prior migration
run:

```bash
# Activation gate (storybook binding)
ACTIVE=$(jq -r '.documentationBindings.storybook.active // false' \
              product/.pencil-frameworks.json 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  # ... refuse
fi

# Migration state check
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)
test -d "${SCREENSHOT_DIR}before/" || {
  echo "No before/ screenshots found. Migration verify needs"
  echo "before/ baseline captured BEFORE the migration."
  echo ""
  echo "If you haven't started the migration yet, capture now:"
  echo "  /frameworks:storybook:verify:screenshot all --label before"
  echo ""
  echo "Then perform your migration work, then run:"
  echo "  /frameworks:storybook:verify:screenshot all --label after"
  echo "  /frameworks:storybook:migration:verify"
  exit 1
}
```

## Tool dependencies

| Tool | Required by | Optional/Required |
|------|-------------|-------------------|
| Playwright | All loops (page navigation, screenshots) | Required |
| pixelmatch | Loop 4 | Required |
| Chrome DevTools MCP | Loops 2, 3 | Optional (Playwright fallback) |
| ImageMagick | Loop 5 | Optional (loop skipped if absent) |

Pre-flight checks via `.pencil-tools.json`. Tools manifest
should declare these as required vs optional per the table
above.

## Known gotchas registry

The runtime manifest at `product/.pencil-storybook.json`
contains a `knownGotchas` array — project-specific migration
issues encountered and documented. Each gotcha has:

```jsonc
{
  "framework": "heroui",
  "version": "v3",
  "component": "Button",
  "issue": "compound component pattern; Button.Icon → ButtonIcon",
  "fix": "Wrap children differently...",
  "addedDate": "2026-04-15"
}
```

The `migration:verify` command reads this registry; when a
loop fails, it surfaces matching gotchas as "have you hit
this before?" suggestions.

The `migration:fix-pattern` command writes to the registry
via `--add-gotcha`.

## Migration workflow integration

Typical migration sequence:

```bash
# 1. Capture before
/frameworks:storybook:verify:screenshot all --label before

# 2. Perform migration work
#    - Update package.json
#    - Run framework's codemod if available
#    - Address obvious code changes
#    - Restart Storybook

# 3. Capture after
/frameworks:storybook:verify:screenshot all --label after

# 4. Verify
/frameworks:storybook:migration:verify all

# 5. For failures: investigate
/frameworks:storybook:migration:verify Button --debug
# (drills into specific component)

# 6. Document gotchas you find
/frameworks:storybook:migration:fix-pattern --add-gotcha
```

## Scope flexibility

Migration verify supports scopes:

- **Single story**: `Button--default`
- **Component**: `Button` (verifies all Button stories)
- **Category**: `atoms`
- **All**: default

For comprehensive migration verification, run `all` and accept
the time cost (5 loops × 3 retries × N stories). For triaging
specific failures, run targeted scopes.

## Anti-patterns

- **Skipping the before screenshot.** Migration verify is
  comparison-based; without before/ you have no baseline. The
  command refuses to run rather than producing meaningless
  results.
- **Running before/after captures with different configurations.**
  The same viewport, browser, and timing must be used for both.
  The manifest enforces this; users who manually capture
  with different settings get unreliable diffs.
- **Treating WARN as MATCH.** WARN (1-49 diff pixels) means
  "small but worth investigating." On simple components small
  diffs can hide real regressions; the WARN tier exists so
  these get attention rather than glossed over.
- **Modifying the gotchas registry by hand.** The
  `migration:fix-pattern --add-gotcha` command is the canonical
  writer. Hand edits work but lose the documentation discipline
  the command enforces (categorization, fix description,
  cross-references).
- **Running parallel verification.** Same as verify
  sub-namespace — sequential processing only. The dev server
  isn't parallel-safe.

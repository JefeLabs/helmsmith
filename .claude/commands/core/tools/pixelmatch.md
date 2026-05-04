---
description: Pixelmatch image diff tool. Compares two PNG images pixel-by-pixel with anti-aliasing tolerance. CLI only — no MCP. The visual regression primitive for migration verification, component-dedup, and any command needing image comparison. Outputs diff pixel count and optional diff visualization.
argument-hint: <image-a-path> <image-b-path> [<diff-output-path>] [--threshold <0-1>] [--include-aa]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of pixelmatch for visual diffs between two
images. The fundamental visual comparison primitive consumed
by storybook migration verification (Loop 4) and component
duplicate detection.

## Phase 0: pre-flight

1. Verify pixelmatch active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.pixelmatch.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "pixelmatch not active. Run /core:tools:setup pixelmatch"
     exit 1
   fi
   ```

2. Verify pixelmatch is invokable:

   ```bash
   command -v npx >/dev/null 2>&1 || {
     echo "npx required (Node.js)"
     exit 1
   }
   
   # pixelmatch may be installed globally or as project dep
   PIXELMATCH_AVAILABLE=$(npx --no-install pixelmatch --help 2>/dev/null && echo true || echo false)
   if [ "$PIXELMATCH_AVAILABLE" != "true" ]; then
     # Check if @types/pixelmatch in project (means library form)
     LIB_AVAILABLE=$(node -e "require.resolve('pixelmatch')" 2>/dev/null && echo true || echo false)
     if [ "$LIB_AVAILABLE" != "true" ]; then
       echo "pixelmatch not installed. Run: npm install -g pixelmatch"
       echo "Or as project dep: npm install --save-dev pixelmatch pngjs"
       exit 1
     fi
   fi
   ```

3. Verify input images exist:

   ```bash
   IMAGE_A="$1"
   IMAGE_B="$2"
   DIFF_OUT="${3:-/tmp/pixelmatch-diff.png}"
   
   [ -f "$IMAGE_A" ] || { echo "Image A not found: $IMAGE_A"; exit 1; }
   [ -f "$IMAGE_B" ] || { echo "Image B not found: $IMAGE_B"; exit 1; }
   ```

## Phase 1: prompt interpretation

pixelmatch operations are simpler than most tools — primary
operation is "compare two images." Parameters:

- **Threshold**: 0-1, controls per-pixel sensitivity (default
  0.1; higher = more tolerant of small differences)
- **Anti-aliasing detection**: when enabled, ignores
  anti-aliasing differences (--include-aa flag inverts this)
- **Diff output**: path to save the diff visualization

For prompts like "compare before.png and after.png", the
interpretation is direct.

For complex prompts like "find pixel differences between the
SkoolScout homepage and the staging version, show me anything
above 1% different," the integration:
1. Captures both images via Playwright (cross-tool composition)
2. Runs pixelmatch
3. Classifies result against threshold

## Phase 2: execution

Invoke pixelmatch CLI:

```bash
THRESHOLD="${THRESHOLD:-0.1}"

DIFF_PIXELS=$(npx pixelmatch \
  "$IMAGE_A" \
  "$IMAGE_B" \
  "$DIFF_OUT" \
  "$THRESHOLD" 2>/dev/null)

EXIT_CODE=$?
```

pixelmatch outputs the diff pixel count to stdout. Exit code
is 0 if images are identical (within threshold), non-zero
otherwise.

## Phase 3: classification

Per the storybook manifest's matchClassification convention,
classify the result:

```bash
classify_diff() {
  local DIFF_PIXELS="$1"
  
  if [ -z "$DIFF_PIXELS" ] || [ "$DIFF_PIXELS" -eq 0 ]; then
    echo "MATCH"
  elif [ "$DIFF_PIXELS" -lt 50 ]; then
    echo "WARN"  # likely sub-pixel anti-aliasing
  else
    echo "DIFF"
  fi
}

CLASSIFICATION=$(classify_diff "$DIFF_PIXELS")
```

The thresholds (50 pixels for WARN cutoff) come from
`.pencil-storybook.json`'s `visualRegression.matchClassification`
when invoked from storybook commands; defaults apply for
direct invocation.

## Phase 4: result formatting

```
=== Pixelmatch Comparison ===
Image A:        before.png (1280x800)
Image B:        after.png  (1280x800)
Threshold:      0.1
Diff pixels:    127
Classification: DIFF
Diff output:    /tmp/diff.png

Summary: 127 pixels differ between the images. Sub-pixel
threshold suggests this is a real visual change, not
anti-aliasing artifact.

Visualize diff: open /tmp/diff.png
```

When images are different sizes, pixelmatch fails — surface
that explicitly:

```
=== Pixelmatch Failed ===
Reason:    Images have different dimensions
Image A:   1280x800
Image B:   1440x900

pixelmatch requires same dimensions. Either:
  - Re-capture both at the same viewport
  - Resize before comparing (use ImageMagick: /core:tools:imagemagick)
```

## Phase 5: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| Different dimensions | Capture viewports differ | Match viewports; or pre-resize via ImageMagick |
| File not found | Path wrong | Verify paths absolute and files exist |
| Invalid PNG | File corrupt or wrong format | Re-capture; pixelmatch only handles PNG |
| Out of memory | Very large images | Crop to relevant region; reduce resolution |

## Cross-namespace integration

pixelmatch is consumed by:

- **`frameworks/storybook/migration/verify`** — Loop 4
  (pixel diff between before/after migration screenshots)
- **`frameworks/storybook/verify/screenshot`** — composes
  with pixelmatch for before/after comparison workflows
- **`engineer/maintenance/remediation/component-dedup`** —
  visual regression to verify duplicate components render
  identically before consolidation

## What this tool does NOT do

- **Capture screenshots.** That's Playwright (`/core:tools:playwright`).
  pixelmatch only compares existing PNG files.
- **Resize images.** Use ImageMagick (`/core:tools:imagemagick`)
  before pixelmatch when sizes differ.
- **Color analysis.** ImageMagick handles color palette
  comparison; pixelmatch is binary same/different per pixel.
- **Compare non-PNG formats.** PNG only. Convert via
  ImageMagick first.
- **Multi-image comparison.** Two images at a time.
- **Tolerance for content shifts.** A 1px translation produces
  many diff pixels. pixelmatch is strict; use ImageMagick for
  more sophisticated comparisons (mean-squared-error,
  structural similarity).

## Examples

```bash
# Direct comparison
/core:tools:pixelmatch before.png after.png

# With threshold and diff output
/core:tools:pixelmatch before.png after.png /tmp/diff.png --threshold 0.05

# As part of migration verification (programmatic)
# (Invoked by /core:frameworks:storybook:migration:verify)
```

---

# Registry definition

## Tool metadata

```yaml
name: pixelmatch
displayName: pixelmatch
provider: mapbox-community
category: image-diff
optional: false   # required by storybook migration verify
```

## Interfaces

### CLI

```yaml
executable: npx pixelmatch
detectionCommand: npx --no-install pixelmatch --help
installCommand: |
  Global:
    npm install -g pixelmatch
  Project:
    npm install --save-dev pixelmatch pngjs
notes: |
  pixelmatch is also available as a JavaScript library;
  some commands use it programmatically via
  require('pixelmatch') for tighter integration.
```

### MCP

**Not available.** pixelmatch is a simple CLI tool; no MCP
server exists or is needed.

## Version constraint

Recommended: pixelmatch 5.x. The CLI surface has been stable
across versions.

## Required by skillz commands

Auto-populated. Currently:
- /core:frameworks:storybook:migration:verify (Loop 4)
- /engineer:maintenance:remediation:component-dedup

## Cross-tool dependencies

- pngjs (peer dependency for PNG decoding)
- May compose with ImageMagick for pre-processing (resize,
  format conversion)

## System requirements

- Node.js 14+
- Negligible disk (small package)

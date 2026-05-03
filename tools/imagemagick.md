---
description: ImageMagick image manipulation and analysis. Format conversion, resizing, color palette extraction, advanced visual diff (mean-squared-error, structural similarity), histogram analysis. CLI only — no MCP. Optional dependency for storybook migration verify Loop 5 (color analysis); commands degrade gracefully when absent.
argument-hint: <free-form-prompt> [image paths...]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of ImageMagick for image manipulation,
color analysis, and advanced visual comparisons. The
sophisticated alternative to pixelmatch when binary
same-different isn't enough.

## Phase 0: pre-flight

1. Verify imagemagick active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.imagemagick.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "ImageMagick not active. Run /tools:setup imagemagick"
     exit 1
   fi
   ```

2. Verify ImageMagick installed:

   ```bash
   if command -v magick >/dev/null 2>&1; then
     # IM 7+
     IM_CMD="magick"
   elif command -v convert >/dev/null 2>&1; then
     # IM 6 fallback
     IM_CMD="convert"
   else
     echo "ImageMagick not installed."
     echo "  macOS: brew install imagemagick"
     echo "  Linux: apt install imagemagick / dnf install imagemagick"
     echo "  Windows: choco install imagemagick"
     exit 1
   fi
   ```

   ImageMagick 7 uses `magick` as the entry point; 6 uses
   `convert`/`identify`/`compare` as separate commands. The
   suite handles both.

## Phase 1: prompt interpretation

Operations ImageMagick handles:

### Format conversion

- PNG → JPEG, JPEG → PNG, etc.
- HEIC, WebP, AVIF, TIFF, BMP, SVG (rasterize)

### Resizing and cropping

- Resize to specific dimensions (with or without aspect ratio
  preservation)
- Crop to bounding box
- Trim transparent / solid-color borders

### Color analysis

- **Unique colors enumeration** — list all distinct colors in
  an image
- **Top N colors** — most prevalent colors by pixel count
- **Histogram** — color distribution
- **Color palette extraction** — for design system audits

### Advanced visual comparison

- **`compare` operation** — produces difference image AND
  numeric metrics
- **Mean Squared Error (MSE)** — average pixel difference
- **Peak Signal-to-Noise Ratio (PSNR)** — quality metric
- **Structural Similarity Index (SSIM)** — perceptual similarity
- **Phash** — perceptual hash for similarity detection

These metrics catch differences that pixelmatch (binary
same-different per pixel) misses or over-flags.

### Annotation and visualization

- Add labels to images
- Composite multiple images into a single sheet
- Generate diff visualizations with custom highlight colors

## Phase 2: execution

### Format conversion

```bash
$IM_CMD input.heic output.png
$IM_CMD input.jpg output.png
```

### Resize

```bash
# Resize to specific dimensions
$IM_CMD input.png -resize 800x600 output.png

# Resize with aspect ratio preserved (fits within)
$IM_CMD input.png -resize 800x600\> output.png

# Force exact dimensions (may distort)
$IM_CMD input.png -resize 800x600! output.png
```

### Color analysis

```bash
# Unique colors count
COLOR_COUNT=$($IM_CMD identify -format "%k" input.png)

# Top N colors with counts
$IM_CMD input.png \
  -format "%c" \
  histogram:info:- | \
  sort -rn | \
  head -10

# Output looks like:
#   1024: ( 63, 81,181) #3F51B5 srgb(63,81,181)
#    512: (  0, 0, 0) #000000 black
#    ...

# Extract just hex values
extract_top_colors() {
  local IMG="$1"
  local TOP_N="${2:-10}"
  
  $IM_CMD "$IMG" -format "%c" histogram:info:- | \
    sort -rn | \
    head -n "$TOP_N" | \
    grep -oE '#[A-F0-9]{6}'
}
```

### Visual comparison via compare

```bash
# Default: produce diff image highlighting differences
$IM_CMD compare input-a.png input-b.png diff.png

# With metric output
DIFF_METRIC=$($IM_CMD compare -metric MSE \
  input-a.png input-b.png \
  diff.png 2>&1)

echo "Mean Squared Error: $DIFF_METRIC"

# SSIM (perceptual similarity, 0-1; 1 = identical)
SSIM=$($IM_CMD compare -metric SSIM \
  input-a.png input-b.png \
  diff.png 2>&1)
```

### Histogram for spread

```bash
# Generate histogram visualization
$IM_CMD input.png histogram:histogram.png
```

## Phase 3: result formatting

### Color palette extraction

```
=== Color Palette: design-system-export.png ===
Image:           1280x800 PNG
Unique colors:   8,234
Top 10 colors (by pixel count):

  Rank  Hex      Pixels    %       Closest named
  ----  -------  --------  ------  -------------
  1     #FFFFFF  234,512   22.9%   White (background)
  2     #3F51B5  189,234   18.5%   Indigo (primary brand)
  3     #1A1A1A  87,123    8.5%    Near-black (text)
  4     #F5F5F5  76,234    7.4%    Light gray (surfaces)
  5     #E91E63  45,123    4.4%    Pink (accent)
  ...
```

### Visual comparison metrics

```
=== Image Comparison ===
Image A:    before-migration.png (1280x800)
Image B:    after-migration.png (1280x800)
Diff out:   diff.png

Metrics:
  MSE (Mean Squared Error):       12.34
  PSNR (Peak Signal-to-Noise):    37.2 dB
  SSIM (Structural Similarity):   0.987 (1.0 = identical)
  Phash distance:                 4

Interpretation:
  SSIM 0.987 indicates substantially identical perceptually
  with minor differences. Migration loop 5 (color) would
  classify as PASS or WARN depending on threshold.
```

### Histogram

```
=== Color Distribution: dashboard.png ===
Total pixels:    1,024,000
Distinct colors: 12,453
Saved histogram visualization to: histogram.png
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `convert: not authorized` | ImageMagick policy blocks operation | Edit /etc/ImageMagick-7/policy.xml; PDF/SVG often blocked by default |
| `unable to read image` | Format not supported or file corrupt | Verify file integrity; install format dependencies |
| Out of memory | Large image | Tile-based processing; reduce resolution |
| Different dimensions for compare | Sizes mismatch | Resize first; or use -gravity / -extent |

## Cross-namespace integration

ImageMagick is consumed by:

- **`frameworks/storybook/migration/verify`** — Loop 5 (color
  palette analysis). Loop is SKIPPED when ImageMagick absent
  (graceful degradation; not failed).
- **`frameworks/storybook/verify/health`** — color count for
  blank screenshot detection (`unique-colors txt:` output)
- **`engineer/maintenance/remediation/component-dedup`** —
  histogram comparison for near-duplicate detection
- **Asset preparation workflows** — format conversion before
  upload to design systems, social platforms, etc.

## What this tool does NOT do

- **Capture screenshots.** That's Playwright.
- **Replace Photoshop / Affinity / Figma.** Programmatic
  manipulation; not for designer workflows.
- **OCR / text extraction.** Use Tesseract or similar.
- **Animation generation.** ImageMagick can do basic GIF/MP4
  composition but it's not the right tool for video.

## Examples

```bash
# Format conversion
/tools:imagemagick "convert /tmp/input.heic to PNG saved at /tmp/output.png"

# Resize
/tools:imagemagick "resize /tmp/large.png to 800px wide preserving aspect ratio, save as /tmp/small.png"

# Color palette extraction
/tools:imagemagick "show me the top 10 colors in /tmp/design-system.png"

# Visual diff with metrics
/tools:imagemagick "compare /tmp/before.png and /tmp/after.png; report MSE and SSIM"

# Histogram
/tools:imagemagick "generate color histogram for /tmp/dashboard.png"
```

---

# Registry definition

## Tool metadata

```yaml
name: imagemagick
displayName: ImageMagick
provider: imagemagick-org
category: image-manipulation
optional: true   # storybook migration verify Loop 5 skips
                 # gracefully when absent
```

## Interfaces

### CLI

```yaml
executable: magick (IM 7) or convert (IM 6)
detectionCommand: |
  command -v magick || command -v convert
installCommand: |
  macOS:   brew install imagemagick
  Linux:   apt install imagemagick (Debian/Ubuntu)
           dnf install imagemagick (Fedora/RHEL)
  Windows: choco install imagemagick
           or download from https://imagemagick.org/
notes: |
  ImageMagick 7 (recommended) uses 'magick' as entry point.
  ImageMagick 6 uses separate commands (convert, identify,
  compare). Suite detects which is installed and uses the
  appropriate command form.
  
  IM 7 is preferred — 6 is feature-complete but increasingly
  legacy.
```

### MCP

**Not available.** ImageMagick is a CLI tool with deep
parameter surface; no MCP server exists. Direct CLI is the
canonical interface.

## Version constraint

Recommended: ImageMagick 7.1+. IM 6.9+ also works with the
multi-command form.

## Required by skillz commands

Auto-populated. Currently:
- /frameworks:storybook:migration:verify (Loop 5; optional)
- /frameworks:storybook:verify:health (blank detection;
  optional)
- /engineer:maintenance:remediation:component-dedup (optional)

## Cross-tool dependencies

None. ImageMagick is self-contained.

For format support:
- HEIC/HEIF: requires libheif (often bundled on modern installs)
- WebP: requires libwebp
- SVG: requires librsvg or imagemagick-svg

## System requirements

- ~80 MB disk
- Adequate RAM for image size (large images may need swap)
- macOS: Apple Silicon supported via Homebrew

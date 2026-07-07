---
description: Orchestrated migration verification through 5 sequential loops (functional, font, spacing, pixel, color) with 3-retry budget per loop. Compares before/ vs after/ screenshots and computed properties; surfaces regressions classified by which loop caught them. The most complex command in the storybook namespace; handles framework-version-specific verification.
argument-hint: [scope] [--debug] [--from-loop <1-5>] [--strict] [--skip-color] [--json]
allowed-tools: Read, Write, Edit, Bash
---

Verify a migration produced no regressions through 5 sequential
verification loops. Each loop catches a specific class of
regression with appropriate tooling; failure in any loop blocks
subsequent loops.

The orchestrator reads the manifest, walks the loops in order,
manages retries, aggregates results, surfaces matching gotchas.

## Phase 0: pre-flight

Per `frameworks/storybook/migration/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists
3. Storybook running
4. Screenshots directory has both `before/` and `after/`
5. Tools available:
   - Playwright (required)
   - pixelmatch (required)
   - Chrome DevTools MCP (optional — used by font and spacing loops)
   - ImageMagick (optional — color loop skipped if absent)
6. Kill stale browser processes

```bash
# Tool availability
PLAYWRIGHT=$(jq -r '.tools.playwright.interfaces.cli.available // false' product/.pencil-tools.json)
PIXELMATCH=$(jq -r '.tools.pixelmatch.interfaces.cli.available // false' product/.pencil-tools.json)
CHROME_MCP=$(jq -r '.tools.chrome-devtools.interfaces.mcp.available // false' product/.pencil-tools.json)
IMAGEMAGICK=$(jq -r '.tools.imagemagick.interfaces.cli.available // false' product/.pencil-tools.json)

[ "$PLAYWRIGHT" = "true" ] || { echo "Playwright required. Run /core:tools:setup playwright"; exit 1; }
[ "$PIXELMATCH" = "true" ] || { echo "pixelmatch required. Run /core:tools:setup pixelmatch"; exit 1; }

[ "$CHROME_MCP" != "true" ] && echo "Chrome DevTools MCP not available; font and spacing loops use Playwright fallback (less rich)."
[ "$IMAGEMAGICK" != "true" ] && echo "ImageMagick not available; color loop will be skipped."
```

## Phase 1: scope resolution

Same pattern as `verify:health`. Resolves to story IDs.

For each story ID, check that both `before/<story-id>.png`
and `after/<story-id>.png` exist:

```bash
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)

for STORY_ID in $STORY_IDS; do
  BEFORE="${SCREENSHOT_DIR}before/${STORY_ID}.png"
  AFTER="${SCREENSHOT_DIR}after/${STORY_ID}.png"
  
  if [ ! -f "$BEFORE" ]; then
    MISSING_BEFORE+=("$STORY_ID")
  elif [ ! -f "$AFTER" ]; then
    MISSING_AFTER+=("$STORY_ID")
  else
    READY+=("$STORY_ID")
  fi
done
```

Surface the gap if any:

```
Migration verification setup:
  Stories with both before+after: 245
  Missing before/: 2 stories (skipped)
  Missing after/: 0 stories

Proceed with 245 stories? [Y/n]
```

## Phase 2: per-story 5-loop verification

For each ready story, run the 5 loops in sequence. Failure in
any loop blocks subsequent loops for that story; orchestrator
moves to next story.

```bash
for STORY_ID in "${READY[@]}"; do
  echo "=== Verifying: $STORY_ID ==="
  
  STORY_RESULT="PASS"
  FAILED_LOOP=""
  FAILURE_DETAIL=""
  
  # Loop 1: Functional
  for ATTEMPT in 1 2 3; do
    run_loop_1_functional "$STORY_ID"
    if [ "$LOOP_RESULT" = "PASS" ]; then break; fi
    [ "$ATTEMPT" = "3" ] && STORY_RESULT="FAIL" && FAILED_LOOP="1-functional"
  done
  
  if [ "$STORY_RESULT" = "PASS" ]; then
    # Loop 2: Font
    for ATTEMPT in 1 2 3; do
      run_loop_2_font "$STORY_ID"
      if [ "$LOOP_RESULT" = "PASS" ]; then break; fi
      [ "$ATTEMPT" = "3" ] && STORY_RESULT="FAIL" && FAILED_LOOP="2-font"
    done
  fi
  
  if [ "$STORY_RESULT" = "PASS" ]; then
    # Loop 3: Spacing
    for ATTEMPT in 1 2 3; do
      run_loop_3_spacing "$STORY_ID"
      if [ "$LOOP_RESULT" = "PASS" ]; then break; fi
      [ "$ATTEMPT" = "3" ] && STORY_RESULT="FAIL" && FAILED_LOOP="3-spacing"
    done
  fi
  
  if [ "$STORY_RESULT" = "PASS" ]; then
    # Loop 4: Pixel
    for ATTEMPT in 1 2 3; do
      run_loop_4_pixel "$STORY_ID"
      if [ "$LOOP_RESULT" = "PASS" ] || [ "$LOOP_RESULT" = "WARN" ]; then break; fi
      [ "$ATTEMPT" = "3" ] && STORY_RESULT="FAIL" && FAILED_LOOP="4-pixel"
    done
    [ "$LOOP_RESULT" = "WARN" ] && [ "$STORY_RESULT" = "PASS" ] && STORY_RESULT="WARN"
  fi
  
  # Loop 5: Color (optional, only if ImageMagick available)
  if [ "$STORY_RESULT" != "FAIL" ] && [ "$IMAGEMAGICK" = "true" ] && [ "$SKIP_COLOR" != "true" ]; then
    for ATTEMPT in 1 2 3; do
      run_loop_5_color "$STORY_ID"
      if [ "$LOOP_RESULT" = "PASS" ]; then break; fi
      [ "$ATTEMPT" = "3" ] && STORY_RESULT="FAIL" && FAILED_LOOP="5-color"
    done
  fi
  
  RESULTS+="$STORY_ID|$STORY_RESULT|$FAILED_LOOP|$FAILURE_DETAIL"$'\n'
done
```

### Loop 1 — Functional implementation

```bash
run_loop_1_functional() {
  local STORY_ID="$1"
  local AFTER="${SCREENSHOT_DIR}after/${STORY_ID}.png"
  
  # Re-capture (in case after/ is stale)
  npx playwright screenshot \
    --browser chromium \
    --viewport-size "$VIEWPORT" \
    --wait-for-timeout "$TIMEOUT" \
    "${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
    "$AFTER" 2>/tmp/loop1.log
  
  EXIT=$?
  
  if [ "$EXIT" -ne 0 ]; then
    LOOP_RESULT="FAIL"
    FAILURE_DETAIL="Story didn't render after migration: $(tail -1 /tmp/loop1.log)"
    return
  fi
  
  # Check screenshot isn't blank
  COLOR_COUNT=$(convert "$AFTER" -unique-colors txt: 2>/dev/null | wc -l)
  if [ "$COLOR_COUNT" -lt 5 ]; then
    LOOP_RESULT="FAIL"
    FAILURE_DETAIL="Story renders blank after migration ($COLOR_COUNT unique colors)"
    return
  fi
  
  LOOP_RESULT="PASS"
}
```

### Loop 2 — Font implementation

```bash
run_loop_2_font() {
  local STORY_ID="$1"
  local STORY_URL="${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story"
  
  if [ "$CHROME_MCP" = "true" ]; then
    # Use Chrome DevTools MCP for rich font query
    BEFORE_FONTS=$(query_loaded_fonts_via_mcp "$BEFORE_URL")
    AFTER_FONTS=$(query_loaded_fonts_via_mcp "$STORY_URL")
  else
    # Fallback: Playwright scripting
    BEFORE_FONTS=$(query_loaded_fonts_via_playwright "$BEFORE_URL")
    AFTER_FONTS=$(query_loaded_fonts_via_playwright "$STORY_URL")
  fi
  
  # Compare font sets
  DIFF=$(diff <(echo "$BEFORE_FONTS") <(echo "$AFTER_FONTS"))
  
  if [ -n "$DIFF" ]; then
    LOOP_RESULT="FAIL"
    FAILURE_DETAIL="Font set changed: $DIFF"
    return
  fi
  
  # Check computed font on key text elements
  for SELECTOR in "h1" "p" "button" "input"; do
    BEFORE_FAMILY=$(get_computed_font_family "$BEFORE_URL" "$SELECTOR")
    AFTER_FAMILY=$(get_computed_font_family "$STORY_URL" "$SELECTOR")
    
    if [ "$BEFORE_FAMILY" != "$AFTER_FAMILY" ] && [ -n "$BEFORE_FAMILY" ]; then
      LOOP_RESULT="FAIL"
      FAILURE_DETAIL="Font family on $SELECTOR changed: $BEFORE_FAMILY → $AFTER_FAMILY"
      return
    fi
  done
  
  LOOP_RESULT="PASS"
}

# Helper: query loaded fonts via Chrome DevTools MCP
query_loaded_fonts_via_mcp() {
  local URL="$1"
  # Use mcp__chrome-devtools__* tools to query document.fonts
  # Returns sorted list of font family names that were actually loaded
  # ... (MCP-specific invocation)
}

# Helper: query loaded fonts via Playwright scripting
query_loaded_fonts_via_playwright() {
  local URL="$1"
  cat > /tmp/font-query.js <<EOF
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('$URL', { waitUntil: 'networkidle' });
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map(f => \`\${f.family} \${f.style} \${f.weight}\`).sort();
  });
  console.log(fonts.join('\n'));
  await browser.close();
})();
EOF
  node /tmp/font-query.js
}
```

### Loop 3 — Spacing implementation

```bash
run_loop_3_spacing() {
  local STORY_ID="$1"
  
  # Query computed styles on key layout elements before/after
  for SELECTOR in "button" "[role=button]" "input" "[role=group]" ".container"; do
    BEFORE_STYLES=$(get_computed_styles "$BEFORE_URL" "$SELECTOR" "padding margin gap height width")
    AFTER_STYLES=$(get_computed_styles "$STORY_URL" "$SELECTOR" "padding margin gap height width")
    
    DIFF=$(compare_styles "$BEFORE_STYLES" "$AFTER_STYLES")
    
    if [ -n "$DIFF" ]; then
      # Check tolerance (1px difference is okay; 2+ pixels is suspect)
      MAX_DIFF=$(echo "$DIFF" | extract_max_pixel_diff)
      
      if [ "$MAX_DIFF" -gt 1 ]; then
        LOOP_RESULT="FAIL"
        FAILURE_DETAIL="Spacing on $SELECTOR changed by ${MAX_DIFF}px: $DIFF"
        return
      fi
    fi
  done
  
  LOOP_RESULT="PASS"
}

get_computed_styles() {
  local URL="$1"
  local SELECTOR="$2"
  local PROPS="$3"
  
  cat > /tmp/style-query.js <<EOF
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('$URL', { waitUntil: 'networkidle' });
  const result = await page.evaluate(({ selector, props }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.split(' ').map(p => [p, cs[p]]));
  }, { selector: '$SELECTOR', props: '$PROPS' });
  console.log(JSON.stringify(result));
  await browser.close();
})();
EOF
  node /tmp/style-query.js
}
```

### Loop 4 — Pixel implementation

```bash
run_loop_4_pixel() {
  local STORY_ID="$1"
  local BEFORE="${SCREENSHOT_DIR}before/${STORY_ID}.png"
  local AFTER="${SCREENSHOT_DIR}after/${STORY_ID}.png"
  local DIFF_DIR="${SCREENSHOT_DIR}diff"
  mkdir -p "$DIFF_DIR"
  local DIFF_OUT="${DIFF_DIR}/${STORY_ID}.png"
  
  THRESHOLD=$(jq -r '.visualRegression.threshold // 0.01' product/.pencil-storybook.json)
  
  # pixelmatch returns diff pixel count to stdout
  DIFF_PIXELS=$(npx pixelmatch "$BEFORE" "$AFTER" "$DIFF_OUT" "$THRESHOLD" 2>/dev/null)
  
  if [ -z "$DIFF_PIXELS" ] || [ "$DIFF_PIXELS" -eq 0 ]; then
    LOOP_RESULT="PASS"
    rm -f "$DIFF_OUT"  # no need to keep diff for matches
    return
  elif [ "$DIFF_PIXELS" -lt 50 ]; then
    LOOP_RESULT="WARN"
    FAILURE_DETAIL="${DIFF_PIXELS} pixels differ (sub-pixel anti-aliasing likely; verify visually)"
    return
  else
    LOOP_RESULT="FAIL"
    FAILURE_DETAIL="${DIFF_PIXELS} pixels differ; diff saved to ${DIFF_OUT}"
    return
  fi
}
```

### Loop 5 — Color implementation

```bash
run_loop_5_color() {
  local STORY_ID="$1"
  local BEFORE="${SCREENSHOT_DIR}before/${STORY_ID}.png"
  local AFTER="${SCREENSHOT_DIR}after/${STORY_ID}.png"
  local COLOR_DIR="${SCREENSHOT_DIR}color"
  mkdir -p "$COLOR_DIR"
  
  # Use ImageMagick to compare color palettes
  BEFORE_COLORS=$(convert "$BEFORE" -unique-colors -depth 8 txt: | head -20 | sort)
  AFTER_COLORS=$(convert "$AFTER" -unique-colors -depth 8 txt: | head -20 | sort)
  
  # Get top-N most prevalent colors
  BEFORE_TOP=$(extract_top_colors "$BEFORE" 10)
  AFTER_TOP=$(extract_top_colors "$AFTER" 10)
  
  # Compare top colors
  CHANGED=$(diff <(echo "$BEFORE_TOP") <(echo "$AFTER_TOP") | grep -c "^[<>]")
  
  if [ "$CHANGED" -lt 2 ]; then
    LOOP_RESULT="PASS"
  elif [ "$CHANGED" -lt 6 ]; then
    LOOP_RESULT="WARN"
    FAILURE_DETAIL="Top color palette shifted slightly (${CHANGED} colors changed)"
  else
    LOOP_RESULT="FAIL"
    FAILURE_DETAIL="Top color palette shifted significantly (${CHANGED} colors changed; possibly intentional brand update)"
  fi
}

extract_top_colors() {
  local IMG="$1"
  local TOP_N="$2"
  
  # Histogram → sort by count → take top N → extract hex
  convert "$IMG" -format %c histogram:info:- 2>/dev/null | \
    sort -rn | \
    head -n "$TOP_N" | \
    grep -oE '#[A-F0-9]{6}'
}
```

## Phase 3: gotcha matching

When a loop fails, check the manifest's `knownGotchas` for
matching patterns:

```bash
GOTCHAS=$(jq -r '.knownGotchas[]?' product/.pencil-storybook.json)

for FAILED_STORY in "${FAILED[@]}"; do
  STORY_ID=$(echo "$FAILED_STORY" | cut -d'|' -f1)
  COMPONENT=$(extract_component_from_story_id "$STORY_ID")
  FAILED_LOOP=$(echo "$FAILED_STORY" | cut -d'|' -f3)
  
  # Match gotchas
  MATCHING=$(echo "$GOTCHAS" | jq -s "
    map(select(
      (.component == \"$COMPONENT\" or .component == null) and
      (.framework == \"<current-migration-framework>\")
    ))
  ")
  
  if [ -n "$MATCHING" ] && [ "$MATCHING" != "[]" ]; then
    GOTCHA_HINTS+=("$STORY_ID|$MATCHING")
  fi
done
```

## Phase 4: aggregate

Group results:

```bash
PASS_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "PASS"' | wc -l)
WARN_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "WARN"' | wc -l)
FAIL_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "FAIL"' | wc -l)

# Group failures by which loop caught them
FAIL_BY_LOOP=$(echo "$RESULTS" | awk -F'|' '$2 == "FAIL" { print $3 }' | sort | uniq -c)
```

## Phase 5: report

### Human-readable

```
=== Migration Verification Report ===
Scope:           atoms (37 stories)
Loops run:       1 (functional), 2 (font), 3 (spacing),
                 4 (pixel), 5 (color)
Tools used:      Playwright, pixelmatch, Chrome DevTools MCP,
                 ImageMagick

Verification time: 12m 34s

Summary:
  PASS:    32  (86%)
  WARN:    2   (5%)
  FAIL:    3   (8%)

Failures by loop:
  Loop 1 (functional): 0
  Loop 2 (font):       1
  Loop 3 (spacing):    1
  Loop 4 (pixel):      1
  Loop 5 (color):      0

=== FAIL ===

core-atoms-button--ghost
  Failed at:  Loop 4 (pixel)
  Detail:     124 pixels differ; diff saved to .screenshots/diff/core-atoms-button--ghost.png
  
  Matching gotcha:
    Framework: heroui v3
    Issue: Button ghost variant uses different border-radius in v3
    Fix: Update theme spacing scale; v2 used radius-md, v3 uses radius-sm

  Suggested next step:
    /core:frameworks:storybook:migration:fix-pattern Button --gotcha-id heroui-v3-button-ghost-radius

core-atoms-input--default
  Failed at:  Loop 2 (font)
  Detail:     Font family on input changed: 'Inter, sans-serif' → 'system-ui, sans-serif'
  
  No matching gotcha. To document this finding:
    /core:frameworks:storybook:migration:fix-pattern --add-gotcha

core-atoms-link--external  
  Failed at:  Loop 3 (spacing)
  Detail:     Spacing on a changed by 4px: padding-left was 12px, now 8px

=== WARN ===

core-atoms-tag--default
  Loop 4 (pixel): 23 pixels differ (sub-pixel anti-aliasing likely)
  Verify visually: .screenshots/diff/core-atoms-tag--default.png

core-atoms-spinner--default
  Loop 5 (color): Top color palette shifted slightly (3 colors changed)
  Likely cause: animation frame captured at slightly different position

Next steps:
  - Investigate FAIL items
  - For known patterns: /core:frameworks:storybook:migration:fix-pattern <component>
  - For new patterns: --add-gotcha to document
  - Re-run after fixes: /core:frameworks:storybook:migration:verify
```

### JSON (`--json`)

Structured output with per-story per-loop results.

## Mode flags

### `--from-loop <1-5>`

Resume verification from a specific loop. Useful when previous
verification got far and you fixed the issue causing earlier
loops to fail; no need to re-run those loops.

```bash
# Loop 1 was failing; you fixed it; resume from Loop 2
/core:frameworks:storybook:migration:verify Button --from-loop 2
```

### `--debug`

Run Playwright in non-headless mode for the specified scope.
Lets you watch the verification visually. Slower but useful
for tricky failures.

```bash
/core:frameworks:storybook:migration:verify Button--ghost --debug
```

### `--strict`

Treats WARN as FAIL. For migrations where any drift is
unacceptable.

### `--skip-color`

Skip Loop 5 even if ImageMagick available. Useful when color
changes are intentional (brand update during migration).

## Exit codes

- `0` — all PASS
- `1` — at least one WARN (and no FAIL); strict mode treats
  this as FAIL
- `2` — at least one FAIL

## Cross-namespace integration

This command is invoked by:
- The migration sub-namespace's typical workflow (capture
  before → migrate → capture after → verify)
- Future architecture migration workflows
  (`engineer:architecture:workflows:migrate`)
- Drift detection cycles when comparing pre-cycle baselines

## What this command does NOT do

- **Capture screenshots.** That's `verify:screenshot`. This
  command consumes captured screenshots.
- **Fix regressions automatically.** Surfaces failures and
  suggests gotchas; user fixes manually or with framework
  codemods.
- **Modify component code.** Component changes route through
  manual edit or framework rebuild.
- **Run unit/integration tests.** Migration verify is about
  rendered output; code-level tests are separate.

## Examples

```bash
# Verify all stories
/core:frameworks:storybook:migration:verify

# Specific component
/core:frameworks:storybook:migration:verify Button

# Specific story
/core:frameworks:storybook:migration:verify core-atoms-button--ghost

# Strict mode (no WARN tolerance)
/core:frameworks:storybook:migration:verify --strict

# Skip color (intentional brand update)
/core:frameworks:storybook:migration:verify --skip-color

# Resume from Loop 3 (you fixed earlier loops)
/core:frameworks:storybook:migration:verify Button --from-loop 3

# Debug specific failure
/core:frameworks:storybook:migration:verify Button--ghost --debug
```

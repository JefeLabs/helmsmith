---
description: Verify Storybook build is ready for deployment. Runs the build command, checks for build errors, broken stories that would surface in the deployed UI, missing addons, configuration issues that would block deploy. Distinct from verify:health (which runs against live dev server).
argument-hint: [--target <env>] [--no-rebuild] [--strict]
allowed-tools: Read, Write, Edit, Bash
---

Verify Storybook is ready for deployment. Runs the build,
catches build errors, validates the output, surfaces issues
that would manifest only after deployment.

Catches:
- Build failures (TypeScript errors, missing modules, webpack
  errors)
- Stories that build but render broken in production mode
- Missing addons that don't fail in dev
- Hard-coded localhost URLs in story content
- Static asset issues (missing images, broken paths)
- Config that works in dev but fails in production
  (e.g., `process.env` references)

## Phase 0: pre-flight

Per `frameworks/storybook/verify/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists with `buildCommand` set
3. Playwright tool available

Storybook does NOT need to be running — this command builds
fresh.

## Phase 1: build

Unless `--no-rebuild`:

```bash
BUILD_CMD=$(jq -r '.storybook.buildCommand' product/.pencil-storybook.json)
PACKAGE_ROOT=$(jq -r '.storybook.packageRoot' product/.pencil-storybook.json)

echo "Running: $BUILD_CMD"

START=$(date +%s)
(cd "$PACKAGE_ROOT" && eval "$BUILD_CMD") 2>&1 | tee /tmp/storybook-build.log
EXIT=$?
END=$(date +%s)
DURATION=$((END - START))

echo "Build duration: ${DURATION}s"

if [ "$EXIT" -ne 0 ]; then
  echo "=== BUILD FAILED ==="
  echo "Exit code: $EXIT"
  echo ""
  echo "Last 50 lines of build log:"
  tail -50 /tmp/storybook-build.log
  exit 2
fi
```

The build command (per the manifest) is typically something
like `cd app-ui && npm run build-storybook` which produces a
static directory (typically `storybook-static/`).

## Phase 2: locate build output

```bash
# Common output directories
for d in "${PACKAGE_ROOT}/storybook-static" \
         "${PACKAGE_ROOT}/dist/storybook" \
         "${PACKAGE_ROOT}/.storybook-out"; do
  if [ -d "$d" ]; then
    BUILD_DIR="$d"
    break
  fi
done

if [ -z "$BUILD_DIR" ]; then
  echo "Could not locate Storybook build output. Checked:"
  echo "  - ${PACKAGE_ROOT}/storybook-static"
  echo "  - ${PACKAGE_ROOT}/dist/storybook"
  echo "  - ${PACKAGE_ROOT}/.storybook-out"
  exit 1
fi

echo "Build output: $BUILD_DIR"
```

## Phase 3: serve and validate

Start a local static server pointed at the build output and
validate stories render in production mode:

```bash
# Start a static server
PORT=6007  # use different port from dev Storybook
npx serve "$BUILD_DIR" -p $PORT --no-clipboard > /tmp/serve.log 2>&1 &
SERVE_PID=$!

# Wait for server ready
for i in {1..10}; do
  if curl -sf "http://localhost:$PORT" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Trap for cleanup
trap "kill $SERVE_PID 2>/dev/null" EXIT
```

Now validate against this static server:

```bash
PROD_URL="http://localhost:$PORT"

# Fetch story index
INDEX=$(curl -sf "${PROD_URL}/index.json")
TOTAL=$(echo "$INDEX" | jq '.entries // .stories | to_entries | map(select(.value.type == "story")) | length')

echo "Stories in build: $TOTAL"

# Sample-check or full-check based on --strict
if [ "$STRICT" = "true" ]; then
  STORY_IDS=$(echo "$INDEX" | jq -r '.entries // .stories | to_entries | map(select(.value.type == "story")) | .[].key')
else
  # Sample 10% with at least 5 stories
  SAMPLE_SIZE=$((TOTAL / 10))
  if [ "$SAMPLE_SIZE" -lt 5 ]; then SAMPLE_SIZE=5; fi
  STORY_IDS=$(echo "$INDEX" | jq -r '.entries // .stories | to_entries | map(select(.value.type == "story")) | .[].key' | shuf | head -n "$SAMPLE_SIZE")
  echo "Sampling $SAMPLE_SIZE stories (use --strict to check all)"
fi
```

For each (sampled or all) story, run health-check style
validation:

```bash
for STORY_ID in $STORY_IDS; do
  npx playwright screenshot \
    --browser chromium \
    --viewport-size 800,600 \
    --wait-for-timeout 8000 \
    "${PROD_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
    "/tmp/deploy-${STORY_ID}.png" 2>/tmp/playwright.log
  
  EXIT=$?
  
  if [ "$EXIT" -ne 0 ]; then
    BROKEN+=("$STORY_ID: $(tail -1 /tmp/playwright.log)")
  else
    classify_screenshot "/tmp/deploy-${STORY_ID}.png"
    if [ "$STATUS" = "BLANK" ]; then
      BLANK+=("$STORY_ID")
    elif [ "$STATUS" = "PASS" ]; then
      PASSED+=("$STORY_ID")
    fi
  fi
done
```

## Phase 4: addon validation

Check that the build includes all expected addons:

```bash
# Read the Storybook config in build output
PREVIEW_BUNDLE=$(find "$BUILD_DIR" -name "preview-*.js" | head -1)

# Check for each declared addon
for ADDON in $(jq -r '.addons | keys[]' product/.pencil-storybook.json); do
  ADDON_PKG=$(jq -r ".addons[\"$ADDON\"]" product/.pencil-storybook.json)
  
  # Crude check — look for addon's id in the bundle
  if ! grep -q "$ADDON_PKG" "$BUILD_DIR/index.html" "$PREVIEW_BUNDLE" 2>/dev/null; then
    MISSING_ADDONS+=("$ADDON ($ADDON_PKG)")
  fi
done
```

## Phase 5: static asset validation

```bash
# Check for common asset issues
ASSET_ISSUES=()

# Hard-coded localhost references
if grep -r "localhost:" "$BUILD_DIR" --include="*.js" 2>/dev/null | grep -v "iframe.html" | head -5; then
  ASSET_ISSUES+=("Hard-coded localhost references found in build output")
fi

# Missing static assets
HTML_ASSETS=$(grep -oE 'src="[^"]+"|href="[^"]+"' "$BUILD_DIR/index.html" | sed 's/src=//' | sed 's/href=//' | sed 's/"//g')
for ASSET in $HTML_ASSETS; do
  if [[ "$ASSET" =~ ^/ ]] || [[ "$ASSET" =~ ^[^/]+\.(png|jpg|svg|css|js)$ ]]; then
    if [ ! -f "$BUILD_DIR/${ASSET#/}" ]; then
      ASSET_ISSUES+=("Missing referenced asset: $ASSET")
    fi
  fi
done
```

## Phase 6: report

```
=== Deploy Verification Report ===
Build:           PASS
Build time:      47s
Build output:    app-ui/storybook-static/

Stories in build: 247
Stories sampled:  25 (10%; use --strict for full check)

Validation:
  PASS:    24 stories
  BLANK:   1 story
  BROKEN:  0 stories

Addons:
  ✓ All 12 expected addons detected in build

Static assets:
  ⚠ 1 issue found:
    Hard-coded localhost reference in build output:
    storybook-static/sb-preview/runtime.js: "http://localhost:6006/api/stats"

Status: READY TO DEPLOY (with caveats)

=== ISSUES ===

BLANK story:
  core-atoms-button--with-icon
    Story rendered blank in production build (passed in dev).
    Likely cause: Component imports an asset using process.env
    that's undefined in production. Check Button.tsx for
    process.env references.

Static asset:
  Hard-coded localhost in build output. Won't break deployment
  but indicates a debug/dev URL in source. Search for
  "localhost:" in component code.

=== RECOMMENDATIONS ===

Before deploying:
  1. Investigate the blank story (run /frameworks:storybook:verify:fix
     core-atoms-button--with-icon)
  2. Decide whether localhost reference is acceptable
     (it appears to be a dev-only stats endpoint)

Or proceed anyway: the build is technically deployable; the
issues are quality concerns, not blockers.
```

## Strict mode

`--strict` mode treats all issues as blockers and validates
ALL stories (not just a sample):

```
Status: NOT READY (strict mode)

Blockers:
  - 1 BLANK story (must pass in production)
  - 1 hard-coded localhost reference

Resolve all issues before deploy.
```

## Exit codes

- `0` — ready to deploy, no issues
- `1` — minor issues (not blocking unless `--strict`)
- `2` — blocking issues (build failed, broken stories in
  sample, or strict mode + minor issues)

## Cross-namespace effects

CI integration: typically runs as part of pre-deploy pipeline.
Exit code 0 = deploy; non-zero = block.

The `engineer/maintenance/remediation/storybook-drift` routine
includes deploy verification as part of its drift cycle (catches
"this drifted in a way that would only manifest after deploy").

## What this command does NOT do

- **Deploy.** Surfaces deploy-readiness; user runs their
  deploy command (whatever that is — git push, S3 sync,
  CloudFront invalidation, etc.).
- **Modify code.** Reports issues; doesn't auto-fix.
- **Test interactions in production build.** Interactions are
  separate (`verify:interactions`); deploy verifies render
  health only.
- **Run accessibility audit.** That's `verify:a11y`. Deploy
  is about deployability, not about every quality dimension.

## Examples

```bash
# Default — sample 10%, report
/frameworks:storybook:verify:deploy

# Strict — check all stories, fail on minor issues
/frameworks:storybook:verify:deploy --strict

# Skip rebuild (validate existing build)
/frameworks:storybook:verify:deploy --no-rebuild

# Specific deployment target (informational only currently)
/frameworks:storybook:verify:deploy --target staging
```

# Storybook Verify — Sub-Namespace Context (`frameworks/storybook/verify/`)

> Read this in addition to `frameworks/storybook/_context.md`
> whenever any `/core:frameworks:storybook:verify:*` command runs.
>
> This sub-namespace owns deliberate verification of Storybook
> state — health checks, screenshots, accessibility audits,
> interaction tests, deploy readiness. Drift work (recurring
> health-check cycles, dead story detection, MDX freshness
> across all stories on a cadence) belongs to
> `engineer/maintenance/remediation/storybook-drift`.

## What this sub-namespace is for

Six commands:

- **`/core:frameworks:storybook:verify:health`** — verify stories
  render without errors (PASS / LOADING / BROKEN / BLANK)
- **`/core:frameworks:storybook:verify:screenshot`** — capture
  story screenshots (standalone or as building block)
- **`/core:frameworks:storybook:verify:fix`** — investigate and fix
  broken stories
- **`/core:frameworks:storybook:verify:a11y`** — accessibility audit
  via axe-core
- **`/core:frameworks:storybook:verify:interactions`** — run
  interaction (play function) tests
- **`/core:frameworks:storybook:verify:deploy`** — verify build is
  ready to deploy

All six respect the project's manifest at
`.pencil-storybook.json` and require Storybook to be running
(except `deploy` which builds rather than serves).

## Activation gate

All commands check the framework binding manifest before
proceeding. The full pre-flight pattern:

```bash
# Check storybook binding active
ACTIVE=$(jq -r '.documentationBindings.storybook.active // false' \
              product/.pencil-frameworks.json 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  echo "Storybook framework binding is not active for this project."
  echo "Run /core:frameworks:init to detect and activate, or"
  echo "/core:frameworks:manifest --reactivate storybook if previously deactivated."
  exit 1
fi

# Check storybook deep config exists
test -f product/.pencil-storybook.json || {
  echo "Storybook deep config missing. Running /core:frameworks:storybook:init"
  echo "for fields needed by this command..."
  # Auto-trigger storybook init for needed fields
}

# Check Storybook is running (for commands that need it)
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
if ! curl -sf "$LOCAL_URL" > /dev/null 2>&1; then
  START_CMD=$(jq -r '.storybook.startCommand' product/.pencil-storybook.json)
  echo "Storybook is not running. Start it first:"
  echo "  $START_CMD"
  exit 1
fi
```

The `verify:deploy` command differs — it builds rather than
running against a live server, so it doesn't need the
running-server check.

## Tool dependencies

Verification commands depend on:

- **Playwright** (`/core:tools:playwright`) — browser automation for
  screenshots, interactions, page queries
- **Chrome DevTools MCP** (`/core:tools:chrome-devtools`, when
  available) — richer DOM inspection (used by `verify:a11y`
  and `verify:fix` for diagnostic depth)

Pre-flight checks tools availability via the tools manifest:

```bash
PLAYWRIGHT_CLI=$(jq -r '.tools.playwright.interfaces.cli.available // false' \
                       product/.pencil-tools.json 2>/dev/null)
if [ "$PLAYWRIGHT_CLI" != "true" ]; then
  echo "Playwright is required for verification. Run /core:tools:setup playwright"
  exit 1
fi
```

When the tools manifest is missing, suggest running
`/core:tools:setup` first.

## Common operations across verify commands

### Story enumeration

Most verify commands accept a scope (component name, category,
specific story ID, or `all`). Resolution:

```bash
SCOPE="$1"  # could be "Button", "atoms", "core-atoms-button--default", or "all"
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)

# Fetch story index
INDEX=$(curl -sf "${LOCAL_URL}/index.json")

# Resolve to list of story IDs
case "$SCOPE" in
  all|"")
    STORY_IDS=$(echo "$INDEX" | jq -r '.entries // .stories | to_entries | map(select(.value.type == "story")) | .[].key' | sort)
    ;;
  *--*)
    # Specific story ID (contains story-name suffix)
    STORY_IDS="$SCOPE"
    ;;
  atoms|molecules|organisms|templates)
    # Atomic category — match by title pattern
    STORY_IDS=$(echo "$INDEX" | jq -r ".entries // .stories | to_entries | map(select(.value.type == \"story\" and (.value.title | test(\"/${SCOPE^}/\"; \"i\")))) | .[].key" | sort)
    ;;
  *)
    # Component name — match by title contains
    STORY_IDS=$(echo "$INDEX" | jq -r ".entries // .stories | to_entries | map(select(.value.type == \"story\" and (.value.title | test(\"/${SCOPE}\$\"; \"i\")))) | .[].key" | sort)
    ;;
esac
```

Custom organization conventions (per the manifest's
`componentOrganization.titlePattern`) get matched accordingly.

### Sequential processing

Verify commands process multiple stories sequentially, never
in parallel. The Storybook dev server (webpack/vite) isn't
designed for concurrent rebuild requests. Parallel screenshots,
interaction tests, or health checks cause webpack timeouts
and false negatives.

```bash
for STORY_ID in $STORY_IDS; do
  process_story "$STORY_ID"
  # Optional brief sleep to let dev server breathe
  sleep 0.2
done
```

### Browser cleanup

Commands that spawn Playwright kill stale browser processes
before starting:

```bash
BROWSER=$(jq -r '.screenshots.browser' product/.pencil-storybook.json)
pkill -f "$BROWSER" 2>/dev/null || true
```

This avoids stuck processes from previous runs interfering.

### Timing constants

Universal across projects, sourced from the manifest:

```bash
FIRST_TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs // 30000' product/.pencil-storybook.json)
SUBSEQUENT_TIMEOUT=$(jq -r '.screenshots.subsequentStoryTimeoutMs // 8000' product/.pencil-storybook.json)
DEPLOYED_TIMEOUT=$(jq -r '.screenshots.deployedStoryTimeoutMs // 5000' product/.pencil-storybook.json)
```

First story per component takes longer (15-30s) due to
webpack/vite compilation. Subsequent stories in the same
component compile faster (5-8s). Deployed Storybooks have no
compilation step (3-5s).

## Output conventions

### Per-story status

Each command classifies stories into status categories:

| Status | Meaning |
|--------|---------|
| `PASS` | Story rendered and check passed |
| `WARN` | Soft issue; not failing but worth attention |
| `FAIL` | Hard failure; story is broken |
| `LOADING` | Story stuck in loading state (often dependency issue) |
| `BLANK` | Story rendered nothing (often error swallowed) |
| `MISSING` | Expected story doesn't exist |
| `SKIP` | Story intentionally skipped (per scope filter) |

Verify commands report per-status counts in their summaries.

### Report format

Default human-readable format groups findings by status:

```
=== Verification Report ===
Mode: health
Scope: atoms (37 stories)

PASS:    32 stories
WARN:    2 stories
FAIL:    3 stories
LOADING: 0 stories
BLANK:   0 stories

=== FAIL ===

core-atoms-button--with-icon
  React error: Cannot read property 'icon' of undefined
  Likely fix: Default args missing icon; check argTypes.

core-atoms-link--external
  Component never rendered (timed out)
  Likely fix: Investigate dependency chain; component may
  be importing a missing module.

core-atoms-rating--readonly
  Console error: ChunkLoadError
  Likely fix: Restart Storybook; webpack chunk got stale.

=== WARN ===
... (etc.)
```

JSON format (`--json`) emits structured output for CI / agent
consumption.

## Anti-patterns

- **Running parallel screenshots.** Sequential or fail.
- **Verifying without checking framework binding active.** The
  activation gate is in pre-flight; bypassing it produces
  cryptic errors when binding state is wrong.
- **Inlining tool invocations without checking tools manifest.**
  Use the tools registry to know what's available; degrade
  gracefully when optional tools missing.
- **Mixing verification and remediation.** Verify commands
  surface findings; they don't auto-fix code (except
  `verify:fix` which is explicit about its scope). Drift
  cleanup belongs to maintenance.
- **Per-command tool detection logic.** The shared pre-flight
  pattern reads tools manifest; per-command logic risks drift.

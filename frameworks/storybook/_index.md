# Storybook — Command Index

The complete catalog of `/frameworks:storybook:*` commands organized by
purpose. This index is the suite's analog to the dispatcher
pattern — instead of routing free-form prompts, it gives users
a clear map of which command to invoke for which need.

For project-specific values (URLs, paths, component
organization, addons, screenshot settings), see
`product/.pencil-storybook.json` (the runtime manifest). All
commands read from the manifest; first-run automatically
initializes it.

## Decision tree — which command do I want?

```
Need to set up storybook namespace state for a new project?
└── Yes → /frameworks:storybook:init

Authoring (deliberate creation):
├── Generate a story for a specific component       → /frameworks:storybook:stories:gen
├── Find components without stories, generate them  → /frameworks:storybook:stories:gen-missing
└── Generate MDX documentation for a component      → /frameworks:storybook:stories:doc

Verification (validate current state):
├── Check whether stories render without errors     → /frameworks:storybook:verify:health
├── Capture screenshot of a story                   → /frameworks:storybook:verify:screenshot
├── Investigate and fix a broken story              → /frameworks:storybook:verify:fix
├── Audit accessibility via axe-core                → /frameworks:storybook:verify:a11y
├── Run interaction (play function) tests           → /frameworks:storybook:verify:interactions
└── Verify storybook is ready to deploy             → /frameworks:storybook:verify:deploy

Migration (framework-version-specific transition work):
├── Verify a story migrated correctly (5 loops)     → /frameworks:storybook:migration:verify
└── Document or look up a fix pattern               → /frameworks:storybook:migration:fix-pattern

Reporting:
├── Full inventory + coverage + addon usage         → /frameworks:storybook:catalog
└── Visual regression (Chromatic) integration       → /frameworks:storybook:chromatic

Drift remediation (recurring maintenance work):
└── Run drift detection + cleanup as a cycle        → /engineer:maintenance:remediation:storybook-drift
                                                       (this is in the maintenance namespace,
                                                        not storybook/, because it's drift work
                                                        scheduled on a maintenance cadence)
```

## Authoring — `frameworks/storybook/stories/`

### `/frameworks:storybook:stories:gen`

Generate stories for a specific component following project
conventions (CSF format, autodocs, addons, MSW handlers if
needed, atomic-design hierarchy if applicable).

Inputs: component name or file path.

Reads from manifest: framework, story file convention,
component organization, addon inventory, provider stack.

Reads from suite: `.pencil-tone.json` and
`.pencil-editorial.json` (when present) for realistic story
content.

Output: `<component-dir>/<Component>.stories.tsx` with
- Default story
- Variant matrix (all sizes, all colors, all variants if
  applicable)
- States (disabled, loading, error, empty if applicable)
- Interaction tests (for interactive components)
- MSW handlers (for data-fetching components)

### `/frameworks:storybook:stories:gen-missing`

Find components without stories and generate them. Useful for
catching up on story coverage after a sprint of component work.

Inputs: optional scope (specific category/feature). Default:
all components.

Reads from manifest: component organization to enumerate
components.

Output: stories for each component without one, following the
same conventions as `gen`.

### `/frameworks:storybook:stories:doc`

Generate MDX documentation for a component. Beyond the autodocs
that ship by default, MDX lets you add narrative documentation,
inline examples, and rich formatting.

Inputs: component name.

Output: `<component-dir>/<Component>.mdx` with structured
documentation (overview, usage, API reference, accessibility
notes, related components).

## Verification — `frameworks/storybook/verify/`

### `/frameworks:storybook:verify:health`

Verify that stories render without errors. Catches broken
components, infinite loading, runtime exceptions, and blank
pages.

Inputs: scope (component name, category, story ID, or `all`).

Reads from manifest: storybook URL, screenshot configuration,
component organization (for category filtering).

Output: report classified by status (PASS / LOADING / BROKEN /
BLANK) grouped by component.

### `/frameworks:storybook:verify:screenshot`

Capture screenshot of a story. Used standalone for documentation
or as a building block for visual regression workflows.

Inputs: source (`local` | `deployed`), scope (component, story
ID, or `all`).

Reads from manifest: URLs, screenshot config (viewport, browser,
timeouts, output directory).

Output: PNG files in the configured screenshot directory.

### `/frameworks:storybook:verify:fix`

Investigate and fix broken, loading, or blank Storybook stories.
Traces errors to root cause and applies minimal fixes.

Inputs: component, story ID, or category.

Reads from manifest: framework, addons, provider stack, known
gotchas.

Output: minimal code changes to fix the broken story; a fix
report classifying the failure (BROKEN / LOADING / BLANK /
MISSING / CONFIG) and the resolution applied.

### `/frameworks:storybook:verify:a11y`

Run accessibility audit via axe-core. Surfaces WCAG violations,
contrast issues, missing labels, ARIA mistakes.

Inputs: scope (component, story ID, or `all`).

Reads from manifest: storybook URL, addon inventory (requires
`@storybook/addon-a11y`).

Output: report grouped by severity (critical / serious /
moderate / minor) with WCAG references.

### `/frameworks:storybook:verify:interactions`

Run interaction tests (Storybook play functions) to verify
component behavior under user actions.

Inputs: source (`local` | `deployed`), scope (component, story
ID, or `all`).

Reads from manifest: URLs, addon inventory (requires
`@storybook/test`).

Output: pass/fail per story, with detailed failure context for
investigation.

### `/frameworks:storybook:verify:deploy`

Verify the Storybook build is ready for deployment. Checks for
build errors, broken stories, missing addons, configuration
issues that would block deploy.

Inputs: optional target environment.

Reads from manifest: build command, working directory, addon
inventory.

Output: deploy-readiness report; blocks if critical issues
found.

## Migration — `frameworks/storybook/migration/`

Migration commands handle framework-version-specific transition
work — e.g., HeroUI v2→v3, Storybook 8→9, React 18→19. The
sub-namespace exists because migrations have their own lifecycle
distinct from ongoing authoring or verification.

### `/frameworks:storybook:migration:verify`

Orchestrator command that verifies a story's migration through
five sequential verification loops: **functional**, **font**,
**spacing**, **pixel**, **color**. Each loop has a 3-retry
budget for automated fix attempts before escalating.

Inputs: story ID or component name (verifies all stories for
that component).

Reads from manifest: URLs, screenshot config, visual regression
threshold, known gotchas.

Output: per-loop pass/fail report; on overall pass, the
migration is verified for that story.

This is the most complex command in the namespace. Its 5-loop
pattern is reusable for future migrations beyond the current
one.

### `/frameworks:storybook:migration:fix-pattern`

Document or look up a fix pattern for a known migration issue.
Builds the project's `knownGotchas` registry incrementally.

Inputs:
- `--add-gotcha` mode: documents a new gotcha (framework,
  version, component, issue, fix)
- Lookup mode: searches existing gotchas by symptom or component

Reads from manifest: known gotchas inventory.

Output: documented gotcha (in add mode) or applicable fix
patterns (in lookup mode).

## Reporting

### `/frameworks:storybook:catalog`

Generate a comprehensive inventory of all Storybook stories:
coverage by component, category breakdown, addon usage, and
quality metrics.

Inputs: optional output format (`markdown` | `json` | default
console).

Reads from manifest: component organization, addon inventory.
Reads from filesystem: actual story files.

Output: full catalog report with:
- Story count per component
- Components without stories
- Addon usage stats (which stories use msw, play, design links)
- Quality metrics (story-to-component ratio, MDX coverage)
- Comparison with live Storybook index (if running)

### `/frameworks:storybook:chromatic`

Verify Chromatic integration health. Surfaces missing baselines,
unreviewed changes, configuration issues.

Inputs: optional scope.

Reads from manifest: visual regression configuration (must have
`chromatic.enabled: true`).

Reads from environment: `CHROMATIC_PROJECT_TOKEN`.

Output: Chromatic integration health report.

## Drift remediation — in `engineer/maintenance/`

### `/engineer:maintenance:remediation:storybook-drift`

Recurring drift detection and remediation routine. Lives in the
maintenance namespace (not here) because it's scheduled on a
maintenance cadence and follows the maintenance routine
patterns (Phase 0 baseline, severity-classified inventory,
phased execution, final mandatory gate, etc.).

Orchestrates:
- Health check across all stories
- Dead story detection (stories referencing removed components)
- Config audit
- MDX freshness check (MDX docs out of sync with current
  component API)
- Coverage check (components without stories)
- Chromatic baseline drift (if enabled)

Surfaces findings, dispatches remediation via existing storybook
commands (`verify:fix`, `stories:gen-missing`, etc.).

See `engineer/maintenance/remediation/_context.md` for the routine's full
shape.

## Initialization

### `/frameworks:storybook:init`

Comprehensive upfront initialization of the storybook runtime
manifest. Walks through every field with detection where
possible.

Most users don't need to run this explicitly — first-run
auto-init handles partial initialization as commands need
fields. Run `/frameworks:storybook:init` when:

- Setting up a fresh project end-to-end
- Re-running detection after a major Storybook upgrade
- Updating component organization or framework
- Wanting to populate fields beyond what auto-init has covered

See `frameworks/storybook/init.md` for full details.

## Cross-cutting practices

### State persistence

The runtime manifest at `product/.pencil-storybook.json` is the
single source of truth for project-specific values. Commands
read; init writes. Manual edits to the manifest are valid (it's
a JSON file under your control); commands re-read on each
invocation.

### Storybook running prerequisite

Most verification and migration commands require a running
Storybook. The manifest's `startCommand` is what users run to
start it. Commands check via curl before proceeding; on failure,
they instruct using the manifest's start command.

### Sequential processing

Commands that screenshot multiple stories process them
sequentially, not in parallel. The dev server (webpack/vite)
isn't designed for parallel webpack rebuild requests; parallel
screenshots cause timeouts and false negatives.

### Browser cleanup

Commands that spawn browser processes (Playwright CLI or MCP)
kill stale processes before starting:

```bash
BROWSER=$(jq -r '.screenshots.browser' product/.pencil-storybook.json)
pkill -f "$BROWSER" 2>/dev/null || true
```

This avoids stuck processes from previous runs interfering with
new invocations.

### Lint after generation

Commands that generate or modify story files run the project's
lint command (per the manifest's `lint.command` and
`lint.workingDir`) after writing. Lint failures are surfaced
before the command considers itself complete.

### Realistic content

Story generation prefers realistic content from the project's
domain rather than placeholder text. When `.pencil-tone.json` and
`.pencil-editorial.json` exist, generation reads them for voice
and editorial conventions.

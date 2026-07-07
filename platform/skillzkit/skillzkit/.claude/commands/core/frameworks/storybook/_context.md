# Storybook — Namespace Context (`frameworks/storybook/`)

> Read this in addition to `product/strategy/_context.md` whenever any
> `/core:frameworks:storybook:*` command runs. Sub-namespace `_context.md`
> files (`frameworks/storybook/stories/_context.md`,
> `frameworks/storybook/verify/_context.md`,
> `frameworks/storybook/migration/_context.md`) extend this with
> sub-domain-specific conventions.
>
> The `frameworks/storybook/` namespace covers Storybook authoring,
> verification, migration, and reporting. Drift remediation
> belongs to `engineer/maintenance/remediation/storybook-drift` per the
> maintenance namespace pattern; this namespace handles
> deliberate work (creating, validating, migrating, reporting)
> rather than drift cleanup.

## What this namespace is for

Storybook is the rendered form of a project's component library
— interactive component documentation, visual regression
substrate, accessibility audit surface, interaction-test
harness. The `/core:frameworks:storybook:*` commands cover its full lifecycle:

- **Authoring** (`stories/`) — generate stories for components,
  fill in missing stories, write MDX documentation
- **Verification** (`verify/`) — health-check rendering, capture
  screenshots, audit accessibility, run interaction tests,
  validate deploy readiness
- **Migration** (`migration/`) — orchestrated migration
  verification (e.g., framework version migrations), pattern
  documentation
- **Reporting** (`catalog.md`) — full inventory, coverage,
  quality metrics
- **Visual regression** (`chromatic.md`) — Chromatic integration
  health

This namespace is consumed by:

- **Humans** running individual commands during component work
- **Maintenance routines** — `atomic-design.md` invokes
  `/core:frameworks:storybook:stories:gen-missing` for AD-7 violations;
  `component-dedup.md` requires Storybook as visual regression
  source
- **Workflows** — `product:greenfield` and
  `product:brownfield-add-feature` may trigger story
  authoring; `engineer:polyglot-maintenance-cycle` includes
  `storybook-drift` as part of the cycle when relevant
- **Agents** — Bumpr, Janitr, Phase 3 sub-agents call
  storybook commands during component work

## Project-agnostic by design

This namespace makes **no assumptions** about specific component
names, frameworks, hierarchies, URLs, or addons. Every
project-specific value flows through a runtime manifest at
`product/.pencil-storybook.json`. Commands read from the
manifest; commands never hardcode project-specific values.

The shape of a project's Storybook setup varies enormously —
Storybook version, framework adapter (`@storybook/nextjs`,
`@storybook/react-vite`, `@storybook/sveltekit`, etc.), config
location, stories glob, package root, component organization
convention (atomic-design / flat / feature-based / custom),
addons enabled, provider stack wrapping every story, screenshot
configuration, visual regression tool, lint setup. The manifest
captures all of these per-project; the suite stays portable.

## Runtime manifest

`product/.pencil-storybook.json` holds:

```jsonc
{
  "version": 1,
  "lastUpdated": "<ISO timestamp>",

  "storybook": {
    "version": "<e.g., 10.3.4>",
    "framework": "<e.g., @storybook/nextjs>",
    "configDir": "<e.g., .storybook/ or app-ui/.storybook/>",
    "storiesGlob": "<e.g., **/*.stories.@(js|jsx|mjs|ts|tsx)>",
    "mdxGlob": "<e.g., **/*.mdx>",
    "packageRoot": "<directory where npm run storybook is run>",
    "localUrl": "<e.g., http://localhost:6006>",
    "deployedUrl": "<optional; e.g., https://storybook.example.com>",
    "startCommand": "<e.g., cd app-ui && npm run storybook>",
    "buildCommand": "<e.g., cd app-ui && npm run build-storybook>"
  },

  "componentOrganization": {
    "convention": "<atomic-design | flat | feature-based | custom>",
    "componentRoot": "<e.g., components/ or app-ui/components/>",
    "hierarchy": {
      // For atomic-design:
      "atoms": [...],
      "molecules": [...],
      "organisms": [...],
      "templates": [...]
      // For flat: omitted
      // For feature-based: feature names → component lists
      // For custom: user-defined mapping
    },
    "featureSections": {
      // Optional: section name → directory for multi-section apps
      // e.g., "Public": "components/public/"
    },
    "titlePattern": "<e.g., <Section>/<Category>/<Component>>"
  },

  "addons": {
    // Detected from package.json; addon name → npm package
    // e.g., "a11y": "@storybook/addon-a11y"
  },

  "providerStack": [
    // Decorators applied in preview.js, in order
    {
      "name": "<provider name>",
      "purpose": "<short description>",
      "config": { /* optional structured config */ }
    }
  ],

  "screenshots": {
    "directory": "<e.g., .screenshots/>",
    "viewport": "<width,height; e.g., 800,600>",
    "browser": "<chromium | firefox | webkit>",
    "firstStoryTimeoutMs": <e.g., 30000>,
    "subsequentStoryTimeoutMs": <e.g., 8000>,
    "deployedStoryTimeoutMs": <e.g., 5000>,
    "subDirectories": ["health", "debug", "deployed", "local",
                       "diff", "color"]
  },

  "visualRegression": {
    "tool": "<pixelmatch | chromatic | both | none>",
    "threshold": <e.g., 0.01>,
    "matchClassification": {
      "match": { "diffPixels": "0", "label": "MATCH" },
      "warn": { "diffPixels": "1-49", "label": "WARN",
                "note": "<project-specific note>" },
      "diff": { "diffPixels": "50+", "label": "DIFF",
                "note": "<project-specific note>" }
    },
    "chromatic": {
      "enabled": <bool>
      // projectToken read from environment, never stored here
    }
  },

  "lint": {
    "command": "<e.g., npx biome check . or npm run lint>",
    "workingDir": "<e.g., app-ui/>"
  },

  "knownGotchas": [
    // Empty by default. Populated via
    // /core:frameworks:storybook:migration:fix-pattern --add-gotcha
    // Each entry:
    // { "framework": "...", "version": "...", "component": "...",
    //   "issue": "...", "fix": "..." }
  ]
}
```

The manifest is created on first run of any `/core:frameworks:storybook:*`
command via auto-triggered initialization (see "First-run
behavior" below). It can be regenerated or updated explicitly
via `/core:frameworks:storybook:init`.

## First-run behavior

If a command runs and `.pencil-storybook.json` is missing OR
required fields are missing, the command **auto-triggers
initialization** for the fields it needs. This is partial init
— the command captures what it needs and proceeds; subsequent
commands fill in their own gaps as they're invoked.

This means users don't have to run `/core:frameworks:storybook:init` explicitly
on a fresh project. The first storybook command they invoke
walks them through initial setup; later commands extend the
manifest as needed.

For a comprehensive upfront initialization, users can run
`/core:frameworks:storybook:init` directly. This walks through every manifest
field with detection where possible.

## Detection patterns

Where the suite can detect values from the project, it does. The
detection patterns:

- **Storybook version + framework**: read `package.json`
  dependencies; look for `@storybook/<framework>` and
  `storybook` packages
- **Config dir**: check standard locations
  (`.storybook/`, `app-ui/.storybook/`, `apps/web/.storybook/`)
- **Stories glob**: read `<configDir>/main.ts` or `main.js` for
  `stories` field
- **Package root**: directory containing `package.json` with
  `storybook` script
- **Local URL**: parse `package.json` `storybook` script for
  `-p` flag; default to `http://localhost:6006`
- **Component organization**: scan `components/` (or detected
  alternative) for atomic-design directory names (`atoms/`,
  `molecules/`, etc.) → atomic-design; otherwise flat or
  feature-based via heuristic
- **Addons**: read `package.json` for `@storybook/addon-*`,
  `@chromatic-com/storybook`, `msw-storybook-addon`,
  `@storybook/test`, etc.
- **Provider stack**: best-effort parse of `preview.js` or
  `preview.ts` decorators array; surface for user confirmation
- **Lint command**: detect `biome.json` → `npx biome check .`;
  `.eslintrc*` → `npx eslint .`; package.json scripts for `lint`

User confirms or corrects each detected value during init. Init
never silently accepts detected values without confirmation.

## Storybook running prerequisite

Many commands interact with a running Storybook (curl the index,
take screenshots, run interactions). Each such command checks:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
curl -sf "$LOCAL_URL" > /dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"
```

If not running, the command stops and instructs the user with
the manifest's `startCommand`:

> Storybook is not running. Start it first:
>
>   $(jq -r '.storybook.startCommand' product/.pencil-storybook.json)

Commands that DON'T need a running Storybook (e.g., catalog
report can work file-system-only) note this explicitly.

## Story index API

Story IDs are fetched from a running Storybook:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
curl -sf "${LOCAL_URL}/index.json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data.get('entries', data.get('stories', {}))
stories = sorted([k for k, v in entries.items() if v.get('type') == 'story'])
for s in stories: print(s)
"
```

Story IDs follow the convention defined in
`componentOrganization.titlePattern`. The classic pattern is
`<Section>/<Category>/<Component>` mapped to IDs like
`section-category-component--story-name`. Other patterns are
supported; the manifest documents which one this project uses.

## Screenshot capture pattern

Playwright CLI is the default capture tool:

```bash
VIEWPORT=$(jq -r '.screenshots.viewport' product/.pencil-storybook.json)
BROWSER=$(jq -r '.screenshots.browser' product/.pencil-storybook.json)
TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs // 30000' product/.pencil-storybook.json)
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)

mkdir -p "${SCREENSHOT_DIR}health"
npx playwright screenshot --browser "$BROWSER" \
  --viewport-size "$VIEWPORT" \
  --wait-for-timeout "$TIMEOUT" \
  "${LOCAL_URL}/iframe.html?id=STORY_ID&viewMode=story" \
  "${SCREENSHOT_DIR}health/STORY_ID.png"
```

**Important timing notes** (universal across projects):

- First story per component: 15–30s (webpack/vite compilation)
- Subsequent stories in the same component: 5–8s
- Process stories **sequentially** — parallel requests overwhelm
  the dev server
- Always use `/iframe.html?id=ID&viewMode=story` — renders
  without Storybook chrome
- Kill stale browser processes before starting:
  `pkill -f chromium 2>/dev/null` (or whichever browser is
  configured)

## Visual regression — pixelmatch pattern

```bash
THRESHOLD=$(jq -r '.visualRegression.threshold' product/.pencil-storybook.json)
npx pixelmatch before.png after.png diff.png "$THRESHOLD"
# Output: number of differing pixels to stdout
```

Classification per the manifest's `matchClassification`:

| Diff Pixels | Label | Default Action |
|-------------|-------|----------------|
| 0 | MATCH | Identical |
| 1-49 | WARN | Likely sub-pixel anti-aliasing — but always investigate. Small counts can hide real regressions on simple components. |
| 50+ | DIFF | Must investigate and fix. |

Projects can override these via the manifest's
`matchClassification` (different thresholds for projects with
different sensitivity).

## Chromatic visual regression

When `visualRegression.chromatic.enabled` is true, additional
integration is available via `/core:frameworks:storybook:chromatic` for
project-token-based visual testing. Chromatic requires a project
token from the environment (`CHROMATIC_PROJECT_TOKEN`); the
manifest does NOT store secrets.

## Component organization conventions

The namespace supports four organization conventions:

### Atomic design (the conventional pattern)

```
components/
  atoms/
    button/
    avatar/
  molecules/
    card/
  organisms/
    header/
  templates/
    layout/
```

Story titles: `Core/Atoms/Button`, `Core/Molecules/Card`, etc.

### Flat

```
components/
  Button/
  Card/
  Header/
```

Story titles: `Components/Button`, `Components/Card`, etc.

### Feature-based

```
components/
  auth/
    LoginForm/
    SignupForm/
  dashboard/
    Header/
    StatsPanel/
```

Story titles: `Auth/LoginForm`, `Dashboard/Header`, etc.

### Custom

User-defined mapping in the manifest's
`componentOrganization.hierarchy`. Init walks the user through
defining the mapping when standard conventions aren't detected.

## MCP integration

Some storybook commands integrate with MCP servers when
available:

- **Playwright MCP** (`mcp__playwright__*`) — alternative to
  Playwright CLI for browser automation; richer JavaScript
  evaluation
- **Chrome DevTools MCP** (`mcp__chrome-devtools__*`) — query
  loaded fonts, network requests, computed styles in detail

These MCPs are particularly used by `migration/verify` for the
font-match and network-debugging loops. Commands degrade
gracefully when MCPs aren't available — they fall back to
Playwright CLI for browser automation, accept that some
diagnostic depth (e.g., font-loading queries) isn't available.

## Anti-patterns

- **Hardcoding URLs, paths, or component names in commands** —
  every project-specific value MUST flow through the manifest.
  Commands read from `.pencil-storybook.json`; commands don't
  contain literal project values.
- **Committing project-specific addon lists to suite files** —
  the addon inventory is detected and stored per-project.
- **Bypassing init when fields are missing** — commands that
  need a value should auto-trigger init for that value, not
  proceed with hardcoded defaults.
- **Treating Storybook as a heroui or pencil concern** — this
  namespace is peer to those, consumed by both. Pencil produces
  framework-agnostic specs; heroui produces React
  implementation; storybook documents the implementation. Don't
  collapse the boundaries.
- **Maintenance work in this namespace** — drift cleanup
  (orphaned stories, broken decorators after upgrades, stale
  MDX) belongs to `engineer/maintenance/remediation/storybook-drift`.
  This namespace is for deliberate work; maintenance is for
  drift.
- **Project-specific gotchas seeded in the suite** — known
  gotchas (e.g., framework version-specific quirks) are
  populated per-project via dedicated commands. The suite ships
  with `knownGotchas: []`.

## Cross-namespace coordination

### With `product/design/`

Pencil produces framework-agnostic design specs. When a Pencil
spec lands and a heroui component is generated from it, the
storybook namespace covers documenting that component. The
relationship is: pencil spec → heroui component → storybook
story.

### With `frameworks/heroui/` (or whichever framework namespace)

The framework namespace produces components. The storybook
namespace produces stories for those components. They're
peers; neither owns the other.

### With `engineer/maintenance/`

`engineer/maintenance/remediation/atomic-design.md` invokes
`/core:frameworks:storybook:stories:gen-missing` for AD-7 violations.
`engineer/maintenance/remediation/component-dedup.md` requires Storybook
as a visual regression source. The maintenance routine
`storybook-drift` orchestrates drift cleanup using
`/core:frameworks:storybook:verify:*` and other diagnostic commands.

### With `engineer/architecture/`

Architectural decisions about the design system (component
hierarchy convention, addon strategy, visual regression tool)
are documented as ADRs. The manifest captures the project's
implementation; ADRs explain why.

## Conventions

### Commit conventions

Stories: `feat(stories): add stories for ComponentName` or
`docs(stories): refresh ComponentName stories for v3 API`

Story fixes: `fix(stories): repair ComponentName stories after
v3 migration`

Migration verification: `chore(migration): verify ComponentName
migration v2→v3` (and similar for other migration types)

### Story file location

Stories live alongside their components by default
(`Component.tsx` + `Component.stories.tsx` in the same
directory). The manifest's `componentOrganization.componentRoot`
defines where components live; stories follow.

### Realistic story content

Stories should use realistic content from the project's domain
rather than "Lorem ipsum" or generic placeholders. The
`gen-story` command derives realistic content from
`.pencil-tone.json` and `.pencil-editorial.json` when those
exist.

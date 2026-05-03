---
description: Initialize the storybook runtime manifest at product/.pencil-storybook.json. Detects values from the project (Storybook version, addons, organization, lint setup) and walks the user through confirming or correcting each. Run once per project; first-run auto-init handles partial initialization for individual commands.
argument-hint: [--update] [--scope storybook|organization|addons|providers|screenshots|visual-regression|lint]
allowed-tools: Read, Write, Edit, Bash
---

Initialize the storybook runtime manifest. Auto-detects values
from the project and walks the user through confirming or
correcting each.

This command is the comprehensive upfront initialization. Most
users don't need to run it explicitly — first-run auto-init
handles partial initialization as individual commands need
fields. Run `/frameworks:storybook:init` when:

- Setting up a fresh project end-to-end
- Re-running detection after a major Storybook upgrade
- Updating component organization or framework
- Wanting to populate fields beyond what auto-init has covered

## Phase 0: discovery

1. Check whether `product/.pencil-storybook.json` exists.
2. If it exists and `--update` was NOT provided, show the
   current state and confirm before overwriting:

   > Manifest exists. Current contents (excerpt):
   >   storybook.version: 10.3.4
   >   storybook.framework: @storybook/nextjs
   >   componentOrganization.convention: atomic-design
   >
   > Continue and re-initialize? Existing values will be used
   > as defaults; you'll confirm each. [y/N]

3. If `--scope` is provided, only process that section. Useful
   for targeted updates (e.g., re-detecting addons after
   adding new ones).

## Phase 1: Storybook environment detection

### Read `package.json`

Locate the project's `package.json`. Try in order:

1. Current working directory
2. Common monorepo subdirectories: `app-ui/`, `apps/web/`,
   `packages/ui/`, `web/`, `frontend/`
3. Prompt user for path

### Detect Storybook version + framework

```bash
# Pseudocode — implementation reads package.json
storybook_version = package.json.devDependencies.storybook
                  ?? package.json.dependencies.storybook
framework_pkg = first match for /@storybook\/(nextjs|react-vite|sveltekit|vue3-vite|...)/
                in dependencies
```

### Detect config dir

Try in order:

- `.storybook/` (in the same directory as package.json)
- `<package-root>/.storybook/`
- `frameworks/storybook/` (less common)
- Search project for `main.ts`/`main.js` with Storybook config

### Detect URLs

```bash
# Parse storybook script in package.json for -p flag
# Default: 6006 if -p not specified
storybook_script = package.json.scripts.storybook
port = parse_port_flag(storybook_script) ?? 6006
local_url = "http://localhost:${port}"
```

Deployed URL: prompt the user (no reliable detection).

### Detect commands

```bash
start_command = "cd <package-root> && npm run storybook"
build_command = "cd <package-root> && npm run build-storybook"
```

If the project uses `pnpm` or `yarn` instead, detect from
lockfile (`pnpm-lock.yaml`, `yarn.lock`).

### Read stories glob from main config

```bash
# Read .storybook/main.ts or main.js
# Extract `stories` array from the config object
# Example: stories: ["../**/*.stories.@(js|jsx|mjs|ts|tsx)"]
```

### Confirmation prompt

Present detected values:

```
Storybook environment (detected):
  Version:         10.3.4
  Framework:       @storybook/nextjs
  Config dir:      app-ui/.storybook/
  Stories glob:    app-ui/**/*.stories.@(js|jsx|mjs|ts|tsx)
  MDX glob:        app-ui/**/*.mdx
  Package root:    app-ui/
  Local URL:       http://localhost:6006
  Deployed URL:    (not detected — please provide)
  Start command:   cd app-ui && npm run storybook
  Build command:   cd app-ui && npm run build-storybook

Accept? [Y/edit field <name>/skip]
```

User can:
- Accept all (default)
- Edit a specific field by name
- Skip this section (leaves it for later)

## Phase 2: component organization detection

### Convention detection

Scan the component root directory (default: `components/` or
detected from package.json paths) for sub-directory names:

```bash
# Pseudocode
component_dirs = list_immediate_subdirectories(component_root)

# Pattern: atomic-design
if {atoms, molecules, organisms} ⊂ component_dirs:
    convention = "atomic-design"

# Pattern: feature-based
elif most subdirs are feature-shaped (auth, dashboard, billing, etc.):
    convention = "feature-based"

# Pattern: flat
elif most subdirs contain a single component file each:
    convention = "flat"

# Otherwise
else:
    convention = "custom"
    # Prompt user to define mapping
```

### For atomic-design: enumerate hierarchy

Walk each atomic directory; collect component names:

```
atoms/:        avatar, button, chip, icon, link, progress,
                rating, select, switch, tag, title
molecules/:    card, collapsible-dropdown, date-display, ...
organisms/:    student-profile, tables, layout-sections, ...
templates/:    workspace-layout, content-layout
```

### For feature-based: enumerate features

```
features/:     auth, dashboard, billing, ...
  Each feature directory becomes a "section" in the manifest
```

### For flat: just list

```
components/:   Button, Card, Header, ...
  No hierarchy; story title pattern is "Components/<Name>"
```

### For custom: walk user through mapping

Prompt the user to define the mapping:

> Custom organization detected. Define the mapping:
>
> What sub-directories under `components/` should be treated
> as categories? (e.g., "ui", "shared", "features")
>
> For each category, what's the title prefix? (e.g.,
> "ui" → "UI", "shared" → "Shared", "features" → "Features")

### Feature sections (multi-section apps)

Apps with distinct sections (e.g., public-facing, admin,
authenticated dashboard) often have separate component
hierarchies per section:

```
components/
  public/
    atoms/
    molecules/
    ...
  admin/
    atoms/
    ...
  platform/
    ...
```

Detect this pattern; prompt for section names if found:

> Multiple top-level sections detected:
>   - public/ → suggested name: "Public"
>   - admin/ → suggested name: "Admin"
>   - platform/ → suggested name: "Platform"
>
> Accept these names, or provide custom labels?

### Title pattern

For atomic-design with sections:
`<Section>/<Category>/<Component>`

For atomic-design without sections:
`Core/<Category>/<Component>` (with "Core" as a default
section)

For feature-based:
`<Feature>/<Component>`

For flat:
`Components/<Component>`

For custom: user-defined.

## Phase 3: addon detection

Read `package.json` dependencies and devDependencies. Match
known patterns:

```bash
# Common Storybook addons
@storybook/addon-a11y           → addons.a11y
@storybook/addon-coverage       → addons.coverage
@storybook/addon-designs        → addons.designs
@storybook/addon-themes         → addons.themes
@storybook/addon-docs           → addons.docs
@storybook/addon-actions        → addons.actions
@storybook/addon-controls       → addons.controls
@storybook/addon-viewport       → addons.viewport
@storybook/addon-backgrounds    → addons.backgrounds
@storybook/addon-measure        → addons.measure
@storybook/addon-outline        → addons.outline
@storybook/addon-onboarding     → addons.onboarding

# Visual regression
@chromatic-com/storybook        → addons.chromatic

# Mocking
msw-storybook-addon             → addons.msw

# Testing
@storybook/test                 → addons.test
@storybook/testing-library      → addons.testingLibrary
@storybook/jest                 → addons.jest

# Form / data
@storybook/addon-storysource    → addons.storysource
```

Present detected addons:

```
Detected Storybook addons (12):
  a11y:       @storybook/addon-a11y
  coverage:   @storybook/addon-coverage
  designs:    @storybook/addon-designs
  themes:     @storybook/addon-themes
  docs:       @storybook/addon-docs
  chromatic:  @chromatic-com/storybook
  msw:        msw-storybook-addon
  test:       @storybook/test
  ...

Accept? [Y/add custom/remove]
```

User can add custom addons not in the recognition table.

## Phase 4: provider stack detection

Best-effort parse of `<configDir>/preview.js` or `preview.ts`.

### Parse strategies

The preview file usually exports `decorators` array or a `decorators`
property in the config. Each decorator typically wraps stories
in a provider.

```typescript
// Common pattern
export const decorators = [
  (Story) => (
    <Suspense fallback={null}>
      <QueryClientProvider client={queryClient}>
        <CookiesProvider>
          <ThemeProvider>
            <LanguageProvider>
              <Story />
            </LanguageProvider>
          </ThemeProvider>
        </CookiesProvider>
      </QueryClientProvider>
    </Suspense>
  ),
];
```

Extract:
- Provider component names (in nesting order, outer to inner)
- Visible config (e.g., `client={queryClient}` indicates
  QueryClientProvider config)

### Surface for confirmation

```
Provider stack (parsed from preview.tsx):
  1. Suspense              — i18n translation loading
  2. QueryClientProvider   — TanStack Query
                             (config: retry: false, staleTime: Infinity)
  3. CookiesProvider       — react-cookie
  4. ThemeProvider         — next-themes (light/dark)
  5. LanguageProvider      — i18n with en fallback

Accept? [Y/edit/skip]

Note: The "purpose" descriptions are AI-generated; please review
and correct. They help future story authors understand why each
provider is in the stack.
```

User confirms or edits each entry's purpose. Order is rarely
wrong (tracks the JSX nesting); purposes need user input.

If parsing fails (decorators are imported from another file,
complex factory patterns), prompt for manual entry:

> Provider stack couldn't be parsed automatically. List each
> provider in nesting order (outermost first), with its
> purpose. Enter empty line when done.

## Phase 5: screenshot configuration

Mostly defaults with user overrides:

```
Screenshot configuration:
  Directory:                    .screenshots/  (relative to package root)
  Viewport (width,height):      800,600
  Browser:                      chromium
  First-story timeout (ms):     30000
  Subsequent-story timeout (ms): 8000
  Deployed-story timeout (ms):  5000
  Sub-directories:              health, debug, deployed, local, diff, color

Accept defaults? [Y/edit field <name>]
```

Defaults are based on common patterns. Edit if the project has
specific needs (different viewport for design-system review,
faster timeouts on a vite-based setup, etc.).

## Phase 6: visual regression configuration

```
Visual regression tool:
  [1] pixelmatch (CLI-based; no service required)
  [2] chromatic (cloud service)
  [3] both (use pixelmatch locally + chromatic in CI)
  [4] none (skip visual regression)

Choice [1-4]:
```

For pixelmatch:
```
Threshold (0.0 - 1.0; lower = stricter): 0.01

Match classification:
  0 diff pixels:    label "MATCH"
  1-49 diff pixels: label "WARN"
                    note: "Likely sub-pixel anti-aliasing — but
                          always investigate"
  50+ diff pixels:  label "DIFF"
                    note: "Must investigate and fix"

Accept defaults? [Y/edit]
```

For chromatic:
```
Chromatic integration:
  Project token: read from CHROMATIC_PROJECT_TOKEN env var
  (NOT stored in manifest)

Confirm chromatic enabled in this project? [Y/n]
```

## Phase 7: lint configuration

Detect lint setup:

```bash
# Detection priority
if exists "biome.json" or "biome.jsonc":
    lint_command = "npx biome check ."
elif exists ".eslintrc*" or eslint config in package.json:
    lint_command = "npx eslint ."
elif package.json.scripts.lint:
    lint_command = "npm run lint"  # or pnpm/yarn equivalent
else:
    lint_command = null  # prompt user
```

Present:

```
Lint configuration (detected):
  Command:      npx biome check .
  Working dir:  app-ui/

Accept? [Y/edit/skip if no lint setup]
```

## Phase 8: known gotchas

```
Known gotchas registry:
  Currently empty.

  Gotchas are populated as you encounter them via:
    /frameworks:storybook:migration:fix-pattern --add-gotcha

  This keeps the suite portable — your project's specific
  gotchas don't ship with the suite.
```

No prompting; this section starts empty by design.

## Phase 9: persist manifest

Write `product/.pencil-storybook.json` with all confirmed values.
Set `version: 1` and `lastUpdated: <ISO timestamp>`.

If the file already existed, the previous content is replaced.
A backup at `product/.pencil-storybook.json.backup` is created
before overwriting (cleaned up on next successful init or by
the user manually).

## Phase 10: report

```
Storybook namespace initialized.

Manifest written:    product/.pencil-storybook.json
Total fields set:    47

Detected:
  Storybook version: 10.3.4
  Framework:         @storybook/nextjs
  Organization:      atomic-design (4 atomic categories,
                                    3 feature sections)
  Addons:            12 detected
  Provider stack:    5 providers
  Visual regression: pixelmatch (threshold 0.01)
  Lint:              npx biome check .

Next steps:
  - Verify Storybook starts: cd app-ui && npm run storybook
  - Run health check: /frameworks:storybook:verify:health
  - Generate stories for components without them:
    /frameworks:storybook:stories:gen-missing
  - Build catalog report: /frameworks:storybook:catalog
```

## Auto-trigger from other commands

When another `/frameworks:storybook:*` command runs and the manifest is
missing OR a required field is missing for that command, the
command auto-triggers a partial init covering just the fields
it needs. The user is prompted only for those fields, not the
full init flow.

Example: `/frameworks:storybook:verify:health` runs and the manifest has
no `storybook.localUrl`. It prompts only for that field, persists,
and proceeds. The rest of the manifest stays empty until other
commands need their fields.

This makes the user experience smooth: storybook commands just
work, asking for inputs only when needed. The full init exists
for users who prefer upfront setup.

## What this command does NOT do

- **Run Storybook.** Init configures the manifest; users start
  Storybook via the manifest's `startCommand`.
- **Install missing dependencies.** If detection shows the
  project lacks Storybook, init reports this and stops; the
  user installs Storybook first.
- **Validate that Storybook actually works.** Init captures
  configuration; verification happens via
  `/frameworks:storybook:verify:*`.
- **Modify project files outside `design/`.** Init reads from
  the project (package.json, .storybook/, components/) but
  writes only to `product/.pencil-storybook.json`.

## Examples

```bash
# Standard initialization
/frameworks:storybook:init

# Re-run after a Storybook upgrade
/frameworks:storybook:init --update

# Update only addon detection (after installing new addons)
/frameworks:storybook:init --update --scope addons

# Update only component organization (after restructuring)
/frameworks:storybook:init --update --scope organization
```

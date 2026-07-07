---
description: ESLint — the long-standing JavaScript/TypeScript linter. CLI only — no MCP. Used by projects that haven't migrated to Biome, or that need ESLint plugins Biome doesn't yet support. Mutually exclusive with Biome — projects use one or the other. Composed with Prettier (separate tool, often invoked together).
argument-hint: <free-form-prompt> [--fix] [--quiet] [--max-warnings <n>] [<paths>...]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of ESLint for lint operations. The
established linter for JavaScript/TypeScript projects;
many projects with rich plugin ecosystems still use ESLint
rather than Biome.

## Phase 0: pre-flight

1. Verify eslint active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.eslint.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "ESLint not active. Run /core:tools:setup eslint"
     echo ""
     echo "If your project uses Biome instead, run /core:tools:setup biome"
     exit 1
   fi
   ```

2. Verify ESLint is invokable:

   ```bash
   if ! npx --no-install eslint --version >/dev/null 2>&1; then
     echo "ESLint not installed."
     echo "Project: npm install --save-dev eslint"
     echo "Init:    npm init @eslint/config@latest"
     exit 1
   fi
   ```

3. Verify ESLint config exists:

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.eslint.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   # ESLint has multiple possible config file locations
   CONFIG_FOUND=false
   for CFG in eslint.config.js eslint.config.mjs eslint.config.cjs \
              .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
     if [ -f "${PROJECT_ROOT}/${CFG}" ]; then
       CONFIG_FOUND=true
       break
     fi
   done
   
   # Or in package.json
   if [ "$CONFIG_FOUND" = "false" ]; then
     if jq -e '.eslintConfig' "${PROJECT_ROOT}/package.json" >/dev/null 2>&1; then
       CONFIG_FOUND=true
     fi
   fi
   
   if [ "$CONFIG_FOUND" = "false" ]; then
     echo "ESLint config not found at ${PROJECT_ROOT}"
     echo "Run: npm init @eslint/config@latest"
     exit 1
   fi
   ```

## Phase 1: prompt interpretation

ESLint operations:

### Lint

- **Lint check** — report issues without modification
- **Lint fix** — auto-fix safe rules
- **Lint with specific rules disabled** — for triage workflows

### Output formatting

- **Compact format** — terse output suitable for piping
- **JSON format** — structured output for parsing
- **JUnit format** — for CI test result integration
- **GitHub format** — annotations on PRs
- **HTML report** — browseable issue list

### Specific operations

- **Quiet mode** — only errors, hide warnings
- **Max-warnings threshold** — fail if warnings exceed limit
- **Cache mode** — incremental linting

## Phase 2: execution

### Standard lint

```bash
PATHS="${PATHS:-.}"

# Default invocation; respects .eslintrc/eslint.config.js
npx eslint $PATHS

# With specific format
npx eslint --format=stylish $PATHS

# Quiet (errors only)
npx eslint --quiet $PATHS

# JSON for parsing
npx eslint --format=json $PATHS
```

### Lint with auto-fix

```bash
# Apply --fix (safe rules only by default; ESLint has no
# unsafe-fix concept like Biome)
npx eslint --fix $PATHS

# --fix-dry-run to preview without applying
npx eslint --fix-dry-run --format=json $PATHS
```

### Cache for performance

```bash
# Use cache (faster subsequent runs)
npx eslint --cache --cache-location .eslintcache $PATHS

# Cleanup old cache periodically
rm -f .eslintcache
```

### Specific severity threshold

```bash
# Fail if more than 10 warnings
npx eslint --max-warnings 10 $PATHS

# Common in CI to gate PRs on warning count
```

### Filter to specific rule

```bash
# Run only specific rule(s)
npx eslint --no-eslintrc --rule '{"no-console": "error"}' $PATHS

# Useful for triage — confirm only this one rule's findings
```

## Phase 3: result formatting

### Standard lint findings

```
=== ESLint ===
Paths checked: app-ui/components
Files:         245
Config:        eslint.config.js

Errors:    2
Warnings:  17
Info:      5

Findings:
  components/atoms/button/Button.tsx:42:5
    error  no-unused-vars  'unused' is defined but never used
    Auto-fixable: yes (--fix)
  
  components/molecules/search-bar/SearchBar.tsx:18:7
    warning  @typescript-eslint/no-explicit-any  Unexpected any
    Auto-fixable: no
  
  components/organisms/dashboard/Dashboard.tsx:5:1
    error  import/order  'react' should occur before 'next'
    Auto-fixable: yes (--fix)
  
  ...

Auto-fixable: 8 of 19 issues
Run with --fix to apply.
```

### After auto-fix

```
=== ESLint --fix ===
Applied auto-fixes to 8 issues across 5 files.

Remaining issues (manual review needed):
  Errors:    0
  Warnings:  11

Files modified:
  components/atoms/button/Button.tsx
  components/molecules/search-bar/SearchBar.tsx
  components/organisms/dashboard/Dashboard.tsx
  ... (2 more)

Run /core:tools:biome 'check format' OR /core:tools:prettier (when added)
to apply formatting changes.
```

ESLint doesn't format (typically); Prettier handles formatting
in ESLint-using projects. Suite users with ESLint will have
Prettier configured separately.

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| Configuration file not found | No .eslintrc / eslint.config.js | Run `npm init @eslint/config@latest` |
| Plugin not found | Plugin in config but not installed | Install missing plugin: npm install --save-dev <plugin> |
| Parser config error | TypeScript parser misconfigured | Verify @typescript-eslint/parser installed and configured |
| Out of memory | Very large codebase | Increase Node memory: `NODE_OPTIONS='--max-old-space-size=4096' npx eslint ...` |

## Cross-namespace integration

ESLint is consumed by:

- **`engineer/maintenance/remediation/eslint-issues`** —
  parallel routine to biome-issues for ESLint projects
  (when added; not yet built)
- **Post-edit hooks** when project uses ESLint instead of
  Biome — same pattern as Biome but with ESLint commands
- **`frameworks/storybook/stories:gen`** — after generating
  stories, lint pass

The suite's commands typically check the project's tools
manifest to know whether to invoke `biome` or `eslint`. Both
serve the same purpose; only one is active per project.

## Distinction from Biome

| Aspect | ESLint | Biome |
|--------|--------|-------|
| Speed | Standard | ~10-100x faster |
| Plugin ecosystem | Massive | Smaller (growing) |
| Configuration | Multiple files (.eslintrc, .prettierrc, etc.) | Single biome.json |
| Format-on-save | Requires Prettier integration | Built-in |
| TypeScript support | Via @typescript-eslint plugin | Native |

Choose ESLint when: extensive plugin ecosystem needed, or
existing project hasn't migrated, or specific rules not yet
in Biome.

Choose Biome when: greenfield project, performance matters,
single-tool simplicity preferred.

## What this tool does NOT do

- **Format code.** Pair with Prettier in ESLint projects.
  Biome handles both; ESLint doesn't.
- **TypeScript type checking.** Use `tsc --noEmit` for that.
- **Configure rules.** User-managed in eslint.config.js or
  .eslintrc.
- **Auto-install missing plugins.** Surfaces missing plugin
  errors with install commands.

## Examples

```bash
# Lint check (no changes)
/core:tools:eslint "check lint issues in app-ui/components"

# Apply auto-fixes
/core:tools:eslint "fix auto-fixable issues" --fix

# Strict mode (fail on warnings)
/core:tools:eslint "lint in strict mode" --max-warnings 0

# Quiet (errors only)
/core:tools:eslint "show only errors" --quiet

# Specific rule diagnosis
/core:tools:eslint "find all places using `any` type"
# (translates to --rule '{"@typescript-eslint/no-explicit-any": "error"}')
```

---

# Registry definition

## Tool metadata

```yaml
name: eslint
displayName: ESLint
provider: eslint-org
category: linter
optional: true   # only required when project uses ESLint
mutuallyExclusive: [biome]   # typically one or the other
```

## Interfaces

### CLI

```yaml
executable: npx eslint (or eslint)
detectionCommand: npx --no-install eslint --version
installCommand: |
  Project (recommended):
    npm install --save-dev eslint
    npm init @eslint/config@latest  # interactive setup
  Global:
    not recommended (config inheritance issues)
notes: |
  ESLint v9+ uses flat config (eslint.config.js).
  Older projects may use legacy .eslintrc.* config — both
  work; eslint detects and uses whichever exists.
```

### MCP

**Not available.** ESLint is a CLI tool; no MCP exists.

## Version constraint

Recommended: ESLint 8.50+ (mature flat config or stable
.eslintrc support). ESLint 9+ uses flat config exclusively.

## Required by skillz commands

Auto-populated. Currently:
- (Future) /engineer:maintenance:remediation:eslint-issues
- Post-edit hooks in various commands when project uses ESLint

## Cross-tool dependencies

- Node.js 18+
- Project ESLint config (eslint.config.js or .eslintrc.*)
- Plugins per config (@typescript-eslint, react, etc.)

## Mutually exclusive with

- Biome (most projects use one or the other)

## Companion tools (when project uses ESLint)

- Prettier (formatting; not yet a tool in this suite but
  commonly paired)
- husky / lint-staged (pre-commit hooks; out of scope)

## System requirements

- Node.js 18+
- ~50 MB disk for ESLint + typical plugin set

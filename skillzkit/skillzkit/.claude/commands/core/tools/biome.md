---
description: Biome — fast linter and formatter for JavaScript, TypeScript, JSON, JSX, TSX. CLI only — no MCP. Heavily consumed by /engineer:maintenance:remediation:biome-issues for lint remediation and by post-edit hooks across the suite. Replaces ESLint + Prettier with a single tool when project uses Biome.
argument-hint: <free-form-prompt> [--fix] [--apply-unsafe] [--check-only] [<paths>...]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of Biome for lint and format operations.
The dominant linter for projects standardized on Biome
(SkoolScout, jefelabs codebases). When the project's manifest
specifies Biome, suite commands invoke this tool for
post-edit lint passes.

## Phase 0: pre-flight

1. Verify biome active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.biome.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Biome not active. Run /core:tools:setup biome"
     echo ""
     echo "If your project uses ESLint instead, run /core:tools:setup eslint"
     exit 1
   fi
   ```

2. Verify Biome is invokable:

   ```bash
   if ! npx --no-install biome --version >/dev/null 2>&1; then
     if ! command -v biome >/dev/null 2>&1; then
       echo "Biome not installed."
       echo "Project: npm install --save-dev --save-exact @biomejs/biome"
       echo "Init:    npx @biomejs/biome init"
       exit 1
     fi
   fi
   ```

3. Verify biome.json (or biome.jsonc) exists:

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.biome.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   if [ ! -f "${PROJECT_ROOT}/biome.json" ] && \
      [ ! -f "${PROJECT_ROOT}/biome.jsonc" ]; then
     echo "Biome config not found at ${PROJECT_ROOT}"
     echo "Run: npx @biomejs/biome init"
     exit 1
   fi
   ```

## Phase 1: prompt interpretation

Biome operations:

### Lint

- **Lint check** — report issues without modification
- **Lint fix (safe)** — apply auto-fixable rules; safe by default
- **Lint fix (unsafe)** — apply unsafe-fixable rules (rules
  Biome marks as potentially behavior-changing)

### Format

- **Format check** — report files needing formatting
- **Format apply** — write formatted files

### Combined check

- **Full check** — lint + format + import organization in one
  pass (`biome check`)

### Specific operations

- **Organize imports** — sort and deduplicate import statements
- **CI mode** — same as check but with non-interactive output

## Phase 2: execution

### Standard lint (check only)

```bash
PATHS="${PATHS:-.}"

npx @biomejs/biome lint \
  --reporter=github \
  $PATHS
```

The `--reporter=github` produces output suitable for parsing
by CI / agents. Other options: `default`, `json`, `summary`.

### Lint with auto-fix

```bash
# Safe fixes only (default)
npx @biomejs/biome lint --write $PATHS

# Include unsafe fixes (rules marked as potentially behavior-changing)
npx @biomejs/biome lint --write --unsafe $PATHS
```

The `--unsafe` flag is gated; the suite uses it explicitly
only when invoked by `biome-issues` remediator after user
confirmation per rule.

### Format

```bash
# Check (report-only)
npx @biomejs/biome format $PATHS

# Apply
npx @biomejs/biome format --write $PATHS
```

### Combined check (most common)

```bash
# Lint + format + organize imports (write mode)
npx @biomejs/biome check --write $PATHS

# Check-only mode (CI)
npx @biomejs/biome check $PATHS
```

### CI mode

```bash
# Suitable for CI (non-interactive, structured output)
npx @biomejs/biome ci $PATHS
```

## Phase 3: result formatting

### Lint findings

```
=== Biome Lint ===
Paths checked: app-ui/components
Files:         245 (TypeScript: 198, TSX: 42, JS: 5)

Errors:    0
Warnings:  3
Info:      12
Auto-fixable: 8 of 15 issues

Findings:
  components/atoms/button/Button.tsx:42:5
    [warning] noUnusedVariables — Variable 'unused' is declared but never used
    Auto-fixable: yes (--write)
  
  components/molecules/search-bar/SearchBar.tsx:18:7
    [warning] noExplicitAny — Avoid `any` type
    Auto-fixable: no (manual review needed)
  
  ...

Run with --fix to apply 8 auto-fixable changes.
Run with --apply-unsafe to apply potentially behavior-changing
fixes (review carefully).
```

### Format findings

```
=== Biome Format ===
Files needing format: 7

  components/atoms/button/Button.tsx
  components/atoms/input/Input.tsx
  ... (5 more)

Run with --write to format these files.
```

### Combined check

```
=== Biome Check (lint + format + imports) ===
Files checked: 245
Operations:    lint, format, organize-imports

Issues found:
  Lint warnings:    3
  Format diffs:     7
  Import disorder:  4 files

Auto-fixable: 14 of 14
Run with --fix to apply.
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `Configuration file not found` | biome.json missing | Run `npx @biomejs/biome init` |
| `Schema mismatch` | Biome version differs from config schema | Update either Biome or biome.json |
| Parse error | Source file syntax-invalid | Fix syntax before lint can run |
| Permission denied | File not writable | Check file permissions |

## Cross-namespace integration

Biome is consumed by:

- **`engineer/maintenance/remediation/biome-issues`** — the
  primary consumer; full lint remediation routine
- **Post-edit hooks** in many design/engineer commands — after
  generating or editing TS/TSX, run `biome check --write` for
  consistency
- **`frameworks/storybook/stories:gen` and similar** — after
  generating stories, lint pass to ensure clean output
- **`frameworks/heroui:build-components`** — after generating
  components, lint pass

## Distinction from ESLint

| Tool | Replaces | Performance | Config |
|------|----------|-------------|--------|
| Biome | ESLint + Prettier | ~10-100x faster | Single biome.json |
| ESLint | (config only) | Standard | .eslintrc + .prettierrc + plugins |

Most projects use one or the other. Setup detects which is
configured (biome.json vs .eslintrc) and activates the
matching tool.

## What this tool does NOT do

- **Configure Biome rules.** Rule configuration is in
  biome.json; user-managed.
- **Replace tsc.** TypeScript checking is separate (use
  `tsc --noEmit`); Biome handles syntax-level lint.
- **Format non-supported files.** Biome supports JS, TS, JSX,
  TSX, JSON. CSS, HTML, Markdown require other tools.
- **Replace ESLint when ESLint is the project's choice.** If
  the project has .eslintrc, use `/core:tools:eslint`.

## Examples

```bash
# Lint check (no changes)
/core:tools:biome "check lint issues in app-ui/components"

# Apply safe auto-fixes
/core:tools:biome "fix all auto-fixable lint issues" --fix

# Apply including unsafe fixes
/core:tools:biome "fix all lint including potentially behavior-changing" --apply-unsafe

# Format-only check
/core:tools:biome "show me files that need formatting" 

# Combined check (most common)
/core:tools:biome "run full check on app-ui" --fix
```

---

# Registry definition

## Tool metadata

```yaml
name: biome
displayName: Biome
provider: biome-org
category: linter-formatter
optional: true   # only required when project uses Biome
mutuallyExclusive: [eslint]   # typically one or the other
```

## Interfaces

### CLI

```yaml
executable: npx @biomejs/biome (or biome)
detectionCommand: npx --no-install biome --version
installCommand: |
  Project (recommended):
    npm install --save-dev --save-exact @biomejs/biome
    npx @biomejs/biome init  # creates biome.json
  Global:
    npm install -g @biomejs/biome
notes: |
  Recommend project-local install with --save-exact for
  reproducibility (Biome's rapid evolution can break configs
  across versions).
```

### MCP

**Not available.** Biome is a CLI tool with rich parameter
surface; no MCP exists or is needed.

## Version constraint

Recommended: Biome 1.5+. The CLI surface evolves; pin
versions for project consistency.

## Required by skillz commands

Auto-populated. Currently:
- /engineer:maintenance:remediation:biome-issues
- Post-edit hooks in various commands

## Cross-tool dependencies

- Node.js 14+
- Project biome.json or biome.jsonc

## Mutually exclusive with

- ESLint (most projects use one or the other)

## System requirements

- Node.js 14+
- Negligible disk for the package

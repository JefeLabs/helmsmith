# Branding Feature — Implementation Plan

## Goal
Centralize all brand-specific strings (tool name, config paths, URLs) so a single rebrand command can retarget the entire CLI by changing two values.

## Two Root Primitives

```
appGroupName = "agentx"     → umbrella suite name (shared across tools)
appName      = "taskmaster"  → this specific tool's name
```

Everything else derives from these:

| Derived Value | Formula | Example |
|---|---|---|
| CLI name | `appName` | `taskmaster` |
| Config parent dir | `.${appGroupName}` | `.agentx` |
| Config subdir | `appName` | `taskmaster` |
| Config path | `~/.${appGroupName}/${appName}/` | `~/.agentx/taskmaster/` |
| Manifest filename | `${appName}.yaml` | `taskmaster.yaml` |
| Auth file | `${configPath}/auth.json` | `~/.agentx/taskmaster/auth.json` |

## File Structure

```
src/config/branding.ts      ← runtime constants (the only file with hardcoded brand strings)
src/commands/rebrand.ts     ← hidden CLI command for find-and-replace rebranding
branding.yaml               ← rebrand input config at project root (two root values + overrides)
```

## Step-by-Step for a New Project

### 1. Create `src/config/branding.ts`
- Define `APP_GROUP_NAME` and `APP_NAME` as the two root constants
- Derive everything else: `CONFIG_PARENT_DIR`, `CONFIG_DIR_NAME`, `MANIFEST_FILENAME`, `APP_CONFIG_DIR_DISPLAY`, etc.
- Export all constants

### 2. Replace all hardcoded brand strings in source files
- Import from `branding.ts` instead of using string literals
- Target: CLI `.name()`, `.description()`, user-facing error messages, file paths
- After this step, `grep -r "yourToolName" src/` should only match `branding.ts`

### 3. Re-export from barrel (`src/config/index.ts`)
- Add branding constants to the existing barrel export

### 4. Create `branding.yaml` at project root
- Two required fields: `appGroupName`, `appName`
- Optional overrides: `description`, `version`, `repo_url`, `author`, `license`, `keywords`
- List `files_to_update` and `files_to_rename`

### 5. Create `src/commands/rebrand.ts` as a hidden CLI command
- Import `APP_GROUP_NAME` and `APP_NAME` from `branding.ts` (no hardcoded `CURRENT_*` constants)
- Register with Commander as `{ hidden: true }` — accessible but not shown in `--help`
- `deriveBrand()` computes all derived strings from the two primitives
- `buildReplacements()` orders replacements specific-to-general to avoid partial matches
- `updatePackageJson()` patches `name`, `version`, `bin`, `keywords`, etc.
- `renameFiles()` renames files using `{{placeholder}}` interpolation
- Updates `branding.ts` itself so the next run uses the new values as "current"
- Supports `--dry-run` flag for previewing changes

### 6. Register in CLI
```typescript
import { registerRebrand } from './commands/rebrand.js';
registerRebrand(program);
```

Usage: `taskmaster rebrand` or `taskmaster rebrand --dry-run`

## Key Design Decisions

- **Runtime constants, not just script replacement** — `branding.ts` is imported at runtime so all paths resolve correctly. The rebrand command updates `branding.ts` itself, and the derivation chain handles the rest.
- **Two primitives, not N fields** — Keeps `branding.yaml` minimal. Most projects only need to change `appGroupName` and `appName`.
- **Shared parent dir** — All agentx tools share `~/.agentx/`, each in their own subdir. This keeps the user's home directory clean.
- **Replacement order matters** — Replace URLs and compound strings (e.g., `taskmaster.yaml`) before bare words (e.g., `taskmaster`) to avoid partial matches corrupting longer strings.
- **Hidden command** — Rebrand is a developer tool, not end-user facing. `{ hidden: true }` keeps `--help` clean.

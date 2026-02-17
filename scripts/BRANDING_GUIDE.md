# Branding Feature — Implementation Plan

## Goal
Centralize all brand-specific strings (tool name, config paths, URLs) so a single rebrand script can retarget the entire CLI by changing two values.

## Two Root Primitives

```
appGroupName = "agentx"     → umbrella suite name (shared across tools)
appName      = "gittyup"    → this specific tool's name
```

Everything else derives from these:

| Derived Value | Formula | Example |
|---|---|---|
| CLI name | `appName` | `gittyup` |
| Config parent dir | `.${appGroupName}` | `.agentx` |
| Config subdir | `appName` | `gittyup` |
| Config path | `~/.${appGroupName}/${appName}/` | `~/.agentx/gittyup/` |
| Manifest filename | `${appName}.yaml` | `gittyup.yaml` |
| Auth file | `${configPath}/auth.json` | `~/.agentx/gittyup/auth.json` |
| Cache dir | `${configPath}/cache/` | `~/.agentx/gittyup/cache/` |

## File Structure

```
src/config/branding.ts      ← runtime constants (the only file with hardcoded brand strings)
src/config/index.ts          ← barrel re-exports branding constants
scripts/branding.yaml        ← rebrand input config (two root values + overrides)
scripts/rebrand.ts           ← find-and-replace script driven by branding.yaml
```

## Step-by-Step for a New Project

### 1. Create `src/config/branding.ts`
- Define `APP_GROUP_NAME` and `APP_NAME` as the two root constants
- Derive everything else: `CONFIG_PARENT_DIR`, `CONFIG_DIR_NAME`, `MANIFEST_FILENAME`, `APP_CONFIG_DIR`, `APP_AUTH_FILE`, `APP_CACHE_DIR`, `APP_CONFIG_DIR_DISPLAY`, `APP_REPO_URL`
- Export all constants

### 2. Replace all hardcoded brand strings in source files
- Import from `branding.ts` instead of using string literals
- Target: CLI `.name()`, `.description()`, user-facing error messages, commit messages, PR titles/labels, file paths, JSDoc comments
- After this step, `grep -r "yourToolName" src/` should only match `branding.ts`

### 3. Re-export from barrel (`src/config/index.ts`)
- Add branding constants to the existing barrel export

### 4. Create `scripts/branding.yaml`
- Two required fields: `appGroupName`, `appName`
- Optional overrides: `description`, `version`, `repo_url`, `author`, `license`, `keywords`
- List `files_to_update` and `files_to_rename`

### 5. Create `scripts/rebrand.ts`
- Store current brand values in `CURRENT_APP_GROUP_NAME` / `CURRENT_APP_NAME`
- Derive a `DEFAULTS` object from those two (mirrors branding.ts logic)
- `resolveBranding()` reads YAML and derives the new values from the two primitives
- `updateFileContent()` does regex find-and-replace: DEFAULTS → new values
- `updatePackageJson()` patches `name`, `version`, `bin`, `keywords`, etc.
- `renameFiles()` renames manifest, bin, example files using `{{placeholder}}` interpolation
- Order replacements specific-to-general (URLs first, then compound names, then single words)

### 6. Add npm script
```json
"rebrand": "npx tsx scripts/rebrand.ts"
```

## Key Design Decisions

- **Runtime constants, not just script replacement** — `branding.ts` is imported at runtime so all paths resolve correctly. The rebrand script updates `branding.ts` itself, and the derivation chain handles the rest.
- **Two primitives, not N fields** — Keeps `branding.yaml` minimal. Most projects only need to change `appGroupName` and `appName`.
- **Shared parent dir** — All agentx tools share `~/.agentx/`, each in their own subdir. This keeps the user's home directory clean.
- **Replacement order matters** — Replace URLs and compound strings (e.g., `gittyup.yaml`) before bare words (e.g., `gittyup`) to avoid partial matches corrupting longer strings.

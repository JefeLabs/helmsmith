---
description: Open Pencil — a desktop design tool — from the command line, with optional file arguments. CLI-only invocation; no MCP wrapper for the open operation itself (Pencil's MCP is a separate tool covering structured design data access). Used by /product:design/ commands when surfacing visual review checkpoints.
argument-hint: <file-path-or-prompt> [--new] [--from-template <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation to open Pencil app, optionally with a
specific file or template. CLI-only — this tool just shells
out to the OS-appropriate command for opening Pencil.

The structured-data side of Pencil (querying components,
exporting specs) lives in `/tools:pencil-mcp`. This tool is
the simpler "open the app" primitive.

## Phase 0: pre-flight

1. Verify open-pencil active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools."open-pencil".active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "open-pencil not active. Run /tools:setup open-pencil"
     exit 1
   fi
   ```

2. Verify Pencil is installed (platform-specific):

   ```bash
   PLATFORM=$(detect_platform)
   case "$PLATFORM" in
     macos)
       if [ ! -d "/Applications/Pencil.app" ] && \
          [ ! -d "$HOME/Applications/Pencil.app" ]; then
         echo "Pencil not installed at expected path."
         echo "Install from: https://pencil.app or your team's distribution"
         exit 1
       fi
       ;;
     linux)
       command -v pencil >/dev/null 2>&1 || {
         echo "pencil command not found on PATH"
         exit 1
       }
       ;;
     windows)
       # Pencil typically registers a protocol or PATH entry
       if ! where pencil >/dev/null 2>&1; then
         echo "Pencil not found on PATH"
         exit 1
       fi
       ;;
   esac
   ```

## Phase 1: prompt interpretation

Operations:

### Open with file

- "Open this Pencil file: /path/to/design.pencil" → open
  with that specific file
- Prompt may contain `.pencil` extension or full path

### Open new (no file)

- "Open Pencil" / "Launch Pencil app" → open the app to its
  default state (recent files / new file)

### Open from template

- "Open a new Pencil file from the SkoolScout template" →
  if Pencil supports templates via CLI args, pass them; else
  open the template file directly

### Resolve file references from manifest

When prompt says "open the design system" without specifying
path, check `product/.pencil-pencil.json` for project-defined
file paths:

```bash
DESIGN_SYSTEM_FILE=$(jq -r '.files.designSystem // empty' \
                          product/.pencil-pencil.json 2>/dev/null)

if [ -z "$FILE_ARG" ] && [ -n "$DESIGN_SYSTEM_FILE" ]; then
  FILE_ARG="$DESIGN_SYSTEM_FILE"
fi
```

## Phase 2: execution per platform

### macOS

```bash
# Open with specific file
open -a Pencil "$FILE_PATH"

# Open Pencil with no file
open -a Pencil

# Open new instance forcing it to foreground
open -na Pencil --args "$FILE_PATH"
```

The `-na` flag opens a new instance even if Pencil is already
running. Without it, `open -a` reuses the existing instance.
For most workflows, reusing is correct.

### Linux

```bash
# Open with file
pencil "$FILE_PATH"

# Background-launch and return control
pencil "$FILE_PATH" &
disown
```

### Windows

```bash
# Via Start command (returns immediately)
start "" pencil "$FILE_PATH"

# Or via pencil.exe directly
pencil.exe "$FILE_PATH"
```

## Phase 3: result reporting

This tool is fire-and-forget — the app opens, control returns
immediately. Reporting confirms what happened:

```
=== Pencil Opened ===
File:        designs/skoolscout-design-system.pencil
Platform:    macOS
Status:      launch command sent

The Pencil app window should appear shortly. If it doesn't:
  - Check Pencil isn't blocked by Dock/window manager
  - Verify file path exists if specifying one
  - Try /tools:open-pencil --new to open without a file
```

For cases where the file doesn't exist:

```
=== Pencil Open Failed ===
Reason: File not found
Path:   designs/missing-file.pencil

Suggestions:
  - Verify the path
  - Use tab completion or absolute path
  - Run /tools:open-pencil --new to open Pencil without a file
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| Pencil not installed | App missing on this machine | Install from https://pencil.app or team distribution |
| File path doesn't exist | Wrong path | Use absolute path; verify file exists |
| Permission denied | File ownership/permissions | Check file readability |
| Pencil already running | Reusing existing instance | Usually fine; use `--new` if separate window needed |

## Cross-namespace integration

This tool is invoked by:

- **`product/design/design-page`** — when the workflow includes
  "open the design file for visual review" steps
- **`product/design/foundations/*`** commands when surfacing
  "open the foundation file in Pencil to verify"
- **Workflow commands** that include manual design-review
  checkpoints

Most invocations are programmatic (other commands invoking
this); direct user invocation is "I want to open my design
file."

## Distinction from /tools:pencil-mcp

| Tool | Purpose |
|------|---------|
| `/tools:open-pencil` | Open the Pencil app (UI; user interacts) |
| `/tools:pencil-mcp` | Query structured design data (components, styles, frames) without opening UI |

Some workflows compose both: pencil-mcp queries the design
data programmatically, then open-pencil surfaces the file for
human review.

## What this tool does NOT do

- **Edit Pencil files programmatically.** Pencil's MCP exposes
  some edit operations (when MCP is configured); this tool
  just opens.
- **Manage Pencil installation.** Setup detects whether Pencil
  is installed and where; doesn't auto-install.
- **Monitor open Pencil sessions.** Fire-and-forget; no
  feedback once Pencil is running.
- **Convert files between formats.** Not in scope.

## Examples

```bash
# Open a specific file
/tools:open-pencil designs/skoolscout-design-system.pencil

# Open Pencil with no file (recent files / new)
/tools:open-pencil --new

# Resolved from manifest
/tools:open-pencil "open my design system"

# From template (if Pencil version supports)
/tools:open-pencil --from-template skoolscout-page-template
```

---

# Registry definition

## Tool metadata

```yaml
name: open-pencil
displayName: Open Pencil
provider: pencil-app
category: design-tool-launcher
optional: true   # only required by projects that use Pencil
```

## Interfaces

### CLI

```yaml
executable:
  macos: open -a Pencil
  linux: pencil
  windows: pencil.exe (or `start pencil`)
detectionCommand:
  macos: |
    test -d /Applications/Pencil.app || \
    test -d $HOME/Applications/Pencil.app
  linux: command -v pencil
  windows: where pencil
installCommand: |
  Download from https://pencil.app or your team's distribution
notes: |
  Pencil's CLI surface is minimal — it accepts a file path
  argument and opens the app. Platform-specific invocation
  patterns above.
```

### MCP

**Not directly applicable.** This tool is for opening the
app. Pencil's MCP server (a separate tool —
`/tools:pencil-mcp`) covers structured data operations.

## Required by skillz commands

Auto-populated. Currently:
- /product:design:design-page (when surfacing visual review)
- Various /product:design:foundations:* commands

## Cross-tool dependencies

- Pencil app installed on the user's machine

## System requirements

Platform-specific Pencil installation. The suite doesn't
bundle Pencil.

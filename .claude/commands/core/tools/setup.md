---
description: Install or verify tools the suite depends on. Reads tool definitions from tools/, detects project ecosystem, checks each tool's availability (CLI executable present, MCP server connected), surfaces missing tools, prompts to install with user confirmation, persists state to product/.pencil-tools.json. Run on first project setup; re-run periodically to verify; --check mode for verify-only.
argument-hint: [tool-name] [--check] [--install-required] [--scope <category>] [--refresh-required-by]
allowed-tools: Read, Write, Edit, Bash
---

Install or verify tools that suite commands depend on. The
setup-time entry point for the tools registry.

## Modes

### Default — full setup

```bash
/core:tools:setup
```

Detect project ecosystem; check every applicable tool; prompt
to install missing required tools; surface missing optional
tools as recommended.

### Targeted — single tool

```bash
/core:tools:setup playwright
```

Check/install just one tool. Useful when a command failed for
lack of a specific tool.

### Verify only — `--check`

```bash
/core:tools:setup --check
```

Run availability checks without prompting to install. Updates
`verifiedAt` timestamps. Reports gaps without attempting
fixes. CI-friendly.

### Install required without prompting — `--install-required`

```bash
/core:tools:setup --install-required
```

Auto-install required tools that are missing. Skips optional
tools (still surfaces them in the report). Useful in
automated environments where prompts aren't ideal.

### Scope by category — `--scope <category>`

```bash
/core:tools:setup --scope browser-automation
```

Only handle tools in the specified category. Useful when
adding a new capability and only some tools matter.

### Refresh required-by relationships — `--refresh-required-by`

```bash
/core:tools:setup --refresh-required-by
```

Scan all command files for tool references; update each tool
file's `Required by commands` section accordingly. Run
periodically to keep the registry current. This is meta-tooling
for the registry; doesn't install anything.

## Phase 0: discovery

1. Read `tools/` directory; load each tool definition file
   (frontmatter + structured sections).
2. Read `product/.pencil-tools.json` if it exists. If missing,
   this is fresh setup.
3. Detect project ecosystem (helpful for filtering):
   - `package.json` present → JavaScript project
   - `pom.xml` present → Maven Java project
   - `build.gradle` or `build.gradle.kts` present → Gradle
     project
   - `requirements.txt` or `pyproject.toml` → Python project
   - `*.tf` files present → Terraform-using project
   - Etc.
4. Filter tools by ecosystem when `ecosystemSpecific` is set
   (e.g., Maven tool only included for Java-Maven projects).

## Phase 1: per-tool verification

For each tool in scope:

### CLI verification

```bash
# Read the tool's CLI executable from its frontmatter or
# registry entry
EXEC=$(read_tool_field "$TOOL_NAME" "interfaces.cli.executable")

# Verify by running with --version or equivalent
case "$TOOL_NAME" in
  playwright)
    npx playwright --version > /dev/null 2>&1 && AVAILABLE=true
    ;;
  pixelmatch)
    npx pixelmatch 2>&1 | grep -q "Usage" && AVAILABLE=true
    ;;
  imagemagick)
    convert --version > /dev/null 2>&1 && AVAILABLE=true
    ;;
  biome)
    npx biome --version > /dev/null 2>&1 && AVAILABLE=true
    ;;
  maven)
    command -v mvn > /dev/null && AVAILABLE=true
    ;;
  gradle)
    command -v gradle > /dev/null || [ -f ./gradlew ] && AVAILABLE=true
    ;;
  npm)
    command -v npm > /dev/null && AVAILABLE=true
    ;;
  terraform)
    command -v terraform > /dev/null && AVAILABLE=true
    ;;
  # ...
esac
```

The verification commands per tool are documented in each
tool's MD file under "Verify availability" section.

### MCP verification

MCP availability is detected from the runtime environment
(presence of tools matching the expected prefix):

```bash
# Pseudocode — actual detection mechanism depends on the
# environment's MCP introspection capability
if mcp_server_connected "$SERVER_NAME"; then
  MCP_AVAILABLE=true
fi
```

Suite-side, MCP detection is best-effort. The runtime manifest
tracks what was available at last verification; commands check
at invocation time and may report drift between manifest and
actual.

## Phase 2: present findings

```
=== Tools Setup ===
Project ecosystems detected: JavaScript (npm), Storybook (10.3.4)
Tools applicable to this project: 12
Tools skipped (ecosystem mismatch): 3 (maven, gradle, terraform)

=== Verification ===

REQUIRED tools:
  playwright       ✓ CLI v1.40.1, MCP available
  pixelmatch       ✗ NOT INSTALLED
                   Install: npm install --save-dev pixelmatch
  imagemagick      ✓ CLI v7.1.0
  biome            ✓ CLI v1.4.0
  npm              ✓ CLI v10.2.0
  context7         ✓ MCP available

OPTIONAL tools:
  chrome-devtools  ✓ MCP available
  chromatic        ✗ Not connected
                   Optional; visual regression via Chromatic
                   would be unavailable.
  open-pencil      ✗ Not installed
                   Optional; Pencil CLI fallback when MCP unavailable.
  pencil-mcp       ✓ MCP available
  figma            ✓ MCP available
  eslint           ✗ Not installed
                   Optional; biome is preferred but eslint
                   support exists.

Status:
  Required missing: 1 (pixelmatch)
  Optional missing: 3 (chromatic, open-pencil, eslint)
```

## Phase 3: install confirmation

For required missing:

```
=== Required tools to install ===
  pixelmatch    npm install --save-dev pixelmatch

Install required tools? [Y/n]
```

For optional missing:

```
=== Optional tools (recommended) ===
Install? [a]ll, [n]one, [s]elect:

If [s]elect:
  chromatic:    install? [y/N]
  open-pencil:  install? [y/N]
  eslint:       install? [y/N]
```

User confirms; setup runs the install commands sequentially.

## Phase 4: install execution

For each tool to install:

```bash
INSTALL_CMD=$(read_tool_field "$TOOL_NAME" "interfaces.cli.installCommand")
echo "Running: $INSTALL_CMD"
eval "$INSTALL_CMD"
```

After install, re-verify the tool. If verification still fails,
surface and continue (doesn't block other installs):

```
pixelmatch    Installing... ✓ Installed.
              Verifying... ✓ v5.3.0 detected.

chromatic     Installing... ✗ Failed.
              Manual install required. See:
              https://www.chromatic.com/docs/setup
```

## Phase 5: persist manifest

Build the tools manifest and write `product/.pencil-tools.json`:

```jsonc
{
  "version": 1,
  "lastUpdated": "<now>",
  "tools": {
    "playwright": {
      "version": "1.40.1",
      "category": "browser-automation",
      "interfaces": {
        "cli": {
          "available": true,
          "verifiedAt": "<now>",
          "executable": "npx playwright",
          "installCommand": "npm install --save-dev @playwright/test"
        },
        "mcp": {
          "available": true,
          "verifiedAt": "<now>",
          "serverName": "playwright",
          "toolPrefix": "mcp__playwright__"
        }
      },
      "preference": "mcp",
      "optional": false,
      "fallbackBehavior": null
    }
    // ... 14 more tools
  },
  "stalenessThresholds": {
    "verificationDays": 30
  }
}
```

If the file already existed, a backup at
`product/.pencil-tools.json.backup` is created before
overwriting.

## Phase 6: report

```
=== Setup Report ===

Tools verified:    14
Tools installed:   1 (pixelmatch)
Install failures:  0
Skipped:           3 (ecosystem mismatch — maven, gradle, terraform)
Optional skipped:  3 (user declined)

Manifest written: product/.pencil-tools.json

Required tools status: ✓ All required tools available
Optional tools status: ⚠ 3 optional tools not installed
                        (chromatic, open-pencil, eslint)

Next steps:
  - Run /core:tools:manifest to see current state
  - Run /core:tools:setup --check periodically to verify availability
  - Tool absence is fine — commands degrade gracefully where
    optional, fail clearly where required.
```

## `--refresh-required-by` mode

This is meta-tooling that scans all command files for tool
references and updates each tool's `Required by commands`
section.

### Detection logic

For each `.md` file in the suite (excluding `tools/` itself):

```bash
# Look for invocation patterns
grep -E "(npx playwright|mcp__playwright__|pixelmatch|convert |\
         npx biome|mvn |gradle |npm |terraform )" "$file"
```

Per match, identify the tool and add the file's qualified
command name (derived from path) to that tool's `requiredBy`
list.

### Update mechanism

For each tool, regenerate the "Required by commands" section
of its MD file based on the scan results. The section
header is `## Required by commands`; everything between that
header and the next section is replaced.

This is bookkeeping that keeps the registry honest about its
relationships. Run after substantial command additions or
refactors.

## What this command does NOT do

- **Modify project source code.** Install commands modify
  `package.json` (via `npm install`) but not source files.
- **Auto-install without confirmation.** Even with
  `--install-required`, the command logs what it's installing.
- **Manage MCP server lifecycle.** MCP servers are
  environment-managed. Setup detects whether they're connected;
  it doesn't start or configure them.
- **Replace per-tool init commands.** Some tools have their
  own setup steps (Playwright needs `npx playwright install`
  for browser binaries; Storybook has its own init). Setup
  notes these and either runs them or instructs the user.

## Examples

```bash
# First-time project setup
/core:tools:setup

# Verify only (no installs)
/core:tools:setup --check

# Install just playwright
/core:tools:setup playwright

# CI-friendly auto-install of required
/core:tools:setup --install-required

# Limit to one category
/core:tools:setup --scope browser-automation

# Refresh registry's required-by relationships
/core:tools:setup --refresh-required-by
```

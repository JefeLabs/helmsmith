---
description: Query or manage the tools runtime manifest. Show current state, query specific fields via jq path, mark tools as optional, handle multi-environment cases. Read-only by default; mutations require explicit flags.
argument-hint: [--query <jq-path>] [--mark-optional <tool>] [--mark-required <tool>]
allowed-tools: Read, Write, Edit, Bash
---

Query or manage the tools runtime manifest at
`product/.pencil-tools.json`. Read-only by default;
`--mark-optional` and `--mark-required` flags trigger
mutations.

## Phase 0: discovery

Read `product/.pencil-tools.json`. If missing:

> No tools manifest exists. Run `/core:tools:setup` to create one.

In query mode with missing manifest, returns null/empty per
the queried path.

## Modes

### Default — show current state

```bash
/core:tools:manifest
```

Renders the manifest in human-readable form, grouped by
category, with availability and freshness:

```
=== Tools ===
Last updated: 2026-05-03T16:30:00Z

BROWSER AUTOMATION:
  playwright (required)         ✓ CLI v1.40.1, MCP available
                                Verified: 2026-05-03 (today)
                                Required by: 8 commands

  chrome-devtools (optional)    ✓ MCP available
                                Verified: 2026-05-03 (today)

VISUAL REGRESSION:
  pixelmatch (required)         ✓ CLI v5.3.0
                                Verified: 2026-05-03 (today)
                                Required by: 3 commands

  chromatic (optional)          ✗ Not available
                                Optional; would enable Chromatic
                                cloud visual regression.

IMAGE PROCESSING:
  imagemagick (optional)        ✓ CLI v7.1.0
                                Verified: 2026-05-03 (today)
                                Used for color-match loops in
                                migration verification.

DESIGN:
  open-pencil (optional)        ✗ Not installed
  pencil-mcp (optional)         ✓ MCP available
  figma (optional)              ✓ MCP available

CODE QUALITY:
  biome (required)              ✓ CLI v1.4.0
  eslint (optional)             ✗ Not installed

BUILD ECOSYSTEM:
  npm (required)                ✓ CLI v10.2.0
  maven (ecosystem-specific)    — skipped (no Maven detected)
  gradle (ecosystem-specific)   — skipped (no Gradle detected)
  terraform (ecosystem-specific) — skipped (no .tf files)

REFERENCE:
  context7 (optional)           ✓ MCP available

Status: All required tools available.
        4 optional tools missing.
        3 ecosystem-specific tools skipped.

Verification age: All tools verified within last 24 hours.
```

When verification timestamps approach the staleness threshold:

```
playwright (required)            ✓ CLI v1.40.1
                                 Verified: 2026-04-01 (32 days ago) ⚠ stale
                                 Run /core:tools:setup --check to re-verify.
```

### Query mode — `--query <jq-path>`

Read specific fields via jq:

```bash
/core:tools:manifest --query "tools.playwright.interfaces.cli.available"
# → true

/core:tools:manifest --query "tools.playwright.interfaces.mcp.serverName"
# → "playwright"

/core:tools:manifest --query "tools | keys"
# → ["biome", "chromatic", "chrome-devtools", ...]

/core:tools:manifest --query "tools | to_entries | map(select(.value.optional == false and (.value.interfaces.cli.available == false))) | length"
# → 0  (count of required tools that are missing)

/core:tools:manifest --query "tools.playwright.requiredBy"
# → ["engineer:maintenance:remediation:component-dedup", ...]
```

The query is passed directly to `jq`. Standard jq syntax
applies.

### Mark optional — `--mark-optional <tool>`

Override a tool's classification — mark a normally-required
tool as optional for this project. Useful when the project
genuinely doesn't need a tool the suite considers required:

```bash
/core:tools:manifest --mark-optional chromatic
```

Effect:
- Sets `tools.<name>.optional` to `true` in the manifest
- Updates `lastUpdated` to now
- Reports cross-command implications: which commands now
  degrade gracefully vs fail when this tool is absent

```
=== Mark Optional Confirmation ===

Tool:        chromatic
Currently:   required
Suite default classification: optional

Marking optional means commands that use chromatic will skip
related steps when chromatic is absent rather than failing.

Affected commands:
  - frameworks:storybook:chromatic (degrades to "no chromatic
    integration available")
  - engineer:maintenance:remediation:component-dedup (skips
    chromatic baseline check)

Confirm? [y/N]
```

### Mark required — `--mark-required <tool>`

Inverse of mark-optional. Force a normally-optional tool to
be required for this project:

```bash
/core:tools:manifest --mark-required imagemagick
```

Effect:
- Sets `tools.<name>.optional` to `false`
- Updates `lastUpdated` to now
- Reports: "Commands that use imagemagick will now fail when
  it's absent rather than skipping."

Useful when the project's processes genuinely depend on a
tool the suite considers optional.

## Cross-namespace integration

Suite commands query this manifest as part of their pre-flight
checks. The query mode is for cases where the calling command
wants formatted output rather than raw JSON parsing.

External SKILL.md files use the same manifest to verify their
declared tool dependencies. The query mode is the entry point
for that integration.

## Staleness reporting

The default show mode flags any verification approaching the
staleness threshold (default 30 days):

- **Stale** (verification > 30 days ago): visible warning (⚠)
  with suggested action `/core:tools:setup --check`

The threshold is read from the manifest's
`stalenessThresholds.verificationDays`; defaults apply when
absent.

## What this command does NOT do

- **Install or remove tools.** That's `/core:tools:setup`'s job.
- **Detect new tools.** Detection happens in `/core:tools:setup`
  during verification.
- **Modify the registry.** Tool definitions live in `tools/`
  MD files. This command only modifies the runtime manifest.
- **Re-verify availability.** It reads the cached state.
  Re-verification requires `/core:tools:setup --check`.

## Examples

```bash
# Show all tool state
/core:tools:manifest

# Quick check: is playwright MCP available?
/core:tools:manifest --query "tools.playwright.interfaces.mcp.available"

# Find which commands depend on imagemagick
/core:tools:manifest --query "tools.imagemagick.requiredBy"

# Mark a tool optional for this project
/core:tools:manifest --mark-optional chromatic

# List required tools that are currently missing
/core:tools:manifest --query "tools | to_entries | map(select(.value.optional == false and (.value.interfaces.cli.available == false))) | map(.key)"
```

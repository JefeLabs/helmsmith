---
description: Add a new tool definition to the registry. Walks through metadata fields (interfaces, install command, version constraint, category, optional flag, fallback behavior) and creates the tool's MD file under tools/. Used when building new commands that depend on previously-uncatalogued tools.
argument-hint: <tool-name> [--cli] [--mcp] [--cli-and-mcp] [--ecosystem-specific <name>]
allowed-tools: Read, Write, Edit, Bash
---

Add a new tool definition to the suite's tools registry. This
is meta-tooling — used when building new commands that need
tools the suite doesn't currently catalog.

The output is a new file at `tools/<tool-name>.md` matching
the dual-purpose pattern: command body for `/core:tools:<tool>`
direct invocation + registry definition for setup/manifest
consumption.

## Phase 0: discovery

1. Verify `<tool-name>` doesn't already exist as a tool file.
2. Read `tools/_scaffold.md` for the template.
3. Read `tools/_context.md` for current naming conventions
   and registered categories.

## Phase 1: gather metadata

Walk through fields interactively:

### Tool name validation

```
Tool name: <provided>

Validation:
  ✓ Lowercase
  ✓ Hyphens-only (no underscores or spaces)
  ✓ Not already in registry
  ✓ Doesn't conflict with reserved names (setup, manifest,
    declare, _scaffold)
```

If validation fails, abort with the specific issue.

### Display name

```
Display name (human-readable): [defaults to tool-name with
                               first letter capitalized]
```

### Category

```
Category:
  [1] browser-automation     (e.g., playwright, puppeteer)
  [2] browser-inspection     (e.g., chrome-devtools)
  [3] visual-regression      (e.g., pixelmatch, chromatic)
  [4] image-processing       (e.g., imagemagick, sharp)
  [5] design                 (e.g., open-pencil, figma, pencil-mcp)
  [6] code-quality           (e.g., biome, eslint, prettier)
  [7] build-ecosystem        (e.g., npm, maven, gradle)
  [8] infrastructure         (e.g., terraform, pulumi)
  [9] reference              (e.g., context7)
  [10] other                 (specify)

Choice:
```

If "other," prompt for a custom category name and offer to
add it to the schema's enum (requires schema update).

### Interfaces

```
Available interfaces:
  [c] CLI only
  [m] MCP only
  [b] Both CLI and MCP

Choice:
```

Per interface, gather:

#### CLI interface details

```
CLI executable (how to invoke from terminal):
  [examples: 'npx playwright', 'convert', 'mvn']
  >

Install command:
  [examples: 'npm install --save-dev pixelmatch',
             'brew install imagemagick']
  >

Verification command (how to check it's installed):
  [examples: 'npx playwright --version',
             'convert --version']
  >

Platform support:
  [a] All platforms (macos, linux, windows)
  [s] Specific platforms
  >
```

#### MCP interface details

```
MCP server name:
  [the name used in mcp__<name>__* tool prefixes]
  >

Tool prefix:
  [auto-derived from server name as 'mcp__<name>__']
  > [confirm or override]
```

### Version constraint

```
Version constraint (semver-style):
  [examples: '^1.40.0', '>=7.0.0', null if not tracked]
  >
```

### Optional / required

```
Required or optional?
  [r] Required (commands fail without it)
  [o] Optional (commands degrade gracefully when absent)

Choice:
```

If optional, gather fallback behavior:

```
Fallback behavior (what happens when this tool is missing):
  [examples: 'color-match-loop-skipped',
             'design-layer-lint-skipped',
             'visual-regression-disabled']
  >
```

### Ecosystem specificity

```
Is this tool only relevant for specific project ecosystems?
  [n] No (relevant for all projects)
  [y] Yes (specify which ecosystem)

If yes:
  Ecosystem identifier:
    [examples: 'java-maven', 'java-gradle', 'terraform',
               'storybook']
    >
```

### Preference (for tools with both CLI and MCP)

```
Default interface preference:
  [c] cli — always use CLI even if MCP available
  [m] mcp — prefer MCP, fall back to CLI
  [a] auto — command picks per-task

Choice:
```

### Direct-invocation prompt interpretation depth

```
How rich should /core:tools:<tool-name> direct invocation be?
  [t] Thin — wrapper that interprets simple prompts and
            invokes the tool with appropriate args
  [m] Medium — interprets common prompts; handles a few
              workflow patterns
  [r] Rich — substantial prompt-to-operation translation;
            handles complex workflow patterns

Choice (affects how detailed the command body section is):
```

## Phase 2: generate the tool file

Build the file from template, populating fields collected:

```markdown
---
description: <generated from category and interface info>
argument-hint: <free-form-prompt> [--cli-only] [--mcp-only]
allowed-tools: Read, Write, Edit, Bash<, mcp__<name>__* if MCP>
---

# Tools — <Display Name>

Direct invocation of <Display Name> for <category-flavored
description>. Useful when:
- You want a one-off task that doesn't fit an existing
  skillz command
- You're composing custom workflows
- You want to experiment with the tool's capabilities

This command is a <thin/medium/rich> wrapper that interprets
your prompt and invokes the underlying tool.

## Phase 0: discovery

1. Read `product/.pencil-tools.json`. If <tool-name> isn't
   available, surface and offer to run `/core:tools:setup
   <tool-name>`.
2. Determine which interface to use:
   - If `--mcp-only`: require MCP available; fail if not
   - If `--cli-only`: use CLI even if MCP available
   - Otherwise: per the preference (<preference>)

## Phase 1: prompt interpretation

[Per the interpretation depth chosen, generate skeleton
sections for common patterns. The user can refine these later.]

## Phase 2: execution

[Skeleton invocation logic per interface]

## Phase 3: result reporting

Report results back to the user.

## Cross-references

[Skeleton — user fills in cross-references to skillz commands
that wrap this tool]

---

# Registry definition

> The structured frontmatter and sections below are read by
> `/core:tools:setup` and `/core:tools:manifest`.

## Tool metadata

```yaml
name: <tool-name>
displayName: <display-name>
category: <category>
version: <version-or-null>
optional: <true|false>
ecosystemSpecific: <ecosystem-or-null>
```

## Interfaces

### CLI

[If applicable, per gathered details]

### MCP

[If applicable, per gathered details]

## Preference

<preference>

## Required by skillz commands

<empty initially; populated by /core:tools:setup --refresh-required-by>

## Fallback behavior

<fallback or "Required for [list of dependent commands]. If
absent, those commands fail with a clear install instruction.">

## Cross-tool dependencies

<empty initially; user fills in if applicable>
```

## Phase 3: persist

Write `tools/<tool-name>.md`. Update `tools/_index.md` to
include the new tool in the appropriate category section.

If the schema needs updating (new category enum value), surface
to the user:

```
Note: Category 'custom-category' was added. The schema at
.product-tools-schema.json should be updated to include this
in the category enum.

Apply schema update? [Y/n]
```

## Phase 4: report

```
=== Tool Declared ===

Tool:        <tool-name>
File:        tools/<tool-name>.md
Category:    <category>
Interfaces:  <cli|mcp|both>
Optional:    <true|false>

Next steps:
  - Review and fill in the prompt-interpretation logic in
    tools/<tool-name>.md (Phase 1: prompt interpretation)
  - If applicable, document cross-references to skillz commands
    that wrap this tool
  - Run /core:tools:setup <tool-name> to install/verify and update
    the runtime manifest
  - When commands that use this tool exist, run
    /core:tools:setup --refresh-required-by to populate the
    required-by relationships
```

## What this command does NOT do

- **Install the tool.** That's `/core:tools:setup`'s job.
- **Generate working command body logic.** The Phase 1 prompt
  interpretation section is a skeleton; the user fills in
  tool-specific logic.
- **Auto-detect existing tool usage in the suite.** The
  `requiredBy` list starts empty; populated by
  `/core:tools:setup --refresh-required-by` after commands using
  the tool exist.
- **Modify other tool files.** Each declaration is
  self-contained.

## Examples

```bash
# Declare a new CLI-only tool
/core:tools:declare prettier

# Declare a tool with both CLI and MCP
/core:tools:declare puppeteer --cli-and-mcp

# Declare an ecosystem-specific tool
/core:tools:declare cargo --ecosystem-specific rust
```

---
description: Pencil's MCP server for structured design data access — components, styles, frames, layout boxes, design tokens. MCP-only (no CLI for structured data; that's what the MCP exists for). Heavily consumed by /product:design/ commands for cross-checking implementations against design specs.
argument-hint: <free-form-prompt> [--file <name>] [--component <name>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Direct invocation of Pencil's MCP server for structured
queries against Pencil design files. The data-layer companion
to `/tools:open-pencil` (which opens the UI).

## Phase 0: pre-flight

1. Verify pencil-mcp active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools."pencil-mcp".active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Pencil MCP not active. Run /tools:setup pencil-mcp"
     exit 1
   fi
   ```

2. Verify MCP server connectivity:

   ```bash
   if ! mcp_tool_available "mcp__pencil__list_files"; then
     echo "Pencil MCP server not connected in this session"
     echo ""
     echo "MCP server configuration depends on environment:"
     echo "  - claude-code: configure in ~/.claude/projects/<project>/mcp_config.json"
     echo "  - opencode: configure in opencode settings"
     echo "  - other: see your environment's MCP config"
     exit 1
   fi
   ```

3. Read manifest's project-default file references:

   ```bash
   DEFAULT_FILE=$(jq -r '.files.default // empty' \
                       product/.pencil-pencil.json 2>/dev/null)
   ```

## Phase 1: prompt interpretation

Operations Pencil MCP typically exposes:

### File operations

- **List files** — Pencil files known to the MCP server
- **Open file** — load a specific file's data into MCP context
- **File metadata** — last modified, size, page count

### Component operations

- **List components** — components defined in the file
- **Component details** — props, variants, used-in references
- **Component spec** — full structured spec (sizes, states,
  variants)

### Style operations

- **List styles** — typography, fill, effect, stroke styles
- **List variables** — design tokens (colors, spacing, sizing)
- **Variable resolution** — resolve a variable to its concrete
  value(s) across modes

### Layout operations

- **Frame inventory** — pages and frames in the file
- **Layout boxes** — bounding boxes, grids, padding for frames
- **Spacing tokens** — spacing values used across frames

### Cross-reference operations

- **Where used** — find all instances of a component or style
- **Consistency check** — find places where similar components
  exist as separate items (potential dedup candidates)

The exact operation surface depends on which Pencil MCP
implementation is connected. The integration adapts to what's
exposed.

## Phase 2: execution

All operations route through MCP tools:

```
Operation: "list components in our design system file"
  → mcp__pencil__list_components
    args: file_id (resolved from manifest's default or prompt)

Operation: "what's the spec for the Button component"
  → mcp__pencil__get_component
    args: file_id, component_name: "Button"
  → returns: variants, props, sizes, states, exported
    instances

Operation: "find places using #3F51B5 hex color"
  → mcp__pencil__find_uses_of_color
    args: file_id, color: "#3F51B5"

Operation: "show me design tokens defined in this file"
  → mcp__pencil__list_variables
    args: file_id, types: [color, spacing, typography]
```

When the MCP server returns large result sets (full design
system inventory might have hundreds of components), the
integration paginates or summarizes:

```bash
# If result count high, summarize
RESULT_COUNT=$(echo "$MCP_RESPONSE" | jq '.components | length')

if [ "$RESULT_COUNT" -gt 30 ]; then
  # Surface counts by category, then offer to drill in
  CATEGORIES=$(echo "$MCP_RESPONSE" | jq -r '.components | group_by(.category) | map({key: .[0].category, count: length})')
  echo "Many components ($RESULT_COUNT). Summary by category:"
  echo "$CATEGORIES"
fi
```

## Phase 3: result formatting

### Component listing

```
=== Pencil: SkoolScout Design System ===
File:    skoolscout-design-system.pencil
Components by category:

  Atoms (15):
    Button — 8 variants (size × intent × state)
      Used in: 42 instances across 8 frames
    Input — 4 variants
      Used in: 18 instances
    Avatar — 6 variants
      Used in: 12 instances
    ... (12 more)
  
  Molecules (24):
    SearchBar
    UserMenu
    NotificationCard
    ... (21 more)
  
  Organisms (8):
    NavBar
    DashboardHeader
    ... (6 more)

Total: 47 components
Total instances: 234
```

### Component spec

```
=== Pencil Component: Button ===
File:        skoolscout-design-system.pencil
Variants:    8

Props:
  size:    sm | md | lg
  intent:  primary | secondary | ghost | danger
  loading: true | false
  iconLeft:  optional ComponentRef
  iconRight: optional ComponentRef

States (per variant):
  default | hover | active | focus | disabled | loading

Sizes (per size variant):
  sm: height 32px, padding 8px 12px, font-size 14px
  md: height 40px, padding 12px 16px, font-size 14px
  lg: height 48px, padding 16px 20px, font-size 16px

Used in: 42 instances across 8 frames
  - dashboard-header (4 instances)
  - login-form (1 instance)
  - settings-page (8 instances)
  ... (5 more frames)

Cross-references:
  Uses: Icon (component), text styles (display-sm, body-md)
  Used by: Modal (footer actions), Card (CTA), Toast (action)
```

### Variable resolution

```
=== Pencil Variables: Color Tokens ===
File: skoolscout-design-system.pencil

primary:
  light mode: #3F51B5
  dark mode:  #5C6BC0
  
primary-foreground:
  light mode: #FFFFFF
  dark mode:  #FFFFFF

surface:
  light mode: #FFFFFF
  dark mode:  #1A1A1A

text:
  light mode: #1A1A1A
  dark mode:  #F5F5F5

[42 more color tokens]
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| MCP tool not available | Server not connected | Configure MCP in your environment; restart |
| File not found | File ID/name wrong | Run `mcp__pencil__list_files` to see available; verify name |
| Component not found | Component name wrong | List components first; verify spelling and scope |
| Stale data | MCP cache outdated | Some MCPs cache; force refresh if option available |

## Cross-namespace integration

This tool is consumed by:

- **`product/design/design-page`** — fetch component specs when
  generating page layouts
- **`product/design/foundations/*`** — query design tokens,
  styles, variables to check foundations are codified
- **`frameworks/heroui:build-components`** — fetch component
  specs from Pencil to drive HeroUI component generation
- **`product/strategy/audit`** Plane 1 (visual audit) — compare
  implementation against Pencil source-of-truth
- **`engineer/maintenance/remediation/atomic-design`** — verify
  taxonomy matches design system structure

Pencil MCP is the structured-data side; `/tools:open-pencil`
is the UI side. Workflows often compose both.

## What this tool does NOT do

- **Open the Pencil app.** Use `/tools:open-pencil`.
- **Edit Pencil files.** Most Pencil MCPs are read-only or
  have limited write surface. Editing happens in the Pencil
  UI.
- **Convert Pencil files.** Pencil's own export features
  handle this; not exposed via this tool.
- **Replace `/integrations:figma`.** If your team uses Figma,
  use `/integrations:figma`. Pencil and Figma are alternatives;
  most teams use one or the other.

## Examples

```bash
# List components in the configured default file
/tools:pencil-mcp "list components"

# Specific component spec
/tools:pencil-mcp "show me the Button component spec"

# Design tokens
/tools:pencil-mcp "list color tokens defined in our design system"

# Cross-references
/tools:pencil-mcp "where is the SearchBar component used"

# Specific file (overriding default)
/tools:pencil-mcp --file marketing-site.pencil "list pages"
```

---

# Registry definition

## Tool metadata

```yaml
name: pencil-mcp
displayName: Pencil MCP
provider: pencil-app
category: design-data-access
optional: true   # only required when project uses Pencil
```

## Interfaces

### CLI

**Not available.** Pencil doesn't expose a structured-query
CLI; the MCP server is the canonical structured-data interface.

For UI launching, see `/tools:open-pencil`.

### MCP

```yaml
serverName: pencil
toolPrefix: mcp__pencil__
authMethod: server-managed
notes: |
  Pencil's MCP server (multiple implementations may exist —
  official from Pencil team, community options).
  Configuration depends on environment. The MCP server
  typically requires Pencil to be running OR access to
  Pencil files on disk; check your MCP server's documentation.
```

## Tool catalog

The exact operations exposed depend on the MCP server
implementation. Common operations expected:

- `list_files` — Pencil files available
- `list_components` — components in a file
- `get_component` — full component spec
- `list_styles` — typography, fill, effect, stroke styles
- `list_variables` — design tokens
- `get_variable` — variable details with mode resolutions
- `list_frames` — frames/pages
- `get_frame` — frame layout details
- `find_uses` — cross-references for components/styles/variables

## Required by skillz commands

Auto-populated. Currently:
- /product:design:design-page
- /product:design:foundations (multiple sub-commands)
- /frameworks:heroui:build-components
- /product:strategy:audit (Plane 1)

## Cross-tool dependencies

- Pencil app or Pencil file access (depends on MCP server
  implementation)
- /tools:open-pencil (sister tool for UI launching)

## System requirements

- MCP server connectivity in your environment
- Pencil files accessible to the MCP server

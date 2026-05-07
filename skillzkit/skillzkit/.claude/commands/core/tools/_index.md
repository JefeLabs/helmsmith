# Tools — Index

Decision tree across the 15 tool data-plane commands plus the
three control-plane commands.

## Setting up

```
First time on this project?
└── /core:tools:setup                        # detect, prompt, install all needed tools

Specific tool only?
└── /core:tools:setup <tool>                 # install/verify just that tool

Verify without installing?
└── /core:tools:setup --check                # availability check only

Inspect current state?
└── /core:tools:manifest                     # show all tool availability
```

## Direct tool invocation by category

### Browser automation

| When you need to... | Command |
|---------------------|---------|
| Screenshot, interact, query a web page | `/core:tools:playwright "<prompt>"` |
| Inspect loaded fonts, network requests, computed styles | `/core:tools:chrome-devtools "<prompt>"` |

For Storybook-specific browser tasks, prefer
`/core:frameworks:storybook:verify:*` commands which know about
story IDs, viewport conventions, and Storybook's iframe
patterns.

### Visual regression and image work

| When you need to... | Command |
|---------------------|---------|
| Diff two images and report differences | `/core:tools:pixelmatch "<prompt>"` |
| Compare/resize/transform images | `/core:tools:imagemagick "<prompt>"` |
| Visual regression via Chromatic cloud | `/core:tools:chromatic "<prompt>"` |

For component-level visual regression in maintenance routines,
prefer `/engineer:maintenance:remediation:component-dedup` which
orchestrates pixelmatch within a structured 3-retry budget.

### Design

| When you need to... | Command |
|---------------------|---------|
| CLI operations on .pen files | `/core:tools:open-pencil "<prompt>"` |
| MCP-based design queries (Pencil) | `/core:tools:pencil-mcp "<prompt>"` |
| Query Figma designs via MCP | `/core:tools:figma "<prompt>"` |

For structured design workflows (designing pages, generating
components from Pencil specs), prefer `/product:design:*`
commands.

### Code quality

| When you need to... | Command |
|---------------------|---------|
| Lint with Biome | `/core:tools:biome "<prompt>"` |
| Lint with ESLint | `/core:tools:eslint "<prompt>"` |

For project-wide lint remediation, prefer
`/engineer:maintenance:remediation:biome-issues`.

### Build / ecosystem

| When you need to... | Command |
|---------------------|---------|
| Run Maven commands | `/core:tools:maven "<prompt>"` |
| Run Gradle commands | `/core:tools:gradle "<prompt>"` |
| Run npm/pnpm/yarn commands | `/core:tools:npm "<prompt>"` |
| Run Terraform commands | `/core:tools:terraform "<prompt>"` |

For dependency upgrades, prefer the structured commands:
`/engineer:maintenance:upgrades:maven-deps`,
`/engineer:maintenance:upgrades:gradle-deps`,
`/engineer:maintenance:upgrades:npm-deps`,
`/engineer:maintenance:upgrades:infra-deps`.

### Reference

| When you need to... | Command |
|---------------------|---------|
| Look up library docs / migration guides | `/core:tools:context7 "<prompt>"` |

## Adding a new tool

When the suite (or your project) needs a tool not currently
catalogued:

```bash
/core:tools:declare <tool-name>
```

Walks through the metadata fields and creates the tool's MD
file under `tools/`. Updates the registry index.

## Checking what depends on a tool

```bash
/core:tools:manifest --query "tools.playwright.requiredBy"
```

Returns the list of suite commands that depend on this tool.
Useful when considering removing or replacing a tool: surfaces
what would break.

## Tool absence patterns

Different tools handle absence differently per their
`optional` and `fallbackBehavior` settings:

- **Required tools (e.g., playwright for storybook commands)**
  — commands fail fast with install instructions
- **Optional tools with graceful degradation (e.g., imagemagick
  in migration:verify color loop)** — commands skip the
  affected step and surface the gap; the rest proceeds
- **Optional tools with explicit alternates (e.g., open-pencil
  CLI alternative to pencil MCP)** — commands switch to the
  available alternate

The `/core:tools:manifest` output shows each tool's optional/required
status and fallback behavior so users know what's at risk if a
tool is missing.

# Tools — Grouping Context

> User-facing tool capabilities. Read this when working with
> `tools/` namespace or building commands that depend on
> external tools.
>
> The tools namespace serves two purposes simultaneously:
> direct user invocation of tools with custom prompts, AND a
> registry of tool dependencies that suite commands and external
> SKILL.md files consume.

## What `tools/` contains

```
tools/
├── _context.md                  (this file)
├── _index.md                    decision tree across tools
│
├── setup.md                     install/verify tools (control plane)
├── manifest.md                  query/manage tools manifest (control plane)
├── declare.md                   add new tool to registry (control plane)
│
├── playwright.md                /tools:playwright (data plane + registry def)
├── pixelmatch.md                /tools:pixelmatch
├── imagemagick.md               /tools:imagemagick
├── chrome-devtools.md           /tools:chrome-devtools
├── chromatic.md                 /tools:chromatic
├── open-pencil.md               /tools:open-pencil
├── pencil-mcp.md                /tools:pencil-mcp (the MCP, distinct from CLI)
├── figma.md                     /tools:figma
├── biome.md                     /tools:biome
├── eslint.md                    /tools:eslint
├── maven.md                     /tools:maven
├── gradle.md                    /tools:gradle
├── npm.md                       /tools:npm (covers npm/pnpm/yarn detection)
├── terraform.md                 /tools:terraform
├── context7.md                  /tools:context7
│
├── _scaffold.md                 template for new tool definitions
└── _registry/                   (deprecated — dual-purpose files at top level)
```

15 tools currently defined. Three control-plane commands plus
one tool file per supported tool.

## What is and is NOT a tool

The tools registry tracks **discrete capability invocations** —
CLIs and MCPs that take input → produce output, that suite
commands invoke as building blocks, and that users can invoke
directly with custom prompts.

### In scope (registered as tools)

- **Discrete CLI invocations** that produce output: `npx
  playwright screenshot`, `npx pixelmatch a.png b.png diff.png`,
  `convert input.jpg -resize 50% output.jpg`
- **MCP servers** that expose tool prefixes for one-shot calls:
  `mcp__playwright__*`, `mcp__chrome-devtools__*`,
  `mcp__pencil__*`, `mcp__figma__*`, `mcp__context7__*`
- **Build/ecosystem CLIs** the suite invokes in structured
  flows: `mvn`, `gradle`, `npm`/`pnpm`/`yarn`, `terraform`
- **Code quality CLIs**: `biome`, `eslint`

### Out of scope (NOT tools)

**TUI environments / agentic coding tools**:
- `claude-code`, `opencode`, `copilot` (CLI), `gemini` CLI
  agent mode, `cursor-agent`, `aider`

These aren't tools — they're **environments**. When you run
`claude` in a terminal, you don't get a single-shot operation;
you get a TUI where you have a multi-turn conversation with an
agent. The suite runs INSIDE these environments; it doesn't
INVOKE them. Treating them as `/tools:claude-code "<prompt>"`
would be like treating `vim` as a tool — semantically wrong.

**Development services / processes**:
- Storybook (the dev server) — this is process management
  ("run `npm run storybook`"); the tools registry tracks
  invokable capabilities, not processes you start
- LocalStack — same shape; project state in
  `.pencil-frameworks.json` or relevant project config

The runtime manifests for these (`.pencil-storybook.json`)
already track how to start and configure them. The tools
registry doesn't duplicate that.

**SDKs and libraries**:
- Anthropic Claude SDK (`@anthropic-ai/sdk`)
- GitHub Copilot SDK
- LangGraph.js, LangSmith
- Embabel STRIPS planner
- React, Vue, Spring Boot frameworks consumed as libraries

These are **embedded in code**, not invoked from a terminal or
through a tool prefix. Their value is at the program-construction
layer, not the runtime-invocation layer. SDK choices that shape
how commands are implemented belong as ADRs in
`engineer/architecture/decisions/`, not as tool registry entries.

## The dual-purpose tool file pattern

Each tool file under `tools/` serves two purposes simultaneously:

### 1. Direct-invocation slash command

When invoked as `/tools:<tool>`, the file is the slash command.
It takes a free-form prompt, interprets the user's intent, and
routes to the underlying tool with appropriate arguments. Useful
for:

- One-off browser tasks that don't fit existing skillz commands
- Custom workflows composing tool invocations
- Experimenting with a tool's capabilities
- Quick verification or exploration

### 2. Registry definition

The frontmatter and structured sections of the file describe
the tool's metadata: interfaces (CLI / MCP / both), version
requirements, install commands, required-by relationships,
fallback behavior. Read by `/tools:setup` and `/tools:manifest`
to understand the tool.

This is single source of truth per tool. Command body and
registry definition coexist in one file.

## Invocation interfaces per tool

Most tools support one or both of:

- **CLI** — invokable from a terminal as a command (`npx
  playwright`, `convert`, `mvn`)
- **MCP** — invokable through an MCP tool prefix
  (`mcp__playwright__*`)

Some tools have only one interface (pixelmatch is CLI-only;
context7 is MCP-only). Tools with both interfaces document a
**preference** for which the slash command uses by default:

- `mcp` — prefer MCP when available, fall back to CLI
- `cli` — always use CLI even if MCP available
- `auto` — command picks per-task; MCP for richer needs (DOM
  queries, JS evaluation), CLI for simple operations

The user can override per-invocation with flags
(`--cli-only` / `--mcp-only`).

## Runtime manifest

Tool availability is captured in `product/.pencil-tools.json`:

```jsonc
{
  "version": 1,
  "lastUpdated": "<ISO timestamp>",

  "tools": {
    "playwright": {
      "version": "^1.40.0",
      "interfaces": {
        "cli": {
          "available": true,
          "verifiedAt": "<ISO timestamp>",
          "executable": "npx playwright",
          "installCommand": "npm install --save-dev @playwright/test"
        },
        "mcp": {
          "available": true,
          "verifiedAt": "<ISO timestamp>",
          "serverName": "playwright",
          "toolPrefix": "mcp__playwright__"
        }
      },
      "preference": "mcp"
    },
    "pixelmatch": {
      "version": "^5.3.0",
      "interfaces": {
        "cli": {
          "available": false,
          "verifiedAt": "<ISO timestamp>",
          "executable": "npx pixelmatch",
          "installCommand": "npm install --save-dev pixelmatch"
        }
      },
      "preference": "cli",
      "optional": false,
      "fallbackBehavior": null
    }
    // ...
  },

  "stalenessThresholds": {
    "verificationDays": 30
  }
}
```

Schema: `.product-tools-schema.json` at suite root.

## How suite commands consume the registry

Commands that invoke tools follow this pattern in pre-flight:

```bash
# Pre-flight in any command that needs a tool
TOOL_NAME="playwright"

# Quick check via /tools:manifest
AVAILABLE=$(jq -r ".tools.${TOOL_NAME}.interfaces.cli.available // false" \
                 product/.pencil-tools.json 2>/dev/null)

if [ "$AVAILABLE" != "true" ]; then
  echo "Tool '${TOOL_NAME}' is not available."
  echo "Run /tools:setup ${TOOL_NAME} to install."
  exit 1
fi

# Then invoke the tool
EXEC=$(jq -r ".tools.${TOOL_NAME}.interfaces.cli.executable" \
            product/.pencil-tools.json)
$EXEC <args>
```

For tools with both CLI and MCP interfaces, the command picks
per the preference:

```bash
PREFERENCE=$(jq -r ".tools.playwright.preference" product/.pencil-tools.json)
if [ "$PREFERENCE" = "mcp" ] && [ "$MCP_AVAILABLE" = "true" ]; then
  # use mcp__playwright__* tools
else
  # use npx playwright CLI
fi
```

The verbosity is one reason commands generally invoke tools
inline (`npx playwright screenshot ...`) and rely on
`/tools:setup` having ensured availability. Pre-flight checks
are for commands where tool absence should fail fast with a
helpful message rather than producing cryptic errors.

## How external SKILL.md files consume the registry

External SKILL.md files (in `/mnt/skills/...` or wherever)
declare their tool dependencies in frontmatter:

```yaml
---
name: my-custom-skill
requiredTools:
  - playwright
  - pixelmatch
optionalTools:
  - imagemagick
---
```

A skill harness reads this and:
1. Reads `product/.pencil-tools.json`
2. For each `requiredTools`, verifies availability
3. For missing tools: prompts to run `/tools:setup <tool>` or
   surfaces an actionable error
4. For each `optionalTools`, surfaces availability without
   blocking

This pattern lets external skills declare what they need
without re-implementing tool detection. The tools registry is
the canonical source.

## Project-local tool extensions

Projects can extend the registry with their own tools at
`design/tools/_registry/`. The runtime manifest at
`.pencil-tools.json` aggregates suite-shipped tools and
project-local extensions.

Extension format matches `_scaffold.md` (the template). A
project that uses a tool the suite doesn't catalog (e.g., a
custom internal CLI) declares it locally; their local
commands and skills can consume the same machinery.

## Staleness discipline

Tool availability can drift over time:

- Tool was installed; later removed
- Tool was missing; later installed
- Tool's version is upgraded
- MCP server connectivity changes between sessions

Each interface entry carries `verifiedAt` for when availability
was last checked. The default staleness threshold is 30 days
(configurable in `stalenessThresholds.verificationDays`).

When a tool's verification is stale, `/tools:setup` re-checks.
When a tool is invoked and verification is stale, the command
should re-check before proceeding (or rely on the user having
run setup recently).

The staleness model is simpler than the framework manifest's
three-timestamp model because tools don't have an analog of
"user reviewed and confirmed activation" — tools are either
available or not, regardless of user opinion. One timestamp
suffices.

## Three control-plane commands

### `/tools:setup`

Install or verify tools. The setup-time entry point. Reads the
registry, checks each tool's availability, prompts to install
missing ones, updates the manifest. See `tools/setup.md`.

### `/tools:manifest`

Query or manage the runtime manifest. Show current state,
query specific fields via jq, mark tools optional, handle
multi-environment cases. See `tools/manifest.md`.

### `/tools:declare`

Add a new tool definition to the registry. Walks through
metadata fields and creates the tool's MD file. Used when
building new commands that need previously-uncatalogued tools.
See `tools/declare.md`.

## 15 tool data-plane commands

Each tool has a data-plane command that's both a slash
invocation surface and a registry definition. The 15 currently
defined:

| Tool | Category | Interfaces |
|------|----------|------------|
| playwright | browser-automation | CLI, MCP |
| chrome-devtools | browser-inspection | MCP |
| pixelmatch | visual-regression | CLI |
| imagemagick | image-processing | CLI |
| chromatic | visual-regression | CLI |
| open-pencil | design | CLI |
| pencil-mcp | design | MCP |
| figma | design | MCP |
| biome | code-quality | CLI |
| eslint | code-quality | CLI |
| maven | build-ecosystem | CLI |
| gradle | build-ecosystem | CLI |
| npm | build-ecosystem | CLI |
| terraform | infrastructure | CLI |
| context7 | reference | MCP |

Categories help `/tools:setup` group tools during reporting
and let projects filter by category (e.g., a backend-only
project might skip browser-automation and visual-regression
categories).

## Why tools is a top-level grouping (not under `core/`)

Earlier framings put tools under `core/` as "infrastructure not
directly invoked by users." That framing was wrong: tools ARE
directly invoked by users via `/tools:<tool>` for custom
prompts. They're user-facing capabilities, persona-orthogonal
(every persona might invoke `/tools:playwright` for a one-off
task). Top-level placement matches their consumption pattern.

The principle: **anything users directly invoke gets a top-level
grouping**. Personas (`design/`, `engineer/`, `market/`) are
user-facing. Frameworks are user-facing. Tools are user-facing.
Workflows and audit are user-facing too (top-level / via
top-level entry points). Only `core/` is non-user-facing — it's
the audit dispatcher's home, but the audit command itself
invokes as `/audit` without a `/core:` prefix.

## Anti-patterns

- **Cataloging environments as tools** — claude-code, opencode,
  copilot CLI agentic mode, etc. These are TUI environments,
  not discrete-invocation tools. They run the suite; the suite
  doesn't invoke them.
- **Cataloging dev servers as tools** — Storybook dev server,
  LocalStack. These are processes you start; their start
  commands and configuration live in framework or project
  manifests, not in the tools registry.
- **Cataloging SDKs as tools** — embedded libraries are
  not invokable. Their selection belongs in architecture
  decisions (ADRs).
- **Inlining install instructions in every command's
  `_context.md`** — install instructions live in the tool's
  registry definition. Commands reference the tool; setup
  handles installation centrally.
- **Bypassing the manifest in commands** — commands that
  invoke tools should respect `.pencil-tools.json` (especially
  for tools with both CLI and MCP interfaces, where preference
  matters). Hard-coding `npx playwright` everywhere works for
  basic cases but ignores the abstraction the manifest
  provides.
- **Auto-installing tools without user consent** — `/tools:setup`
  always confirms before installing. Suite commands never
  silently install tools as a side effect of their work.

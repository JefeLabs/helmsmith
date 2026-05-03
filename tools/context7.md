---
description: Context7 MCP for fetching up-to-date library documentation. MCP-only — no CLI. Provides current, version-specific docs for thousands of libraries (React, Next.js, Spring Boot, Tailwind, etc.) directly in the agent's context. Used by suite commands and skills when accurate library docs are needed for code generation or migration guidance.
argument-hint: <library-name-or-search-prompt> [--version <ver>]
allowed-tools: Read, Write, Edit, Bash, mcp__context7__*
---

Direct invocation of Context7 for documentation lookup. The
canonical way to fetch up-to-date library documentation in
agentic workflows — replaces the "training-data-stale" problem
when commands need to generate or migrate code against
specific library versions.

## Phase 0: pre-flight

1. Verify context7 active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.context7.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Context7 not active. Run /tools:setup context7"
     exit 1
   fi
   ```

2. Verify MCP server connectivity:

   ```bash
   if ! mcp_tool_available "mcp__context7__resolve-library-id"; then
     echo "Context7 MCP not connected in this session"
     echo ""
     echo "Configuration depends on environment:"
     echo "  - claude-code: see https://github.com/upstash/context7"
     echo "  - opencode/cursor: configure MCP server endpoint"
     exit 1
   fi
   ```

## Phase 1: prompt interpretation

Context7 has a two-step query pattern:

### Step 1: resolve library ID

Library names get resolved to Context7-internal IDs:

```
"react" → /context7/react
"next.js 15" → /vercel/next.js (with version filter)
"spring boot 3" → /spring-projects/spring-boot
"tailwind v4" → /tailwindlabs/tailwindcss (with version filter)
```

### Step 2: fetch documentation

Once library ID known, fetch documentation matching the topic:

```
"how do I use server components in Next.js 15"
  → resolved: /vercel/next.js
  → fetch with topic: "server components"
  → returns: relevant doc sections

"WebClient connection pool tuning in Spring Boot"
  → resolved: /spring-projects/spring-boot
  → fetch with topic: "WebClient connection pool"
  → returns: relevant config docs
```

## Phase 2: execution

```
Operation: "show me Tailwind v4 @theme directive docs"
  
  Step 1: mcp__context7__resolve-library-id
    args: libraryName: "tailwind"
    returns: { id: "/tailwindlabs/tailwindcss", versions: ["v4", "v3", "v2"] }
  
  Step 2: mcp__context7__get-library-docs
    args: 
      context7CompatibleLibraryID: "/tailwindlabs/tailwindcss"
      topic: "@theme directive"
      tokens: 5000
    returns: structured documentation excerpts
```

The integration handles both steps; user provides natural-
language prompt and gets relevant docs back.

### Token budget

Context7 returns documentation in chunks measured in tokens.
The integration manages this:

- **Default**: 5000 tokens (rough page of docs)
- **More detail**: 10000+ tokens for comprehensive operations
- **Compact**: 2000 tokens for quick reference lookup

```bash
TOKEN_BUDGET="${TOKEN_BUDGET:-5000}"
```

## Phase 3: result formatting

```
=== Context7 Documentation: Tailwind CSS v4 ===
Library:  /tailwindlabs/tailwindcss
Topic:    @theme directive
Tokens:   4823 / 5000 budget

[Documentation content]

The @theme directive in Tailwind v4 replaces the theme block
in tailwind.config.js. Define design tokens in CSS:

@theme {
  --color-primary: oklch(0.7 0.2 50);
  --spacing-card: 1.5rem;
}

[... more content ...]

Sources:
  - tailwindcss.com/docs/theme (last verified 2 days ago)
  - tailwindcss.com/docs/v4-changelog (last verified 5 days ago)
```

When the topic doesn't match well, surface alternatives:

```
=== Context7 Search ===
Query:    "WebClient PrematureCloseException"
Library:  /spring-projects/spring-boot

Best match: WebClient connection management
  (relevance: 78%)

Other relevant topics:
  - Reactor Netty connection pool (82% relevance)
  - WebClient timeout configuration (65% relevance)
  - WebFlux error handling (54% relevance)

Use --topic <name> to fetch a specific section.
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| MCP not connected | Server not running in session | Configure Context7 MCP for your environment |
| Library not found | Library ID resolution failed | Verify library name; use search-style prompt |
| No documentation matches topic | Topic too specific or wrong library | Broaden topic; verify library is the right source |
| Token budget exceeded | Result truncated | Increase budget or narrow topic |

## Cross-namespace integration

Context7 is consumed by:

- **`engineer/architecture/decisions/propose`** — when
  proposing ADRs that involve library choices, fetch docs
  for libraries under consideration
- **`engineer/maintenance/upgrades/*`** — when upgrading
  dependencies, fetch migration guides for the target version
- **`frameworks/heroui/build-components`** — fetch HeroUI
  docs for component generation
- **`product/design/*`** — fetch design system docs (Tailwind,
  CSS variables, etc.)
- **`engineer/architecture/workflows/migrate`** — fetch
  framework-specific migration guidance
- **External SKILL.md files** declaring Context7 as required

The pattern: when commands need authoritative current docs
for a library, they invoke `/tools:context7` to get fresh
documentation rather than relying on potentially-stale
training data.

## Distinction from web search

| Tool | Best for |
|------|----------|
| Context7 | Library documentation (current, structured, version-aware) |
| Web search | General queries, articles, blog posts, troubleshooting threads |
| GitHub search via /integrations:github | Code examples in real repos |

Context7 is specifically tuned for documentation; for general
"how do other people solve X" queries, web search is more
appropriate.

## What this tool does NOT do

- **Provide code examples beyond what docs include.** Docs may
  have examples; not all libraries have rich docs. For more
  examples, search GitHub or community resources.
- **Replace the actual library.** Docs help you USE a library;
  you still need to install it and write code.
- **Cache locally.** Context7 server handles caching; the
  suite makes fresh queries.
- **Cover every library.** Context7 has thousands of libraries
  but not all. For uncovered libraries, fall back to web
  search or direct repo docs.

## Examples

```bash
# Library docs lookup
/tools:context7 "how do I use server components in Next.js 15"

# Specific topic
/tools:context7 "Tailwind v4 @theme directive"

# Migration guidance
/tools:context7 "Spring Boot 2 to 3 migration breaking changes"

# Specific version
/tools:context7 "React 19 useOptimistic hook" --version "19"

# Compact lookup
/tools:context7 "Embabel STRIPS planner config" --tokens 2000
```

---

# Registry definition

## Tool metadata

```yaml
name: context7
displayName: Context7 MCP
provider: upstash
category: documentation-lookup
optional: false   # broadly useful; many commands benefit
```

## Interfaces

### CLI

**Not available.** Context7 is MCP-native; no CLI.

For non-MCP environments, alternative is direct
HTTPS to Context7's API (currently undocumented for
public consumption); fall back to web search if needed.

### MCP

```yaml
serverName: context7
toolPrefix: mcp__context7__
authMethod: none (public access for most libraries)
              api-key (for higher rate limits, if applicable)
notes: |
  Context7 MCP server URL: typically configured in MCP
  config. See https://github.com/upstash/context7 for
  setup instructions.
  
  Public tier has rate limits; teams with heavy use can
  configure API key for higher limits.
```

## Tool catalog

Context7 typically exposes:

- `mcp__context7__resolve-library-id` — name → ID + versions
- `mcp__context7__get-library-docs` — fetch docs for an ID
- `mcp__context7__search` — fuzzy search across libraries

Exact tool names depend on Context7 server version; the
integration adapts.

## Required by skillz commands

Auto-populated. Frequently consumed across the suite:
- /engineer:architecture:decisions:propose
- /engineer:maintenance:upgrades:* (migration guidance)
- /frameworks:heroui:build-components
- Various commands needing library docs

## Cross-tool dependencies

- MCP server connectivity in your environment

## System requirements

- MCP-capable agentic environment
- Network access to Context7's hosted MCP service
- Optional: Context7 API key for higher rate limits

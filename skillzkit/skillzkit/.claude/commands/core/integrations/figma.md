---
description: Figma integration for design files, components, styles, variables, comments, and frame exports. Two interfaces — MCP (Figma Developer MCP) and REST (Figma REST API). No canonical CLI exists. Default preference is MCP when available; REST as alternative. Read-focused but supports write operations (comments, file modifications via REST).
argument-hint: <free-form-prompt> [--use-direct] [--file <key>]
allowed-tools: Read, Write, Edit, Bash, mcp__figma__*
---

Direct invocation of Figma for design file operations.
Interprets prompts and routes via the configured preferred
interface. The first integration without a CLI option —
validates the two-interface pattern.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `figma` is
   active.

2. Determine preferred interface and verify availability:

   ```bash
   PREFERENCE=$(jq -r '.integrations.figma.preference' \
                     product/.pencil-integrations.json)
   
   case "$PREFERENCE" in
     mcp)
       mcp_tool_available "mcp__figma__get_file" || prompt_unavailable "mcp"
       ;;
     rest)
       FIGMA_TOKEN=$(resolve_credential "figma" "FIGMA_PERSONAL_ACCESS_TOKEN")
       [ -n "$FIGMA_TOKEN" ] || prompt_unauth "rest"
       ;;
     cli)
       echo "Figma has no CLI interface; preference must be 'mcp' or 'rest'"
       echo "Run /core:integrations:setup figma to reconfigure"
       exit 1
       ;;
   esac
   ```

   The CLI case exists only as a guard against manifest
   misconfiguration. Setup never offers CLI as a choice for
   Figma.

3. Resolve default file scope when prompts reference "the
   design file" without specifying which:

   ```bash
   DEFAULT_FILE=$(jq -r '.integrations.figma.perResourceScoping.defaultFileKey // empty' \
                       product/.pencil-integrations.json)
   FILE_KEY="${FILE:-$DEFAULT_FILE}"
   ```

## Phase 1: prompt interpretation

Classify operations into Figma's resource model:

### Read operations

- **File queries**: get file structure, fetch nodes by ID,
  list pages, list frames, get document tree
- **Component queries**: list components in file, list
  component sets, fetch component metadata, find published
  components in a team library
- **Style queries**: list local styles, fetch fill/text/effect
  styles, get color variables
- **Variable queries**: fetch variable collections, modes,
  resolved values
- **Comment queries**: list comments on a file, fetch
  resolved/unresolved status, fetch reactions
- **Export queries**: render frames as PNG/SVG/PDF/JPG at
  specified scales
- **Team/project queries**: list team projects, files in a
  project

### Write operations

- **Comment management**: post comments, reply to threads,
  resolve comments, react to comments
- **File modifications**: limited — Figma's REST API supports
  some modifications (variables, styles via the more recent
  Variables API). Direct frame editing requires Figma Plugins,
  which are out of scope for this integration.

The integration is **primarily read-focused**. The dominant
use cases are extracting design tokens, finding components,
exporting renders, and querying comments. Writes are a smaller
surface.

No write delegation — Figma is a design source, not a
publishing destination.

## Phase 2: execution per interface

### MCP path (`mcp__figma__*`)

Figma's developer MCP server (when available in environment)
exposes structured operations:

```
Operation: "list components in our design system file"
  → mcp__figma__get_file_components
    args: file_key

Operation: "export the homepage frame as PNG at 2x"
  → mcp__figma__export_frames
    args: file_key, frame_ids, format: "png", scale: 2

Operation: "show me unresolved comments on the checkout flow"
  → mcp__figma__get_comments
    args: file_key, filter: unresolved
```

The MCP server handles auth (typically via a token configured
at server startup). The suite invokes tools and parses results.

When MCP returns structured data (component lists, style
inventories), the integration formats it for prompt context.
When MCP returns binary data (rendered frames as base64), the
integration may save to disk and return the path.

### REST path

Figma REST API uses Personal Access Tokens with simple Bearer
auth:

```bash
FIGMA_TOKEN=$(resolve_credential "figma" "FIGMA_PERSONAL_ACCESS_TOKEN")

# File structure
curl -sS \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/${FILE_KEY}"

# Components in file
curl -sS \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/${FILE_KEY}/components"

# Export frames as images (returns URLs to rendered images)
curl -sS \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/${FILE_KEY}?ids=${NODE_IDS}&format=png&scale=2"

# Post a comment
curl -sS \
  -H "X-Figma-Token: $FIGMA_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://api.figma.com/v1/files/${FILE_KEY}/comments" \
  -d '{"message": "...", "client_meta": {...}}'

unset FIGMA_TOKEN
```

Note Figma's auth header is `X-Figma-Token` (not `Authorization:
Bearer`) — quirk of their API. The integration handles this
correctly.

### File key extraction

Figma URLs look like:
```
https://www.figma.com/design/abc123XYZ456/Project-Name?node-id=1-2
                              ^^^^^^^^^^^^^
                              file key
```

The integration extracts file keys from URLs in prompts:

```bash
extract_file_key() {
  local PROMPT="$1"
  # Match figma.com/design/<key>/ or figma.com/file/<key>/
  echo "$PROMPT" | grep -oE 'figma\.com/(design|file)/[^/]+' | \
    sed 's|figma\.com/[^/]*/||' | head -1
}
```

When prompt includes a Figma URL, that file key takes
precedence over the manifest's defaultFileKey.

## Phase 3: result formatting

### Component listings

```
=== Figma: SkoolScout Design System ===
File: skoolscout-design-system (last modified 3h ago)
Components (47):

  Atoms (15):
    Button — 8 variants (size × intent)
      Last modified: 3h ago
      Used in: 47 instances across 12 files
    Input — 4 variants (state)
    Avatar — 6 variants (size × shape)
    ...
  
  Molecules (24):
    SearchBar
    UserMenu
    NotificationCard
    ...
  
  Organisms (8):
    NavBar
    DashboardHeader
    ...

Component sets: 12
Detached instances detected: 3 (potential cleanup candidates)
```

### Comment listings

```
=== Comments: SkoolScout Checkout Flow ===
File: skoolscout-checkout (last modified 2d ago)
Unresolved comments (5):

  Frame: Checkout — Step 2
    @Edwin (5h ago):
    "The error state for invalid card number is too
    visually heavy. Can we soften the red?"
    Reactions: 👍 (2)
    Replies: 1 (most recent: @Designer-Sarah)
  
  Frame: Checkout — Step 3
    @Product-Lead (1d ago):
    "Why are we asking for SSN here? Compliance review
    flagged this."
    Replies: 0 (awaiting response)

  ... (3 more)
```

### Export results

When exports are requested, the integration:
1. Calls REST to get rendered image URLs
2. Downloads images to a working directory
3. Returns paths (or base64 if invoked via MCP that returns
   inline)

```
=== Figma Export ===
File: skoolscout-design-system
Exported 3 frames at 2x scale (PNG):

  /tmp/figma-exports/2026-05-03/homepage-hero.png
  /tmp/figma-exports/2026-05-03/dashboard-default.png
  /tmp/figma-exports/2026-05-03/profile-edit.png

Total size: 4.2 MB
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 403 Forbidden | Token lacks file access | Verify token has access to the file's team; some files are team-restricted |
| 404 Not Found | File key wrong or file deleted | Verify file URL; the key portion of the URL changes when files are duplicated |
| 429 Too Many Requests | Rate limit exceeded | Surface remaining quota; suggest backoff |
| 400 Invalid file key | Key format wrong | Extract from full Figma URL; don't guess |

## Cross-namespace integration

This integration is invoked by:

- **`product/design/` commands** that need to compare Pencil
  specs against Figma designs (drift detection between design
  source-of-truth files)
- **`frameworks/heroui/`** when generating components from
  Figma — fetches component metadata, exports frames as
  visual reference
- **`product/strategy/audit`** Plane 1 (visual audit) when
  comparing implementation against Figma designs
- **`market/ads/`** commands when fetching design assets for
  ad creative
- **External SKILL.md files** declaring Figma as required

## What this integration does NOT do

- **Edit Figma designs.** Frame manipulation, component
  creation, layout changes — those require Figma Plugins
  (separate ecosystem; not REST/MCP scope).
- **Replace Figma's UI for design work.** Designers work in
  Figma directly; this integration is for programmatic
  read/extract.
- **Sync Figma to local code.** Code generation from Figma
  designs (Anima, Locofy, Figma Dev Mode export) is a separate
  workflow; this integration provides the data layer those
  workflows might consume.
- **Manage Figma team/billing.** Out of scope.

---

# Registry definition

## Integration metadata

```yaml
name: figma
displayName: Figma
provider: figma
category: design
multiInstance: false  # Figma is single-instance per team;
                      # different teams need separate setups
```

## Interfaces

### CLI

**Not available.** No canonical Figma CLI exists. Community
wrappers (figma-cli on npm, etc.) are not standardized; the
suite doesn't pin to any. Setup never offers CLI as a choice.

### MCP

```yaml
serverName: figma
toolPrefix: mcp__figma__
authMethod: token-managed-by-mcp
notes: |
  Several Figma MCP servers exist (figma-developer-mcp from
  community, plus official Figma MCP if/when released).
  Setup detects via tool prefix availability; configures
  the MCP server's expected token via env at MCP server
  startup (not the suite's responsibility).
```

### REST

```yaml
baseUrl: https://api.figma.com/v1
authMethod: figma-personal-token
authHeaders:
  - "X-Figma-Token: {FIGMA_PERSONAL_ACCESS_TOKEN}"
rateLimit: 6000/minute (varies by endpoint)
documentationUrl: https://www.figma.com/developers/api
notes: |
  Figma uses 'X-Figma-Token' header rather than the standard
  Authorization: Bearer pattern. Quirk of their API.
```

## Credentials

### `FIGMA_PERSONAL_ACCESS_TOKEN`

- **Description**: Personal Access Token for Figma REST API
- **Sensitive**: yes (defaults to keychain storage)
- **Where to obtain**:
  https://www.figma.com/developers/api#access-tokens
  Settings → Account → Personal access tokens
- **Scopes**: Token scope is set at creation time. For most
  read operations: file read, current user. For comment
  posting: file write. For library publishing: library write.
- **Rotation**: Figma doesn't auto-rotate; suite flags per
  `credentialRotationDays`. Default 90 days.

## Per-resource scoping

Common pattern: configure a default file key that prompts
fall back to when not specifying a Figma URL.

```jsonc
{
  "perResourceScoping": {
    "defaultFileKey": "abc123XYZ456",
    "defaultFileName": "SkoolScout Design System"
  }
}
```

Useful when the team has a single primary design source-of-truth
file. Multi-file teams omit this and require URL in prompts.

## Rate limits

REST: 6000/minute on most endpoints; export endpoints have
lower limits. Surfaced in response headers.

For batch operations (exporting many frames, fetching all
components in a large library), respect rate limits with
backoff.

## Required by skillz commands

(Auto-populated.)

## Compliance considerations

Figma access is generally less compliance-sensitive than Jira
or financial-data integrations. Standard token rotation
(90 days default) is usually sufficient.

For Figma Enterprise plans with SSO, the Personal Access Token
still works alongside SSO — tokens are user-scoped regardless
of authentication method.

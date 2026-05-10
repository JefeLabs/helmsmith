# skillzkit — Feature Overview

A categorized rundown of what skillzkit can do. For deep installation
guidance, see the getting-started docs; for design rationale, see
[architecture.md](architecture.md).

## Browse and discover

### Catalog listing

```bash
skillzkit list                       # all commands + skills + workflows
skillzkit list --commands            # commands only
skillzkit list --workflows           # workflows only
skillzkit list --skills              # skills only
skillzkit list --tree                # render hierarchically by namespace
skillzkit list --tag accessibility   # filter by tag
```

### Search

Substring match across slug, description, and tags:

```bash
skillzkit search migration           # finds anything mentioning "migration"
skillzkit search accessibility       # cross-persona discovery via tag
skillzkit search "press release" --limit 5
```

The search axis includes tags so cross-persona discovery works:
searching `accessibility` surfaces hits in `product:design:*`,
`product:ux:*`, `engineer:architecture:*`, and
`engineer:maintenance:*` simultaneously.

### Show details

```bash
skillzkit show core:tools:biome      # print full body
skillzkit show product:greenfield    # by qualified name
skillzkit show skillzkit-product-router   # by skill name
```

### Tag introspection

```bash
skillzkit tags                       # all tags + usage counts
                                     # split: core (curated) vs extension
```

### Interactive TUI

```bash
skillzkit ui                         # full-screen terminal picker
                                     # → arrow keys to navigate
                                     # → space to toggle selection
                                     # → c/y to copy slash command
                                     # → tab to switch focus
                                     # → enter to install / sync
```

## Suggest next steps

After completing a slash command or workflow phase, the catalog can
suggest what to do next based on the dependency graph plus active
workflow state:

```bash
skillzkit suggest product:strategy:scaffold
# Next steps after product:strategy:scaffold:
#   [task]     /product:design:foundations:colors
#   [workflow] product:greenfield   (5 phases, ~3-5 hours)
#   ...
```

The agent-facing skill `skillzkit-suggest-next` provides the same
capability invoked by intent ("what should I do after running X?").

## Install with cascade resolution

```bash
# Install everything
skillzkit install

# Install specific slugs (with transitive workflow deps)
skillzkit install product:strategy:scaffold
skillzkit install core:tools:*           # wildcard
skillzkit install engineer               # whole persona
skillzkit install skillzkit-product-router

# Preview the plan without writing files
skillzkit install engineer --dry-run

# Overwrite existing
skillzkit install product --force

# Custom target directory
skillzkit install core:tools:* --target /path/to/project
```

Cascade rules:

- **Skill seed** — walks all references unconditionally
- **Workflow seed** — walks non-`core:*` refs; only propagates further through other workflows
- **Command seed** — no cascade (a command body that mentions other commands is prose, not runtime dependency)
- **Always installed** — audit dispatcher, workflow state machine, all skills, top-level `_context.md`, and runtime manifests for picked tools/integrations

## Health checks (`doctor`)

Validates structural invariants of the catalog:

```bash
skillzkit doctor
# Checks:
#   - Broken references (body cites a slug that doesn't exist)
#   - Orphan files (.md exists but isn't indexed)
#   - Frontmatter completeness (missing description, outcome, etc.)
#   - Workflow prerequisites resolve to known artifacts
#   - Self-references (informational)
#   - Tag format violations + extension-tag visibility
```

Use `--errors-only` to filter for CI gating:

```bash
skillzkit doctor --errors-only       # exits non-zero on any error
```

## Tag system

Two-tier governance for catalog tagging:

- **Core tags** are curated, listed in `TAGS.md`, allowed freely. Seven
  ship in v0.1: `research`, `accessibility`, `security`, `migration`,
  `brand`, `onboarding`, `documentation`.
- **Extension tags** are anything else. Allowed but flagged at
  info-level by `skillzkit doctor` so vocabulary drift is visible.
  Frequently-used extensions become candidates for promotion into core.

Tags are **orthogonal discovery metadata** — they do NOT affect router
membership or install cascade. A `product:*` artifact tagged
`accessibility` is discoverable via tag search but the
`skillzkit-engineer-router` will not fire it. (Engineers needing
similar work author their own engineer-flavored version; see the
project's "deliberate forking" principle in the platform memory.)

Format:

- Lowercase, hyphen-separated
- ASCII letters/digits only
- Max 24 chars
- Must start with a letter

## Two deployment modes

### Standalone

```bash
npm install -g @ecruz165/skillzkit
skillzkit init                       # interactive setup; mode=standalone
skillzkit ui                         # browse the bundled catalog
```

Everything runs locally. The catalog ships with the npm package. No
server, no API, no auth. See
[getting-started-standalone-mode.md](getting-started-standalone-mode.md).

### Team

```bash
skillzkit init --mode team --email you@example.com \
  --api-url https://skillz.example.com \
  --api-key <from-controlplane> \
  --pin <encrypts-key-at-rest>

skillzkit ui                         # browse the team's shared catalog
```

The catalog lives in a centrally-deployed skillzkit API. The local CLI
+ TUI fetch from it; new contributions are submitted via API.
See [getting-started-team-mode.md](getting-started-team-mode.md).

## REST API (team mode)

A Hono-based HTTP API exposes the catalog over the network. Read
endpoints are anonymous; write endpoints require a Bearer token.

| Endpoint | Description |
|---|---|
| `GET /api/v1/health` | Liveness + catalog version + item counts |
| `GET /api/v1/catalog` | Full catalog index (no bodies) |
| `GET /api/v1/commands` | List commands; filters: `?kind=`, `?prefix=`, `?tag=`, `?limit=`, `?offset=` |
| `GET /api/v1/commands/:slug` | Get one command with full body |
| `GET /api/v1/skills` | List skills; filter: `?tag=` |
| `GET /api/v1/skills/:name` | Get one skill |
| `GET /api/v1/workflows` | List workflows; filters: `?tag=`, `?domain=` |
| `GET /api/v1/workflows/:qualifiedName` | Get one workflow |
| `GET /api/v1/search?q=…&limit=…` | Search across all kinds |
| `GET /api/v1/tags` | All tags + usage counts |
| `POST /api/v1/contributions` | Submit a new artifact (bundle) |
| `GET /api/v1/contributions/:id` | Poll contribution review status |

## Local API server

```bash
skillzkit serve                      # default :3000, fs-backed read-only
skillzkit serve --port 3789          # custom port
skillzkit serve --storage memory     # ephemeral in-memory backend
```

Useful for:

- Local development against the API contracts
- Testing TUI team-mode against your own working tree
- Smoke-testing the API in containers before deploying

## Container deploy

```bash
docker build -t skillzkit-api ./apps/skillzkit
docker run -p 3000:3000 -e SKILLZKIT_STORAGE=fs-persistent:/data \
  -v skillz-data:/data skillzkit-api
```

Or as a sibling service in a controlplane docker-compose. See
[getting-started-team-mode.md](getting-started-team-mode.md) for the
full setup.

## Contribute new artifacts

Skill catalog growth happens via contribution. Two paths:

### Standalone mode (local-only authoring)

```bash
# The skillzkit-author skill walks the authoring flow:
# 1. Pick namespace
# 2. Frontmatter conventions
# 3. Body draft
# 4. Slug-collision validation
# 5. Reference resolution
# 6. Catalog regeneration
# 7. (optional) git commit + PR
```

Equivalent manual flow:

```bash
git checkout -b feat/<persona>-<slug>
# author .claude/commands/<path>.md
npm run catalog                      # regenerate index
npm test
skillzkit doctor                     # validate
git add . && git commit
gh pr create
```

### Team mode (via API)

```bash
# (CLI subcommand coming in v0.2)
skillzkit contribute --kind command --slug product:strategy:my-thing \
  --file ./my-thing.md
# → POSTs to /api/v1/contributions
# → server validates layers 1+2 (structural + bundle)
# → if review enabled: kicks off async layer-3 (LLM review)
# → returns 201 (immediate accept) or 202 (review pending)
```

The validation pipeline (layers 1, 2, 3) is shipped today; the CLI
contribute subcommand and the matching API endpoint are the next
implementation milestone.

## Versioned promotion

Contributions land as **immutable versioned artifacts**:

```
v1/commands/<slug>@<version>.json    ← never overwritten
v1/commands/<slug>@<version+1>.json  ← new version on next contribution
```

The catalog index has a separate "currentVersion" pointer per slug
that gets updated by an explicit promote step:

```bash
# (admin / maintainer flow, via API)
POST /api/v1/contributions/<id>/promote
```

This decouples **stored** (passed validation, persisted) from **live**
(visible in the index, served to clients). Pass review → `accepted`;
maintainer opts in → `promoted`. Lets you stage changes and roll
back safely.

## Optional agent review

When enabled, contributions go through an LLM review pass before
promotion eligibility:

```yaml
# server env config (controlplane Docker example)
environment:
  SKILLZKIT_REVIEW_AGENT: enabled
  # The actual provider (Claude / OpenAI / local Qwen) is chosen by
  # the host's BindingResolver; skillzkit doesn't hold provider keys.
```

Review axes:

- **Quality** — coherence, redundancy, length appropriate to the kind
- **Tag fit** — declared tags match actual content?
- **Safety** — prompt injection patterns, harmful content, secrets
  the structural pass missed

The review is provider-agnostic via `@ecruz165/agent-adapter`. You can
run it against Claude in production and a local Qwen for cost-sensitive
deploys without changing skillzkit code.

## Configuration management

Local config lives at `~/.agentx/skillzkit/config.json`. CLI:

```bash
skillzkit config                     # show all (API key masked)
skillzkit config email               # show one field
skillzkit config email new@x.com     # set (with safety checks)
skillzkit config --show-secrets      # reveal encrypted-blob fields
                                     # (plaintext key never shown)
```

Mode-changing or key-rotating operations refuse with a clear pointer
to `skillzkit init --force` so the user doesn't accidentally orphan
their encrypted API key.

## Author-match-on-update

In team mode, slug ownership is enforced server-side. The first
publisher's stable author ID is recorded; future publishes to the same
slug must come from the same identity. Different identities are
rejected with a clear error pointing to the slug owner.

This protects against:

- Accidental collisions with existing artifacts
- Hostile takeover of a popular slug
- Unintended overwrites from automation

Authors can change display name + email freely (the auth ID is the
stable check) and continue publishing.

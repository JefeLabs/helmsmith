# skillzkit — Architecture

This document describes how skillzkit is organized, how its components
fit together, and how the two deployment modes (standalone, team) map
onto the same underlying code.

## High-level view

```
                          ┌────────────────────────────────────────┐
                          │              User's machine            │
                          │                                        │
                          │   ┌──────────┐   ┌──────────────────┐  │
                          │   │   CLI    │   │       TUI        │  │
                          │   │  (Node)  │   │    (Bun-based)   │  │
                          │   └────┬─────┘   └────────┬─────────┘  │
                          │        │                  │            │
                          │   ┌────▼──────────────────▼──────────┐ │
                          │   │   Local config (.agentx/...)     │ │
                          │   │   + bundled catalog.json         │ │
                          │   └────────────────┬─────────────────┘ │
                          └────────────────────┼───────────────────┘
                                               │ team mode only
                                               ▼
            ┌─────────────────────────────────────────────────────────┐
            │              skillzkit API (Hono app)                   │
            │                                                         │
            │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
            │  │ Read handlers│  │ Contribute   │  │ Validation   │  │
            │  │ /catalog,    │  │ /contributions│  │ Layer 1+2+3 │  │
            │  │ /commands... │  │              │  │              │  │
            │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
            │         │                 │                 │          │
            │  ┌──────▼─────────────────▼─────────────────▼───────┐  │
            │  │           CatalogStorage interface               │  │
            │  └─────┬────────────────┬─────────────────┬─────────┘  │
            │        │                │                 │            │
            │   ┌────▼───┐       ┌────▼─────┐     ┌─────▼────┐      │
            │   │ memory │       │   fs/    │     │    s3    │      │
            │   │        │       │ fs-pers. │     │          │      │
            │   └────────┘       └──────────┘     └──────────┘      │
            │                                                         │
            │   Optional layer-3 reviewer:                            │
            │   ┌─────────────────────────────────────────────────┐   │
            │   │ AgentAdapter (from @jefelabs/agent-adapter) →   │   │
            │   │ Claude / OpenAI / Qwen (provider chosen by      │   │
            │   │ host's BindingResolver)                         │   │
            │   └─────────────────────────────────────────────────┘   │
            └─────────────────────────────────────────────────────────┘
```

## Components

### CLI (`bin/cli.ts`)

The Node-based command-line interface — `skillzkit list`, `search`,
`install`, `init`, `config`, `tags`, `serve`, `doctor`, `ui`. Uses
`cac` for arg parsing. Reads the bundled `catalog.json` directly in
standalone mode.

### TUI (`tui/main.tsx`)

Interactive picker built with `@opentui/react`. Runs under Bun
(required because opentui uses Bun-native FFI). The TUI is launched
via `skillzkit ui`, which spawns the bundled Bun binary on
`tui/main.tsx`.

In standalone mode the TUI reads `catalog.json` off disk; in team mode
it fetches the catalog index from the API at startup.

### Catalog (`.claude/`, `catalog.json`, `lib/load.ts`)

Source files live as markdown under `.claude/commands/` (per-persona
trees) and `.claude/skills/` (one directory per skill, each with
`SKILL.md`). The `catalog` build script (`scripts/generate-catalog.ts`)
walks these trees and produces `catalog.json` — a flat index with
forward (`references[]`) and reverse (`referencedBy[]`) edges, derived
workflow records, and tag metadata.

### API server (`server/`)

A [Hono](https://hono.dev) app exposing read endpoints (catalog,
commands, skills, workflows, search, tags, health) and contribute
endpoints (when writable storage is configured). The app definition
in `server/app.ts` is **runtime-agnostic** — the same code runs under
multiple adapters.

| Adapter | File | Use case |
|---|---|---|
| Bun.serve | `server/bun.ts` | Local dev (`skillzkit serve`) AND controlplane Docker hosting |
| AWS Lambda | `server/lambda.ts` | Stateless serverless deploy |

### Storage backends (`lib/api/storage/`)

The `CatalogStorage` interface is the seam between handlers and
persistence. Pluggable via the `SKILLZKIT_STORAGE` env var:

| Backend | Status | Use case |
|---|---|---|
| `memory` | shipped | Tests + ephemeral dev |
| `fs:<path>` | shipped (read-only) | Local dev pointing at a repo |
| `fs-persistent:<path>` | planned | Read+write Docker volume |
| `s3:<bucket>` | planned | AWS serverless deploys |

All backends implement the same operations: `getIndex`, `getCommand /
getSkill / getWorkflow`, version listing/fetching, immutable
versioned `put*` writes, and explicit `promote*` calls that update the
catalog index pointer.

### Validation pipeline (`lib/api/validation/`)

Three layers, ordered by cost:

| Layer | When | Latency | Block on |
|---|---|---|---|
| 1. Structural | Always | <1 ms | `high` severity |
| 2. File bundle | Always | <10 ms | `high` severity |
| 3. Agent review | Opt-in | ~5–10 s | `high` severity |

**Layer 1** (`structural.ts`): slug/name format regex, required
frontmatter keys per kind, body length limits, references resolution
against current catalog, tag format + two-tier (TAGS.md core list)
check.

**Layer 2** (`files.ts`): path safety (no `..`, no absolute paths,
no null bytes), file-type allowlist (`.md`, `.py`, `.sh`, `.ts`,
`.js`, `.json`, `.yaml`, `.yml`, `.toml`), per-file + total size
limits, content scanning for hardcoded credentials (AWS, GitHub,
Anthropic, OpenAI keys; PEM private keys; Slack webhooks), JSON parse
verification.

**Layer 3** (`reviewer.ts`, opt-in): an `AgentAdapter` invocation that
asks an LLM to review the bundle along three axes — quality (coherence,
redundancy), tag fit, safety (prompt injection patterns, harmful
content, missed secrets). Disabled by default; enabled via env config.

### Agent reviewer integration

The reviewer interface (`ContributionReviewer`) is provider-agnostic.
Implementations:

- **`MockReviewer`** — for tests. Returns no findings by default;
  configurable to return canned findings for failure-path coverage.
- **`AgentAdapterReviewer`** — wraps an `AgentAdapter` from
  `@jefelabs/agent-adapter`. Builds a system+user prompt, calls
  `adapter.invoke()`, parses JSON findings (tolerant of code-fenced
  output, embedded prose, malformed individual entries).

The skillzkit API doesn't hold provider credentials directly. At
startup, the host (controlplane Docker / Lambda runtime) constructs an
`AgentAdapter` via `bindingToAdapter()` from the platform's
`agent-adapter-lib`, which uses `@jefelabs/agent-auth`'s
`CredentialBroker` to fetch the configured provider's credentials.
This means switching review providers (e.g., Claude → local Qwen) is a
host-config change, not a skillzkit code change.

## Data flows

### Browse (read path)

```
User → CLI/TUI → loadCatalog() → catalog.json (standalone)
                                  OR
                  → SkillzkitApiClient → GET /api/v1/catalog (team)
```

The TUI's `Catalog` shape and the API's `CatalogIndex` are the same
data minus body fields (summaries don't carry the markdown body — only
the metadata needed to render the picker tree).

### Install (write to local .claude/)

```
User → skillzkit install <slug>
     → resolveInstallPlan(slug) [walks references graph for transitive deps]
     → installSlugs() [copies always-install infra + selected slugs]
     → writes .claude/{commands,skills}/ + product/.pencil-{tools,integrations}.json
```

Install always runs locally. The "team mode" doesn't change install —
the catalog source might be remote, but writing files into the user's
project directory is always a local operation.

### Contribute (write path, team mode only)

```
User → skillzkit contribute <bundle>
     → POST /api/v1/contributions { kind, slug, frontmatter, files[] }
     → API: validateContribution() [layers 1+2 sync]
       ├── any high-severity finding → 422 Unprocessable Entity
       └── pass → storage.put*() [version stored as immutable]
            ├── reviewer disabled → 201 Created
            └── reviewer enabled → 202 Accepted + Location header
                                   setImmediate(() => runReview())
                                   client polls GET /contributions/<id>
```

(Note: the contribute endpoint itself is a follow-up task; the
validation library it depends on is shipped.)

### Promote (move pointer to "live")

```
Maintainer → POST /api/v1/contributions/<id>/promote
           → storage.promote*() [updates index pointer]
           → next /catalog response reflects new version
```

Promotion is always explicit. A passing review marks an artifact
`accepted` but does NOT automatically promote it. This separation
prevents review-driven auto-publish; a human maintainer always opts in
to going live.

## Configuration model

### Local (per-user)

Lives at `~/.agentx/skillzkit/config.json` (mode `0600`):

```json
{
  "version": 1,
  "mode": "standalone" | "team",
  "email": "user@example.com",
  "team": {                              // present only when mode=team
    "apiUrl": "https://...",
    "keyEncrypted": { ... AES-256-GCM ... },
    "keyMasked": "...4f92"
  },
  "createdAt": "2026-...",
  "updatedAt": "2026-..."
}
```

API keys are encrypted at rest using a passphrase derived from
`email + ":" + PIN` via scrypt + AES-256-GCM. The PIN is never stored.
Decryption (and therefore contribution submission) requires the user
to re-enter the PIN.

### Server (per-deploy)

Selected entirely via environment variables:

| Var | Purpose | Example |
|---|---|---|
| `SKILLZKIT_STORAGE` | Backend selector | `fs-persistent:/data` |
| `PORT` | Listening port | `3000` |
| `SKILLZKIT_PACKAGE_ROOT` | Override fs-backend root | `/app` |
| `SKILLZKIT_REVIEW_AGENT` | Enable layer-3 review | `enabled` |

Provider credentials for the optional layer-3 review are resolved by
the host's existing `CredentialBroker` configuration (typically
`~/.agentx/auth.json` or controlplane's credential system) — not
duplicated in skillzkit's env.

## Security model

### At rest (client side)

- Config file mode `0600`, parent directory mode `0700`
- API keys encrypted with email + PIN (scrypt + AES-256-GCM)
- The masked key suffix (e.g., `...4f92`) is shown for human ID; the
  plaintext key is **never** stored

### In transit

- TLS via the host (Bun.serve fronted by your reverse proxy of choice
  in production; AWS API Gateway for Lambda)
- API key sent as `Authorization: Bearer …` over HTTPS — same
  convention as gh, aws, stripe, anthropic

### Server-side

- Author-match-on-update: the slug's first publisher's `author.id` is
  recorded and enforced — different authors cannot overwrite each
  other's slugs
- Versions are immutable: `(slug, version)` is enforced unique;
  republishing requires a version bump
- Rate limiting on layer-3 reviews (per-author quota) caps
  provider-key cost exposure

### Trust boundary

skillzkit's API trusts API keys minted by `agentx-controlplane`. It
does NOT issue keys, manage user identity, or store passwords. This
keeps skillzkit's surface area small and lets the platform handle
identity uniformly across services.

## Why these choices

### Why Hono over Express/Fastify

Hono has zero dependencies of its own, ~14KB minified, and the same
`app.fetch(request)` interface across Node, Bun, AWS Lambda, Cloudflare
Workers, and Vercel Edge. The runtime adapters are 5-line files. This
matches skillzkit's deployment-flexibility requirement (controlplane
Docker hosting AND serverless Lambda from the same codebase).

### Why Bun for the TUI and primary server

Bun runs TypeScript without a build step, has a fast native HTTP
server, and is already a dep for the TUI's opentui FFI bindings.
Bundling Bun via npm install + spawning it for `skillzkit serve` and
`skillzkit ui` means users don't need to install Bun separately.

### Why scrypt + AES-GCM (not argon2)

scrypt is OWASP-acceptable, native to Node's `crypto` module (zero
new deps), and tunable for adequate brute-force resistance. argon2id
is "more modern" but requires a native binding or large WASM blob —
not worth the deploy complexity for the security gain at this layer.

### Why versioned promotion (not auto-publish)

A clean separation between "stored" and "live" lets us decouple agent
review from going public. Passing review means accepted; promotion
means visible. A maintainer (or an auto-promote rule, if you trust
your review enough to write one) makes the call separately.

### Why the `core:` namespace exemption

Persona-agnostic operations (npm install, biome lint, terraform plan)
genuinely don't have persona-specific judgment to encode. The `core:`
prefix is the catalog's escape valve from the duplicate-per-persona
rule that applies to product/engineer/market work. See the project's
internal feedback on persona-specific artifacts for the deeper
rationale.

## Repository layout

```
apps/skillzkit/
├── .claude/
│   ├── commands/                    Source markdown for commands + workflows
│   └── skills/                      Source for skills (each in its own dir)
├── bin/
│   └── cli.ts                       CLI entry point
├── docs/                            (this directory)
├── lib/
│   ├── load.ts, doctor.ts, ...      Catalog gen + utilities
│   ├── init/                        skillzkit init flow + crypto + config IO
│   ├── api/
│   │   ├── contracts.ts             Wire types shared between server + client
│   │   ├── client.ts                Typed API client (used by TUI in team mode)
│   │   ├── storage/                 CatalogStorage backends
│   │   └── validation/              Layer 1/2/3 contribution validation
│   └── tags.ts, types.ts, ...
├── server/
│   ├── app.ts                       Runtime-agnostic Hono app
│   ├── config.ts                    Env-driven storage backend selection
│   ├── bun.ts                       Bun.serve entry
│   └── lambda.ts                    AWS Lambda entry
├── tui/
│   ├── main.tsx                     Bun + opentui interactive picker
│   ├── install.ts, state.ts
├── catalog.json                     Generated index
├── TAGS.md                          Tag governance + core whitelist
├── Dockerfile                       Container image for hosted deploys
└── package.json
```

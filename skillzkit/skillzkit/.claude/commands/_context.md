# AgentX Skillz Suite — Top-Level Context

> Read this for orientation when working anywhere in the suite.
> The suite is organized as **persona namespaces** (`product/`,
> `engineer/`, `market/`) sitting alongside `core/`, which holds
> all cross-persona infrastructure — audit, tools, integrations,
> workflow management, and framework bindings.

## Suite organization

The suite has four top-level groupings:

```
agentx-skillz-suite/
├── core/                  cross-persona infrastructure
│   ├── audit/             cross-persona audit dispatcher
│   ├── tools/             local-invocation tools (playwright, pixelmatch,
│   │                        biome, maven, npm, terraform, etc.)
│   ├── integrations/      remote service invocations (jira, github,
│   │                        outlook, splunk, etc.)
│   ├── workflows/         workflow management state machine + unified index
│   └── frameworks/        framework bindings (heroui, storybook;
│                            future: mui, chakra, etc.)
├── product/               product persona (strategy, design, ux + workflows)
├── engineer/              engineer persona (architecture, maintenance,
│                            testing, development + workflows)
└── market/                marketer persona (tone, email, ads, social, pr + workflows)
```

Plus manifest schemas at suite root (`.product-*-schema.json`).

## Personas

The suite is organized around three personas that match how
real teams are composed:

### Product persona (`product/`)

Product strategy + UX research + visual design as one role. The
product person who handles strategy thinking, design system
work, user research, journey mapping, and visual design.

The persona is intentionally named "product" rather than
"designer" because the work spans more than visual design —
strategic positioning, scaffolding, audit, persona definition,
journey mapping, story authoring, design system curation, and
page-level design all fit under one cross-functional role on
small-team work. Larger orgs may split this across product
manager, UX researcher, and designer; the suite serves all of
them.

Sub-namespaces:
- `product/strategy/` — product scaffolding, positioning,
  audit, lifecycle workflows (greenfield, brownfield,
  brand refresh, migrations)
- `product/design/` — design system foundations, page-level
  design, visual patterns and templates
- `product/ux/` — UX research artifacts: personas, JTBD,
  journey maps, user stories, story maps

Owns: brand identity, design specs (`.pen` files), component
implementation patterns, user research, personas, journey maps,
information architecture, design lifecycle workflows.

### Engineer persona (`engineer/`)

Software engineering + architecture + QA as one role. The
principal engineer / staff engineer / senior dev who makes
architectural decisions, writes features, maintains quality,
and owns testing.

Owns: architecture decisions (ADRs), system diagrams, API
design, data modeling, integration patterns, dependency
analysis, dependency upgrades, code remediation, Storybook
authoring and verification, framework migrations, future
testing and development namespaces.

### Marketer persona (`market/`)

Marketing across channels. The marketer / content strategist /
communications lead handling cross-channel campaigns, brand
voice, editorial conventions, calendar planning.

Owns: tone strategy, email channels, ads channels, social
channels (X, Instagram, LinkedIn, Facebook, TikTok), PR,
campaign workflows (launch, reactivation, seasonal), calendar
workflows (annual, monthly).

## Cross-persona substrate

Two areas of infrastructure span all personas:

### `core/` — audit and schemas

The audit dispatcher (`core/audit/audit.md`) discovers and
runs plane checks defined per persona. Persona-specific plane
files (`core/audit/_planes/<persona>.md`) hold the actual check
sequences. New planes added to a persona extend that persona's
plane file.

Manifest schemas may live at suite root (current location) or
move into `core/schemas/` in the future. Either way, schemas
are universal architectural contracts that every persona
depends on.

### `workflows/` — workflow state machine

The workflow management command (`workflows/manage.md`) is the
state machine that runs workflows from any persona. Workflow
playbooks live in their persona's `workflows/` sub-directory
(`product/workflows/`, `engineer/workflows/`,
`market/workflows/`). The top-level state machine doesn't care
which persona's workflow is running; the qualified name
(`<persona>:<workflow-slug>`) tells it which playbook to load.

## Frameworks layer

`frameworks/` contains framework bindings — implementations
that translate persona-agnostic outputs into framework-specific
artifacts. Current bindings include `frameworks/heroui/`
(HeroUI v3 + Tailwind v4 + React) and `frameworks/storybook/`
(Storybook adapter ecosystem). Future bindings (Material UI,
Chakra, shadcn, Vue, Svelte, native bindings) live as peers
under `frameworks/`.

The frameworks layer is consumed by both product (generating
components from Pencil specs) and engineer (implementing
features using the components, documenting in Storybook).
Putting it under either persona would mislabel it; keeping it
at the top level says: this is the implementation layer,
consumed by multiple personas.

## Tools layer

`tools/` contains local-invocation tooling — Playwright,
pixelmatch, ImageMagick, Chrome DevTools, Biome, ESLint, Maven,
Gradle, npm, Terraform, Chromatic, Figma plugins, Pencil's MCP,
and Context7 MCP. Each is a single MD file serving dual
purpose: slash command body AND registry definition.

Tools have CLI and (sometimes) MCP interfaces. They run on
the user's machine (or CI environment). Heavily consumed by
suite commands as building blocks (Playwright by storybook
verification, pixelmatch by visual regression, Biome by lint
remediation).

Manifest at `product/.pencil-tools.json` tracks which tools
are detected and available.

## Integrations layer

`integrations/` contains remote service invocations — Jira,
GitHub, Microsoft 365 (Outlook/OneDrive/Teams), Discord,
Datadog, Splunk, and similar. Each is a hosted service requiring
identity-level authentication.

Integrations have up to three interfaces (CLI, MCP, REST) with
explicit user preference (no automatic fallback). Credentials
flow through OS-native keychain delegation (macOS `security`,
Linux `secret-tool`, Windows credential manager) — the suite
never implements crypto.

Manifest at `product/.pencil-integrations.json` tracks active
integrations, per-interface availability, credential references
(NEVER values), and shared auth providers.

The boundary between tools and integrations is **local
invocation versus remote service invocation**. If it
authenticates over the network to a hosted service, it's an
integration. If it runs locally, it's a tool.

## Slash command invocation

Persona prefix is mandatory for any persona-grouped command:

| Command | Pattern |
|---------|---------|
| Cross-persona audit | `/audit` |
| Workflow management | `/core:workflows:manage <subcommand>` |
| Product commands | `/product:<namespace>:<command>` |
| Engineer commands | `/engineer:<namespace>:<command>` |
| Marketer commands | `/market:<command>` (sub-namespaces hoisted) |
| Framework bindings | `/core:frameworks:<binding>:<command>` |
| Tools | `/core:tools:<tool>` |
| Integrations | `/core:integrations:<integration>` |

Examples:

- `/audit` — runs all installed planes
- `/audit --persona product` — product planes only
- `/audit --planes 11` — Plane 11 only
- `/core:workflows:manage start product:greenfield`
- `/core:workflows:manage list`
- `/product:strategy:scaffold`
- `/product:design:design-page`
- `/engineer:architecture:decisions:propose`
- `/engineer:maintenance:upgrades:gradle-deps`
- `/core:frameworks:storybook:stories:gen`
- `/market:email:newsletter`
- `/market:tone:explore`
- `/core:frameworks:heroui:build-components`
- `/core:tools:playwright`
- `/core:integrations:jira "create a ticket for the bug we discussed"`
- `/core:integrations:github "show me unreviewed PRs"`

Workflow qualified names follow the same persona-prefix pattern:
`product:greenfield`, `market:launch-campaign`,
`engineer:polyglot-maintenance-cycle`.

## Runtime data location

Each consuming project has a `product/` data directory at the
project root where runtime manifests live:

- `product/.pencil-brand.json`
- `product/.pencil-tone.json`
- `product/.pencil-architecture.json`
- `product/.pencil-storybook.json`
- `product/.pencil-tools.json`
- `product/.pencil-integrations.json`
- ...

When suite commands reference `product/.pencil-*.json`, they
mean the **consuming project's** runtime data directory at the
project root. This is the same name as the suite's own
`product/` namespace (which holds product-persona commands).
The naming overlap is intentional — the project's product
data directory naturally aligns with the suite's product
persona that authors most of those manifests.

Disambiguation by context:
- Inside a suite file (under `product/strategy/`,
  `product/design/`, etc.): `product/` refers to the consuming
  project's data directory at the project root
- Inside a project: `product/` IS the data directory

Suite commands always write/read manifests at the consuming
project's `product/` root — they never modify the suite's own
files.

## Manifest authorship

Each manifest is authored by one persona but may be consumed by
others:

| Manifest | Authored by | Consumed by |
|----------|-------------|-------------|
| `.pencil-brand.json` | product | all personas |
| `.pencil-tone.json` | product (or marketer-led) | all personas |
| `.pencil-editorial.json` | marketer | all personas |
| `.pencil-seo.json` | marketer | product, marketer |
| `.pencil-marketing-calendar.json` | marketer | marketer |
| `.pencil-architecture.json` | engineer | engineer, product |
| `.pencil-decisions.json` | engineer | engineer, product |
| `.pencil-maintenance-calendar.json` | engineer | engineer |
| `.pencil-storybook.json` | engineer | engineer, product |
| `.pencil-component-manifest.json` | product (via pencil) | engineer (via storybook), product |
| `.pencil-build-manifest.json` | product (via heroui build) | product, engineer |
| `.pencil-ux.json` | product | product, engineer (capability planning) |
| `.pencil-workflow-state.json` | workflow state machine | all personas |

Authoring vs consumption boundary is enforced by which
persona's commands write to a manifest, not by where the
manifest physically lives (they all sit in the project's
`product/` data directory).

## Cross-persona collaboration

Personas reference each other's outputs as **data**, not as
direct command invocation:

- The marketer's email-newsletter command reads
  `.pencil-tone.json` (a product-authored manifest) for voice
- The engineer's storybook-gen command reads
  `.pencil-tone.json` for component label content
- The engineer's architecture review reads `.pencil-brand.json`
  to surface UX-relevant constraints
- The product audit invocation includes engineering planes
  (Plane 11 maintenance drift) when the engineer persona is
  installed

Cross-persona command invocation (e.g., a marketer command
directly invoking a product command) is rare. When it happens,
it's documented in the invoking command's "Cross-namespace
effects" section.

## Versioning model

The persona grouping pattern enables:

- **Per-persona release cadence** — engineer kit can stabilize
  while product kit iterates
- **Per-persona experimental status** — a persona can be marked
  experimental without affecting others
- **Selective adoption** — a project might use only the engineer
  kit (no marketing function); the absent personas' planes and
  workflows simply don't apply

Currently the suite ships as a monolith. Future packaging may
split into per-persona npm packages (`@helmsmith/skillz-core`,
`@helmsmith/skillz-product`, `@helmsmith/skillz-engineer`,
`@helmsmith/skillz-market`, `@helmsmith/skillz-frameworks-heroui`).
The persona-grouped directory structure prepares for that
without forcing it now.

## When to consult deeper context

When working with a specific persona's commands, read that
persona's `_context.md` for conventions:

- `product/_context.md` — product persona conventions
- `engineer/_context.md` — engineer persona conventions
- `market/_context.md` — marketer persona conventions
- `frameworks/_context.md` — framework binding conventions

When working with workflows, read `workflows/_context.md` for
the placement rule and frontmatter conventions.

When working with audit, read `core/audit/audit.md` (the
dispatcher) and the relevant `core/audit/_planes/<persona>.md`
file for plane definitions.

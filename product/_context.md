# Product — Grouping Context

> The product persona's grouping. Read this when working
> anywhere under `product/`.
>
> The product persona handles strategic positioning + UX
> research + visual design as one cross-functional role.
> Commands here support the end-to-end product lifecycle from
> strategy through component implementation. Smaller teams
> may have one person playing all three sub-roles; larger
> teams may split across product manager, UX researcher, and
> designer — the suite serves all configurations.

## What `product/` contains

```
product/
├── _context.md                  (this file)
├── strategy/                    product strategy and orchestration
│   ├── scaffold.md
│   ├── audit/                   (product-side audit, cross-cutting)
│   ├── positioning.md
│   └── workflows/               product lifecycle workflows
├── design/                      design system specs (.pen)
│   ├── foundations/             atomic tokens (colors, type, space, etc.)
│   ├── patterns/                composable design patterns
│   ├── templates/               page archetypes
│   └── design-page.md           page-level design command
└── ux/                          (in progress) UX research artifacts
    ├── personas/                persona definitions, JTBD
    ├── journeys/                journey maps, pain points
    ├── stories/                 user stories
    └── story-maps/              story maps
```

## Sub-namespaces

### `strategy/` — product strategy and orchestration

Tool-agnostic product process commands. Brief authoring,
research synthesis, scaffolding, editorial direction, SEO
strategy, migration commands, CI configuration,
constrained-mode adaptations. The orchestration commands kick
off product work and manage cross-namespace coordination
(reading manifests, dispatching to design/heroui, etc.).

The historical name was "design/product/" before the suite-
wide rename — same content, clearer name. "Strategy" reflects
the work better than "product" did when product was already
the parent namespace.

Cross-persona-readable: marketers and engineers occasionally
invoke `/product:strategy:scaffold` (during greenfield
bootstrap) or `/product:strategy:research` (when market
research is needed). Those invocations are normal and
supported.

### `design/` — design system specs

Operations on `.pen` design files: design-page, explore,
diff, export, bootstrap-from-existing. Plus the hierarchy of
design-system primitives:

- `foundations/` — atomic design tokens (a11y, colors,
  density, fonts, grids, i18n, icons, imagery, logos, motion,
  spaces, typography, z-index)
- `patterns/` — composable design patterns (banner, cta, faq,
  feature-grid, footer, hero, pricing-tier, select,
  stat-section, states, testimonial)
- `templates/` — page archetypes (auth, confirmation,
  dashboard, detail, documentation, error-page, landing-page,
  legal, list, marketing, newsroom, onboarding, pricing,
  profile, select, settings)

The historical name was "design/pencil/" before the rename.
The directory is now genericized to `design/` since other
design tools (Figma, Sketch) integrate via the integrations
layer; this namespace's commands work with `.pen` files
specifically but the framing is design-discipline-general.

Pencil specs are **framework-agnostic**. Framework bindings
(under `frameworks/`) consume Pencil specs to produce
framework-specific implementations.

### `ux/` — user research and experience

Personas, JTBD statements, journey maps, user stories, story
maps. UX research artifacts that inform but don't directly
implement product surfaces.

Sub-namespaces under `ux/`:

- `personas/` — traditional persona definitions and JTBD
  statements
- `journeys/` — customer journeys, task-level user flows,
  service blueprints, pain-point registry
- `stories/` — user stories with acceptance criteria
- `story-maps/` — Patton-style 2D story arrangements with
  release slices

UX lives under `product/` because the role handling UX
overlaps with the role handling visual design and product
strategy. Smaller teams have one person doing all of them;
larger teams may have dedicated UX researchers but the
artifacts feed into design and strategy work, so co-location
in `product/` is natural.

(See `product/ux/_context.md` for UX-specific conventions
when that namespace is built.)

### Workflows

Multi-phase orchestration playbooks for product work live
under `product/strategy/workflows/`:

- `product:greenfield` — set up new product from zero
- `product:brownfield-add-feature` — add new feature to
  existing product
- `product:brownfield-improve-page` — refresh existing page
- `product:brownfield-improve-story` — iterate on in-flight
  story
- `product:brand-refresh` — system-wide brand update
- `product:figma-roundtrip` — designer-in-Figma iteration
  loop
- `product:migrate-from-figma` — bring Figma design system
  into Pencil
- `product:migrate-to-pencil` — bring existing product UI
  into Pencil

These workflows orchestrate commands from across the suite
(design, frameworks/heroui, audit, etc.) but their primary
orchestration concern is product lifecycle. Per the
primary-domain placement rule, they live here.

When invoked: `/workflows:manage start product:<workflow-slug>`.

## Product persona's typical workflows

### Bootstrapping a new project

```
/workflows:manage start product:greenfield
```

Walks through brand foundation → tone strategy →
foundations/patterns/templates establishment → component
generation → first feature implementation. Multi-day effort
with checkpoint phases.

### Adding a new feature

```
/workflows:manage start product:brownfield-add-feature
```

Walks through brief → exploration → page design → component
generation → integration. Several hours.

### System-wide brand update

```
/workflows:manage start product:brand-refresh
```

Multi-day. Cascades from brand JSON through foundations,
components, patterns, templates, pages. High regression risk;
audit checkpoints at every phase boundary.

## Cross-persona reads

Product commands read from other personas' authored
manifests:

- `.pencil-architecture.json` (engineer-authored) — surfaces
  architectural constraints during brief generation
- `.pencil-decisions.json` (engineer-authored) — surfaces
  ADRs that constrain design choices
- `.pencil-marketing.json` (marketer-authored) — surfaces
  campaign context during landing page design
- `.pencil-marketing-calendar.json` (marketer-authored) —
  surfaces marketing windows that affect product priorities

These are reads, not authoritative inputs. Product work
proceeds independently if the manifests don't exist.

## Manifest authorship

Product-authored manifests:

- `.pencil-brand.json` — brand identity (name, colors, fonts,
  voice baseline)
- `.pencil-tone.json` — voice strategy (often co-authored
  with marketer; product drives initial creation, marketer
  iterates)
- `.pencil-typography.json`, `.pencil-icons.json`,
  `.pencil-colors.json`, `.pencil-tokens.json` — foundation
  manifests
- `.pencil-component-manifest.json` — component inventory
  (written by `product:design:design-page`)
- `.pencil-build-manifest.json` — build hash and verification
  state (written by `frameworks:heroui:build-components`)
- `.pencil-ux.json` — personas, journeys, stories, story
  maps inventory (written by `product:ux:*` commands)

## Anti-patterns

- **Product commands hardcoding framework specifics** —
  Pencil specs stay framework-agnostic. Framework specifics
  (HeroUI v3 patterns, Tailwind classes) belong in
  `frameworks/heroui/`.
- **Bypassing the audit dispatcher for product-only audit** —
  `/audit --persona product` runs product planes through the
  shared dispatcher; don't write a `product/audit.md` that
  duplicates dispatch logic.
- **Product workflows invoking marketing or engineer
  workflows** — workflows don't nest at the orchestration
  level. If a product workflow needs marketing campaign work,
  surface it as a follow-up: "Pause here; run
  `/workflows:manage start market:launch-campaign`; resume."
- **Confusing `product/` namespace with the project's
  `product/` data directory.** The suite's `product/` holds
  commands; the consuming project's `product/` (at project
  root) holds runtime manifests (`.pencil-*.json`). Same name,
  different things; context disambiguates.

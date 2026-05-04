# Product Layer — Shared Context (`product/strategy/`)

> Read this first whenever any `/product:strategy:*` command runs. All `product/strategy/`
> commands assume the conventions defined here. The `product/strategy/` namespace
> covers tool-agnostic design-system concerns: process
> orchestration, research, briefs, audits, and the
> orchestration commands (`scaffold`, `migrate`, `remove`). Product/design
> workflows live in `product/strategy/workflows/`.
>
> **Workflows across all domains** are managed by the top-level
> `workflows/` namespace (`/core:workflows:manage`). Workflow playbooks
> live in their primary domain's `workflows/` sub-namespace
> (`product/strategy/workflows/`, `market/workflows/`,
> `engineer/maintenance/workflows/`). See `workflows/_context.md` for
> the placement rule.
>
> **Tool-specific operations** live in tool-specific namespaces:
> - `product/design/` for Pencil-tool operations on `.pen` files (design,
>   exploration, foundation rendering, component specs, patterns,
>   templates)
> - `frameworks/heroui/` for the HeroUI v3 + Tailwind v4 React stack
>   (component implementation, build pipeline)
> - `market/` for cross-channel marketing concerns: brand voice
>   (`tone/`), email, social (X, Instagram, LinkedIn, Facebook,
>   TikTok), SMS, and (future) push notifications. Each channel
>   has its own sub-namespace under `market/`.
>
> When new tool namespaces are added (`figma/`, `mui/`, etc.),
> each gets its own `_context.md` documenting that namespace's
> conventions. The `product/strategy/` namespace remains the orchestration
> layer above all of them.

## Architecture — the four artifact tiers

```
foundations  →  atomic tokens (colors, type, spacing, motion, z-index, a11y)
   ↓
components   →  interactive units (buttons, forms, charts) — implementation-specific
   ↓
patterns     →  composed sections (hero, footer, pricing-tier, faq)
   ↓
templates    →  whole pages (landing, dashboard, auth, settings, marketing)
```

Each tier consumes the tier below it. Foundations have no
dependencies. Components depend on foundations. Patterns depend
on foundations + components. Templates depend on all three.

This dependency graph is encoded in the suite's
`.product-dependencies.json` manifest at the suite root. The
`scaffold`, `audit`, and `migrate` commands consult it for build
ordering and composition validation.

## Conceptual file layout (target repository)

```
design/
├── foundations/          (atomic tokens)
├── components/           (interactive units — produced by tool-specific commands)
├── patterns/             (composed sections)
├── templates/            (whole pages)
├── pages/                (per-page production designs)
├── briefs/               (per-feature briefs + derived stories)
├── explorations/         (low-fi structural alternatives)
├── research/             (competitive research outputs)
├── directions/           (multi-direction explorations)
└── .pencil-*.json        (runtime manifests — see "Runtime manifests" below)
```

Specific file paths and naming conventions within each subfolder
are documented in the tool namespace that produces them
(`product/strategy/_context.md` for `.pen` file naming, etc.). If the user
has not specified a different root, write into `design/`.

## Brand inputs (collected per workspace)

Variables every command interpolates into its embedded prompt. If
not provided as `$ARGUMENTS` and not present in repo config,
**ask the user once** and persist them to
`product/.pencil-brand.json` so subsequent commands can read them.

```jsonc
{
  "brand": "Acme",
  "tagline": "Short positioning line.",
  "industry": "B2B ed-tech",
  "audience": "k-12 administrators",
  "audienceRegulation": "k-12",         // none | k-12 | healthcare | financial-services | government
  "primary":   "#0A84FF",
  "secondary": "#7C3AED",
  "neutralWarmth": "cool",              // cool | neutral | warm
  "radiusScale": "md",                  // sharp | sm | md | lg | rounded
  "fontDisplay": "Inter",
  "fontBody":    "Inter",
  "fontMono":    "JetBrains Mono",
  "supportsDark": true,
  "supportsLight": true,
  "i18n": {
    "scripts": ["latin", "latin-ext"],
    "rtl": false
  },
  "framework": "heroui-v3"              // determines which framework namespace applies
}
```

## Runtime manifests

Files the suite produces in the user's `design/` directory. These
keep the `.pencil-` prefix because most are produced by Pencil-tool
operations or live alongside Pencil-tool artifacts:

- `product/.pencil-brand.json` — brand state (consumed across all namespaces)
- `product/.pencil-build-manifest.json` — Pencil-tool's build output
- `product/.pencil-colors.json`, `.pencil-typography.json`, etc. — foundation manifests
- `product/.pencil-recommended-patterns.md`, `.pencil-recommended-templates.md` — selection results
- `product/.pencil-workflow-state.json` — workflow tracking
- `product/.pencil-archetype-map.json` — produced by bootstrap-from-existing
- `product/.pencil-deprecations.md` — produced by remove command
- `product/.pencil-tasks.json` — multi-file task batching for Pencil CLI
- `product/.pencil-tone.json` — established voice (produced by `/market:tone:explore`)
- `product/.pencil-editorial.json` — editorial style rules (produced by `/product:strategy:editorial`)
- `product/.pencil-seo.json` — SEO + AIO strategy (produced by `/product:strategy:seo`)
- `product/.pencil-marketing-calendar.json` — annual + monthly marketing calendar (produced by `/core:workflows:manage start market:marketing-calendar-annual` and updated by `market:marketing-calendar-monthly`)
- `product/.pencil-maintenance-calendar.json` — annual maintenance calendar with per-ecosystem cadence targets, compliance constraints, capacity, and cycle history (produced by `/core:workflows:manage start engineer:maintenance-calendar-annual` and updated by `engineer:polyglot-maintenance-cycle` runs)
- `product/.pencil-marketing.json` — channel audience subsets, campaign coordination

The four suite-level manifests at the suite root use the
`.product-` prefix to distinguish them as architectural contracts
rather than runtime state:

- `.product-dependencies.json` — cross-namespace dependency graph
- `.product-research-schema.json` — research data schema
- `.product-editorial-schema.json` — editorial style schema
- `.product-seo-schema.json` — SEO + AIO strategy schema
- `.product-calendar-schema.json` — marketing calendar schema

## Token-driven styling — a universal principle

Every fill, stroke, text style, radius, shadow, and spacing value
resolves to a named token. This applies across all namespaces;
the *implementation* of that token (CSS variable in `@theme`, JS
theme object in MUI, design token in Style Dictionary) is
namespace-specific.

The framework's `_context.md` (e.g. `frameworks/heroui/_context.md`)
describes how tokens are emitted in that framework. The principle
stays the same:

- The design source of truth is the foundation `.pen` files
- Foundation manifests (`product/.pencil-typography.json`, etc.)
  reflect the canonical tokens
- The framework's runtime theme reflects the same tokens
- Components reference tokens by name, never raw values

**The extension protocol** (when a design needs a value the theme
doesn't carry) is universal:

1. Add the token to the foundation
2. Update the matching foundation `.pen`
3. Update the foundation manifest
4. Add the token to the framework's runtime theme
5. All updates land **atomically** — if any fails, none are kept

**Component-specific adjustment is a smell.** If a component file
needs a value not in the theme, the answer is to grow the theme,
not to inline. The token's narrowness is fine —
`--font-card-meta` exists in the theme even if only one component
uses it. Theme bloat is preferable to scattered arbitrary values.

## Canonical 3-breakpoint rendering — Pages, Templates, Large Organisms

This rule is **namespace-agnostic** because it concerns the design
artifact, not the rendered code. Page-tier and template-tier
designs must show the artifact rendered at all three canonical
viewport widths:

- **Mobile**: 390px (iPhone-class)
- **Tablet**: 768px (md breakpoint)
- **Desktop**: 1440px (canonical desktop)

Frames are placed side by side on the same canvas (preferred when
horizontal space allows) or in a clearly labeled vertical stack.
Each frame is labeled with its breakpoint name + viewport width
(`Mobile / 390`, `Tablet / 768`, `Desktop / 1440`).

**What qualifies as a Large Organism** (must render at all three):

- Default render width exceeds **800px**, OR
- Is a page-section primitive: navigation bar, hero section,
  sidebar, footer, full-width banner, app shell, dashboard layout
  container, sectioned content region, OR
- Contains 3+ molecules composed into a single layout, OR
- Appears on the Pages canvas at full or near-full viewport width.

**Smaller organisms and molecules >400px** follow the
framework-specific breakpoint ladder (frames at every
layout-transition point in their scope, not necessarily all three
canonical breakpoints). See `frameworks/heroui/_context.md` for the
HeroUI/Tailwind ladder.

**Atoms ≤ 400px** are exempt from multi-breakpoint rendering
unless design explicitly varies them across viewports.

## Agent latitude — where to apply judgment

The commands in this suite document HOW to think about each task —
the framing, constraints, gates, and failure modes. They preserve
substantial creative space for the agent executing them. Where the
prose looks prescriptive but the agent should apply judgment:

**Reporting blocks are illustrative, not templates.** Every
command's `Reporting` example shows one plausible output shape for
one plausible situation. Adapt wording, level of detail, and
structure to what actually happened — a successful audit with zero
findings deserves a much shorter report than the example suggests;
a complex multi-phase run may warrant more. The example anchors
the *kind* of information to surface, not the exact words.

**Argument hints list what's available, not what's required.** A
command's `argument-hint` may show 8-12 flags. Pick only those
relevant to the situation. Most commands work well with the
positional argument and one or two flags; applying every flag
often produces mechanical responses. When the user hasn't asked
for a specific flag's behavior, default behavior is usually right.

**Default Ns are starting points.** When a command suggests
`--n 3`, `--directions 3`, or "5 candidates", these are sensible
defaults — not requirements. Pick the right N for the situation:
fewer when the brief is clear and time is tight; more when
exploration is genuinely needed; one when the user's intent is
unambiguous and a candidate set would just slow the work down.

**Workflow phase ordering encodes required dependencies, not
required serialization.** When a workflow's phase shows command
X before Y, it's because X's outputs feed Y's inputs. Within a
phase, or between independent phases, batch and parallelize where
the dependency graph permits.

**What is NOT loose:** token naming conventions, manifest
schemas, file paths, audit lint regex patterns, brand JSON
fields, cross-command field contracts (e.g. `imagery.assets[]`
keys read by `product/design/patterns/states.md`), the `@theme` ↔
foundation `.pen` ↔ foundation manifest atomic-write protocol,
dependency graph in `.product-dependencies.json`. Drift in these
breaks the system.

## Framework selection (when multiple are available)

The active framework is declared in `product/.pencil-brand.json`
as `framework: <name>`. Default: `heroui-v3`. Commands within a
framework namespace (e.g. `/core:frameworks:heroui:components:buttons`) only run
when their framework matches the project's active framework.

To switch frameworks mid-project, run
`/product:strategy:migrate --framework <new>` which surfaces the structural
changes required (component API mappings, theme integration
shifts, build pipeline differences) before applying.

When new framework namespaces are added to the suite, each
documents its own component cascade, build pipeline, and
integration-specific rules in its `_context.md`. The top-level
architecture (foundations / patterns / templates) stays the same;
the implementation specifics swap.

## Tool-namespace selection

The current namespaces are `product/design/` (design tool), `frameworks/heroui/`
(framework), and `market/` (cross-channel marketing). Future
versions may add `figma/` for Figma-native operations, `mui/` or
other framework namespaces, etc. Each namespace owns operations
specific to its delivery medium or stack.

The `product/strategy/` namespace stays orthogonal — `brief`, `research`,
`audit`, etc. work regardless of which downstream
namespace produces the actual artifacts. The `workflows/` namespace
is similarly cross-cutting — workflows from any domain run through
the same `/core:workflows:manage` state machine. This is the architectural
promise: process is tool-agnostic; tool/medium implementations
swap independently.

Cross-namespace upstream commands (like `market/tone/explore`)
sit between `product/strategy/` and channel-specific namespaces — they
inform but don't produce final artifacts. The pattern: a brief +
research feeds tone establishment, which feeds channel-specific
production. This same pattern would work for future cross-cutting
concerns.

# Frameworks — Grouping Context

> Framework adapter implementations. Read this when working
> with `frameworks/` namespace.
>
> The frameworks layer holds adapter implementations that
> translate persona-agnostic outputs (design specs, components,
> documentation needs) into framework-specific artifacts.

## What `frameworks/` contains

```
frameworks/
├── _context.md                  (this file)
├── _index.md                    decision tree across bindings
├── init.md                      detect and activate framework bindings
├── manifest.md                  query/manage binding state
│
├── heroui/                      HeroUI v3 + Tailwind v4 + React component binding
│   ├── _context.md
│   ├── build-components.md
│   └── components/
│
└── storybook/                   Storybook framework-aware component documentation
    ├── _context.md
    ├── _index.md
    ├── init.md                  storybook-specific deep configuration
    ├── stories/                 authoring (gen, gen-missing, doc)
    ├── verify/                  validation (in progress)
    ├── migration/               framework-version migration (in progress)
    ├── chromatic.md             Chromatic integration (in progress)
    └── catalog.md               inventory and reporting (in progress)
```

Two control-plane commands at the grouping level (`init.md`,
`manifest.md`) plus per-binding namespaces.

## Two kinds of framework adapters

`frameworks/` covers two distinct kinds of adapters:

### Component bindings

Translate framework-agnostic design specs into framework-
specific component code. Example: `frameworks/heroui/`
takes Pencil specs and produces HeroUI v3 + Tailwind v4 + React
components.

Future component bindings would be peers under `frameworks/`:
- `frameworks/mui/` — Material UI binding
- `frameworks/chakra/` — Chakra binding
- `frameworks/shadcn/` — shadcn/ui binding
- `frameworks/vue-equivalent/` — a Vue-based design system binding
- `frameworks/swiftui/` — native iOS binding

Each component binding produces code; the design source
of truth (Pencil specs) stays in `product/design/` and is
consumed by all bindings.

### Documentation bindings

Translate components into a framework-aware browseable
documentation surface. Example: `frameworks/storybook/` works
with whichever Storybook adapter is in use
(`@storybook/nextjs`, `@storybook/react-vite`,
`@storybook/sveltekit`, `@storybook/vue3-vite`, etc.) and
adapts story generation, verification, and migration to that
framework.

Future documentation bindings might include:
- `frameworks/ladle/` — Ladle (lighter-weight component
  documentation tool)
- `frameworks/histoire/` — Histoire (Vue-flavored storybook
  alternative)

Both kinds share the structural pattern: framework-aware
tooling consumed by multiple personas.

## Why `frameworks/` is a top-level grouping

Framework bindings are persona-orthogonal. Designer uses them
(generating components from Pencil specs, reviewing rendered
documentation). Engineer uses them (implementing features
using the components, verifying story health). Putting frameworks
under either persona's grouping mislabels them.

The grouping says: **this is the framework adaptation layer,
consumed by multiple personas.**

## Runtime manifest

Framework binding state is captured in
`product/.pencil-frameworks.json`:

```jsonc
{
  "version": 1,
  "lastUpdated": "<ISO timestamp>",

  "componentBindings": {
    "heroui": {
      "active": true,
      "version": "3.0.0",
      "stack": ["react", "tailwind-v4", "next.js"],
      "detectedFrom": ["package.json:@heroui/react", "package.json:tailwindcss"],
      "lastDetected": "<ISO timestamp>",
      "lastVerified": "<ISO timestamp>",
      "lastReviewed": "<ISO timestamp>"
    }
  },

  "documentationBindings": {
    "storybook": {
      "active": true,
      "version": "10.3.4",
      "adapter": "@storybook/nextjs",
      "configDir": "app-ui/.storybook/",
      "detectedFrom": ["package.json:storybook", "package.json:@storybook/nextjs"],
      "lastDetected": "<ISO timestamp>",
      "lastVerified": "<ISO timestamp>",
      "lastReviewed": "<ISO timestamp>"
    }
  },

  "stalenessThresholds": {
    "detectionDays": 30,
    "verificationDays": 14,
    "reviewDays": 180
  }
}
```

Schema: `.product-frameworks-schema.json` at suite root.

## Activation gate

Every framework-binding command checks `.pencil-frameworks.json`
for activation before running. If the binding isn't active,
the command refuses to run with a clear message:

```bash
# Pre-flight in any framework-binding command
BINDING_NAME="heroui"  # or "storybook", per command
ACTIVE=$(jq -r ".componentBindings.${BINDING_NAME}.active // false" \
              product/.pencil-frameworks.json 2>/dev/null)

if [ "$ACTIVE" != "true" ]; then
  echo "The ${BINDING_NAME} framework binding is not active for"
  echo "this project. If you intend to use ${BINDING_NAME}, run"
  echo "/frameworks:init to detect and activate it."
  exit 1
fi
```

This gate is what makes the manifest meaningful — without the
check, the manifest would be passive documentation; with the
check, it's enforcement.

The auto-trigger pattern still applies: if
`.pencil-frameworks.json` is missing entirely (fresh project),
framework-binding commands trigger `/frameworks:init` so the
user is walked through detection rather than blocked.

## Two layers of detail

The framework manifest captures **binding activation** —
which bindings are active, what version, which adapter, when
last verified. Per-binding deep configuration lives in
binding-specific manifests:

- `.pencil-storybook.json` — Storybook deep configuration
  (stories glob, provider stack, addon inventory, screenshot
  settings, visual regression preferences, known gotchas)
- (Future: `.pencil-heroui.json` if heroui ever needs deep
  configuration beyond what Pencil and `package.json` declare)

Two layers, two manifests:
- **`.pencil-frameworks.json`** — what's active (cross-binding,
  binary)
- **`.pencil-<binding>.json`** — how to operate it (per-
  binding, detailed)

The `/frameworks:init` command activates bindings (writes the
top layer); per-binding init commands configure them (write
the detail layer). Both exist; they cooperate.

## Staleness discipline

Each binding entry carries three timestamps tracking different
concerns:

- **`lastDetected`** — when init last scanned for this binding.
  Updates whenever `/frameworks:init` runs (full or
  `--update` mode).
- **`lastVerified`** — when values were last checked against
  current project state (version still matches package.json,
  adapter still matches). Updates whenever
  `/frameworks:init --check` runs.
- **`lastReviewed`** — when the user last explicitly confirmed
  this binding's activation. Updates only on full
  `/frameworks:init` runs (with explicit user confirmation)
  or `/frameworks:manifest --review`.

Three different thresholds drive three different actions:

| Threshold | Default | Action when exceeded |
|-----------|---------|---------------------|
| Verification staleness | 14 days | Soft warning in pre-flight: "values last verified $N days ago; run `/frameworks:init --check` to re-verify" |
| Detection staleness | 30 days | Audit surfaces as drift candidate (when combined with project changes since lastDetected) |
| Review staleness | 180 days | Annual review workflows prompt the user to confirm or update |

These thresholds are **soft**, not blocking. Pre-flight
warnings surface the possibility of staleness without
blocking command execution. The thresholds are
project-configurable in the manifest's `stalenessThresholds`
field; defaults apply when absent.

### Three verbs for three timestamp updates

The three commands that touch timestamps use deliberate
verb choices:

- **`/frameworks:init`** (full) — activation. Updates
  `lastDetected`, `lastVerified`, AND `lastReviewed`. The user
  is explicitly going through activation.
- **`/frameworks:init --check`** — verification. Updates
  `lastVerified` only. Re-confirming values without re-asking.
- **`/frameworks:init --update`** — detection refresh. Updates
  `lastDetected` and `lastVerified`. Re-detection without
  explicit user review.
- **`/frameworks:manifest --review`** — explicit revisitation.
  Updates `lastReviewed` only. The user affirming "yes, I
  still want these active."

Different verbs for different intents. The user picks the verb
that matches what they want to do.

`/audit` reads timestamps but never updates them.

## Detection patterns

`/frameworks:init` detects bindings from project state:

| Binding | Detection signals |
|---------|-------------------|
| heroui | `package.json` deps include `@heroui/react` AND `tailwindcss` |
| mui | `package.json` deps include `@mui/material` |
| chakra | `package.json` deps include `@chakra-ui/react` |
| shadcn | Filesystem heuristic: `components/ui/` directory + `tailwindcss-animate` + components matching shadcn patterns (no specific package) |
| storybook | `package.json` devDeps include `storybook` AND `@storybook/<adapter>` (the adapter name identifies the framework) |
| ladle | `package.json` deps include `@ladle/react` |
| histoire | `package.json` devDeps include `histoire` |

Detection is best-effort signal-based. The user confirms or
corrects each detected binding during init.

## Per-binding init relationship

Bindings that have deep configuration get their own init:

- `frameworks/heroui/` — currently no init; build-components
  handles its own discovery. Could add `frameworks/heroui/init.md`
  later if heroui configuration grows.
- `frameworks/storybook/` — has `frameworks/storybook/init.md`
  for detailed configuration (stories glob, provider stack,
  addon inventory, screenshot settings, visual regression,
  lint, etc.)

`/frameworks:init` activates bindings (the binary "is this
binding in use?" question). Per-binding inits configure them
(the "how do we operate it?" details). Users typically run
`/frameworks:init` once on a fresh project, then run each
active binding's deep init for full configuration.

When a framework-binding command runs and finds the binding
active in `.pencil-frameworks.json` but missing fields in the
binding-specific manifest, that command auto-triggers the
binding's deep init for just the fields it needs (matching the
auto-trigger pattern from storybook commands).

## Multi-binding projects

A project might use multiple bindings simultaneously:

```jsonc
{
  "componentBindings": {
    "heroui": { "active": true, ... },
    "shadcn": { "active": true, ... }
  }
}
```

Both bindings' commands run when active. Audit surfaces the
multi-binding situation; if it seems unintended (e.g.,
experimental binding left active), the user removes via
`/frameworks:manifest --deactivate <binding>`.

## Empty manifest case

A project with no detected bindings has an empty manifest:

```jsonc
{
  "version": 1,
  "componentBindings": {},
  "documentationBindings": {}
}
```

That's fine. Backend-only Spring Boot projects, pure Python
data platforms, native mobile-only projects — they don't use
component or documentation bindings. Framework-binding commands
refuse to run with the activation gate's message; other suite
commands (engineer/architecture, market/email, etc.) work
without bindings.

The empty-manifest case is the signal that this project doesn't
use framework bindings. Audit surfaces "no framework bindings
detected; that's expected for non-UI projects" as info-level.

## Relationship to other groupings

```
product/design/                   (framework-agnostic design specs)
   │
   │ produces .pen files
   ▼
frameworks/<component-binding>/  (framework-specific component code)
   │
   │ produces components
   ▼
frameworks/storybook/            (framework-aware documentation)
   │
   │ produces stories + verification
   ▼
[users see the rendered output]
```

Multiple component bindings can consume the same Pencil specs.
A web project might use heroui binding for the main app while
a marketing landing page uses shadcn binding; both consume the
same brand foundations from Pencil, both get documented via
the storybook binding.

## Bindings as composition, not as forks

Each binding is self-contained and produces framework-specific
code. Bindings don't fork the design system; they implement it
for a specific stack. The design source of truth stays in
`product/design/`; bindings translate it.

This means:

- **Adding a new binding** doesn't require modifying any other
  binding. New `frameworks/mui/` is a new namespace alongside
  `frameworks/heroui/`. Each gets its own activation entry in
  the framework manifest.
- **Bindings can disagree on details** — heroui's button might
  use compound component pattern; mui's button might use
  variant prop. Both are valid translations of the same Pencil
  pattern.
- **Cross-binding consistency** comes from Pencil specs, not
  from binding code. If two bindings both produce a "Button"
  from the Pencil button pattern, they're consistent because
  they share input.

## Shared logic (`frameworks/_shared/`)

Currently absent. When a second component binding is added
(MUI, shadcn, etc.) and bindings share logic — Pencil-spec
consumption patterns, component-shape utilities, type
generation — extract to `frameworks/_shared/`.

YAGNI for now — only one component binding exists.

## Slash command pattern

```
/frameworks:init                            # detect and activate bindings
/frameworks:init --check                    # verify only
/frameworks:init --update                   # re-detect
/frameworks:manifest                        # show current state
/frameworks:manifest --query <jq-path>      # query specific field
/frameworks:manifest --review               # explicit revisitation
/frameworks:manifest --deactivate <binding> # remove a binding

/frameworks:heroui:build-components         # heroui binding command
/frameworks:storybook:init                  # storybook deep configuration
/frameworks:storybook:stories:gen Button    # storybook story generation
/frameworks:storybook:verify:health         # storybook verification
```

## Storybook is a framework adapter, not its own grouping

Storybook lives at `frameworks/storybook/` (not its own
top-level grouping) because it IS a framework adapter system
at its core. The whole `@storybook/<adapter>` ecosystem exists
precisely because Storybook adapts to the framework you're
using:

- `@storybook/nextjs` — adapts Storybook for Next.js
- `@storybook/react-vite` — adapts for React + Vite
- `@storybook/sveltekit` — adapts for SvelteKit
- `@storybook/vue3-vite` — adapts for Vue 3 + Vite
- `@storybook/angular` — adapts for Angular

The adapter's job is to make Storybook's component rendering,
autodocs generation, and addon system work natively with that
framework's conventions. That's literally framework adaptation
— the same shape as what `frameworks/heroui/` does.

Putting Storybook under `engineer/` would mislabel it as
engineer-specific work; it's actually framework-coupled work
consumed by multiple personas. Putting it as its own top-level
grouping would over-fragment the structure.

## Anti-patterns

- **Framework-specific logic in `product/design/`** — Pencil
  specs are framework-agnostic. If a pattern's code emission
  starts hardcoding React, it belongs in
  `frameworks/heroui/` instead.
- **Cross-binding direct invocation** — bindings don't invoke
  each other. If a project uses both heroui and shadcn, they
  consume the same Pencil specs but produce independent code.
- **Fork copies of bindings for project-specific tweaks** —
  project-specific adaptations live in the project's own
  configuration (manifests, theme overrides), not by
  forking the binding namespace.
- **Persona-specific logic in framework bindings** — bindings
  are persona-orthogonal. If a binding command starts caring
  about who's invoking it (designer vs engineer), that's a
  smell.
- **Bypassing the activation gate** — every framework-binding
  command checks `.pencil-frameworks.json` for activation.
  Don't write commands that assume their binding is active.
- **Treating storybook as engineer-specific** — it's a framework
  adapter system that works across React/Vue/Svelte/Angular/etc.
  The persona-orthogonal placement under `frameworks/`
  acknowledges this.

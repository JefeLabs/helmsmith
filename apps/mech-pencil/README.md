# @helmsmith/mech-pencil

Generate [Pencil](https://docs.pencil.dev) `.pen` design systems, themes,
and mockups from a faithful **HeroUI v3** component catalog — all 71
documented components, React-named, token-bound, themeable.

A `.pen` / `.lib.pen` is plain pretty-printed JSON on disk (schema
**v2.11**). `mech-pencil` writes it directly. Two file roles matter:

- **`.pen`** — a document. Opened in Pencil, it *resolves its
  `imports`* (so it themes standalone).
- **`.lib.pen`** — an import-only library. Opened by itself it does
  **not** resolve its imports (renders unthemed); it's meant to be
  imported by a `.pen`. Every importable `.lib.pen` ships with a
  `.preview.pen` twin you can open to view it themed.

## Install

```bash
npm install -g @helmsmith/mech-pencil   # or: bun run src/cli.ts <cmd>
```

## Quick start

```bash
# Single self-contained, themed .pen (HeroUI Themes knobs)
mech-pencil theme -a "#3f5694" -b 0.0015 --font inter -r medium -d ./out

# Two-file swappable: design-tokens.lib.pen + design.pen (imports it)
mech-pencil brand ./brand.json -d ./out

# Full layered bundle (reuses the committed HeroUI library; only
# design-tokens.lib.pen is per-project)
mech-pencil bundle -a "#3f5694" -r large -d ./out

# Inspect / validate
mech-pencil list --framework heroui
mech-pencil validate ./out/design.pen
```

Open `*.preview.pen`, `mocks/*.pen`, or the `theme`/`init` output in
Pencil to view themed. `*.lib.pen` are for importing, not previewing.

## Commands

Run `mech-pencil` with **no arguments** in a terminal → an interactive
wizard (choose framework → theme values → review → emits the layered
bundle). Piped / CI (non-TTY) prints the static banner instead — the
verbs below are the non-interactive equivalents.

| Command         | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| _(no args)_     | Interactive wizard → layered bundle (TTY only; banner otherwise)        |
| `theme`         | One themed `.pen` from HeroUI Themes knobs (accent/base/font/radius)     |
| `brand`         | Two files: swappable `design-tokens.lib.pen` + `design.pen`             |
| `bundle`        | Layered set; reuses the committed HeroUI library, writes only tokens    |
| `build-library` | **Maintainer**: regenerate the committed HeroUI library                 |
| `init`          | One self-contained `.pen` (static HeroUI default theme)                  |
| `list`          | List frameworks / a framework's atomic component catalog                |
| `manifest`      | Emit the compact component/token/constraint index (agent context)       |
| `validate`      | Structurally validate a `.pen` (v2.11 rules)                            |
| `connect`       | Uniform connections TUI (offline — no connections required)             |

The `manifest` JSON is what agents (and the `skill/pencil-skill-router`
Agent Skill, shipped under `skill/`) consult to compose screens or
generate React from the system — never the raw library.

`bundle` knobs (HeroUI Themes parity): `-a/--accent <hex|oklch>`,
`-b/--base <0–0.02>`, `--font <name>`, `-r/--radius <preset>`,
`--form-radius <preset>`, `--regenerate` (rebuild instead of reuse).

## Layered bundle topology

```
out/
├── design-tokens.lib.pen          LAYER 1  variables only — the only per-project file
├── core/<category>.lib.pen        LAYER 2  HeroUI Storybook categories (import tokens)
│   └── core/<category>.preview.pen          viewable twin (themes standalone)
├── design-system/<level>.lib.pen  LAYER 3  one file per atomic level —
│   └── design-system/<level>.preview.pen     atoms · molecules · organisms ·
│                                              templates (+ viewable twins)
└── mocks/<slug>.pen               LAYER 4  imports tokens; LOCAL component copies +
                                            screen — customizable, brand-linked
```

(`<level>` = `atoms` | `molecules` | `organisms` | `templates`;
`templates` is an empty placeholder until template-level components
exist.)

Components reference tokens cross-file as `$tokens:color.accent`,
`$tokens:radius.md`, … Swap or regenerate `design-tokens.lib.pen`
(different accent/base/radius/font) and the whole system reskins —
no other file changes.

## Generate vs. reuse

The HeroUI component layer (`core/`, `design-system/`, mock skeletons
+ their previews) is **theme-invariant** — pure `$tokens:` references,
byte-identical across every theme (enforced by a regression test). So
it's generated **once** and committed at
`src/frameworks/heroui/library/` (shipped via `package.json#files`).

- `mech-pencil build-library` — maintainer command: wipes and
  regenerates the committed library (run when the component catalog
  changes; custom components flow into every layer + preview).
- `mech-pencil bundle` (default) — **copies** the committed library
  and writes only `design-tokens.lib.pen` (defaults + your overrides).
  `--regenerate` rebuilds everything from scratch instead.

So in steady-state per-project use the component builders don't run —
the committed library is the baked artifact.

## Verified Pencil constraints (why it's shaped this way)

Empirically established against the live Pencil app:

- Node `id` MUST NOT contain `/` (the slash is the `descendants`
  path separator). Ids are slugged accordingly.
- Cross-file **variables** resolve via `$<alias>:<key>` for the
  importer's own nodes — this is how theming flows from
  `design-tokens.lib.pen`.
- Cross-file **component `descendants` overrides do not apply**
  (only root-prop overrides cross). So mocks keep **local** copies of
  the components they customize (titles/labels) — never live refs into
  the libs. Lineage is recorded in each component's `metadata.source`.
- A `.lib.pen` opened standalone doesn't resolve its `imports` →
  hence the `.preview.pen` twins for viewing.

## Architecture

```
src/
├── pen/            .pen v2.11 schema engine (schema/builder/document/validate)
├── color/          OKLCH/OKLab engine (mixOklab → resolves HeroUI color-mix)
├── theme/          HeroUI Themes `generateThemeColors` port (config + generate)
├── brand/          brand.json schema → token variables
├── design-system/  framework-agnostic token + atomic model
├── frameworks/     every child is a framework namespace `<id>/`, except
│   ├── _core/      `_`-prefixed agnostic seam: adapter.ts + registry.ts
│   ├── heroui/
│   │   ├── index.ts      the FrameworkAdapter implementation
│   │   ├── catalog.ts    71-component catalog; RICH builder registry;
│   │   │                 React names + category + atomic + metadata
│   │   ├── components/   the builders: button, card, primitives, controls,
│   │   │                 display, complex, stub  (run at generation time)
│   │   ├── tokens.ts / derive.ts   HeroUI v3 token data + shared derive engine
│   │   └── library/      COMMITTED baked output (build-library) — reused by bundle
│   └── heroui-pro/ index.ts — reuses heroui's tokens/components/mockups
├── emit/           document (init/theme) · brand · bundle
├── tui/            no-args wizard: WizardView.tsx (React/openTUI page,
│                   composed from @helmsmith/tui-view-components) +
│                   wizard-config.ts (pure, testable step/validate logic)
└── commands/       one file per CLI verb (incl. wizard.ts → runs the TUI)
```

All framework-specific code lives under `frameworks/<id>/` (one
directory per framework). The framework-agnostic seam is the sole
exception and is quarantined under the `_`-prefixed `frameworks/_core/`,
so every non-`_` child of `frameworks/` is a framework by construction.

Adding a framework = create `src/frameworks/<id>/index.ts` implementing
`FrameworkAdapter`, register it in `src/frameworks/_core/registry.ts`.
Adding/altering a component = edit a
`components/*.ts` builder (or the `RICH` map in `catalog.ts`), then
`mech-pencil build-library` and commit the regenerated library.

## Development

```bash
bun run src/cli.ts <cmd>     # run from source
npm test                     # vitest unit tests
npm run test:e2e             # drives the real CLI end-to-end
npm run typecheck
npm run build                # tsup → dist/
```

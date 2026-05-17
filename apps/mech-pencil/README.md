# @ecruz165/mech-pencil

Generate [Pencil](https://docs.pencil.dev) `.pen` design systems and
base mockups, programmatically, from pluggable framework adapters.

`mech-pencil` understands the [`.pen` v2.10
format](https://docs.pencil.dev/for-developers/the-pen-format) and
emits two coordinated artifacts:

- **`design-system.lib.pen`** — a Pencil design library: every design
  token as a themed `variable`, every framework component as a
  `reusable` node, atomic-design ordered (atoms → molecules →
  organisms).
- **base mockups** (`mockups/*.pen`) — screens that `import` the
  library and compose it via `ref` instances, exactly the cross-file
  mechanism the spec describes.

First adapter: **HeroUI v3** (and `heroui-pro`, which reuses v3's
tokens/components and adds Pro composed blocks).

> A `.pen`/`.lib.pen` is plain, pretty-printed JSON on disk — this is
> the documented developer path. (Distinct from the Pencil *editor*
> MCP, which treats live editor files as opaque.)

## Install

```bash
npm install -g @ecruz165/mech-pencil
```

## Quick start

```bash
# Scaffold a full workspace (library + mockups) into ./design
mech-pencil init --framework heroui --dir ./design

# Or step by step
mech-pencil gen-library --framework heroui --out ./design
mech-pencil gen-mockup  --framework heroui --out ./design

# Inspect a framework's atomic catalog
mech-pencil list --framework heroui

# Validate any .pen (a mockup checks against its library)
mech-pencil validate ./design/design-system.lib.pen
mech-pencil validate ./design/mockups/app-shell.pen --lib ./design/design-system.lib.pen
```

## Commands

| Command       | Purpose                                                        |
| ------------- | -------------------------------------------------------------- |
| `init`        | One-shot scaffold: `design-system.lib.pen` + base mockups      |
| `gen-library` | Emit the design system library only                            |
| `gen-mockup`  | Emit base mockups that import an existing library              |
| `list`        | List frameworks, or one framework's atomic component catalog   |
| `validate`    | Structurally validate a `.pen` against the v2.10 schema rules  |
| `connect`     | Uniform connections TUI (no connections required — offline)    |

## Architecture

```
src/
├── pen/           .pen v2.10 schema engine (schema, builder, document, validate)
├── color/         OKLCH/OKLab engine — pre-resolves HeroUI's color-mix() tokens
├── design-system/ framework-agnostic token + atomic-design model
├── frameworks/    FrameworkAdapter seam + heroui (v3) + heroui-pro adapters
├── emit/          adapter → library / mockup PenDocument
└── commands/      one file per CLI verb
```

Adding a framework = implement `FrameworkAdapter` and register it in
`src/frameworks/registry.ts`. No emitter or command changes.

## Two intentional contribution points

This app was scaffolded leaving two genuine design decisions explicit
(both degrade gracefully so the CLI works before they're filled in):

1. **`src/color/mix.ts` — `mixOklab()`**: the `color-mix(in oklab, …)`
   semantics HeroUI uses to derive every hover/soft/border token.
   Premultiplied vs. straight alpha, weight normalization — your call.
   Until implemented, derived tokens are skipped (base tokens still
   emit, with a warning).
2. **`src/frameworks/heroui/components/button.ts` — `buildButton()`**:
   how Button's variant×color×size matrix maps onto reusable `.pen`
   nodes. Modeled on the fully-authored `components/card.ts`. Until
   implemented, Button falls back to the generic token-driven stub.

## Development

```bash
bun run src/cli.ts list      # run from source
npm test                     # vitest unit tests
npm run test:e2e             # drives the real CLI end-to-end
npm run typecheck
npm run build                # tsup → dist/
```

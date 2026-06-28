---
name: pencil-skill-router
description: >-
  Use when building a Pencil (.pen) screen/mockup or generating React UI
  from the HeroUI v3 design system, or theming/regenerating it, via the
  `mech-pencil` CLI. Routes the request using the mech-pencil manifest and
  encodes the verified Pencil constraints so you never rediscover them.
  Triggers: "build a screen/mockup in Pencil", "lay out a UI", "generate
  the HeroUI React for this", "re-theme the design system", "make a .pen".
---

# pencil-skill-router

You are routing work against **mech-pencil** — a deterministic generator
that emits a themed HeroUI v3 design system as `.pen` files. Do **not**
hand-build components or load the raw generated library into context.

## Step 0 — always: read the manifest, not the library

```
mech-pencil manifest            # compact JSON: components, tokens, constraints, commands
```

The manifest is the index. Each component has: `id` (the `ref` target),
`react` + `package` (the codegen mapping), `atomic`, `category`,
`customizable` (descendant ids you may patch + which props), `tokens`.
The library `.pen` files are ~tens of thousands of lines — never read
them; the manifest is ~1–2 KB and authoritative.

**Obey `manifest.constraints` exactly.** They are verified Pencil
behaviour; violating them silently breaks output. The critical ones:

- Node `id` never contains `/` (it's the descendants path separator).
- **Cross-file component `descendants` are dropped** (property AND
  slot/children). Customizable instances must be **LOCAL** to the file.
- Only root props on a `ref` cross files. Cross-file *variables* DO
  resolve via `$alias:key` — that's how theming flows.
- A `.lib.pen` opened alone does NOT resolve its imports → open the
  matching `.preview.pen` (a regular `.pen`) to view themed.
- Pencil MCP: re-`open_document` on an already-open path does NOT
  reload — verify from a fresh filename or a single screenshot lies.

## Routing

**Need a themed system / starting point** → pick the command:
- `mech-pencil bundle -a <accent> [-b <base>] [-r <radius>] [--font <f>] -d <dir>`
  → `design-tokens.lib.pen` + `core/<category>.{lib,preview}.pen` +
  `design-system/<level>.{lib,preview}.pen` + `mocks/template.pen`
  (full local palette). Reuses the committed library; only
  `design-tokens.lib.pen` is per-project.
- `mech-pencil theme …` → one self-contained themed `.pen`.
- `mech-pencil brand <brand.json> …` → swappable tokens + design.pen.

**Build a Pencil screen/mockup** → start from a copy of
`mocks/template.pen` (it already imports tokens and embeds all 71
components LOCALLY → they appear in Pencil's component panel, drag-able
and editable). Compose by inserting `{"type":"ref","ref":"<id>"}`
(local id from the manifest) into the screen frame. Customize **only**
via `descendants` keyed by a `manifest.customizable[].id`
(e.g. `{"descendants":{"card-title":{"content":"…"}}}`). Style with
`$tokens:<key>`. Never cross-file ref + descendants.

**Generate React from a screen** → for each `ref`, look up the
component in the manifest: emit `import { <react> } from "<package>"`;
map each applied `descendants` part to the component's prop/children
API (use Code Connect mappings where present; the `customizable`
overrides tell you what was set).

**Re-theme** → re-run `bundle`/`theme` with new
`-a/-b/-r/--font`, or swap `design-tokens.lib.pen`. The component
layer is theme-invariant and reused — don't regenerate components.

**View themed** → open `*.preview.pen` or `mocks/*.pen` (regular
`.pen`). Never preview a `*.lib.pen` standalone.

**Component not in the catalog** → the only real fallback: generate it
via Pencil/AI once, then add a builder + run `mech-pencil build-library`
so it becomes deterministic. Don't ad-hoc it per screen.

## Don't

- Don't read/inline the generated `.pen` library — use the manifest.
- Don't cross-file `ref` + `descendants` (silently dropped).
- Don't invent component ids/tokens — only those in the manifest.
- Don't hand-author components — that's what the generator is for.

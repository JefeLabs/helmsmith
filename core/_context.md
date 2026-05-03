# Core — Grouping Context

> Cross-persona infrastructure. Read this when working with
> audit dispatch or other shared substrate.

## What `core/` contains

`core/` holds infrastructure used by every persona:

- **`core/audit/`** — cross-persona audit dispatcher and
  per-persona plane definitions
- Future: `core/schemas/` (manifest schemas, currently at suite
  root)

The principle: anything that crosses every persona belongs in
core. Currently that's just audit; the workflow management
state machine is also cross-persona but lives in top-level
`workflows/` (its own grouping) for command discoverability
(`/workflows:manage` rather than `/core:workflows:manage`).

## Audit pattern

The audit dispatcher (`core/audit/audit.md`) is the single
audit entry point regardless of which persona kits are in use.
It discovers installed personas by checking for plane definition
files in `core/audit/_planes/<persona>.md`, then dispatches to
those plane definitions.

This pattern enables:

- **Selective installation** — projects without the marketer
  persona simply don't ship `_planes/market.md`; their audit
  runs only the planes they have
- **Persona-owned plane evolution** — when a persona adds a new
  plane (e.g., engineer adding architecture drift Plane 12), it
  edits its plane file; the dispatcher discovers it
  automatically
- **Cross-persona aggregation** — one audit run produces a
  single integrated report spanning all installed personas

See `core/audit/audit.md` for the dispatcher; see
`core/audit/_planes/{design,market,engineer}.md` for plane
definitions per persona.

## Plane numbering convention

Plane numbers are globally unique across personas. Current
allocation:

| Range | Persona | Status |
|-------|---------|--------|
| 1-7 | design | active |
| 8-10 | market | active |
| 11 | engineer (maintenance) | active |
| 12 | engineer (architecture) | planned |
| 13 | engineer (development) | planned |

When adding a new plane, take the next available number. The
plane definition's `kit` field in metadata names which persona
owns it.

## Future core additions

Likely additions over time:

- **`core/schemas/`** — manifest schemas may move here for
  organizational tidiness; currently at suite root for visibility
- **`core/conventions/`** — shared bash patterns (manifest
  reading, Storybook check prerequisites, browser cleanup) that
  many commands reference; currently inlined in each command's
  `_context.md`
- **`core/cli/`** — if the suite ever ships a CLI tool wrapping
  the slash commands, its definition may live here

These are not built yet. Document them in `_context.md` as they
emerge.

## What does NOT belong in core

- **Persona-specific commands** — even if a command is heavily
  used by multiple personas, it belongs to the persona that
  authors its outputs. The marketer reading `.pencil-tone.json`
  doesn't move tone management to core; tone authoring lives in
  `market/tone/` because the marketer authors it.
- **Workflow playbooks** — workflows live in their primary
  domain's `<persona>/workflows/`. The state machine is shared
  (in top-level `workflows/`); the playbooks aren't.
- **Framework bindings** — those live in `frameworks/`, not
  core.

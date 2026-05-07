# Design Workflows — Domain Context (`product/design/workflows/`)

> Read this in addition to `workflows/_context.md` and
> `product/design/_context.md` whenever working with design-domain
> workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is the design layer — moving an existing
> codebase or Figma file into Pencil, or coordinating
> designer-in-Figma iteration loops. Per the primary-domain
> placement rule (see `workflows/_context.md`), these workflows
> live here because their dominant work happens against the
> design system rather than product strategy or brand identity.

## Workflows in this sub-namespace

3 workflows currently:

- **`design:migrate-to-pencil`** — Bring existing product UI into Pencil (5 phases)
- **`design:migrate-from-figma`** — Bring Figma design system into Pencil (5 phases)
- **`design:figma-roundtrip`** — Designer-in-Figma iteration loop (6 phases)

For workflows that orchestrate scaffolding from zero, brand
updates, or feature/page additions, see
`product/strategy/workflows/`. See `workflows/_index.md` for the
unified decision tree across all domains.

## Conventions specific to design workflows

Beyond the universal workflow conventions in
`workflows/_context.md`:

### Figma interoperability is the through-line

Every workflow here assumes Figma is in the loop somewhere:

- `figma-roundtrip` — Figma is the source of designer iteration;
  Pencil syncs both directions
- `migrate-from-figma` — Figma is the source-of-truth design
  system; Pencil is the destination
- `migrate-to-pencil` — Figma is optional but commonly involved
  for higher-fidelity capture during the migration

When `open-pencil` is on PATH, all three workflows gain richer
Figma capture and round-trip capabilities. Without it they fall
back to Figma REST/MCP for read-only extraction.

### Migration workflows assume baseline state

`migrate-to-pencil` and `migrate-from-figma` assume the existing
artifacts (shipped UI or Figma files) are canonical.
Pencil-managed state should reflect them without breaking
production. Don't conflate "migrate" with "redesign" — those are
separate workflows (run a `brownfield-improve-*` from
`product/strategy/workflows/` after migration completes).

### Audit gates between phases

Like product/strategy workflows, design workflows include audit
checkpoints between major phases. Audit findings of severity ≥
fail block forward progress until addressed; warn surfaces but
doesn't block.

## Anti-patterns

- **Migration workflows that introduce design changes** — keep
  migrations baseline-preserving. Design improvements happen
  *after* migration completes, via brownfield workflows from
  `product/strategy/workflows/`.
- **Roundtrip workflows that try to be source-of-truth** —
  `figma-roundtrip` is a sync loop, not an authority. The
  authority alternates per phase based on who's editing.
- **Design workflows that touch brand identity** — system-wide
  brand changes are `product:brand-refresh`'s concern (lives in
  `product/strategy/workflows/`).
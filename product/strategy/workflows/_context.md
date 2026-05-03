# Product Workflows — Domain Context (`product/strategy/workflows/`)

> Read this in addition to `workflows/_context.md` and
> `product/strategy/_context.md` whenever working with product/design
> workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is product/design — bootstrapping a new
> design system, adding features, refreshing pages, system-wide
> brand updates, Figma roundtrips, and migrations. Per the
> primary-domain placement rule (see `workflows/_context.md`),
> these workflows live here even when they invoke commands from
> marketing or other domains.

## Workflows in this sub-namespace

8 workflows currently:

- **`product:greenfield`** — Setup new project from zero (10 phases)
- **`product:brownfield-add-feature`** — Add new feature/page/capability (7 phases)
- **`product:brownfield-improve-page`** — Refresh existing page (6 phases)
- **`product:brownfield-improve-story`** — Iterate on in-flight story (6 phases)
- **`design:migrate-to-pencil`** — Bring existing product UI into Pencil (5 phases)
- **`design:migrate-from-figma`** — Bring Figma design system into Pencil (5 phases)
- **`product:brand-refresh`** — System-wide brand update / rebrand (8 phases)
- **`design:figma-roundtrip`** — Designer-in-Figma iteration loop (6 phases)

See `workflows/_index.md` for the unified decision tree across
all domains.

## Conventions specific to product/design workflows

Beyond the universal workflow conventions in
`workflows/_context.md`:

### Audit gates between phases

Most product/design workflows include audit checkpoints between
major phases. Audit findings of severity ≥ fail block forward
progress until addressed. Severity warn surfaces but doesn't
block.

### Three-tier fidelity model

Workflows that produce design artifacts honor the three-tier
fidelity model from `product/design/_context.md`:
- Wireframe (via `pencil:explore`, descriptive labels)
- Low-fi (`--fidelity low`, lorem at headline slots only)
- Hi-fi (default, voice + editorial + SEO applied)

Workflows pass `--fidelity` through to commands per the phase's
intent.

### Figma interoperability paths

When `open-pencil` is on PATH, workflows gain Figma-aware
capabilities:
- Designer review checkpoints in `greenfield`,
  `brownfield-add-feature`, `brand-refresh`
- Higher-fidelity capture in `brownfield-improve-page`,
  `migrate-to-pencil`
- Designer-edit imports in `brownfield-improve-story`
- Pre-refresh archival in `brand-refresh`
- Design-layer linting in every audit invocation

`figma-roundtrip` and `migrate-from-figma` are explicitly
Figma-driven.

### Migration workflows assume baseline state

Migration workflows (`migrate-to-pencil`, `migrate-from-figma`)
assume the existing artifacts (shipped UI or Figma files) are
canonical. Pencil-managed state should reflect them without
breaking production. Don't conflate "migrate" with "redesign" —
those are separate workflows.

### Brand-refresh has high regression risk

`brand-refresh` cascades across foundations, components,
patterns, templates, and pages. The workflow's audit checkpoints
are particularly important — visual regression risk is
real. Phase 1 archives `.pen` snapshots (and `.fig` snapshots
when open-pencil is installed) for rollback.

## Anti-patterns

- **Product workflows that try to produce marketing assets** —
  delegate to marketing commands, or note "marketing campaign
  setup is out of scope; run `market:launch-campaign`
  separately."
- **Workflows that conflate brand-level and page-level work** —
  brand changes go through `brand-refresh`; page changes go
  through `brownfield-improve-page`. Mixing them creates
  unbounded scope.
- **Migration workflows that introduce design changes** — keep
  migrations baseline-preserving. Design improvements are a
  separate brownfield workflow run after migration completes.

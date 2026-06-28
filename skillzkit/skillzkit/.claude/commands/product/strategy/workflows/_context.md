# Product Strategy Workflows — Domain Context (`product/strategy/workflows/`)

> Read this in addition to `workflows/_context.md` and
> `product/strategy/_context.md` whenever working with product
> strategy workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is product strategy — bootstrapping a new
> design system from scratch, adding features, refreshing pages,
> iterating on in-flight stories, and system-wide brand updates.
> Per the primary-domain placement rule (see
> `workflows/_context.md`), these workflows live here even when
> they invoke commands from design, UX, or marketing domains.
>
> Design-domain workflows (Figma migrations, designer-in-Figma
> roundtrips) live separately under
> `product/design/workflows/`.

## Workflows in this sub-namespace

5 workflows currently:

- **`product:greenfield`** — Setup new project from zero (10 phases)
- **`product:brownfield-add-feature`** — Add new feature/page/capability (7 phases)
- **`product:brownfield-improve-page`** — Refresh existing page (6 phases)
- **`product:brownfield-improve-story`** — Iterate on in-flight story (6 phases)
- **`product:brand-refresh`** — System-wide brand update / rebrand (8 phases)

See `workflows/_index.md` for the unified decision tree across
all domains, and `product/design/workflows/_context.md` for the
3 design-domain migration/roundtrip workflows.

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
- Higher-fidelity capture in `brownfield-improve-page`
- Designer-edit imports in `brownfield-improve-story`
- Pre-refresh archival in `brand-refresh`
- Design-layer linting in every audit invocation

For workflows whose primary purpose is Figma interop (migrations
and roundtrips), see `product/design/workflows/`.

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

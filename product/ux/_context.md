# UX — Namespace Context (`product/ux/`)

> Read this in addition to `product/_context.md` when working
> with UX research artifacts.
>
> The UX namespace holds research and shaping artifacts that
> inform product work but don't directly produce UI: personas,
> journey maps, user stories, story maps. These artifacts are
> consumed by other namespaces (engineer for capability
> planning, marketer for campaign work, product/design for
> design decisions) but authored here.

## What `product/ux/` contains

```
product/ux/
├── _context.md       (this file)
├── _index.md         decision tree
├── personas/         persona definitions and JTBD statements
├── journeys/         journey maps and pain-point registry
├── stories/          user stories with acceptance criteria
└── story-maps/       Patton-style 2D story arrangements with
                       release slices
```

This namespace was originally planned in three phases:

1. Foundations + personas + journeys (this build)
2. Stories + story maps (next build)
3. Future: research, accessibility-UX, prototyping (deferred —
   not currently in scope)

## Persona, role, and team-size assumptions

The "product persona" of this suite (per `product/_context.md`)
covers strategy + UX + visual design as one cross-functional
role. UX work might be done by:

- **Solo founder / small startup**: one person doing strategy,
  UX, and design. The UX namespace's commands are part of their
  daily work.
- **Mid-stage startup**: dedicated UX researcher or designer,
  but still cross-functional with PM and design. The UX
  artifacts are theirs to author; PM and engineer consume.
- **Larger org**: dedicated UX researchers, separate from
  product managers and visual designers. UX namespace artifacts
  are owned by UX team; PM owns strategy; designer owns visual.

The suite serves all three configurations because the artifacts
themselves are what matter — who authors them is org-specific.

## What's NOT in this namespace

Some related work lives elsewhere:

- **Visual design** — `product/design/` (design tokens,
  patterns, templates). UX outputs feed into visual design.
- **Strategic positioning** — `product/strategy/positioning.md`.
  Personas and journeys inform positioning but don't replace
  it.
- **Component-level a11y** — `frameworks/storybook/verify/a11y`.
  Component accessibility is a Storybook concern. UX-level
  accessibility (heuristic eval, broader flow accessibility)
  is deferred future work.
- **User research execution** — interviews, surveys, behavioral
  data collection. Deferred future work. The persona and
  journey commands accept research-source citations but don't
  conduct the research.
- **Prototyping** — Figma prototypes, clickable mockups. Out of
  scope for this suite.

## Storage conventions

UX artifacts are stored in two layers:

### Layer 1: structured registry

The `product/.pencil-ux.json` manifest at the consuming
project's root holds inventory and metadata: persona IDs,
journey types, story status, story map slices, pain-point
registry, cross-references between artifacts.

This is the queryable layer. Commands like `personas:list`,
`journeys:pain-points`, and `stories:list` read from this
manifest. Other namespaces (engineer's capability-introduction,
marketer's campaign workflows) cross-reference the manifest to
find personas or journeys relevant to their work.

### Layer 2: markdown content

Rich content lives in markdown files at conventional paths:

```
docs/ux/
├── personas/
│   ├── school-district-it-director.md
│   ├── school-admin-sarah.md
│   └── ...
├── journeys/
│   ├── admin-onboarding.md
│   ├── student-evaluation-flow.md
│   └── ...
├── stories/                  (typically extended notes only;
│   ├── ...                     most stories live in manifest)
└── story-maps/
    ├── tournament-registration-v1.md
    └── ...
```

The `filePath` field in each manifest entry points to the
markdown file. Commands write both layers — manifest for the
inventory, markdown for the rich content.

When the rich content fits in the manifest summary fields, no
separate markdown file is needed. JTBD statements typically
fit inline; full traditional personas typically need a markdown
file.

## Cross-namespace integration

Other namespaces consume UX artifacts:

### `engineer/architecture/workflows/capability-introduction`

When introducing a new capability, the workflow can reference
which personas it serves and which pain points it addresses:

```
Capability: Real-time notifications
Serves: persona-school-admin, persona-district-it-director
Addresses: pain-missed-deadline-alerts, pain-stale-data
```

This explicit linking means later audits can detect "we built
real-time notifications but the persona-district-it-director
pain points are still unresolved" — a meaningful signal for
follow-up work.

### `engineer/architecture/decisions/propose`

ADR proposals can reference personas and journeys to ground
decisions in user context. "We chose async messaging because
persona-school-admin needs to respond outside business hours"
is a stronger ADR than one that omits the user-facing
justification.

### `market/social/*`, `market/email/*`, `market/ads/*`

Marketing commands can target specific personas:

```
/market:email:newsletter --persona persona-school-admin
```

The newsletter command reads the persona's voice profile,
goals, and pain points to tune the content.

### `market/workflows/launch-campaign`

Campaign workflows can target specific journey stages
(awareness, evaluation, onboarding) and reference relevant
personas.

## Conventions specific to UX

### Hypothesis vs evidence

Every persona and journey has implicit research backing or
lacks it. The schema's `researchSources` field for personas
captures whether the artifact is hypothesis-based or
evidence-based.

Hypothesis-based artifacts are still useful — they're shared
mental models that the team agrees on. But they should be
flagged and tested when research becomes available. The audit
plane (when added) can surface "personas that have remained
hypothesis-only for >180 days" as a signal for research
prioritization.

For greenfield work, hypothesis personas are normal and
expected. For mature products, hypothesis-only personas are a
gap.

### Multi-persona artifacts

Some artifacts serve multiple personas — a journey may apply
to admins AND teachers; a story may serve admins OR district
IT depending on which has the role. The schema supports
multi-persona references (`personaRefs` is an array on
journeys, stories, and pain points).

Don't force single-persona attribution when the reality is
multi-persona. Forcing creates either incorrect attribution or
duplicate artifacts.

### Pain point registry

Pain points are first-class objects with their own IDs, not
strings inside journeys. This is intentional:

- **Cross-reference**: a pain point may appear in multiple
  journeys; one ID, multiple references
- **Prioritization**: pain points have severity, frequency,
  and status fields enabling backlog work
- **Resolution tracking**: pain points link to the stories,
  capabilities, ADRs, or tickets addressing them

The `journeys:pain-points` command queries this registry; the
journey-mapping command writes to it.

### Story splitting

Real-world stories that don't fit in a sprint get split. The
schema captures parent/child relationships (`parentRef`,
`childRefs`). When a parent has children, the parent typically
isn't implemented directly — the children are.

The `stories:write` command supports both initial creation and
splitting an existing story.

### Storage path convention

Markdown content lives at `docs/ux/<sub-namespace>/<id>.md` by
default. Projects can override the convention by setting
`storage.basePath` in `product/.pencil-ux.json`:

```jsonc
{
  "storage": {
    "basePath": "documentation/research/ux/"
  }
}
```

(The schema doesn't enforce this — it's a project-level
convention.)

## Anti-patterns

- **Conflating personas with user accounts.** A persona is a
  user archetype, not a specific named user. "Sarah Smith
  (admin@example.com)" is an account; "School Admin who
  juggles compliance and budget" is a persona.

- **Personas without scope context.** "Decision-maker" is too
  abstract; "School District IT Director with 5+ schools and
  compliance accountability" is scoped. Scope makes personas
  actionable.

- **Stories without persona refs.** A story without a persona
  is just a feature request. Stories that anchor to personas
  carry the user-context signal that makes them estimable.

- **Pain points stuffed into journey markdown.** Pain points
  belong in the registry. Storing them only in journey
  markdown loses the cross-reference and prioritization
  capability.

- **Treating the manifest as the source of truth alone.**
  Manifest holds inventory; markdown holds rich content. Both
  matter. Manifests without markdown are bookkeeping with no
  substance.

- **Treating markdown as the source of truth alone.** Inverse
  problem. Markdown without manifest entries means commands
  can't query the inventory.

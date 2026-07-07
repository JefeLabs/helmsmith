# Personas — Sub-namespace Context (`product/ux/personas/`)

> Read this in addition to `product/ux/_context.md` and
> `product/_context.md` when working with personas.

## What this sub-namespace contains

Three commands:

- **`/product:ux:personas:define`** — traditional persona
  with role, goals, frustrations, context
- **`/product:ux:personas:define-jtbd`** — JTBD statements
  (when/I want/so I can) anchored to a persona
- **`/product:ux:personas:list`** — inventory query

Both `define` and `define-jtbd` can target the same persona ID
— a hybrid persona has both traditional fields AND JTBD
statements. The team picks which lens fits the work; many
teams use both.

## Persona definitions in this suite

### Traditional persona structure

A traditional persona captures:

- **Role** — job title or functional role label
- **Demographics (optional)** — age, location, etc. when
  relevant; many modern persona practices skip demographics
  unless they materially affect the persona's needs
- **Goals** — what they're trying to achieve in their context
- **Frustrations** — pain points and friction in their
  current state
- **Context** — situational factors (team size, time
  pressures, organizational dynamics)
- **Tech profile** — technical sophistication and tooling
  preferences when relevant

This format is best for stable mental-model artifacts that
teams reference across many stories and journeys.

### JTBD structure

A JTBD persona captures one or more job statements, each with:

- **Situation** — the "when" clause: triggering condition
- **Motivation** — the "I want" clause: what they're trying
  to do
- **Outcome** — the "so I can" clause: desired result

This format is best for outcome-focused work where the
demographic identity matters less than the situational job.

A persona can have multiple JTBD statements with different
priorities (primary, secondary, tertiary) — most personas have
2-5 jobs that matter most to them.

### Hybrid

When a team uses both lenses, the persona has both traditional
fields AND JTBD statements. The schema supports this; the
commands write the appropriate fields.

For most teams, hybrid is the practical choice — traditional
fields for shared mental model; JTBD statements for feature
prioritization.

## Storage

### Manifest entry

The persona's structured fields live in
`product/.pencil-ux.json` under the `personas` array:

```jsonc
{
  "personas": [
    {
      "id": "persona-school-admin",
      "name": "School Admin",
      "type": "hybrid",
      "filePath": "docs/ux/personas/school-admin.md",
      "summary": "Mid-career school administrator juggling compliance and budget concerns; primary platform user.",
      "traditional": {
        "role": "Principal or Assistant Principal",
        "goals": [...],
        "frustrations": [...],
        ...
      },
      "jtbd": [
        {
          "id": "jtbd-vendor-vetting",
          "situation": "When evaluating a new ed-tech vendor",
          "motivation": "I want to verify FERPA/COPPA compliance",
          "outcome": "so I can avoid liability and protect students",
          "priority": "primary"
        },
        ...
      ],
      "researchSources": [...],
      "created": "2026-05-10T14:30:00Z",
      "lastReviewed": "2026-05-10T14:30:00Z"
    }
  ]
}
```

### Markdown content

Rich content lives at `docs/ux/personas/<persona-id-suffix>.md`:

```markdown
# School Admin

## Summary
Mid-career school administrator (typically Principal or
Assistant Principal) at a single-school site or small
multi-site district. Primary user of the SkoolScout platform.

## Background
[detailed narrative — typical career path, current
responsibilities, day-to-day reality]

## Goals
- Stay compliant with FERPA, COPPA, and state-level student
  data laws
- Maximize student outcomes within tight budgets
- Build trust with families and community
- Develop staff and reduce turnover

## Frustrations
- Vendor evaluation takes weeks; risk of bad pick is high
- District administrative software is fragmented; data
  silos prevent insights
- Compliance documentation is manual; audit prep is painful
- Time pressure: many decisions made hastily

## Context
- Often part of a small leadership team (3-5 admins)
- Reports to district superintendent (when district-affiliated)
- Manages 5-50 staff
- Decisions affect 200-2000 students

## Tech profile
- Comfortable with web apps and email
- Less comfortable with deep technical configuration
- Mobile-first for many tasks (in classrooms, hallways)
- Uses laptop for analysis and reporting work

## JTBD primary
**When** evaluating a new ed-tech vendor,
**I want** to verify FERPA/COPPA compliance and data handling
practices,
**so I can** avoid liability and protect student data.

## JTBD secondary
[additional JTBD statements]

## Notes
[ongoing observations, research findings, contradictions
from initial hypothesis]
```

The markdown is human-readable. The manifest is queryable.
Both are kept in sync — the commands write both.

## When persona is hypothesis vs evidence-based

The manifest's `researchSources` field captures whether the
persona is grounded in research:

```jsonc
"researchSources": [
  {
    "type": "interview",
    "summary": "10 interviews with school admins across 3 states",
    "date": "2026-04-15"
  },
  {
    "type": "support-ticket-analysis",
    "summary": "6 months of support ticket themes",
    "date": "2026-04-20"
  }
]
```

Empty `researchSources` means hypothesis-only. That's normal
for greenfield work; the suite doesn't penalize it.

When research becomes available, the persona is updated and
`researchSources` populated. Stale hypothesis-only personas
(>180 days without research grounding) surface in audit as
candidates for research investment.

## Cross-references

Personas are referenced by:

- **journeys**: `personaRefs: ["persona-school-admin", ...]`
- **stories**: `personaRefs: ["persona-school-admin", ...]`
- **pain points**: `personaRefs: ["persona-school-admin", ...]`
- **engineer:capability-introduction**: capabilities serve
  specific personas
- **engineer:architecture:decisions:propose**: ADRs may
  ground decisions in persona context
- **market:* commands**: campaigns target personas

The persona ID is the contract. Renaming a persona is a
breaking change — references in journeys, stories, pain
points, and external tickets break.

The schema's IDs use the `persona-<slug>` pattern:
`persona-school-admin`, `persona-district-it-director`,
`persona-tournament-organizer`.

## Anti-patterns

- **Generic personas like "the user"** — not a persona, a
  placeholder. Don't formalize.
- **Personas that just restate features** — "Power user who
  uses advanced reports" describes a feature mode, not a
  user. Frame around what they're trying to accomplish, not
  which features they use.
- **Personas with too many goals** — 3-5 goals is the
  sweet spot. 10+ goals means you've conflated multiple
  personas.
- **Demographics that don't matter** — "Sarah, 38, lives in
  Connecticut" rarely affects design decisions. Skip unless
  the demographic actually changes the user's needs.
- **JTBD statements without "so I can"** — without the
  outcome, JTBD is just feature description. The outcome is
  what makes it actionable.
- **Personas as marketing artifacts only** — UX personas
  inform product decisions; marketing audiences may overlap
  but aren't identical. Keep them separate if needed
  (`/market` namespace can have its own audience definitions
  in marketing manifests).

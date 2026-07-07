# Journeys — Sub-namespace Context (`product/ux/journeys/`)

> Read this in addition to `product/ux/_context.md` and
> `product/_context.md` when working with journey maps.

## What this sub-namespace contains

Three commands:

- **`/product:ux:journeys:map`** — create or update a
  journey map (typed: customer-journey, user-flow, or
  service-blueprint)
- **`/product:ux:journeys:list`** — inventory query
- **`/product:ux:journeys:pain-points`** — query the
  pain-point registry (extracted from journeys, lives
  separately for cross-reference)

## Journey types in this suite

The `map` command supports three journey types, each with
different artifact shapes:

### `customer-journey` — high-level arc

Marketing-flavored journey covering the full customer arc
from awareness through advocacy. Stages typically:

- **Awareness** — they discover a problem and start looking
- **Consideration** — they evaluate options
- **Evaluation** — they trial or deep-evaluate yours
- **Adoption** — they decide and onboard
- **Engagement** — they use the product over time
- **Expansion** — they grow into more usage / adjacent products
- **Advocacy** — they recommend to others

Each stage captures: user actions, touchpoints, emotions, and
pain points. Best for marketing planning, cross-functional
alignment, and identifying where the customer experience
breaks down.

### `user-flow` — task-level sequence

Engineering-flavored journey covering a specific task with
sequential steps. Steps capture user actions, system
responses, decision points, and pain points. Best for shaping
specific features, designing UI flows, and identifying
implementation requirements.

### `service-blueprint` — front-stage + back-stage

Cross-functional journey covering both what the user
experiences (front-stage) AND what the system / team /
operations do behind the scenes (back-stage). Each stage has
two rows: front-stage user actions and back-stage system or
team activities. Best for service design, cross-functional
planning, and identifying handoff points or gaps.

The `map` command prompts for type, then walks through
type-specific fields.

## Storage

### Manifest entry

Journey structured fields live in `product/.pencil-ux.json`
under the `journeys` array:

```jsonc
{
  "journeys": [
    {
      "id": "journey-admin-onboarding",
      "name": "School Admin Onboarding",
      "type": "user-flow",
      "filePath": "docs/ux/journeys/admin-onboarding.md",
      "summary": "First-time school admin getting set up on the platform; sub-30-minute target.",
      "personaRefs": ["persona-school-admin"],
      "stages": [
        {
          "name": "Sign up",
          "userActions": ["Visit landing page", "Click sign up", "Enter school details"],
          "touchpoints": ["Web app", "Welcome email"],
          "emotions": "Cautiously optimistic; some skepticism about another tool",
          "painPointRefs": ["pain-account-verification-delay"]
        },
        ...
      ],
      "created": "2026-05-10T14:30:00Z",
      "lastReviewed": "2026-05-10T14:30:00Z"
    }
  ]
}
```

### Markdown content

Rich content lives at `docs/ux/journeys/<journey-id-suffix>.md`:

```markdown
# School Admin Onboarding

## Summary
First-time school admin getting set up on the platform.
Target: under 30 minutes from sign-up to first useful action.

## Personas
- persona-school-admin (primary)

## Type
User-flow

## Stages

### 1. Sign up
**User actions**:
- Visit landing page
- Click "Sign up"
- Enter school details (name, role, email)
- Verify email (link sent)

**Touchpoints**: Landing page, signup form, welcome email

**Emotions**: Cautiously optimistic; some skepticism about
another tool. Quick wins matter.

**Pain points**:
- pain-account-verification-delay: "Email verification
  sometimes takes 5+ minutes"

### 2. School profile setup
[continues for each stage]

## Notes
[ongoing observations]
```

The markdown is human-readable. The manifest is queryable.
Both are kept in sync.

## Pain points as separate registry

A meaningful design choice: pain points are NOT just strings
inside journey stages. They're first-class entries with their
own IDs in the `painPoints` array.

Why this matters:

- **Cross-reference**: a single pain point ("login session
  expires too quickly") might appear in 3 journeys. One ID,
  three references.
- **Prioritization**: pain points carry severity, frequency,
  and status fields. Backlog work happens against pain
  points, not journeys.
- **Resolution tracking**: pain points link to the stories,
  capabilities, ADRs, or tickets addressing them. Closing
  a pain point updates its status.

When `journeys:map` collects pain points during journey
mapping, it writes to BOTH the journey's `painPointRefs`
array AND the `painPoints` registry. The journey references
the IDs; the registry holds the rich data.

The `journeys:pain-points` command queries the registry
across all journeys.

## Multi-persona journeys

Some journeys serve multiple personas. The schema supports
multi-persona references via `personaRefs: [...]`. Examples:

- A "course evaluation" journey served by both teachers
  and students
- An "incident response" journey served by both customer
  support agents and engineers

Don't force single-persona attribution when reality is
multi-persona. Forcing creates either incorrect attribution
or duplicate journeys.

## Customer journey vs user flow — when to use which

Both can describe similar surface flows. The distinction is
zoom level:

- **Customer journey**: zoomed out. "Customer evaluates the
  product over 2 weeks." Stages span days or weeks.
  Marketing-relevant.
- **User flow**: zoomed in. "User completes signup in 5
  minutes." Stages span seconds or minutes. Engineering-
  relevant.

For most products, both have a place. The customer journey
captures the strategic arc; user flows capture specific
tasks within that arc.

The same product surface might appear in both:
- Customer journey, "Adoption" stage: "User signs up"
- User flow, "Sign up" journey: 8 detailed steps

These complement rather than duplicate. The customer journey
links to user flows where they exist (via cross-reference in
the markdown notes; not currently a structured manifest
field).

## Service blueprint specifics

Service blueprints are the most complex of the three types.
Each stage has TWO sets of activities:

- **Front-stage**: what the user sees and experiences
- **Back-stage**: what's happening behind the scenes
  (system processes, team actions, third-party integrations)

The schema captures this via the `backstage` array on each
stage. Front-stage activities live in `userActions`;
back-stage in `backstage`.

Service blueprints are most useful when:

- The user experience depends heavily on operational
  processes (customer support, fulfillment, manual review)
- Cross-functional alignment is needed (engineering,
  ops, legal, customer success)
- Handoff points between teams are causing friction

For digital-only products with minimal operational
intervention, customer journey or user flow is usually
enough.

## Cross-namespace references

Journeys are referenced by:

- **Story maps**: each story map's backbone aligns with a
  journey's stages
- **Stories**: stories may reference the journey context
  they fit into (informal cross-reference in story notes)
- **Engineer:capability-introduction**: capabilities can
  reference which journey they affect
- **Marketer commands**: campaigns target specific journey
  stages (awareness, evaluation, etc.)

The journey ID is the contract. Renaming a journey is a
breaking change.

## Anti-patterns

- **Journeys without personas.** A journey without a persona
  ref is decoupled from user context. Multi-persona is
  fine; zero-persona is anti-pattern.

- **One journey covering too much.** "User experience with
  the platform" is too broad to be useful. Break into
  meaningful sub-journeys: signup, daily use, monthly
  review, etc.

- **Stages with no user actions.** A stage that's all system
  description with no user touchpoints is operations
  documentation, not a journey stage.

- **Pain points as inline strings.** Always register pain
  points in the `painPoints` array. Inline-only loses the
  cross-reference and prioritization capability.

- **Customer journeys that are really sales pipelines.**
  "Lead → opportunity → closed-won" is a sales pipeline,
  not a customer journey. Customer journeys are user-
  centric; sales pipelines are seller-centric.

- **Service blueprints that are just user flows with
  process notes.** Real service blueprints have meaningful
  back-stage content. If the back-stage column is mostly
  "system stores data," use a user-flow journey instead.

- **Stale journeys not reviewed when product changes.** A
  journey written 1 year ago about a product that has
  evolved significantly is misleading documentation. The
  audit plane (when added) surfaces stale journeys.

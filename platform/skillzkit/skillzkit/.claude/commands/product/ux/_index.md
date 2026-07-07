# UX — Namespace Index (`product/ux/`)

> Decision tree for UX commands. Use this to find the right
> command for the task you're trying to do.

## Sub-namespaces

| Sub-namespace | Purpose |
|---------------|---------|
| `personas/` | Persona definitions (traditional + JTBD) and management |
| `journeys/` | Journey maps, pain points, touchpoint analysis |
| `stories/` | User stories and acceptance criteria (next response) |
| `story-maps/` | Patton-style story maps with release slices (next response) |

## Personas

### `/product:ux:personas:define <name>`

Define a traditional persona — role, demographics (optional),
goals, frustrations, context, tech profile. Best for stable
mental-model artifacts the team uses for shared understanding.

Use when: the team needs a persona artifact richer than a
single JTBD; demographics or tech profile matter; the persona
is referenced repeatedly across stories and journeys.

### `/product:ux:personas:define-jtbd <name>`

Define a persona via Jobs-to-be-Done framing —
when/I want/so I can statements. Best for outcome-focused work
where demographic identity matters less than situation and
motivation.

Use when: feature decisions hinge on user goals rather than
identity; the persona work supports specific feature shaping;
the team prefers outcome framing over demographic framing.

Both commands write to the same `personas` array in
`product/.pencil-ux.json`. A persona can have both traditional
fields AND JTBD statements (type: "hybrid") — the team picks
which lens to use, or uses both.

### `/product:ux:personas:list`

List all personas in the inventory with summaries. Filter by
type, by tags, or by recent activity.

## Journeys

### `/product:ux:journeys:map <name>`

Map a journey. Type-aware:

- **customer-journey**: high-level awareness → consideration →
  evaluation → adoption → expansion → advocacy. Marketing-flavored.
- **user-flow**: task-level step sequence with touchpoints,
  emotions, pain points. Engineering-flavored.
- **service-blueprint**: front-stage (user-facing) and
  back-stage (system/team) parallel rows.

The command prompts for type, then walks through type-specific
fields.

### `/product:ux:journeys:list`

List journeys with summaries. Filter by type, by persona
served, by completeness.

### `/product:ux:journeys:pain-points`

Query the pain-point registry. Aggregate by severity, by
journey, by persona. Surface unaddressed pain points needing
attention. Identify candidates for capability-introduction or
story prioritization.

## Stories

### `/product:ux:stories:write <title>`

Create a user story with persona references, narrative
(as a / I want / so that), acceptance criteria. Supports
splitting via `--split-from <parent-id>`.

### `/product:ux:stories:list`

Story inventory with status filter, persona filter, parent/
child relationship visualization, orphan detection (stories
not in any story map).

### `/product:ux:stories:acceptance-criteria <story-id>`

Add or refine acceptance criteria for a story. Given/When/Then
structure. Bridges to engineering implementation.

## Story Maps

### `/product:ux:story-maps:build <name>`

Build a story map. Anchor to a journey, define backbone
(top-level activities), populate stories underneath each
backbone step. Initial slicing typically MVP.

### `/product:ux:story-maps:slice <map-id>`

Define release slices on an existing story map. MVP slice,
v1.1 slice, etc. Each slice is a thin-but-complete user
journey. Optional bulk Jira ticket creation via
`--create-tickets <slice-name>` when integration configured.

### `/product:ux:story-maps:list`

Story map inventory with active-slice filter, full structure
view, journey filter.

## Cross-namespace flows

### "I want to add a feature"

```
1. /product:ux:personas:list
   → confirm or define the persona this feature serves

2. /product:ux:journeys:list
   → find the journey this feature affects, or map it

3. /product:ux:stories:write
   → write the story anchoring to persona

4. /product:ux:stories:acceptance-criteria
   → define done

5. /core:workflows:manage start engineer:capability-introduction
   → engineer-side workflow that references the story
```

### "I want to plan a release"

```
1. /product:ux:journeys:list
   → identify journey this release affects

2. /product:ux:story-maps:build
   → build map anchored to journey

3. /product:ux:story-maps:slice
   → define MVP slice and beyond

4. /core:integrations:jira (when added)
   → create tickets for MVP-slice stories
```

### "I want to find unmet user needs"

```
1. /product:ux:journeys:pain-points
   → query pain-point registry

2. Filter by severity=blocker, status=unaddressed

3. For each: /product:ux:stories:write
   → create stories addressing the pain

4. Or: /core:workflows:manage start
       engineer:capability-introduction
   → for capability-level pain
```

### "I'm planning a marketing campaign"

```
1. /product:ux:personas:list
   → identify target persona

2. /product:ux:journeys:list --type customer-journey
   → find the customer journey

3. /market:workflows:launch-campaign
   → reference persona + journey stage in campaign work
```

## When NOT to invoke UX commands

UX commands produce artifacts that earn their keep when
referenced repeatedly. Don't invoke them for one-off thinking:

- Brainstorming a feature in chat — don't define a persona
  unless the persona will be referenced from stories
- Quick task description — write a Jira ticket directly,
  don't formalize as a story
- Internal team discussion — verbal alignment doesn't need
  artifact ceremony

The artifacts have value when other commands and workflows
read them. Artifacts that aren't referenced are documentation
debt.

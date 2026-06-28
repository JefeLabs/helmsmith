# Story Maps — Sub-namespace Context (`product/ux/story-maps/`)

> Read this in addition to `product/ux/_context.md` and
> `product/_context.md` when working with story maps.

## What this sub-namespace contains

Three commands:

- **`/product:ux:story-maps:build`** — construct a story map
  anchored to a journey, defining backbone (user activities
  in order) and populating stories underneath
- **`/product:ux:story-maps:slice`** — define release slices
  on an existing story map; each slice is a thin-but-complete
  user journey for a release
- **`/product:ux:story-maps:list`** — inventory query

## What story maps are

Story maps are Jeff Patton's 2D arrangement of user stories:

- **Horizontal axis (backbone)**: top-level user activities
  in the order they happen — typically aligned with journey
  stages
- **Vertical axis (slices)**: priority levels or release
  phases — top stories are MVP; deeper stories are future
  releases

The 2D layout solves a common product planning failure:
linear backlogs hide whether a release delivers a complete
user journey or just a feature dump. Slicing horizontally
across the backbone forces the team to ask "does this
release actually let the user accomplish anything?"

A typical map:

```
Backbone:  [Sign up]  [Setup profile]  [First action]  [Daily use]
                                                      
Slice 1    Email    Name+School    See dashboard    View entries
(MVP)      signup   only           with placeholder  read-only
                                                    
Slice 2    Add      School logo    Pre-filled       Edit entries
(v1.1)     SSO      upload         dashboard
                                                      
Slice 3    Bulk     Multi-school   Cross-school     Sharing &
(v1.2)     invite   support        view             collaboration
```

Each slice is a complete (if minimal) user journey. Slice 1
delivers something usable; Slice 2 enriches it; Slice 3 adds
breadth.

## Storage

### Manifest entry

Story maps live in `product/.pencil-ux.json` under the
`storyMaps` array:

```jsonc
{
  "storyMaps": [
    {
      "id": "map-admin-onboarding-v1",
      "name": "School Admin Onboarding v1.0",
      "journeyRef": "journey-admin-onboarding",
      "filePath": "docs/ux/story-maps/admin-onboarding-v1.md",
      "backbone": [
        {
          "name": "Sign up",
          "description": "Initial account creation"
        },
        {
          "name": "Setup profile",
          "description": "School details, role, preferences"
        },
        ...
      ],
      "slices": [
        {
          "name": "MVP",
          "description": "Smallest viable launch",
          "storyRefs": [
            "story-email-signup",
            "story-school-name-only",
            "story-placeholder-dashboard",
            "story-readonly-entries"
          ],
          "targetDate": "2026-07-01",
          "status": "in-progress"
        },
        {
          "name": "v1.1",
          "description": "Enhanced setup and dashboard",
          "storyRefs": [...],
          "targetDate": "2026-09-01",
          "status": "planned"
        },
        ...
      ],
      "created": "2026-05-10T14:30:00Z",
      "lastUpdated": "2026-05-15T16:00:00Z"
    }
  ]
}
```

### Markdown content

Story map markdown is structured for human readability with
backbone as section headers and slices as columns within each
section:

```markdown
# School Admin Onboarding v1.0

## Journey
journey-admin-onboarding (user-flow)

## Backbone

### 1. Sign up
Initial account creation.

| Slice | Stories |
|-------|---------|
| MVP   | story-email-signup |
| v1.1  | story-add-sso |
| v1.2  | story-bulk-invite |

### 2. Setup profile
School details, role, preferences.

| Slice | Stories |
|-------|---------|
| MVP   | story-school-name-only |
| v1.1  | story-school-logo-upload |
| v1.2  | story-multi-school-support |

### 3. First action
[continues for each backbone activity]

## Slices summary

### MVP — target 2026-07-01 — in-progress
Smallest viable launch. Each user activity has at least
one story to keep the journey complete.

Stories (4):
- story-email-signup
- story-school-name-only
- story-placeholder-dashboard
- story-readonly-entries

### v1.1 — target 2026-09-01 — planned
Enhanced setup and dashboard.

[continues]

## Notes
[ongoing observations]
```

## Backbone alignment with journeys

Each story map has a `journeyRef` linking to a journey. The
backbone typically aligns with the journey's stages:

- Customer journey stages → story map backbone activities
- User flow steps → backbone (for task-level maps)
- Service blueprint front-stage stages → backbone

The alignment isn't strict — a story map may use slightly
different backbone names than the journey's stage names if
release framing benefits. But the relationship should be
clear.

When a journey has stages [A, B, C, D], a story map for that
journey typically has backbone activities aligning with those
stages. Variations:

- Story map covers a subset of the journey (just stages B
  and C; sub-journey of an existing journey)
- Story map combines two journeys (cross-journey planning;
  uncommon but valid)

## Slicing strategies

Real-world slice patterns (Patton, et al.):

### Slice by completeness

- **MVP**: smallest set of stories that lets a user
  complete the journey end-to-end (even if minimally)
- **v1.1**: enrich each backbone step
- **v1.2+**: add breadth, optimization, edge cases

### Slice by persona

- **MVP**: serves primary persona only
- **v1.1**: adds secondary persona support
- **v1.2**: full multi-persona

### Slice by deployment phase

- **Internal beta**: minimal feature set, internal users
- **Limited GA**: small external user pool
- **Full GA**: full feature set, full user pool

The schema is slice-strategy-agnostic. The slice has a name,
description, story refs, optional target date, and status.
The strategy is documented in the slice description.

### Smaller-than-MVP slices

Some teams use sub-MVP slices:

- **Spike**: smallest experiment to validate the journey
- **Alpha**: internal validation
- **Beta**: limited external
- **MVP**: first real launch
- **v1.1+**: post-launch enrichment

These are all valid; the schema supports any slice naming.

## Cross-references

Story maps reference:

- **journey** (1 reference, required)
- **stories** (many references, via slices[].storyRefs)

Story maps are referenced by:

- Engineer: capability planning may reference story maps
  to identify which capabilities are needed for which
  release
- Marketer: launch campaign workflows can target specific
  slices ("MVP launch announcement," "v1.1 feature launch")

## Cross-namespace integration

### `/core:integrations:jira create-tickets-from-slice <map-id> <slice-name>`

When Jira is configured, the integration can bulk-create
tickets for all stories in a specific slice:

```
/core:integrations:jira create-tickets-from-slice \
  map-admin-onboarding-v1 MVP
```

This:
1. Reads the map's MVP slice storyRefs
2. For each story, checks if `ticketRef` is empty
3. Creates a Jira ticket for each unticketed story
4. Updates each story's `ticketRef` field
5. Optionally creates a Jira epic linking all the tickets

This is the "story map → execution backlog" bridge.

Same pattern can apply to GitHub Issues, Linear, etc. — any
ticket integration that supports bulk creation.

### `/market:workflows:launch-campaign --slice <map-id>:<slice-name>`

Launch campaigns can target specific slices:

```
/core:workflows:manage start market:launch-campaign \
  --slice map-admin-onboarding-v1:MVP
```

The campaign workflow reads the slice's stories to understand
what's launching, the journey for context, and the personas
to target.

## Slice status lifecycle

Slices have status field values:

- **planned**: scheduled but not yet started
- **in-progress**: at least one story in this slice has
  started
- **delivered**: all stories in slice are done
- **deferred**: pushed to later release or cancelled

Status doesn't auto-update from story status (different
abstraction layers); the slicing command and dedicated status-
update commands handle transitions.

## Anti-patterns

- **Story maps without journey refs.** A story map without
  a journey is a backlog with extra steps. The journey
  anchors the user-context.

- **Slices that don't deliver complete journeys.** If MVP
  has stories for steps 1, 3, 5 but not 2, 4 — the user
  can't complete the journey. Either fill in the gaps or
  skip the unsupported steps in MVP.

- **Single-slice maps.** A story map with only MVP and no
  future slices is just a release plan. That's fine for
  early-stage products; over time, the map should grow
  multiple slices showing roadmap.

- **Slices with too many stories.** A slice with 30+ stories
  isn't a slice; it's a quarter of work. Break into smaller
  slices.

- **Stories in multiple slices of the same map.** A story
  belongs in one slice (the earliest where it appears).
  Cross-map appearance is fine (same story in different
  release planning maps).

- **Story maps that mirror engineering capacity rather than
  user journey.** "What we can build in Q3" isn't a story
  map; it's a sprint plan. Story maps describe user-facing
  releases; capacity planning is engineer-side.

- **Story maps that aren't updated when stories change
  status.** Stale maps (where many stories are done but
  slices show planned) confuse stakeholders. Periodic
  re-slicing keeps maps current.

- **Building maps without writing the stories first.** Some
  teams sketch maps before writing detailed stories — fine
  for shaping. But before slicing for delivery, stories
  should exist with at least narrative + persona refs. Maps
  referencing fictional stories are roadmap fan-fiction.

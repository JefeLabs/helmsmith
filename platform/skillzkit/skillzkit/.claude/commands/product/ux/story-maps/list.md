---
outcome: List existing story maps
description: List story maps in the project. Filter by journey, by slice status, by completion state. Show summaries or full backbone + slice structure. Useful for finding the right map to add to, identifying maps with all slices delivered, or surfacing maps with stale planning.
argument-hint: [--journey <journey-id>] [--has-active-slice] [--full]
allowed-tools: Read, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/story-maps/_context.md`.

Query the story map inventory.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Parse flags:

   ```bash
   FILTER_JOURNEY=""
   HAS_ACTIVE_SLICE=false   # at least one slice in 'planned' or 'in-progress'
   SHOW_FULL=false
   
   while [[ "$#" -gt 0 ]]; do
     case "$1" in
       --journey) FILTER_JOURNEY="$2"; shift 2 ;;
       --has-active-slice) HAS_ACTIVE_SLICE=true; shift ;;
       --full) SHOW_FULL=true; shift ;;
       *) shift ;;
     esac
   done
   ```

## Phase 1: query

```bash
QUERY='.storyMaps'

if [ -n "$FILTER_JOURNEY" ]; then
  QUERY="$QUERY | map(select(.journeyRef == \"$FILTER_JOURNEY\"))"
fi

if [ "$HAS_ACTIVE_SLICE" = "true" ]; then
  QUERY="$QUERY | map(select(.slices[]?.status == \"planned\" or .slices[]?.status == \"in-progress\"))"
fi

MAPS=$(jq -r "$QUERY" product/.pencil-ux.json)
COUNT=$(echo "$MAPS" | jq 'length')
```

## Phase 2: format and display

### Compact output (default)

```
=== Story Maps (3) ===

map-admin-onboarding-v1
  Name:      School Admin Onboarding v1.0
  Journey:   journey-admin-onboarding (user-flow)
  Backbone:  4 activities
  Slices:    2 (1 in-progress, 1 planned)
  Stories:   9 total (7 sliced, 2 un-sliced)
  Last updated: 1 week ago

map-tournament-acquisition-v1
  Name:      Tournament Organizer Acquisition v1.0
  Journey:   journey-tournament-acquisition (customer-journey)
  Backbone:  6 activities
  Slices:    3 (1 delivered, 1 in-progress, 1 planned)
  Stories:   18 total (16 sliced, 2 un-sliced)
  Last updated: 3 days ago

map-compliance-audit-response-v1
  Name:      Compliance Audit Response v1.0
  Journey:   journey-compliance-audit (service-blueprint)
  Backbone:  5 activities
  Slices:    1 (1 in-progress)
  Stories:   12 total (8 sliced, 4 un-sliced)
  Last updated: 2 weeks ago
```

### With `--full`

Show backbone + slice structure for each map:

```
=== Story Maps (3, full) ===

map-admin-onboarding-v1
  Name:      School Admin Onboarding v1.0
  Journey:   journey-admin-onboarding (user-flow)
  Created:   2026-04-25
  Updated:   2026-05-15
  
  Backbone (4 activities):
    1. Sign up
    2. School profile setup
    3. First useful action
    4. Settings configured
  
  Slices (2):
    
    MVP (in-progress, target 2026-07-01)
      Description: Smallest viable launch. Each backbone
                   step has at least one story.
      Stories (4):
        - story-email-signup (Sign up)
        - story-school-name-only (School profile setup)
        - story-placeholder-dashboard (First useful action)
        - story-readonly-entries (Settings configured)
      
      Story status: 3 done, 1 in-progress
    
    v1.1 (planned, target 2026-09-01)
      Description: Enhanced setup and dashboard. Adds SSO,
                   logo upload, pre-filled dashboard.
      Stories (3):
        - story-add-sso (Sign up)
        - story-school-logo-upload (School profile setup)
        - story-prefilled-dashboard (First useful action)
      
      Note: No v1.1 story for 'Settings configured'. v1.1
      doesn't add to that activity.
  
  Un-sliced stories (2):
    - story-bulk-invite
    - story-google-signup
  
  Markdown: docs/ux/story-maps/admin-onboarding-v1.md

[continues for each map]
```

### With `--has-active-slice`

Show maps with at least one planned or in-progress slice
(roadmap with active commitment):

```
=== Story Maps with Active Slices (3) ===

These maps have at least one slice in 'planned' or
'in-progress' status — active roadmap commitments.

map-admin-onboarding-v1
  Active: MVP (in-progress), v1.1 (planned)
  Next milestone: MVP target 2026-07-01

map-tournament-acquisition-v1
  Active: v1.1 (in-progress), v1.2 (planned)
  Next milestone: v1.1 target 2026-08-15

map-compliance-audit-response-v1
  Active: MVP (in-progress)
  Next milestone: MVP target 2026-08-30
```

### Filtered by journey

```
=== Story Maps for journey-admin-onboarding (2) ===

map-admin-onboarding-v1
  Name: School Admin Onboarding v1.0
  Slices: 2 (MVP in-progress, v1.1 planned)

map-admin-onboarding-v2  (planning, not yet built)
  Name: School Admin Onboarding v2.0
  Slices: 0 (no slices yet)
  Note: Map exists but no slices defined. Consider deleting
        if not actively planned, or adding initial slice.
```

## Phase 3: aggregate analysis

When run without filters, surface aggregate insights:

```
=== Aggregate Analysis ===

Total maps: 3
Maps by journey type:
  user-flow: 1
  customer-journey: 1
  service-blueprint: 1

Slice status across all maps:
  delivered: 1
  in-progress: 3
  planned: 2
  deferred: 0

Roadmap commitments (active slices):
  Next 30 days:
    - MVP (map-admin-onboarding-v1) — target 2026-07-01
  
  Next 90 days:
    - v1.1 (map-admin-onboarding-v1) — target 2026-09-01
    - v1.2 (map-tournament-acquisition-v1) — target 2026-10-01
  
  Beyond 90 days:
    - v2.0 (map-tournament-acquisition-v1) — target 2026-Q4

Stale maps (lastUpdated > 90 days):
  - none

Coverage check:
  Journeys with story maps: 3 of 5 journeys
  Journeys without story maps:
    - journey-monthly-review
    - journey-tournament-registration
  
  Recommendation: consider building maps for these journeys
  to formalize roadmap planning.
```

## Empty state

```
=== Story Maps (0) ===

No story maps built yet.

To build a story map:
  /product:ux:story-maps:build <name>

Story maps anchor to journeys, so map a journey first if
none exist:
  /product:ux:journeys:map <name>
```

## Cross-namespace usage

Output is referenced when:

- **Sprint planning** — see active slices and target dates
- **Stakeholder communication** — share roadmap via story
  map markdown files
- **Capability planning** — engineer:capability-introduction
  may reference story maps to identify which capabilities
  are needed for which release
- **Audit triage** — surface stale maps, journeys without
  maps

The command is read-only.

## What this command does NOT do

- **Modify maps.** That's `build` and `slice`.
- **Render visual maps.** Output is text. Future commands
  could generate visual representations (HTML grid, Mermaid).
- **Sync with project planning tools.** Roadmap tools
  (Aha!, Productboard, etc.) have their own surfaces.

## Examples

```bash
# Quick inventory
/product:ux:story-maps:list

# Maps for a specific journey
/product:ux:story-maps:list --journey journey-admin-onboarding

# Active roadmap commitments
/product:ux:story-maps:list --has-active-slice

# Full structure
/product:ux:story-maps:list --full
```

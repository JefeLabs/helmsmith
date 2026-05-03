---
description: List user stories. Filter by persona, by status, by pain point addressed, by parent/child relationship, by ticket-tracking state. Show summaries or full narrative + criteria. Useful for sprint planning, finding stories to address pain points, identifying orphan stories not in any story map.
argument-hint: [--persona <id>] [--status draft|ready|in-progress|done|abandoned] [--addresses <pain-id>] [--orphan] [--full]
allowed-tools: Read, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/stories/_context.md`.

Query the story inventory in `product/.pencil-ux.json`.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Parse flags:

   ```bash
   FILTER_PERSONA=""
   FILTER_STATUS=""
   FILTER_PAIN=""
   ORPHAN_ONLY=false       # stories not in any story map
   SHOW_FULL=false         # full narrative + criteria
   SIZE_FILTER=""
   
   while [[ "$#" -gt 0 ]]; do
     case "$1" in
       --persona) FILTER_PERSONA="$2"; shift 2 ;;
       --status) FILTER_STATUS="$2"; shift 2 ;;
       --addresses) FILTER_PAIN="$2"; shift 2 ;;
       --orphan) ORPHAN_ONLY=true; shift ;;
       --full) SHOW_FULL=true; shift ;;
       --size) SIZE_FILTER="$2"; shift 2 ;;
       *) shift ;;
     esac
   done
   ```

## Phase 1: query

```bash
QUERY='.stories'

if [ -n "$FILTER_PERSONA" ]; then
  QUERY="$QUERY | map(select(.personaRefs | index(\"$FILTER_PERSONA\")))"
fi

if [ -n "$FILTER_STATUS" ]; then
  QUERY="$QUERY | map(select(.status == \"$FILTER_STATUS\"))"
fi

if [ -n "$FILTER_PAIN" ]; then
  QUERY="$QUERY | map(select(.addressesPainRefs | index(\"$FILTER_PAIN\")))"
fi

if [ -n "$SIZE_FILTER" ]; then
  QUERY="$QUERY | map(select(.size == \"$SIZE_FILTER\"))"
fi

STORIES=$(jq -r "$QUERY" product/.pencil-ux.json)

# Orphan filter requires cross-checking story-maps
if [ "$ORPHAN_ONLY" = "true" ]; then
  ALL_MAPPED_STORIES=$(jq -r '[.storyMaps[].slices[].storyRefs[]] | flatten | unique' \
                            product/.pencil-ux.json)
  
  STORIES=$(echo "$STORIES" | jq --argjson mapped "$ALL_MAPPED_STORIES" \
              'map(select(.id as $id | $mapped | index($id) | not))')
fi
```

## Phase 2: format and display

### Compact output (default)

```
=== Stories (12) ===

Sorted by status (in-progress → ready → draft → done → abandoned),
then by created date (newest first).

IN-PROGRESS (3):
  story-export-compliance-pdf
    Title: Export compliance report as PDF
    Persona: persona-school-admin
    Size: M
    Addresses: pain-cant-export-compliance-report (blocker)
    Ticket: SCOOL-1247

  story-persist-form-state
    Title: Persist form state across session expiry
    Personas: persona-school-admin, persona-district-it-director
    Size: L (consider splitting)
    Addresses: pain-data-loss-on-session-expire (blocker)
    Ticket: SCOOL-1248
  
  story-mobile-compliance-entry
    Title: Compliance entry on mobile
    Persona: persona-school-admin
    Size: M
    No pain points linked

READY (5):
  story-batch-import-students
    Title: Batch import student records
    Persona: persona-district-it-director
    Size: L
    Addresses: pain-manual-roster-management
  
  ...

DRAFT (3):
  story-vendor-evaluation-template
    Title: Vendor evaluation template
    Personas: persona-school-admin
    Size: ?  (not yet sized)
    Notes: Needs acceptance criteria

DONE (1):
  story-cohort-comparison-view
    Title: Cohort comparison view
    Persona: persona-school-admin
    Size: M
    Done: 2 weeks ago
    Ticket: SCOOL-1198 (closed)
```

### With `--full`

Show full narrative + acceptance criteria for each story:

```
=== Stories (12, full) ===

story-export-compliance-pdf (in-progress)
  Title: Export compliance report as PDF
  Personas: persona-school-admin
  Size: M | Status: in-progress
  Created: 2026-05-10 | Updated: 2026-05-15
  
  Narrative:
    As a school admin,
    I want to export my compliance summary as a PDF,
    So that I can submit it to district auditors.
  
  Acceptance criteria (4):
    1. Given I have completed my compliance entries for the
       current quarter
       When I click 'Export to PDF' from the compliance dashboard
       Then a PDF file downloads named <school>-compliance-
       <quarter>.pdf, containing all entries from the current
       quarter, formatted for district auditor submission
    
    2. ...
  
  Addresses: pain-cant-export-compliance-report (blocker)
  Ticket: SCOOL-1247
  Markdown: docs/ux/stories/story-export-compliance-pdf.md

[continues for each story]
```

### With `--orphan`

Show stories that aren't in any story map:

```
=== Orphan Stories (4) ===

These stories aren't referenced by any story map. They may be
work-in-progress, deprioritized, or accidental orphans.

story-mobile-compliance-entry
  Status: in-progress
  Persona: persona-school-admin
  
  Recommendation: This story is in-progress but not mapped.
  Add to a story map for context:
  /product:ux:story-maps:build (or :update for existing map)

story-vendor-evaluation-template
  Status: draft
  Personas: persona-school-admin
  
  Recommendation: Draft stories may not need mapping yet.
  Either flesh it out with acceptance criteria or remove.
```

### Filtered by persona

```
=== Stories for persona-school-admin (8) ===

In-progress (2):
  - story-export-compliance-pdf (M)
  - story-mobile-compliance-entry (M)

Ready (4):
  - story-batch-import-students (L) - shared with district-it-director
  - story-cohort-filter (S)
  - story-quarterly-summary (M)
  - story-bulk-message-staff (M)

Draft (1):
  - story-vendor-evaluation-template (?)

Done (1):
  - story-cohort-comparison-view (M)
```

### Filtered by pain

```
=== Stories addressing pain-cant-export-compliance-report (1) ===

story-export-compliance-pdf (in-progress)
  Title: Export compliance report as PDF
  Persona: persona-school-admin
  Size: M
```

When the pain has multiple addressing stories, all are listed.
When 0 stories address it, surface a recommendation:

```
=== Stories addressing pain-no-cross-school-comparison (0) ===

This pain has no addressing stories.

Recommendation: write a story to address it:
  /product:ux:stories:write --addresses pain-no-cross-school-comparison
```

## Phase 3: aggregate analysis

When run without filters, surface aggregate insights:

```
=== Aggregate Analysis ===

Total stories: 12
By status:
  draft: 3 (25%)
  ready: 5 (42%)
  in-progress: 3 (25%)
  done: 1 (8%)
  abandoned: 0

By size:
  XS: 0
  S:  1
  M:  7
  L:  3 (consider splitting)
  XL: 1 (definitely split)

By persona:
  persona-school-admin: 8
  persona-district-it-director: 4
  persona-tournament-organizer: 1
  Multi-persona: 1

Pain point coverage:
  Stories address 8 of 12 pain points (67%)
  Unaddressed pain points: 4
    - pain-no-cross-school-comparison (major)
    - pain-vendor-evaluation-takes-weeks (major)
    - pain-confusing-navigation (moderate)
    - pain-slow-page-load (moderate)
  
  Recommendation: 2 major pain points unaddressed. Consider
  writing stories for them.

Story-map coverage:
  Stories in maps: 8 of 12 (67%)
  Orphan stories: 4
  
  See: /product:ux:stories:list --orphan

Splitting candidates:
  4 stories sized L or XL. Consider splitting:
    - story-persist-form-state (L)
    - story-batch-import-students (L)
    - story-real-time-notifications (XL)
    - story-cross-district-reporting (L)

Velocity (this quarter):
  Done: 1
  In-progress: 3
  
  Last quarter done: 4 (declining velocity)
```

## Empty state

```
=== Stories (0) ===

No stories written yet.

To write a user story:
  /product:ux:stories:write <title>

Stories anchor implementation work to user context (persona,
capability, outcome). They're typically written from:
  - Pain points: /product:ux:journeys:pain-points
  - Capabilities: from engineer:capability-introduction
  - Direct user feedback or research findings
```

## Cross-namespace usage

Output is referenced when:

- **Sprint planning** — show ready stories
- **Pain-point triage** — find stories addressing each pain
- **Story-map building** — find stories to add to a map
- **Velocity tracking** — done stories per quarter
- **Audit triage** — orphans, splitting candidates,
  unaddressed pain coverage

The command is read-only.

## What this command does NOT do

- **Modify stories.** That's `write`.
- **Auto-suggest story splits.** Surfaces candidates;
  splitting is a deliberate decision via `write --split-from`.
- **Show external ticket status.** `ticketRef` is shown;
  fetching live status from Jira/GitHub requires
  `/integrations:jira` or similar (not yet integrated).

## Examples

```bash
# Full inventory
/product:ux:stories:list

# Ready stories for a persona
/product:ux:stories:list --persona persona-school-admin --status ready

# Stories addressing a specific pain
/product:ux:stories:list --addresses pain-cant-export-compliance-report

# Orphan stories (not in any story map)
/product:ux:stories:list --orphan

# Full details
/product:ux:stories:list --full

# Large stories (splitting candidates)
/product:ux:stories:list --size L
/product:ux:stories:list --size XL
```

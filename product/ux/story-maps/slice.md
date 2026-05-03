---
description: Define release slices on an existing story map. Add new slices (v1.1, v1.2, etc.), modify existing slices, or update slice status. Each slice is a thin-but-complete user journey for a release. Optional integration with /integrations:jira for bulk ticket creation from slice.
argument-hint: <map-id> [--add | --update <slice-name> | --remove <slice-name> | --status <slice-name> <status> | --create-tickets <slice-name>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/story-maps/_context.md`, `product/_context.md`.

Manage release slices on an existing story map. Initial
slicing happens in `/product:ux:story-maps:build` (typically
just MVP). This command adds subsequent slices as roadmap
develops.

The command also bridges to ticket trackers — bulk-creating
tickets for all stories in a slice when an integration is
configured.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Verify map exists:

   ```bash
   MAP_ID="$1"
   
   MAP=$(jq -r ".storyMaps[] | select(.id == \"$MAP_ID\")" \
               product/.pencil-ux.json 2>/dev/null)
   
   if [ -z "$MAP" ]; then
     echo "Story map '$MAP_ID' not found."
     echo ""
     echo "Available maps:"
     jq -r '.storyMaps[] | "  \(.id): \(.name)"' product/.pencil-ux.json
     exit 1
   fi
   ```

3. Parse mode:

   ```bash
   MODE="default"
   case "$2" in
     --add) MODE="add" ;;
     --update) MODE="update"; SLICE_NAME="$3" ;;
     --remove) MODE="remove"; SLICE_NAME="$3" ;;
     --status) MODE="status"; SLICE_NAME="$3"; NEW_STATUS="$4" ;;
     --create-tickets) MODE="create-tickets"; SLICE_NAME="$3" ;;
   esac
   ```

## Phase 1: surface current state (default mode)

```
=== Story Map Slices: map-admin-onboarding-v1 ===

Map:         School Admin Onboarding v1.0
Journey:     journey-admin-onboarding
Backbone:    4 activities

Current slices (1):

  [1] MVP
      Status:        in-progress
      Target date:   2026-07-01
      Stories:       4
      Description:   Smallest viable launch. Each backbone
                     step has at least one story to keep
                     the journey complete end-to-end.

Stories not in any slice (5):
  - story-add-sso
  - story-bulk-invite
  - story-google-signup
  - story-school-logo-upload
  - story-prefilled-dashboard

Options:
  [a] Add a new slice (v1.1, v1.2, etc.)
  [e] Edit existing slice (specify number)
  [r] Remove slice (specify number)
  [s] Update slice status (specify number)
  [t] Create tickets for slice's stories (when integration
      configured)
  [d] Done

Choice:
> 
```

## Phase 2: add a new slice

```
=== Add Slice ===

Slice name (e.g., "v1.1", "Beta", "Q3 release"):
> v1.1

Description:
> Enhanced setup and dashboard. Adds SSO, school logo upload,
  pre-filled dashboard with real data.

Target date (YYYY-MM-DD or skip):
> 2026-09-01

Status:
  [p] planned (default)
  [i] in-progress
  [d] delivered (rare for new slice; usually for retroactive
      documentation)

Status:
> p

Now select stories for this slice. Currently un-sliced
stories belong to the map but aren't yet in a slice:

Backbone 'Sign up':
  Already in MVP: story-email-signup ✓
  [1] story-add-sso (draft) — un-sliced
  [2] story-bulk-invite (draft) — un-sliced
  [3] story-google-signup (draft) — un-sliced

Backbone 'School profile setup':
  Already in MVP: story-school-name-only ✓
  [4] story-school-logo-upload (draft) — un-sliced

Backbone 'First useful action':
  Already in MVP: story-placeholder-dashboard ✓
  [5] story-prefilled-dashboard (draft) — un-sliced

Backbone 'Settings configured':
  Already in MVP: story-readonly-entries ✓
  (no un-sliced stories)

Select stories for v1.1 (comma-separated):
> 1, 4, 5

Slice v1.1 will include 3 stories:
  - story-add-sso (Sign up)
  - story-school-logo-upload (School profile setup)
  - story-prefilled-dashboard (First useful action)

Note: Backbone 'Settings configured' has no v1.1 story.
That's OK — it means v1.1 doesn't add to that activity beyond
what's in MVP.

Add v1.1 with these stories? [Y/edit/abort]
```

## Phase 3: edit existing slice

```
=== Edit Slice: MVP ===

Current state:
  Status:        in-progress
  Target date:   2026-07-01
  Stories (4):
    - story-email-signup
    - story-school-name-only
    - story-placeholder-dashboard
    - story-readonly-entries

What to edit?
  [d] Description
  [t] Target date
  [a] Add stories
  [r] Remove stories
  [s] Replace stories (full reselection)

Choice:
> a

Stories to add to MVP (currently un-sliced):
  [1] story-add-sso
  [2] story-bulk-invite
  ...

Select to add:
> 
```

## Phase 4: status update

```
=== Update Slice Status ===

Slice: MVP
Current status: in-progress

New status:
  [p] planned
  [i] in-progress
  [d] delivered
  [x] deferred

Choice:
> d

Confirm: MVP → delivered? [Y/n]
> Y

Slice status updated.

When status moves to 'delivered':
  - Slice's targetDate captured as actualDate
  - Suggest: review whether all slice stories are 'done'
    (some may still be 'in-progress' if delivery scope was
    reduced)
```

When marking delivered:

```
=== Story Status Check ===

Slice MVP marked delivered. Story status check:

Stories with status 'done': 3 of 4
Stories not 'done':
  - story-readonly-entries (status: in-progress)

Mismatch — slice delivered but story not done. Options:

  [s] Update story status to 'done' (delivery confirmed)
  [d] Defer this story to next slice (unmark from MVP)
  [k] Keep as-is (story will be done post-launch)

Choice:
> s

story-readonly-entries → status: done
```

## Phase 5: create tickets from slice

When `--create-tickets <slice-name>` is invoked:

```bash
# Verify integration is configured
INTEGRATION=$(jq -r '.integrations | keys[]' \
                    product/.pencil-integrations.json 2>/dev/null | \
              grep -E "^(jira|github|linear)$" | head -1)

if [ -z "$INTEGRATION" ]; then
  echo "No ticket integration configured."
  echo ""
  echo "To enable bulk ticket creation, set up one of:"
  echo "  /integrations:setup jira"
  echo "  /integrations:setup github"
  echo "  /integrations:setup linear"
  exit 0
fi
```

When integration is configured:

```
=== Create Tickets from Slice: MVP ===

Integration: jira
Stories in MVP: 4

Story status:
  - story-email-signup
      ticketRef: (empty)
      Will create ticket: yes
  
  - story-school-name-only
      ticketRef: SCOOL-1230
      Will skip (already linked)
  
  - story-placeholder-dashboard
      ticketRef: (empty)
      Will create ticket: yes
  
  - story-readonly-entries
      ticketRef: (empty)
      Will create ticket: yes

Will create 3 new tickets, skip 1 already linked.

Optional: also create a Jira epic linking all MVP tickets?
  [Y/n] (recommended for slice tracking)

Confirm? [Y/edit/abort]
> Y
```

The command then invokes the integration:

```bash
# For each story without ticketRef:
for STORY_ID in $(echo "$MVP_STORIES_WITHOUT_TICKET"); do
  # Read story details
  STORY=$(jq -r ".stories[] | select(.id == \"$STORY_ID\")" \
                product/.pencil-ux.json)
  
  # Build ticket payload
  TITLE=$(echo "$STORY" | jq -r '.title')
  NARRATIVE=$(echo "$STORY" | jq -r '"As a \(.narrative.role), I want \(.narrative.capability), so that \(.narrative.outcome)."')
  CRITERIA=$(echo "$STORY" | jq -r '.acceptanceCriteria | map("- Given \(.given)\n  When \(.when)\n  Then \(.then)") | join("\n\n")')
  
  # Invoke integration
  TICKET_REF=$(/integrations:jira create-issue \
    --type Story \
    --title "$TITLE" \
    --description "$NARRATIVE\n\nAcceptance criteria:\n$CRITERIA" \
    --label "story-map:map-admin-onboarding-v1" \
    --label "slice:MVP")
  
  # Update story with ticketRef
  jq --arg id "$STORY_ID" \
     --arg ticket "$TICKET_REF" \
    '.stories |= map(
       if .id == $id then .ticketRef = $ticket else . end
     )' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
done
```

```
=== Tickets Created ===

Created 3 Jira tickets:
  story-email-signup → SCOOL-1247
  story-placeholder-dashboard → SCOOL-1248
  story-readonly-entries → SCOOL-1249

Created Jira epic: SCOOL-1246
  "School Admin Onboarding v1.0 — MVP"
  Linked tickets: SCOOL-1230, SCOOL-1247, SCOOL-1248, SCOOL-1249

Story manifest updated with ticketRef values.
```

## Phase 6: write to manifest

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Update slices array on the map
jq --arg id "$MAP_ID" \
   --argjson new_slices "$NEW_SLICES_JSON" \
   --arg now "$NOW" \
  '.storyMaps |= map(
     if .id == $id then
       .slices = $new_slices |
       .lastUpdated = $now
     else . end
   )
   | .lastUpdated = $now' \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json
```

Markdown content also updated to reflect new slicing.

## Phase 7: result

```
=== Slices Updated ===

Map:           map-admin-onboarding-v1
Slices:        2 (MVP delivered, v1.1 planned)
Stories sliced: 7 of 9 (78%)
Un-sliced:     2 (story-add-sso, story-bulk-invite)

Manifest:      product/.pencil-ux.json
Markdown:      docs/ux/story-maps/admin-onboarding-v1.md

Next steps:
  - Create tickets for v1.1:
    /product:ux:story-maps:slice map-admin-onboarding-v1 \\
      --create-tickets v1.1
  - Mark v1.1 in-progress when work starts:
    /product:ux:story-maps:slice map-admin-onboarding-v1 \\
      --status v1.1 in-progress
  - List all maps: /product:ux:story-maps:list
```

## Cross-namespace integration patterns

The command bridges UX artifacts to execution tooling. Key
integration patterns:

### `/integrations:jira create-tickets-from-slice`

Bulk creates Jira issues from slice's stories. The map and
slice info are added as labels for filtering. Optional epic
groups all slice tickets.

### `/integrations:github create-issues-from-slice`

Same pattern for GitHub Issues. Uses GitHub project as the
grouping equivalent (or milestone if project not configured).

### `/integrations:linear create-issues-from-slice`

Same pattern for Linear. Uses Linear project as the grouping.

### `/workflows:manage start market:launch-campaign --slice <map-id>:<slice-name>`

When marketing wants to launch the slice, the campaign
workflow reads slice stories to understand what's launching.

These integrations are optional — the slice command works
without them, and bulk-ticket-creation just becomes "skipped,
configure integration to enable."

## What this command does NOT do

- **Auto-slice based on story sizes.** Slicing is a product
  decision. Stories carry sizes (XS/S/M/L/XL); the slicing
  command shows them but doesn't auto-balance.
- **Force every backbone activity in every slice.** A slice
  may skip backbone activities. The command surfaces gaps
  but doesn't prevent them.
- **Manage ticket lifecycle after creation.** Once tickets
  are created, their lifecycle (status, assignment,
  resolution) lives in the ticket tracker. Story status
  updates follow.
- **Auto-detect slice completion.** Slice status is updated
  manually. Future commands could detect "all stories done →
  suggest delivered" but the command stays explicit.

## Examples

```bash
# Default mode (menu-driven)
/product:ux:story-maps:slice map-admin-onboarding-v1

# Add a new slice
/product:ux:story-maps:slice map-admin-onboarding-v1 --add

# Update slice status
/product:ux:story-maps:slice map-admin-onboarding-v1 \
  --status MVP delivered

# Bulk create tickets from a slice
/product:ux:story-maps:slice map-admin-onboarding-v1 \
  --create-tickets MVP

# Edit a specific slice
/product:ux:story-maps:slice map-admin-onboarding-v1 \
  --update v1.1
```

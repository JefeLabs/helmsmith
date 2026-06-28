---
outcome: Build a story map
description: Build a story map. Anchor to a journey, define backbone (top-level user activities), populate stories underneath each backbone step. Initial slicing happens here (often just MVP); deeper slicing happens via /product:ux:story-maps:slice. Writes to product/.pencil-ux.json and creates a markdown file at docs/ux/story-maps/.
argument-hint: <map-name> [--journey <journey-id>] [--from-existing <map-id>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/story-maps/_context.md`, `product/_context.md`.

Build a story map. The command walks through:

1. Anchor to a journey
2. Define backbone (top-level user activities)
3. Populate stories under each backbone step
4. Initial slicing (typically MVP slice)

Subsequent slicing — adding v1.1, v1.2, deferred slices —
happens via the `slice` command.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Resolve map ID from name:

   ```bash
   MAP_NAME="$1"
   MAP_SLUG=$(echo "$MAP_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | head -c 60)
   MAP_ID="map-${MAP_SLUG}"
   ```

3. Check existence:

   ```bash
   if jq -e ".storyMaps[] | select(.id == \"$MAP_ID\")" \
            product/.pencil-ux.json >/dev/null 2>&1; then
     echo "Map '$MAP_ID' already exists. Use --update to modify"
     echo "or /product:ux:story-maps:slice to add slices."
     exit 1
   fi
   ```

## Phase 1: journey anchor

```
=== Story Map: <name> ===

Step 1 of 4: Journey anchor

Which journey does this story map represent?

Existing journeys:
  [1] journey-admin-onboarding (user-flow)
      School Admin Onboarding · 4 stages · serves
      persona-school-admin
  [2] journey-tournament-acquisition (customer-journey)
      Tournament Organizer Acquisition · 6 stages · serves
      persona-tournament-organizer
  [3] journey-compliance-audit (service-blueprint)
      Compliance Audit Response · 5 stages · serves
      persona-school-admin, persona-district-it-director

Select journey (number) or type a journey-id:
> 1
```

When the journey doesn't exist:

```
No matching journey. Options:

  [m] Map a new journey first (recommended)
  [c] Continue without journey anchor (story map will be
      orphaned; not recommended)
  [a] Abort

Choice:
```

## Phase 2: backbone

```
Step 2 of 4: Backbone

The backbone is the top-level user activities, in the order
they happen. They typically align with the journey's stages.

Journey 'journey-admin-onboarding' has these stages:
  1. Sign up
  2. School profile setup
  3. First useful action
  4. Settings configured

Use these as the backbone? [Y/customize]
> Y
```

If user customizes:

```
=== Custom Backbone ===

Define the backbone activities. Each is a top-level user
activity in order.

Activity 1:
  Name (e.g., "Sign up"):
> 
  Description (one line):
> 

Add another? [Y/n]
> Y

Activity 2:
[continues]

Done? Type "done" when complete.
```

## Phase 3: populate stories per backbone step

For each backbone activity, prompt for stories:

```
=== Stories for backbone: 'Sign up' ===

What stories belong under this backbone activity? Stories
can be:

  [e] Existing stories from product/.pencil-ux.json
  [n] New stories created inline (will be added to manifest
      with status 'draft')
  [d] Done with this backbone activity

Choice:
> e

Existing stories matching this backbone (filtered by persona
and topic similarity):
  [1] story-email-signup (ready)
      "As a school admin, I want to sign up via email..."
  [2] story-add-sso (draft)
      "As a school admin, I want to sign up via SSO..."
  [3] story-bulk-invite (draft)
      "As a district IT, I want to bulk-invite school admins..."

Select stories for this backbone activity (comma-separated):
> 1, 2, 3

Selected 3 stories under 'Sign up'.

Add more stories under this backbone? [Y/n]
> n
```

Inline story creation:

```
=== New Story for backbone: 'Sign up' ===

Title:
> Quick sign up via Google

This will be created as a draft story. Provide narrative now
or leave for later refinement?

  [n] Provide narrative now
  [l] Leave for later (just creates placeholder with title)

Choice:
> n

[walks through narrative — same as /product:ux:stories:write
 Phase 2]
```

## Phase 4: initial slicing

```
Step 3 of 4: Initial slicing

Most story maps start with just an MVP slice. You can add more
slices (v1.1, v1.2, etc.) later via /product:ux:story-maps:slice.

Initial slices to define:
  [1] Just MVP (recommended for first build)
  [2] MVP + v1.1
  [3] MVP + v1.1 + v1.2
  [c] Custom slice names

Choice:
> 1

=== Slice: MVP ===

Description (what does MVP cover?):
> Smallest viable launch. Each backbone step has at least one
  story to keep the journey complete end-to-end.

Target date (YYYY-MM-DD or skip):
> 2026-07-01

Status:
  [p] planned (default)
  [i] in-progress (work has started)

Status:
> p

Now select stories that belong in MVP. The map's stories are:

Backbone 'Sign up':
  [1] story-email-signup (ready)
  [2] story-add-sso (draft)
  [3] story-bulk-invite (draft)
  [4] story-google-signup (draft, just created)

Backbone 'School profile setup':
  [5] story-school-name-only (ready)
  [6] story-school-logo-upload (draft)

Backbone 'First useful action':
  [7] story-placeholder-dashboard (ready)
  [8] story-prefilled-dashboard (draft)

Backbone 'Settings configured':
  [9] story-readonly-entries (ready)
  [10] story-edit-entries (draft)

Select stories for MVP (one per backbone activity for full
journey coverage):
> 1, 5, 7, 9

MVP includes 4 stories — one per backbone activity.
This is a thin-but-complete journey. Good MVP shape.
```

The command nudges toward thin-but-complete coverage:

```
⚠ Notice: backbone 'Sign up' has 0 stories in MVP.

This means the user can't complete sign-up in the MVP slice,
breaking the journey. Options:

  [a] Add at least one Sign up story to MVP
  [r] Remove Sign up from this map's backbone (not in MVP scope)
  [c] Continue anyway (acknowledge incomplete journey)

Choice:
```

## Phase 5: review

```
=== Story Map Review ===

ID:        map-admin-onboarding-v1
Name:      School Admin Onboarding v1.0
Journey:   journey-admin-onboarding (user-flow)

Backbone (4 activities):
  1. Sign up
  2. School profile setup
  3. First useful action
  4. Settings configured

Slices (1):
  MVP (planned, target 2026-07-01)
    Stories (4):
      - story-email-signup
      - story-school-name-only
      - story-placeholder-dashboard
      - story-readonly-entries

Stories not yet in any slice (5):
  - story-add-sso
  - story-bulk-invite
  - story-google-signup
  - story-school-logo-upload
  - story-prefilled-dashboard

These stories belong to the map but aren't yet sliced. Add
them via /product:ux:story-maps:slice when ready.

Save this story map? [Y/edit/abort]
```

## Phase 6: write artifacts

### Manifest entry

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

MAP_ENTRY=$(jq -n \
  --arg id "$MAP_ID" \
  --arg name "$MAP_NAME" \
  --arg journeyRef "$JOURNEY_REF" \
  --arg filePath "docs/ux/story-maps/${MAP_SLUG}.md" \
  --argjson backbone "$BACKBONE_JSON" \
  --argjson slices "$SLICES_JSON" \
  --arg now "$NOW" \
  '{
    id: $id,
    name: $name,
    journeyRef: $journeyRef,
    filePath: $filePath,
    backbone: $backbone,
    slices: $slices,
    created: $now,
    lastUpdated: $now
  }')

jq ".storyMaps += [$MAP_ENTRY] | .lastUpdated = \"$NOW\"" \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json
```

### Markdown content

```bash
mkdir -p docs/ux/story-maps
cat > "docs/ux/story-maps/${MAP_SLUG}.md" <<EOF
# $MAP_NAME

## Journey
$JOURNEY_REF ($(jq -r ".journeys[] | select(.id == \"$JOURNEY_REF\") | .type" product/.pencil-ux.json))

## Backbone

$(format_backbone_with_stories "$BACKBONE" "$SLICES" "$ALL_STORY_REFS")

## Slices summary

$(format_slices_summary "$SLICES")

## Notes
(Add ongoing observations, slicing rationale, deferred
considerations.)
EOF
```

The markdown formats backbone activities with story lists per
slice underneath, producing a readable 2D-ish layout in
text form.

## Phase 7: result

```
=== Story Map Built ===

ID:           map-admin-onboarding-v1
Journey:      journey-admin-onboarding
Backbone:     4 activities
Stories:      9 total (4 in MVP, 5 unsliced)
Slices:       1 (MVP)

Manifest:     product/.pencil-ux.json
Content:      docs/ux/story-maps/admin-onboarding-v1.md

Next steps:
  - Add v1.1 / v1.2 slices when ready:
    /product:ux:story-maps:slice map-admin-onboarding-v1
  - Create Jira tickets for MVP stories (when configured):
    /core:integrations:jira create-tickets-from-slice \\
      map-admin-onboarding-v1 MVP
  - List all story maps: /product:ux:story-maps:list
```

## --from-existing flag

When building a similar map from an existing one:

```bash
/product:ux:story-maps:build "School Admin Onboarding v2.0" \
  --from-existing map-admin-onboarding-v1
```

The command:
1. Loads the existing map as a template
2. User reviews/customizes journey anchor (often unchanged)
3. User reviews backbone (often unchanged or refined)
4. User selects which stories carry over to the new map
5. User defines new slices

Useful when iterating on roadmap (v1 done; planning v2) or
when the same journey gets multiple maps for different
release contexts (release planning, capacity planning,
strategic planning).

## What this command does NOT do

- **Replace agile sprint planning.** Story maps describe
  user-facing releases. Sprint planning is engineer-side.
- **Auto-balance story load across slices.** Slicing is a
  product decision; the command captures the decision.
- **Validate story estimates against capacity.** No
  capacity model here.
- **Visualize as 2D grid.** Output is markdown text. Future
  commands could generate visual maps (Mermaid, HTML).
- **Sync with engineering execution.** Stories may be in
  progress; slicing reflects intent, not state.

## Examples

```bash
# Build a story map from scratch
/product:ux:story-maps:build "School Admin Onboarding v1.0"

# Build from a specific journey
/product:ux:story-maps:build "Compliance Audit Response v1" \
  --journey journey-compliance-audit

# Iterate on existing map
/product:ux:story-maps:build "School Admin Onboarding v2.0" \
  --from-existing map-admin-onboarding-v1
```

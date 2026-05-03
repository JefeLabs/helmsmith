---
description: Create a user story with persona references, narrative (as a / I want / so that), and optional acceptance criteria. Supports creating new stories, updating existing ones, and splitting stories into children. Writes to product/.pencil-ux.json. Optionally creates a markdown file when story has substantial extended notes.
argument-hint: <title> [--persona <id>] [--addresses <pain-id>] [--split-from <parent-id>] [--update]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/stories/_context.md`, `product/_context.md`.

Create a user story or split an existing one. Stories anchor
implementation work to user context — persona, capability,
outcome — and optionally include acceptance criteria.

## Phase 0: pre-flight

1. Verify UX manifest exists; initialize if not (same pattern
   as personas).

2. Resolve story ID from title:

   ```bash
   STORY_TITLE="$1"
   STORY_SLUG=$(echo "$STORY_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g' | head -c 60)
   STORY_ID="story-${STORY_SLUG}"
   ```

3. Detect mode (new / update / split):

   ```bash
   if [ -n "$SPLIT_FROM" ]; then
     MODE="split"
   elif [ -n "$UPDATE_FLAG" ] || story_exists "$STORY_ID"; then
     MODE="update"
   else
     MODE="new"
   fi
   ```

4. For split mode, verify parent exists:

   ```bash
   if [ "$MODE" = "split" ]; then
     PARENT_EXISTS=$(jq -r ".stories[] | select(.id == \"$SPLIT_FROM\") | .id" \
                          product/.pencil-ux.json)
     if [ -z "$PARENT_EXISTS" ]; then
       echo "Parent story '$SPLIT_FROM' not found."
       exit 1
     fi
   fi
   ```

## Phase 1: persona attribution

```
=== Story: <title> ===

Step 1 of 5: Persona

Which persona(s) does this story serve?

Existing personas:
  [1] persona-school-admin (School Admin, hybrid)
  [2] persona-district-it-director (District IT Director, traditional)
  [3] persona-tournament-organizer (Tournament Organizer, jtbd)

Select by number (comma-separated for multi-persona, e.g., "1,3"):
> 1
```

Multi-persona stories supported but flagged:

```
You selected multiple personas (persona-school-admin, persona-teacher).
Confirm: this story genuinely serves both, OR consider whether
two separate stories would be clearer.

  [c] Confirm multi-persona
  [s] Split into separate stories instead (creates multiple stories)
  [b] Back to selection

Choice:
```

## Phase 2: narrative

```
Step 2 of 5: Narrative

The narrative captures the user's need in three parts:

  As a [role/persona],
  I want [capability],
  So that [outcome].

Role:
  Default from persona: school admin
  Customize? (press enter to use default):
> 

Capability (the "I want" clause):
  What does this persona want to do?
  
  Tip: Frame as user-facing action, not implementation.
  Good: "filter candidates by certification status"
  Bad:  "use the certification dropdown to filter the
         candidate list view"
  
> 

Outcome (the "so that" clause):
  Why do they want this? What outcome do they value?
  
  Tip: Outcomes are observable user benefits.
  Good: "I can identify qualified candidates in under 5 minutes"
  Good: "I can stay compliant without manual cross-checking"
  Bad:  "the filter is fast"  (system property, not user benefit)
  Bad:  "users prefer it"  (not measurable)
  
> 
```

## Phase 3: pain point linkage (optional)

```
Step 3 of 5: Pain points addressed

Does this story address known pain points?

Unaddressed pain for selected persona(s):
  [1] pain-cant-export-compliance-report (blocker)
      "School admins cannot export compliance reports for
       district auditors; must use screenshots."
  [2] pain-vendor-evaluation-takes-weeks (major)
      "Vendor evaluation takes 2-4 weeks; risk of bad pick
       is high."
  [3] pain-data-loss-on-session-expire (blocker, in-progress)
      "Form data is lost when session expires."

Select pain points addressed (comma-separated, or "none"):
> 1
```

When pain points are linked, the command later updates the
pain-point's `addressedBy` array to include this story.

## Phase 4: acceptance criteria (optional but encouraged)

```
Step 4 of 5: Acceptance criteria

Acceptance criteria define when this story is "done."
Given/When/Then structure is preferred.

Add criteria? [Y/n/skip-for-now]
(skip-for-now leaves status as 'draft'; you can add later
 with /product:ux:stories:acceptance-criteria)
> Y

=== Acceptance Criterion 1 ===

Given (precondition):
  Tip: The state of the system or user before the action.
  
> I have completed my compliance entries for the current quarter

When (event or action):
  Tip: The triggering event — usually a user action.

> I click 'Export to PDF' from the compliance dashboard

Then (observable outcome):
  Tip: What happens that confirms the story works.
  Multiple "thens" are fine if they all stem from the same
  trigger; use semicolons or "and."

> a PDF file downloads named <school>-compliance-<quarter>.pdf,
  containing all entries from the current quarter, formatted
  for district auditor submission

Add another criterion? [Y/n]
> Y

=== Acceptance Criterion 2 ===
[continues]
```

When user says "n" (done with criteria) or completes their
list:

```
Acceptance criteria added: 4

A reasonable story has 2-5 criteria. You have 4 — looks good.

(If you'd added 8+, the command would suggest splitting the
 story.)
```

## Phase 5: sizing and status

```
Step 5 of 5: Sizing and status

Estimated size:
  [XS] under half a day (e.g., copy change, simple flag)
  [S]  half day to 1 day
  [M]  1-3 days (typical)
  [L]  3-5 days (most teams: split this)
  [XL] over 5 days (definitely split)

Size:
> M

Status:
  [d] draft - story still being shaped
  [r] ready - narrative complete, criteria defined; ready
              for sprint planning
  [i] in-progress - already started (rare for new story
                    creation; usually update mode)
  
Status:
> r
```

## Phase 6: split-mode prompts (when MODE=split)

When splitting a parent story, additional prompts:

```
=== Split from parent: story-export-compliance-data ===

Parent story:
  Title: Export compliance data
  Narrative: As a school admin, I want to export my
             compliance data so that I can submit to auditors.
  Status: draft (will be marked abandoned after splitting)

This story will be a child. Splitting strategy?
  [w] By workflow step
  [d] By data variation
  [r] By role
  [h] By happy path vs edge cases

Strategy:
> d
```

The strategy doesn't change the schema; it's documented in
the parent's `## Notes` section so the splitting rationale is
preserved.

## Phase 7: review

```
=== Story Review ===

ID:        story-export-compliance-pdf
Title:     Export compliance report as PDF
Personas:  persona-school-admin

Narrative:
  As a school admin,
  I want to export my compliance summary as a PDF,
  So that I can submit it to district auditors.

Acceptance criteria (4):
  1. Given I have completed my compliance entries for the
     current quarter
     When I click 'Export to PDF' from the compliance
     dashboard
     Then a PDF file downloads named <school>-compliance-
     <quarter>.pdf, containing all entries from the current
     quarter, formatted for district auditor submission
  
  2. Given I have a draft entry pending in my compliance
     entries
     When I click 'Export to PDF'
     Then I'm prompted with "Some entries are draft; export
     anyway, finalize first, or cancel?"
  
  3. Given I navigate to the compliance dashboard
     When the PDF export feature is available
     Then I see an 'Export to PDF' button in the toolbar
  
  4. Given I'm on a mobile device
     When I tap 'Export to PDF'
     Then the PDF generates and downloads to my mobile
     device's downloads folder

Addresses pain: pain-cant-export-compliance-report (blocker)
Size:     M
Status:   ready

Save this story? [Y/edit/abort]
```

## Phase 8: write artifacts

### Manifest entry

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Build story entry
STORY_ENTRY=$(jq -n \
  --arg id "$STORY_ID" \
  --arg title "$STORY_TITLE" \
  --argjson personaRefs "$PERSONA_REFS_JSON" \
  --arg role "$ROLE" \
  --arg capability "$CAPABILITY" \
  --arg outcome "$OUTCOME" \
  --argjson criteria "$CRITERIA_JSON" \
  --argjson painRefs "$PAIN_REFS_JSON" \
  --arg parentRef "$PARENT_REF" \
  --arg size "$SIZE" \
  --arg status "$STATUS" \
  --arg now "$NOW" \
  '{
    id: $id,
    title: $title,
    personaRefs: $personaRefs,
    narrative: {
      role: $role,
      capability: $capability,
      outcome: $outcome
    },
    acceptanceCriteria: $criteria,
    addressesPainRefs: $painRefs,
    size: $size,
    status: $status,
    created: $now,
    lastUpdated: $now
  }
  | if $parentRef != "" then .parentRef = $parentRef else . end')

# Append story
jq ".stories += [$STORY_ENTRY] | .lastUpdated = \"$NOW\"" \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json

# Update pain-point cross-references
for PAIN_ID in "${PAIN_REFS[@]}"; do
  jq --arg pain_id "$PAIN_ID" \
     --arg story_id "$STORY_ID" \
     '.painPoints |= map(
        if .id == $pain_id then
          .addressedBy = ((.addressedBy // []) +
                           [{type: "story", ref: $story_id}]) |
          .status = (if .status == "unaddressed" then "in-progress" else .status end)
        else . end
      )' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
done

# In split mode, update parent
if [ "$MODE" = "split" ]; then
  jq --arg parent "$PARENT_REF" \
     --arg child "$STORY_ID" \
     '.stories |= map(
        if .id == $parent then
          .childRefs = ((.childRefs // []) + [$child])
        else . end
      )' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
fi
```

### Markdown content (conditional)

When the story has substantial extended context beyond what
fits in the manifest, create a markdown file:

```bash
# Heuristic: create markdown if user requested extended notes
# OR if narrative + criteria total >2000 characters
if [ "$EXTENDED_NOTES_REQUESTED" = "true" ] || \
   [ "$TOTAL_LEN" -gt 2000 ]; then
  
  mkdir -p docs/ux/stories
  cat > "docs/ux/stories/${STORY_ID}.md" <<EOF
# $STORY_TITLE

## Narrative
**As a** $ROLE,
**I want** $CAPABILITY,
**So that** $OUTCOME.

## Personas
$(format_persona_list "$PERSONA_REFS")

## Acceptance criteria
$(format_criteria_for_markdown "$CRITERIA")

## Addresses pain
$(format_pain_refs_for_markdown "$PAIN_REFS")

## Extended notes
(Use this section for design considerations, edge cases,
technical constraints, or other context that doesn't fit in
the structured fields.)

## Status history
- $NOW: Created (status: $STATUS)
EOF

  # Update manifest with filePath
  jq --arg id "$STORY_ID" \
     --arg path "docs/ux/stories/${STORY_ID}.md" \
     '.stories |= map(
        if .id == $id then .filePath = $path else . end
      )' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
fi
```

## Phase 9: result

```
=== Story Created ===

ID:           story-export-compliance-pdf
Title:        Export compliance report as PDF
Status:       ready
Size:         M
Personas:     persona-school-admin
Addresses:    pain-cant-export-compliance-report
              (status updated: unaddressed → in-progress)
Manifest:     product/.pencil-ux.json

Next steps:
  - Refine acceptance criteria:
    /product:ux:stories:acceptance-criteria story-export-compliance-pdf
  - Create Jira ticket from story (when integrations:jira configured):
    /integrations:jira create-from-story story-export-compliance-pdf
  - Add to a story map:
    /product:ux:story-maps:build (or :update for existing map)
  - List all stories: /product:ux:stories:list
```

## Update mode

When updating an existing story:

1. Read existing story
2. Walk through fields with current values pre-populated
3. User edits any fields they want to change
4. Update manifest entry; preserve `created`; update
   `lastUpdated`
5. If acceptance criteria changed significantly and status
   was 'in-progress' or 'done', flag the change for review
6. If `addressesPainRefs` changed, update pain-point
   `addressedBy` arrays accordingly

## Split mode caveats

When splitting a story, the suggestion: parent's status moves
to "abandoned" with notes explaining the split. Child stories
each have `parentRef: "<parent-id>"`. The parent's
`childRefs` accumulates the child IDs.

If you split AND ALSO implement the parent directly, you
likely shouldn't have split. Choose: split-and-implement-
children, OR keep-as-single-story.

## What this command does NOT do

- **Replace ticket trackers.** Stories live in UX manifest;
  Jira/GitHub/Linear tickets live in their tools. Cross-
  reference via `ticketRef` field; integration commands
  create tickets from stories.
- **Validate acceptance criteria quality.** A bad criterion
  ("Then it works") is recorded as written.
- **Prevent story sprawl.** A team can write hundreds of
  stories; only manual review catches the "we have too
  many" problem.
- **Auto-prioritize.** Stories carry size; prioritization
  happens at story-map slicing or in your ticket tracker.

## Examples

```bash
# Create a new story
/product:ux:stories:write "Export compliance report as PDF"

# Address a specific pain point
/product:ux:stories:write "Vendor evaluation accelerator" \
  --addresses pain-vendor-evaluation-takes-weeks

# Split an existing story
/product:ux:stories:write "Filter candidates by certification" \
  --split-from story-filter-candidates

# Update existing
/product:ux:stories:write story-export-compliance-pdf --update
```

---
description: Add or refine acceptance criteria for an existing story. Walks through Given/When/Then structure for each criterion. Useful when stories are written quickly with minimal criteria and need refinement before being marked 'ready'. Updates the story's acceptanceCriteria array in product/.pencil-ux.json.
argument-hint: <story-id> [--add | --replace | --remove <criterion-index>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/stories/_context.md`.

Add, refine, or remove acceptance criteria for an existing
user story. Acceptance criteria define when the story is
"done" — Given/When/Then structure makes them testable.

This command is the dedicated way to refine criteria after
initial story creation. The `write` command supports
acceptance criteria during creation; this command focuses on
the iteration that often happens between draft and ready
status.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Verify story exists:

   ```bash
   STORY_ID="$1"
   
   STORY=$(jq -r ".stories[] | select(.id == \"$STORY_ID\")" \
                 product/.pencil-ux.json 2>/dev/null)
   
   if [ -z "$STORY" ]; then
     echo "Story '$STORY_ID' not found."
     echo ""
     echo "Available stories:"
     jq -r '.stories[] | "  \(.id): \(.title)"' product/.pencil-ux.json
     exit 1
   fi
   ```

3. Parse mode:

   ```bash
   MODE="default"   # walk-through; user can add/edit/remove
   if [ "$2" = "--add" ]; then MODE="add"; fi
   if [ "$2" = "--replace" ]; then MODE="replace"; fi
   if [ "$2" = "--remove" ]; then MODE="remove"; REMOVE_INDEX="$3"; fi
   ```

## Phase 1: surface current state

```
=== Acceptance Criteria: story-export-compliance-pdf ===

Title: Export compliance report as PDF
Status: draft
Personas: persona-school-admin

Narrative:
  As a school admin,
  I want to export my compliance summary as a PDF,
  So that I can submit it to district auditors.

Current acceptance criteria (2):

  [1] Given I have completed my compliance entries for the
      current quarter
      When I click 'Export to PDF' from the compliance dashboard
      Then a PDF file downloads

  [2] Given I have a draft entry pending
      When I click 'Export to PDF'
      Then I'm prompted with "Some entries are draft"

Options:
  [a] Add a new criterion
  [e] Edit a specific criterion (specify number)
  [r] Remove a criterion (specify number)
  [d] Done (save and exit)

Choice:
> 
```

## Phase 2: handle each operation

### Add operation

```
=== Add Acceptance Criterion ===

Criterion 3:

Given (precondition):
  Tip: The state of the system or user before the action.
  
> 

When (event or action):
  Tip: The triggering event — usually a user action.

> 

Then (observable outcome):
  Tip: What happens that confirms the story works.

> 

Add another criterion? [Y/n]
```

After each addition, return to the menu:

```
Acceptance criteria now: 3

  [1] [unchanged]
  [2] [unchanged]
  [3] [new]

Options:
  [a] Add another
  [e] Edit
  [r] Remove
  [d] Done
```

### Edit operation

```
=== Edit Criterion 2 ===

Current:
  Given I have a draft entry pending
  When I click 'Export to PDF'
  Then I'm prompted with "Some entries are draft"

This criterion is vague. The "Then" doesn't specify expected
behavior — what happens after the prompt?

Edit Given (current: "I have a draft entry pending"):
  Press enter to keep, or type replacement:
> I have at least one compliance entry in 'draft' status

Edit When (current: "I click 'Export to PDF'"):
  Press enter to keep, or type replacement:
> [enter to keep]

Edit Then (current: "I'm prompted with 'Some entries are draft'"):
  Press enter to keep, or type replacement:
> I see a confirmation dialog showing how many drafts exist,
  with options: 'Export anyway with drafts marked', 'Finalize
  drafts first', or 'Cancel'

Replaced.
```

### Remove operation

```
=== Remove Criterion 2 ===

Removing:
  Given I have a draft entry pending
  When I click 'Export to PDF'
  Then I'm prompted with "Some entries are draft"

Confirm removal? [y/N]
> y

Removed. Remaining criteria: 2 (renumbered).
```

## Phase 3: criteria quality nudges

When user marks done, the command surfaces basic quality
checks before saving:

```
=== Quality Check ===

Criteria count: 4 (good — recommended range is 2-5)

Quality observations:

  ✓ All criteria have Given/When/Then structure
  ✓ All Given clauses describe state
  ✓ All When clauses describe events/actions
  ⚠ Criterion 3's Then is "should be fast"
    Recommendation: replace with measurable outcome
    Example: "Then PDF generation completes in under 5 seconds"

  ✓ No criteria duplicate each other

Address the warning? [Y/save anyway]
> Y

[returns to edit menu for criterion 3]
```

The quality nudges are heuristic and easy to override. They're
suggestions, not blockers.

## Phase 4: status transition prompt

If the story's current status is "draft" and acceptance
criteria are now substantial (3+ criteria, all with concrete
"Then" clauses):

```
=== Status Transition ===

This story is currently 'draft'. With 4 acceptance criteria
defined, it could move to 'ready'.

Update status to 'ready'? [Y/n]
> Y

Status updated: draft → ready
```

If the story is already 'ready' and criteria changed, surface
a prompt:

```
=== Status Check ===

This story is 'ready'. You modified acceptance criteria.

Should this trigger re-review by the team? Modified criteria
on a ready story can change implementation expectations.

  [Y] Yes, mark for re-review (status: ready, with note)
  [n] No, criteria refinement is minor
  
Choice:
> Y

Note added to story: "Acceptance criteria modified on
2026-05-18; flagged for re-review."
```

If the story is 'in-progress', this is significant:

```
=== Warning: Story in-progress ===

This story is 'in-progress' — implementation has started.
Modifying acceptance criteria mid-implementation is risky:

  - Adds scope to in-flight work
  - May invalidate completed sub-tasks
  - Should be coordinated with the implementing team

Continue with the modification? [y/N]
> y

[Recommendation: After saving, communicate the change to
the implementing team. Consider whether the modification
should instead become a follow-up story.]
```

## Phase 5: write to manifest

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Update the story's acceptanceCriteria array
jq --arg id "$STORY_ID" \
   --argjson criteria "$NEW_CRITERIA_JSON" \
   --arg now "$NOW" \
   --arg new_status "$NEW_STATUS" \
  '.stories |= map(
     if .id == $id then
       .acceptanceCriteria = $criteria |
       .lastUpdated = $now |
       (if $new_status != "" then .status = $new_status else . end)
     else . end
   )
   | .lastUpdated = $now' \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json
```

If a markdown file exists for this story, sync the criteria:

```bash
MD_FILE=$(jq -r ".stories[] | select(.id == \"$STORY_ID\") | .filePath // empty" \
                product/.pencil-ux.json)

if [ -n "$MD_FILE" ] && [ -f "$MD_FILE" ]; then
  # Update or replace the ## Acceptance criteria section
  update_criteria_section "$MD_FILE" "$NEW_CRITERIA_JSON"
fi
```

## Phase 6: result

```
=== Acceptance Criteria Updated ===

Story:        story-export-compliance-pdf
Title:        Export compliance report as PDF
Criteria:     4 (was 2; net +2)
Status:       draft → ready

Manifest:     product/.pencil-ux.json
Markdown:     docs/ux/stories/story-export-compliance-pdf.md (synced)

Next steps:
  - Create Jira ticket from this story (when integrations:jira configured):
    /integrations:jira create-from-story story-export-compliance-pdf
  - Start implementation: status will move to in-progress
    when work begins
  - Update story narrative if needed:
    /product:ux:stories:write story-export-compliance-pdf --update
```

## Sub-flag operation modes

### `--add` (skip menu, go straight to add)

```bash
/product:ux:stories:acceptance-criteria story-id --add
```

Skips the menu; immediately prompts for new criterion.
Returns to menu after addition.

### `--replace` (full replacement)

```bash
/product:ux:stories:acceptance-criteria story-id --replace
```

Discards all existing criteria and walks through creating
new ones from scratch. Useful when criteria fundamentally
need rework.

```
=== Replace All Acceptance Criteria ===

This will remove all 2 existing criteria and start fresh.

Confirm replacement? [y/N]
> y

[walks through new criteria from scratch]
```

### `--remove <index>` (targeted removal)

```bash
/product:ux:stories:acceptance-criteria story-id --remove 3
```

Removes criterion at index 3 directly without menu. Surfaces
confirmation prompt.

## Cross-namespace integration

When `/integrations:jira` (or similar) is configured, refining
acceptance criteria can sync to the linked ticket:

```
=== Sync to Linked Ticket ===

Story story-export-compliance-pdf is linked to Jira issue
SCOOL-1247.

Sync updated acceptance criteria to the Jira ticket
description? [Y/n]
> Y

Updating SCOOL-1247... done.
```

If no integration is configured, this prompt is skipped.

## What this command does NOT do

- **Validate criteria against an actual implementation.**
  The command structures criteria; whether the
  implementation passes them is verified through testing,
  not this command.
- **Auto-generate test code.** Future commands could
  scaffold test code from Given/When/Then; not in scope here.
- **Replace user testing.** Acceptance criteria define
  expected behavior; user testing validates that meeting
  the criteria produces actual user satisfaction.
- **Convert criteria to BDD test code.** Several BDD
  frameworks (Cucumber, SpecFlow) consume Gherkin-style
  Given/When/Then; an export command could be added later.

## Examples

```bash
# Walk-through mode (menu-driven)
/product:ux:stories:acceptance-criteria story-export-compliance-pdf

# Add a single criterion
/product:ux:stories:acceptance-criteria story-export-compliance-pdf --add

# Replace all criteria
/product:ux:stories:acceptance-criteria story-export-compliance-pdf --replace

# Remove a specific criterion
/product:ux:stories:acceptance-criteria story-export-compliance-pdf --remove 2
```

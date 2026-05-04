# Stories — Sub-namespace Context (`product/ux/stories/`)

> Read this in addition to `product/ux/_context.md` and
> `product/_context.md` when working with user stories.

## What this sub-namespace contains

Three commands:

- **`/product:ux:stories:write`** — create a user story with
  persona refs, narrative (as a / I want / so that),
  optional acceptance criteria
- **`/product:ux:stories:list`** — inventory query
- **`/product:ux:stories:acceptance-criteria`** — add or
  refine acceptance criteria for an existing story

## What user stories are in this suite

A user story captures user need with structured framing:

- **Role**: which persona this serves
- **Capability**: what they want to do
- **Outcome**: why they want it (the "so that" anchor)

The classic format:

```
As a [role/persona],
I want [capability],
So that [outcome]
```

Or the alternative:

```
[Persona] needs [capability] in order to [outcome].
```

Both formats convey the same three elements. The schema's
`narrative` object stores them as separate fields
(`role`, `capability`, `outcome`).

User stories serve two purposes in this suite:

1. **Bridge UX to engineering** — stories anchor implementation
   work to user context. Without persona and outcome anchoring,
   "feature X" is just feature X; with anchoring, it's a
   purposeful response to user need.

2. **Sprint-sized scoping** — stories that fit in a sprint are
   the unit of delivery. Stories too big to fit get split
   (parent → children).

## Storage

### Manifest entry

Stories live in `product/.pencil-ux.json` under the `stories`
array:

```jsonc
{
  "stories": [
    {
      "id": "story-export-compliance-pdf",
      "title": "Export compliance report as PDF",
      "personaRefs": ["persona-school-admin"],
      "narrative": {
        "role": "school admin",
        "capability": "export my compliance summary as a PDF",
        "outcome": "I can submit it to district auditors"
      },
      "acceptanceCriteria": [
        {
          "given": "I have completed my compliance entries",
          "when": "I click 'Export to PDF' from the compliance dashboard",
          "then": "a properly-formatted PDF downloads with all entries from the current quarter"
        },
        ...
      ],
      "addressesPainRefs": ["pain-cant-export-compliance-report"],
      "ticketRef": "SCOOL-1247",
      "status": "ready",
      "size": "M",
      "created": "2026-05-10T14:30:00Z",
      "lastUpdated": "2026-05-10T14:30:00Z"
    }
  ]
}
```

### Markdown content (optional)

Most stories live entirely in the manifest — the narrative is
short, the acceptance criteria fit inline. Some stories have
substantial context (design notes, edge cases, technical
constraints) that benefit from a markdown file at
`docs/ux/stories/<story-id>.md`. The schema's `filePath`
field is optional.

Default behavior:
- Story with simple narrative + few acceptance criteria → no
  markdown file
- Story with extensive notes, design considerations, or
  multi-paragraph context → markdown file referenced via
  `filePath`

## Multi-persona stories

Some stories serve multiple personas — a "send notification"
story might serve both school admins (sending) and teachers
(receiving). The schema's `personaRefs: [...]` is an array.

Multi-persona stories are first-class. Don't force single-
persona attribution when reality is multi-persona.

That said: most stories DO serve a single primary persona.
Multi-persona is the exception, not the rule. If many stories
list 3+ personas, the personas may be too generic.

## Story splitting

Stories that don't fit in a sprint get split. The schema
captures parent/child relationships:

- `parentRef` — the story this was split from
- `childRefs` — stories this was split into

Conventions:

1. **The parent is preserved.** Don't delete the parent when
   children are created. The parent represents the original
   need; children represent decomposed delivery.

2. **The parent is typically not implemented directly.** When
   children exist, the parent's status is usually "abandoned"
   or stays at "draft" — implementation happens through
   children.

3. **Splitting strategies** (Patton, Cohn, et al.):
   - **By workflow step**: "Place an order" → "Add items to
     cart" + "Check out" + "Confirm order"
   - **By data variation**: "Filter candidates" → "Filter by
     certification" + "Filter by experience" + "Filter by
     location"
   - **By role**: "Manage account" → "School admin manages
     account" + "Teacher manages account"
   - **By happy path vs edge cases**: "Submit form" → "Submit
     valid form" + "Submit form with validation errors" +
     "Submit form when offline"

4. **Children should each be sprint-sized.** If a child is
   still too big, split again. Multi-level splitting is fine
   (story → 3 children → one of those 3 → 2 grandchildren).

## Acceptance criteria conventions

Acceptance criteria define when a story is "done." The Given/
When/Then structure is preferred:

- **Given** [precondition]
- **When** [event or action]
- **Then** [observable outcome]

Why Given/When/Then:

- **Testable**: each criterion maps to a test (manual or
  automated)
- **Unambiguous**: no "looks good" or "feels right" criteria
- **Conversation-friendly**: developers, designers, and PMs
  can discuss the criteria using shared structure

A story typically has 2-5 acceptance criteria. More than 5
suggests the story is too big and should be split.

Acceptance criteria can be added via:
- The `write` command (during initial story creation)
- The dedicated `acceptance-criteria` command (later refinement)

## Cross-references

Stories reference other UX artifacts:

- **Personas**: `personaRefs: [...]` — required (at least one)
- **Pain points**: `addressesPainRefs: [...]` — optional;
  link to pain points in the registry the story addresses

Stories are referenced by:

- **Story maps**: `slices[].storyRefs: [...]` — story maps
  arrange stories into release slices
- **Pain points**: `addressedBy: [...]` — pain-point registry
  links back to stories addressing each pain
- **External tracking**: `ticketRef` — Jira issue ID, GitHub
  issue URL, Linear ID; bidirectional linking out

## Cross-namespace integration

### `/core:integrations:jira` (when configured)

Stories often correspond to Jira tickets. The integration
flow:

1. User writes a story via `/product:ux:stories:write`
2. Story is registered in `product/.pencil-ux.json` with
   `ticketRef: ""` empty
3. User invokes `/core:integrations:jira create-from-story
   <story-id>`
4. Integration creates a Jira ticket with the story's
   narrative as description, acceptance criteria as ticket
   sub-fields
5. Integration updates the story's `ticketRef` to the new
   issue ID

The story remains the source of user-context; the Jira ticket
remains the source of delivery tracking. Both linked.

Same pattern applies to GitHub Issues, Linear, etc. — any
issue tracker integration can create from stories.

### `engineer:capability-introduction`

When introducing a new capability, the workflow can reference
stories that justify it:

```
Capability: Compliance report PDF export
Stories: story-export-compliance-pdf
Pain points: pain-cant-export-compliance-report
```

The story → capability link is informal (the capability
description references story IDs in prose); future enhancements
could add structured fields.

### `product/ux/story-maps/`

Story maps are 2D arrangements of stories. Each story map
references stories via `slices[].storyRefs`. Stories can
appear in multiple story maps (different release planning
contexts).

## Status lifecycle

Stories progress through statuses:

- **draft** — story being shaped; not yet ready for
  implementation
- **ready** — narrative complete, acceptance criteria
  defined, persona anchored, sized; ready for sprint
- **in-progress** — implementation has started
- **done** — delivered, accepted
- **abandoned** — won't implement (priorities changed,
  approach changed, replaced by other stories)

Status changes via:
- `/product:ux:stories:write --update`
- Future status-update command
- Automatic from `/core:integrations:jira` sync (when ticket
  status changes, story status follows)

## Anti-patterns

- **Stories without persona refs.** A story without persona
  is just a feature request. Without "as a [persona]," it's
  ungrounded.

- **Stories without "so that".** Without outcome, you have
  feature description, not user need. "I want a PDF export
  button" is feature; "I want to export PDFs so I can submit
  to auditors" is need.

- **Acceptance criteria that are vague.** "Should look good"
  or "should be fast" aren't testable. Use Given/When/Then
  with concrete observable outcomes.

- **Stories that span multiple personas without
  justification.** Multi-persona is fine when reality is
  multi-persona. Multi-persona because the writer couldn't
  decide is anti-pattern.

- **Stories that are technical tasks dressed up.** "As a
  developer, I want to upgrade Spring Boot to 3.3 so that we
  have current versions" isn't a user story; it's a technical
  task. Put technical work in `engineer:` namespace, not
  here.

- **Stories nobody references.** Stories that aren't in any
  story map, don't address any pain points, and aren't
  referenced by any capability are documentation debt.

- **Treating story acceptance as binary.** A story passing 4
  of 5 acceptance criteria isn't "almost done" — it's
  incomplete. Address the missing criterion or split the
  story.

- **Reopening done stories instead of writing new ones.**
  Done means done. New work goes in new stories that
  reference the old story (in notes) if context matters.

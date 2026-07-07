---
description: Iterate on a proposed ADR based on review feedback. Refines context, alternatives, decision, or consequences sections without changing the ADR's identity (number, slug, file name). Only works on ADRs in "proposed" status.
argument-hint: <ADR-NNN> [feedback-summary] [--section context|decision|alternatives|consequences|references|implementation]
allowed-tools: Read, Write, Edit, Bash
---

Iterate on a proposed ADR. The most common scenario: an ADR was
drafted via `/engineer:architecture:decisions:propose`, shared with the
team, feedback came in, and now the document needs updates
before acceptance.

This command works only on ADRs in **proposed** status. Once an
ADR is accepted, it's immutable — changes require
`/engineer:architecture:decisions:supersede` to create a replacement.

## Phase 0: discovery

1. Read `product/.pencil-decisions.json`. Locate the entry for
   the ADR-NNN in `$ARGUMENTS`.
2. Verify status is `proposed`. If accepted, superseded,
   deprecated, or rejected, abort with a clear message:

   > ADR-NNN is currently in `<status>` status. Refinement only
   > works on proposed ADRs. To change an accepted ADR, propose
   > a superseding ADR via /engineer:architecture:decisions:supersede.

3. Read the ADR file at the manifest's `filePath`.
4. Read `product/.pencil-architecture.json` for context.

## Phase 1: identify what's being refined

Three modes:

### Mode A: Section-targeted refinement (`--section`)

If `--section` is provided, focus the iteration on that section.
Sections: `context`, `decision`, `alternatives`, `consequences`,
`references`, `implementation`.

Prompt: "Here's the current `<section>` section. What needs to
change?"

Display the current section content. Capture the user's
feedback. Generate revised content. Show diff. Confirm before
writing.

### Mode B: Feedback-driven refinement (positional argument)

If a feedback summary is provided as the second argument (e.g.
`/engineer:architecture:decisions:refine ADR-007 "missing alternative: serverless lambda approach"`),
parse the feedback to identify which section it most affects.

In the example above, the feedback signals the Alternatives
Considered section needs a new entry. Prompt the user to confirm
the section, then generate the revised section.

### Mode C: Open iteration (no positional argument)

If no `--section` and no feedback summary, enter open iteration
mode. Display the ADR section by section, asking what changes
the user wants. Continue until they say "done" or no more
changes.

## Phase 2: change preview

Before any write, show a unified diff of the proposed changes:

```
ADR-007: Migrate from sync request-response to event-driven for user-events

--- Current (proposed)
+++ Proposed refinement

@@ Alternatives Considered @@

 ### Alternative 1: Stay synchronous, optimize hot paths

 Profile current sync calls and optimize the slow ones. ...

+### Alternative 2: Serverless lambda for user-events
+
+Decompose user-events into a serverless lambda invoked from the
+main service. ...
+
+Not chosen because: cold-start latency conflicts with the
+sub-100ms target for user-event acknowledgment, and the
+coupling to AWS-specific infrastructure adds vendor lock-in.

 ### Alternative 3: ...
```

Wait for confirmation: "Apply these changes? [y/N]"

## Phase 3: file update

Apply the refinement. Preserve:

- ADR ID and number
- File path and slug
- Status (stays `proposed`)
- Proposed date (stays the original date)
- Tags (unless explicitly changed)
- ID-numbered references and structure

Update:

- The targeted section content
- The "Last refined" timestamp in front-matter (added on first
  refinement; updated each time)

If the ADR file has the `--draft` WIP banner from
`/engineer:architecture:decisions:propose`, remove it on first
refinement. The draft status is for "haven't done full
alternatives yet"; once refinement happens, it's no longer
draft.

## Phase 4: manifest update

Update `product/.pencil-decisions.json`:

- Remove the `draft: true` flag if present
- Update `lastRefined` timestamp

The `proposedDate` does NOT change. That's the date the decision
entered the team's queue; it stays fixed.

## Phase 5: integrity check

After update, verify:

1. The ADR file still parses (correct headers, no broken
   structure)
2. References to other ADRs still resolve (if the user added
   `ADR-XXX` references, check they exist in the manifest)
3. No accidental introduction of "accepted" or "superseded"
   language in places that should still say "proposed"

If any check fails, surface the issue and ask whether to revert
or continue.

## Phase 6: report

```
Refined ADR-NNN: <title>
Status:          proposed (unchanged)
Section(s):      <which section(s) were modified>
File:            design/decisions/ADR-NNN-<slug>.md

Next steps:
  - Share refinements with stakeholders
  - Continue refining: /engineer:architecture:decisions:refine ADR-NNN [feedback]
  - When team is aligned: /engineer:architecture:decisions:accept ADR-NNN
```

## Multi-section refinement

Some feedback cuts across multiple sections (e.g., "this
alternative analysis missed a constraint we discovered" might
affect Context, Alternatives, AND Consequences). The command
handles this by:

1. Prompting after each section: "Other sections affected by
   this feedback?"
2. Iterating through affected sections one at a time
3. Showing a final consolidated diff before writing

## What this command does NOT do

- **Modify accepted ADRs.** That's the immutability rule. Use
  `supersede` instead.
- **Auto-incorporate feedback.** The user supplies the substance
  of the refinement; the command structures the editing.
- **Track refinement history within the ADR document.** Git
  history is the audit trail for refinements; the ADR document
  itself shows only the latest state (with proposal date and
  optional last-refined timestamp).
- **Renumber or rename.** ID and slug are locked at proposal.

## Composition

Typical refinement loop:

```bash
/engineer:architecture:decisions:propose "..." --tags ...        # creates ADR-007
# Share with team, get feedback
/engineer:architecture:decisions:refine ADR-007 "missed serverless alternative"
/engineer:architecture:decisions:refine ADR-007 "consequences should mention AWS lock-in"
# Team aligned
/engineer:architecture:decisions:accept ADR-007
```

## Examples

```bash
# Open iteration mode — walk through sections asking what to change
/engineer:architecture:decisions:refine ADR-007

# Section-targeted — focus on alternatives
/engineer:architecture:decisions:refine ADR-007 --section alternatives

# Feedback-driven — provide the change as an argument
/engineer:architecture:decisions:refine ADR-007 "consequences should mention AWS vendor lock-in"
```

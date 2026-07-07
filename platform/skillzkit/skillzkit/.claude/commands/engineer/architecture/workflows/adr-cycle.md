---
outcome: Run an ADR proposal cycle
description: Architecture Decision Record (ADR) lifecycle workflow. Orchestrates proposal → stakeholder review → refinement → acceptance with explicit checkpoints. Composes /engineer:architecture:decisions:propose, refine, and accept commands across multi-day or multi-week timelines. Tracks state in .pencil-architecture.json so the workflow can be resumed across sessions.
argument-hint: [<topic-or-decision-id>] [--phase <name>] [--abort]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `workflows/_context.md` (workflow state machine
> conventions), `engineer/architecture/workflows/_context.md`
> (architecture workflow conventions), `engineer/architecture/_context.md`
> (architecture domain), `engineer/architecture/decisions/_context.md`
> (ADR conventions).

ADR lifecycle workflow. Walks an architecture decision through
proposal, stakeholder review, refinement based on feedback, and
formal acceptance. Designed for multi-session execution — the
workflow's state persists across days or weeks because architecture
decisions don't conclude in one sitting.

**Invoke with:** `/core:workflows:manage start engineer:adr-cycle`

## State machine overview

```
[idle]
  ↓ user starts workflow with topic
[gathering-context] — collect inputs, related ADRs, constraints
  ↓ user signals "ready to propose"
[proposing] — invokes /engineer:architecture:decisions:propose
  ↓ proposal artifact created
[stakeholder-review] — surface to reviewers; capture feedback
  ↓ user signals "feedback collected" OR explicit acceptance
[refining] — invokes /engineer:architecture:decisions:refine
              with each feedback item
  ↓ user signals "refinement complete"
[awaiting-acceptance] — final review checkpoint
  ↓ user accepts (or rejects → return to refining)
[accepting] — invokes /engineer:architecture:decisions:accept
  ↓ ADR marked accepted
[completed]
```

State persists in `product/.pencil-architecture.json` under
`activeWorkflows.adrCycle`:

```jsonc
{
  "activeWorkflows": {
    "adrCycle": {
      "id": "adr-2026-014-langgraph-vs-embabel",
      "topic": "Choosing between LangGraph and Embabel for orchestration",
      "phase": "stakeholder-review",
      "started": "2026-04-29T10:00:00Z",
      "lastActivity": "2026-05-03T14:23:00Z",
      "checkpoints": {
        "context-gathered": "2026-04-29T11:30:00Z",
        "proposed": "2026-04-30T09:15:00Z",
        "stakeholder-review-started": "2026-04-30T09:30:00Z"
      },
      "stakeholders": ["staff-engineer-1", "tech-lead-2", "platform-owner"],
      "feedback": [
        {
          "from": "staff-engineer-1",
          "received": "2026-05-01T15:00:00Z",
          "summary": "Concern about LangGraph state-store overhead",
          "addressed": false
        }
      ]
    }
  }
}
```

The workflow's resume behavior reads this state when re-invoked.

## Phase 0: detect existing or start new

```bash
EXISTING=$(jq -r '.activeWorkflows.adrCycle.id // empty' \
                 product/.pencil-architecture.json 2>/dev/null)

if [ -n "$EXISTING" ]; then
  CURRENT_PHASE=$(jq -r '.activeWorkflows.adrCycle.phase' \
                       product/.pencil-architecture.json)
  
  echo "ADR cycle workflow in progress:"
  echo "  ADR:    $EXISTING"
  echo "  Phase:  $CURRENT_PHASE"
  echo ""
  echo "Options:"
  echo "  [c] Continue from current phase"
  echo "  [s] Show current state in detail"
  echo "  [r] Resume at specific phase (--phase <name>)"
  echo "  [a] Abort current and start new"
  
  read -p "Choice: " CHOICE
  
  case "$CHOICE" in
    c) resume_from "$CURRENT_PHASE" ;;
    s) show_state ;;
    r) resume_from "$REQUESTED_PHASE" ;;
    a) abort_existing && start_new ;;
  esac
else
  start_new
fi
```

## Phase 1: gathering-context

The first phase before invoking proposal. The workflow gathers:

```
=== ADR Cycle: Gathering Context ===

Topic: <user's topic>

Step 1 of 4: Identify the decision

What architectural decision is being made?
  Examples:
    - "Choose orchestration framework for AgentX agents"
    - "Decide whether to use ECS Fargate or EKS"
    - "Define multi-tenant data isolation strategy"

>

Step 2 of 4: Identify constraints

What constraints affect this decision? (compliance, cost,
team skill, existing systems, deadlines)

>

Step 3 of 4: Identify related ADRs

Searching for related ADRs in <adr-directory>...
  Found:
    - ADR-2026-008: Embabel STRIPS planner adoption
    - ADR-2026-011: Spring Modulith for module boundaries
  
  These will be referenced in the proposal.
  Add others? [comma-separated IDs]
> 

Step 4 of 4: Identify stakeholders

Who needs to review and approve this decision?
  (typically: staff/principal engineers, tech leads,
  platform owners; sometimes: security, compliance,
  product)

>

Context gathered. Moving to proposal phase.
```

State updated: `phase: "proposing"`,
`checkpoints.context-gathered: <now>`.

## Phase 2: proposing

Invokes the existing `propose` command:

```bash
/engineer:architecture:decisions:propose <topic-from-context>
```

The propose command produces an ADR draft. The workflow:

1. Captures the produced ADR ID and file path
2. Updates state with the ADR reference
3. Surfaces next steps to the user

```
=== ADR Cycle: Proposal Created ===

ADR file:  docs/adr/ADR-2026-014-langgraph-vs-embabel.md
ADR ID:    ADR-2026-014
Title:     Choose between LangGraph and Embabel for orchestration

Next phase: stakeholder review

The workflow will track stakeholder feedback. To collect:
  1. Share ADR with stakeholders (link, email, Slack)
  2. Collect feedback in any form (comments, tickets, conversations)
  3. Return here and run:
     /core:workflows:manage continue engineer:adr-cycle
     OR
     /core:workflows:manage record-feedback engineer:adr-cycle
```

State updated: `phase: "stakeholder-review"`,
`checkpoints.proposed: <now>`.

## Phase 3: stakeholder-review

The longest-duration phase. Multi-day or multi-week. The
workflow tracks who's reviewing and what feedback comes back.

```
=== ADR Cycle: Stakeholder Review ===

ADR:           ADR-2026-014
Stakeholders:  staff-engineer-1, tech-lead-2, platform-owner

Status:
  staff-engineer-1:    Reviewed, provided feedback (1 item)
  tech-lead-2:         Pending review (sent 2 days ago)
  platform-owner:      Pending review (sent 2 days ago)

Outstanding feedback (1):
  From: staff-engineer-1 (2026-05-01)
  "Concern about LangGraph state-store overhead at scale.
   Have we benchmarked memory pressure with 100+ concurrent
   workflows?"
  Addressed: no

Options:
  [r] Record new feedback from a stakeholder
  [a] Mark all stakeholders as approved (skip refinement)
  [n] Move to refinement phase to address feedback
  [s] Show full feedback log
```

The "record feedback" sub-command:

```
=== Record Feedback ===

From which stakeholder?
> tech-lead-2

What's the feedback?
> "Suggest also evaluating LangGraph.js (vs Python) given
>  our TypeScript-heavy stack. Worth a comparison row in
>  the proposal."

Severity:
  [1] Concern (blocks acceptance until addressed)
  [2] Suggestion (worth incorporating)
  [3] Note (informational; doesn't block)

> 2

Recorded. Tech-lead-2 → "Suggest also evaluating LangGraph.js"
```

State updated with feedback entries. When user signals
"feedback collected, ready to refine," workflow moves to
refining phase.

## Phase 4: refining

Iterates through unaddressed feedback items, invoking the
`refine` command per item:

```
=== ADR Cycle: Refining ===

ADR: ADR-2026-014
Outstanding feedback: 2 items

Item 1 of 2:
  From: staff-engineer-1
  Concern: "Memory pressure with 100+ concurrent workflows?"
  
  Plan: Add benchmarking section to ADR; surface as
        risk if not feasible to benchmark before decision
  
  Invoking: /engineer:architecture:decisions:refine
            ADR-2026-014 --concern memory-pressure-benchmarking

[refine command runs and updates the ADR]

Item 1 addressed. Marked as resolved.

Item 2 of 2:
  From: tech-lead-2
  Suggestion: "Evaluate LangGraph.js (TypeScript) too"
  ...
```

After all items addressed, prompt user to confirm refinement
complete:

```
=== Refinement Complete ===

All 2 feedback items addressed.
The ADR has been updated. Re-share with stakeholders for
final acceptance? [Y/n]

If yes: phase moves to awaiting-acceptance
If no:  remain in refining (more feedback expected)
```

State updated: `phase: "awaiting-acceptance"`,
`checkpoints.refined: <now>`.

## Phase 5: awaiting-acceptance

Final checkpoint before formal acceptance:

```
=== ADR Cycle: Awaiting Acceptance ===

ADR:        ADR-2026-014
Status:     All feedback addressed; ready for acceptance

Stakeholders confirmed:
  staff-engineer-1:  ✓ Concern addressed
  tech-lead-2:       ✓ Suggestion incorporated
  platform-owner:    ⏸ Final ack pending

When all stakeholders have given final acceptance, run:
  /core:workflows:manage accept engineer:adr-cycle

If new concerns surface, return to refining:
  /core:workflows:manage refine engineer:adr-cycle
```

## Phase 6: accepting

Invokes the `accept` command:

```bash
/engineer:architecture:decisions:accept ADR-2026-014
```

The accept command:
- Updates ADR status to "Accepted"
- Sets accepted date
- Records accepters
- Cross-references in any superseded ADRs (if applicable)

```
=== ADR Cycle: Accepted ===

ADR:           ADR-2026-014
Status:        Accepted
Accepted on:   2026-05-15
Accepted by:   staff-engineer-1, tech-lead-2, platform-owner

Cycle complete.
Workflow state archived to:
  product/.pencil-architecture.json (history.adrCycle)
```

State updated: `phase: "completed"`. After completion, the
workflow moves from `activeWorkflows` to `history` for
record-keeping.

## Resume / abort behavior

### Resume

When user re-invokes `/core:workflows:manage start engineer:adr-cycle`
and an existing workflow is detected, the conversation surfaces
current phase and offers continue/restart options.

The workflow can be resumed at any phase via `--phase <name>`:

```bash
/core:workflows:manage start engineer:adr-cycle --phase refining
```

Useful when stakeholder feedback came in via a channel the
workflow didn't capture and the user wants to re-enter the
refining phase.

### Abort

Aborting cleans up state without finalizing the ADR:

```bash
/core:workflows:manage abort engineer:adr-cycle
```

Surfaces:

```
=== Abort ADR Cycle ===

ADR:    ADR-2026-014
Phase:  stakeholder-review
Started: 2026-04-29

Aborting will:
  - Remove workflow state from activeWorkflows
  - Leave the ADR file in its current state (status:
    "Proposed" or "Refined" — not Accepted)
  - Move workflow to history with status: aborted

The ADR file remains. To formally reject the proposal, mark
it as superseded by another ADR or update status to
"Rejected" manually.

Confirm abort? [y/N]
```

## Composition with other workflows

The ADR cycle can be invoked from within larger workflows:

- **`engineer:capability-introduction`** invokes
  `engineer:adr-cycle` as its decision-recording phase
- **`engineer:architecture-review-annual`** invokes
  `engineer:adr-cycle` for any newly-identified decision
  needs surfaced during annual review

Cross-workflow invocation respects state isolation — the
inner ADR cycle has its own state under
`activeWorkflows.adrCycle`; the outer workflow has its own
key.

## What this workflow does NOT do

- **Replace stakeholder discussion.** The workflow tracks
  what's happening; humans still discuss.
- **Auto-accept without explicit user signal.** Acceptance
  always requires explicit user confirmation.
- **Manage stakeholder communications.** Sharing ADRs
  with reviewers, sending notifications — those are
  user/integration responsibilities. The workflow tracks
  state; integrations may handle communication.
- **Validate decision quality.** Surfaces feedback and
  refinement; doesn't critique the decision itself.

## Examples

```bash
# Start new cycle
/core:workflows:manage start engineer:adr-cycle "Choose orchestration framework"

# Resume in-progress
/core:workflows:manage continue engineer:adr-cycle

# Record feedback
/core:workflows:manage record-feedback engineer:adr-cycle

# Skip to acceptance (when stakeholders approved offline)
/core:workflows:manage accept engineer:adr-cycle

# Abort
/core:workflows:manage abort engineer:adr-cycle
```

---
description: Create a new ADR that supersedes an existing accepted ADR. The new ADR is proposed, ready for refinement and acceptance; the old ADR's status changes to superseded only after the new one is accepted. Preserves the historical record (old ADR content stays immutable).
argument-hint: <ADR-NNN-being-superseded> <new-decision-summary> [--tags tag1,tag2] [--immediately]
allowed-tools: Read, Write, Edit, Bash
---

Create a new ADR that supersedes an existing accepted ADR. This
is the ONLY way to change a decision once it's been accepted —
the immutability rule means the old ADR's content stays intact;
its status transitions to `superseded` and the new ADR becomes
the authoritative one.

The default flow is two-phase: this command creates the
superseding ADR in `proposed` status; the team reviews and
refines; then `/engineer:architecture:decisions:accept` on the new ADR
finalizes the supersession (auto-updating the old ADR's status).

For urgent supersessions (e.g., critical security pivot), the
`--immediately` flag accepts the new ADR and supersedes the old
in one step. Use sparingly.

## Phase 0: discovery

1. Read `product/.pencil-decisions.json`. Locate the entry for
   the ADR-NNN being superseded.
2. Verify the old ADR's status is `accepted`. If any other
   status:

   - **proposed**: "ADR-NNN is in proposed status. To replace a
     proposed ADR, edit it via `/engineer:architecture:decisions:refine`
     instead. Supersession only applies to accepted decisions."
   - **superseded**: "ADR-NNN is already superseded by ADR-MMM.
     The active decision is ADR-MMM. To supersede that, run
     `/engineer:architecture:decisions:supersede ADR-MMM ...`."
   - **deprecated**: "ADR-NNN is deprecated. To make a new
     decision in this area, propose a fresh ADR via
     `/engineer:architecture:decisions:propose` rather than supersession."
   - **rejected**: "ADR-NNN was rejected, not accepted. There's
     nothing to supersede."

3. Read the old ADR's file content.
4. Read `product/.pencil-architecture.json`.

## Phase 1: ID assignment for new ADR

Same logic as `/engineer:architecture:decisions:propose`: find highest
existing ADR number, increment, zero-pad. Generate slug from
the new decision summary in `$ARGUMENTS[1]`.

## Phase 2: structured prompting (with old ADR as reference)

Like `propose`, prompt the user through each section. The
critical addition for supersession: the old ADR's content is
front and center as reference.

### Context section (specialized prompt)

> ADR-NNN's context was:
>
> "<old context>"
>
> Its decision was:
>
> "<old decision>"
>
> What's changed? Why is the old decision no longer right? Is
> it new information, changed constraints, lessons learned from
> implementation, or external pressure (compliance, business)?
>
> The new ADR's context should explain not just the current
> situation, but the reason for revisiting the old decision.

### Decision section

> State the new decision in active voice. Be specific about
> how it differs from ADR-NNN's decision (the differences will
> be visible to future readers comparing the two).

### Alternatives Considered section

> Alternatives must include:
>
> 1. **Stay with ADR-NNN's decision** — explain why this is no
>    longer the right choice
> 2. **At least one other alternative** — what else was
>    considered besides the new direction
>
> If the only alternative is "stay with the old decision",
> consider whether this should really be a refinement instead
> of supersession. Refinement means the original decision was
> right but executed wrong. Supersession means the original
> decision is no longer right.

### Consequences section

> Same three buckets (positive / negative / neutral). For
> superseding ADRs, also explicitly call out:
>
> - **Migration cost** — what work is required to transition
>   from the old decision's implementation to the new
> - **Backward compatibility** — what stays compatible, what
>   breaks
> - **Rollback risk** — if this turns out to be wrong, how hard
>   is it to revert (a high rollback cost is itself a
>   consequence worth surfacing)

### References section

The new ADR's references must include:

```markdown
## References

- ADR-NNN: <title> — superseded by this ADR
- <other relevant references>
```

The bidirectional reference is essential — the new ADR points to
the old; later, when this command's Phase 5 runs, the old ADR
will point to the new.

## Phase 3: file generation for new ADR

Generate the new ADR file at `design/decisions/ADR-MMM-<new-slug>.md`
with status `proposed` (or `accepted` if `--immediately`).

The new ADR's manifest entry:

```jsonc
{
  "id": "ADR-MMM",
  "title": "<new title>",
  "status": "proposed",
  "proposedDate": "YYYY-MM-DD",
  "acceptedDate": null,
  "supersededBy": null,
  "supersedes": "ADR-NNN",         // <-- the supersession link
  "tags": [...],
  "filePath": "design/decisions/ADR-MMM-<new-slug>.md"
}
```

## Phase 4: report (default flow — without --immediately)

```
Created superseding ADR-MMM: <new title>
Supersedes:      ADR-NNN: <old title>
Status:          proposed
File:            design/decisions/ADR-MMM-<new-slug>.md

ADR-NNN status is currently UNCHANGED (still accepted) until
ADR-MMM is accepted via /engineer:architecture:decisions:accept.

Next steps:
  1. Share ADR-MMM with stakeholders for review
  2. Refine via /engineer:architecture:decisions:refine ADR-MMM <feedback>
  3. When team is aligned, accept via:
     /engineer:architecture:decisions:accept ADR-MMM
     (this will auto-update ADR-NNN to superseded status)
```

The two-phase flow protects against premature supersession —
the team gets to review the new direction before the old
decision is invalidated.

## Phase 5: --immediately flag (urgent path)

If `--immediately` was provided, after creating the new ADR in
Phase 3, immediately run the equivalent of
`/engineer:architecture:decisions:accept ADR-MMM`. This:

1. Marks ADR-MMM as accepted (status: accepted, acceptedDate:
   today)
2. Updates ADR-MMM's content to lock it (immutability rule
   applies from this point)
3. Updates ADR-NNN's status to `superseded`, with
   `supersededBy: "ADR-MMM"` and `supersededDate: today`
4. Updates ADR-NNN's file:
   - Status block: `accepted` → `superseded by ADR-MMM`
   - Add `Superseded: YYYY-MM-DD` to date block
5. If the new ADR materially affects
   `.pencil-architecture.json`, prompts for the manifest update
   (same logic as `accept`)

Confirmation prompt before applying:

```
URGENT supersession requested via --immediately flag.

This will:
  - Create ADR-MMM in accepted status (skipping team review)
  - Mark ADR-NNN as superseded
  - Update architectural identity manifest if affected

Use --immediately for genuine emergencies (security pivots,
compliance pressure, broken-prod situations). For everything
else, the two-phase flow (propose → review → accept) is
strongly preferred.

Confirm urgent supersession? [y/N]
```

## Phase 6: deferred supersession trigger (default flow)

When the new ADR is later accepted via
`/engineer:architecture:decisions:accept`, the `accept` command detects
that the new ADR has `supersedes: "ADR-NNN"` in its manifest
entry and automatically:

1. Updates ADR-NNN's manifest status to `superseded`
2. Sets `supersededBy: "ADR-MMM"` and `supersededDate: today`
3. Updates ADR-NNN's file status block
4. Updates the architectural identity manifest if needed

This means: the supersession is "armed" by this `supersede`
command but only "fired" when the superseding ADR is accepted.

## Cross-namespace effects

Once supersession is complete (via either path):

- **Maintenance routines** stop honoring the old ADR's
  constraints. Example: if ADR-005 pinned Spring Boot 3.x and
  ADR-012 supersedes it allowing Spring Boot 4.x, gradle/maven
  upgrade routines can now consider Spring Boot 4 candidates.
- **Audit Plane 12b** drift detection switches to comparing
  implementation against the new ADR.
- **Architecture review workflow** treats the new ADR as
  authoritative.

## What this command does NOT do

- **Auto-supersede on conflict.** If you propose a decision
  that contradicts an accepted ADR but don't use this
  supersede command, the contradiction stays. Audit Plane 12
  may surface it; it's the team's job to resolve via explicit
  supersession.
- **Cascading supersession.** If ADR-MMM supersedes ADR-NNN,
  and ADR-NNN itself superseded ADR-XXX, ADR-XXX's status does
  NOT auto-update. Each supersession is explicit and
  one-link-deep.
- **Delete or archive the old ADR.** The historical record is
  preserved. Old ADRs remain queryable, readable, and
  referenceable.
- **Modify the old ADR's content.** Status changes only. The
  old ADR's Context, Decision, Alternatives, and Consequences
  sections stay immutable.

## Examples

```bash
# Standard supersession (two-phase: propose then accept)
/engineer:architecture:decisions:supersede ADR-005 "Allow Spring Boot 4.x after Jakarta migration completes" --tags backend,framework

# Urgent supersession (one-step, requires confirmation)
/engineer:architecture:decisions:supersede ADR-008 "Disable third-party auth provider X due to compliance issue" --immediately --tags auth,compliance,security
```

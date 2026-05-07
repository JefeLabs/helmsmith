---
description: Mark a proposed ADR as accepted. Locks the decision content (immutability rule applies after acceptance), updates the manifest, and triggers a check on whether the architectural identity manifest needs updating. This is a one-way door — once accepted, content can only change via supersession.
argument-hint: <ADR-NNN> [--update-architecture-manifest]
allowed-tools: Read, Write, Edit, Bash
---

Mark a proposed ADR as accepted. After this command runs:

- The ADR's content is **immutable** (further edits require
  superseding ADR via `/engineer:architecture:decisions:supersede`)
- The architectural identity manifest may need updating if the
  decision affects it
- The decision is binding for the team

This is a one-way door. The command requires explicit
confirmation before proceeding.

## Phase 0: discovery

1. Read `product/.pencil-decisions.json`. Locate the entry for
   ADR-NNN.
2. Verify status is `proposed`. If any other status, abort:

   - **accepted**: "ADR-NNN is already accepted. To make changes,
     supersede it via `/engineer:architecture:decisions:supersede`."
   - **superseded** or **deprecated**: "ADR-NNN is in `<status>`
     status. It cannot be re-accepted. Its successor (ADR-MMM)
     is the active decision."
   - **rejected**: "ADR-NNN was rejected. To revisit, propose a
     new ADR with the lessons learned in the Context section."

3. Read the ADR file at `filePath`.
4. Read `product/.pencil-architecture.json` for context.

## Phase 1: pre-acceptance checks

Run sanity checks before allowing acceptance:

### Check 1: Required sections present and non-trivial

The ADR must have meaningful content in:

- **Context** — at least 100 characters, not just placeholder
- **Decision** — clear statement, not a TODO
- **Alternatives Considered** — at least one substantive
  alternative (not just "Do nothing" with no analysis)
- **Consequences** — at least one positive AND one negative or
  neutral consequence

If any check fails, surface to user:

> ADR-NNN is missing substantive content in `<section>`. The
> immutability rule means accepted ADRs can't easily be
> improved later. Strongly recommend filling this in before
> acceptance. Continue anyway? [y/N]

Default response is to abort and prompt the user to refine.

### Check 2: References resolve

Any `ADR-XXX` references in the ADR content must exist in the
manifest. If a reference points to a non-existent ADR, surface
and ask user to fix or confirm the reference is intentional
(e.g., placeholder for a future ADR being proposed concurrently).

### Check 3: Tag overlap with existing accepted ADRs

If the proposed ADR's tags overlap significantly with an
existing accepted ADR, surface the overlap:

> ADR-NNN tags `[multi-tenancy, data]` overlap with accepted
> ADR-001 (`[multi-tenancy, data, compliance]`). Has the team
> reviewed for potential supersession? If ADR-NNN supersedes
> or contradicts ADR-001, abort acceptance and use
> `/engineer:architecture:decisions:supersede` instead.

## Phase 2: architectural identity impact analysis

Compare the ADR's decision against `.pencil-architecture.json`:

- Does the ADR introduce a new integration pattern? Check
  `integrationPatterns`.
- Does it change multi-tenancy strategy? Check `multiTenancy`.
- Does it change primary tech stack? Check `techStack`.
- Does it set or revise fitness targets? Check `fitnessTargets`.

If material impact is detected, surface the proposed manifest
delta:

```
ADR-NNN affects the architectural identity manifest:

Current:
  integrationPatterns.byContext.user-events: "sync-request-response"

Proposed (per ADR-NNN):
  integrationPatterns.byContext.user-events: "async-messaging"

Update the manifest as part of this acceptance? [Y/n]
```

If `--update-architecture-manifest` flag was provided, default
is yes (with confirmation still required for safety). Without
the flag, the user explicitly chooses each delta.

## Phase 3: confirmation

Show the full ADR content one more time, then:

```
About to accept ADR-NNN: <title>

This action:
  - Marks the ADR as accepted (status transition)
  - Sets acceptance date to today (YYYY-MM-DD)
  - Makes the ADR content IMMUTABLE
    (changes require a superseding ADR)
  - Updates product/.pencil-decisions.json
  - <if architecture manifest delta confirmed>
    Updates product/.pencil-architecture.json with
    <N> changes

Acceptance is a one-way door. Confirm? [y/N]
```

Require an unambiguous "yes" / "y". Anything else aborts.

## Phase 4: ADR file update

Update the ADR file:

- Status block: change `proposed` to `accepted`
- Date block: add `Accepted: YYYY-MM-DD`
- If a `--draft` WIP banner is somehow still present (shouldn't
  be after refine, but check), remove it
- No content changes to the body sections (immutability
  enforcement starts now)

## Phase 5: manifest update

Update `product/.pencil-decisions.json`:

- `status`: "proposed" → "accepted"
- `acceptedDate`: today's ISO date
- `lastRefined`: removed (no longer relevant)
- `draft`: removed if present

Re-sort the entries if needed (numerical order maintained).

## Phase 6: architectural identity update (conditional)

If the user confirmed manifest delta in Phase 2, apply changes
to `product/.pencil-architecture.json`:

- Update affected fields
- Bump `lastUpdated` to today's ISO datetime
- Add a note to a `decisionLog` array (if present) referencing
  the accepting ADR:

  ```jsonc
  "decisionLog": [
    {
      "date": "YYYY-MM-DD",
      "adr": "ADR-NNN",
      "summary": "<short description of architectural change>"
    }
  ]
  ```

If `decisionLog` doesn't exist in the manifest, create it.

## Phase 7: verify integrity

Post-write checks:

1. ADR file still parses correctly
2. Manifest is valid JSON
3. ADR's filePath in manifest matches actual file location
4. If architecture manifest was updated, it's still valid

If any check fails, surface immediately. Don't auto-rollback;
ask the user.

## Phase 8: report

```
Accepted ADR-NNN: <title>
Status:          proposed → accepted
Date:            YYYY-MM-DD
File:            design/decisions/ADR-NNN-<slug>.md

Architectural identity manifest:
  <if updated> Updated 2 fields:
    - integrationPatterns.byContext.user-events
    - decisionLog[+]
  <if unchanged> No changes (decision didn't affect identity)

This decision is now immutable. Future changes require
superseding ADR via /engineer:architecture:decisions:supersede.

Reminder for downstream work:
  - Implementation work begins (or continues) per the decision
  - Reference ADR-NNN in code comments where the decision shows up
  - /audit Plane 12b will detect drift if implementation
    diverges from this ADR
```

## Cross-routine effects

Acceptance of an ADR may have follow-on effects:

- **Maintenance routines** read accepted ADRs to respect pinning
  decisions. E.g., if ADR-005 says "Spring Boot 3.x because of
  Jakarta migration", `/engineer:maintenance:upgrades:gradle-deps` won't
  cross to Spring Boot 4 until ADR-005 is superseded.

- **Audit Plane 12** uses accepted ADRs as the baseline for
  drift detection. After acceptance, Plane 12b begins comparing
  this ADR's stated decision to implementation reality.

- **Architecture review workflow** treats accepted ADRs as the
  canonical record of architectural intent.

## What this command does NOT do

- **Modify ADR content beyond status/date.** Acceptance does not
  refine; refine before accepting.
- **Auto-supersede related ADRs.** Even if the new ADR clearly
  contradicts an existing accepted ADR, the supersession is a
  separate explicit command. Acceptance just locks this ADR in
  its current state.
- **Notify external systems.** Skillz produces files; integration
  with external tools (Slack notifications, Jira tickets, etc.)
  is outside scope.
- **Validate technical correctness.** The team's review is
  responsible for validating the decision is sound. The command
  validates structure, not substance.

## Examples

```bash
# Standard acceptance
/engineer:architecture:decisions:accept ADR-007

# Acceptance with auto-update of architecture manifest
/engineer:architecture:decisions:accept ADR-007 --update-architecture-manifest
```

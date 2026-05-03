# Decisions — Sub-Namespace Context (`engineer/architecture/decisions/`)

> Read this in addition to `engineer/architecture/_context.md` whenever
> any `/engineer:architecture:decisions:*` command runs.
>
> This sub-namespace owns the Architecture Decision Record (ADR)
> lifecycle: creation, refinement, acceptance, supersession, and
> retrofitting of decisions made before ADR discipline was
> established.

## What ADRs are (and aren't)

An ADR is a **versioned, immutable document** that captures:

1. **Context** — the forces in tension at the moment of decision
2. **Decision** — what was chosen
3. **Alternatives considered** — what was rejected and why
4. **Consequences** — what becomes easier and harder as a result

ADRs are **not**:
- Design documents (those describe how something works; ADRs
  capture why a structural choice was made)
- Style guides (those constrain syntax; ADRs constrain structure)
- Retrospective post-mortems (those analyze incidents; ADRs are
  forward-looking when written and historical when read)
- Aspirational targets ("we should adopt event sourcing" isn't
  an ADR until "we are adopting event sourcing for X" with full
  context, alternatives, and consequences)

## ADR file format

ADRs use a Nygard-influenced format with explicit sections.
Stored at `design/decisions/ADR-NNN-kebab-case-slug.md`.

```markdown
# ADR-NNN: <Title>

## Status

<proposed | accepted | superseded by ADR-MMM | deprecated | rejected>

## Date

Proposed: YYYY-MM-DD
Accepted: YYYY-MM-DD  (omit until accepted)
Superseded: YYYY-MM-DD  (omit unless superseded)

## Context

<2-5 paragraphs describing the situation that requires a decision.
What forces are in tension? What constraints apply? What did we
know at the time of decision?>

## Decision

<1-2 paragraphs stating clearly what we're doing. Active voice.
"We will..." or "We are adopting..." not "It is recommended that...">

## Alternatives Considered

### Alternative 1: <name>

<1-2 paragraphs describing this alternative and why it was not
chosen. Be specific about the trade-offs.>

### Alternative 2: <name>

<...>

### Alternative N: <name>

<...>

## Consequences

### Positive

- <consequence>
- <consequence>

### Negative

- <consequence>
- <consequence>

### Neutral

- <consequence — something that's just true now, neither good
  nor bad>

## References

- <links to relevant code, related ADRs, external resources>

## Implementation Notes  (optional)

<If there are non-obvious implementation requirements that flow
from this decision, list them here. This is the section that
might be worth checking when starting work that touches this
decision.>
```

### Title conventions

ADR titles are **declarative statements**, not questions.

✓ "Schema-per-tenant for multi-tenancy isolation"
✓ "Async messaging via SQS for user events"
✓ "JWE tokens with WebAuthn primary, password fallback"

✗ "Should we use schema-per-tenant?"
✗ "Multi-tenancy options"
✗ "Authentication"

The title should be specific enough that a reader skimming the
decisions index can tell which ADR they want without opening it.

## ID conventions

- Sequential, zero-padded to 3 digits: `ADR-001`, `ADR-002`, …
- Numbers assigned at proposal time
- Numbers never reused, even when ADRs are rejected or
  superseded
- Slug is the kebab-cased title at proposal time; it doesn't
  change even if the title is later refined (so the file name
  stays stable)

## Status taxonomy

```
                    ┌──────────────┐
                    │   proposed   │ Mutable. Under discussion.
                    └───┬───────┬──┘
                        │       │
                  refine│       │abandon
                        │       │
                        ▼       ▼
              ┌──────────┐  ┌──────────┐
              │ accepted │  │ rejected │ Terminal. Historical record.
              └────┬─────┘  └──────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
supersede     deprecate     (terminal)
       │           │
       ▼           ▼
  ┌────────────┐ ┌──────────────┐
  │ superseded │ │  deprecated  │ Terminal.
  └────────────┘ └──────────────┘ Decision no longer applies.
```

- **proposed** — drafted, under team discussion. Content can
  still change. The decision is not yet binding.
- **rejected** — proposed and declined after consideration. Kept
  for the record so future engineers can see "we considered this
  and decided against it for these reasons."
- **accepted** — decision is in force. Content is **immutable**;
  changes require a superseding ADR.
- **superseded** — a newer ADR replaces this one. The newer ADR
  references this one in its "References" section; this ADR's
  status block points to the newer one. Content is preserved.
- **deprecated** — explicitly retired without replacement. The
  decision no longer applies, but no new decision was made
  (e.g., the system was deprecated entirely, or the constraint
  the decision addressed no longer exists). Content preserved.

## Immutability rule

Once an ADR is **accepted**, its content (Context, Decision,
Alternatives, Consequences sections) is immutable. The only
allowed edits to an accepted ADR are:

1. Status transitions (accepted → superseded, accepted →
   deprecated)
2. Date updates that accompany status transitions
3. Adding to the References section (new related ADRs, follow-up
   work)
4. Implementation Notes additions (clarifications discovered
   during execution; never contradictions of the original
   decision)

If the decision is wrong, supersede it. If the context was
incomplete, supersede it. Never rewrite history.

## Project-specific architectural context

ADRs reference and depend on `.pencil-architecture.json` (the
project's architectural identity). When proposing an ADR, the
`propose` command reads this manifest to check:

- Does the proposed decision align with the project's stated
  style? (e.g., proposing event-driven for a project whose
  manifest says "modular-monolith" surfaces a tension worth
  addressing in the ADR's Context)
- Does it conflict with existing accepted ADRs? (the command
  surfaces relevant accepted ADRs by tag overlap)
- Does it require updating the architectural identity? (e.g.,
  accepting an ADR that introduces async messaging for a
  previously sync-only system updates `integrationPatterns`)

## Phase 0: discovery (before any new ADR command runs)

Every `/engineer:architecture:decisions:*` command reads:

1. `product/.pencil-decisions.json` — current ADR index
2. `product/.pencil-architecture.json` — architectural identity
3. `design/decisions/` directory listing — actual ADR files on
   disk (cross-checks against the index for drift)

If the manifest is missing, the command initializes it (after
confirming with the user that this is a first-ADR situation, not
a missing-file situation).

If the directory listing diverges from the manifest (orphan ADR
files, missing files referenced by manifest), the command
surfaces the drift and asks for resolution before proceeding.

## Cross-routine awareness

ADR commands compose:

- `propose` → produces a draft. Status: proposed.
- `refine` → iterates on a proposed ADR. Status: stays proposed.
- `accept` → marks proposed ADR accepted. Locks content. Updates
  manifest. May trigger `.pencil-architecture.json` update.
- `supersede` → creates new ADR with `supersedes` link, updates
  old ADR's status to superseded.
- `retrofit` → captures past decisions as new ADRs. Status:
  accepted (retroactively, with `retrofitted: true` flag in
  metadata).

## Conventions for stakeholder review

ADRs frequently need review before acceptance. The
`engineer:adr-cycle` workflow handles this lifecycle, but
individual commands also support review touchpoints:

- `propose` accepts a `--draft` flag that produces a draft
  marked WIP, ready for sharing
- `refine` accepts review feedback as an argument and applies
  changes (with edit history preserved in the ADR's git history,
  not in the ADR document itself)
- `accept` requires explicit confirmation; it's a one-way door

## Review and audit tie-in

`/audit` Plane 12 sub-checks cover:

- **12a ADR coverage** — significant architectural patterns
  visible in code without backing ADRs (e.g., a new integration
  style adopted, a new database introduced)
- **12b ADR drift** — accepted ADRs whose implementation has
  diverged from the stated decision

These checks read `.pencil-decisions.json` and the ADR files
directly. False positives are common; the audit's role is to
surface candidates, not auto-create ADRs.

## Anti-patterns

- **Editing accepted ADRs** — once accepted, content is
  immutable. Supersede or deprecate; never rewrite.
- **Numbering gaps "for clarity"** — sequential numbering means
  ADR-NNN is the (NNN)th decision proposed. Don't skip to
  ADR-010 for the "tenth important" one and call earlier ones
  ADR-001a through ADR-001i.
- **Multi-decision ADRs** — one ADR, one decision. If the
  proposal involves three structural choices, write three ADRs.
  They can reference each other.
- **ADRs without alternatives** — every decision has alternatives.
  If the "Alternatives Considered" section is empty or trivial,
  the decision wasn't a real decision; it was a default.
  Either find the real alternatives or skip the ADR.
- **Retrofitting too aggressively** — retrofit decisions that
  were genuinely deliberate; don't retrofit accidents,
  inheritances from copy-paste, or path-of-least-resistance
  outcomes. Those aren't decisions and shouldn't be documented
  as such.
- **Vague consequences** — "improves maintainability" or
  "increases flexibility" is not a useful consequence.
  Specifics: "reduces deploy time from 8 minutes to 90 seconds",
  "requires PostgreSQL 14+ in all environments", "introduces
  eventual-consistency considerations for reporting queries."

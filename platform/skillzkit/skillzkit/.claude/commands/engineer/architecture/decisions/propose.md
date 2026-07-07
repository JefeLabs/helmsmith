---
description: Draft a new Architecture Decision Record (ADR) with full context, alternatives considered, decision statement, and consequences. Outputs a proposed-status ADR file ready for team discussion. The most consequential command in the decisions sub-namespace — most projects start with this.
argument-hint: <decision-summary> [--tags tag1,tag2] [--related ADR-NNN] [--draft]
allowed-tools: Read, Write, Edit, Bash
---

Draft a new Architecture Decision Record. Produces a fully-
structured ADR file in proposed status, ready for team review and
eventual acceptance via `/engineer:architecture:decisions:accept`.

This is typically the first command run in a new architecture
namespace setup. The first ADR proposed initializes
`product/.pencil-decisions.json` and creates the `design/decisions/`
directory.

## Phase 0: discovery

Read existing state:

1. `product/.pencil-decisions.json` — current ADR index. If
   missing, this is a first-ADR situation; confirm with user
   before initializing.
2. `product/.pencil-architecture.json` — architectural identity.
   Check whether the proposed decision aligns with stated style,
   integration patterns, and tech stack. If misaligned,
   surface the tension as a Context input to the ADR.
3. `design/decisions/` directory listing — cross-check against
   the manifest. Any drift (orphan files, missing files)
   surfaces before proceeding.
4. The decision summary from `$ARGUMENTS` — used as the
   working title until refined.

If `--related ADR-NNN` is provided, read that ADR for context.
The new ADR will likely reference it; if the decisions are in
tension, the new ADR may eventually supersede the old.

If `--tags` is provided, parse the comma-separated list. Tags
are used in the manifest for grouping and in audit Plane 12 for
coverage analysis. Common tags: `multi-tenancy`, `data`,
`integration`, `auth`, `caching`, `messaging`, `compliance`,
`performance`, `security`, `frontend`, `backend`, `infra`.

## Phase 1: ID assignment

Read `product/.pencil-decisions.json` to find the highest existing
ADR number. The new ADR is assigned `ADR-NNN` where NNN is the
next sequential number, zero-padded to 3 digits.

If no ADRs exist yet, the new one is `ADR-001`.

The slug is derived from the decision summary by:

1. Lowercase
2. Replace non-alphanumeric with hyphens
3. Collapse consecutive hyphens
4. Truncate to first 6 meaningful words

Example: "Schema-per-tenant for multi-tenancy isolation" →
`schema-per-tenant-for-multi-tenancy-isolation` → truncated to
`schema-per-tenant-multi-tenancy-isolation` (6 words after the
hyphenation).

The slug is locked at proposal time. Even if the title is later
refined, the file name and ID don't change.

## Phase 2: structured prompting

For each ADR section, prompt the user with focused questions.
Don't generate the entire ADR from a one-line summary; the
quality of an ADR comes from the deliberate structuring of
context, alternatives, and consequences.

### Context section

Prompt the user:

> What forces are in tension that require a decision here? What
> constraints apply (technical, business, regulatory)? What did
> we know when this came up?

If the project's architectural identity is relevant (and it
usually is), surface it:

> The project's stated style is `<style from manifest>`. The
> default integration pattern is `<pattern>`. The multi-tenancy
> strategy is `<strategy>`. Does this decision interact with
> any of those? If yes, note the interaction in the context.

If `--related ADR-NNN` was provided, surface that ADR's decision
and ask:

> ADR-NNN's decision is: "<decision statement>". How does the
> current proposal interact with it? Reinforce, contradict,
> extend, or orthogonal?

### Decision section

Prompt:

> State the decision in active voice. "We will…" or "We are
> adopting…" not "It is recommended that…". Be specific enough
> that a reader can tell what's in scope and what isn't.

### Alternatives Considered section

Prompt:

> Every real decision has alternatives. List at least two
> alternatives that were genuinely considered. For each:
>
> - What was the alternative?
> - Why was it not chosen?
> - What trade-off made the chosen path better?
>
> If you can't list at least two real alternatives, this might
> not be a decision worth an ADR — it might be a default. Stop
> and reconsider.

### Consequences section

Prompt for three buckets:

> Positive consequences — what becomes easier?
>
> Negative consequences — what becomes harder, or what risk are
> we taking on?
>
> Neutral consequences — what's just a fact now (neither good
> nor bad, but worth knowing)?
>
> Be specific. "Improves maintainability" is not useful;
> "reduces deploy time from 8 minutes to 90 seconds" is.

### References section

Prompt:

> Are there code paths, external resources, related ADRs, or
> design docs that this ADR connects to? List them.

### Implementation Notes (optional)

Prompt:

> Are there non-obvious requirements that flow from this
> decision? Things future engineers should know when touching
> code that depends on this? If yes, list them. If no, skip
> this section.

## Phase 3: ADR file generation

Generate the ADR file at `design/decisions/ADR-NNN-<slug>.md`
using the format from `engineer/architecture/decisions/_context.md`.

Initial status: **proposed**.
Initial date: today's date as `proposed`.
`accepted` and `superseded` dates are omitted (until accepted).

If `--draft` flag was provided, prepend a WIP banner to the
file:

```markdown
> **DRAFT — Not Yet Reviewed**
>
> This ADR is a working draft, shared for early feedback. It
> will be refined via `/engineer:architecture:decisions:refine` before
> being submitted for acceptance.
```

The `--draft` flag is for sharing early thinking with
stakeholders before doing full alternatives analysis. Without
the flag, the ADR is treated as a complete proposal awaiting
team discussion.

## Phase 4: manifest update

Update `product/.pencil-decisions.json`:

```jsonc
{
  "id": "ADR-NNN",
  "title": "<title>",
  "status": "proposed",
  "proposedDate": "YYYY-MM-DD",
  "acceptedDate": null,
  "supersededBy": null,
  "supersedes": null,
  "tags": ["tag1", "tag2"],
  "filePath": "design/decisions/ADR-NNN-<slug>.md",
  "draft": true  // only if --draft was provided; removed on first refine
}
```

Insert in numerical order (highest ID first; new ADRs prepend to
the array since most-recent is most-relevant for browsing).

## Phase 5: architectural identity check

If the proposed ADR materially affects
`.pencil-architecture.json` (e.g., introduces a new integration
pattern, shifts multi-tenancy strategy, changes primary tech
stack), surface this:

> This ADR proposes a change that may affect the project's
> architectural identity. The identity manifest currently says
> `<current value>`. If this ADR is accepted, the manifest
> should be updated to `<proposed value>`.
>
> The architectural identity manifest is NOT updated at proposal
> time — only at acceptance, via `/engineer:architecture:decisions:accept`.

## Phase 6: report

Print a summary:

```
Created ADR-NNN: <title>
Status:          proposed
File:            design/decisions/ADR-NNN-<slug>.md
Tags:            tag1, tag2
Related ADRs:    ADR-MMM (referenced)

Next steps:
  1. Share with stakeholders for review
  2. Iterate via /engineer:architecture:decisions:refine ADR-NNN <feedback>
  3. When team is aligned: /engineer:architecture:decisions:accept ADR-NNN
  4. If superseded later: /engineer:architecture:decisions:supersede ADR-NNN <new-decision-summary>
```

If `--draft` was provided, the report mentions:

```
Note: This is a DRAFT (--draft flag). Run /engineer:architecture:decisions:refine
to remove draft status when ready for proper review.
```

## What this command does NOT do

- **Auto-generate alternatives.** ADR quality depends on
  genuinely considered alternatives. The command structures the
  prompting; the user supplies the substance.
- **Update `.pencil-architecture.json`.** Architectural identity
  changes only happen at acceptance, never at proposal.
- **Mark superseded.** Even if the new ADR explicitly contradicts
  an old accepted ADR, the old one's status doesn't change at
  proposal time. Use `/engineer:architecture:decisions:supersede` when
  ready to formalize the supersession.
- **Validate the decision.** ADRs document choices; they don't
  judge them. The command will produce an ADR even if the
  decision is questionable. Quality control is the team's job
  via review, not the command's job at draft time.

## Composition

- After `propose`: typically `refine` to iterate, then `accept`
  to lock. Or `supersede` if proposing replaces an existing
  accepted ADR.
- The `engineer:adr-cycle` workflow orchestrates the full
  proposal-to-acceptance flow with stakeholder review.

## Examples

```bash
# Simple proposal
/engineer:architecture:decisions:propose "Schema-per-tenant for multi-tenancy isolation" --tags multi-tenancy,data,compliance

# Proposal that supersedes an existing decision (uses related, not supersedes; the actual supersede happens later)
/engineer:architecture:decisions:propose "Migrate from sync request-response to event-driven for user-events" --tags integration,events,performance --related ADR-003

# Early draft for stakeholder feedback
/engineer:architecture:decisions:propose "Adopt feature flags via LaunchDarkly" --tags feature-flags,deployments --draft
```

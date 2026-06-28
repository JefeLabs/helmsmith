---
description: Capture an undocumented past architectural decision as an ADR. For projects where decisions were made but never written down — common when ADR discipline is introduced mid-lifecycle. Outputs a retrofitted ADR in accepted status with a retrofitted flag, with full context reconstructed from current state.
argument-hint: <decision-summary> [--tags tag1,tag2] [--evidence path/to/code-or-config]
allowed-tools: Read, Write, Edit, Bash
---

Capture a past architectural decision that was made but never
documented as an ADR. Common scenario: a project has been running
for years with implicit architectural choices (multi-tenancy
strategy, integration patterns, framework selections) that
everyone "just knows" but isn't written down. ADR discipline gets
adopted; this command formalizes the existing decisions
retroactively.

Retrofitted ADRs are different from forward-proposed ADRs in
two ways:

1. **They start in `accepted` status.** The decision has already
   been in force. Retrofitting documents reality, not a
   proposal.
2. **They carry a `retrofitted: true` flag.** This signals to
   future readers that the historical record is reconstructed
   from current state, not captured at the time of decision.

This command is the ONE exception to the rule that "accepted
ADRs require team review and explicit acceptance." Retrofitting
is bulk reality-capture; over-gating it would prevent teams from
catching up on documentation debt.

## When to retrofit (and when not to)

**Retrofit when**:

- A clear deliberate decision was made at some point (even if
  not written)
- The decision is currently in force in the codebase
- Future engineers would benefit from understanding the
  reasoning
- Team members can collaboratively reconstruct the context

**Do NOT retrofit**:

- **Accidents** — choices that emerged from copy-paste or
  default behavior, not deliberation
- **Inheritances** — choices made by predecessor projects,
  vendors, or frameworks (those aren't team decisions)
- **Path-of-least-resistance outcomes** — "we used X because it
  was the first thing that worked" isn't a decision worth ADR-
  ifying
- **Decisions that should be reconsidered** — if you're going to
  revisit it anyway, propose a fresh ADR instead of retrofitting
  and immediately superseding

## Phase 0: discovery

1. Read `product/.pencil-decisions.json` (initialize if missing).
2. Read `product/.pencil-architecture.json` (initialize if
   missing).
3. If `--evidence` flag was provided, read the referenced files
   to extract context (code patterns, configuration values,
   schema definitions, etc.).

## Phase 1: ID assignment

Same logic as `propose`. Retrofitted ADRs are NOT renumbered to
match historical order — they're assigned the next sequential
number based on documentation order. The ADR's content can
include "Decision made approximately YYYY-MM" if known.

## Phase 2: structured prompting (retrofit-flavored)

Prompts emphasize **reconstruction** rather than **proposal**:

### Context section (retrofit-specialized)

> What was the situation when this decision was made? Even if
> you don't know the exact date, what year or phase of the
> project was it? What forces were in tension?
>
> If you don't know the original context, reconstruct what's
> visible now: the constraints that the current implementation
> respects, the patterns it follows, the trade-offs you can
> see in retrospect.
>
> Be honest about uncertainty. "Decision made approximately
> 2023; original context not fully reconstructed" is a valid
> Context section.

### Decision section

> State the decision as it currently manifests in the codebase.
> Active voice, present tense. "We use schema-per-tenant for
> tenant isolation" rather than "It was decided in 2023 that we
> would use schema-per-tenant."
>
> The retrofit flag captures the historical-reconstruction
> aspect; the decision statement itself describes current
> reality.

### Alternatives Considered section

> Reconstruct what alternatives the team considered, even if
> the analysis is incomplete. Common reconstructable
> alternatives:
>
> - The "obvious" alternative the codebase didn't take (e.g.,
>   "Single-tenant database per customer instead of shared
>   schema-per-tenant")
> - The pattern adopted in similar systems at the time (e.g.,
>   "Row-level security with tenant_id was popular when this was
>   built")
> - The default behavior of the framework / platform (e.g.,
>   "Next.js's default of multi-region wasn't chosen because
>   FERPA required US-only data residency")
>
> If you genuinely don't know what alternatives were considered,
> say so:
>
> "Alternatives considered at the time are not fully
> reconstructable. The current implementation suggests these
> were considered but rejected: [list]"

### Consequences section

> Retrofit consequences from current state. What's good about
> the decision now (positive)? What's painful (negative)?
> What's just a fact (neutral)?
>
> This section is often easier to fill than alternatives, since
> the consequences are visible in the present-day codebase.

### Implementation Notes section

> List specific places in the codebase where this decision
> shows up. This is especially valuable for retrofitted ADRs —
> future engineers reading the ADR can navigate to the actual
> implementation.

## Phase 3: evidence-driven enrichment

If `--evidence path/to/file` was provided:

1. Read the evidence file(s)
2. Extract relevant patterns:
   - Configuration values (e.g., `tenancy.mode=schema-per-tenant`)
   - Code patterns (e.g., `@TenantScoped` annotations)
   - Schema definitions
   - Comments in code that hint at decision context
3. Surface findings to user as fillable context for the ADR

Example: if the evidence is `application.yml` showing tenant
configuration, the command might surface:

> Evidence found in application.yml:
>
>   spring.datasource.tenant.strategy: SCHEMA_PER_TENANT
>   spring.datasource.tenant.discriminator: tenant_id
>
> This confirms the decision is currently in force and
> implemented via Spring's tenant-resolution machinery. Add to
> Implementation Notes?

## Phase 4: file generation

Generate the ADR file with retrofit-specific structure:

```markdown
# ADR-NNN: <Title>

## Status

accepted (retrofitted)

## Date

Approximate decision date: <if known, e.g. "2023">
Retrofitted: YYYY-MM-DD

## Context

<reconstructed context, with explicit acknowledgment of any
uncertainty>

[remaining sections per standard format]

---

> **Retrofit note**: This ADR was created retroactively to
> document a decision that was made but not recorded at the
> time. The decision is currently in force in the codebase. The
> Context and Alternatives sections are reconstructed; some
> details may not match the original decision-making team's
> reasoning exactly.
```

The retrofit note at the end is part of the ADR file; it's not
optional.

## Phase 5: manifest update

Update `product/.pencil-decisions.json`:

```jsonc
{
  "id": "ADR-NNN",
  "title": "<title>",
  "status": "accepted",
  "proposedDate": null,
  "acceptedDate": null,
  "retrofittedDate": "YYYY-MM-DD",
  "approximateDecisionDate": "<if known>",
  "supersededBy": null,
  "supersedes": null,
  "tags": [...],
  "filePath": "design/decisions/ADR-NNN-<slug>.md",
  "retrofitted": true
}
```

The `retrofitted: true` flag is what distinguishes this from
forward-proposed ADRs in audit and reporting.

## Phase 6: architectural identity update

If the retrofitted ADR documents a decision that's not yet
captured in `.pencil-architecture.json`, surface the proposed
identity manifest update. Example:

> ADR-NNN documents the decision to use schema-per-tenant
> isolation. The architectural identity manifest currently
> doesn't have a multiTenancy section. Add it now?
>
>   "multiTenancy": {
>     "strategy": "schema-per-tenant",
>     "isolation": "logical",
>     "constraints": ["FERPA", "COPPA"]
>   }

Confirmation required before update. The retrofit ADR's
acceptance is automatic; the identity manifest update is not.

## Phase 7: report

```
Retrofitted ADR-NNN: <title>
Status:          accepted (retrofitted)
Retrofit date:   YYYY-MM-DD
Approx. original: <year or "unknown">
File:            design/decisions/ADR-NNN-<slug>.md
Tags:            ...

Architectural identity manifest:
  <if updated> Updated to reflect the retrofitted decision
  <if no change> Already consistent with this decision

Reminder:
  - Retrofitted ADRs are flagged in /audit Plane 12 with
    a "retrofitted" indicator separate from forward-proposed
    ADRs
  - The team can refine the retrofitted ADR's content via
    /engineer:architecture:decisions:refine if better historical context
    is recovered later (refinement is allowed for retrofitted
    ADRs since their acceptance was procedural, not deliberative)
  - When the decision should be revisited or replaced, use
    /engineer:architecture:decisions:supersede ADR-NNN as normal
```

## Refinement exception for retrofitted ADRs

The immutability rule for accepted ADRs has one nuance for
retrofitted ones: their initial acceptance was procedural (this
command, no team-review gate), so refinements are still allowed
when better historical context is recovered.

`/engineer:architecture:decisions:refine` will detect the `retrofitted:
true` flag and allow content updates without requiring
supersession. The flag stays through refinements.

If the team decides the retrofitted ADR's decision should change
going forward, use `supersede` as normal — the new ADR is a
forward-proposal, not a retrofit.

## Bulk retrofit pattern

For projects with many undocumented decisions, run retrofit in
sequence. The recommended order:

1. **Foundational decisions first** — multi-tenancy strategy,
   primary tech stack, database choice, deployment model
2. **Integration decisions** — sync vs async, messaging
   substrate, API style (REST/GraphQL/gRPC)
3. **Cross-cutting concerns** — auth strategy, observability
   approach, error handling, retry policies
4. **Domain-specific decisions** — feature-specific
   architectural choices

Retrofit in sessions of 3-5 decisions to maintain quality. Each
retrofit benefits from team discussion even though it's not a
formal review — the structured prompting surfaces context the
team hadn't articulated.

## What this command does NOT do

- **Auto-detect decisions from code.** The command can use
  `--evidence` files as input but does not autonomously crawl
  the codebase searching for decision-shaped patterns.
- **Validate that the decision was actually deliberate.** If the
  user retrofits something that was actually an accident, the
  command produces an ADR anyway. The team's judgment governs
  what's worth retrofitting.
- **Backdate.** The retrofittedDate is today; the
  approximateDecisionDate is captured separately as a free-form
  annotation. The ADR file's git history shows when this command
  ran.

## Examples

```bash
# Retrofit with evidence file
/engineer:architecture:decisions:retrofit "Schema-per-tenant for multi-tenancy isolation" --tags multi-tenancy,data,compliance --evidence app-service/src/main/resources/application.yml

# Retrofit without evidence (pure reconstruction)
/engineer:architecture:decisions:retrofit "Spring Boot 3.x with Jakarta EE migration" --tags backend,framework

# Retrofit a decision tied to compliance
/engineer:architecture:decisions:retrofit "WebAuthn passkeys as primary auth, password fallback" --tags auth,security,compliance --evidence app-service/src/main/java/.../auth
```

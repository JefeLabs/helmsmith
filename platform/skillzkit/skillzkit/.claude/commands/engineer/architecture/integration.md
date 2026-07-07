---
description: Select and apply integration patterns — sync request-response, async messaging, event-driven, batch, stream. Documents pattern choice with consistency / latency / coupling trade-offs and surfaces ADR opportunities. Outputs pattern-decision documents in design/integrations/.
argument-hint: <action: select|document|review> <integration-name> [--pattern sync|messaging|event-driven|batch|stream]
allowed-tools: Read, Write, Edit, Bash
---

Help select integration patterns and document the
trade-offs accepted with each choice. Integration patterns are
foundational architectural decisions — they shape consistency
guarantees, latency characteristics, coupling between services,
and operational complexity.

This command structures the decision-making and produces
artifacts that downstream work (API design, data model
migrations, deployment) can reference.

## Pattern catalog

| Pattern | Consistency | Latency | Coupling | Complexity |
|---------|-------------|---------|----------|------------|
| **Sync request-response** | Strong | Low (network RTT) | High | Low |
| **Async messaging (queue)** | Eventual | Variable (ms-min) | Medium | Medium |
| **Event-driven (pub-sub)** | Eventual | Variable | Low (with discipline) | Medium-High |
| **Batch** | Eventual (per-batch atomic) | High (minutes-hours) | Low | Low-Medium |
| **Stream** | Eventual (ordered) | Low-Medium | Medium | High |
| **Webhooks** | Eventual | Variable | Low (one-way) | Medium |
| **Saga (orchestrated)** | Eventual (compensating) | High (per-step) | Medium | High |
| **Saga (choreographed)** | Eventual (compensating) | High | Low | Very High |

Each row is a generalization; specifics depend on
implementation, infrastructure, and SLAs.

## Actions

| Action | What it does |
| --- | --- |
| `select` | Help choose a pattern given requirements |
| `document` | Document a chosen pattern with rationale and ADR linkage |
| `review` | Audit existing integrations against principles |

## Phase 0: discovery

1. Read `product/.pencil-architecture.json`. Note declared
   `integrationPatterns` and `style`.
2. Read `product/.pencil-decisions.json`. Surface accepted ADRs
   with tags: `integration`, `events`, `messaging`, `consistency`.
3. List existing integration documents in `design/integrations/`.

## Action: select

Helps choose a pattern by walking through requirements
systematically.

### Phase 1: integration boundary identification

Prompt:

> What's the integration boundary? Describe in terms of:
>   - Source (which container / service / system initiates)
>   - Destination (which container / service / system receives)
>   - What's exchanged (data, command, event, signal)
>
> Examples:
>   - "Web app calls API service to fetch user profile"
>   - "API service notifies billing service when subscription
>      changes"
>   - "Nightly batch updates analytics from production"

### Phase 2: requirements interrogation

Walk through requirements that drive pattern selection:

#### Consistency

> Does the consumer need to see the result before its own
> response/action completes?

- **Yes, immediately**: leans sync request-response
- **Soon, but not immediately**: leans async messaging
- **Eventually, hours okay**: leans batch
- **Eventually, with order guarantees**: leans stream

#### Latency budget

> What's the acceptable latency for end-to-end completion?

- **< 100ms**: sync only viable
- **100ms - 1s**: sync preferred, messaging acceptable
- **1s - 1min**: messaging preferred
- **1min+**: messaging or batch

#### Failure handling

> What happens if the destination is down?

- **Caller fails**: sync (with retries) is acceptable
- **Caller continues, destination eventually catches up**:
  messaging or events
- **Specific reconciliation needed**: saga or batch
  reconciliation

#### Idempotency

> Is the operation idempotent (safe to retry)?

- **Yes**: any pattern works; messaging/events become low-risk
- **No**: sync with idempotency keys; or saga with
  compensating actions

#### Coupling tolerance

> How much should the source and destination know about each
> other?

- **Source knows destination directly**: sync or direct
  messaging (queue per consumer)
- **Source publishes facts; consumers self-subscribe**:
  event-driven (pub-sub)
- **Source publishes commands; specific consumer**: messaging
  (queue)

#### Scale and throughput

> Expected request rate?

- **Low (per minute)**: any pattern works
- **Medium (per second)**: sync, messaging, or stream
- **High (per millisecond)**: stream; possibly sharded queue

#### Ordering

> Does message order matter?

- **No**: most patterns work
- **Per-key ordering**: stream (with partition key) or messaging
  (with FIFO queue)
- **Strict global order**: stream (single partition; expensive)
  or sequenced sync calls

### Phase 3: pattern recommendation

Based on the requirements, surface 1-3 candidate patterns with
trade-off analysis:

```
Based on requirements:
  - Strong consistency required
  - Latency < 200ms
  - Failure: caller may retry
  - Idempotent: yes (with idempotency key)
  - Coupling: source can know destination
  - Throughput: ~10 req/s

Recommended pattern: SYNC REQUEST-RESPONSE
Why:
  - Strong consistency requirement essentially mandates sync
  - Latency budget fits network RTT comfortably
  - Idempotency support enables retry-on-failure
  - Throughput is well within sync capabilities

Trade-offs accepted:
  - High coupling: source service must know destination's API
  - Cascading failure risk: destination outage propagates
  - Latency dependency: source latency = max(sync_latency,
    destination_latency)

Alternative: ASYNC MESSAGING (with sync-ack pattern)
  - Lower coupling, better failure isolation
  - But: adds eventual consistency, complicates the consumer-side
    UX (loading states, optimistic updates)
  - Not recommended given the consistency requirement
```

### Phase 4: project-context check

Cross-check against `.pencil-architecture.json`:

- Is the recommended pattern consistent with declared
  `integrationPatterns`? If not, surface the divergence:

  > Recommended pattern is `event-driven`, but project default
  > is `sync-request-response`. This is acceptable but may
  > warrant an ADR for the deviation. Document via
  > /engineer:architecture:decisions:propose? [y/N]

- Is the messaging substrate established? If recommending
  messaging but `techStack.messaging` is null, surface:

  > Recommended pattern requires a messaging substrate. Project
  > tech stack doesn't specify one. Consider deciding:
  >   - SQS (AWS native, simple)
  >   - SNS+SQS (pub-sub fan-out)
  >   - EventBridge (richer routing)
  >   - Kafka (high throughput, ordering)
  >
  > This is an ADR-worthy decision. Run
  > /engineer:architecture:decisions:propose first? [y/N]

## Action: document

Documents a chosen integration pattern with full rationale.
Typically run after `select` (which informs the choice) or for
existing integrations (retroactive documentation).

### Phase 1: integration document scaffolding

Generate at `design/integrations/<integration-name>.md`:

```markdown
# Integration: <name>

## Pattern

<chosen pattern>

## Source

- Service: <source service>
- Trigger: <what initiates the integration>

## Destination

- Service: <destination service>
- Endpoint / Topic / Queue: <specific target>

## Payload

<schema reference or inline definition>

## Consistency

<eventual / strong; latency expectations>

## Failure handling

- **Source-side failure**: <retry policy, dead-letter, etc.>
- **Destination-side failure**: <retry, circuit breaker, etc.>
- **Transport failure**: <timeout, broker outage handling>

## Idempotency

<how is this enforced; idempotency key location>

## Ordering

<not required / per-key / global>

## Observability

- **Source emits**: <metric / log entries>
- **Destination emits**: <metric / log entries>
- **End-to-end tracing**: <how is this connected — TraceID
  propagation, etc.>

## Backpressure

<what happens when destination is slow / queue is full>

## Alternative patterns considered

<brief — full analysis is in the ADR>

## Related ADRs

- <list>

## Implementation references

- <code paths, configuration files, terraform resources>
```

### Phase 2: ADR linkage

Surface ADR opportunities for material aspects of this
integration:

- Pattern choice itself (if not already covered by a broader ADR)
- Failure handling policy (especially compensating action design)
- Idempotency approach (especially if non-trivial)
- Ordering guarantees (if explicitly required)

## Action: review

Audits existing integrations against principles.

Checks:

1. **Pattern consistency** — integrations within the same
   service follow consistent patterns where appropriate
2. **Failure handling completeness** — every integration
   documents its failure modes
3. **Idempotency declaration** — non-GET sync calls and
   non-idempotent message handlers are flagged
4. **Observability coverage** — every integration emits
   measurable signals
5. **ADR coverage** — material decisions backed by ADRs
6. **Saga consistency** — saga implementations have documented
   compensating actions for each step
7. **Backpressure handling** — async integrations document what
   happens at saturation

Output: `design/integrations/review-<YYYY-MM-DD>.md`.

## Saga-specific guidance

When the chosen pattern is saga (orchestrated or choreographed),
the document scaffolding extends with:

- **Steps** (each step with: command, expected outcome,
  compensating action)
- **Failure paths** (which step failures trigger which
  compensations)
- **State machine** (mermaid state diagram showing valid
  transitions)
- **Distributed lock / lease handling** (if applicable)

Sagas are high-complexity patterns; the command surfaces a
warning if neither participant has previous saga experience
(known via project's accepted ADRs):

> Saga pattern selected. No prior saga ADR detected. Sagas are
> operationally complex; recommend documenting the patterns
> explicitly via ADR before implementation. Continue? [Y/n]

## Cross-namespace effects

- **`architecture:api-design`** — sync integrations need API
  contracts; the document references the contract
- **`architecture:data-model`** — async integrations often have
  outbox tables or event-sourcing schemas; data-model and
  integration documents cross-reference
- **`architecture:diagrams`** — sequence and data-flow diagrams
  show integrations in motion; integration documents are the
  reference for those diagrams
- **`maintenance:remediation:component-dedup`** — duplicate
  client-side integration code surfaces here; pattern
  consistency review can prompt dedup work

## What this command does NOT do

- **Implement integrations.** Skillz produces design artifacts;
  implementation is the team's job using their stack's tools
  (Spring Cloud Stream, AWS SDK, Kafka clients, etc.).
- **Configure infrastructure.** Provisioning queues, topics,
  event buses is owned by `.infra/` or equivalent IaC.
- **Test integrations.** Contract testing, chaos engineering,
  load testing — separate concerns.
- **Auto-detect existing integrations.** Document existing
  integrations explicitly via the `document` action.

## Examples

```bash
# Walk through pattern selection for a new integration
/engineer:architecture:integration select notify-billing-on-subscription-change

# Document a chosen pattern (after selection)
/engineer:architecture:integration document notify-billing-on-subscription-change --pattern messaging

# Review all integrations
/engineer:architecture:integration review
```

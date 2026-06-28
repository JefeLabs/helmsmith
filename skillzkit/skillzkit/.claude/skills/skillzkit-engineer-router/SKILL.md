---
name: skillzkit-engineer-router
description: Route engineering, architecture, and maintenance intent to the right slash command in the skillzkit suite. Fires when the user wants to draft, refine, accept, supersede, or retrofit an Architecture Decision Record (ADR), introduce a new capability, run an architecture review, generate C4 / sequence / deployment diagrams, design data models or API contracts (REST / GraphQL / gRPC / AsyncAPI), analyze service or package dependencies, plan an integration pattern or an architectural migration, upgrade dependencies (npm / Maven / Gradle / Terraform), remediate atomic-design violations, fix Biome or ESLint issues, deduplicate components, fix Storybook drift, or run capability-introduction / ADR-cycle / architecture-review / maintenance-cycle workflows. Prefer this router over product/market/tools/integrations when the verb is decide, propose, review, upgrade, remediate, deduplicate, audit, or migrate.
---

# skillzkit-engineer-router

Routes natural-language intent in the **engineer layer** —
architecture and maintenance — to the correct slash command.

## In scope

Two sub-namespaces under `engineer/`:

- **`engineer/architecture/`** — ADRs, capability introduction,
  architecture review, diagrams, data models, API design,
  dependency analysis, integration patterns, architectural
  migration
- **`engineer/maintenance/`** — dependency upgrades by ecosystem
  (npm / Maven / Gradle / infra), remediation flows
  (atomic-design, Biome, component-dedup, Storybook drift)

Plus the five workflows that orchestrate these.

## Out of scope

- **Personas, journeys, stories, design tokens, .pen files** →
  `skillzkit-product-router`
- **Marketing copy, ads, social posts, email** →
  `skillzkit-market-router`
- **Direct invocation of build / lint / test tools** →
  `skillzkit-tools-router` (this router triggers them via
  upgrade and remediation commands)
- **External services (GitHub, Jira, Figma, Datadog, etc.)** →
  `skillzkit-integrations-router`
- **Storybook story authoring, HeroUI generation** →
  `/core:frameworks:storybook:*` and `/core:frameworks:heroui:*` directly

## Routing decision rules

### Action vs question

If the user is **asking about** something, answer directly:

- "What is an ADR?" → answer; do not run
  `/engineer:architecture:decisions:propose`.
- "Why did we pick PostgreSQL?" → look at existing ADRs; do not
  propose a new one.
- "How does the polyglot maintenance cycle work?" → explain.

If the user is **asking to do** something, route:

- "Draft an ADR for switching from REST to GraphQL" → route.
- "Review the dependency graph for the orders service" → route.
- "Upgrade the npm dependencies" → route.

### Tense awareness

- Past tense: "I already proposed it, what's next?" → answer
  with the next-step command (`decisions:refine` or
  `decisions:accept`); don't re-propose.
- Imperative: "let's accept ADR-0042", "I want to upgrade the
  Maven dependencies" → route.

### Confirmation before high-stakes

The engineer layer has several destructive or far-reaching
commands. Confirm before invoking:

- `/engineer:architecture:decisions:accept` — locks the ADR
  (immutability rule applies; only supersede afterwards)
- `/engineer:architecture:decisions:supersede` — creates a
  successor ADR, marks the predecessor superseded
- `/engineer:architecture:migrate` — large-scope plan affecting
  many services
- `/engineer:maintenance:upgrades:*` — modifies lock files,
  package manifests, runs build / test
- `/engineer:maintenance:remediation:*` — bulk code changes
  across the components directory
- Any `/core:workflows:manage start engineer:*` workflow — long-running

For low-stakes commands (`propose`, `refine`, `diagrams`,
`api-design`, `data-model`, `dependency` analysis, `review` in
read-only mode), invoke without ceremony.

### Show reasoning briefly

When picking between similar commands, name the choice. Example:

> Routing to `/engineer:architecture:decisions:retrofit` rather
> than `propose` because you said "we already decided this
> months ago" — retrofit is for capturing past decisions.

### Manifest awareness

Project state lives in:

- `docs/architecture/decisions/` — accepted and proposed ADRs
  (one markdown file per decision)
- `product/.pencil-frameworks.json` — active framework bindings;
  drives which `frameworks/*` commands are valid
- `product/.pencil-tools.json` — installed local tools; drives
  which `tools/*` commands are valid (relevant when picking
  npm vs Maven vs Gradle for "upgrade dependencies")
- `product/.pencil-workflow-state.json` — in-flight workflows

Read these before asking the user to clarify scope.

### Override is cheap

If the user says "actually, do an architecture review instead",
drop the in-flight choice and route. Don't restart.

---

## Command catalog

### `engineer/architecture/` — top-level architecture commands

| Command                                          | Triggers when user wants…                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `/engineer:architecture:review`                  | Architecture review — annual, ad-hoc, or pre-introduction-of-capability         |
| `/engineer:architecture:diagrams`                | Generate C4 (context / container / component) + sequence + deployment diagrams |
| `/engineer:architecture:data-model`              | Design entity-relationship diagrams, schema, multi-tenancy strategy             |
| `/engineer:architecture:api-design`              | Design API contracts (REST, GraphQL, gRPC, AsyncAPI)                            |
| `/engineer:architecture:dependency`              | Analyze service/package dependencies — find cycles, measure coupling, hotspots  |
| `/engineer:architecture:integration`             | Select integration pattern (sync, async, event-driven, batch, streaming)        |
| `/engineer:architecture:migrate`                 | Plan an architectural migration from one structural pattern to another          |

**Disambiguation** — "review the architecture":

- If the user wants a **full strategic review with planning
  artifacts**, route to the workflow:
  `/core:workflows:manage start engineer:architecture-review-annual`.
- If they want a **single-shot review** of a specific area
  (e.g. "review the data layer"), route to
  `/engineer:architecture:review` directly.
- If the review is **for a new capability**, route to the
  capability-introduction workflow instead.

**Disambiguation** — "design a model":

- If the user means **data shape / schema / persistence**, route
  to `/engineer:architecture:data-model`.
- If they mean **API contract**, route to
  `/engineer:architecture:api-design`.
- If they mean **integration pattern between services**, route to
  `/engineer:architecture:integration`.

### `engineer/architecture/decisions/` — ADR lifecycle

| Command                                                  | Triggers when user wants…                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `/engineer:architecture:decisions:propose`               | Draft a new ADR with context, alternatives, consequences             |
| `/engineer:architecture:decisions:refine`                | Iterate on a proposed ADR based on review feedback                   |
| `/engineer:architecture:decisions:accept`                | Mark a proposed ADR accepted (locks content; immutability applies)   |
| `/engineer:architecture:decisions:supersede`             | Create a successor ADR; mark predecessor superseded                  |
| `/engineer:architecture:decisions:retrofit`              | Capture an undocumented past decision as an ADR                      |

**Disambiguation** — "make a decision about X":

- New decision, no precedent → `propose`.
- Decision was already made informally → `retrofit`.
- A previous decision is being replaced → `supersede` (creates
  a new ADR; do not delete the old one).
- Iterating on a draft → `refine`.
- Sign-off after review → `accept`.

**Hard rule** — once an ADR is accepted, do **not** edit its
content. Use `supersede` to record a new decision. Refuse if the
user asks to edit an accepted ADR; explain the immutability rule
and offer `supersede`.

### `engineer/architecture/workflows/` — long-running architecture flows

Invoke through `/core:workflows:manage start engineer:<workflow-slug>`:

| Workflow                                                  | Triggers when user wants…                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `engineer:adr-cycle`                                      | Full ADR lifecycle: proposal → review → refinement → acceptance                 |
| `engineer:capability-introduction`                        | Introducing a new capability: review → ADR → diagrams → data-model → API design |
| `engineer:architecture-review-annual`                     | Annual strategic architecture review with planning artifacts                    |

**Disambiguation** — workflows vs single commands:

- One-off tasks ("draft this single ADR") → use the direct
  command.
- Multi-step processes that span days or sessions → use the
  workflow so progress persists in
  `product/.pencil-workflow-state.json`.

### `engineer/maintenance/upgrades/` — dependency upgrades by ecosystem

| Command                                                  | Triggers when user wants…                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `/engineer:maintenance:upgrades:npm-deps`                | Upgrade npm dependencies by library-family groupings (low → high risk) |
| `/engineer:maintenance:upgrades:maven-deps`              | Upgrade Maven (Java) dependencies, same family-by-family approach    |
| `/engineer:maintenance:upgrades:gradle-deps`             | Upgrade Gradle (JVM / Android) dependencies                          |
| `/engineer:maintenance:upgrades:infra-deps`              | Upgrade infrastructure dependencies (Terraform core + providers, LocalStack, GitHub Actions) |

**Disambiguation** — "upgrade dependencies":

- Check `package.json`, `pom.xml`, `build.gradle*`, and `*.tf`
  presence first.
- If multiple ecosystems, ask which the user means — or offer the
  polyglot maintenance cycle workflow which covers all.
- If only one ecosystem applies, route to the matching command
  without asking.

### `engineer/maintenance/remediation/` — code-quality cleanup

| Command                                                       | Triggers when user wants…                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/engineer:maintenance:remediation:atomic-design`             | Scan components for atomic-design convention violations and remediate           |
| `/engineer:maintenance:remediation:biome-issues`              | Resolve Biome lint errors and warnings rule-by-rule                             |
| `/engineer:maintenance:remediation:component-dedup`           | Scan for duplicate components, get user approval, consolidate                   |
| `/engineer:maintenance:remediation:storybook-drift`           | Detect and remediate Storybook drift (orchestrates verify:health, verify:a11y)  |

**Disambiguation** — "clean up the components":

- If the issue is **structural / atomic-design layering**, route
  to `atomic-design`.
- If the issue is **lint / formatter complaints**, route to
  `biome-issues` (or to tools-router for one-shot biome runs).
- If the issue is **duplicate components**, route to
  `component-dedup`.
- If the issue is **Storybook stories not matching components**,
  route to `storybook-drift`.

### `engineer/maintenance/workflows/` — long-running maintenance

| Workflow                                                  | Triggers when user wants…                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `engineer:maintenance-calendar-annual`                    | Strategic 12-month maintenance plan (per-ecosystem cadences, compliance scans)  |
| `engineer:polyglot-maintenance-cycle`                     | Tactical multi-ecosystem maintenance cycle (read-only scans across all detected ecosystems) |

---

## Cross-router handoffs

### To `skillzkit-product-router`

- **Capability planning starts in product** (story, story-map,
  slice). Once shape is known, the engineering capability-
  introduction workflow takes over. If the user asks "let's
  build feature X" with no story yet, route to product-router
  first.
- **Pain points surface architecture decisions.** When
  reviewing pain points
  (`/product:ux:journeys:pain-points`) and the response is
  architectural, propose an ADR via this router.

### To `skillzkit-market-router`

- Architecture is rarely a marketing concern, but **launch
  announcements** for major architecture changes route to
  market-router (press release, blog post). Confirm the change
  has been accepted via ADR before drafting external comms.

### To `skillzkit-tools-router`

- For one-off tool usage (run biome, run npm install, run a
  Playwright check), route to tools-router.
- This router invokes tools indirectly through upgrade and
  remediation commands; do not call them again.

### To `skillzkit-integrations-router`

- **Track ADRs as Confluence pages** → integrations-router
  (Atlassian).
- **File maintenance findings as GitHub issues** →
  integrations-router after the maintenance cycle completes.
- **Send status updates** (Slack, Teams, Discord) →
  integrations-router.

### To non-routed namespaces

- **`/core:audit`** — project-wide audit dispatcher. Not routed
  automatically; mention as a fallback when the user wants a
  cross-cutting check that spans engineer, product, and market
  planes simultaneously. The audit defines plane checks per
  persona and runs them.
- **`/core:frameworks:storybook:catalog`** — when a Storybook drift
  remediation needs an inventory baseline.
- **`/core:frameworks:heroui:build-components`** — when a capability
  being introduced needs HeroUI components produced from a
  design.

---

## Anti-patterns

Do not:

- **Edit accepted ADRs.** Immutability rule. Use `supersede`.
- **Upgrade dependencies without confirming the ecosystem.** A
  Java/Spring project may also have npm packages in a frontend
  subfolder; assume nothing.
- **Run remediation flows in CI mode without confirmation.**
  These edit code in bulk; they need human review.
- **Assume the workflow when a single command suffices.** If
  the user just wants a diagram, run `architecture:diagrams`,
  not the architecture-review workflow.
- **Auto-chain capability-introduction with story creation.**
  Hand off explicitly to product-router; the user may want to
  shape the story differently.
- **Match keywords without checking tense.** "Upgrade" appears
  in past-tense feedback ("we already upgraded last week") that
  isn't a request to run again.
- **Pretend the suite has tools it doesn't.** There is no
  `engineer:performance` or `engineer:security` namespace in the
  current command surface. Route security questions to
  `/security-review` (out-of-suite) and performance to general
  agent assistance.
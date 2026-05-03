---
description: Design and document API contracts (REST, GraphQL, gRPC, AsyncAPI). Covers endpoint design, schema definition, versioning strategy, and deprecation patterns. Outputs contract files in design/api-contracts/ and surfaces ADR opportunities for material API decisions.
argument-hint: <action: design|version|deprecate|review> <api-name> [--style rest|graphql|grpc|async] [--version vN]
allowed-tools: Read, Write, Edit, Bash
---

Design API contracts and document the decisions behind them.
Skillz produces contract files (OpenAPI for REST, GraphQL SDL,
.proto for gRPC, AsyncAPI for events) and structures the
decision record around versioning and deprecation.

API design overlaps with architecture decisions — material
choices (REST vs GraphQL, versioning approach, breaking-change
policy) warrant ADRs. This command surfaces those moments and
delegates ADR creation to `/engineer:architecture:decisions:propose`.

## Actions

| Action | What it does |
| --- | --- |
| `design` | Create or refine an API contract |
| `version` | Cut a new version of an existing API |
| `deprecate` | Mark an API or endpoint deprecated; document sunset path |
| `review` | Audit existing contract against design principles |

## Phase 0: discovery

1. Read `product/.pencil-architecture.json`. Note the project's
   primary API style if documented (under `apis.primaryStyle`).
2. Read `product/.pencil-decisions.json`. Surface accepted ADRs
   with tags: `api`, `versioning`, `integration`.
3. List existing contracts in `design/api-contracts/`.
4. If `<api-name>` matches an existing contract, load it.

## Action: design

Creates or refines an API contract.

### Phase 1: style selection

If the project has a documented primary style (in
`.pencil-architecture.json` or via accepted ADR), default to
that:

> Project primary API style is `rest` (per ADR-009). Generating
> OpenAPI contract.

If `--style` overrides the default, surface the divergence:

> Project default is `rest` but you specified `graphql`. This is
> a mixed-style API. Confirm? [y/N]
>
> Mixed-style APIs are valid (e.g., REST for CRUD, GraphQL for
> read-heavy aggregation) but warrant an ADR documenting the
> split. Recommend running:
>
>   /engineer:architecture:decisions:propose "Mixed REST+GraphQL API
>    for SkoolScout" --tags api,architecture

If no documented default and no `--style`, prompt the user.

### Phase 2: contract scaffolding

Generate the contract scaffolding per the chosen style:

- **REST → OpenAPI 3.1**: `info`, `servers`, `paths`,
  `components/schemas`, `components/securitySchemes`. Stored at
  `design/api-contracts/<api-name>-v<N>.openapi.yaml`.
- **GraphQL → SDL**: type definitions, queries, mutations,
  subscriptions. Stored at
  `design/api-contracts/<api-name>-v<N>.graphql`.
- **gRPC → .proto**: service definitions, message types. Stored
  at `design/api-contracts/<api-name>-v<N>.proto`.
- **Async / events → AsyncAPI 3.x**: `info`, `servers`,
  `channels`, `messages`. Stored at
  `design/api-contracts/<api-name>-v<N>.asyncapi.yaml`.

Initial version is `v1` unless an existing contract is being
refined.

### Phase 3: structured prompting per element

Endpoints / operations / queries / channels are added one at a
time. For each, prompt:

- **Name** (path + verb for REST; field name for GraphQL;
  service.RPC for gRPC; channel name for async)
- **Description** (1-2 sentences of what it does)
- **Request shape** (parameters, body schema; for events: payload
  schema)
- **Response shape** (success schema, error schemas)
- **Auth requirements** (which security scheme(s) apply)
- **Idempotency** (REST: `Idempotency-Key` header support? events:
  redelivery semantics?)
- **Tenant scoping** (if multi-tenant, how is tenant identified?
  path parameter, header, JWT claim?)

For multi-tenant APIs (per `.pencil-architecture.json`
multiTenancy.strategy), surface tenant-handling consistency:

> Project multi-tenancy strategy is `schema-per-tenant`. The
> typical tenant identification pattern in your accepted ADRs
> is via JWT `tenant_id` claim. Apply consistently to this
> endpoint? [Y/n]

### Phase 4: schema modeling

Reference shared schemas in `components/schemas` (OpenAPI),
shared types (GraphQL), or shared messages (proto/AsyncAPI).
Avoid duplicating shapes; the contract file is the source of
truth for type definitions.

If the schema mirrors a database entity, surface the connection:

> Schema `Student` matches the `student` table per
> /engineer:architecture:data-model output. Keep API field names aligned
> with database column names? Or apply transformation (e.g.,
> snake_case DB → camelCase API)? Document the convention.

### Phase 5: cross-cutting concerns

For every contract, capture:

- **Pagination** (cursor-based, offset-based, page-size limits)
- **Filtering and sorting** (allowed fields, query language)
- **Rate limiting** (declared limits per auth tier)
- **Caching** (cache headers / ETags / Last-Modified support)
- **Compression** (Accept-Encoding support)

These are typically project-wide conventions, not per-endpoint.
Capture once in the contract's `info` extension or attach
`x-skoolscout-conventions: <ref>` and document at
`design/api-contracts/_conventions.md`.

### Phase 6: ADR opportunity surfacing

Surface decisions worth ADR-ifying:

- API style choice (if not already documented)
- Versioning strategy (URI vs header vs media-type)
- Authentication approach (token format, refresh strategy)
- Breaking-change policy (when do we cut a new version vs
  add a field)
- Deprecation timeline (how long before sunset)
- Idempotency approach (which operations support it, how)

For each surfaced opportunity, prompt:

> Decision worth ADR-ifying: "Versioning via URI path
> (/api/v1/, /api/v2/)". Run
> /engineer:architecture:decisions:propose now? [y/N]

User can defer; surface gets added to a follow-up list in the
report.

## Action: version

Cuts a new version of an existing API.

### Phase 1: read existing version

Load `design/api-contracts/<api-name>-v<previous-N>.<ext>`.

### Phase 2: change inventory

Prompt user for changes:

- Breaking changes (incompatible request/response shape changes,
  removed endpoints, semantic shifts)
- Additive changes (new endpoints, new optional fields)
- Removed deprecated elements

If only additive changes, surface:

> No breaking changes detected. Most teams add fields to existing
> versions rather than cutting new ones. Cut v<N+1> anyway? [y/N]

If breaking changes, the new version is mandatory.

### Phase 3: version metadata

Update `info.version` (OpenAPI), schema directives (GraphQL), or
package version (proto). Set the new file path.

### Phase 4: deprecation arc for old version

Surface the deprecation expectation:

> v<previous-N> should be marked deprecated when v<N> is
> released. Run /engineer:architecture:api-design deprecate <api-name>
> --version v<previous-N> after v<N> is in production?

If `--version` argument was used, that target version is created
explicitly. Otherwise next-sequential.

## Action: deprecate

Marks an API version or specific endpoint deprecated.

### Phase 1: target identification

If `--version vN` is provided, deprecate the entire version. If
`<api-name>` is followed by an endpoint identifier (e.g.,
`<api-name> POST /students`), deprecate just that endpoint.

### Phase 2: sunset planning

Capture:

- **Deprecation date** (when notification starts; today's date by
  default)
- **Sunset date** (when the API/endpoint stops accepting traffic;
  mandatory; surface warning if less than 6 months out)
- **Migration path** (which new endpoint/version to use; required
  for non-trivial deprecations)
- **Communication plan** (how clients are notified — header
  warnings, email, status page, dev portal)

### Phase 3: contract markup

For OpenAPI: add `deprecated: true` on operations / version-level
extension.

For GraphQL: `@deprecated(reason: "Use newField. Sunset:
YYYY-MM-DD")`.

For gRPC: comment on RPC + `option deprecated = true;`.

For AsyncAPI: `deprecated: true` on channels / messages.

### Phase 4: sunset header pattern (REST)

For REST APIs, document the runtime deprecation signaling:

```
Sunset: <RFC-7231 date>
Deprecation: <RFC-9745 date>
Link: <migration-doc-url>; rel="deprecation"; type="text/html"
```

The contract file documents these as expected response headers
on deprecated endpoints. Implementation is the team's job; the
contract specifies the convention.

### Phase 5: ADR for sunset

If the sunset has material consequences (forced client migrations,
breaking changes on a public API), surface:

> Deprecating <api-name> v1 with sunset YYYY-MM-DD has material
> consequences. Recommend documenting via ADR. Run
> /engineer:architecture:decisions:propose "Sunset of <api-name> v1 by
> YYYY-MM-DD" --tags api,deprecation? [y/N]

## Action: review

Audits an existing contract against design principles and
project conventions.

Checks:

1. **Versioning consistency** — all endpoints in the version
   share style; no half-migrated state
2. **Authentication consistency** — every endpoint declares
   auth requirements (or explicitly opts out via convention)
3. **Tenant scoping** (multi-tenant projects) — tenant
   identification is consistent across endpoints
4. **Schema reuse** — no duplicate shape definitions; shared
   schemas in `components/schemas` (or equivalent)
5. **Pagination** — list-returning endpoints have pagination
   support
6. **Idempotency** — non-GET endpoints document idempotency
   semantics
7. **Error shape** — error responses follow a consistent
   structure (status code conventions, error body shape)
8. **Naming conventions** — paths/fields follow project
   conventions (kebab/camel/snake case consistency)
9. **Deprecation hygiene** — deprecated elements have sunset
   dates; sunset dates aren't past
10. **ADR coverage** — material API decisions are backed by ADRs

Output a structured report at
`design/api-contracts/<api-name>-review-<YYYY-MM-DD>.md` with
findings classified by severity (info / warn / fail).

## Phase 7: cross-namespace effects

API design intersects with other namespaces:

- **`product/design/`** — API responses inform UI patterns (list view
  pagination matches API pagination; detail view matches API
  resource shape)
- **`frameworks/heroui/build-components`** — typed React data fetching
  hooks generated from contracts (when the build pipeline
  includes contract-to-types codegen)
- **`engineer/maintenance/upgrades:npm-deps`** — peer dependency
  awareness for OpenAPI generators / GraphQL codegens
- **`marketing:pr:journalist-outreach`** — public API releases
  may warrant press; surface for major versions

## What this command does NOT do

- **Generate server or client implementations.** Skillz produces
  contracts; codegen and implementation are the team's job using
  tools like openapi-generator, graphql-codegen, protoc, etc.
- **Test the contract.** Contract testing (Pact, Spectral, etc.)
  is a separate concern handled in CI.
- **Auto-detect breaking changes.** The command structures the
  inventory but the user identifies what's breaking. Tools like
  `oasdiff` can be invoked alongside but aren't internal to this
  command.
- **Manage the runtime.** Header injection, traffic shaping for
  deprecations, auth enforcement — all runtime concerns owned by
  the implementation, not the contract.

## Examples

```bash
# First REST contract for the SkoolScout API
/engineer:architecture:api-design design skoolscout-api --style rest

# Cut v2 of an existing API
/engineer:architecture:api-design version skoolscout-api --version v2

# Deprecate v1 with a sunset date
/engineer:architecture:api-design deprecate skoolscout-api --version v1

# Review an existing contract for principle adherence
/engineer:architecture:api-design review skoolscout-api
```

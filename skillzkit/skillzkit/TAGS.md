# Tags

Tags are **orthogonal discovery metadata** for skillzkit artifacts. They
let you find work across persona and topic boundaries — e.g., "show me
everything related to accessibility" pulls hits from
`product:design:foundations:*`, `product:ux:journeys:*`, and
`engineer:architecture:*` simultaneously, regardless of where each
artifact lives in the persona tree.

**Tags are NOT a routing mechanism.** The persona routers
(`skillzkit-product-router`, etc.) still match strictly on the slug's
path prefix. A command tagged `accessibility` on a `product:*` path is
discoverable by an engineer searching the catalog, but the engineer
router will not fire it. Engineers needing similar work author their
own engineer-flavored version. Tags surface references; they don't
abstract artifacts.

## How to apply tags

Add a `tags:` array to the artifact's frontmatter:

```yaml
---
description: Map customer journey with pain-point overlay
tags: [research, discovery, accessibility]
---
```

Both YAML array form and comma-separated string form are accepted by
the loader (`tags: [foo, bar]` or `tags: "foo, bar"`).

## Two-tier governance

Tags follow a two-tier model to balance free expression with vocabulary
hygiene:

- **Core tags** (listed below) — curated, allowed freely. Use these
  whenever a candidate fits.
- **Extension tags** — any other tag matching the format rules. Allowed,
  but flagged at info-level by `skillzkit doctor` so drift is visible.
  Frequently-used extensions become candidates for promotion into core
  via PR.

## Format rules

Enforced by `skillzkit doctor`. Violations are errors.

- Lowercase only: `accessibility`, not `Accessibility`
- Hyphenated for multi-word: `design-system`, not `design_system` or `designSystem`
- ASCII letters, digits, hyphens only: `[a-z0-9-]+`
- Max length 24 characters
- Must start with a letter

## Core tags

Each core tag below carries a one-line definition and the kinds of
artifacts where it's appropriate. The core list is deliberately small;
the bar for entry is **evidence of cross-persona use** AND **durable
meaning** (survives 6+ months without rot).

### `research`
Discovery via interviews, audits, postmortems, dependency analysis,
content research. Use on artifacts whose primary work is
information-gathering, not synthesis or production.
*Example surfaces:* `product:ux:personas:*`, `engineer:maintenance:*` audits, `market:strategy:*` audience work.

### `accessibility`
WCAG / inclusive-design concerns across visual design, code, and
content. Use on artifacts that produce, audit, or remediate
accessibility properties.
*Example surfaces:* `product:design:foundations:*`, `engineer:maintenance:remediate-*`, `market:tone:*` (readability).

### `security`
Authentication, secrets handling, vulnerability mitigation, secure
patterns. Use on artifacts whose output materially affects the security
posture of the system.
*Example surfaces:* `engineer:architecture:*` (auth/auth-z), `core:integrations:*` (credentials), `core:tools:*` (secrets management).

### `migration`
Version upgrades, structural transitions, data migrations,
design-system migrations. Use on artifacts whose primary verb is
"transition from X to Y."
*Example surfaces:* `engineer:maintenance:*` (npm/maven/gradle), `core:tools:*` (migrate-to-vN), `product:design:*` (figma → code roundtrip).

### `brand`
Voice, identity, and stylistic expression across copy and design. Use
on artifacts that establish, refine, or test brand attributes.
*Example surfaces:* `market:tone:*`, `product:strategy:editorial`, `product:design:foundations:typography`.

### `onboarding`
First-run experiences across product UX, developer environment setup,
contributor flows. Use on artifacts whose audience is "someone new to
this surface."
*Example surfaces:* `product:design:templates:onboarding`, `core:tools:setup`, `market:email:welcome`.

### `documentation`
Long-lived knowledge artifacts — ADRs, design briefs, runbooks,
specifications. Use on artifacts whose output is itself a document
intended to outlive the moment.
*Example surfaces:* `engineer:architecture:adr-*`, `product:strategy:scaffold`, `market:pr:newsroom`.

## Extension tags

Anything not in the core list above is an extension tag. Allowed —
doctor reports them at info level so we can see what's accumulating.
Promotion criteria for moving an extension into core:

1. Used on artifacts in **at least 2 personas** (the cross-cutting bar)
2. Used on **5+ artifacts** total (signal, not noise)
3. The concept is **durable** (still meaningful 6+ months from now)
4. The concept is **specific** enough to be selectively useful — tags
   that would apply to "almost everything" (like `review` or `content`)
   are rejected even if they pass the count thresholds

Open a PR adding the tag to the Core section with definition and
example surfaces.

## Anti-patterns

Don't use tags for any of these — they have better-fitting mechanisms:

- **Persona membership**: use the path. A `product:*` artifact does
  not need a `product` tag.
- **Routing**: routers match path prefix only. Adding `engineer` as a
  tag on a `product:*` artifact will not make the engineer router fire
  it.
- **Status / lifecycle** (`draft`, `deprecated`, etc.): use frontmatter
  fields, not tags.
- **Authorship** (`team-x`, `daisy`): irrelevant to discovery.
- **Substitutes for descriptions**: tags supplement description, not
  replace it.

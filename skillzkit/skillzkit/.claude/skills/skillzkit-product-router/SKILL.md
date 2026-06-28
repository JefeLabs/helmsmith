---
name: skillzkit-product-router
description: Route product, design, and UX intent to the right slash command in the skillzkit suite. Fires when the user wants to define personas, capture jobs-to-be-done, map customer journeys or user flows, write user stories, build or slice a story map, draft a design brief, scaffold a design system, generate design foundations (colors, typography, spacing, motion, icons, grids, a11y), generate UI patterns (hero, CTA, FAQ, pricing, testimonial, footer), generate page templates (landing, dashboard, list, detail, settings, auth, onboarding, marketing), explore wireframes, extract design tokens from a screenshot or URL, set editorial or SEO strategy, run greenfield / brownfield / migrate-from-figma / figma-roundtrip workflows, or work with .pen files. Prefer this router over engineer/market/tools/integrations when the verb is design, persona, journey, story, brief, scaffold, foundation, pattern, template, or token.
---

# skillzkit-product-router

Routes natural-language intent in the **product layer** —
strategy, design, UX — to the correct slash command.

## In scope

- **`product/strategy/`** — design briefs, scaffolding,
  research, editorial style, SEO, token extraction, brand
  workflows
- **`product/design/`** — `.pen` file design work,
  foundations, patterns, templates, design exploration
- **`product/ux/`** — personas, journeys, stories, story maps

## Out of scope

- Architecture, ADRs, dependency upgrades, code remediation →
  `skillzkit-engineer-router`
- Marketing copy, ads, social posts, email, PR →
  `skillzkit-market-router`
- Build tools, linters, browser automation, image diffing →
  `skillzkit-tools-router`
- External services (Jira, Figma, GitHub, etc.) →
  `skillzkit-integrations-router`
- HeroUI v3 component generation, Storybook stories — no
  router; invoke `/core:frameworks:heroui:*` or
  `/core:frameworks:storybook:*` directly. The product router may
  *recommend* these when generation hands off to code.

## Routing decision rules

### Action vs question

If the user is **asking about** something, answer directly:

- "What's a JTBD statement?" → answer; don't invoke
  `personas:define-jtbd`.
- "Why do we use story maps?" → answer; don't invoke
  `story-maps:build`.

If the user is **asking to do** something, route:

- "Define a JTBD persona for school administrators" → route.
- "Build a story map for invoicing" → route.

### Tense awareness

- Past tense ("I built the persona, what's next?") → suggest
  next-step command; do not re-run.
- Present-progressive on someone else's work → answer; do not
  invoke.
- Imperative / future ("let's define X", "I want to map Y") →
  route.

### Show reasoning briefly

When picking a command, name it and say one sentence about why
before invoking. Example: "Routing to `journeys:map` — you
said 'map', and you haven't specified a type yet, so I'll
prompt for customer-journey vs user-flow vs service-blueprint
inside the command."

### Manifest awareness

When the user references "the X for Y" (e.g., "the persona for
school admins", "the story map for onboarding"), read
`product/.pencil-ux.json` for UX artifacts or
`product/.pencil-design.json` for design artifacts and find a
matching ID before asking the user to specify. Only ask if
there's no match or multiple plausible matches.

### Confirmation before high-stakes

Confirm before any of these (they rewrite generated files or
run for many minutes):

- `/product:strategy:scaffold` — full design system
  regeneration
- `/product:strategy:migrate` — version migration of `.pen`
  files
- `/product:strategy:remove` — delete patterns / templates /
  components
- `/product:strategy:re-recommend` — overwrites recommendation
  manifests
- `/product:design:diff`,
  `/product:design:bootstrap-from-existing` — large-scope reads
- Any `/product:strategy:workflows:*` — long-running

For low-stakes commands (single-file pattern or template
generation, persona definition, story write), just invoke.

### Override is cheap

If the user says "actually do X instead", drop the in-flight
choice and route to X. Don't restart.

---

## Command catalog

### `product/strategy/`

| Command                                | Triggers when user wants…                                      |
| -------------------------------------- | -------------------------------------------------------------- |
| `/product:strategy:brief`              | A design brief — goal, inputs needed, expected outcomes        |
| `/product:strategy:scaffold`           | Full design-system generation (research → foundations → templates) |
| `/product:strategy:research`           | Industry / competitor / trend research                         |
| `/product:strategy:editorial`          | Establish or audit editorial style                             |
| `/product:strategy:seo`                | Establish, bootstrap, or audit SEO + AIO strategy              |
| `/product:strategy:tokens-from`        | Extract design tokens from a screenshot, URL, or Figma file    |
| `/product:strategy:user-stories`       | Derive formal user stories from a brief                        |
| `/product:strategy:re-recommend`       | Re-run patterns:select and templates:select after research     |
| `/product:strategy:migrate`            | Migrate Pencil-managed project from one suite version to another |
| `/product:strategy:remove`             | Remove or deprecate a pattern / template / component           |
| `/product:strategy:ci`                 | Reference for wiring Pencil into CI                            |
| `/product:strategy:constrained-mode`   | Setup guide for locked-down corporate environments             |

### `product/design/`

`.pen` files are encrypted; never read with `Read` or `Grep`.
All access is via `/core:tools:pencil-mcp` or `/core:tools:open-pencil`.

| Command                                       | Triggers when user wants…                                          |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `/product:design:explore`                     | N structurally-different low-fi wireframes for a story             |
| `/product:design:design-page`                 | Direction-evaluation file or a finished page                       |
| `/product:design:diff`                        | Visual diff between two `.pen` versions                            |
| `/product:design:bootstrap-from-existing`     | Capture an existing product's design state into Pencil             |
| `/product:design:export`                      | Export `.pen` → Figma / static HTML / prod assets                  |

**Foundations** (`/product:design:foundations:*`) — each
generates one page in the foundations file. Slugs:
`colors`, `colors-select`, `typography`, `fonts-select`,
`spaces`, `grids`, `icons`, `icons-select`, `logos`,
`imagery`, `imagery-select`, `motion`, `density`, `a11y`,
`i18n`, `z-index`. The `*-select` variants explore N
candidates and pick.

**Patterns** (`/product:design:patterns:*`) — each generates
one pattern page. Slugs: `select` (recommend from research),
`hero`, `cta`, `faq`, `feature-grid`, `pricing-tier`,
`testimonial`, `banner`, `footer`, `stat-section`, `states`
(empty / loading / error / optimistic).

**Templates** (`/product:design:templates:*`) — each generates
one page template. Slugs: `select` (recommend from research),
`landing-page`, `dashboard`, `list`, `detail`, `settings`,
`profile`, `auth`, `onboarding`, `pricing`, `marketing`,
`legal`, `error-page`, `confirmation`, `documentation`,
`newsroom`.

### `product/ux/`

| Command                                  | Triggers when user wants…                                  |
| ---------------------------------------- | ---------------------------------------------------------- |
| `/product:ux:personas:define`            | Traditional persona — role, demographics, goals            |
| `/product:ux:personas:define-jtbd`       | JTBD statements (when / I want / so I can)                 |
| `/product:ux:personas:list`              | List personas in the UX manifest                           |
| `/product:ux:journeys:map`               | Map a journey (type required: see disambig below)          |
| `/product:ux:journeys:list`              | List journeys                                              |
| `/product:ux:journeys:pain-points`       | Query pain-point registry (severity, persona, status)      |
| `/product:ux:stories:write`              | Create a user story (as a / I want / so that)              |
| `/product:ux:stories:acceptance-criteria`| Add or refine acceptance criteria (Given / When / Then)    |
| `/product:ux:stories:list`               | List user stories                                          |
| `/product:ux:story-maps:build`           | Build a story map (anchor → backbone → stories)            |
| `/product:ux:story-maps:slice`           | Define release slices (v1.1, v1.2…) on existing map        |
| `/product:ux:story-maps:list`            | List story maps                                            |

**Persona disambig** — keywords "user profile / demographics"
→ `define`; keywords "jobs / outcomes / when X" →
`define-jtbd`; unclear → ask. Both can target the same
persona to make a hybrid.

**Journey disambig** — `journeys:map` requires a type.
Confirm before invoking: **customer-journey** (marketing arc),
**user-flow** (in-product task), or **service-blueprint**
(front-stage + back-stage + supporting systems).

### Workflows

Invoke through `/core:workflows:manage start <domain>:<slug>`.
Strategy slugs (`product:`): `greenfield`, `brownfield-add-feature`,
`brownfield-improve-page`, `brownfield-improve-story`,
`brand-refresh`. Design slugs (`design:`): `migrate-to-pencil`,
`migrate-from-figma`, `figma-roundtrip`. Workflow vs single command: use a workflow
when the task spans days or sessions and you want progress to
persist in `product/.pencil-workflow-state.json`.

---

## Cross-router handoffs

### To `skillzkit-integrations-router`

After a story or story-map slice is finalized:

- "Push these stories to Jira" → integrations-router
- "Open GitHub issues from this slice" → integrations-router
- "Sync the journey to a Confluence page" → integrations-router

For Figma round-trip flows, the workflow command stays here
(`design:figma-roundtrip`); read/write of the Figma file goes
through integrations-router.

### To `skillzkit-engineer-router`

Capability planning starts here (story, story-map, slice) and
hands off to engineering once the shape is known:

- "We have the slice, now plan the architecture" →
  `engineer:capability-introduction`

### To `skillzkit-market-router`

Persona-targeted campaigns reference personas defined here.
The persona-creation step itself stays in this router.

### To `skillzkit-tools-router`

Low-level Pencil operations route to tools-router:

- Open `.pen` in desktop app → `/core:tools:open-pencil`
- Query Pencil MCP for components / styles / layouts →
  `/core:tools:pencil-mcp`

### To non-routed namespaces

- **`/core:frameworks:heroui:build-components`** — convert a
  finished `.pen` template into HeroUI v3 React components.
- **`/core:frameworks:storybook:*`** — generate or verify
  Storybook stories for produced components.

Mention these explicitly when intent is clearly framework-level.

---

## Anti-patterns

- Match keywords without checking tense (past-tense ≠ command).
- Invoke `scaffold`, `migrate`, or `brand-refresh` without
  confirmation (they rewrite large parts of the project).
- Pretend commands exist that don't (e.g. there is no
  "navigation pattern" — that lives in templates / foundations).
- Chain commands silently (persona → stories → story-map
  without asking).
- Route past-tense or question intent ("what did the
  greenfield workflow do?" is a question).
- Guess the journey type — always confirm
  customer-journey vs user-flow vs service-blueprint.
- Skip manifest lookup when the user says "the X for Y".
- Auto-invoke `/core:frameworks:*` from this router — hand off
  explicitly.
# skillzkit — Executive Overview

## What it is

**skillzkit** is a curated catalog of slash commands, agent skills, and
multi-phase workflows for [Claude Code](https://claude.com/claude-code)
and the [AgentX](https://github.com/ecruz165/agentx-platform) platform —
opinionated playbooks for product, engineering, and marketing work,
organized as installable artifacts a project can pull selectively.

Think of it as **a package manager for agent capabilities**. Where npm
installs JavaScript libraries, skillzkit installs the prompts, routers,
and structured workflows that let an AI agent perform high-leverage
domain work consistently across teams and projects.

## Why it exists

Teams adopting AI-driven development run into the same three problems:

1. **Inconsistent agent outputs** — every developer prompts the model
   slightly differently. Outputs drift. Quality varies. Knowledge stays
   tribal.
2. **Knowledge isn't reusable** — a great prompt one engineer wrote for
   "draft an ADR" never makes it to the rest of the team. The pattern
   has to be rediscovered every time.
3. **Best practices aren't enforceable** — even with a wiki of "good
   prompts," nothing connects them to where work actually happens.
   Adoption stays low.

skillzkit solves these by making expert prompts and multi-step
workflows **first-class artifacts**: versioned, browsable, installable,
discoverable across persona and topic boundaries. A team's accumulated
knowledge becomes a shared, queryable catalog instead of a folder of
markdown files no one reads.

## What's in the catalog today

| Category | Count | Examples |
|---|---|---|
| **Commands** (single-shot tasks) | 183 | `/product:strategy:scaffold`, `/core:tools:setup`, `/market:pr:press-release` |
| **Workflows** (multi-phase orchestrators with persistent state) | 18 | `product:greenfield`, `engineer:adr-cycle`, `market:launch-campaign` |
| **Skills** (agent-facing routers + meta-skills) | 7 | `skillzkit-product-router`, `skillzkit-suggest-next` |

Organized across four personas:

- **Product** — strategy, design, UX research (personas, journeys, story maps, design briefs, foundations, patterns, page templates)
- **Engineer** — architecture (ADRs, diagrams, data models, API contracts) and maintenance (dep upgrades, component remediation)
- **Market** — brand voice, email, ad copy, organic social, PR, campaign coordination
- **Core** — persona-agnostic infrastructure (tools, integrations, frameworks, audit, workflows)

## Two deployment modes

skillzkit ships in two modes — pick the one that matches your team's
needs.

### Standalone mode

The default. The catalog is bundled with the npm package; the user
installs skillzkit globally and the CLI/TUI work entirely offline.
**Best for:** individual developers, teams that don't need shared
authoring, anyone who just wants the curated catalog locally.

### Team mode

The catalog lives in a centralized **skillzkit API** deployed alongside
your AgentX controlplane (or as a serverless function on AWS Lambda).
The CLI/TUI on each user's machine fetches from the shared catalog;
new contributions are submitted via API and validated server-side.
**Best for:** teams growing their own playbook, organizations that
want a single source of truth, anyone who needs an audit trail of
who-contributed-what-when.

## Integration with agentx-platform

When deployed in team mode, skillzkit integrates with the broader
AgentX platform:

- **Authentication** is handled by `@helmsmith/agent-auth` — the same
  credential broker the rest of the platform uses. skillzkit never
  manages user identity directly.
- **Optional agent-driven contribution review** routes through
  `@helmsmith/agent-adapter`. Quality, tag-fit, and safety checks are
  performed by whichever LLM provider your controlplane is configured
  to use (Claude, OpenAI, local Qwen via Ollama). The skillzkit API
  doesn't hold provider keys directly — the platform's binding
  resolver does.
- **Hosting** alongside the controlplane in docker-compose is the
  primary deployment pattern; controlplane reverse-proxies
  `/api/skillz/*` to the skillzkit container on a sibling network.

## Outcomes

Teams that adopt skillzkit consistently report:

- **Faster onboarding** — new hires browse the catalog instead of
  asking "what's the right prompt for X?"
- **Higher floor on output quality** — codified workflows replace
  ad-hoc prompting. Every developer's outputs converge toward the
  team's curated standard.
- **Knowledge captured at the moment of insight** — when someone
  invents a great workflow, contributing it back to the catalog takes
  minutes, not days. It's immediately discoverable.
- **Consistent voice and conventions** — marketing brand voice, ADR
  templates, design foundations all express the same set of
  organizational standards because they're all driven by the same
  catalog.

## Where to start

- **Individual / personal use** → see [getting-started-standalone-mode.md](getting-started-standalone-mode.md)
- **Team / shared catalog** → see [getting-started-team-mode.md](getting-started-team-mode.md)
- **Architecture deep-dive** → see [architecture.md](architecture.md)
- **Full feature list** → see [feature-overview.md](feature-overview.md)

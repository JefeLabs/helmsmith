# skillzkit

A catalog of slash commands, agent skills, and multi-phase workflows
for [Claude Code](https://claude.com/claude-code) and the AgentX
platform — opinionated playbooks for product, engineering, and
marketing work, organized as installable artifacts a project can pull
selectively.

## Install

```bash
npm install -g @ecruz165/skillzkit
```

In a fresh project:

```bash
# Install everything
skillzkit install

# Install just what you need (with transitive workflow deps)
skillzkit install product:strategy:scaffold
skillzkit install core:tools:*
skillzkit install engineer
```

Either form drops a `.claude/` directory into the target with the
appropriate commands and skills, plus stub manifests for any picked
tools/integrations under `product/.pencil-*.json`.

## What's in the catalog

- **Commands** (183) — single-shot slash commands, e.g.
  `/product:strategy:scaffold`, `/core:tools:setup`,
  `/market:pr:press-release`. Each is a markdown file; the agent
  reads the body when the command is invoked.
- **Workflows** (18) — multi-phase orchestrators with persistent
  state, e.g. `product:greenfield`, `engineer:adr-cycle`,
  `market:launch-campaign`. Run via
  `/core:workflows:manage start <name>`.
- **Skills** (7) — agent-facing routers and meta-skills that fire on
  intent. Includes the four persona routers
  (`skillzkit-product-router`, etc.), `skillzkit-suggest-next`
  (graph-driven "what should I do next"), and `skillzkit-author`
  (scaffolds new commands/workflows for upstream contribution).

Run `skillzkit list --tree` for a hierarchical overview.

## CLI reference

```
skillzkit <subcommand>
```

| Subcommand | What it does |
|---|---|
| `install [...slugs]` | Install the kit, or specific slugs + transitive deps. Accepts bare personas (`product`), wildcards (`core:tools:*`), exact slugs, or skill names. `--dry-run`, `--force`, `--target <dir>`. |
| `list` | Flat catalog list. `--tree` for hierarchical render. `--commands`, `--skills`, `--workflows` to filter. |
| `search <query>` | Substring match across slug, name, and description. `--limit <n>`. |
| `show <slug>` | Print the full body of a command, skill, or workflow. |
| `suggest <slug>` | Suggest next tasks/workflows after completing the given slug. Optional `--state <path>` for active-workflow signal. `--limit <n>`. |
| `doctor` | Health-check the kit — broken references, orphan files, frontmatter completeness, prerequisite resolution. Use `--errors-only` for CI. |
| `ui` | Launch the interactive TUI installer (Bun-based). |
| `version` | Print package version. |

## Cascade rules (how `install` resolves transitive deps)

When you install a slug, the resolver walks `references[]` according
to the kind of seed:

- **Skill seed** — walks all refs unconditionally. Skills' refs are
  the commands they route to.
- **Workflow seed** — walks non-`core:*` refs; only propagates further
  through other workflows. Tools and integrations cited in a workflow
  body are documentation, not auto-pulled.
- **Command seed** — no cascade. A command body that mentions other
  commands is prose, not runtime dependency.

Plus, every install always copies: audit dispatcher, workflow state
machine, all skills, top-level `_context.md`, and stubs the runtime
manifests for any picked tools/integrations.

## The dependency graph

The catalog (`catalog.json`) carries a forward-edge index
(`references[]` per item) and a precomputed reverse-edge index
(`referencedBy[]`). Both are used:

- **`install`** uses forward edges to compute transitive deps.
- **`suggest`** uses reverse edges + the active-workflow state file
  to surface "what builds on what you just did" or "what's the next
  step in your active workflow."
- **`doctor`** cross-checks references against the catalog to find
  silent typos and orphan files.

## Contributing

To add a new command or workflow to the kit, fire the
`skillzkit-author` skill — it walks namespace selection, frontmatter
conventions, body draft, validation, catalog regeneration, then
offers an opt-in branch + commit + push + `gh pr create` step.

Manual flow:

```bash
git clone https://github.com/ecruz165/agentx-skillzkit
cd agentx-skillzkit
git checkout -b feat/<persona>-<slug>
# author .claude/commands/<path>.md
npm run catalog          # regenerate index
npm test                 # run the test suite
skillzkit doctor         # validate references, frontmatter, etc.
git add . && git commit
gh pr create
```

Skills are maintainer-authored — open an issue to propose one.

## Architecture

Top-level orientation in
[`.claude/commands/_context.md`](.claude/commands/_context.md). Per-namespace
context files live alongside the commands. The `skillzkit-author`
SKILL body documents the kit's structural conventions in detail.

Source organization:

```
.claude/commands/        slash commands (organized by persona)
.claude/skills/          agent-facing routers + meta-skills
lib/                     catalog generator, install primitive,
                         suggest engine, doctor, types
bin/cli.ts               CLI entry point
tui/                     Bun-based interactive installer
catalog.json             generated index of everything above
```

## Development

```bash
npm install
npm run catalog          # regenerate catalog.json
npm test                 # run the test suite (vitest)
npm run test:watch       # watch mode
npm run build            # catalog + tsc to dist/
```

## License

UNLICENSED — internal AgentX use.

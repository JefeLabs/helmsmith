# Getting Started — Standalone Mode

Standalone mode is the simplest way to use skillzkit. The catalog is
bundled with the npm package; everything runs locally on your machine.
No server, no API, no shared infrastructure required.

This guide takes you from zero to actively using the catalog in about
5 minutes.

## Prerequisites

- **Node.js ≥ 20**. Check with `node --version`.
- A project where you want to install Claude Code slash commands +
  skills. Any directory works.

That's it. Bun is bundled inside the npm package for the TUI — you
don't need to install it separately.

## 1. Install

```bash
npm install -g @agentx/skillzkit
```

Verify the install:

```bash
skillzkit version
# 0.1.0

skillzkit list --commands | head
# === Commands (183) ===
#   /core:audit:_index  —  ...
#   /core:audit:run     —  ...
#   ...
```

## 2. First-run setup

```bash
skillzkit init
```

This walks you through a one-time setup. Two questions:

```
Mode? (1) standalone — use bundled skills  (2) team — connect to a shared API: 1
Email: you@example.com
```

Pick `1` for standalone mode. The email is used for authoring
attribution if you contribute new artifacts later (and would match
your controlplane identity if you ever switch to team mode).

You'll see:

```
✓ Created /Users/you/.agentx/skillzkit/config.json

Mode: standalone (using bundled skills)
Next:
  skillzkit list                  — browse the catalog
  skillzkit ui                    — interactive picker
  skillzkit install <slug>        — install a slug into your project
```

The config file mode is `0600` — only readable by you.

## 3. Browse the catalog

### Quick textual list

```bash
skillzkit list                       # everything
skillzkit list --tree                # hierarchical render
skillzkit list --tag accessibility   # filter by tag
```

### Search

```bash
skillzkit search migration
skillzkit search "press release"
```

### Interactive picker

```bash
skillzkit ui
```

You'll get a full-screen TUI. Navigate with arrow keys (or `j`/`k`),
toggle items with `space`, copy a slug to clipboard with `c` or `y`,
press `enter` on the **Install** button to apply, or `q` to quit.

## 4. Install commands into a project

Pick the artifacts you want available as Claude Code slash commands in
a specific project, then install them.

```bash
cd /path/to/your/project
skillzkit install core:tools:setup
```

This drops a `.claude/` directory into your project containing the
slash command(s) you picked, plus always-installed infrastructure
(the audit dispatcher, workflow state machine, all skills, top-level
context, and runtime manifests).

To preview what would be installed without writing files:

```bash
skillzkit install engineer --dry-run
```

To install a whole persona:

```bash
skillzkit install product
```

To install with wildcard:

```bash
skillzkit install core:tools:*
```

To overwrite existing files:

```bash
skillzkit install core:tools:* --force
```

## 5. Use the skills in Claude Code

After install, the artifacts are available wherever Claude Code
operates against `.claude/`:

- **Slash commands**: type `/` in Claude Code and the catalog's
  commands appear. E.g., `/core:tools:biome` runs the biome
  remediation flow.
- **Skills** fire automatically based on intent. For example, if you
  describe a marketing task, `skillzkit-market-router` will surface
  the right slash command without you needing to remember it.
- **Workflows** are multi-phase orchestrators. Run them via
  `/core:workflows:manage start <workflow-name>`, e.g.
  `/core:workflows:manage start product:greenfield`.

## 6. Suggest what to do next

After completing a slash command, ask the catalog what builds on it:

```bash
skillzkit suggest product:strategy:scaffold
```

Or just ask the agent — the `skillzkit-suggest-next` skill responds to
queries like "what should I do after running X?".

## 7. Health-check your install

```bash
skillzkit doctor
```

Reports broken references, orphan files, frontmatter completeness,
prerequisites that don't resolve, and tag drift. Use `--errors-only`
in CI to gate PRs.

## Common workflows

### Update an existing install

```bash
cd /path/to/your/project
skillzkit install --force            # overwrites with latest catalog
```

### Bring in just one new command

```bash
skillzkit install market:pr:press-release
# Always-installed infra is unchanged; the new command is added.
```

### Inspect a command before installing

```bash
skillzkit show product:greenfield
# prints the full markdown body
```

### Switch to a different target directory

```bash
skillzkit install engineer --target /path/to/other/project
```

## Authoring new artifacts (advanced)

In standalone mode, authoring happens locally — typically in a fork
of the skillzkit repo:

```bash
git clone https://github.com/ecruz165/agentx-toolbox
cd agentx-toolbox/apps/skillzkit
git checkout -b feat/my-thing

# Author a new command
# Create .claude/commands/<persona>/<topic>/my-thing.md with frontmatter:
# ---
# description: What this does
# tags: [research, accessibility]
# ---
# (markdown body...)

npm run catalog                      # regenerate catalog.json
npm test                             # run the test suite
skillzkit doctor                     # validate the new artifact
```

Or use the `skillzkit-author` agent skill — invoke it (the agent will
auto-route to it on intent) and it walks you through namespace
selection, frontmatter conventions, body draft, validation, and
optional PR creation.

For team-shared authoring, see
[getting-started-team-mode.md](getting-started-team-mode.md) — the
contribute API is built for that case.

## Troubleshooting

### "skillzkit: command not found"

The npm global bin directory isn't on your `PATH`. Either:
- Use `npx skillzkit ...` instead of bare `skillzkit`
- Add `$(npm bin -g)` to your shell's `PATH`

### "Could not resolve bundled Bun binary"

The `bun` package didn't install correctly. Try:
```bash
npm install -g @agentx/skillzkit --force
```

### TUI looks broken / colors weird

opentui requires a terminal that supports modern ANSI escape codes and
24-bit color. Most terminals (iTerm2, Kitty, Alacritty, modern macOS
Terminal, Windows Terminal) work. If you're in a constrained
environment (e.g., basic SSH session on a legacy server), use the
non-TUI commands (`skillzkit list`, `skillzkit search`) instead.

### Reset config

```bash
rm ~/.agentx/skillzkit/config.json
skillzkit init                       # fresh setup
```

Or update individual fields:

```bash
skillzkit config email new@example.com
```

### Where are the actual catalog files?

The bundled catalog lives inside the npm package itself — typically
at `$(npm prefix -g)/lib/node_modules/@agentx/skillzkit/`. The
`catalog.json` is the index; `.claude/commands/` and `.claude/skills/`
hold the source markdown.

## Next steps

- **Add the catalog to a project**: `skillzkit install <slug>` in any
  project root drops the picked artifacts into `.claude/`. From there,
  Claude Code surfaces them as slash commands and skills.
- **Try a workflow**: pick a multi-phase one. Workflows are the
  highest-leverage artifacts — they orchestrate decisions across
  multiple sessions with state.
- **Consider team mode** when more than one person needs to share a
  catalog or when you want centralized contribution review. See
  [getting-started-team-mode.md](getting-started-team-mode.md).

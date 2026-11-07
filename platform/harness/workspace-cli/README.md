# @helmsmith/workspace

The front door for setting up helmsmith project workspaces. Procure a fresh
project from the canonical `workspace-template`, with optional repo
clones and skillzkit catalog installs.

## Prerequisites

[Bun](https://bun.sh/) ≥ 1.0 must be on `PATH`. The interactive TUI uses
[OpenTUI](https://github.com/anomalyco/opentui) which depends on Bun's
native FFI — it cannot run on plain Node.js.

```sh
curl -fsSL https://bun.sh/install | bash
```

## Install

```sh
# One-shot via bunx (no install)
bunx @helmsmith/workspace setup my-project

# Or install globally and invoke directly
bun install -g @helmsmith/workspace
helmsmith-workspace setup my-project
```

## Quickstart

From a parent directory where you want the new workspace folder to land:

```sh
# Interactive — TUI walks you through the inputs
npx @helmsmith/workspace

# Scripted
npx @helmsmith/workspace setup my-project \
  --repos git@github.com:my-org/web.git git@github.com:my-org/api.git
```

Result: `./workspace-my-project/` with `.harness/` config, `.devcontainer/`
templates, and your repos cloned alongside.

## What you get

- `.harness/config/flows.json` — starter flow with planner, implementer,
  reviewer agents (in phases shorthand)
- `harness-workspace.yml` — workspace + product declaration
- `.devcontainer/` — DevContainer scaffolds for harness/memory/context servers
- Cloned repos into `<workspace>/<repo-name>/`
- A `<name>.code-workspace` file for VS Code multi-root opening

## Constraints

- Refuses to procure inside a git-managed directory (would either pollute
  the parent's working tree or create nested repos)
- Default destination: `./workspace-<name>` relative to the current
  working directory
- HTTPS clones use the env var named by `--token-env` (default: `GITHUB_TOKEN`);
  SSH clones use ssh-agent

## Documentation

- Flow Designer spec: `.plans/2026-05-07-prd-flow-designer.md` (pre-merge planning doc; not carried into this repo)
- Workspace template PRD: `.plans/2026-04-30-prd-workspace-template.md` (pre-merge planning doc; not carried into this repo)
- Source: [github.com/JefeLabs/helmsmith](https://github.com/JefeLabs/helmsmith/tree/main/platform/harness/workspace-cli)

## License

MIT — see [LICENSE](https://github.com/JefeLabs/helmsmith/blob/main/LICENSE).

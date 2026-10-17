---
"@helmsmith/workkit": minor
"@helmsmith/workbrokr": minor
---

First release of the work brokers. `@helmsmith/workkit` is the shared core (lease registry with atomic writes and a lock, per-project port ranges, slot allocation, manifest loading and validation, scope expansion and overlap, git operations, protected-branch and commons guards, hook installer, per-worktree config emitter, refresh runner, service runner with health polling and pid-scoped stop). `@helmsmith/workbrokr` ships the `work` CLI, MCP server and skill: `init`, `start`, `status`, `env`, `finish`, `reap`, `retire`, `audit`, `hook`, `hooks install`, `mcp`. One worktree per area, `<type>/<area>` branches, every effort synced from the base branch first, frontend work through storybrokr, fullstack work through the manifest's own commands.

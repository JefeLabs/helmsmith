---
"@helmsmith/pritty": minor
---

New config key `claude.strictMcpConfig` (default `true`). Set it to `false` where a managed (enterprise) Claude Code policy refuses `--strict-mcp-config`: the `claude` provider then runs without `--strict-mcp-config` and the empty `--mcp-config`, and the MCP servers that policy allows load as usual. Every other headless flag stays, so the repository's settings, hooks, CLAUDE.md and `.mcp.json` still never apply.

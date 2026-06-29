# 🎀 @jefelabs/pritty

**Pretty PRs, zero effort.** AI-powered CLI that categorizes staged
files by purpose, generates conventional commits, and creates pull
requests — with pluggable hooks and human-in-the-loop approval.

Part of the [agentx-toolbox](../..) monorepo. Auth + multi-agent
adapters live in shared packages (`@jefelabs/agent-auth`,
`@jefelabs/agent-adapter`) so pritty doesn't reinvent OAuth or LLM
provider routing.

## Status

This is a **phased build** following the
[implementation plan](../../../agentx-pritty/pritty-implementation-plan.md).

| Phase | Status |
|---|---|
| Auth (login / logout / status via `@jefelabs/agent-auth`) | ✅ |
| Config (.pritty.json + Zod schema) | ✅ |
| Categorizer (default + custom glob categories) | ✅ |
| `pritty init` starter config | ✅ |
| `pritty categorize` (read-only file bucketing) | ✅ |
| AI client (multi-provider via `@jefelabs/agent-adapter`) | ⏳ |
| `pritty commit` (per-category AI commit messages) | ⏳ |
| `pritty pr` (AI-generated PR title + body) | ⏳ |
| `pritty rebase` (AI-planned rebase) | ⏳ |
| Pre-commit / pre-push hook runner | ⏳ |
| Outlier detection + interactive resolution | ⏳ |

The unimplemented commands are wired as CLI stubs — they print a
"coming soon" message so users learn the surface exists.

## Quick start

```bash
pritty                                # shows command list (Commander default)
pritty auth login                     # GitHub Device Flow → ~/.pritty/auth.json
pritty auth status
pritty init                           # write .pritty.json with sane defaults
pritty categorize                     # show staged files grouped by category
pritty categorize --all               # include modified + untracked
```

## Programmatic API

```typescript
import {
  login, readAuth, logout,
  loadConfig,
  categorize, mergeCategories, DEFAULT_CATEGORIES,
} from "@jefelabs/pritty";

// Use pritty's primitives in other tools without spawning the CLI.
const config = loadConfig();
const buckets = categorize(["src/index.ts", "test/foo.test.ts"]);
```

## Configuration

`.pritty.json` (or `.prittyrc.yaml`, `pritty.config.json`, etc.) at
your repo root:

```json
{
  "model": "gpt-4o",
  "baseBranch": "main",
  "commitStyle": "conventional",
  "preCommit": ["eslint", "prettier"],
  "prePush": ["test"],
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**", "lib/**"],
    "infra": ["terraform/**", ".github/**"]
  }
}
```

**Tip on category ordering**: pritty uses *first-match-wins*, so put
specific categories (like `test`) before broad ones (like `app`)
when a file could match both — otherwise `src/foo.test.ts` lands in
`app` rather than `test`.

## Auth

Pritty's auth layer is a thin wrapper around `@jefelabs/agent-auth`:

- `pritty auth login` runs GitHub OAuth Device Flow with the public
  Copilot client ID. The token is persisted to `~/.pritty/auth.json`
  with mode 0600.
- `pritty auth status` reads the stored credentials and shows
  per-provider info (no token values are ever printed).
- `pritty auth logout` removes the file.

Override the storage path with `PRITTY_HOME=<dir>`. The same primitive
backs gittyup, future AgentX CLIs, etc. — change auth in one place,
every consumer inherits the change.

## AI providers

Default is **GitHub Copilot** via the device-flow login at
`~/.pritty/auth.json`. Pick a different primary or set up a fallback
chain in `.pritty.json`:

```jsonc
{
  "provider": "copilot",                    // default; or "anthropic" / "openai"
  "fallback": [],                           // empty by default — opt in here
  "anthropicKeyEnv": "ANTHROPIC_API_KEY",   // env var to read the key from
  "openaiKeyEnv": "OPENAI_API_KEY"          // (these are also the defaults)
}
```

Choosing a non-Copilot provider:

```jsonc
{ "provider": "anthropic" }    // requires ANTHROPIC_API_KEY in env
{ "provider": "openai" }       // requires OPENAI_API_KEY in env
```

Fallback chain — try primary, then walk `fallback` in order until one
is configured. This is opt-in (default `fallback: []` means "primary
or nothing"):

```jsonc
{
  "provider": "copilot",
  "fallback": ["anthropic", "openai"]
}
```

When nothing is configured pritty fails with a clear error naming
every provider tried and how to set each one up. Provider choice is
explicit — pritty doesn't auto-detect based on which env vars happen
to be present.

## Stack

Per [agentx-toolbox stack conventions](../../README.md):

- TypeScript ESM
- Commander.js for CLI parsing
- vitest for tests
- tsup for bundling
- chalk for colored output
- Zod for config validation
- minimatch for glob category matching

## Development

```bash
# from toolbox root:
npm install
npm test --workspace=@jefelabs/pritty
npm run build --workspace=@jefelabs/pritty

# from this directory:
npm test
npm run dev -- categorize --all   # tsx-driven dev mode
```

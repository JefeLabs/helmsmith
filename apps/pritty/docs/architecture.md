# pritty — Architecture

This document describes how pritty is organized internally — what
modules do what, how data flows through the tool, and how the shared
agentx-platform packages plug in.

## High-level view

```
                            ┌──────────────────────┐
                            │     pritty CLI        │
                            │   (Commander.js)      │
                            └──────────┬───────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                │                      │                      │
        ┌───────▼────────┐    ┌───────▼────────┐    ┌────────▼───────┐
        │  Auth          │    │  Config        │    │  Categorizer   │
        │  (auth.ts)     │    │  (config.ts)   │    │ (categorizer.ts)│
        │                │    │                │    │                │
        │  delegates to  │    │  Zod schema +  │    │  glob-based    │
        │  @helmsmith/    │    │  defaults +    │    │  first-match-  │
        │  agent-auth    │    │  cosmiconfig   │    │  wins bucketing│
        └───────┬────────┘    └────────────────┘    └────────────────┘
                │
                │ (auth tokens, ~/.pritty/auth.json)
                ▼
        ┌────────────────────────────────────────┐
        │  AI client (ai.ts)                     │
        │                                        │
        │  Multi-provider via                    │
        │  @helmsmith/agent-adapter               │
        │                                        │
        │  ┌──────────┐  ┌──────────┐  ┌──────┐ │
        │  │ Copilot  │  │ Claude   │  │OpenAI│ │
        │  └──────────┘  └──────────┘  └──────┘ │
        │                                        │
        │  Falls through `fallback` chain        │
        │  if primary unavailable                │
        └────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼──────┐ ┌─────▼──────┐ ┌────▼─────────┐
   │  commit   │ │     pr     │ │   rebase     │
   │  (planned)│ │  (planned) │ │  (planned)   │
   └───────────┘ └────────────┘ └──────────────┘
```

## Components

### CLI entry (`src/cli.ts`)

Commander.js-driven entry point that registers every subcommand:
`auth`, `init`, `categorize`, `commit`, `pr`, `rebase`. Unimplemented
commands are wired as stubs that print a "coming soon" message —
users discover the surface area before features land.

### Auth (`src/auth.ts`)

Thin wrapper around `@helmsmith/agent-auth`'s GitHub Device Flow
implementation. Three operations:

- `pritty auth login` — runs Device Flow, persists token to
  `~/.pritty/auth.json` with mode `0600`.
- `pritty auth status` — reads the stored credentials, prints
  per-provider info (no token values are ever printed).
- `pritty auth logout` — removes the file.

The same `@helmsmith/agent-auth` primitive backs the rest of the
AgentX ecosystem (skillzkit, future tools). Auth improvements ship
once and every consumer inherits them.

### Config (`src/config.ts`)

Zod-validated schema for `.pritty.json` (or `.prittyrc.yaml`,
`pritty.config.json` — anything cosmiconfig can find). Defaults are
sensible; overrides are validated at load time.

Schema shape (simplified):

```typescript
{
  model: string,                    // default: "gpt-4o"
  provider: "copilot" | "anthropic" | "openai",
  fallback: ProviderName[],         // default: []
  baseBranch: string,               // default: "main"
  commitStyle: "conventional",
  preCommit: string[],              // shell commands run before commit
  prePush: string[],
  categories: Record<string, string[]>,    // glob patterns per bucket
  anthropicKeyEnv: string,          // env var name to read key from
  openaiKeyEnv: string,
}
```

### Categorizer (`src/categorizer.ts`)

Buckets a list of file paths into named categories using
**first-match-wins** glob matching. Default categories cover most JS/TS
projects (`test`, `app`, `config`, `docs`, `assets`); custom categories
in config extend or override these.

```typescript
// First-match-wins is the key invariant — order matters in config:
{
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],   // checked first
    "app":  ["src/**", "lib/**"]              // catches everything else
  }
}
```

If `app` were checked first, `src/foo.test.ts` would wrongly land in
`app`. The categorizer warns about category ordering issues at config
load time.

### AI client (`src/ai.ts`, in progress)

Multi-provider LLM invocation routing through
`@helmsmith/agent-adapter`. Provider selection logic:

1. Try `config.provider` first
2. If unavailable (no auth, no key, network error) → walk
   `config.fallback` in order
3. If nothing succeeds → throw a structured error naming every
   provider tried and how to set each one up

The provider abstraction means downstream consumers (`commit`, `pr`,
`rebase`) call `ai.invoke({ system, user })` without knowing which
provider answered.

### Git interaction (`src/git.ts`)

Shells out to `git` for staged-file enumeration, branch detection, and
diff inspection. Pure read operations in the shipped categorizer
phase; planned phases (`commit`, `rebase`) add write operations
guarded by human approval.

### GitHub interaction (`src/github.ts`)

Octokit-driven GitHub API calls for PR creation, draft updates, and
metadata enrichment. Used by the planned `pritty pr` command.

### CODEOWNERS, ticket extraction, PR templates

Three small helpers (`codeowners.ts`, `ticket.ts`, `pr-template.ts`)
that the planned `pritty pr` command will use:

- `codeowners.ts` parses the repo's `CODEOWNERS` file to suggest
  reviewers based on which files the PR touches.
- `ticket.ts` extracts ticket references from branch names (e.g.,
  `feature/PROJ-123-thing` → `PROJ-123`) for PR body linking.
- `pr-template.ts` reads `.github/pull_request_template.md` and
  injects AI-generated content into placeholder sections.

## Data flow — categorize (shipped)

```
User: pritty categorize --all
   │
   ▼
src/cli.ts (Commander → categorize command)
   │
   ▼
src/git.ts: stagedFiles() OR allChangedFiles()
   │
   ▼
src/categorizer.ts: bucket files into categories
   │
   ▼
src/cli.ts: render output (chalk-colored, grouped by bucket)
```

No AI calls, no network. Pure local diff inspection + glob matching.

## Data flow — commit (planned)

```
User: pritty commit
   │
   ▼
src/git.ts: stagedFiles() + diff for each
   │
   ▼
src/categorizer.ts: bucket
   │
   ▼ (per category)
src/ai.ts: invoke({ system: "Generate conventional commit", user: diff })
   │
   ▼
TUI: present draft → user approves / edits / aborts
   │
   ▼
src/git.ts: git commit -m "<approved>" (per category, separately)
```

Each category produces its own commit. A commit-and-PR sequence
might end up with 3 commits ("test: …", "feat: …", "docs: …"), all
pushed to one PR.

## Data flow — pr (planned)

```
User: pritty pr
   │
   ▼
src/git.ts: list commits since baseBranch
   │
   ▼
src/ticket.ts: extract ticket from branch name
   │
   ▼
src/codeowners.ts: suggest reviewers from touched files
   │
   ▼
src/ai.ts: invoke({ system: "Draft PR body", user: commits + diff })
   │
   ▼
src/pr-template.ts: merge AI draft into .github/pull_request_template.md
   │
   ▼
TUI: present draft → user approves / edits / aborts
   │
   ▼
src/github.ts: octokit.pulls.create()
```

## Configuration model

### Local (per-repo)

`.pritty.json` (or any cosmiconfig-discovered name) at repo root:

```json
{
  "model": "gpt-4o",
  "baseBranch": "main",
  "commitStyle": "conventional",
  "provider": "copilot",
  "fallback": ["anthropic", "openai"],
  "preCommit": ["eslint", "prettier"],
  "prePush": ["test"],
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**", "lib/**"],
    "infra": ["terraform/**", ".github/**"]
  }
}
```

### Local (per-user)

`~/.pritty/auth.json` (mode `0600`) — written by `pritty auth login`,
read by every command that needs authenticated provider access.
Override location with `PRITTY_HOME=/path/to/dir`.

### Environment variables

| Var | Purpose |
|---|---|
| `PRITTY_HOME` | Override `~/.pritty/` root |
| `ANTHROPIC_API_KEY` | Read by Claude provider (default name; configurable via `anthropicKeyEnv`) |
| `OPENAI_API_KEY` | Read by OpenAI provider (default name) |

## Why these choices

### Why first-match-wins for categorization

It's predictable. Multi-match heuristics (longest pattern, most
specific glob) require contributors to reason about subtle precedence
rules; first-match-wins requires them to reason about config ordering,
which is visible. The tradeoff: contributors must put specific
patterns before broad ones — a one-time learning cost paid up front,
not every time they look at a config.

### Why GitHub Copilot is the default provider

Most AgentX users already have Copilot subscriptions through their
employers. Reusing the same Device Flow they're used to (and that
their IDE already uses) is the lowest-friction onboarding path.
Anthropic and OpenAI are first-class alternates for users with their
own API keys.

### Why a fallback chain instead of provider auto-detection

Provider choice is a deliberate decision with cost implications.
Auto-detecting based on which env vars happen to be set risks
silently using the more-expensive provider when the cheaper one is
unavailable (or vice versa). Explicit `provider` + opt-in `fallback`
keeps the user in control.

### Why phased shipping

The auth + config + categorizer slice is genuinely useful on its own
("show me which staged files are tests vs. app code") and shaped the
foundations the AI-driven commands depend on. Shipping each phase as
it lands keeps users learning the tool incrementally rather than
hitting a 100-line CLI on day one.

### Why human-in-the-loop everywhere

Generated commit messages are wrong sometimes. Generated PR
descriptions miss nuance sometimes. The cost of rejecting and
re-prompting is much lower than the cost of an automated bad commit
showing up in `git blame` six months later.

### Why a programmatic API alongside the CLI

Auth, config, and categorization are useful primitives outside the
specific "draft my PR" flow. Other AgentX tools that need to
"figure out which files are tests" or "load the user's pritty config"
should reuse pritty's primitives, not reimplement them.

## Repository layout

```
apps/pritty/
├── bin/
│   └── pritty.mjs              # Node shim that loads dist/index.js
├── src/
│   ├── cli.ts                  # Commander entry; registers all subcommands
│   ├── auth.ts                 # Auth wrappers (delegates to @helmsmith/agent-auth)
│   ├── config.ts               # Zod schema + cosmiconfig loader
│   ├── categorizer.ts          # First-match-wins glob bucketing
│   ├── ai.ts                   # Multi-provider LLM invocation
│   ├── git.ts                  # Local git ops (read-only in shipped phase)
│   ├── github.ts               # Octokit wrapper
│   ├── codeowners.ts           # CODEOWNERS parser
│   ├── ticket.ts               # Branch-name ticket extraction
│   ├── pr-template.ts          # PR template injection
│   ├── shell-aliases.ts        # Optional shell alias generation
│   ├── adapters/               # Provider-specific glue (delegates to agent-adapter)
│   ├── index.ts                # Programmatic API exports
│   └── *.test.ts               # vitest tests per module
├── dist/                       # tsup build output
└── docs/                       # this directory
```

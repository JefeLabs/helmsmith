# Getting Started — pritty

This guide takes you from zero to a working pritty install in about 5
minutes, then walks the shipped capabilities (auth, config, file
categorization). For features still in development, see the status
table in [executive-overview.md](executive-overview.md).

## Prerequisites

- **Node.js ≥ 20**. Check with `node --version`.
- A git repository to use pritty in (any project will do).
- (For the default Copilot provider) a GitHub account with access to
  Copilot, OR an Anthropic API key, OR an OpenAI API key.

## 1. Install

```bash
npm install -g @jefelabs/pritty
```

Verify:

```bash
pritty --version
# Should print the installed version
```

If you see "command not found", the npm global bin is not on your
`PATH`. Either add `$(npm bin -g)` to your shell PATH or use
`npx pritty …`.

## 2. Authenticate

The default provider is **GitHub Copilot** via Device Flow. If you
already use Copilot in your IDE, this should feel familiar.

```bash
pritty auth login
```

A code + URL is printed. In your browser:

1. Go to the URL
2. Enter the code
3. Authorize the app

The terminal automatically detects authorization and writes the token
to `~/.pritty/auth.json` with mode `0600` (only readable by you).

Verify:

```bash
pritty auth status
# ✓ logged in (provider: copilot)
```

### Alternative: use Anthropic or OpenAI

If you'd rather use Claude or GPT directly, skip Device Flow and set
an API key in your environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# OR
export OPENAI_API_KEY="sk-..."
```

Then in `.pritty.json` (created in the next step):

```json
{
  "provider": "anthropic"
}
```

Or:

```json
{
  "provider": "openai"
}
```

## 3. Configure your repo

Navigate to a git repository and run:

```bash
cd /path/to/your/project
pritty init
```

This writes `.pritty.json` with sensible defaults. Open it and adjust:

```json
{
  "model": "gpt-4o",
  "provider": "copilot",
  "fallback": [],
  "baseBranch": "main",
  "commitStyle": "conventional",
  "preCommit": [],
  "prePush": [],
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**", "lib/**"],
    "config": ["package.json", "tsconfig.json", ".eslintrc*"],
    "docs": ["*.md", "docs/**"]
  }
}
```

### Tune categories for your project

The default categories cover most JS/TS projects. If your project has
unusual patterns, customize:

```json
{
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
    "app": ["src/**", "lib/**"],
    "infra": ["terraform/**", ".github/**", "Dockerfile"],
    "mobile": ["ios/**", "android/**"],
    "docs": ["**/*.md", "docs/**"]
  }
}
```

**Critical**: order matters. pritty uses **first-match-wins** matching,
so put specific categories before broad ones. If `app` is checked
before `test`, then `src/foo.test.ts` lands in `app`.

### Commit `.pritty.json`

```bash
git add .pritty.json
git commit -m "chore: add pritty config"
```

Now teammates working on the same repo inherit your settings.

## 4. Try the shipped command — categorize

The first useful pritty command is `categorize`, which buckets your
files by category without touching git history. Read-only, safe to
run anywhere.

### Stage some files

```bash
git add src/components/Button.tsx src/components/Button.test.tsx tsconfig.json
```

### Inspect categorization

```bash
pritty categorize
```

Output:

```
Staged files (3):

test (1)
  src/components/Button.test.tsx

app (1)
  src/components/Button.tsx

config (1)
  tsconfig.json
```

### Include modified + untracked

```bash
pritty categorize --all
```

Useful for seeing the shape of your full working state before staging
anything.

### Use this to plan your commit shape

`pritty categorize --all` is informative on its own — it shows you
how many concerns are mixed in your working tree. If you see 5
categories with non-zero counts, you probably want to split into
multiple commits (eventually, `pritty commit` will do this
automatically; for now, do it manually based on the categorization
output).

## 5. Iterate on categories

If the default rules don't match your project, edit `.pritty.json`
and re-run `pritty categorize`. The categorizer is fast (no AI calls,
no network) so iteration cycles are instant.

### Example: a Storybook project

```json
{
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "stories": ["**/*.stories.*", ".storybook/**"],
    "app": ["src/**", "lib/**"],
    "config": ["package.json", "tsconfig.json", ".storybook/main.ts"],
    "docs": ["**/*.md"]
  }
}
```

After this change, `pritty categorize --all` shows stories as their
own bucket — and when `pritty commit` ships, story changes will be
committed separately from app changes.

### Example: a monorepo

```json
{
  "categories": {
    "test": ["**/*.test.*"],
    "frontend": ["apps/web/**", "packages/ui/**"],
    "backend": ["apps/api/**", "packages/db/**"],
    "infra": ["terraform/**", ".github/**"],
    "docs": ["**/*.md"]
  }
}
```

Buckets that map to your monorepo's actual structure produce more
meaningful commit splits than generic patterns.

## 6. (Coming soon) AI-generated commits

When `pritty commit` ships, the flow will be:

```bash
git add src/api/auth.ts src/api/auth.test.ts docs/auth.md
pritty commit
```

pritty will:

1. Categorize the staged files (auth.ts → app; auth.test.ts → test;
   auth.md → docs)
2. For each category, generate a Conventional Commit message via the
   configured AI provider
3. Show you each draft → you approve, edit, or skip
4. Commit each category separately

Output:

```
[1/3] feat(auth): add Device Flow login
        src/api/auth.ts
        Approve / edit / abort? [Y/e/n]: Y
        ✓ committed

[2/3] test(auth): cover login + logout paths
        src/api/auth.test.ts
        Approve / edit / abort? [Y/e/n]: Y
        ✓ committed

[3/3] docs: document the auth.json format
        docs/auth.md
        Approve / edit / abort? [Y/e/n]: e
        # Editor opens with the draft; you tweak it
        ✓ committed
```

## 7. (Coming soon) AI-generated PRs

```bash
pritty pr
# Generates PR title + body from your branch's commits + diff
# Suggests reviewers from CODEOWNERS
# Extracts ticket reference from branch name
# Opens PR via GitHub API
```

See [feature-overview.md](feature-overview.md) for the full planned
flow.

## Common workflows

### Reset your auth

```bash
pritty auth logout
pritty auth login
```

### Switch providers

Edit `.pritty.json`:

```json
{
  "provider": "anthropic"
}
```

Make sure `ANTHROPIC_API_KEY` is in your environment, then re-run
the command.

### Use a different config location

cosmiconfig discovers any of: `.pritty.json`, `.prittyrc`,
`.prittyrc.json`, `.prittyrc.yaml`, `pritty.config.json`,
`pritty.config.js`, or a `"pritty"` field in `package.json`.

### Run pritty from a script

The programmatic API is exported:

```typescript
import { categorize, loadConfig } from "@jefelabs/pritty";

const config = loadConfig();
const buckets = categorize(stagedFiles, config.categories);
```

Useful for pre-commit hooks, custom CI checks, editor extensions.

## Troubleshooting

### "Provider 'copilot' is not authenticated"

You haven't run `pritty auth login`, or your stored token is invalid.
Re-run:

```bash
pritty auth login
```

### "ANTHROPIC_API_KEY is not set"

You configured `provider: "anthropic"` but didn't set the env var.
Either set it:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

…or change the config to a provider you've authenticated.

### "src/foo.test.ts is in the 'app' category, not 'test'"

Category ordering issue. In your `.pritty.json`, make sure `test`
appears before `app`:

```json
{
  "categories": {
    "test": ["**/*.test.*"],     // FIRST — catches test files
    "app": ["src/**"]            // SECOND — catches everything else in src
  }
}
```

### Categorizer says "no files"

Either nothing's staged (`git add` first) or your patterns don't
match. Try `pritty categorize --all` to see modified + untracked,
which often reveals what's actually changed.

### Reset everything

```bash
rm -rf ~/.pritty/                       # remove auth + per-user state
rm .pritty.json                         # remove repo config
pritty init                             # fresh setup
pritty auth login
```

## What's next

- **[feature-overview.md](feature-overview.md)** — full categorized
  list of features (shipped + planned).
- **[architecture.md](architecture.md)** — how pritty is organized
  internally; how it integrates with `@jefelabs/agent-auth` and
  `@jefelabs/agent-adapter`.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing for sharing with teammates considering adoption.

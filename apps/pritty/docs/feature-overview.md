# pritty — Feature Overview

A categorized rundown of what pritty does today and what's planned.
For implementation status see the table at the top of
[executive-overview.md](executive-overview.md).

## Authentication (✅ shipped)

### GitHub Device Flow login

```bash
pritty auth login
```

Initiates GitHub OAuth Device Flow. Prints a code + URL; you confirm
in your browser. Token is persisted to `~/.pritty/auth.json` with
mode `0600`. Same Device Flow your IDE's Copilot integration uses —
zero extra signups.

### Status check

```bash
pritty auth status
```

Reads stored credentials and prints per-provider info. Token values
are never printed (you'll see "✓ logged in" not the token itself).

### Logout

```bash
pritty auth logout
```

Removes the stored auth file. Subsequent commands that need an
authenticated provider will fail with a clear error pointing to
`pritty auth login`.

### Custom storage location

```bash
PRITTY_HOME=/custom/path pritty auth login
```

Useful for CI environments, multi-account setups, or when the default
`~/.pritty/` is on a non-writable volume.

## Configuration (✅ shipped)

### Initialize

```bash
pritty init
```

Writes a `.pritty.json` with sensible defaults at the repo root. Use
this once per project; check the file in to git so teammates inherit
your settings.

### Config discovery

pritty uses cosmiconfig — any of these names work, in priority order:

- `.pritty.json`
- `.prittyrc`
- `.prittyrc.json` / `.prittyrc.yaml` / `.prittyrc.yml`
- `pritty.config.json` / `pritty.config.js`
- `"pritty"` field in `package.json`

### Settable fields

```json
{
  "model": "gpt-4o",                      // Model to use within the chosen provider
  "provider": "copilot",                  // Default LLM provider
  "fallback": ["anthropic", "openai"],    // Try in order if primary fails
  "baseBranch": "main",                   // Base for PR diff
  "commitStyle": "conventional",          // Conventional Commits
  "preCommit": ["eslint", "prettier"],    // Shell hooks before commit
  "prePush": ["test"],                    // Shell hooks before push
  "categories": {                         // Custom file categories
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app":  ["src/**", "lib/**"],
    "infra": ["terraform/**", ".github/**"]
  },
  "anthropicKeyEnv": "ANTHROPIC_API_KEY", // Where to read API keys from
  "openaiKeyEnv": "OPENAI_API_KEY"
}
```

All fields are validated by Zod at load time — typos and wrong types
are caught immediately.

## File categorization (✅ shipped)

### Default categories

Out of the box, pritty buckets files as:

- `test` — `*.test.*`, `*.spec.*`, `**/__tests__/**`
- `app` — `src/**`, `lib/**`, `app/**`
- `config` — `package.json`, `tsconfig.json`, `.eslintrc*`, etc.
- `docs` — `*.md`, `docs/**`, `README*`
- `assets` — images, fonts, static media

### Inspect categorization

```bash
pritty categorize                        # staged files only
pritty categorize --all                  # staged + modified + untracked
```

Output groups files by category with chalk-colored headers:

```
test (3)
  src/components/Button.test.tsx
  src/utils/format.test.ts
  src/api/client.test.ts

app (5)
  src/components/Button.tsx
  src/utils/format.ts
  src/api/client.ts
  src/hooks/useAuth.ts
  src/index.ts

config (1)
  tsconfig.json
```

### Custom categories

Add buckets via `.pritty.json`:

```json
{
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**"],
    "infra": ["terraform/**", ".github/**", "Dockerfile"],
    "mobile": ["ios/**", "android/**"]
  }
}
```

**First-match-wins ordering** — put specific categories (`test`)
before broad ones (`app`), or `src/foo.test.ts` will land in `app`.

## Provider routing (⏳ in progress)

### Provider list

| Provider | How auth works | When to pick |
|---|---|---|
| `copilot` (default) | Device Flow → `~/.pritty/auth.json` | You already have a Copilot subscription |
| `anthropic` | API key in env (`ANTHROPIC_API_KEY` by default) | You have your own Anthropic budget |
| `openai` | API key in env (`OPENAI_API_KEY` by default) | You have your own OpenAI budget |

### Fallback chains

```json
{
  "provider": "copilot",
  "fallback": ["anthropic", "openai"]
}
```

If primary fails (no auth, no key, network error), try `anthropic`,
then `openai`. If all fail → structured error naming each provider
attempted and how to set it up.

Default `fallback: []` means "primary or nothing" — no surprise
provider switching.

### Custom env var names

Some teams have multiple Anthropic/OpenAI keys (dev vs. prod, per-team
quotas). Override the env var name:

```json
{
  "anthropicKeyEnv": "MY_TEAM_ANTHROPIC_KEY",
  "openaiKeyEnv": "MY_TEAM_OPENAI_KEY"
}
```

## AI-generated commits (⏳ planned)

### Per-category commits

```bash
pritty commit
```

Process:

1. Stage files (`git add`)
2. `pritty commit` reads staged files
3. Groups by category (using your `.pritty.json` config)
4. For each category, generates a Conventional Commit message
5. Presents each draft → you approve or edit
6. Commits each category separately

A typical change set produces 2–4 commits, each focused on one concern:

```
feat(auth): add Device Flow login           # the "app" bucket
test(auth): cover login + logout paths      # the "test" bucket
docs: document the auth.json format         # the "docs" bucket
```

### Style options

Configurable via `commitStyle`:

- `conventional` (default) — Conventional Commits spec
- (future) `gitmoji`, `simple`, custom templates

### Pre-commit hook integration

`preCommit` hooks (configured in `.pritty.json`) run before each
commit. If a hook fails, the commit is aborted and you see the
hook's output:

```json
{
  "preCommit": ["eslint", "prettier --check"]
}
```

## AI-generated pull requests (⏳ planned)

### `pritty pr`

```bash
pritty pr
```

Process:

1. List commits since `baseBranch`
2. Extract ticket reference from current branch name (e.g.,
   `feature/PROJ-123-thing` → `PROJ-123`)
3. Suggest reviewers from CODEOWNERS for touched files
4. Generate PR title + body using the diff and commits as context
5. Inject the AI draft into your `.github/pull_request_template.md`
6. Present the full draft → you approve, edit, or abort
7. Open the PR via Octokit; print the PR URL

### Branch-name ticket extraction

Common patterns recognized:

- `feature/PROJ-123-description` → `PROJ-123`
- `fix/PROJ-456` → `PROJ-456`
- `daisy/PROJ-789-thing` → `PROJ-789`

Customize via config (planned).

### CODEOWNERS-aware reviewers

```bash
pritty pr
# Suggested reviewers (from CODEOWNERS):
#   @platform-team   (touched: terraform/**)
#   @frontend-team   (touched: src/components/**)
#   @api-team        (touched: src/api/**)
```

## AI-planned rebase (⏳ planned)

### `pritty rebase`

```bash
pritty rebase main
```

Process:

1. Fetch latest `main`
2. Walk commits in your branch
3. Use AI to plan an interactive rebase: which commits to squash,
   which to fixup, which to reorder for clarity
4. Present the plan → you approve, edit, or abort
5. Run the rebase

Failure cases (merge conflicts, unsafe operations) abort cleanly
without modifying your branch.

## Pre-commit / pre-push hooks (⏳ planned)

```json
{
  "preCommit": ["eslint --fix", "prettier --write"],
  "prePush": ["test", "typecheck"]
}
```

`preCommit` runs before each `pritty commit`; `prePush` runs before
the equivalent push step. Failed hooks abort the operation and show
the hook's full output.

Hook commands run with the staged files as context (similar to
husky / lint-staged but without the install ceremony).

## Outlier detection (⏳ planned)

### What it'll detect

- A commit that touches files in 5+ categories (suggests splitting)
- A staged change that mixes unrelated concerns (e.g., a test fix +
  a feature change in one diff)
- Generated commit messages that flag low-confidence cases for human
  review

### Interactive resolution

When an outlier is detected:

```
⚠ Outlier detected: this commit touches files in 4 categories.
Suggestion: split into:
  1. feat(auth): add Device Flow            (3 files)
  2. test(auth): cover login paths          (2 files)
  3. docs: document the auth.json format    (1 file)
  4. config: add eslint rule for auth/      (1 file)

Apply suggested split? [Y/n/edit]
```

## Programmatic API (✅ shipped)

```typescript
import {
  // Auth
  login, readAuth, logout,
  // Config
  loadConfig,
  // Categorizer
  categorize, mergeCategories, DEFAULT_CATEGORIES,
} from "@agentx/pritty";

const config = loadConfig();
const buckets = categorize(stagedFiles, config.categories);
```

Use cases:

- Other CLIs that want to inspect "what's staged"
- Pre-commit scripts that need to bucket by category
- Editor extensions that want to surface file categorization in the
  sidebar

The shipped exports cover the AI-free primitives. AI-related exports
(commit message generation, PR body drafting) ship as the planned
phases land.

## Stack

Per agentx-toolbox conventions:

- TypeScript ESM
- Commander.js for CLI parsing
- vitest for tests
- tsup for bundling
- chalk for colored output
- Zod for config validation
- minimatch for glob category matching

## Where to go from here

- **[getting-started.md](getting-started.md)** — install and use the
  shipped commands.
- **[architecture.md](architecture.md)** — internal organization and
  design rationale.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing.

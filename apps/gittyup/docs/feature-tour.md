# Gittyup — Feature Tour

A walkthrough of gittyup's features with practical examples.

---

## 1. Workspace Initialization

Start by initializing a workspace. Inside a git repo, you'll be asked where to store the config:

```
$ helmsmith-gittyup init

? Where should the config be stored?
❯ Project  /home/user/myproject/.helmsmith/gittyup
  Global   ~/.helmsmith/gittyup

? Install agent & command context files for an AI coding tool?
❯ Anthropic Claude Code
  GitHub Copilot
  OpenAI Codex
  Skip

? Which agent roles to install?
◉ Release Coordinator — Orchestrates branch flow across repos

✓ Created /home/user/myproject/.helmsmith/gittyup/gittyup.yaml
✓ Installed 7 context file(s):
    .claude/agents/gittyup-release-coordinator.md
    .claude/commands/ax/gittyup/compare.md
    .claude/commands/ax/gittyup/merge.md
    .claude/commands/ax/gittyup/pick.md
    .claude/commands/ax/gittyup/prs.md
    .claude/commands/ax/gittyup/status.md
    .claude/commands/ax/gittyup/sync.md
```

Outside a git repo, config defaults to `~/.helmsmith/gittyup/`.

---

## 2. Repo Discovery

Instead of manually adding repos one by one, scan a directory tree:

```
$ helmsmith-gittyup find ~/projects --depth 3

  Found 12 git repositories in 3 folder(s):

  📁 frontend/ (4)
      web-app [main]
      admin-panel [develop]
      design-system [main]
      storybook [main] *

  📁 backend/ (5)
      api-gateway [develop]
      auth-service [main]
      user-service [develop]
      payment-service [main]
      notification-svc [develop]

  📁 shared/ (3)
      proto-schemas [main]
      eslint-config [main]
      ci-templates [main]

? How would you like to select from 12 repositories?
❯ Add all 12 repositories
  Select by folder (3 folders)
  Select individually (checkbox)
```

After selection, an interactive group assigner and tag assigner let you organize repos. Press number keys to assign groups, use `+` to create new groups.

---

## 3. Branch Aliasing

Each repo defines branch aliases in the manifest:

```yaml
branches:
  dev: develop       # "dev" maps to "develop"
  staging: staging   # "staging" maps to "staging"
  prod: main         # "prod" maps to "main"
```

This means `gittyup merge dev staging` resolves to the correct branch names per repo, even when repos use different naming conventions. One repo's `dev` might be `develop`, another's might be `dev` — the alias layer handles it.

---

## 4. Status Dashboard

See branch states across all repos at a glance:

```
$ helmsmith-gittyup status --fetch

  frontend
  ┌──────────────┬──────────┬───────┬────────┬────────────┐
  │ Repo         │ Branch   │ State │ Status │ Last Commit│
  ├──────────────┼──────────┼───────┼────────┼────────────┤
  │ web-app      │ develop  │ ↑2    │ ✓      │ 2h ago     │
  │ admin-panel  │ develop  │ ↑1 ↓3 │ ↕      │ 1d ago     │
  │ design-system│ main     │ =     │ ✓      │ 3d ago     │
  └──────────────┴──────────┴───────┴────────┴────────────┘

  backend
  ┌──────────────┬──────────┬───────┬────────┬────────────┐
  │ api-gateway  │ develop  │ =     │ ✓      │ 4h ago     │
  │ auth-service │ main     │ ↑5    │ ●      │ 30m ago    │
  └──────────────┴──────────┴───────┴────────┴────────────┘
```

Status icons:
- `✓` Clean and up to date
- `●` Dirty working tree (uncommitted changes)
- `↕` Diverged (ahead and behind)
- `⚡` Has merge conflicts

Use `--compact` for a condensed single-line-per-repo view.

---

## 5. Branch Comparison

Before merging, compare branches to see what's changed:

```
$ helmsmith-gittyup compare dev staging --fetch

  ⚡ Repos with conflicts (2)

  web-app
    dev:     8 commits (latest: 2h ago by alice)
    staging: 3 commits (latest: 1d ago by bob)
    ⚡ Conflicts detected

  auth-service
    dev:     12 commits (latest: 30m ago by carol)
    staging: 1 commit (latest: 3d ago by dave)
    ⚡ Conflicts detected
    🔗 PR #42 (open) — https://github.com/org/auth-service/pull/42

  ✓ Clean repos (3)

  api-gateway      dev: 2 commits → staging
  design-system    dev: 0 commits (in sync)
  admin-panel      dev: 5 commits → staging
```

Results are cached for 5 minutes. Use `-f` to force a fresh check.

---

## 6. Multi-Repo Merge

Merge a branch across all repos in a group:

```
$ helmsmith-gittyup merge dev staging --group backend --push --pr

  Merge Plan:
    api-gateway:  develop → staging
    auth-service: develop → staging
    user-service: develop → staging

? Proceed with merge across 3 repo(s)? Yes
```

If conflicts arise, the interactive conflict resolver kicks in:

```
  ⚡ Conflict in auth-service: src/middleware/auth.ts

? How would you like to resolve?
❯ AI auto-resolve (Copilot)
  AI suggest (show reasoning)
  Use ours (keep staging)
  Use theirs (keep dev)
  Open in editor
  Skip this file
  Escalate (create conflict branch)
```

With `--ai auto`, all conflicts are resolved by AI without prompts. With `--ai suggest`, the AI shows its reasoning and you choose whether to accept.

---

## 7. Cherry-Pick

For hotfixes or selective promotion, cherry-pick specific commits:

```
$ helmsmith-gittyup pick --group backend --source dev --target prod --interactive

  Select commits for api-gateway:
    ☐ a1b2c3d Fix: rate limiter bypass (2h ago)
    ☐ e4f5g6h Feat: add health endpoint (4h ago)
    ☐ i7j8k9l Chore: update deps (1d ago)

  Cherry-Pick Plan:
    api-gateway: 2 commit(s) develop → main
      a1b2c3d
      e4f5g6h

? Proceed with cherry-pick across 1 repo(s)? Yes
```

You can also pass explicit SHAs: `--commits a1b2c3d e4f5g6h`.

---

## 8. PR Management

List open PRs across all repos:

```
$ helmsmith-gittyup prs --group backend

  api-gateway (2 open)
    #45 Add rate limiting middleware (dev → staging) https://...
    #42 Fix auth token refresh (hotfix → main) https://...

  auth-service (1 open)
    #38 Migrate to OAuth 2.1 (dev → staging) https://...

  user-service (0 open)
```

PRs are also shown inline during `compare` output.

---

## 9. Tagging & Filtering

Repos can be tagged for cross-group filtering:

```
$ helmsmith-gittyup repo tag --group backend --add api,critical
✓ Updated tags for 5 repo(s)
  Added: api, critical

$ helmsmith-gittyup repo tags
  Tags:
    api (5 repos)
    critical (5 repos)
    react (2 repos)
    ui (4 repos)
```

Interactive tagging is available via `helmsmith-gittyup repo tag` (no `--add/--remove` flags).

---

## 10. AI Provider Authentication

Gittyup supports three AI providers for conflict resolution. The CLI `auth login` command currently handles **GitHub Copilot** authentication via OAuth device flow:

```
$ helmsmith-gittyup auth login

  Visit: https://github.com/login/device
  Enter code: ABCD-1234
  Waiting for authorization...

✓ Authenticated as @username
  Copilot token will be fetched on first AI call.

$ helmsmith-gittyup auth status
    GitHub Token: ✓ (source: auth.json)
    Config: ~/.helmsmith/gittyup/auth.json
    Copilot:      ✓ accessible

$ helmsmith-gittyup auth models
  Available Copilot Models (6):
    gpt-4o (128000/16384 tokens)
    gpt-4.1 (1000000/32768 tokens)
    o1 (200000/100000 tokens)
    o3-mini (200000/100000 tokens)
    claude-sonnet-4 (200000/16384 tokens)
    claude-opus-4 (200000/32768 tokens)
```

**Anthropic and OpenAI** providers are implemented with OAuth PKCE flows and can also fall back to API key environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Their login flows are not yet exposed through the CLI `auth login` command but are available programmatically via the provider registry.

---

## 11. Result Caching

The `compare` command caches results for 5 minutes to speed up repeated checks:

```
$ helmsmith-gittyup compare dev staging
  ⚡ Cached result (45s ago, expires in 255s). Use -f to force refresh.
  ...

$ helmsmith-gittyup compare dev staging -f   # Force fresh data
```

Manage the cache directly:

```
$ helmsmith-gittyup cache prune   # Remove expired entries
$ helmsmith-gittyup cache clear   # Remove all entries
```

---

## 12. AI Tool Context Installation

During `init`, gittyup installs context files that teach AI coding agents how to use gittyup. For Claude Code:

**Agent file** (`.claude/agents/gittyup-release-coordinator.md`):
- Full workflow instructions for orchestrating branch flow
- Quick reference of all gittyup commands
- Decision guidance (when to compare, when to merge, how to handle conflicts)

**Command files** (`.claude/commands/ax/gittyup/`):
- `status.md` — `/ax:gittyup:status`
- `compare.md` — `/ax:gittyup:compare`
- `merge.md` — `/ax:gittyup:merge`
- `pick.md` — `/ax:gittyup:pick`
- `prs.md` — `/ax:gittyup:prs`
- `sync.md` — `/ax:gittyup:sync`

Also supports GitHub Copilot (`.github/instructions/` + `.github/prompts/`) and OpenAI Codex (`AGENTS.md`).

---

## 13. Config Path Display

Every command prints the active config path at the end:

```
$ helmsmith-gittyup status
  ...
  config: /home/user/myproject/.helmsmith/gittyup/gittyup.yaml [repo]

$ helmsmith-gittyup prs
  ...
  config: /home/user/.helmsmith/gittyup/gittyup.yaml [home]
```

The `[repo]` or `[home]` tag tells you whether you're using project-local or global config.

---

## 14. Rebranding

Gittyup is built on a rebrandable foundation. The `branding.yaml` file at project root defines three primitives:

```yaml
appGroupName: helmsmith
appGroupInitials: ax
appName: gittyup
```

Running `helmsmith-gittyup rebrand` updates all references across the codebase — CLI name, config paths, constants, package.json — making it possible to fork and rebrand the tool for a different suite. Use `--dry-run` to preview changes without writing.

> **Note:** The `rebrand` command is hidden from the CLI help output since it's a developer/fork workflow, not a day-to-day user command.

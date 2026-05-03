---
description: GitHub integration for repos, issues, PRs, releases, and Actions. Three interfaces — CLI (gh), MCP (GitHub MCP), REST (REST API + GraphQL). Default preference is CLI when available. Supports github.com and GitHub Enterprise via instanceUrl. Takes free-form prompts; classifies and routes to the configured interface.
argument-hint: <free-form-prompt> [--use-direct] [--instance <id>] [--read-only]
allowed-tools: Read, Write, Edit, Bash, mcp__github__*
---

Direct invocation of GitHub for repository, issue, PR,
release, and Actions operations. The integration interprets
your prompt and routes via the configured preferred interface.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `github` is
   active.

   ```bash
   ACTIVE=$(jq -r '.integrations.github.active // false' \
                 product/.pencil-integrations.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "GitHub integration not active. Run /integrations:setup github"
     exit 1
   fi
   ```

2. Determine preferred interface and verify availability:

   ```bash
   PREFERENCE=$(jq -r '.integrations.github.preference' \
                     product/.pencil-integrations.json)
   
   case "$PREFERENCE" in
     cli)
       command -v gh >/dev/null 2>&1 || prompt_unavailable "cli"
       gh auth status >/dev/null 2>&1 || prompt_unauth "cli"
       ;;
     mcp)
       mcp_tool_available "mcp__github__list_repos" || prompt_unavailable "mcp"
       ;;
     rest)
       GITHUB_TOKEN=$(resolve_credential "github" "GITHUB_TOKEN")
       [ -n "$GITHUB_TOKEN" ] || prompt_unauth "rest"
       ;;
   esac
   ```

3. For multi-instance configurations, resolve instance:

   ```bash
   INSTANCE="${INSTANCE:-$(jq -r '.integrations.github.defaultInstance // \"github-com\"' product/.pencil-integrations.json)}"
   INSTANCE_URL=$(jq -r ".integrations.github.instances[] | select(.id == \"$INSTANCE\") | .url" \
                       product/.pencil-integrations.json)
   ```

## Phase 1: prompt interpretation

Classify the user's prompt into operation categories:

### Read operations (direct interface, no delegation considered)

- **Repository queries**: list repos, repo details, file
  contents, commit history, branches, tags
- **Issue queries**: list issues, issue details, search
  issues by labels/assignee/state
- **PR queries**: list PRs, PR details, review status,
  unreviewed PRs assigned to user
- **Release queries**: list releases, release details
- **Actions queries**: workflow runs, run logs, status checks
- **User/org queries**: members, teams, collaborators
- **Code search**: search across repos for patterns

### Write operations

- **Issue management**: create issue, update labels, close,
  reopen, assign, comment
- **PR management**: create PR, request reviews, merge,
  approve, comment, mark draft/ready
- **Release management**: create release, upload assets,
  publish
- **Workflow triggers**: dispatch workflow, re-run failed
  jobs
- **Repo administration**: create repo, archive, transfer
  (admin scope required)

GitHub doesn't typically have a write delegation pattern (no
"GitHub-via-Buffer"); writes always go direct.

## Phase 2: execution per interface

### CLI path (`gh`)

The `gh` CLI handles most GitHub operations naturally:

```bash
# Read examples
gh repo list jefelabs --limit 50
gh issue list --repo jefelabs/spec-kit --state open
gh pr list --repo jefelabs/spec-kit --search "review-requested:@me"
gh run list --repo jefelabs/spec-kit --limit 10
gh search code "PrematureCloseException" --repo jefelabs

# Write examples  
gh issue create --repo jefelabs/spec-kit --title "..." --body "..."
gh pr create --repo jefelabs/spec-kit --title "..." --body "..."
gh release create v1.2.3 --repo jefelabs/spec-kit --notes "..."
gh workflow run deploy.yml --repo jefelabs/spec-kit
```

The integration generates the appropriate `gh` command from
the prompt, runs it, parses output (JSON when `--json` flag
useful), and returns to the user.

For GitHub Enterprise:

```bash
# gh respects GH_HOST env var
GH_HOST="$INSTANCE_URL" gh issue list ...
```

### MCP path (`mcp__github__*`)

When MCP preferred, route through MCP tools. The GitHub MCP
exposes structured operations:

```
Operation: "show me unreviewed PRs assigned to me"
  → mcp__github__list_pull_requests with filter
    review_requested_by: "@me", state: "open"

Operation: "create issue in jefelabs/spec-kit titled X"
  → mcp__github__create_issue with owner, repo, title, body
```

The integration knows the MCP tool catalog and maps prompts
to tool calls.

### REST path

For pure REST invocations (when CLI and MCP unavailable, OR
when user prefers REST for compliance/visibility):

```bash
GITHUB_TOKEN=$(resolve_credential "github" "GITHUB_TOKEN")

# Example: list issues
curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "${INSTANCE_URL}/repos/jefelabs/spec-kit/issues?state=open"

unset GITHUB_TOKEN  # clear from env after use
```

For GraphQL operations (richer queries, single-roundtrip
multi-resource fetches):

```bash
curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "${INSTANCE_URL}/graphql" \
  -d '{"query": "query { viewer { pullRequests(first: 10) { ... } } }"}'
```

## Phase 3: result formatting

GitHub responses are formatted for readability:

```
=== GitHub: jefelabs/spec-kit ===
Open PRs (3):

  #142 — Add LangGraph integration
    By: edwin-jefelabs
    Status: Awaiting review (2 of 2 reviewers pending)
    Updated: 3h ago
    URL: https://github.com/jefelabs/spec-kit/pull/142

  #138 — Refactor planner interface  
    By: edwin-jefelabs
    Status: Approved; awaiting merge
    Updated: 1d ago
    URL: https://github.com/jefelabs/spec-kit/pull/138

  #135 — [WIP] Embabel integration
    By: contributor-x
    Status: Draft
    Updated: 5d ago
    URL: https://github.com/jefelabs/spec-kit/pull/135
```

JSON output via `--json` for programmatic consumption.

## Phase 4: error handling

Common GitHub errors and their guidance:

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 Unauthorized | Token expired/revoked | Re-run `/integrations:setup github` |
| 403 Forbidden, rate limit | Exceeded rate limit | Surface remaining quota; suggest backoff |
| 403 Forbidden, scope | Token lacks required scope | List required scopes; re-run setup |
| 404 Not Found | Repo doesn't exist or token can't see it | Check repo path; verify token has access |
| 422 Unprocessable | Validation failed (e.g., PR head/base mismatch) | Surface validation message |

Errors don't silently fail; the user sees the underlying cause
and a suggested fix.

## Cross-namespace integration

This integration is invoked by:

- **`engineer/architecture/` workflows** that propose changes
  via PRs (ADR cycle creates a PR with the new ADR file)
- **`engineer/maintenance/upgrades/`** routines that open PRs
  for dependency upgrades
- **`workflows:manage`** when workflows include "open PR"
  steps
- **External SKILL.md files** that declare GitHub as a required
  integration

Future commands that integrate:

- A "create PR with description from this conversation" pattern
  in `/engineer:development:` namespace
- Issue triage commands in `/engineer:maintenance:`

## What this integration does NOT do

- **Replace `gh` CLI's full surface area.** When users want
  the full `gh` experience, they should use `gh` directly.
  This integration is for prompt-driven operations and AI
  agent invocations.
- **Manage authentication interactively beyond setup.** OAuth
  flow is `gh auth login` (CLI handles) or token generation
  externally (REST/MCP). The suite tracks the token's
  storage location.
- **Sync issues across multiple repos.** Single-repo or
  single-org scoped per invocation. Cross-repo workflows are
  composed from multiple invocations.
- **Replace Jira-like project management.** GitHub Projects
  exists but most teams using GitHub also use Jira; the suite
  treats them as peer integrations, not alternatives.

---

# Registry definition

## Integration metadata

```yaml
name: github
displayName: GitHub
provider: github
category: code-hosting
multiInstance: true  # github.com + GitHub Enterprise
```

## Interfaces

### CLI

```yaml
executable: gh
detectionCommand: gh --version
installCommand: |
  macOS: brew install gh
  Linux: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md
  Windows: winget install --id GitHub.cli
authMethod: oauth-via-cli
authCommand: gh auth login
```

The `gh` CLI is the canonical GitHub command-line tool. Stable,
well-maintained by GitHub, supports both github.com and
Enterprise via `GH_HOST` env var or `gh auth login --hostname`.

### MCP

```yaml
serverName: github
toolPrefix: mcp__github__
authMethod: token-managed-by-mcp
notes: |
  GitHub MCP server is officially supported.
  Configuration: provide GITHUB_PERSONAL_ACCESS_TOKEN to MCP
  server config; MCP handles all subsequent auth.
```

### REST

```yaml
baseUrl:
  github-com: https://api.github.com
  enterprise: https://{instance-url}/api/v3
authMethod: bearer-token
authHeaders:
  - "Authorization: Bearer {GITHUB_TOKEN}"
  - "Accept: application/vnd.github+json"
rateLimit: 5000/hour (authenticated); 60/hour (unauthenticated)
graphqlEndpoint:
  github-com: https://api.github.com/graphql
  enterprise: https://{instance-url}/api/graphql
```

## Multi-instance support

GitHub commonly has two instances:
- `github-com` — github.com (default)
- `enterprise` — internal GitHub Enterprise instance

Per-instance setup configures the URL and credentials.
Commands without `--instance` flag use `defaultInstance`.

## Credentials

### `GITHUB_TOKEN`

- **Description**: Personal Access Token or OAuth token for
  GitHub API access
- **Sensitive**: yes (defaults to keychain storage)
- **Get from** (github.com):
  https://github.com/settings/tokens
  Choose Fine-grained or Classic; classic is simpler.
- **Get from** (Enterprise):
  `<enterprise-url>/settings/tokens`

### Required scopes (Personal Access Token Classic)

For most read operations:
- `repo` (full control of private repos) OR `public_repo`
  (public only)
- `read:org` (read org membership)

For write operations:
- `repo` (issue/PR creation, releases)
- `workflow` (trigger workflows, edit Actions)

For administrative operations:
- `admin:repo_hook`, `admin:org`, etc. (rarely needed)

### Fine-grained PAT scopes

Read:
- Contents: read
- Issues: read
- Pull requests: read
- Metadata: read (default)

Write:
- Contents: read+write (for releases, file changes)
- Issues: read+write
- Pull requests: read+write
- Workflows: read+write (for Actions)

## Rate limits

REST: 5000/hour authenticated. Surfaced in response headers
(`X-RateLimit-Remaining`). Integration tracks and warns when
< 100 remaining.

GraphQL: separate budget, points-based. Complex queries cost
more points than simple ones.

CLI uses REST under the hood; subject to the same limits.

MCP: depends on MCP server's caching; generally subject to
underlying API limits.

## Required by skillz commands

(Auto-populated as commands declare GitHub as required
integration. Currently empty; populated by
/integrations:setup --refresh-required-by when commands exist.)

## Compliance considerations

GitHub Enterprise contexts (financial institutions, regulated
industries) typically require:
- Personal Access Tokens with limited scopes
- Token rotation enforcement (suite's
  `credentialRotationDays` default 90)
- Audit logging of token use (handled by GitHub Enterprise
  audit log; suite doesn't add another layer)
- Single-org scoping (use Fine-grained PAT scoped to specific
  org)

For github.com personal use, simpler PAT with broader scopes
is often acceptable.

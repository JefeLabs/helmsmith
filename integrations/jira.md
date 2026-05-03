---
description: Jira integration for issues, sprints, projects, and workflows. Three interfaces — CLI (jira from go-jira), MCP (Atlassian MCP), REST (Jira Cloud REST API v3). Default preference is CLI when available. Supports per-project scoping and instance URL configuration. Takes free-form prompts.
argument-hint: <free-form-prompt> [--use-direct] [--project <key>] [--instance <id>]
allowed-tools: Read, Write, Edit, Bash, mcp__atlassian__*
---

Direct invocation of Jira for issue, sprint, and project
operations. The integration interprets your prompt and routes
via the configured preferred interface.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `jira` is
   active.

2. Determine preferred interface and verify availability:

   ```bash
   PREFERENCE=$(jq -r '.integrations.jira.preference' \
                     product/.pencil-integrations.json)
   
   case "$PREFERENCE" in
     cli)
       command -v jira >/dev/null 2>&1 || prompt_unavailable "cli"
       ;;
     mcp)
       mcp_tool_available "mcp__atlassian__jira_search" || prompt_unavailable "mcp"
       ;;
     rest)
       JIRA_EMAIL=$(resolve_credential "jira" "JIRA_EMAIL")
       JIRA_API_TOKEN=$(resolve_credential "jira" "JIRA_API_TOKEN")
       [ -n "$JIRA_EMAIL" ] && [ -n "$JIRA_API_TOKEN" ] || prompt_unauth "rest"
       ;;
   esac
   ```

3. Resolve instance URL and project scoping:

   ```bash
   INSTANCE_URL=$(jq -r '.integrations.jira.instanceUrl' \
                       product/.pencil-integrations.json)
   
   # Default project from manifest's perResourceScoping
   DEFAULT_PROJECTS=$(jq -r '.integrations.jira.perResourceScoping.projects // [] | join(",")' \
                          product/.pencil-integrations.json)
   PROJECT="${PROJECT:-$DEFAULT_PROJECTS}"
   ```

## Phase 1: prompt interpretation

Classify the user's prompt into operation categories:

### Read operations

- **Issue queries**: search by JQL, filter by project/assignee/
  status/labels, fetch issue details, get linked issues,
  fetch comments
- **Sprint queries**: list active sprints, sprint contents,
  sprint progress, velocity
- **Project queries**: list projects, project metadata,
  components, versions
- **User queries**: assignee resolution, watcher lists, project
  members
- **Workflow queries**: available transitions for an issue,
  workflow definitions

### Write operations

- **Issue management**: create issue, update fields, add
  comment, attach files, link issues, set assignee, transition
  status
- **Sprint management**: add issues to sprint, remove from
  sprint, start/end sprint (limited; usually requires admin)
- **Bulk operations**: bulk transition, bulk assign

Jira doesn't have a write delegation pattern (no
"Jira-via-Hootsuite"). Writes always go direct.

## Phase 2: execution per interface

### CLI path (`jira`)

The `jira` CLI from go-jira is widely used. Configuration in
`~/.jira.d/config.yml` typically; the suite respects existing
config.

```bash
# Read examples
jira issue list --project SCOOL --status Open
jira issue view SCOOL-1234
jira sprint list
jira issue search 'project = SCOOL AND status = "In Progress" AND assignee = currentUser()'

# Write examples
jira issue create --project SCOOL --type Task \
  --summary "..." --description "..."
jira issue update SCOOL-1234 --assignee edwin@example.com
jira issue transition SCOOL-1234 "In Progress"
jira issue comment SCOOL-1234 -m "Working on this; ETA tomorrow"
```

The integration generates the appropriate `jira` command from
the prompt, runs it, parses output, returns to user.

JQL (Jira Query Language) is the canonical query language.
The integration translates natural-language prompts to JQL:

- "show me my open tickets in SkoolScout" →
  `jql: "project = SCOOL AND status = Open AND assignee = currentUser()"`
- "tickets blocked or waiting" →
  `jql: "status in ('Blocked', 'Waiting')"`
- "high-priority bugs added in last week" →
  `jql: "type = Bug AND priority = High AND created >= -7d"`

### MCP path (`mcp__atlassian__*`)

Atlassian's official MCP exposes Jira and Confluence operations
together. When MCP preferred:

```
Operation: "create a ticket for the bug we discussed"
  → mcp__atlassian__jira_create_issue
    args: project, summary, description, issueType

Operation: "show open tickets in SCOOL"
  → mcp__atlassian__jira_search_issues
    args: jql: "project = SCOOL AND status = Open"
```

MCP handles auth via the connected Atlassian account; no
explicit token required at command time.

### REST path

Jira Cloud REST API v3:

```bash
# Basic auth: email + API token
JIRA_EMAIL=$(resolve_credential "jira" "JIRA_EMAIL")
JIRA_API_TOKEN=$(resolve_credential "jira" "JIRA_API_TOKEN")

# Search example
curl -sS \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "${INSTANCE_URL}/rest/api/3/search?jql=project=SCOOL+AND+status=Open"

# Create issue example
curl -sS \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "${INSTANCE_URL}/rest/api/3/issue" \
  -d '{
    "fields": {
      "project": { "key": "SCOOL" },
      "summary": "...",
      "description": { "type": "doc", "version": 1, "content": [...] },
      "issuetype": { "name": "Task" }
    }
  }'

unset JIRA_EMAIL JIRA_API_TOKEN
```

Jira's description field uses Atlassian Document Format (ADF) —
JSON structure rather than plain text. The integration handles
ADF construction for write operations.

## Phase 3: result formatting

Jira responses formatted for readability:

```
=== Jira: SCOOL (SkoolScout) ===
Open issues assigned to you (4):

  SCOOL-1234 — [Task] Investigate WebClient PrematureCloseException
    Priority: High
    Status: In Progress  
    Sprint: Sprint 47 (May 1-15)
    Updated: 2h ago
    URL: https://example.atlassian.net/browse/SCOOL-1234

  SCOOL-1219 — [Bug] Storybook drift remediation skips a11y rules
    Priority: Medium
    Status: To Do
    Sprint: Sprint 47
    Updated: 1d ago
    URL: https://example.atlassian.net/browse/SCOOL-1219

  ...
```

JSON output via `--json` for programmatic consumption.

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 Unauthorized | Token revoked/expired | Re-run `/integrations:setup jira` |
| 403 Forbidden | Token lacks permission for operation | Verify project permissions; some operations need admin |
| 404 Not Found | Issue key doesn't exist or no access | Verify key; check project access scope |
| 400 Bad Request, JQL | JQL syntax error | Surface JQL error with hint |
| 400 Bad Request, ADF | Description format invalid | Suite's ADF construction is the suspect; report bug |

## Cross-namespace integration

This integration is invoked by:

- **`engineer/maintenance/`** routines that file tickets for
  remediation work that requires manual review (a11y violations,
  deploy regressions surfaced by storybook-drift)
- **`workflows:manage`** for workflows that include "create
  ticket" steps (e.g., launch campaigns, incident response)
- **`product/strategy/`** scoping commands when product decisions
  result in tickets
- **External SKILL.md files** that declare Jira as a required
  integration

## What this integration does NOT do

- **Replace Jira's full UI.** Complex dashboards, custom
  filters, agile boards, advanced workflow editing — those
  are Jira UI work.
- **Auto-detect the right project.** When project not provided
  and `perResourceScoping.projects` has multiple values,
  surface the choice rather than guessing.
- **Sync external trackers to Jira.** No "import from Linear"
  or "sync GitHub Issues" — those are migration tools, not
  integration scope.
- **Manage Jira admin/configuration.** Workflows, schemes,
  custom fields, permissions — admin scope, separate from
  day-to-day issue operations.

---

# Registry definition

## Integration metadata

```yaml
name: jira
displayName: Atlassian Jira
provider: atlassian
category: issue-tracking
multiInstance: false  # most users have one Jira instance
                      # (multi-org scenarios theoretical; not
                      # pre-built)
```

## Interfaces

### CLI

```yaml
executable: jira
detectionCommand: jira version
installCommand: |
  macOS: brew install go-jira
  Linux: see https://github.com/go-jira/jira/releases
  Windows: download from releases page
authMethod: api-token-via-config
configFile: ~/.jira.d/config.yml
notes: |
  go-jira reads endpoint/email from config file. Suite's
  setup writes the config file with appropriate values.
  Token comes from JIRA_API_TOKEN env (resolved from keychain).
```

### MCP

```yaml
serverName: atlassian
toolPrefix: mcp__atlassian__
authMethod: oauth-via-mcp
notes: |
  Atlassian MCP server handles OAuth flow.
  Connect via Atlassian's MCP integration in your environment.
  MCP server stores its own credentials; suite doesn't manage.
```

### REST

```yaml
baseUrl: "{instanceUrl}/rest/api/3"
authMethod: basic-auth-with-token
authHeaders:
  - "Authorization: Basic {base64(email:token)}"
  - "Accept: application/json"
rateLimit: 1000/hour per user
documentationUrl: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
```

## Credentials

### `JIRA_EMAIL`

- **Description**: Atlassian account email address
- **Sensitive**: no (defaults to env storage)
- **Where to obtain**: your Atlassian account (the email you
  use to log into Jira)

### `JIRA_API_TOKEN`

- **Description**: Atlassian API token for REST authentication
- **Sensitive**: yes (defaults to keychain storage)
- **Where to obtain**:
  https://id.atlassian.com/manage-profile/security/api-tokens
- **Rotation**: Atlassian doesn't auto-rotate tokens; suite
  flags rotation per `credentialRotationDays` (default 90).

## Scopes

For Jira Cloud REST API v3, the scope model is implicit —
the API token grants the user's permissions. No separate
scope configuration.

For OAuth-based MCP access, scopes typically include:
- `read:jira-work` (always)
- `write:jira-work` (when creating/updating)
- `read:jira-user` (for assignee resolution)

## Per-resource scoping

Common pattern: limit operations to specific projects.

```jsonc
{
  "perResourceScoping": {
    "projects": ["SCOOL", "TS"]
  }
}
```

When set, JQL queries default to including
`project IN (SCOOL, TS)` filter unless prompt explicitly
references a project outside the scope (in which case the
integration surfaces the override).

## Rate limits

Jira Cloud: 1000 requests/hour per user. Surfaced in response
headers. Integration tracks and warns when approaching limit.

For high-volume operations (bulk transitions, large searches),
suggest batching or off-hours scheduling.

## Required by skillz commands

(Auto-populated.)

## Compliance considerations

Financial institution Jira instances may:
- Require API tokens with shorter rotation (set
  `credentialRotationDays: 30`)
- Restrict token creation to admin-approved patterns
- Audit token use (Atlassian audit log handles this; suite
  doesn't duplicate)
- Use SAML SSO for the UI but still allow API tokens for
  programmatic access (the suite's pattern works)

For compliance contexts, prefer the REST interface over MCP
since direct API gives explicit visibility into every call;
MCP servers add an abstraction layer that may complicate
audit.

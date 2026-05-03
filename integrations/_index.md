# Integrations — Index

Decision tree across integrations plus the four control-plane
commands.

## Setting up

```
First time setting up an integration?
└── /integrations:setup <integration>     # detect interfaces, configure auth

Specific instance only (multi-instance setup)?
└── /integrations:setup <integration> --instance <id>

Verify without re-auth?
└── /integrations:setup <integration> --check

Inspect current state?
└── /integrations:manifest                  # show all integrations

Diagnose credential issues?
└── /integrations:credentials --doctor      # auth health diagnostics
```

## Integrations by category

### Issue tracking

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Jira | `/integrations:jira` | CLI, MCP, REST |
| Linear | `/integrations:linear` (planned) | MCP, REST |
| GitHub Issues | `/integrations:github` (covers issues) | CLI, MCP, REST |

### Knowledge base

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Confluence | `/integrations:confluence` (planned) | MCP, REST |
| Notion | `/integrations:notion` (planned) | MCP, REST |

### Code hosting

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| GitHub | `/integrations:github` | CLI (gh), MCP, REST |
| GitLab | `/integrations:gitlab` (planned) | CLI (glab), REST |

### Design

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Figma | `/integrations:figma` | MCP, REST (no CLI) |

### Microsoft 365 stack (shared auth via Microsoft Graph)

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Outlook (mail) | `/integrations:outlook` | REST (Graph) |
| OneDrive | `/integrations:onedrive` | REST (Graph) |
| Teams | `/integrations:teams` | REST (Graph) |

### Messaging (alternatives, can coexist)

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Teams | `/integrations:teams` | REST |
| Discord | `/integrations:discord` | REST |
| Slack | `/integrations:slack` (planned) | CLI, MCP, REST |

### Marketing platforms (publishing/scheduling — write delegate)

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Hootsuite | `/integrations:hootsuite` | REST (delegate target) |
| Buffer | `/integrations:buffer` (planned) | REST |

### Social networks (direct platform — read + write-via-delegate)

| Integration | Slash command | Interfaces | Write delegation |
|-------------|---------------|------------|------------------|
| LinkedIn | `/integrations:linkedin` | REST | → Hootsuite (when configured) |
| Instagram | `/integrations:instagram` | REST | → Hootsuite |
| Reddit | `/integrations:reddit` | REST | → Hootsuite |
| X (Twitter) | `/integrations:x` | REST | → Hootsuite |

### Marketing intelligence

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| SEMrush | `/integrations:semrush` (read-only) | REST |

### Observability

| Integration | Slash command | Interfaces |
|-------------|---------------|------------|
| Datadog | `/integrations:datadog` | CLI (datadog-ci), REST |
| Splunk | `/integrations:splunk` (multi-instance) | CLI (splunk SDK), REST |
| Sentry | `/integrations:sentry` (planned) | CLI, REST |

## Direct invocation

Each integration's slash command takes a free-form prompt:

```bash
# Jira
/integrations:jira "create a ticket for the bug Edwin reported"
/integrations:jira "show me my open tickets in SCOOL project"
/integrations:jira "transition ticket SCOOL-1234 to In Progress"

# GitHub
/integrations:github "open a PR titled 'Add X' from feature/x to main"
/integrations:github "show me unreviewed PRs assigned to me"
/integrations:github "list issues with label 'bug' in jefelabs/spec-kit"

# Outlook
/integrations:outlook "send mail to team@example.com with subject 'Status update' and body from this conversation"
/integrations:outlook "show me unread mail from the past 24 hours"

# OneDrive
/integrations:onedrive "upload the design doc from this conversation to /Projects/2026/"
/integrations:onedrive "find files modified in /Shared/SkoolScout in the last week"

# Teams / Discord
/integrations:teams "post status update to #engineering channel"
/integrations:discord "post the release notes to #announcements"

# Datadog
/integrations:datadog "show me error rate for service 'api' over the last hour"
/integrations:datadog "list any active alerts in production"

# Splunk
/integrations:splunk "search prod logs for 'PrematureCloseException' in the last 24h"
```

The integration interprets the prompt and routes to the
appropriate operation via its preferred interface.

## Composing integrations within workflows

Integrations are usually invoked deliberately by users or by
workflow commands. Example workflow composition:

```
/workflows:manage start market:launch-campaign
  ↓
  Phase 1: Plan campaign
  Phase 2: Produce assets via /market:* commands
    /market:email:promotional → email copy
    /market:social:linkedin → LinkedIn post
    /market:pr:press-release → press release
  Phase 3: Publish via integrations
    /integrations:outlook → send email (or use a dedicated marketing platform)
    /integrations:linkedin (planned) → schedule post
    /integrations:gmail → send press release to journalists
  Phase 4: Track in issue tracker
    /integrations:jira → create launch checklist tickets
```

The persona commands produce content; integrations execute.
This separation lets users review/edit content before
publishing.

## Adding a new integration

```
/integrations:declare <integration-name>
```

Walks through metadata: provider, interfaces (CLI/MCP/REST),
auth method per interface, scopes, instance URL pattern,
credentials needed.

## Multi-instance integrations

For integrations supporting multiple endpoints (Splunk
prod/staging, GitHub.com + Enterprise):

```bash
# Setup multiple instances
/integrations:setup splunk --instance prod
/integrations:setup splunk --instance security

# Direct invocation on specific instance
/integrations:splunk --instance prod "search for X"

# Default instance used when omitted
/integrations:splunk "search for X"
```

The default instance is set during setup of the first instance.
Change via `/integrations:manifest --set-default-instance`.

## Reviewing integration health

```
/integrations:manifest                  # show all
/integrations:manifest jira             # specific integration
/integrations:credentials --doctor      # credential health
/integrations:manifest --review         # explicit periodic review
```

Health surfaces:
- Stale verification timestamps (suggest `--check`)
- Stale review timestamps (suggest `--review`)
- Credentials approaching rotation age (compliance contexts)
- Interfaces that became unavailable
- Mismatched preferences (preference says CLI but CLI not installed)

## Cross-namespace consumption

Integrations are referenced by:
- **Workflow commands** that execute multi-step processes
  involving remote services (campaign launches, issue
  ticketing, status reporting)
- **External SKILL.md files** declaring integration dependencies
- **User-invoked direct commands** for one-off remote service
  tasks

Less frequently than tools (which are heavily invoked as
building blocks within most commands).

## Cross-references to tools

Some boundary cases worth knowing:

- **`gh` CLI** — used by `/integrations:github`. Counted as
  the integration's CLI interface, not a separate tool entry.
- **Service-specific CLIs** like `splunk`, `jira`, `dogapi` —
  same pattern; documented as interfaces of their respective
  integrations.

When a service-specific CLI also has standalone use cases
(e.g., `gh repo clone` for unauthenticated public repos),
that's still under the integration. The `tools/` namespace
remains for general-purpose local invocations.

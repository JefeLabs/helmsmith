---
description: Query or manage the integrations runtime manifest. Show current state, query specific fields, perform periodic review (updates lastReviewed), deactivate or set default instances. Read-only by default; mutations require explicit flags. Never displays credential values.
argument-hint: [integration] [--query <jq-path>] [--review] [--set-default-instance <id>] [--list-instances]
allowed-tools: Read, Write, Edit, Bash
---

Query or manage the integrations runtime manifest at
`product/.pencil-integrations.json`. Read-only by default;
`--review` and `--set-default-instance` flags trigger
mutations.

## Phase 0: discovery

Read `product/.pencil-integrations.json`. If missing:

> No integrations configured. Run `/core:integrations:setup <name>`
> to set up your first integration.

## Modes

### Default — show all integrations

```bash
/core:integrations:manifest
```

```
=== Integrations ===
Last updated: 2026-05-03T18:00:00Z

ACTIVE:

jira (Atlassian)
  Preference:     cli
  Instance:       https://example.atlassian.net
  Interfaces:     CLI ✓ | MCP ✗ | REST ✓
  Credentials:    2 (1 keychain, 1 env)
  Last verified:  2026-05-03 (today)
  Last reviewed:  2026-05-03 (today)

github (GitHub)
  Preference:     cli (gh v2.45.0)
  Instance:       github.com
  Interfaces:     CLI ✓ | MCP ✓ | REST ✓
  Credentials:    1 (1 keychain)
  Last verified:  2026-05-03 (today)
  Last reviewed:  2026-05-03 (today)

splunk (Splunk)
  Preference:     cli
  Instances:      prod (default), security
  Interfaces:     CLI ✓ | MCP — | REST ✓
  Last verified:  2026-04-29 (4 days ago)
  Last reviewed:  2026-04-29 (4 days ago)

INACTIVE (configured but disabled):

linear (Linear)
  Last verified:  2025-11-15
  To reactivate:  /core:integrations:setup linear

NOT YET CONFIGURED:

  outlook, onedrive, teams, discord, datadog
  (run /core:integrations:setup <name> to configure)

Status:
  Active integrations:        3
  Pending verification (>14d): 0
  Pending review (>180d):     0
  Credentials approaching rotation: 0
```

### Single integration — `<integration>`

```bash
/core:integrations:manifest jira
```

Detailed view of one integration including all interfaces,
credentials (storage type only, never values), scopes, and
timestamps.

### Query mode — `--query <jq-path>`

```bash
/core:integrations:manifest --query "integrations.jira.preference"
# → "cli"

/core:integrations:manifest --query "integrations.jira.interfaces.cli.available"
# → true

/core:integrations:manifest --query "integrations | keys"
# → ["github", "jira", "splunk", ...]

/core:integrations:manifest --query "[integrations | to_entries[] | select(.value.active == true) | .key]"
# → ["github", "jira", "splunk"]
```

Standard jq syntax. Useful for programmatic access from other
commands or external skills.

### Review mode — `--review`

Periodic explicit revisitation. Updates `lastReviewed` for
active integrations:

```
=== Integration Review ===

jira (Atlassian)
  Last reviewed: 2025-11-01 (183 days ago)
  
  Still want this integration active? [Y/n/edit]

  Y → confirms; updates lastReviewed
  n → deactivates (preserves credentials in keychain;
                    can reactivate via /core:integrations:setup --update)
  edit → opens setup walkthrough for changes
```

Per integration. Useful as part of annual review workflow.

### Set default instance — `--set-default-instance <id>`

For multi-instance integrations, change which instance
commands use by default:

```bash
/core:integrations:manifest splunk --set-default-instance security
```

```
=== Default Instance Change ===

Integration: splunk
Current default: prod
New default:     security

Confirm? [y/N]
```

After confirmation, commands without `--instance` flag use
the new default.

### List instances — `--list-instances`

```bash
/core:integrations:manifest splunk --list-instances
```

```
=== Splunk Instances ===

prod (default)
  URL: https://splunk-prod.example.com:8089
  Last verified: 2026-04-29

security
  URL: https://splunk-sec.example.com:8089
  Last verified: 2026-04-29
```

## Cross-namespace integration

Other suite commands query this manifest as part of pre-flight:

```bash
# In a workflow command that needs Jira
ACTIVE=$(jq -r '.integrations.jira.active // false' \
              product/.pencil-integrations.json 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  echo "Jira integration not active. Run /core:integrations:setup jira"
  exit 1
fi
```

External SKILL.md files do the same.

## Staleness reporting

The default show mode flags timestamps approaching thresholds:

```
splunk (Splunk)
  Last verified: 2026-04-15 (18 days ago) ⚠ stale
                  Run /core:integrations:setup splunk --check
```

Thresholds from manifest's `stalenessThresholds`:
- verificationDays (default 14): triggers verification warning
- reviewDays (default 180): triggers review warning
- credentialRotationDays (default 90): triggers rotation reminder
  (handled by `/core:integrations:credentials --doctor`)

## Privacy

This command never displays credential values. Even in verbose
modes, credentials show as:

```
JIRA_API_TOKEN: keychain (skillz-jira / api-token)
                stored: 2026-02-01 (92 days ago)
```

The reference (storage location) is shown; the value never.
Doctor mode (`/core:integrations:credentials`) verifies retrievability
without surfacing values.

## What this command does NOT do

- **Modify credentials.** Credential changes route through
  `/core:integrations:setup`.
- **Display credential values.** Privacy boundary; never.
- **Test connectivity.** Use `/core:integrations:setup --check`.
- **Add new integrations to the registry.** Use
  `/core:integrations:declare`.
- **Auto-rotate credentials.** Doctor mode flags rotation
  candidates; rotation is user's call.

## Examples

```bash
# Show all integrations
/core:integrations:manifest

# Single integration detail
/core:integrations:manifest jira

# Programmatic access
/core:integrations:manifest --query "integrations.jira.preference"

# Periodic review
/core:integrations:manifest --review

# Switch default instance
/core:integrations:manifest splunk --set-default-instance security

# List configured instances
/core:integrations:manifest splunk --list-instances
```

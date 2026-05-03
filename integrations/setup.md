---
description: Configure or verify an integration's authentication. Detects available interfaces (CLI/MCP/REST), recommends preference (CLI default when available), walks through credential collection per interface, stores credentials in OS keychain (or env where appropriate), tests connectivity. Re-run with --check to verify without re-collecting credentials.
argument-hint: <integration-name> [--instance <id>] [--check] [--update] [--reset]
allowed-tools: Read, Write, Edit, Bash
---

Configure or verify an integration. Walks through interface
detection, preference selection, credential collection, and
connectivity testing. Stores credentials via OS keychain when
sensitive; env-var when not.

## Modes

### Default — full setup

```bash
/integrations:setup jira
```

For first-time setup of an integration. Detects interfaces,
recommends preference, collects credentials, tests
connectivity, persists state. Updates `lastDetected`,
`lastVerified`, and `lastReviewed` for the integration.

### Verification — `--check`

```bash
/integrations:setup jira --check
```

Re-verifies the integration's interfaces and credentials
without re-collecting. Updates `lastVerified` only. Useful
periodically (every 14 days by default per staleness threshold).

### Update — `--update`

```bash
/integrations:setup jira --update
```

Re-detect interfaces (e.g., CLI was just installed) without
re-collecting credentials. Updates `lastDetected` and
`lastVerified`.

### Reset — `--reset`

```bash
/integrations:setup jira --reset
```

Removes all stored credentials for the integration (keychain
entries deleted; env vars left alone since the suite doesn't
manage env). Marks integration `active: false`. The integration
entry is preserved with detection signals so future re-setup
is faster.

### Multi-instance — `--instance <id>`

```bash
/integrations:setup splunk --instance prod
/integrations:setup github --instance enterprise
```

For integrations supporting multiple endpoints. Each instance
has its own credentials and possibly its own preference.

## Phase 0: discovery

1. Read `tools/<integration>.md` (or `integrations/<name>.md`?
   no — integrations live at top level of `integrations/`)
   for the integration's metadata: provider, available
   interfaces, auth methods per interface, scopes,
   capabilities.
2. Read `product/.pencil-integrations.json` if it exists.
   Existing entry indicates re-setup; missing entry indicates
   first-time.
3. Detect platform via the keychain helper.

```bash
PLATFORM=$(detect_platform)
KEYCHAIN_AVAILABLE=$(keychain_available && echo true || echo false)

if [ "$KEYCHAIN_AVAILABLE" = "false" ]; then
  echo "Note: OS keychain not available in this environment."
  echo "Credentials will be stored as env-var references only."
  echo "For at-rest encryption, run setup on a desktop environment"
  echo "with keychain access."
fi
```

## Phase 1: per-interface detection

For each interface the integration supports, detect availability:

### CLI detection

```bash
detect_cli() {
  local INTEGRATION="$1"
  case "$INTEGRATION" in
    jira)
      command -v jira >/dev/null 2>&1 && echo "available"
      ;;
    github)
      command -v gh >/dev/null 2>&1 && echo "available"
      ;;
    splunk)
      command -v splunk >/dev/null 2>&1 && echo "available"
      ;;
    datadog)
      command -v datadog-ci >/dev/null 2>&1 && echo "available"
      ;;
    # ... per-integration detection logic
  esac
}
```

Each integration's CLI detection lives in its own file's
"Detection" section. Setup reads that section to determine
the check.

### MCP detection

```bash
detect_mcp() {
  local INTEGRATION="$1"
  local SERVER_NAME="$2"  # from integration's metadata
  
  # Check whether MCP tool prefix is exposed
  # The actual mechanism depends on environment introspection
  # capability — this is environment-dependent
  
  # In claude-code: check ~/.claude/projects/<...>/mcp_config.json
  # In opencode: similar
  # In API contexts: check available tool names for prefix
  
  # Best-effort detection
  if mcp_tool_prefix_available "mcp__${SERVER_NAME}__"; then
    echo "available"
  fi
}
```

When MCP detection isn't reliable in the current environment,
setup asks the user: "Is the Atlassian MCP server connected
in this environment? [Y/N]"

### REST detection

```bash
detect_rest() {
  # REST is always "available" in the sense of "the API exists"
  # The real question is "are credentials configured?"
  # That's checked in Phase 3 after collection
  echo "available"
}
```

REST availability becomes meaningful only when paired with
credentials. Setup confirms intent: "REST API access requires
manual credential management. Continue with REST setup? [y/N]"

## Phase 2: preference selection

Present detected interfaces to the user:

```
=== Setup: Jira Integration ===

Detection:
  ✓ Jira CLI installed (jira v1.5.2)
  ? Atlassian MCP — needs confirmation
  ✓ REST API (Jira Cloud)

Recommended preference: cli
  - CLI is canonical, well-documented, stable
  - Best for scripting and reproducible workflows

Alternatives:
  - mcp: prefer MCP for richer agentic interactions
         (recommended when working with AI agents that
         benefit from structured tool access)
  - rest: direct REST API calls
         (most explicit; useful for compliance contexts)

Choice [Y to accept cli / m / r]:
```

The user picks. The choice persists in the manifest as
`preference: "cli"` (or "mcp" or "rest").

For multi-interface integrations, this choice can be overridden
per-invocation via flags later, but the persisted preference is
the default.

## Phase 3: instance configuration

For single-instance integrations, ask for the instance details:

```
Instance URL:
  Format: https://yourcompany.atlassian.net
  > https://example.atlassian.net

Project scoping (optional, comma-separated, leave blank for all):
  > SCOOL,TS

```

For multi-instance integrations, ask whether this is the
default instance or an additional one:

```
Existing instances configured: prod
This setup is for: [d]efault / [a]dditional / [r]eplace prod

If additional, provide instance ID:
  > security
```

## Phase 4: credential collection per interface

For each credential the integration's preferred interface
needs, walk through:

### Step 1: identify what's needed

```bash
# Read credential list from integration's metadata
# Each credential has:
#   - name (e.g., JIRA_API_TOKEN)
#   - description (what this is)
#   - sensitive (true/false; affects default storage)
#   - whereToObtain (URL or instructions for getting the value)

CREDENTIALS=$(read_integration_credentials "$INTEGRATION" "$PREFERENCE")
```

### Step 2: per-credential collection

```
=== Credential: JIRA_API_TOKEN ===

Description: Jira API token for REST authentication
Sensitive:   yes
Get from:    https://id.atlassian.com/manage-profile/security/api-tokens

Storage choice:
  [k] Keychain (encrypted, recommended for sensitive)
  [e] Environment variable (you manage exposure)

Default: k (sensitive credential)

Choice [K/e]:
```

For sensitive credentials, default is keychain. The user can
override to env if they have other constraints (CI environment
that doesn't have keychain, or organizational policy requiring
external secrets manager that exposes via env).

### Step 3: value entry (or env-only signal)

For keychain storage:

```
Enter value (input hidden):
  >
```

The value is read with stty -echo so it doesn't appear on
terminal. After entry:

```bash
keychain_store "skillz-jira" "api-token" "$VALUE" "Skillz: Jira API Token"
```

For env-only:

```
Storage: environment variable JIRA_API_TOKEN

This setup will record the env var name in the manifest, but
will NOT capture the value (you provide it via your shell or
secrets manager when running commands).

Verify: is JIRA_API_TOKEN currently set in your environment?
[Y]es, currently set / [N]ot set, will set later

Choice:
```

If "currently set," setup tests retrieval works. If "not set,"
setup records the requirement and notes that integration will
fail until env var is set.

### Step 4: round-trip verification

For keychain credentials, verify the value can be retrieved:

```bash
RETRIEVED=$(keychain_retrieve "skillz-jira" "api-token")
if [ "$RETRIEVED" != "$VALUE" ]; then
  echo "ERROR: Keychain round-trip failed."
  echo "Stored value couldn't be retrieved. This may indicate:"
  echo "  - Permission issue with keychain"
  echo "  - Backend instability (Linux: Secret Service may be unavailable)"
  echo "  - Encoding issue with credential value"
  exit 1
fi
unset VALUE RETRIEVED
```

If round-trip fails, setup stops with diagnostics. Better to
know now than at first invocation.

## Phase 5: connectivity test

With credentials configured, test that the integration actually
works:

```
Testing connection to Jira...

Using: cli (jira CLI)
Command: jira me

Result:
  ✓ Connected to https://example.atlassian.net
  ✓ Authenticated as edwin@example.com
  ✓ Read scope confirmed (queried user profile)
  ✓ Project access: SCOOL, TS, OTHER (3 projects accessible)

Configuration verified.
```

The test command per interface lives in the integration's
metadata. For Jira CLI: `jira me`. For Jira REST: a curl to
`/rest/api/3/myself`. For Jira MCP: a corresponding MCP tool
call.

If the test fails:

```
Connection test failed.

Error: 401 Unauthorized

Likely causes:
  - API token expired or revoked
  - Email doesn't match the token's owner
  - Instance URL is wrong

Recheck credentials? [Y/n]
```

User can retry, abort, or save partial config and debug
manually.

## Phase 6: persist manifest

Write to `product/.pencil-integrations.json`:

```jsonc
{
  "integrations": {
    "jira": {
      "active": true,
      "preference": "cli",
      "instanceUrl": "https://example.atlassian.net",
      "interfaces": {
        "cli": {
          "available": true,
          "verifiedAt": "<now>",
          "executable": "jira",
          "version": "1.5.2"
        },
        "mcp": {
          "available": false,
          "verifiedAt": "<now>"
        },
        "rest": {
          "available": true,
          "verifiedAt": "<now>",
          "baseUrl": "https://example.atlassian.net/rest/api/3"
        }
      },
      "credentials": {
        "JIRA_EMAIL": {
          "storage": "env",
          "envVar": "JIRA_EMAIL"
        },
        "JIRA_API_TOKEN": {
          "storage": "keychain",
          "service": "skillz-jira",
          "account": "api-token",
          "storedAt": "<now>"
        }
      },
      "scopes": ["read:jira-work", "write:jira-work"],
      "perResourceScoping": {
        "projects": ["SCOOL", "TS"]
      },
      "lastDetected": "<now>",
      "lastVerified": "<now>",
      "lastReviewed": "<now>"
    }
  }
}
```

Backup created before overwriting; existing config preserved.

## Phase 7: report

```
=== Setup Complete: Jira ===

Integration:    jira (Atlassian)
Instance URL:   https://example.atlassian.net
Preference:     cli (Jira CLI v1.5.2)

Interfaces:
  CLI:  ✓ available
  MCP:  ✗ not available
  REST: ✓ available

Credentials:
  JIRA_EMAIL:     env (JIRA_EMAIL)
  JIRA_API_TOKEN: keychain (skillz-jira / api-token)

Connection test: ✓ passed

Next steps:
  - Use directly: /integrations:jira "<prompt>"
  - Verify health: /integrations:credentials --doctor
  - Re-verify periodically: /integrations:setup jira --check

The integration is ready.
```

## Re-running setup (--update)

`--update` mode re-runs detection (in case CLI was installed,
MCP was added, etc.) without re-collecting credentials. Updates
detection state and `lastVerified`. Doesn't update
`lastReviewed`.

## Re-running setup (--check)

`--check` mode verifies the configuration is still valid:

- Are detected interfaces still available?
- Can credentials still be retrieved?
- Does the connectivity test still pass?

Updates `lastVerified` only. No prompts unless something
changed.

## Reset behavior

`--reset` removes all stored credentials and marks the
integration inactive:

```bash
# For each keychain-stored credential
for CRED_NAME in $(get_credential_names "$INTEGRATION"); do
  STORAGE=$(get_storage_type "$INTEGRATION" "$CRED_NAME")
  if [ "$STORAGE" = "keychain" ]; then
    SERVICE=$(get_keychain_service "$INTEGRATION" "$CRED_NAME")
    ACCOUNT=$(get_keychain_account "$INTEGRATION" "$CRED_NAME")
    keychain_delete "$SERVICE" "$ACCOUNT"
    echo "Deleted keychain entry: $SERVICE / $ACCOUNT"
  fi
done

# Mark integration inactive
jq '.integrations.<name>.active = false' product/.pencil-integrations.json
```

The integration entry remains with detection signals; rerunning
setup is faster than first-time setup.

For env-var credentials, `--reset` doesn't unset env vars (the
suite doesn't manage user env). It just removes the credential
references from the manifest.

## Microsoft 365 shared auth

When setting up an integration that uses shared auth
(Outlook, OneDrive, Teams via Microsoft Graph), setup checks if
the shared auth provider is already configured:

```
Outlook uses Microsoft Graph authentication, shared with
OneDrive and Teams.

Microsoft Graph status:
  Already authenticated as: edwin@example.com

  Use existing authentication for Outlook? [Y/configure-new]
```

If existing auth works, Outlook activates without re-OAuth.
If user wants different identity (different account), they
configure new and shared-auth providers list grows.

## What this command does NOT do

- **Implement OAuth flows directly.** OAuth is delegated to
  the CLI (which handles its own OAuth) or MCP (which does the
  same). For REST-only integrations, the user generates an API
  token externally and provides it.
- **Manage env var setting.** Setup records env var
  requirements in the manifest; the user handles their shell
  env or secrets manager.
- **Auto-rotate credentials.** Surfaces rotation reminders via
  `/integrations:credentials --doctor` but doesn't rotate.
- **Pull credentials from external secrets managers.** That's
  user responsibility; the suite reads env vars at invocation
  time, however the user populated them.

## Examples

```bash
# First-time setup
/integrations:setup jira

# Verify health
/integrations:setup jira --check

# Re-detect (after installing CLI)
/integrations:setup jira --update

# Multi-instance
/integrations:setup splunk --instance prod
/integrations:setup splunk --instance security

# Reset (remove credentials, deactivate)
/integrations:setup jira --reset
```

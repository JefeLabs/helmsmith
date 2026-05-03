---
description: Splunk integration for log search, metrics, alerts, and dashboards. Two interfaces — CLI (Splunk SDK CLI) and REST. MULTI-INSTANCE pattern: enterprise organizations frequently maintain separate Splunk instances for production observability vs security/SIEM. The integration handles multiple instances with per-instance credentials, search defaults, and explicit instance selection. Heavily relevant for financial-institution contexts.
argument-hint: <free-form-prompt> [--instance prod|security|<custom>] [--use-cli]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`.

Direct invocation of Splunk for log search and analysis. The
integration validates the **multi-instance pattern** —
enterprise organizations commonly run multiple Splunk
deployments serving different purposes (production
observability vs security/SIEM). Each instance has its own
URL, credentials, and access scope.

This integration is the most relevant for Edwin's financial-
institution consulting context, where Splunk is typically
the SIEM platform with strict access controls.

## Phase 0: pre-flight

1. Verify integration is active:

   ```bash
   ACTIVE=$(jq -r '.integrations.splunk.active // false' \
                 product/.pencil-integrations.json)
   if [ "$ACTIVE" != "true" ]; then
     echo "Splunk not active. Run /integrations:setup splunk"
     exit 1
   fi
   ```

2. Resolve target instance:

   ```bash
   # Default instance from manifest, or explicitly specified
   INSTANCE="${INSTANCE_ARG:-$(jq -r '.integrations.splunk.defaultInstance // empty' \
                                     product/.pencil-integrations.json)}"
   
   if [ -z "$INSTANCE" ]; then
     # No default and no explicit selection — list and prompt
     INSTANCES=$(jq -r '.integrations.splunk.instances | keys[]' \
                       product/.pencil-integrations.json)
     INSTANCE_COUNT=$(echo "$INSTANCES" | wc -l)
     
     if [ "$INSTANCE_COUNT" -eq 1 ]; then
       INSTANCE=$(echo "$INSTANCES")
     else
       echo "Multiple Splunk instances configured. Which one?"
       for i in $INSTANCES; do
         DESC=$(jq -r ".integrations.splunk.instances.${i}.description // \"\"" \
                       product/.pencil-integrations.json)
         echo "  - $i: $DESC"
       done
       echo ""
       echo "Select with --instance <name>"
       exit 1
     fi
   fi
   ```

3. Resolve credentials for selected instance:

   ```bash
   INSTANCE_URL=$(jq -r ".integrations.splunk.instances.${INSTANCE}.url // empty" \
                        product/.pencil-integrations.json)
   
   PREFERENCE=$(jq -r ".integrations.splunk.instances.${INSTANCE}.preference // \"rest\"" \
                      product/.pencil-integrations.json)
   
   case "$PREFERENCE" in
     rest)
       SPLUNK_TOKEN=$(resolve_credential "splunk" \
                       "SPLUNK_${INSTANCE}_TOKEN")
       [ -n "$SPLUNK_TOKEN" ] || {
         echo "Splunk token missing for instance '$INSTANCE'"
         echo "Run /integrations:setup splunk --instance $INSTANCE"
         exit 1
       }
       ;;
     cli)
       command -v splunk >/dev/null 2>&1 || {
         echo "splunk CLI not installed"
         exit 1
       }
       ;;
   esac
   ```

   Per-instance credentials use `SPLUNK_<INSTANCE>_TOKEN` /
   `SPLUNK_<INSTANCE>_USER` etc. as keychain account names.
   This prevents token confusion across instances.

## Phase 1: prompt interpretation

Operations Splunk handles:

### Search

- **SPL search**: full Splunk Search Processing Language
  queries with time range
- **Saved searches**: invoke saved search by name
- **Real-time search**: stream events matching criteria
- **Job management**: long-running searches with job IDs

### Indexes and sources

- **List indexes**: discover what's available on the instance
- **Index metadata**: retention, size, source types
- **Source types**: parsers configured

### Alerts

- **List alerts**: configured alerts on the instance
- **Alert state**: which are firing, recent history
- **Trigger / suppress alert**: limited; depends on
  permissions

### Dashboards

- **List dashboards**: by user, by app
- **Get dashboard XML**: definition
- **Saved searches in dashboards**: extracted

### Reports

- **List reports**: scheduled reports
- **Report results**: latest run output

### Multi-instance context

The integration always operates against ONE instance per
invocation. When the prompt is ambiguous about which
instance to query:

```
=== Multiple Splunk Instances Configured ===

Your prompt: "search for failed authentication events"

Available instances:
  [p] prod (Production observability)
      URL: https://splunk-prod.example.com:8089
      Indexes: app_logs, infra_logs, build_logs
  
  [s] security (SIEM / security)
      URL: https://splunk-security.example.com:8089
      Indexes: auth_audit, network_flow, endpoint
      Note: failed authentication queries typically belong here

Which instance?
```

## Phase 2: execution

### REST path

Splunk REST API uses session keys (token-based auth):

```bash
SPLUNK_TOKEN=$(resolve_credential "splunk" "SPLUNK_${INSTANCE}_TOKEN")
SPLUNK_URL="${INSTANCE_URL}"

# Submit a search job
JOB_SID=$(curl -sSk \
  -H "Authorization: Bearer $SPLUNK_TOKEN" \
  -X POST "${SPLUNK_URL}/services/search/jobs" \
  -d "search=$(echo "search index=app_logs error" | jq -sRr @uri)" \
  -d "exec_mode=blocking" \
  -d "earliest_time=-1h" \
  -d "latest_time=now" \
  -d "output_mode=json" | \
  jq -r '.sid')

# Poll for results (or with exec_mode=blocking, results are ready)
curl -sSk \
  -H "Authorization: Bearer $SPLUNK_TOKEN" \
  "${SPLUNK_URL}/services/search/jobs/${JOB_SID}/results?output_mode=json"

# Or one-shot search (smaller results)
curl -sSk \
  -H "Authorization: Bearer $SPLUNK_TOKEN" \
  -X POST "${SPLUNK_URL}/services/search/jobs/oneshot" \
  -d "search=$(echo "search index=auth_audit failed_login" | jq -sRr @uri)" \
  -d "earliest_time=-24h" \
  -d "output_mode=json"

# List indexes
curl -sSk \
  -H "Authorization: Bearer $SPLUNK_TOKEN" \
  "${SPLUNK_URL}/services/data/indexes?output_mode=json"

# List alerts
curl -sSk \
  -H "Authorization: Bearer $SPLUNK_TOKEN" \
  "${SPLUNK_URL}/services/saved/searches?output_mode=json&search=is_scheduled=1+AND+alert_type=*"

unset SPLUNK_TOKEN
```

Note the `-k` flag — Splunk on-prem deployments often use
self-signed certificates. The integration's manifest config
allows specifying whether to verify TLS:

```jsonc
{
  "instances": {
    "prod": {
      "url": "...",
      "tlsVerify": true   // or false for self-signed
    }
  }
}
```

### CLI path

The Splunk SDK provides a CLI:

```bash
splunk search "index=app_logs error earliest=-1h latest=now" \
  -auth admin:password \
  -uri "$SPLUNK_URL"

# Splunk CLI requires installed Splunk software OR the
# Splunk Add-On Builder; less common in development environments.
# REST is generally preferred for automation.
```

## Phase 3: result formatting

### Search results

```
=== Splunk Search ===
Instance: security
Index:    auth_audit
Query:    failed_login user=admin
Range:    last 24 hours

Results: 47 events

Recent (last 5):

  2026-05-04 13:42:15 UTC
    user: admin · src_ip: 203.0.113.45
    auth_method: password · failure_reason: invalid_password
    user_agent: Mozilla/5.0 ...
  
  2026-05-04 13:38:22 UTC
    user: admin · src_ip: 203.0.113.45
    auth_method: password · failure_reason: invalid_password
  
  ... (3 more)

Aggregate by source IP:
  203.0.113.45: 32 attempts (potential brute force)
  198.51.100.12: 8 attempts
  192.0.2.7: 7 attempts

Suggested investigation:
  /integrations:splunk --instance security \
    "search source IP 203.0.113.45 across all auth events
     in the last 7 days"
```

### Multi-instance correlation

When the user asks a question that spans both prod and
security:

```
Your prompt suggests data from multiple instances:
  - "show me errors AND security alerts for the auth service"

Splunk doesn't allow cross-instance queries directly.
Options:

  [s] Query each instance separately (sequential)
  [p] Query prod for errors first, then security for alerts
  [c] Cancel; refine prompt to one instance

Choice:
```

The integration runs sequentially against each instance and
correlates results in the output:

```
=== Cross-Instance Query: auth-service ===
Time range: last 4 hours

prod instance results:
  Errors: 234
    - DatabaseConnectionError: 187 (80%)
    - TokenValidationError: 32
    - RateLimitExceeded: 15

security instance results:
  Alerts: 3 (2 critical, 1 warning)
    - critical: Brute force from 203.0.113.45 (linked to
                32 of the auth errors above)
    - critical: Privilege escalation attempt user=admin
    - warning: Off-hours admin access attempt

Correlation:
  - 32 of the 234 auth errors are linked to brute-force
    activity from 203.0.113.45
  - The remaining 202 errors appear infrastructure-related
    (database connection issues)

Suggested follow-up:
  - For brute force: investigate IP 203.0.113.45
  - For database errors: check connection pool config
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 | Token expired or invalid | Re-run /integrations:setup splunk --instance <name> |
| 403 | Insufficient permissions | Check user roles in Splunk |
| 404 | Index doesn't exist | Verify index name; permissions may hide existence |
| TLS verification failed | Self-signed cert without tlsVerify=false | Set tlsVerify: false in instance config (with awareness) |
| Search syntax error | Invalid SPL | Surface the SPL error; suggest correction |
| Quota exceeded | License or daily quota | Cannot bypass; wait for reset |
| Read timeout | Long-running search | Use job-mode (asynchronous) instead of oneshot |

## Cross-namespace integration

Splunk is consumed by:

- **Direct user invocation** for log search and analysis
- **Incident response** workflows
- **`engineer:capability-introduction`** when introducing
  capabilities that need Splunk dashboards/alerts
- **Compliance audit** workflows — Splunk is often the
  evidence source for compliance audits in regulated
  industries

## Multi-instance manifest pattern

```jsonc
{
  "integrations": {
    "splunk": {
      "active": true,
      "defaultInstance": "prod",
      "instances": {
        "prod": {
          "description": "Production observability",
          "url": "https://splunk-prod.example.com:8089",
          "preference": "rest",
          "tlsVerify": true,
          "credentials": {
            "SPLUNK_PROD_TOKEN": {
              "storage": "keychain",
              "keychainAccount": "agentx-skillzkit-splunk-prod-token"
            }
          },
          "defaultIndexes": ["app_logs", "infra_logs"]
        },
        "security": {
          "description": "Security / SIEM",
          "url": "https://splunk-security.example.com:8089",
          "preference": "rest",
          "tlsVerify": true,
          "credentials": {
            "SPLUNK_SECURITY_TOKEN": {
              "storage": "keychain",
              "keychainAccount": "agentx-skillzkit-splunk-security-token"
            }
          },
          "defaultIndexes": ["auth_audit", "network_flow", "endpoint"],
          "complianceMode": "strict"
        }
      }
    }
  }
}
```

The pattern generalizes to other integrations needing multi-
instance support:

- **GitHub multi-instance**: github.com + GitHub Enterprise
- **Jira multi-instance**: multiple Atlassian sites
- **Datadog**: theoretically (multiple regions/orgs)
- **AWS**: multiple accounts (when AWS integration added)

## Compliance mode

The `complianceMode: "strict"` field on an instance enables
additional safeguards relevant for compliance contexts:

- **No prompt logging**: query content not written to local
  logs (the user's query of "search for SSN patterns" stays
  on the user's machine)
- **No result caching**: results not cached locally; each
  invocation re-runs against Splunk
- **Explicit confirmation for write operations**: any write
  (saved search, alert modification, dashboard edit)
  requires explicit user confirmation
- **Session timeout enforcement**: tokens force-refreshed
  more frequently
- **Audit trail emission**: each invocation emits a local
  audit record of what was queried, when

When set on the security instance (typical), the integration
applies these safeguards. When set on prod (uncommon),
behavior is the same.

## What this integration does NOT do

- **Replace the Splunk UI for visualization.** Dashboards,
  drill-downs, search visualizations — UI handles those
  better.
- **Cross-instance queries directly.** Each invocation
  targets one instance.
- **Manage Splunk admin.** User provisioning, role
  configuration, app installation — admin operations not
  in scope.
- **Bypass compliance controls.** If your Splunk has
  search-time audit logging, the integration appears in
  those audits like any other client.
- **Real-time streaming for ingestion.** Splunk's HEC (HTTP
  Event Collector) for log ingestion is a separate concern
  (typically configured at the application/agent level, not
  via this integration).

## Examples

```bash
# Query prod instance for errors
/integrations:splunk --instance prod \
  "search index=app_logs error earliest=-1h"

# Query security instance for failed logins
/integrations:splunk --instance security \
  "find failed login attempts in the last 24 hours"

# Use default instance (prod, per manifest)
/integrations:splunk "search recent errors for the auth service"

# Cross-instance correlation (sequential queries)
/integrations:splunk \
  "show me errors AND security alerts for the auth service"

# Specific saved search
/integrations:splunk --instance security \
  "run the daily_failed_admin_logins saved search"
```

---

# Registry definition

## Integration metadata

```yaml
name: splunk
displayName: Splunk
provider: splunk-inc
category: observability-siem
multiInstance: true   # validated pattern
canBeDelegated: false
```

## Interfaces

### CLI

```yaml
executable: splunk
detectionCommand: command -v splunk
installCommand: |
  Splunk CLI ships with Splunk Enterprise / Universal Forwarder
  installations. Less common in dev environments — REST is
  generally preferred for automation.
notes: |
  CLI requires server URL and auth on each invocation;
  stateful auth (--auth admin:password) is fragile. REST
  with token auth is the recommended path.
```

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: per-instance (configured in manifest)
authMethod: bearer-token
authHeaders:
  - "Authorization: Bearer {SPLUNK_<INSTANCE>_TOKEN}"
documentationUrl: https://docs.splunk.com/Documentation/Splunk/latest/RESTREF
```

## Multi-instance support

The integration supports multiple instances natively. Each
instance has its own URL, credentials, preferences, and
default indexes. The `defaultInstance` field selects which
to use when not explicitly specified.

## Credentials per instance

Each instance has independent credentials with naming
convention `SPLUNK_<INSTANCE_NAME>_TOKEN`. Tokens are stored
in keychain with per-instance account names to prevent
confusion.

## Required by skillz commands

Auto-populated.

## Compliance considerations

Splunk in regulated industries (financial services,
healthcare, defense) typically has substantial compliance
controls:

- **SOC 2 / ISO 27001 audit**: Splunk usage is logged and
  audited
- **Search-time access controls**: roles restrict which
  indexes / sources / fields users can query
- **Data masking**: PII may be masked at search time based
  on user role
- **Retention compliance**: regulatory requirements (SOX, HIPAA,
  PCI-DSS) drive retention policy
- **Air-gapped instances**: government / defense Splunk may
  be air-gapped; requires separate auth setup

For Edwin's financial-institution consulting context: any
Splunk integration setup likely requires IT approval, and
the user's permissions will limit what the integration can
query. The integration respects whatever permissions the
user has.

The `complianceMode: "strict"` flag activates additional
local safeguards (no prompt logging, no caching, audit trail
emission). Use this for instances handling sensitive data.

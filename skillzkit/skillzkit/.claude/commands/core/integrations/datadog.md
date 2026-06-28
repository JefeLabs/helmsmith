---
description: Datadog observability integration for metrics, logs, monitors, dashboards, incidents, RUM, and APM. Two interfaces — CLI (datadog-ci, primarily for CI workflows) and REST (broader operations including queries and incident management). Default preference is REST. Multi-region support (US1, US3, US5, EU1, AP1) via configurable site URL. Heavily relevant for SkoolScout's AWS production observability.
argument-hint: <free-form-prompt> [--site us1|us3|us5|eu1|ap1] [--use-cli]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`.

Direct invocation of Datadog for observability operations.
The integration covers the breadth of Datadog's surface —
metrics, logs, monitors, dashboards, incidents, RUM, APM —
through two interfaces that complement each other.

## Phase 0: pre-flight

1. Verify integration is active:

   ```bash
   ACTIVE=$(jq -r '.integrations.datadog.active // false' \
                 product/.pencil-integrations.json)
   if [ "$ACTIVE" != "true" ]; then
     echo "Datadog not active. Run /core:integrations:setup datadog"
     exit 1
   fi
   ```

2. Resolve preferred interface and credentials:

   ```bash
   PREFERENCE=$(jq -r '.integrations.datadog.preference // "rest"' \
                     product/.pencil-integrations.json)
   
   DD_SITE=$(jq -r '.integrations.datadog.site // "datadoghq.com"' \
                   product/.pencil-integrations.json)
   
   case "$PREFERENCE" in
     cli)
       command -v datadog-ci >/dev/null 2>&1 || \
         npx --no-install datadog-ci --version >/dev/null 2>&1 || {
         echo "datadog-ci not installed."
         echo "  npm install -g @datadog/datadog-ci"
         echo "  Or: npm install --save-dev @datadog/datadog-ci"
         exit 1
       }
       ;;
     rest)
       DD_API_KEY=$(resolve_credential "datadog" "DATADOG_API_KEY")
       DD_APP_KEY=$(resolve_credential "datadog" "DATADOG_APP_KEY")
       [ -n "$DD_API_KEY" ] && [ -n "$DD_APP_KEY" ] || {
         echo "Datadog API/Application keys missing."
         echo "Run /core:integrations:setup datadog"
         exit 1
       }
       ;;
   esac
   ```

## Phase 1: prompt interpretation

Operations Datadog handles:

### Metrics

- **Query metrics**: by name, tag filters, time range,
  rollup (avg, sum, max, percentiles)
- **List active metrics**: discover metric inventory
- **Metric metadata**: type, unit, description
- **Submit custom metrics**: send time-series data points
  (POST `/api/v1/series`)

### Logs

- **Search logs**: by query string, time range, source,
  service, host
- **Live tail**: stream recent logs
- **Aggregate logs**: count, group-by, time-series
  aggregation
- **Log archives**: query archived logs (requires archive
  configuration)

### Monitors

- **List monitors**: by tag, by status (alert/warn/ok), by
  type
- **Get monitor details**: full configuration with thresholds
- **Monitor history**: state transitions over time
- **Mute / unmute monitor**: with optional duration
- **Search downtimes**: scheduled silences

### Dashboards

- **List dashboards**: by title, by tag, recently viewed
- **Get dashboard**: full definition (widgets, layout)
- **Create / update dashboard**: programmatic management
- **Export to JSON**: for version control

### Incidents

- **List incidents**: open, recent, by severity
- **Get incident**: timeline, responders, attachments
- **Create incident**: declare new with severity
- **Update incident**: timeline updates, status changes
- **Postmortem export**: generate postmortem template

### APM and RUM

- **Service inventory**: services Datadog has detected
- **Service performance**: latency, error rate, throughput
- **Trace search**: find traces matching criteria
- **RUM events**: user-session events with frontend errors,
  page views

### Synthetics

- **List synthetic tests**: API and browser tests
- **Test results**: recent runs, failures
- **Trigger test run**: ad-hoc execution

## Phase 2: execution

### REST path (default)

```bash
DD_API_KEY=$(resolve_credential "datadog" "DATADOG_API_KEY")
DD_APP_KEY=$(resolve_credential "datadog" "DATADOG_APP_KEY")
DD_SITE_API="https://api.${DD_SITE}"

# Query a metric
NOW=$(date +%s)
ONE_HOUR_AGO=$((NOW - 3600))

curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "${DD_SITE_API}/api/v1/query?from=${ONE_HOUR_AGO}&to=${NOW}&query=avg:system.cpu.user{service:skoolscout-api}"

# Search logs
curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -X POST "${DD_SITE_API}/api/v2/logs/events/search" \
  -d '{
    "filter": {
      "query": "service:skoolscout-api status:error",
      "from": "now-1h",
      "to": "now"
    },
    "page": { "limit": 50 },
    "sort": "-timestamp"
  }'

# List monitors with state
curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "${DD_SITE_API}/api/v1/monitor?monitor_tags=service:skoolscout-api&group_states=alert,warn"

# Mute a monitor
curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -X POST "${DD_SITE_API}/api/v1/monitor/${MONITOR_ID}/mute"

# List dashboards
curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "${DD_SITE_API}/api/v1/dashboard"

# Get incident
curl -sS \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "${DD_SITE_API}/api/v2/incidents/${INCIDENT_ID}"

unset DD_API_KEY DD_APP_KEY
```

### CLI path

`datadog-ci` is the dedicated CLI; it's primarily for CI/CD
workflows but has broader operations:

```bash
# Common datadog-ci operations
datadog-ci synthetics run-tests --apiKey "$DD_API_KEY" \
                                 --appKey "$DD_APP_KEY" \
                                 --files "tests/synthetics/*.json"

datadog-ci sourcemaps upload \
  --service skoolscout-app-ui \
  --release-version "$(git rev-parse HEAD)"

datadog-ci tag --tags "deployment:${DEPLOY_ID},env:staging"

# Junit upload (test results to Datadog Test Visibility)
datadog-ci junit upload --service skoolscout-api \
                         --env staging \
                         test-results/junit.xml
```

The CLI is more concise for common CI operations but covers
fewer query/management operations than REST. The integration
routes to CLI when the prompt fits (deployment markers,
sourcemap uploads, junit uploads); otherwise REST.

## Phase 3: result formatting

### Metric query

```
=== Datadog: Metric Query ===
Site:    us1.datadoghq.com
Query:   avg:system.cpu.user{service:skoolscout-api}
Range:   last 1 hour

Time-series values (60 points, 1-min interval):

   12:00 PM  ████████░░  42%
   12:05 PM  █████████░  47%
   12:10 PM  █████████░  48%
   12:15 PM  ████████░░  43%
   12:20 PM  ███████░░░  38%
   ...
   1:00 PM   ████████░░  44%

Stats:
  min:  31% (12:35 PM)
  max:  52% (12:48 PM)
  avg:  43%
  p95:  50%

Time anomalies: none detected
```

### Log search

```
=== Datadog: Log Search ===
Query:   service:skoolscout-api status:error
Range:   last 1 hour
Site:    us1.datadoghq.com
Total matches: 47

Recent (last 10):

  1:24:32 PM  ERROR  skoolscout-api / api-gateway
    AuthService: Invalid token signature
    request_id: abc-123 · user_id: u_456 · trace_id: ...
  
  1:21:15 PM  ERROR  skoolscout-api / api-gateway
    DatabaseError: connection pool exhausted
    request_id: def-456 · trace_id: ...
  
  ... (8 more)

Aggregate by error type:
  AuthService.Invalid token signature: 32 (68%)
  DatabaseError.Connection pool exhausted: 12 (26%)
  ValidationError.Invalid input: 3 (6%)

Top affected requests:
  /api/auth/refresh: 28 errors
  /api/students: 12 errors
  /api/compliance/submit: 5 errors

Suggested action: investigate auth token rotation issue
(68% of errors); check connection pool sizing.
```

### Monitor status

```
=== Datadog: Monitor Status ===
Tag filter: service:skoolscout-api
Site:       us1.datadoghq.com

ALERT (1):
  [Monitor #12345] API error rate > 5%
    Triggered: 14 minutes ago
    Current value: 7.2% (threshold: 5%)
    
    Action: /core:integrations:datadog "show me logs from the last 30 minutes for skoolscout-api errors"

WARN (2):
  [Monitor #12346] API latency p95 > 800ms
    Triggered: 3 hours ago
    Current value: 845ms (threshold: 800ms)
  
  [Monitor #12347] Database connection pool > 80%
    Triggered: 1 hour ago
    Current value: 87% (threshold: 80%)

OK (12):
  Other monitors healthy.

Total monitors for service: 15
```

### Incident summary

```
=== Datadog Incident: INC-2026-014 ===
Title:    Compliance API outage
Severity: SEV-2
Status:   active (14 minutes)
Started:  1:24 PM today

Commander: Sarah Chen
Responders: Edwin (engineering), Tom (DBA)

Timeline:
  1:24 PM  Incident declared
  1:25 PM  Sarah ack'd alert; investigating
  1:32 PM  Tom: identified DB connection pool exhaustion
  1:36 PM  Tom: pool size increased; monitoring
  1:38 PM  (now)

Affected services: skoolscout-api, compliance-worker
Affected users: ~340 active sessions

Postmortem: https://datadoghq.com/incidents/INC-2026-014/postmortem
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 / 403 | API key or App key invalid | Verify keys in Datadog → Organization Settings |
| 404 (monitor / dashboard) | ID doesn't exist or no access | Verify ID; check team permissions |
| 429 Throttled | Rate limit | Datadog has generous rate limits; rare |
| Wrong site | Site param mismatched | Verify site (us1 vs eu1, etc.) — keys are region-scoped |

## Cross-namespace integration

Datadog is consumed by:

- **Direct user invocation** for observability
- **`engineer:capability-introduction`** workflows — verify
  observability before declaring capability complete
- **Incident response workflows** (when added) — automated
  incident creation from monitor alerts
- **CI/CD** via `datadog-ci` for deployment markers,
  sourcemap uploads, test result tracking
- **`/core:integrations:teams` or `/core:integrations:discord`** —
  alert forwarding to messaging platforms

## Multi-region support

Datadog operates multiple regions; your keys are region-
scoped:

| Region | Site URL |
|--------|----------|
| US1 | datadoghq.com |
| US3 | us3.datadoghq.com |
| US5 | us5.datadoghq.com |
| EU1 | datadoghq.eu |
| AP1 | ap1.datadoghq.com |
| US1-FED | ddog-gov.com |

Set `site` field in manifest to the region matching your keys:

```jsonc
{
  "integrations": {
    "datadog": {
      "active": true,
      "preference": "rest",
      "site": "datadoghq.com"
    }
  }
}
```

If keys and site don't match, requests fail with auth errors
even though the keys themselves are valid.

## Cost awareness

Datadog billing is consumption-based. Heavy API usage
(particularly log queries with large time ranges) can drive
costs. The integration:

- Defaults to small time ranges (1 hour for queries)
- Surfaces estimated query cost when ranges exceed 24 hours
- Caches recent queries for 5 minutes to avoid duplicate
  charges

For SkoolScout's $450/mo AWS spend context: Datadog charges
are likely meaningful relative to infra costs. Stay aware
of query patterns.

## What this integration does NOT do

- **Replace the Datadog UI for visualization.** Dashboards,
  graphs, drill-downs — UI handles those better than text
  output.
- **Set up data collection.** The Datadog Agent, library
  integrations, and APM tracers are configured separately.
- **Manage Datadog account / billing.** Admin operations
  in the Datadog UI.
- **Handle Datadog Workflows / Mobile Apps.** Specialized
  surfaces; not in scope.
- **Long-running incident command.** The integration can
  read/update incidents but real-time war-room coordination
  happens in the Datadog UI or chat platforms.

## Examples

```bash
# Service health check
/core:integrations:datadog "show me current alerts for skoolscout-api"

# Recent errors
/core:integrations:datadog "find error logs from skoolscout-api in the last 30 minutes"

# Performance investigation
/core:integrations:datadog "what's the p95 latency on the auth endpoint over the last 6 hours"

# Active incidents
/core:integrations:datadog "list active incidents"

# Mute monitor for maintenance
/core:integrations:datadog "mute monitor 12345 for 2 hours during deployment"

# Deployment marker (CLI path)
/core:integrations:datadog "mark deployment of v1.4.2 to staging" --use-cli
```

---

# Registry definition

## Integration metadata

```yaml
name: datadog
displayName: Datadog
provider: datadog
category: observability
multiInstance: false
canBeDelegated: false
```

## Interfaces

### CLI

```yaml
executable: datadog-ci (or npx datadog-ci)
detectionCommand: |
  command -v datadog-ci || npx --no-install datadog-ci --version
installCommand: |
  Global: npm install -g @datadog/datadog-ci
  Project: npm install --save-dev @datadog/datadog-ci
notes: |
  CLI is primarily designed for CI/CD workflows
  (deployment markers, sourcemap uploads, junit uploads,
  synthetic test triggering). For broader query and
  management operations, REST is preferred.
```

### MCP

**Not available** at this time. May change as ecosystem
matures.

### REST

```yaml
baseUrl: https://api.{site}/api  # site varies by region
authMethod: dual-header
authHeaders:
  - "DD-API-KEY: {DATADOG_API_KEY}"
  - "DD-APPLICATION-KEY: {DATADOG_APP_KEY}"
documentationUrl: https://docs.datadoghq.com/api/
```

Datadog uses two keys:
- **API key**: identifies the org; used by agents and apps
  for ingest
- **Application key**: identifies the user/integration;
  required for read/management operations

## Credentials

### `DATADOG_API_KEY`

- **Description**: Datadog API key for the organization
- **Sensitive**: yes (keychain storage)
- **Where to obtain**: Datadog → Organization Settings → API Keys
- **Rotation**: 90 days default; rotate via UI

### `DATADOG_APP_KEY`

- **Description**: Application key (per-user / per-integration)
- **Sensitive**: yes (keychain storage)
- **Where to obtain**: Datadog → Personal Settings →
  Application Keys (or Service Accounts → keys)
- **Rotation**: 90 days default

For team use, prefer service-account application keys over
personal keys (so the integration doesn't break when the
creating user leaves).

## Region (site) configuration

Manifest field `site` selects the Datadog region. Defaults
to `datadoghq.com` (US1). Must match the region of your keys.

## Required by skillz commands

Auto-populated.

## Compliance considerations

Datadog stores observability data per organization
configuration:

- **Log retention**: configured per index; affects how far
  back the integration can search
- **Sensitive data**: Datadog supports log scrubbing (PII
  redaction) configured at the agent or platform level;
  the integration doesn't add scrubbing
- **GDPR/CCPA**: Datadog provides DPA; org-level
  configuration determines compliance posture
- **HIPAA**: available with Enterprise plan and BAA; not
  default
- **FedRAMP**: US1-FED region certified; suite supports the
  `ddog-gov.com` site URL

For SkoolScout's student-data context (FERPA/COPPA): ensure
no student data lands in Datadog logs without scrubbing
configured upstream. Set `pii_scrubbing` rules in the
Datadog Agent before relying on log capture.

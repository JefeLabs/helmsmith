---
description: Credential lifecycle help for integrations. Doctor mode diagnoses keychain health and credential retrievability across all configured integrations. Surfaces credentials approaching rotation age. Provides revocation guidance. Never displays credential values.
argument-hint: [--doctor] [--rotation-due] [--revoke <integration> <credential>]
allowed-tools: Read, Write, Edit, Bash
---

Credential lifecycle helper. Diagnoses health, surfaces
rotation needs, guides revocation. Operates on credential
metadata only; never displays credential values.

## Modes

### Doctor — `--doctor` (default)

Comprehensive credential health check across all configured
integrations:

```
=== Credentials Doctor ===

Platform:        macOS 14.5
Keychain:        ✓ available (security command found)
Keychain unlock: ✓ user keychain unlocked

Configured integrations: 3

jira:
  JIRA_EMAIL (env):           ✓ JIRA_EMAIL is set
  JIRA_API_TOKEN (keychain):  ✓ stored, retrievable
                              stored 2026-02-01 (92 days ago)
                              ⚠ approaching 90-day rotation threshold

github:
  GITHUB_TOKEN (keychain):    ✓ stored, retrievable
                              stored 2026-04-15 (18 days ago)

splunk (instance: prod):
  SPLUNK_TOKEN (keychain):    ✓ stored, retrievable
                              stored 2026-03-20 (44 days ago)

splunk (instance: security):
  SPLUNK_TOKEN (keychain):    ✗ NOT FOUND
                              service: skillz-splunk / security-token
                              keychain entry missing
                              Action: /integrations:setup splunk --instance security

Status:
  Healthy:                    4 of 5 credentials
  Missing:                    1 credential
  Rotation approaching:       1 credential (jira/JIRA_API_TOKEN)

Action items:
  1. Rotate jira/JIRA_API_TOKEN soon (92 days, threshold 90)
     Get new token: https://id.atlassian.com/manage-profile/security/api-tokens
     Then: /integrations:setup jira
  
  2. Re-setup splunk security instance
     /integrations:setup splunk --instance security
```

The doctor verifies:

- Platform keychain access works
- Each configured credential is retrievable (keychain or env)
- Stored credential ages against rotation thresholds
- Per-integration interface availability still matches the
  manifest

It never displays credential values. The success indicator
("retrievable") confirms the round-trip works without exposing
the value.

### Rotation due — `--rotation-due`

Filtered view showing only credentials approaching or past
rotation:

```
=== Credentials Approaching Rotation ===

Threshold: 90 days (configurable in stalenessThresholds.credentialRotationDays)

jira/JIRA_API_TOKEN:
  Stored: 2026-02-01 (92 days ago)
  Status: Approaching rotation
  Action: Generate new API token, then run /integrations:setup jira

github/GITHUB_TOKEN:
  Stored: 2026-04-15 (18 days ago)
  Status: Healthy

splunk/SPLUNK_TOKEN (prod):
  Stored: 2026-03-20 (44 days ago)
  Status: Healthy

splunk/SPLUNK_TOKEN (security):
  Stored: 2025-12-01 (153 days ago)
  Status: PAST ROTATION (63 days overdue)
  Action: Generate new token, then run /integrations:setup splunk --instance security
```

CI-friendly with `--json` for compliance reporting.

### Revoke — `--revoke <integration> <credential>`

Removes a specific credential. Safer than `--reset` (which
removes all credentials for an integration):

```bash
/integrations:credentials --revoke jira JIRA_API_TOKEN
```

```
=== Revoke Credential ===

Integration: jira
Credential:  JIRA_API_TOKEN
Storage:     keychain (skillz-jira / api-token)

Revocation will:
  - Delete the keychain entry on this machine
  - Mark the integration's credential as missing
  - Subsequent invocations of /integrations:jira will fail
    until re-setup

Note: This does NOT revoke the token at the remote service.
To fully revoke, also revoke the token at:
  https://id.atlassian.com/manage-profile/security/api-tokens

Confirm local deletion? [y/N]
```

After confirmation, the keychain entry is deleted and the
manifest's credential entry is preserved (storage type
recorded; storedAt cleared) so future setup is faster.

## Phase 0: discovery

1. Read `product/.pencil-integrations.json`. If missing:
   "No integrations configured."
2. Detect platform via keychain helper.
3. For each configured integration, gather:
   - Active status
   - Per-credential storage type and identifier
   - Per-credential storedAt timestamp (for keychain entries)

## Doctor logic

```bash
for INTEGRATION in $(jq -r '.integrations | keys[]' product/.pencil-integrations.json); do
  ACTIVE=$(jq -r ".integrations.${INTEGRATION}.active" product/.pencil-integrations.json)
  [ "$ACTIVE" != "true" ] && continue
  
  echo ""
  echo "${INTEGRATION}:"
  
  for CREDENTIAL in $(jq -r ".integrations.${INTEGRATION}.credentials | keys[]" product/.pencil-integrations.json); do
    STORAGE=$(jq -r ".integrations.${INTEGRATION}.credentials.${CREDENTIAL}.storage" product/.pencil-integrations.json)
    
    case "$STORAGE" in
      env)
        ENV_VAR=$(jq -r ".integrations.${INTEGRATION}.credentials.${CREDENTIAL}.envVar // \"$CREDENTIAL\"" product/.pencil-integrations.json)
        if [ -n "${!ENV_VAR}" ]; then
          echo "  ${CREDENTIAL} (env):  ✓ ${ENV_VAR} is set"
        else
          echo "  ${CREDENTIAL} (env):  ✗ ${ENV_VAR} is not set"
          MISSING=$((MISSING + 1))
        fi
        ;;
      keychain)
        SERVICE=$(jq -r ".integrations.${INTEGRATION}.credentials.${CREDENTIAL}.service" product/.pencil-integrations.json)
        ACCOUNT=$(jq -r ".integrations.${INTEGRATION}.credentials.${CREDENTIAL}.account" product/.pencil-integrations.json)
        STORED_AT=$(jq -r ".integrations.${INTEGRATION}.credentials.${CREDENTIAL}.storedAt // \"unknown\"" product/.pencil-integrations.json)
        
        # Try retrieve (capture exit, not value)
        if VALUE=$(keychain_retrieve "$SERVICE" "$ACCOUNT" 2>/dev/null) && [ -n "$VALUE" ]; then
          unset VALUE
          
          # Calculate age
          if [ "$STORED_AT" != "unknown" ]; then
            AGE_DAYS=$(date_diff_days "$STORED_AT")
            ROTATION_THRESHOLD=$(jq -r '.stalenessThresholds.credentialRotationDays // 90' product/.pencil-integrations.json)
            
            if [ "$AGE_DAYS" -ge "$ROTATION_THRESHOLD" ]; then
              echo "  ${CREDENTIAL} (keychain):  ✓ stored, retrievable"
              echo "                              ⚠ stored ${AGE_DAYS} days ago (threshold ${ROTATION_THRESHOLD})"
              ROTATION_DUE=$((ROTATION_DUE + 1))
            else
              echo "  ${CREDENTIAL} (keychain):  ✓ stored, retrievable"
              echo "                              stored ${AGE_DAYS} days ago"
            fi
          else
            echo "  ${CREDENTIAL} (keychain):  ✓ stored, retrievable"
          fi
        else
          echo "  ${CREDENTIAL} (keychain):  ✗ NOT FOUND"
          echo "                              service: ${SERVICE} / ${ACCOUNT}"
          MISSING=$((MISSING + 1))
        fi
        ;;
    esac
  done
done
```

## Cross-namespace integration

Workflow commands invoke the doctor logic during pre-flight
when they need credentials:

```bash
# In a workflow that uses Jira
DOCTOR_OUTPUT=$(/integrations:credentials --doctor --json --integration jira 2>/dev/null)
HAS_ALL_JIRA_CREDS=$(echo "$DOCTOR_OUTPUT" | jq '.integrations.jira.allCredentialsRetrievable')

if [ "$HAS_ALL_JIRA_CREDS" != "true" ]; then
  echo "Jira credentials missing or unhealthy."
  echo "Run /integrations:credentials --doctor for diagnostics"
  exit 1
fi
```

The `--integration <name>` filter narrows doctor output to one
integration; `--json` provides structured data for programmatic
checks.

## Audit / compliance

For compliance contexts, the doctor's structured output can
feed audit pipelines:

```bash
# Compliance check: no credentials past rotation
/integrations:credentials --rotation-due --json | \
  jq -e '[.[] | select(.daysOverdue > 0)] | length == 0'
```

Returns 0 (success) when no rotations are overdue.

## What this command does NOT do

- **Display credential values.** Ever. Privacy boundary.
- **Auto-rotate credentials.** Surfaces; user rotates.
- **Revoke at remote service.** Local revocation only;
  the user must revoke at the service's UI/API for full
  revocation.
- **Sync credentials across machines.** Each machine has its
  own keychain; multi-device requires per-machine setup.
- **Manage env vars.** Reports whether they're set; doesn't
  set them.

## Examples

```bash
# Full health check
/integrations:credentials --doctor

# Just rotation candidates
/integrations:credentials --rotation-due

# Specific integration
/integrations:credentials --doctor --integration jira

# Revoke a specific credential
/integrations:credentials --revoke jira JIRA_API_TOKEN

# Compliance check (CI)
/integrations:credentials --rotation-due --json
```

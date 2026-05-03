# Keychain Helper — Cross-Platform Credential Storage

> Reference document for the keychain abstraction commands
> use. Not invoked directly as a slash command (note the
> underscore prefix). Suite commands reference these patterns
> when they need to store or retrieve credentials.

## Purpose

The suite delegates credential storage to OS-native tooling.
This file documents the cross-platform abstraction commands
follow. Each platform has its own command surface; the suite
wraps them behind consistent operations.

## Platform detection

```bash
detect_platform() {
  case "$(uname -s)" in
    Darwin*)  echo "macos"   ;;
    Linux*)   echo "linux"   ;;
    MINGW*|CYGWIN*|MSYS*) echo "windows" ;;
    *)        echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)
```

## Keychain availability check

Detects whether the platform's credential store is actually
usable. Important for CI / headless environments.

```bash
keychain_available() {
  case "$PLATFORM" in
    macos)
      command -v security >/dev/null 2>&1 && \
        security list-keychains >/dev/null 2>&1
      ;;
    linux)
      command -v secret-tool >/dev/null 2>&1 && \
        # Try a no-op lookup — fails fast if no Secret Service backend
        secret-tool search dummy-attribute dummy-value >/dev/null 2>&1 || \
        # Some backends return non-zero on no-match but work; check exit code
        [ $? -eq 1 ]
      ;;
    windows)
      command -v cmdkey >/dev/null 2>&1 || \
      powershell -NoProfile -Command "Get-Command Get-StoredCredential" \
        >/dev/null 2>&1
      ;;
    *)
      return 1
      ;;
  esac
}
```

When `keychain_available` returns false (CI runners, headless
servers, WSL without GNOME Keyring), commands fall back to
env-only mode.

## Store credential

```bash
keychain_store() {
  local SERVICE="$1"   # e.g., "skillz-jira"
  local ACCOUNT="$2"   # e.g., "api-token"
  local VALUE="$3"     # the credential value
  local LABEL="$4"     # human-readable description

  case "$PLATFORM" in
    macos)
      # -U updates if exists; -s service; -a account; -w password value
      security add-generic-password \
        -U \
        -s "$SERVICE" \
        -a "$ACCOUNT" \
        -l "$LABEL" \
        -w "$VALUE" \
        2>/dev/null
      ;;
    linux)
      # secret-tool reads value from stdin
      printf '%s' "$VALUE" | secret-tool store \
        --label="$LABEL" \
        service "$SERVICE" \
        account "$ACCOUNT"
      ;;
    windows)
      # cmdkey expects the secret as part of the command line — security concern
      # PowerShell with SecureString is preferred
      powershell -NoProfile -Command "
        \$secure = ConvertTo-SecureString '$VALUE' -AsPlainText -Force
        New-StoredCredential -Target 'skillz:$SERVICE:$ACCOUNT' \
          -UserName '$ACCOUNT' -SecurePassword \$secure -Persist LocalMachine
      "
      ;;
  esac
}
```

Important: the credential value is passed via stdin where
possible (Linux) or via secure string (Windows PowerShell) to
avoid leaving the value in process listings or shell history.
On macOS, `security add-generic-password -w` does put the value
on the command line; mitigation is to clear shell history after
setup.

## Retrieve credential

```bash
keychain_retrieve() {
  local SERVICE="$1"
  local ACCOUNT="$2"

  case "$PLATFORM" in
    macos)
      security find-generic-password \
        -s "$SERVICE" \
        -a "$ACCOUNT" \
        -w \
        2>/dev/null
      ;;
    linux)
      secret-tool lookup \
        service "$SERVICE" \
        account "$ACCOUNT" \
        2>/dev/null
      ;;
    windows)
      powershell -NoProfile -Command "
        \$cred = Get-StoredCredential -Target 'skillz:$SERVICE:$ACCOUNT'
        if (\$cred) {
          [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR(
              \$cred.Password
            )
          )
        }
      "
      ;;
  esac
}
```

Returns the credential value to stdout, or empty string if
not found. Commands consuming this should:

```bash
JIRA_API_TOKEN=$(keychain_retrieve "skillz-jira" "api-token")
if [ -z "$JIRA_API_TOKEN" ]; then
  echo "Credential not found in keychain. Run /integrations:setup jira"
  exit 1
fi
export JIRA_API_TOKEN
# ... invoke jira CLI
unset JIRA_API_TOKEN  # clear from suite's env after use
```

## Delete credential

```bash
keychain_delete() {
  local SERVICE="$1"
  local ACCOUNT="$2"

  case "$PLATFORM" in
    macos)
      security delete-generic-password \
        -s "$SERVICE" \
        -a "$ACCOUNT" \
        2>/dev/null
      ;;
    linux)
      secret-tool clear \
        service "$SERVICE" \
        account "$ACCOUNT"
      ;;
    windows)
      powershell -NoProfile -Command "
        Remove-StoredCredential -Target 'skillz:$SERVICE:$ACCOUNT'
      "
      ;;
  esac
}
```

Used during integration deactivation, credential rotation, or
explicit revocation.

## Top-level resolve_credential abstraction

This is the function commands actually call. Handles both
keychain and env storage transparently:

```bash
resolve_credential() {
  local INTEGRATION="$1"       # e.g., "jira"
  local CREDENTIAL_NAME="$2"   # e.g., "JIRA_API_TOKEN"

  # Read storage type from manifest
  local STORAGE
  STORAGE=$(jq -r --arg i "$INTEGRATION" --arg c "$CREDENTIAL_NAME" \
    '.integrations[$i].credentials[$c].storage // "env"' \
    product/.pencil-integrations.json)

  case "$STORAGE" in
    keychain)
      local SERVICE
      local ACCOUNT
      SERVICE=$(jq -r --arg i "$INTEGRATION" --arg c "$CREDENTIAL_NAME" \
        '.integrations[$i].credentials[$c].service' \
        product/.pencil-integrations.json)
      ACCOUNT=$(jq -r --arg i "$INTEGRATION" --arg c "$CREDENTIAL_NAME" \
        '.integrations[$i].credentials[$c].account' \
        product/.pencil-integrations.json)
      keychain_retrieve "$SERVICE" "$ACCOUNT"
      ;;
    env)
      local ENV_VAR
      ENV_VAR=$(jq -r --arg i "$INTEGRATION" --arg c "$CREDENTIAL_NAME" \
        '.integrations[$i].credentials[$c].envVar // $c' \
        product/.pencil-integrations.json)
      printf '%s' "${!ENV_VAR}"
      ;;
    *)
      echo "Unknown storage type: $STORAGE" >&2
      return 1
      ;;
  esac
}
```

Usage in command pre-flight:

```bash
JIRA_EMAIL=$(resolve_credential "jira" "JIRA_EMAIL")
JIRA_API_TOKEN=$(resolve_credential "jira" "JIRA_API_TOKEN")

if [ -z "$JIRA_EMAIL" ] || [ -z "$JIRA_API_TOKEN" ]; then
  echo "Jira credentials not found. Run /integrations:setup jira"
  exit 1
fi
```

## Credential age tracking

The keychain itself doesn't expose creation/modification
timestamps for credentials in a portable way. The suite tracks
credential age in the manifest:

```jsonc
{
  "integrations": {
    "jira": {
      "credentials": {
        "JIRA_API_TOKEN": {
          "storage": "keychain",
          "service": "skillz-jira",
          "account": "api-token",
          "storedAt": "2026-02-01T10:00:00Z"
        }
      }
    }
  }
}
```

Setting/rotating a credential updates `storedAt`. Doctor mode
compares against `stalenessThresholds.credentialRotationDays`.

This is metadata about WHEN the credential was stored, not the
credential itself. The credential value remains in keychain.

## Service / account naming convention

Suite uses a consistent naming scheme across platforms:

- **Service**: `skillz-<integration-name>` (e.g.,
  `skillz-jira`, `skillz-github`, `skillz-microsoft-graph`)
- **Account**: per-credential identifier (e.g., `api-token`,
  `oauth-refresh`, `personal-access-token`)
- **Label** (where supported): `Skillz Suite: <integration> <credential-purpose>`

For Windows, the target format is
`skillz:<service>:<account>` since Windows uses single-string
target identifiers.

This convention makes credentials discoverable in keychain
UIs (macOS Keychain Access, GNOME Seahorse, Windows Credential
Manager) and recognizable as suite-managed.

## Multi-account / multi-instance handling

When an integration supports multiple instances (e.g., Splunk
prod and security; multiple GitHub orgs), the account portion
distinguishes:

- `skillz-splunk` / `prod-token` — production Splunk token
- `skillz-splunk` / `security-token` — security Splunk token
- `skillz-github` / `github-com-token` — github.com PAT
- `skillz-github` / `enterprise-token` — Enterprise PAT

The manifest records which account corresponds to which
instance.

## Audit logging

OS keychains generally log credential access (macOS Console.app
logs keychain access; Linux Secret Service has DBus signals;
Windows Event Log captures credential access). The suite
doesn't add its own audit layer — it relies on OS-level
logging.

For compliance contexts requiring richer audit, users can
configure their preferred audit tooling at the OS level. The
suite stays out of audit logging implementation.

## Failure modes and graceful degradation

When keychain operations fail:

| Failure | Cause | Suite behavior |
|---------|-------|----------------|
| Keychain locked | User session locked or keychain timeout | Surface to user: "Keychain locked; unlock to continue" |
| Credential not found | Setup not run, or credential deleted | Suggest `/integrations:setup <name>` |
| Permission denied | App not granted keychain access | Surface OS-specific guidance |
| Backend unavailable | Linux without Secret Service | Fall back to env-only mode with warning |
| Command not installed | `security` / `secret-tool` / `cmdkey` missing | Fall back to env-only with warning |

Graceful degradation never happens silently — the user sees
what changed and why.

## Testing keychain operations

Setup includes a test step that round-trips a credential:

```bash
# After storing credential, verify it can be retrieved
keychain_store "skillz-jira" "api-token" "$TOKEN" "Skillz: Jira API Token"
RETRIEVED=$(keychain_retrieve "skillz-jira" "api-token")

if [ "$RETRIEVED" != "$TOKEN" ]; then
  echo "Keychain round-trip failed; credential may not be retrievable later"
  exit 1
fi

unset TOKEN RETRIEVED  # clear from memory
```

This catches platform-specific issues (encoding mismatches,
permission problems, backend bugs) at setup time rather than
at first invocation.

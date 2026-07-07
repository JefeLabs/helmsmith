# Microsoft Graph — Shared Auth Provider

> Read this when working with `outlook`, `onedrive`, `teams`,
> or any future M365 integration. The shared auth provider
> pattern means one OAuth flow grants access to multiple
> integrations.

## What this provider covers

A single Microsoft identity authentication grants scoped
access to multiple Microsoft 365 services through the
Microsoft Graph API:

- **Outlook** — mail, calendar, contacts
- **OneDrive** — files, shared drives, permissions
- **Teams** — messages, channels, meetings
- **SharePoint** — sites, lists, document libraries (future)
- **Planner** — tasks (future)
- **To Do** — personal tasks (future)
- **Excel Online** — workbooks via Graph (future)

When the user authenticates once via the Microsoft Graph
auth flow, the access token can be scoped to grant access to
multiple of the above services. Each integration in the
suite that uses Microsoft Graph references the same stored
credential.

## Why a shared auth provider matters

Without sharing, three M365 integrations would each have:

- Three separate OAuth flows to walk through
- Three separate token storage entries in keychain
- Three separate refresh-token lifecycles
- Three separate consent dialogs from Microsoft
- Three separate places where the user sees scope creep

With sharing:

- **One OAuth flow** with combined scopes
- **One stored access token** (with refresh token)
- **One refresh lifecycle** managed centrally
- **One consent dialog** showing all scopes upfront
- **One revocation point** if user wants to disconnect

The cost: scope changes require a re-auth (e.g., adding Teams
later requires re-authenticating with the additional scope).
The benefit: substantially less friction for users adopting
multiple M365 integrations.

## Storage convention

Microsoft Graph credentials live under a shared key in the
project's manifest, NOT duplicated per integration:

```jsonc
{
  "integrations": {
    "_authProviders": {
      "microsoft-graph": {
        "active": true,
        "credentials": {
          "MS_GRAPH_TENANT_ID": {
            "storage": "env",
            "envVar": "MS_GRAPH_TENANT_ID"
          },
          "MS_GRAPH_CLIENT_ID": {
            "storage": "env",
            "envVar": "MS_GRAPH_CLIENT_ID"
          },
          "MS_GRAPH_CLIENT_SECRET": {
            "storage": "keychain",
            "keychainAccount": "agentx-skillzkit-msgraph-client-secret"
          },
          "MS_GRAPH_ACCESS_TOKEN": {
            "storage": "keychain",
            "keychainAccount": "agentx-skillzkit-msgraph-access-token"
          },
          "MS_GRAPH_REFRESH_TOKEN": {
            "storage": "keychain",
            "keychainAccount": "agentx-skillzkit-msgraph-refresh-token"
          }
        },
        "scopes": [
          "Mail.Read",
          "Mail.Send",
          "Calendars.ReadWrite",
          "Files.ReadWrite",
          "Files.Read.All",
          "Channel.ReadBasic.All",
          "ChannelMessage.Send"
        ],
        "tokenExpiresAt": "2026-05-04T15:00:00Z",
        "lastRefreshed": "2026-05-03T15:00:00Z",
        "tenantType": "single-tenant",
        "userPrincipalName": "edwin@skoolscout.org"
      }
    },
    "outlook": {
      "active": true,
      "preference": "rest",
      "authProvider": "microsoft-graph"
    },
    "onedrive": {
      "active": true,
      "preference": "rest",
      "authProvider": "microsoft-graph"
    },
    "teams": {
      "active": true,
      "preference": "rest",
      "authProvider": "microsoft-graph"
    }
  }
}
```

The `authProvider` field on each integration points at the
shared provider. The integration reads credentials from the
provider, not from its own credentials block.

## OAuth flow

Microsoft Graph uses OAuth 2.0 Authorization Code flow with
PKCE. The setup walkthrough handles this:

1. **App registration** (one-time per project)
   - User registers an app at https://portal.azure.com →
     Azure Active Directory → App registrations
   - Configure redirect URI (typically `http://localhost:8400/callback`
     for local dev; the suite spawns a temporary local
     server during auth)
   - Configure API permissions (the scopes listed above)
   - Generate a client secret
   - Note the tenant ID (directory ID) and client ID

2. **OAuth dance** (initial auth)
   - Suite opens browser to Microsoft's auth URL
   - User signs in to their Microsoft account
   - Microsoft shows consent dialog with combined scopes
   - User grants consent
   - Microsoft redirects to localhost:8400 with auth code
   - Suite exchanges auth code for access + refresh tokens
   - Suite stores tokens in keychain

3. **Token refresh** (ongoing)
   - Access tokens are short-lived (typically 1 hour)
   - When access token expires, suite uses refresh token to
     get a new access token
   - Refresh tokens are long-lived (90 days default; rolled
     on each use)
   - If refresh token expires/invalidates, user re-auths

The setup walkthrough is in `integrations/setup.md` with
microsoft-graph-specific paths.

## Tenant types

Microsoft Graph distinguishes:

- **Single-tenant**: app limited to one Azure AD tenant.
  Common for work/school accounts (e.g., SkoolScout
  organization). Scopes apply within the tenant.
- **Multi-tenant**: app accepts users from any Azure AD
  tenant. Used when shipping to multiple organizations.
- **Personal accounts**: Microsoft personal accounts
  (outlook.com, hotmail.com, live.com).
- **Mixed**: app accepts both Azure AD and personal accounts.

For most suite deployments (SkoolScout, jefelabs work):
single-tenant is appropriate. The setup walkthrough prompts
for tenant type and configures scope strings accordingly.

## Scope management

Scopes are the granular permissions the auth grants.
Microsoft Graph scopes follow the pattern
`<resource>.<action>`:

- `Mail.Read` — read user's mail
- `Mail.Send` — send mail as the user
- `Calendars.ReadWrite` — full calendar access
- `Files.ReadWrite` — read and write user's OneDrive files
- `Files.Read.All` — read all files user has access to
  (including shared)
- `Channel.ReadBasic.All` — read Teams channels
- `ChannelMessage.Send` — send messages in Teams
- `Sites.Read.All` — SharePoint sites (future)

Each integration declares the scopes it needs. The shared
auth provider unions the scopes across active integrations
and requests the combined set during OAuth.

When activating a new integration that requires additional
scopes:

```
=== Microsoft Graph: Scope Update Required ===

Activating 'teams' integration requires additional scopes:
  - Channel.ReadBasic.All (read Teams channels)
  - ChannelMessage.Send (send messages in Teams)

Currently authorized scopes:
  - Mail.Read, Mail.Send, Calendars.ReadWrite,
    Files.ReadWrite

Re-authentication required to grant new scopes. The current
authentication will be revoked and replaced.

  [r] Re-authenticate now (recommended)
  [s] Skip activation; activate Teams later when ready to re-auth
  [a] Abort

Choice:
```

Re-auth flow uses the same OAuth dance with the expanded
scope set. The new tokens replace the old ones.

## Application vs delegated permissions

Microsoft Graph distinguishes:

- **Delegated permissions**: act on behalf of a signed-in
  user. Scopes apply only to what that user has access to.
  Used for personal/work integrations.
- **Application permissions**: act as the application
  itself, without a user. Scopes apply organization-wide.
  Used for backend services, audit tools, mass-data ops.
  Requires admin consent.

The suite uses **delegated permissions** by default — each
user authenticates with their own account, scopes apply to
their data. Application permissions are out of scope for
typical use; the suite documents them but doesn't drive
them.

## Token caching and concurrency

When multiple suite commands run simultaneously and need
Microsoft Graph access:

- Token cache is per-project (tied to the manifest)
- Multiple commands reading the same access token: safe
- Multiple commands triggering refresh simultaneously: race
  condition possible

The integration handles this with file-locking on token
refresh:

```bash
refresh_with_lock() {
  local LOCK_FILE="/tmp/agentx-skillzkit-msgraph.lock"
  local LOCK_TIMEOUT=10
  
  exec 200>"$LOCK_FILE"
  if ! flock -w "$LOCK_TIMEOUT" 200; then
    echo "Could not acquire lock for token refresh"
    return 1
  fi
  
  # Re-check if another process refreshed while we waited
  CURRENT_EXP=$(jq -r '.integrations._authProviders."microsoft-graph".tokenExpiresAt' \
                       product/.pencil-integrations.json)
  
  if is_expired "$CURRENT_EXP"; then
    do_refresh
  fi
  
  flock -u 200
}
```

For low-frequency suite use this is unlikely to matter; the
locking is defensive.

## Compliance considerations

Microsoft Graph access for organizational accounts may
involve:

- **Conditional access policies**: org may require
  multi-factor auth, device compliance, or specific networks
  for token issuance
- **App approval workflows**: some orgs require IT to
  approve apps before users can authenticate
- **Audit logging**: org admins can audit all Graph API
  calls; scope usage logged
- **Token lifetime policies**: org may enforce shorter
  token lifetimes (e.g., 30 minutes instead of 60)
- **Tenant restrictions**: app may be blocked for some
  tenants

For SkoolScout / jefelabs deployments, standard delegated
permissions work without IT involvement (user grants
consent for their own account). For financial-institution
contexts where Edwin consults, app registration likely
requires IT approval and may not be available for
non-corporate apps.

## What this auth provider does NOT do

- **Manage Azure AD app registration.** The user creates
  the app in Azure portal; the suite consumes the
  resulting credentials.
- **Handle multi-account scenarios.** One Microsoft
  account per project. Users with multiple Microsoft
  accounts (e.g., personal + work) need separate projects.
- **Replace Microsoft's auth UI.** The OAuth dance happens
  in the user's browser via Microsoft's standard auth
  pages. The suite doesn't render auth UI.
- **Cache scopes beyond what Microsoft returns.** If
  Microsoft revokes scopes (org policy change), the next
  Graph call fails and the suite surfaces the failure for
  re-auth.

## Diagnostic command

```bash
/core:integrations:setup microsoft-graph --status
```

Surfaces:

```
=== Microsoft Graph Status ===

Active:           yes
Tenant type:      single-tenant
Tenant ID:        12345678-...
User:             edwin@skoolscout.org
Last refreshed:   3 hours ago
Token expires:    in 12 minutes (will auto-refresh)

Scopes authorized (8):
  - Mail.Read
  - Mail.Send
  - Calendars.ReadWrite
  - Files.ReadWrite
  - Files.Read.All
  - Channel.ReadBasic.All
  - ChannelMessage.Send
  - User.Read

Integrations using this auth provider:
  - outlook (active)
  - onedrive (active)
  - teams (active)

Health: OK
```

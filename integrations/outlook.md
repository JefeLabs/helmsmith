---
description: Outlook integration for email, calendar, and contacts via Microsoft Graph API. REST only (no canonical CLI; no Outlook-specific MCP). Uses the shared microsoft-graph auth provider — one OAuth flow grants access to Outlook + OneDrive + Teams. Read and write operations supported (read mail, send mail, manage calendar events, query contacts).
argument-hint: <free-form-prompt> [--mailbox <upn>] [--calendar <id>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/_auth-provider-microsoft-graph.md`.

Direct invocation of Outlook for email, calendar, and contact
operations via Microsoft Graph. The shared microsoft-graph
auth provider means a single OAuth flow grants access; if
OneDrive or Teams are also configured, they share the same
authentication.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `outlook`
   is active and references the microsoft-graph auth provider:

   ```bash
   ACTIVE=$(jq -r '.integrations.outlook.active // false' \
                 product/.pencil-integrations.json)
   AUTH_PROVIDER=$(jq -r '.integrations.outlook.authProvider // empty' \
                         product/.pencil-integrations.json)
   
   if [ "$ACTIVE" != "true" ]; then
     echo "Outlook integration not active. Run /integrations:setup outlook"
     exit 1
   fi
   
   if [ "$AUTH_PROVIDER" != "microsoft-graph" ]; then
     echo "Outlook integration not using microsoft-graph auth provider"
     echo "Manifest may be misconfigured. Re-run /integrations:setup outlook"
     exit 1
   fi
   ```

2. Verify auth provider is healthy:

   ```bash
   PROVIDER_ACTIVE=$(jq -r '.integrations._authProviders."microsoft-graph".active // false' \
                          product/.pencil-integrations.json)
   
   if [ "$PROVIDER_ACTIVE" != "true" ]; then
     echo "Microsoft Graph auth provider not configured."
     echo "Run /integrations:setup microsoft-graph"
     exit 1
   fi
   ```

3. Resolve and refresh access token if needed:

   ```bash
   ACCESS_TOKEN=$(get_msgraph_access_token)
   if [ -z "$ACCESS_TOKEN" ]; then
     echo "Could not obtain access token. May need re-authentication."
     echo "Run /integrations:setup microsoft-graph"
     exit 1
   fi
   ```

   The `get_msgraph_access_token` helper checks token expiry,
   triggers refresh via refresh token if expired, and returns
   the current access token.

## Phase 1: prompt interpretation

Operations Outlook handles via Microsoft Graph:

### Mail

- **Read inbox**: list recent messages with filters
  (sender, date, has-attachment, unread)
- **Search mail**: query across folders
- **Read specific message**: fetch full content + attachments
- **Send mail**: compose and send (with optional CC/BCC,
  attachments, importance flag)
- **Reply / forward**: respond to existing messages
- **Manage folders**: list folders, move messages
- **Mark read/unread**, **flag**, **delete**, **archive**

### Calendar

- **List events**: query calendar with date range, attendee,
  category filters
- **Get event details**: full event with attendees, body,
  attachments
- **Create event**: schedule new event with attendees,
  location, online meeting link
- **Update event**: modify time, attendees, body
- **Cancel event**: cancel with notification
- **Find availability**: check free/busy across attendees
  (FindMeetingTimes API)
- **Calendar sharing**: list shared calendars, manage
  permissions (limited)

### Contacts

- **List contacts**: query personal contacts
- **Search**: find contacts by name, email, company
- **Create / update / delete**: manage personal contact list
- Does NOT cover org-wide directory queries (those use
  separate `/users` endpoint and require different scopes)

## Phase 2: execution

All operations route through Microsoft Graph REST API at
`https://graph.microsoft.com/v1.0`:

```bash
ACCESS_TOKEN=$(get_msgraph_access_token)

# List recent messages
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=20&\$select=subject,from,receivedDateTime,isRead"

# Get specific message
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages/${MESSAGE_ID}"

# Send mail
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/me/sendMail" \
  -d '{
    "message": {
      "subject": "...",
      "body": {
        "contentType": "Text",
        "content": "..."
      },
      "toRecipients": [
        { "emailAddress": { "address": "recipient@example.com" } }
      ]
    },
    "saveToSentItems": true
  }'

# List calendar events for next 7 days
START=$(date -u +%Y-%m-%dT00:00:00Z)
END=$(date -u -d "+7 days" +%Y-%m-%dT23:59:59Z 2>/dev/null || \
      date -u -v+7d +%Y-%m-%dT23:59:59Z)

curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${START}&endDateTime=${END}&\$orderby=start/dateTime"

# Create event
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/me/events" \
  -d '{
    "subject": "Project review",
    "start": { "dateTime": "2026-05-10T14:00:00", "timeZone": "America/New_York" },
    "end": { "dateTime": "2026-05-10T15:00:00", "timeZone": "America/New_York" },
    "attendees": [...]
  }'

unset ACCESS_TOKEN
```

### Pagination

Microsoft Graph uses `@odata.nextLink` for pagination. The
integration handles this transparently for prompts requiring
many results:

```bash
fetch_all_pages() {
  local URL="$1"
  local RESULTS="[]"
  
  while [ -n "$URL" ]; do
    RESPONSE=$(curl -sS \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      "$URL")
    
    PAGE_VALUES=$(echo "$RESPONSE" | jq '.value')
    RESULTS=$(echo "$RESULTS $PAGE_VALUES" | jq -s 'add')
    
    URL=$(echo "$RESPONSE" | jq -r '."@odata.nextLink" // empty')
  done
  
  echo "$RESULTS"
}
```

## Phase 3: result formatting

### Inbox listing

```
=== Outlook Inbox ===
Mailbox: edwin@skoolscout.org
Filter: unread, last 24h
Total matching: 7

  9:45 AM  Sarah Johnson        FERPA compliance question (unread, ⚑)
  8:15 AM  Compliance Team      Q2 audit prep checklist (unread)
  Yesterday 4:30 PM  Tech Vendors Newsletter (unread)
  Yesterday 2:15 PM  GitHub      [skoolscout] PR #1247 ready for review (unread)
  ...

To read a specific message:
  /integrations:outlook "show me the FERPA compliance email from Sarah"
```

### Calendar view

```
=== Calendar: Next 7 Days ===
edwin@skoolscout.org

Today (2026-05-04):
  10:00 AM  Engineering standup (15m)
            Microsoft Teams meeting
  2:00 PM   1:1 with [tech lead] (30m)
  
Tomorrow (2026-05-05):
  9:00 AM   SkoolScout planning (60m)
            Microsoft Teams meeting
            6 attendees
  3:30 PM   Customer interview (45m)
            Microsoft Teams meeting
  
Wednesday:
  No events
  
Thursday:
  10:00 AM  Architecture review (90m) - tentative
  
Friday:
  9:00 AM   Engineering standup (15m)
  4:00 PM   Demo to leadership (30m)
```

### Send mail confirmation

```
=== Outlook: Send Mail ===
From:    edwin@skoolscout.org
To:      sarah@example.com
CC:      compliance-team@skoolscout.org
Subject: Re: FERPA compliance question

Body preview:
  Sarah,
  
  Thanks for the question. The short answer is yes — our
  data handling practices comply with FERPA requirements.
  Specifically...

  [200 more characters]

Attachments: 0
Save to Sent Items: yes

Send? [Y/edit/abort]
> Y

Sent. Message ID: AAMkAGI...
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 Unauthorized | Access token expired and refresh failed | Re-authenticate: /integrations:setup microsoft-graph |
| 403 Forbidden | Scope insufficient | Add scope to microsoft-graph provider; re-auth |
| 404 Not Found | Message/event ID doesn't exist or no access | Verify ID; check sharing permissions |
| 429 Throttling | Microsoft Graph rate limit | Backoff per Retry-After header |
| 503 Service Unavailable | Microsoft Graph degradation | Retry with backoff |

Microsoft Graph throttling is per-tenant per-app; for
typical suite use, throttling is rare. When it happens,
respect `Retry-After` header.

## Cross-namespace integration

Outlook is consumed by:

- **Direct user invocation** for email/calendar work
- **`/workflows:manage start engineer:adr-cycle`** — when
  ADR cycle wants to email the proposal to stakeholders
  (when configured)
- **`/workflows:manage start product:ux:research`** (future)
  — scheduling user research interviews
- **`market/email/`** — when marketing email work is sent
  via Outlook (vs marketing automation platform)

## What this integration does NOT do

- **Replace Outlook desktop / web client.** The integration
  is for programmatic operations; humans still use Outlook
  UI for triage, complex composition, etc.
- **Manage organization-wide settings.** Mailbox provisioning,
  retention policies, mail flow rules — those are admin
  operations using different APIs.
- **Sync with non-Microsoft email.** Gmail, Apple Mail, etc.
  use different integrations (`/integrations:gmail` if
  configured separately).
- **Handle attachments larger than 4 MB inline.** Large
  attachments use a separate upload session API. The suite
  documents the limit; users handle large attachments via
  Outlook UI or OneDrive sharing.

## Examples

```bash
# Read inbox
/integrations:outlook "show me unread emails from the last 24 hours"

# Search
/integrations:outlook "find emails from sarah@example.com about FERPA"

# Send
/integrations:outlook "email sarah@example.com about the meeting being moved to 3pm"

# Calendar
/integrations:outlook "what's on my calendar tomorrow"

# Schedule meeting
/integrations:outlook "schedule a 30-minute meeting with sarah@example.com next Tuesday at 2pm titled 'Project review'"

# Find availability
/integrations:outlook "find a 30-minute slot when sarah@ and tech-lead@ are both free next week"
```

---

# Registry definition

## Integration metadata

```yaml
name: outlook
displayName: Outlook (M365)
provider: microsoft
category: email-calendar
multiInstance: false   # one Microsoft account per project
authProvider: microsoft-graph   # shared with onedrive, teams
```

## Interfaces

### CLI

**Not available.** Microsoft does not ship a canonical
Outlook CLI. (PowerShell modules exist for some
administrative tasks; not the same as a user-facing CLI.)

### MCP

**Not available** at this time. May change as ecosystem
matures.

### REST

```yaml
baseUrl: https://graph.microsoft.com/v1.0
authMethod: oauth2-bearer-via-shared-provider
authProvider: microsoft-graph
documentationUrl: https://learn.microsoft.com/en-us/graph/api/overview
```

## Required scopes (Microsoft Graph)

For typical operations:

- `Mail.Read` — read user's mail
- `Mail.Send` — send mail as the user
- `Mail.ReadWrite` — read and modify mail (flag, move, etc.)
- `Calendars.ReadWrite` — full calendar access
- `Contacts.ReadWrite` — manage personal contacts (optional)

Scopes are requested through the shared microsoft-graph
auth provider; combined with onedrive and teams scopes if
those are also active.

## Rate limits

Microsoft Graph throttling is per-tenant + per-app. Limits
vary by endpoint; most are generous for typical use. When
throttled, response includes `Retry-After` header.

For heavy use cases (bulk mail processing), consider
batching via `$batch` endpoint.

## Required by skillz commands

Auto-populated.

## Compliance considerations

Microsoft 365 organizational accounts may have:

- **Conditional access policies** — MFA, device compliance
  required for token issuance
- **App approval workflows** — IT may need to approve the
  app registration before users can grant consent
- **DLP (Data Loss Prevention)** — outbound mail with
  sensitive content may be blocked by DLP rules; the API
  call succeeds but mail flow blocks delivery
- **Audit logging** — Graph API calls are logged; admins
  can audit usage

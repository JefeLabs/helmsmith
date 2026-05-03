---
description: Microsoft Teams integration for channel messages, chats, meetings, and team metadata via Microsoft Graph API. REST only. Uses the shared microsoft-graph auth provider — same OAuth as Outlook and OneDrive. Read messages, post to channels, manage meetings, query teams/channels structure.
argument-hint: <free-form-prompt> [--team <id>] [--channel <id>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/_auth-provider-microsoft-graph.md`.

Direct invocation of Microsoft Teams for messaging, meetings,
and team metadata. Shares the microsoft-graph auth provider
with Outlook and OneDrive.

## Phase 0: pre-flight

Same pattern as Outlook and OneDrive — verify integration
active, microsoft-graph healthy, access token current.

```bash
ACCESS_TOKEN=$(get_msgraph_access_token)
[ -n "$ACCESS_TOKEN" ] || {
  echo "Could not obtain Microsoft Graph access token"
  exit 1
}
```

## Phase 1: prompt interpretation

Operations Teams handles via Microsoft Graph:

### Team and channel operations

- **List teams**: teams the user is a member of
- **Get team details**: members, channels, settings
- **List channels in a team**: standard, private, shared
- **Get channel details**: members, settings, files

### Messaging

- **Read channel messages**: recent messages, threads
- **Post channel message**: send to specific channel
- **Reply to message**: continue a thread
- **Mention users**: @mention via mentions array
- **Adaptive cards**: post rich content (limited)

### Chat (1:1 and group)

- **List chats**: 1:1 and group chats user participates in
- **Read chat messages**: history within a chat
- **Send chat message**: post to a chat
- **Create new chat**: start a new 1:1 or group conversation
  (limited; some org policies restrict)

### Meetings

- **List meetings**: meetings user is invited to (overlaps
  with calendar)
- **Create online meeting**: generate Teams meeting URL
  (often used in calendar event creation)
- **Meeting attendance reports**: who attended, when (admin)

### Search

- **Search messages**: query across channels and chats
  (limited by user's access)

## Phase 2: execution

```bash
ACCESS_TOKEN=$(get_msgraph_access_token)

# List teams the user is in
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/joinedTeams"

# List channels in a team
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels"

# Read channel messages
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages?\$top=20"

# Post a message to a channel
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages" \
  -d '{
    "body": {
      "contentType": "html",
      "content": "Quick update: PR #1247 is ready for review"
    }
  }'

# Post with mention
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages" \
  -d '{
    "body": {
      "contentType": "html",
      "content": "<at id=\"0\">Sarah</at> can you review when you have a moment?"
    },
    "mentions": [
      {
        "id": 0,
        "mentionText": "Sarah",
        "mentioned": {
          "user": {
            "displayName": "Sarah Johnson",
            "id": "user-id-uuid",
            "userIdentityType": "aadUser"
          }
        }
      }
    ]
  }'

# Reply to a message (thread)
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/replies" \
  -d '{
    "body": {
      "contentType": "text",
      "content": "Thanks, on it"
    }
  }'

# Create online meeting (Teams meeting URL)
curl -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://graph.microsoft.com/v1.0/me/onlineMeetings" \
  -d '{
    "startDateTime": "2026-05-10T14:00:00Z",
    "endDateTime": "2026-05-10T15:00:00Z",
    "subject": "Architecture review"
  }'

unset ACCESS_TOKEN
```

### Resolving user IDs for mentions

Mentions require the target user's Azure AD ID. The
integration helper:

```bash
resolve_user_id() {
  local QUERY="$1"  # email or display name
  
  curl -sS \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://graph.microsoft.com/v1.0/users/${QUERY}" | \
    jq -r '.id'
}
```

For prompts like "tell Sarah the PR is ready," the
integration:

1. Extracts the name "Sarah"
2. Resolves to user ID via `/users` endpoint (matches by
   display name, mail, or UPN)
3. Constructs message with proper mention markup

When the resolution is ambiguous (multiple Sarahs):

```
=== Ambiguous Mention ===

"Sarah" matches multiple users:
  [1] Sarah Johnson (sarah.johnson@skoolscout.org)
      Director of Compliance
  [2] Sarah Chen (sarah.chen@skoolscout.org)
      Engineering Lead

Which Sarah did you mean?
```

## Phase 3: result formatting

### Channel listing

```
=== Teams: SkoolScout ===
Teams I'm in (3):

📂 SkoolScout Engineering
   Members: 12 · Channels: 8
   
   Standard channels:
     # General (default)
     # development
     # architecture
     # incidents
     # standup
     # random
   
   Private channels:
     # leadership (5 members)

📂 SkoolScout Product
   Members: 8 · Channels: 4
   
   Standard channels:
     # General
     # roadmap
     # research
     # design

📂 jefelabs Collaborators
   Members: 5 · Channels: 2
```

### Message thread

```
=== Teams: SkoolScout Engineering / development ===

Top of channel · 47 recent messages

[Today]

10:15 AM · Sarah Chen
  Anyone available to review #1247? Has the new auth module.
  
  └─ 10:18 AM · Edwin Costello
       Looking now
  
  └─ 10:32 AM · Tom Park
       Reviewed; left a few comments

11:42 AM · Marcus Rivera
  FYI — staging is down, looks like a DB connection issue.
  Investigating.
  
  └─ 11:45 AM · Sarah Chen
       Need help?
  
  └─ 11:58 AM · Marcus Rivera
       Got it. Connection pool was exhausted.
       Restarted, monitoring.

[Yesterday]
[older messages collapsed; use --full for entire history]
```

### Posted message confirmation

```
=== Teams: Message Posted ===
Team:     SkoolScout Engineering
Channel:  development
Message:  
  "Quick update: PR #1247 is ready for review.
   Includes the new auth module discussed in
   yesterday's standup."

Mentions: 0

Posted at 2:34 PM. Message ID: 1683213254000
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 | Token expired | Auto-refresh; re-auth if needed |
| 403 | Scope insufficient OR not a member of team | Check scopes; verify team membership |
| 404 | Team/channel not found | Verify ID; check if team was deleted |
| 423 | Resource locked (rare for Teams) | Retry |
| 429 | Throttled | Backoff per Retry-After |

Specific to Teams:

- **Posting to private channels**: requires explicit channel
  membership; just being on the parent team isn't enough
- **Cross-team mentions**: limited; mentioning a user not in
  the team typically fails

## Cross-namespace integration

Teams is consumed by:

- **Direct user invocation** for messaging and meeting work
- **Engineer workflows for incident notifications** — when
  configured to post to incidents channel
- **`/workflows:manage start engineer:adr-cycle`** — when
  ADR cycle wants to post stakeholder review notifications
  to a Teams channel
- **`/integrations:datadog`** etc. (when configured) — alert
  forwarding to Teams channels (alternative to PagerDuty)

## Difference between Teams chat and channels

For prompts:

- **Channel post**: persistent, searchable, accessible to all
  channel members. Use for team-wide updates, notifications,
  visible decisions.
- **Chat message**: 1:1 or small group, more conversational,
  less searchable. Use for direct communication.

The integration prompts the user to choose when ambiguous:

```
=== Where should this message go? ===

Prompt: "Tell Sarah the PR is ready for review"

  [c] Direct chat with Sarah
       (1:1 conversation; just Sarah sees it)
  
  [t] Team channel
       (visible to channel members; specify channel)

Choice:
```

## What this integration does NOT do

- **Replace Teams desktop / web client.** Voice/video calls,
  file collaboration, and rich UI features stay in the
  Teams client.
- **Manage org-level Teams admin.** Team creation policies,
  guest access, retention — admin operations not covered.
- **Provide rich adaptive card editor.** Adaptive cards are
  supported via raw JSON; building complex cards happens via
  designer tools or the user's own JSON.
- **Sync channel content to OneDrive automatically.** Files
  posted to channels live in the team's SharePoint library;
  use OneDrive integration for those files.
- **Handle Teams apps/bots ecosystem.** Custom Teams apps
  require separate development; out of scope.

## Examples

```bash
# List teams and channels
/integrations:teams "list my teams and channels"

# Read recent messages
/integrations:teams "show recent messages in the development channel"

# Post update
/integrations:teams "post to development channel: PR #1247 ready for review"

# Post with mention
/integrations:teams "tell Sarah in development channel that the PR is ready"

# Search
/integrations:teams "find messages about the staging outage"

# Create meeting
/integrations:teams "create a Teams meeting for tomorrow 2-3pm titled 'Architecture review'"

# Read DM history
/integrations:teams "show my chat with Sarah from this week"
```

---

# Registry definition

## Integration metadata

```yaml
name: teams
displayName: Microsoft Teams (M365)
provider: microsoft
category: messaging-meetings
multiInstance: false
authProvider: microsoft-graph
```

## Interfaces

### CLI

**Not available.** No canonical Teams CLI for end-user
operations.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://graph.microsoft.com/v1.0
authMethod: oauth2-bearer-via-shared-provider
authProvider: microsoft-graph
documentationUrl: https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview
```

## Required scopes (Microsoft Graph)

For typical operations:

- `Team.ReadBasic.All` — list teams user is in
- `Channel.ReadBasic.All` — list channels in those teams
- `ChannelMessage.Read.All` — read messages (delegated;
  user's accessible channels)
- `ChannelMessage.Send` — post to channels
- `Chat.Read` — read 1:1/group chats
- `Chat.ReadWrite` — read/write chats
- `OnlineMeetings.ReadWrite` — manage online meetings
- `User.Read.All` — resolve mentions (admin consent often
  required)

The `User.Read.All` scope is broader than typical user
permissions; some tenants restrict it. When unavailable,
mention resolution falls back to display-name-only mentions
(less reliable).

## Rate limits

Teams API throttling is tighter than Mail/Calendar in some
endpoints. Channel message posts have per-team and per-app
limits. Backoff per `Retry-After`.

## Required by skillz commands

Auto-populated.

## Compliance considerations

Teams messages are subject to:

- **Retention policies** — org may retain or auto-delete
  messages on schedule
- **eDiscovery** — Teams content discoverable for legal
  proceedings
- **Communication compliance** — outbound messages may be
  scanned for prohibited content
- **Information barriers** — some users may be blocked from
  communicating with each other (regulatory)
- **Guest access policies** — restrictions on external user
  participation

For SkoolScout: standard org Teams setup, no unusual
constraints. For Edwin's financial-institution consulting
work: extensive compliance constraints likely; Teams
integration usage may need IT approval.

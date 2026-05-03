---
description: Hootsuite integration for cross-platform social publishing and scheduling. REST API only — no canonical CLI or MCP. Acts as the WRITE DELEGATE for direct platform integrations (LinkedIn, Instagram, Reddit, X, Threads). Manages connected social channels; queues posts; handles scheduling.
argument-hint: <free-form-prompt> [--channel <id>] [--platform <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of Hootsuite for cross-platform social
publishing. Also serves as the write delegate target for
direct social platform integrations (LinkedIn, Instagram,
Reddit) when those have `writeDelegation.delegate: hootsuite`
configured.

This integration is REST-only — Hootsuite has no canonical
CLI or widely-adopted MCP. The simplest interface profile;
validates that the schema gracefully handles single-interface
integrations.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `hootsuite`
   is active.

2. Verify REST credentials available:

   ```bash
   HOOTSUITE_TOKEN=$(resolve_credential "hootsuite" "HOOTSUITE_ACCESS_TOKEN")
   if [ -z "$HOOTSUITE_TOKEN" ]; then
     echo "Hootsuite credentials missing. Run /integrations:setup hootsuite"
     exit 1
   fi
   ```

3. Read managed channels list:

   ```bash
   CHANNELS=$(jq -r '.integrations.hootsuite.managedChannels // []' \
                  product/.pencil-integrations.json)
   ```

## Phase 1: prompt interpretation

Operations Hootsuite handles:

### Write operations (the dominant use case)

- **Schedule a post**: queue content for one or more channels
  at a specific time
- **Cross-post**: same content across multiple channels
  simultaneously
- **Post immediately**: send-now to one or more channels
- **Update scheduled post**: edit content/time before publish
- **Delete scheduled post**: remove from queue
- **Bulk schedule**: import multiple posts (CSV / structured
  data)

### Read operations

- **Queue queries**: list scheduled posts, filter by channel/
  date/status
- **Channel queries**: list connected channels, fetch channel
  metadata
- **Published-post queries**: limited — Hootsuite's API
  exposes some published-post data but platform-specific
  analytics are richer via direct platform APIs
- **Approval queue queries**: posts awaiting team approval

For analytics/engagement on already-published posts, prefer
direct platform integrations (`/integrations:linkedin`,
`/integrations:instagram`, etc.). Hootsuite's analytics are
fragmentary across platforms.

## Phase 2: execution (REST only)

```bash
HOOTSUITE_TOKEN=$(resolve_credential "hootsuite" "HOOTSUITE_ACCESS_TOKEN")
BASE_URL="https://platform.hootsuite.com/v1"

# List managed channels
curl -sS \
  -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
  "${BASE_URL}/socialProfiles"

# Schedule a post
curl -sS \
  -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/messages" \
  -d '{
    "text": "Excited to share our new feature for school admins...",
    "socialProfileIds": ["abc123"],
    "scheduledSendTime": "2026-05-04T14:00:00Z"
  }'

# Send immediately (omit scheduledSendTime)
curl -sS \
  -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/messages" \
  -d '{
    "text": "Just published a new post about ed-tech procurement",
    "socialProfileIds": ["abc123", "def456"]
  }'

# List scheduled posts
curl -sS \
  -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
  "${BASE_URL}/messages?state=SCHEDULED"

# Cancel scheduled post
curl -sS \
  -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
  -X DELETE "${BASE_URL}/messages/{messageId}"

unset HOOTSUITE_TOKEN
```

## Phase 3: invocation patterns

### Direct invocation (user explicitly using Hootsuite)

```bash
# Schedule across multiple channels
/integrations:hootsuite "schedule a post for tomorrow at 9am
  to LinkedIn-SkoolScout and Instagram-TourneySeason: 'New
  feature launch — read more at...'"

# View queue
/integrations:hootsuite "show me what's scheduled this week"

# List channels
/integrations:hootsuite "list connected channels"
```

### As delegation target (LinkedIn integration routing here)

When `/integrations:linkedin "post update about X"` runs and
LinkedIn has `writeDelegation.delegate: hootsuite,
channelId: abc123`:

1. LinkedIn integration classifies operation as write
2. LinkedIn integration looks up its delegation config
3. LinkedIn integration invokes Hootsuite with channel mapping
4. Hootsuite POSTs to its API with `socialProfileIds: ["abc123"]`

The user runs `/integrations:linkedin "..."` but Hootsuite is
the one actually executing the publish. Reading from Hootsuite
isn't the typical case (LinkedIn read goes direct).

## Phase 4: result formatting

### Channel listing

```
=== Hootsuite Channels ===
Connected social profiles (5):

  LinkedIn:
    [abc123] @jefelabs (LinkedIn Page) — connected 2026-01-15
    [xyz789] Edwin (LinkedIn Personal) — connected 2026-01-15

  Instagram:
    [def456] TourneySeason (Business Account) — connected 2026-02-01

  Reddit:
    [ghi789] u/edwin-jefelabs — connected 2026-03-10

  X (Twitter):
    [jkl012] @jefelabs — connected 2026-01-15
    Status: ⚠ token expired (re-auth required at hootsuite.com)

Last refreshed: 5m ago
```

### Schedule confirmation

```
=== Hootsuite Post Scheduled ===
Message ID:    msg_xyz789
Scheduled:     2026-05-04 14:00 UTC
Channels:      
  - LinkedIn @jefelabs
  - Instagram TourneySeason

Content preview:
  "Excited to share our new feature for school admins..."

Status: queued
View in Hootsuite: https://hootsuite.com/dashboard#/scheduled
```

### Queue listing

```
=== Hootsuite Queue ===
Scheduled (next 7 days, 8 posts):

Tomorrow (2026-05-04):
  09:00  LinkedIn @jefelabs
         "New feature launch announcement..."
  14:00  Instagram TourneySeason
         "Sports community spotlight..."
  17:30  Reddit u/edwin-jefelabs (r/SaaS)
         "Lessons from building B2B SaaS..."

Sunday (2026-05-05):
  10:00  LinkedIn @jefelabs (cross-post: Reddit r/programming)
         "Weekly engineering update..."

[5 more posts scheduled this week]

To modify or cancel: https://hootsuite.com/dashboard#/scheduled
```

## Phase 5: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 Unauthorized | Token expired; OAuth refresh needed | Re-run `/integrations:setup hootsuite` |
| 403 Forbidden | Token lacks scope for operation | Hootsuite scopes: `offline`, `messages`, etc. Re-auth with required scopes. |
| 404 Channel not found | channelId no longer valid | Channel may have been disconnected in Hootsuite UI. Run `/integrations:setup hootsuite --update` to refresh channel list. |
| 422 Validation error | Content too long, image format wrong, etc. | Surface validation message; per-platform character limits enforced |
| 429 Rate limit | Too many requests | Hootsuite rate limits per token; backoff |

## Cross-namespace integration

This integration is invoked by:

- **Direct invocation by user** for cross-platform scheduling
- **Direct platform integrations as write delegate** —
  LinkedIn, Instagram, Reddit, X, Threads (when those have
  `writeDelegation.delegate: hootsuite`)
- **`market/social/`** commands that produce content and want
  to surface "publish via Hootsuite" as the next step
- **`workflows:manage`** workflows that schedule social
  campaigns

The marketing namespace produces content; Hootsuite publishes.
Pattern documented in market/_context.md.

## Channel-to-platform mapping

The `managedChannels` array in the manifest maps Hootsuite
channels to platform integrations:

```jsonc
{
  "integrations": {
    "hootsuite": {
      "managedChannels": [
        {
          "platform": "linkedin",
          "channelId": "abc123",
          "displayName": "LinkedIn — @jefelabs"
        },
        {
          "platform": "linkedin",
          "channelId": "xyz789",
          "displayName": "LinkedIn — Edwin Personal"
        },
        {
          "platform": "instagram",
          "channelId": "def456",
          "displayName": "Instagram — TourneySeason"
        }
      ]
    }
  }
}
```

When LinkedIn integration delegates a write, it passes its
configured channelId to Hootsuite. If LinkedIn's
`writeDelegation.channelId` is "abc123", the post goes to
@jefelabs on LinkedIn.

For users with multiple accounts on the same platform (two
LinkedIn pages, multiple Instagram accounts), each platform
integration's `writeDelegation.channelId` selects which one.

If LinkedIn integration is configured for delegation but the
user wants to post to a DIFFERENT LinkedIn channel, they'd
either:
- Reconfigure LinkedIn delegation to that channel
- Use Hootsuite directly with `--channel xyz789`

## What this integration does NOT do

- **Replace per-platform analytics.** Hootsuite has analytics
  but they're fragmentary. For rich analytics, use direct
  platform integrations.
- **Manage Hootsuite team/billing.** Out of scope; Hootsuite
  UI for that.
- **Auto-detect optimal posting time.** Hootsuite has a
  feature for this; surface their recommendation if API
  exposes it but don't second-guess.
- **Cross-post identical content blindly.** Different
  platforms have different conventions (LinkedIn long-form vs
  X short-form vs Instagram visual). The content you schedule
  should be platform-appropriate; Hootsuite executes
  whatever you provide.

---

# Registry definition

## Integration metadata

```yaml
name: hootsuite
displayName: Hootsuite
provider: hootsuite
category: marketing-platform
multiInstance: false  # one Hootsuite account per team
isDelegate: true      # serves as write delegate for social platforms
```

## Interfaces

### CLI

**Not available.** No canonical Hootsuite CLI.

### MCP

**Not available.** No widely-adopted Hootsuite MCP.

### REST

```yaml
baseUrl: https://platform.hootsuite.com/v1
authMethod: oauth2-bearer
authHeaders:
  - "Authorization: Bearer {HOOTSUITE_ACCESS_TOKEN}"
rateLimit: 100/minute (varies by endpoint)
documentationUrl: https://developer.hootsuite.com/docs/api
oauthFlow: |
  Hootsuite uses OAuth 2.0 Authorization Code flow.
  Setup walks user through:
  1. Register an app in developer portal
  2. Approve OAuth scopes
  3. Receive auth code; exchange for access token + refresh token
  Suite stores both access and refresh tokens in keychain.
  Refresh logic runs when access token expires.
```

## Credentials

### `HOOTSUITE_ACCESS_TOKEN`

- **Description**: OAuth access token for Hootsuite API
- **Sensitive**: yes (keychain storage)
- **Lifetime**: typically short-lived (hours); refreshed via
  refresh token
- **Where to obtain**: setup walks through OAuth flow

### `HOOTSUITE_REFRESH_TOKEN`

- **Description**: OAuth refresh token; longer-lived
- **Sensitive**: yes (keychain storage)
- **Lifetime**: usually 30+ days; rotated when used
- **Used for**: refreshing access token without re-auth

### `HOOTSUITE_CLIENT_ID` and `HOOTSUITE_CLIENT_SECRET`

- **Description**: OAuth app credentials (registered in
  Hootsuite developer portal)
- **Sensitive**: client_id moderate; client_secret high
- **Storage**: client_secret to keychain; client_id may go
  in env (less sensitive but still ideally keychain)
- **Where to obtain**:
  https://developer.hootsuite.com/ — register an app

## Managed channels

Hootsuite's primary value is the channel management.
`managedChannels` array in the integration entry tracks which
social channels Hootsuite is connected to. Setup populates
this array by querying the API after auth.

When a managed channel is referenced by another integration's
`writeDelegation.channelId`, Hootsuite's REST API receives the
`socialProfileIds: [channelId]` in the post payload.

## Rate limits

REST: 100/minute on most endpoints. Stricter on bulk endpoints.

For high-volume teams (large content calendars, many channels),
consider Buffer or another platform with higher limits.

## Required by skillz commands

(Auto-populated.)

## Compliance considerations

Hootsuite is generally not used in financial institution
contexts (those teams typically don't post to public social
networks for compliance reasons). For SkoolScout/jefelabs
contexts, standard rotation (90 days) is appropriate.

If using Hootsuite Enterprise, additional logging and approval
workflows may apply at the Hootsuite level; the suite's
integration just calls the API and Hootsuite's internal
controls handle compliance.

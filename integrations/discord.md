---
description: Discord integration for messaging and server operations via Discord REST API. REST only (no canonical CLI; no widely-adopted Discord MCP). Read messages, post to channels, manage threads, query server (guild) and channel structure. Supports both bot tokens (server-side) and user tokens (limited; against TOS for automation typically).
argument-hint: <free-form-prompt> [--guild <id>] [--channel <id>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`.

Direct invocation of Discord for server (guild) and channel
operations via Discord REST API. Discord uses **bot tokens**
for the recommended auth model — the suite registers as a
Discord bot; users add the bot to their server.

## Phase 0: pre-flight

1. Verify `discord` integration is active:

   ```bash
   ACTIVE=$(jq -r '.integrations.discord.active // false' \
                 product/.pencil-integrations.json)
   if [ "$ACTIVE" != "true" ]; then
     echo "Discord integration not active. Run /integrations:setup discord"
     exit 1
   fi
   ```

2. Verify bot token available:

   ```bash
   BOT_TOKEN=$(resolve_credential "discord" "DISCORD_BOT_TOKEN")
   if [ -z "$BOT_TOKEN" ]; then
     echo "Discord bot token missing. Run /integrations:setup discord"
     exit 1
   fi
   ```

3. Resolve target guild/channel context:

   ```bash
   DEFAULT_GUILD=$(jq -r '.integrations.discord.perResourceScoping.defaultGuildId // empty' \
                         product/.pencil-integrations.json)
   ```

## Phase 1: prompt interpretation

Operations Discord handles:

### Server (guild) operations

- **List guilds**: servers the bot has been added to
- **Get guild details**: members, channels, roles
- **List channels in a guild**: text, voice, category,
  thread channels

### Channel operations

- **Read channel messages**: recent or paginated history
- **Post message**: send to a text channel
- **Post embed**: rich embedded message with title, fields,
  color
- **Edit message**: update bot's previously-posted messages
- **Delete message**: remove bot's messages (or any with
  manage-messages permission)
- **Create thread**: start a thread from a channel or message
- **Reply to message**: continue a conversation

### Member operations

- **List members**: in a guild (paginated)
- **Get member**: details for specific user
- **Send DM**: direct message to a user (with restrictions —
  user must share a server with the bot AND have DMs from
  server members enabled)

### Webhook operations

- **Post via webhook**: alternative to bot token; fire-and-
  forget posting to a specific channel via webhook URL
  (useful when bot setup is complex)

## Phase 2: execution

```bash
BOT_TOKEN=$(resolve_credential "discord" "DISCORD_BOT_TOKEN")

# List guilds bot is in
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  "https://discord.com/api/v10/users/@me/guilds"

# List channels in a guild
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/${GUILD_ID}/channels"

# Read recent messages in a channel
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=20"

# Post a message
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -d '{
    "content": "Quick update: PR #1247 is ready for review."
  }'

# Post a rich embed
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -d '{
    "embeds": [{
      "title": "PR #1247 Ready for Review",
      "url": "https://github.com/skoolscout/api/pull/1247",
      "description": "New auth module discussed in standup yesterday",
      "color": 5793266,
      "fields": [
        { "name": "Author", "value": "Sarah Chen", "inline": true },
        { "name": "Files changed", "value": "12", "inline": true },
        { "name": "Lines", "value": "+340 / -85", "inline": true }
      ]
    }]
  }'

# Reply to a message
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -d '{
    "content": "Looking now",
    "message_reference": {
      "message_id": "'"${REFERENCED_MESSAGE_ID}"'"
    }
  }'

# Create thread from a message
curl -sS \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/threads" \
  -d '{
    "name": "PR #1247 review discussion",
    "auto_archive_duration": 4320
  }'

unset BOT_TOKEN
```

### Webhook posting (alternative)

When the project has webhook URLs configured (simpler than
bot setup for fire-and-forget posting):

```bash
WEBHOOK_URL=$(jq -r '.integrations.discord.webhooks.development // empty' \
                    product/.pencil-integrations.json)

if [ -n "$WEBHOOK_URL" ]; then
  curl -sS \
    -H "Content-Type: application/json" \
    -X POST "$WEBHOOK_URL" \
    -d '{
      "content": "Build succeeded for main",
      "username": "AgentX Bot",
      "embeds": [...]
    }'
fi
```

Webhooks are fire-and-forget — no read capability — but
require less setup than full bot. Useful for CI notifications
and one-way automation.

## Phase 3: result formatting

### Guild listing

```
=== Discord: Bot's Servers ===
3 servers:

📋 SkoolScout Engineering
   Members: 12 · Channels: 8
   Bot role: AgentX Bot
   Permissions: Read Messages, Send Messages, Manage Threads
   
   Text channels:
     #general
     #development
     #incidents
     #standup
     #ai-experiments
   
   Categories:
     [Engineering Internal] (private; bot has access)

📋 jefelabs Community
   Members: 47 · Channels: 6
   Bot permissions: Read, Send, Embed Links

📋 Tournament Season Public Server
   Members: 234 · Channels: 12
   Bot permissions: Read, Send (limited)
```

### Message thread

```
=== Discord: SkoolScout Engineering / #development ===

Recent messages (12):

[Today]

10:15 AM · @sarahchen
  Anyone available to review #1247? Has the new auth module.
  
  └─ 10:18 AM · @edwincostello
       Looking now
  
  └─ 10:32 AM · @tompark
       Reviewed; left a few comments

11:42 AM · @marcusrivera
  FYI — staging is down, looks like a DB connection issue.
  Investigating.
  
  React: 👀 (3) · 🚨 (1)
  
  └─ 11:45 AM · @sarahchen
       Need help?
  
  └─ 11:58 AM · @marcusrivera
       Got it. Connection pool was exhausted.
       Restarted, monitoring.

[Bot's recent activity in this channel]
  Today 9:30 AM — Build succeeded for main
  Today 8:15 AM — Build succeeded for develop
  Yesterday — Build failed for feature/payment-flow
```

### Posted message confirmation

```
=== Discord: Message Posted ===
Server:   SkoolScout Engineering
Channel:  #development
Message ID: 1234567890

Content:
  Quick update: PR #1247 is ready for review.

Posted at 2:34 PM. Visible to channel members.
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 Unauthorized | Bot token invalid or revoked | Re-create token in Discord developer portal; re-run setup |
| 403 Forbidden | Bot lacks permission for the action | Check bot's role permissions in the server |
| 404 Not Found | Channel/message ID doesn't exist or no access | Verify ID; check if bot is in the server |
| 429 Rate limited | Per-route or global rate limit | Backoff per `X-RateLimit-Reset-After` header |
| 50001 Missing Access | Bot not in server / no view permission | Add bot to server; grant view permission |
| 50007 Cannot send DM | User has DMs disabled or doesn't share server with bot | Use channel post instead |
| 50013 Missing Permissions | Bot role lacks specific permission | Adjust bot role in server settings |

Discord rate limits are **per-route**, not global. Heavy
posting to one channel can be throttled while other channels
remain available. Respect `X-RateLimit-Reset-After`.

## Cross-namespace integration

Discord is consumed by:

- **Direct user invocation** for messaging
- **CI/CD workflows** (when configured) — build status,
  deploy notifications via webhooks
- **`/workflows:manage start engineer:adr-cycle`** — ADR
  notifications to Discord
- **Community engagement workflows** for jefelabs community
  server (announcements, release notes)
- **Alternative to Slack** for teams not on Slack

## Bot vs webhook decision

| Use case | Recommended |
|----------|-------------|
| Read messages, query state | Bot (webhooks can't read) |
| Two-way conversation | Bot |
| One-way notifications (CI builds, deploys) | Webhook (simpler) |
| Posting from external system without Discord SDK | Webhook |
| Threading, reactions, member management | Bot |
| Per-channel auth (different webhook per channel) | Webhook |

The integration manifest supports both:

```jsonc
{
  "integrations": {
    "discord": {
      "active": true,
      "preference": "rest",
      "credentials": {
        "DISCORD_BOT_TOKEN": { "storage": "keychain" }
      },
      "webhooks": {
        "development": "https://discord.com/api/webhooks/...",
        "incidents": "https://discord.com/api/webhooks/...",
        "deploys": "https://discord.com/api/webhooks/..."
      },
      "perResourceScoping": {
        "defaultGuildId": "123456789",
        "defaultGuildName": "SkoolScout Engineering"
      }
    }
  }
}
```

The integration uses bot token by default; webhooks fall
back when posting to a channel where webhook is configured
and bot token isn't sufficient.

## Privileged intents

Discord requires explicit opt-in for "privileged intents":

- **Server Members Intent**: receive member list events
- **Message Content Intent**: read message content (not
  just metadata)
- **Presence Intent**: see online status

For bots in 100+ servers, Discord requires verification AND
explicit approval for privileged intents. For smaller bots,
the developer enables them in the developer portal.

The integration's read-message operations require Message
Content Intent. Setup walks the user through enabling it.

## Direct messages (DMs)

The bot can send DMs only when:

1. The bot and the target user share at least one server,
   AND
2. The target user has not disabled "Allow direct messages
   from server members" in that server

Otherwise, DM attempts return error 50007. The integration
surfaces this error specifically:

```
Could not send DM to @sarahchen.

Possible causes:
  1. User has disabled DMs from server members
  2. Bot and user don't share any server
  3. User has blocked the bot

Suggestion: post in a channel both can see, or ask the user
to enable server-member DMs.
```

## What this integration does NOT do

- **Replace Discord client.** Voice channels, video,
  screen sharing, server administration UI stay in the
  Discord client.
- **Manage Discord servers (guilds) administratively.**
  Server creation, member moderation, permission overhauls
  — admin operations not in scope.
- **Run Discord slash commands as a user.** The bot can
  REGISTER slash commands (out of scope here); the
  integration is for direct API operations.
- **Handle voice/video/streaming.** Discord's voice
  protocols are separate; not in scope.
- **Discord stage channels, forum channels** — partial
  support varies; the integration handles text channels
  primarily.

## Examples

```bash
# List servers and channels
/integrations:discord "list my Discord servers"

# Read recent messages
/integrations:discord "show recent messages in #development on SkoolScout Engineering"

# Post update
/integrations:discord "post to #development on SkoolScout Engineering: PR #1247 ready"

# Post embed
/integrations:discord "post a rich embed to #incidents about the staging outage"

# Create thread
/integrations:discord "create a thread under that message titled 'PR review discussion'"

# Webhook post (CI integration)
/integrations:discord --webhook deploys "post: deploy to staging succeeded"
```

---

# Registry definition

## Integration metadata

```yaml
name: discord
displayName: Discord
provider: discord
category: messaging
multiInstance: false  # one bot per project; bot can be in
                      # many servers but is one identity
canBeDelegated: false # not a write delegate target; not a delegation client
```

## Interfaces

### CLI

**Not available.** No canonical Discord CLI.

### MCP

**Not available** at this time. Several community Discord
MCPs exist; none widely standardized.

### REST

```yaml
baseUrl: https://discord.com/api/v10
authMethod: bot-token
authHeaders:
  - "Authorization: Bot {DISCORD_BOT_TOKEN}"
rateLimit: per-route (varies); global 50/sec
documentationUrl: https://discord.com/developers/docs/intro
```

Webhooks use a different URL (no auth header; secret in URL):

```yaml
webhookUrl: https://discord.com/api/webhooks/{webhook-id}/{webhook-token}
authMethod: webhook-secret-in-url
```

## Credentials

### `DISCORD_BOT_TOKEN`

- **Description**: Discord bot token for the registered
  application
- **Sensitive**: yes (full bot impersonation if leaked)
- **Storage**: keychain
- **Where to obtain**:
  https://discord.com/developers/applications →
  your app → Bot → Reset Token (note: shown once)
- **Rotation**: tokens don't auto-expire but should be
  rotated if compromised; default 90 days suite-side

### Webhook URLs (per channel, in manifest)

- **Description**: Per-channel webhook URLs for fire-and-
  forget posting
- **Sensitive**: moderate (URL contains secret)
- **Storage**: in manifest's `webhooks` object (env var or
  keychain depending on sensitivity)

## Required by skillz commands

Auto-populated.

## Compliance considerations

Discord is consumer-grade messaging, generally not appropriate
for compliance-sensitive contexts:

- **No enterprise compliance certifications** that match
  financial-services / healthcare requirements
- **Server data is hosted by Discord** — not for confidential
  business data
- **Chat content retention** — Discord retains; org has no
  control

For SkoolScout / jefelabs community work: Discord is
appropriate. For financial-institution work: avoid Discord
for any business communication.

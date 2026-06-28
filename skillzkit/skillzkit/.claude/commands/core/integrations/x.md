---
description: X (formerly Twitter) integration for read operations (timeline, search, user info, post analytics) and write operations (post composition, threads, replies, reposts). Reads via X API v2 directly when API tier permits; writes can delegate to Hootsuite. Significant API tier and pricing changes since 2023 mean direct API access is now paid for most use cases — Hootsuite delegation is often the practical write path.
argument-hint: <free-form-prompt> [--use-direct-write]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`, `integrations/hootsuite.md`
> (when delegation is in use).

Direct invocation of X for posting and engagement. The
integration handles the constrained reality of post-2023 X
API: free tier is read-limited and write-limited; Basic tier
($100/mo) provides some access; Pro ($5,000/mo) for full
access. For most users, Hootsuite delegation provides a more
cost-effective write path.

## Phase 0: pre-flight

Same pattern — verify integration active, detect read vs
write, route accordingly:

```bash
ACTIVE=$(jq -r '.integrations.x.active // false' \
              product/.pencil-integrations.json)
[ "$ACTIVE" = "true" ] || {
  echo "X (Twitter) not active. Run /core:integrations:setup x"
  exit 1
}

OPERATION_TYPE=$(classify_prompt "$PROMPT")  # read or write

if [ "$OPERATION_TYPE" = "write" ]; then
  HOOTSUITE_ACTIVE=$(jq -r '.integrations.hootsuite.active // false' \
                           product/.pencil-integrations.json)
  X_MANAGED=$(jq -r '.integrations.hootsuite.managedChannels.x // false' \
                    product/.pencil-integrations.json)
  
  if [ "$HOOTSUITE_ACTIVE" = "true" ] && [ "$X_MANAGED" = "true" ] && \
     [ "${USE_DIRECT_WRITE:-false}" != "true" ]; then
    ROUTE="hootsuite"
  else
    ROUTE="direct"
    
    # Warn about API tier requirements for direct writes
    API_TIER=$(jq -r '.integrations.x.apiTier // "free"' \
                     product/.pencil-integrations.json)
    if [ "$API_TIER" = "free" ]; then
      echo "⚠ X free tier has very limited write access (50 posts/24h)"
      echo "  Consider Hootsuite delegation: /core:integrations:setup hootsuite"
    fi
  fi
else
  ROUTE="direct"
fi
```

## Phase 1: prompt interpretation

### Read operations

- **User timeline**: own posts (constrained on free tier)
- **User info**: profile, follower count, post count
- **Post details**: specific post by ID
- **Post analytics**: impressions, engagement (Premium
  users only)
- **Search posts**: keyword search (limited on free tier)
- **Mentions**: posts mentioning user (limited)
- **List management**: own lists, list members

### Write operations

- **Post**: text up to 280 chars (free) or 4,000 (Premium)
- **Thread**: chained posts (replies to self)
- **Reply**: respond to another post
- **Repost** (formerly retweet): share another's post
- **Quote post**: repost with own commentary
- **Delete own post**: remove
- **Edit own post**: limited window (Premium only)
- **Bookmark / unbookmark**

## Phase 2: execution

### Direct path (API v2)

```bash
X_BEARER_TOKEN=$(resolve_credential "x" "X_BEARER_TOKEN")
# OR for user-context operations: OAuth 2.0 user access token
X_USER_TOKEN=$(get_x_user_oauth_token)

# Get authenticated user info
curl -sS \
  -H "Authorization: Bearer $X_USER_TOKEN" \
  "https://api.x.com/2/users/me?user.fields=public_metrics,description"

# User's recent posts
curl -sS \
  -H "Authorization: Bearer $X_USER_TOKEN" \
  "https://api.x.com/2/users/${USER_ID}/tweets?max_results=20&tweet.fields=public_metrics,created_at"

# Search recent posts (free tier: very limited; Basic+: better)
curl -sS \
  -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=skoolscout&max_results=25"

# Post a tweet
curl -sS \
  -H "Authorization: Bearer $X_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://api.x.com/2/tweets" \
  -d '{
    "text": "Excited to announce our partnership with [district name]..."
  }'

# Post a thread (sequential replies to self)
TWEET_1_ID=$(post_tweet "First post in thread...")
TWEET_2_ID=$(post_tweet_reply "$TWEET_1_ID" "Second post...")
TWEET_3_ID=$(post_tweet_reply "$TWEET_2_ID" "Third post...")

# Reply to existing post
curl -sS \
  -H "Authorization: Bearer $X_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://api.x.com/2/tweets" \
  -d '{
    "text": "Great point — would add that...",
    "reply": {
      "in_reply_to_tweet_id": "1234567890"
    }
  }'

# Repost
curl -sS \
  -H "Authorization: Bearer $X_USER_TOKEN" \
  -X POST "https://api.x.com/2/users/${USER_ID}/retweets" \
  -d '{ "tweet_id": "1234567890" }'

unset X_BEARER_TOKEN X_USER_TOKEN
```

### API tier awareness

The integration tracks the configured API tier and surfaces
quota-relevant warnings:

```
=== X API Tier: free ===
Quota usage (approx, last 24h):
  Posts:        12/50 (24%)
  API reads:    47/1500 monthly (3%)

Free tier limits:
  - 50 posts per 24 hours
  - 1,500 API reads per month
  - No search beyond very recent tweets
  - No analytics beyond public metrics

Approaching daily post limit? Consider Hootsuite delegation
for additional posts.
```

### Delegation path

```
=== X Write — Delegating to Hootsuite ===

Content prepared:
  Type:     post (single tweet)
  Text:     "Excited to share our latest customer story:
             [name] district reduced compliance prep time
             by 80% with SkoolScout. Read how:
             https://skoolscout.com/case/[name]"
  Length:   180 chars (within 280 limit)
  Schedule: now (or specified time)
  Account:  @skoolscout (Hootsuite-managed)

Routing to Hootsuite for publication...

=== Posted ===
Account:    @skoolscout
Posted via: Hootsuite
Post URL:   https://x.com/skoolscout/status/...
```

## Phase 3: result formatting

### Timeline

```
=== X: @skoolscout Recent Posts ===
Followers: 1,420 · Following: 84 · Posts: 421

  3 days ago
    "Our latest case study: [district name] reduced compliance
     prep time by 80% with SkoolScout..."
    🔁 12 ❤️  47 🗨 8 · 4,200 impressions

  5 days ago (thread, 4 posts)
    "FERPA compliance shouldn't be a 40-hour quarterly
     ritual. 🧵 1/4..."
    Thread engagement: 23 reposts, 89 likes total
  
  ... (continues)
```

### Search results

```
=== X Search: "FERPA compliance" ===
Range: last 7 days · API tier: free (limited results)

  3 hours ago by @districtITLeader
    "Just spent the day prepping for our FERPA audit.
     There has GOT to be a better way..."
    🔁 2 ❤️  18 🗨 5
    
    Suggested action: this is a high-quality engagement
    target. Consider replying with helpful context (not
    promotional).

  1 day ago by @edupolicywatch
    "New ED guidance on FERPA-compliant AI tools in
     classrooms..."
    🔁 47 ❤️  234 🗨 34
  
  ... (more)

Search limited on free tier. Upgrade tier for better access:
  /core:integrations:setup x  # configure API tier
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 | Token expired or invalid | OAuth refresh; re-auth if persists |
| 403 | Insufficient access for this tier | Upgrade tier OR use Hootsuite delegation |
| 429 | Rate limit | Backoff per `x-rate-limit-reset` header |
| 88 | Rate limit (older error code) | Same as 429 |
| 187 | Duplicate status | X rejects identical tweets within ~24h |
| 226 | Automated content (suspected bot behavior) | Reduce frequency, vary content |

X enforces aggressive rate limits and is sensitive to
patterns suggesting automation. Posts at exactly :00 every
hour, identical hashtag patterns, or rapid-fire identical
content patterns can flag the account.

## Cross-namespace integration

X is consumed by:

- **Direct user invocation** for engagement, monitoring
- **`market:social:` X content commands** — produce content;
  user reviews; this integration publishes (via delegation)
- **`market:workflows:launch-campaign`** — multi-channel
  campaigns
- **Mention monitoring** — query mentions of brand keywords
- **Competitive intelligence** — monitor competitor activity

## Cost-aware tier guidance

| Use case | Recommended path |
|----------|------------------|
| 1-5 posts/week, light engagement monitoring | Free tier, manual posting OR Hootsuite |
| 5-30 posts/week, mention monitoring | Hootsuite delegation (likely cheaper than Basic) |
| Heavy automation, agency-scale | X API Basic+ |
| Search-heavy research | X API Basic minimum (search heavily limited on free) |
| Real-time ingestion of public stream | X API Pro ($5K/mo) |

For SkoolScout / jefelabs contexts: free tier + Hootsuite
delegation is almost certainly the right call. The delegation
pattern is meaningful here precisely because direct API
access is now expensive.

## What this integration does NOT do

- **Bypass X's algorithmic distribution.** Posts go through
  X's algorithm; the integration doesn't predict reach.
- **Spaces (audio rooms).** No API for Spaces creation/
  management.
- **Premium-only features for non-Premium accounts.** Edit,
  long posts, advanced analytics require subscription.
- **DMs at scale.** Direct messaging API requires elevated
  access tier.
- **Bulk follow/unfollow.** API allows but X aggressively
  detects this and suspends accounts.

## Examples

```bash
# Account info
/core:integrations:x "show my X account stats"

# Recent posts
/core:integrations:x "show my recent posts with engagement"

# Search
/core:integrations:x "search for FERPA compliance discussions in the last 24 hours"

# Mentions
/core:integrations:x "show recent mentions of @skoolscout"

# Post (delegates to Hootsuite when configured)
/core:integrations:x "post: Excited to announce..."

# Post thread
/core:integrations:x "post a 4-tweet thread about FERPA compliance: [content]"

# Reply
/core:integrations:x "reply to that post about FERPA prep time with helpful context"

# Force direct posting
/core:integrations:x --use-direct-write "post: ..."
```

---

# Registry definition

## Integration metadata

```yaml
name: x
displayName: X (formerly Twitter)
provider: x-corp
category: social-network
multiInstance: false
canBeDelegated: true
delegateTarget: hootsuite
```

## Interfaces

### CLI

**Not available.** No canonical X CLI from X Corp; community
tools (twurl) exist but require API keys anyway.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://api.x.com/2
authMethod: oauth2-bearer (varies by operation)
authHeaders:
  - "Authorization: Bearer {X_BEARER_TOKEN}"
        # for app-only operations (limited)
  - "Authorization: Bearer {X_USER_OAUTH_TOKEN}"
        # for user-context operations (most things)
documentationUrl: https://developer.x.com/en/docs/x-api
notes: |
  X API v2 has tier-based access:
    Free:    Very limited reads, 50 posts/24h
    Basic:   $100/mo, 50K reads/month, 3K posts/day
    Pro:     $5,000/mo, 1M reads/month
    Enterprise: Custom pricing
  
  Access scope varies per endpoint per tier — check
  developer docs for specifics.
```

## Credentials

### `X_API_KEY` and `X_API_SECRET`

- **Description**: App-level OAuth credentials from
  developer.x.com app
- **Sensitive**: yes (keychain)

### `X_BEARER_TOKEN`

- **Description**: App-only access token (for read-only
  app-context operations)
- **Sensitive**: yes (keychain)

### `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`

- **Description**: User OAuth tokens (for user-context
  operations including posting)
- **Sensitive**: yes (keychain)

### `apiTier` (in manifest, not keychain)

- **Description**: free / basic / pro / enterprise
- **Sensitive**: no
- **Storage**: manifest field
- **Purpose**: integration adjusts behavior and warnings
  based on tier

## Required by skillz commands

Auto-populated.

## Compliance considerations

- **X ToS**: automated posting subject to ToS; aggressive
  automation risks suspension
- **API tier compliance**: posting volume must stay within
  tier limits
- **Brand safety**: posts can be removed by X for policy
  violations
- **GDPR / CCPA**: applies to user data reads

For Edwin's contexts: SkoolScout and jefelabs use cases
likely fit free tier + Hootsuite delegation. Financial-
institution consulting work probably doesn't involve X
posting.

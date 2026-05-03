---
description: Instagram integration for read operations (account insights, post analytics, comment management) via Instagram Graph API. Writes (publishing posts, stories, reels) are typically delegated to Hootsuite when configured — Instagram's direct-write API requires Business/Creator account + Facebook Page connection + extensive review. Reads are direct; writes route through Hootsuite for simpler scheduling.
argument-hint: <free-form-prompt> [--media-id <id>] [--use-direct-write]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`, `integrations/hootsuite.md`
> (when delegation is in use).

Direct invocation of Instagram for analytics, comment
management, and content reads. Writes follow the **delegation
pattern** — when Hootsuite is configured, posts/stories
publish through Hootsuite's scheduling API. Direct Instagram
writes are possible but require Instagram Business or Creator
account + linked Facebook Page + extensive Meta app review,
which is rarely worth the friction for individual creators
or small teams.

## Phase 0: pre-flight

1. Verify integration is active:

   ```bash
   ACTIVE=$(jq -r '.integrations.instagram.active // false' \
                 product/.pencil-integrations.json)
   if [ "$ACTIVE" != "true" ]; then
     echo "Instagram not active. Run /integrations:setup instagram"
     exit 1
   fi
   ```

2. Determine operation type and routing:

   ```bash
   # Detect read vs write from prompt
   OPERATION_TYPE=$(classify_prompt "$PROMPT")  # "read" or "write"
   
   if [ "$OPERATION_TYPE" = "write" ]; then
     # Check if Hootsuite is configured as delegate target
     HOOTSUITE_ACTIVE=$(jq -r '.integrations.hootsuite.active // false' \
                              product/.pencil-integrations.json)
     INSTAGRAM_MANAGED=$(jq -r '.integrations.hootsuite.managedChannels.instagram // false' \
                                product/.pencil-integrations.json)
     
     USE_DIRECT_WRITE_FLAG="${USE_DIRECT_WRITE:-false}"
     
     if [ "$HOOTSUITE_ACTIVE" = "true" ] && \
        [ "$INSTAGRAM_MANAGED" = "true" ] && \
        [ "$USE_DIRECT_WRITE_FLAG" != "true" ]; then
       ROUTE="hootsuite"
     else
       ROUTE="direct"
     fi
   else
     ROUTE="direct"   # reads always direct
   fi
   ```

3. Resolve credentials based on route:

   ```bash
   case "$ROUTE" in
     direct)
       IG_ACCESS_TOKEN=$(resolve_credential "instagram" "INSTAGRAM_ACCESS_TOKEN")
       IG_BUSINESS_ID=$(jq -r '.integrations.instagram.businessAccountId // empty' \
                              product/.pencil-integrations.json)
       [ -n "$IG_ACCESS_TOKEN" ] || {
         echo "Instagram access token missing"
         echo "Run /integrations:setup instagram"
         exit 1
       }
       ;;
     hootsuite)
       # Hootsuite handles auth itself
       echo "Routing write through Hootsuite (Instagram account managed there)"
       ;;
   esac
   ```

## Phase 1: prompt interpretation

### Read operations (direct)

- **Account info**: profile, follower count, media count
- **Post insights**: impressions, reach, engagement on a
  specific post
- **Account insights**: aggregated reach, profile views
  over time period
- **Recent media**: list recent posts, stories, reels
- **Specific post**: full media details with caption,
  thumbnail
- **Comments on post**: list, paginate
- **Mentions**: posts/stories mentioning the account

### Write operations (delegated)

- **Publish photo post**: image + caption + optional location
- **Publish carousel**: multiple images + caption
- **Publish reel**: video + caption + cover frame
- **Publish story**: time-limited content (24h)
- **Schedule post**: future publish time
- **Reply to comment**: respond on owned posts
- **Delete post / story / reel**: remove owned content

## Phase 2: execution

### Direct path (reads + optional direct writes)

```bash
IG_ACCESS_TOKEN=$(resolve_credential "instagram" "INSTAGRAM_ACCESS_TOKEN")
IG_BUSINESS_ID=$(jq -r '.integrations.instagram.businessAccountId // empty' \
                       product/.pencil-integrations.json)

# Account info
curl -sS \
  "https://graph.facebook.com/v18.0/${IG_BUSINESS_ID}?fields=username,followers_count,media_count,profile_picture_url&access_token=${IG_ACCESS_TOKEN}"

# Recent media (last 25)
curl -sS \
  "https://graph.facebook.com/v18.0/${IG_BUSINESS_ID}/media?fields=id,caption,media_type,timestamp,permalink&limit=25&access_token=${IG_ACCESS_TOKEN}"

# Specific post insights
curl -sS \
  "https://graph.facebook.com/v18.0/${MEDIA_ID}/insights?metric=impressions,reach,engagement,saved&access_token=${IG_ACCESS_TOKEN}"

# Comments on a post
curl -sS \
  "https://graph.facebook.com/v18.0/${MEDIA_ID}/comments?fields=id,text,username,timestamp,from&access_token=${IG_ACCESS_TOKEN}"

# Account-level insights (last 30 days)
SINCE=$(date -u -d "30 days ago" +%s 2>/dev/null || date -u -v-30d +%s)
UNTIL=$(date -u +%s)
curl -sS \
  "https://graph.facebook.com/v18.0/${IG_BUSINESS_ID}/insights?metric=reach,profile_views&period=day&since=${SINCE}&until=${UNTIL}&access_token=${IG_ACCESS_TOKEN}"

unset IG_ACCESS_TOKEN
```

### Direct write (when explicitly requested via --use-direct-write)

Instagram direct publishing is a 2-step process: create
container, then publish.

```bash
# Step 1: Create media container
CONTAINER_ID=$(curl -sS \
  -X POST "https://graph.facebook.com/v18.0/${IG_BUSINESS_ID}/media" \
  -d "image_url=${IMAGE_URL}" \
  -d "caption=${CAPTION}" \
  -d "access_token=${IG_ACCESS_TOKEN}" | \
  jq -r '.id')

# Step 2: Publish container
curl -sS \
  -X POST "https://graph.facebook.com/v18.0/${IG_BUSINESS_ID}/media_publish" \
  -d "creation_id=${CONTAINER_ID}" \
  -d "access_token=${IG_ACCESS_TOKEN}"
```

The image must be at a publicly-accessible URL (Instagram
fetches it). For local images, the integration first uploads
to a temporary hosting location (S3 with presigned URL,
typically) — but this requires additional configuration.
Most users find Hootsuite's local-file handling simpler.

### Delegation path (writes via Hootsuite)

When delegation is the route, the integration constructs the
content and hands off:

```
=== Instagram Write — Delegating to Hootsuite ===

Content prepared:
  Type:     photo
  Caption:  "Excited to announce SkoolScout v1.4..."
            (180 chars · 3 hashtags · 2 mentions)
  Image:    /tmp/skoolscout-launch-graphic.png (1080x1080)
  Schedule: now (or specified time)
  Account:  @skoolscout (Hootsuite-managed)

Routing to Hootsuite for publication...
```

Then internally invokes `/integrations:hootsuite` with the
prepared payload. Hootsuite handles the Instagram API
specifics, image upload, and scheduling. The user sees the
result as if Instagram published directly:

```
=== Instagram Post Published ===
Account:    @skoolscout
Posted via: Hootsuite
Post ID:    18012345678901234 (Hootsuite-tracked)
URL:        https://instagram.com/p/...

Insights will be available in ~15 minutes via:
  /integrations:instagram "show insights for the last post"
```

The `Posted via:` line makes the routing explicit so users
understand the publishing path without confusion.

## Phase 3: result formatting

### Account info

```
=== Instagram: @skoolscout ===
Followers:    2,847
Following:    312
Posts:        184
Bio:          Modern student data platform for K-12 schools

Recent activity (last 30 days):
  Posts:        8
  Stories:      24
  Reels:        2
  Total reach:  47,200 (avg 5,900/post)
  Profile views: 1,240

Best-performing recent post:
  https://instagram.com/p/CXY123/
  "Announcing our partnership with..."
  Reach: 12,400 · Engagement rate: 8.2%
```

### Post insights

```
=== Instagram Post Insights ===
Post:       https://instagram.com/p/CXY123/
Posted:     5 days ago
Type:       carousel (3 images)

Impressions:    14,820
Reach:          12,400  (84% of impressions are unique)
Engagement:     1,016   (likes + comments + saves + shares)
  Likes:        847
  Comments:     89
  Saves:        62
  Shares:       18

Engagement rate: 8.2% (above your 30-day avg of 5.4%)

Audience reaction:
  Most-saved among posts in the last 30 days
  3rd most-shared
  
Comment sentiment (rough): positive
  Top topics in comments: pricing, partnership, schools
```

### Recent posts

```
=== Instagram: Recent Posts (10) ===

5 days ago · CAROUSEL
  "Announcing our partnership with [district name]..."
  Reach: 12,400 · ER: 8.2% ⭐
  https://instagram.com/p/CXY123/

8 days ago · IMAGE
  "FERPA compliance made simple..."
  Reach: 5,200 · ER: 4.1%

12 days ago · REEL
  "30-second tour of our compliance dashboard"
  Reach: 8,800 · ER: 6.8%

[continues...]
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 190 OAuthException | Token expired or revoked | Re-auth: /integrations:setup instagram |
| 100 Invalid parameter | Malformed request | Verify business account ID, media ID |
| 200 Permissions error | App lacks required permissions | Check Meta app review status |
| 4 Application limit | Rate limited | Backoff; Instagram limits aggressively for non-Business |
| 24 Subcode 2207050 | Image too small / wrong aspect | Verify image meets Instagram specs |

## Cross-namespace integration

Instagram is consumed by:

- **Direct user invocation** for content management
- **`market:social:` commands** — produce content; user
  reviews; this integration publishes (via delegation)
- **`market:workflows:launch-campaign`** — campaign workflows
  schedule cross-platform posts; Instagram is one channel
- **Analytics workflows** — aggregating reach across platforms

## When direct write makes sense vs delegation

| Direct write | Delegation via Hootsuite |
|--------------|--------------------------|
| Instagram Business/Creator + FB Page already set up | Already using Hootsuite for scheduling |
| Need precise timing (specific second) | Approximate scheduling fine |
| Posting >25 times/day | Lower volume |
| Custom workflows wanting fine control | Standard publishing flow |
| Willing to maintain Meta app review compliance | Want to skip Meta app maintenance |

For SkoolScout / jefelabs contexts: delegation through
Hootsuite is almost certainly simpler. Direct write becomes
worthwhile only if Hootsuite's scheduling delays are
problematic.

## What this integration does NOT do

- **Replace Instagram app for browsing.** Discovery, DMs,
  full feed browsing — app handles those.
- **Manage Instagram DMs at scale.** DM API requires
  Messenger platform access; out of scope.
- **Bulk import historical posts.** No bulk-historical-data
  endpoint; analytics start from when account was added.
- **Run paid ad campaigns.** Meta Ads Manager / Marketing
  API are separate; not in scope here.

## Examples

```bash
# Account info
/integrations:instagram "show my Instagram account info"

# Post insights
/integrations:instagram "insights for my last post"

# Recent posts
/integrations:instagram "show my recent 10 posts with engagement"

# Comments
/integrations:instagram "show comments on my latest post"

# Publish (delegates to Hootsuite when configured)
/integrations:instagram "publish this post: [caption] with [image-path]"

# Force direct publish (skip delegation)
/integrations:instagram --use-direct-write \
  "publish this post: [caption] with [image-url]"

# Schedule via delegation
/integrations:instagram "schedule this post for tomorrow 9am: [caption]"
```

---

# Registry definition

## Integration metadata

```yaml
name: instagram
displayName: Instagram (Meta)
provider: meta
category: social-network
multiInstance: false
canBeDelegated: true       # writes can route through Hootsuite
delegateTarget: hootsuite
```

## Interfaces

### CLI

**Not available.** No canonical Instagram CLI from Meta.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://graph.facebook.com/v18.0
authMethod: bearer-token
authQueryParam: access_token={INSTAGRAM_ACCESS_TOKEN}
documentationUrl: https://developers.facebook.com/docs/instagram-api
notes: |
  Uses the Instagram Graph API (not the legacy Basic
  Display API which Meta is sunsetting). Requires
  Instagram Business or Creator account linked to a
  Facebook Page.
```

## Credentials

### `INSTAGRAM_ACCESS_TOKEN`

- **Description**: Long-lived access token from Meta app
- **Sensitive**: yes (keychain)
- **Where to obtain**:
  1. Create Meta app at developers.facebook.com
  2. Add Instagram Graph API product
  3. Connect Instagram Business/Creator account via
     linked Facebook Page
  4. Generate access token via Graph API Explorer or
     Meta Business System User
  5. Exchange short-lived for long-lived (60 days)
- **Rotation**: 60 days for long-lived; integration warns
  approaching expiry

### `businessAccountId` (in manifest, not keychain)

- **Description**: Instagram Business Account ID
- **Sensitive**: no (an identifier)
- **Storage**: manifest field

## Required by skillz commands

Auto-populated.

## Compliance considerations

- **App review**: Meta requires app review for many
  Instagram Graph API permissions. Standard reads (public
  account info, own media) work without review; advanced
  permissions (publish, mention reads) require review
- **Rate limits**: Aggressive for non-Business apps
- **Privacy regulations**: GDPR, CCPA apply to user data
  reads; Instagram provides cookie/consent infra
- **Brand safety**: Posts can be removed by Instagram
  for policy violations; the integration doesn't predict
  what Instagram will accept

---
description: Reddit integration for read operations (post listings, comment threads, subreddit info, user activity) and write operations (post submission, commenting, voting). Reads use Reddit's REST API directly; writes can be delegated to Hootsuite when configured. Reddit's organic-engagement culture means automated posting is risky — most posting should remain manual or carefully scheduled.
argument-hint: <free-form-prompt> [--subreddit <name>] [--use-direct-write]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`, `integrations/hootsuite.md`
> (when delegation is in use).

Direct invocation of Reddit for community engagement,
research, and content management. Reads are direct via
Reddit's REST API; writes can route through Hootsuite when
configured (with caveats — Reddit's culture penalizes
inauthentic-feeling automated posting more than other
platforms).

## Phase 0: pre-flight

Same pattern as Instagram — verify integration active,
detect read vs write, route accordingly:

```bash
ACTIVE=$(jq -r '.integrations.reddit.active // false' \
              product/.pencil-integrations.json)
[ "$ACTIVE" = "true" ] || {
  echo "Reddit not active. Run /integrations:setup reddit"
  exit 1
}

OPERATION_TYPE=$(classify_prompt "$PROMPT")  # read or write

if [ "$OPERATION_TYPE" = "write" ]; then
  HOOTSUITE_ACTIVE=$(jq -r '.integrations.hootsuite.active // false' \
                           product/.pencil-integrations.json)
  REDDIT_MANAGED=$(jq -r '.integrations.hootsuite.managedChannels.reddit // false' \
                         product/.pencil-integrations.json)
  
  if [ "$HOOTSUITE_ACTIVE" = "true" ] && [ "$REDDIT_MANAGED" = "true" ] && \
     [ "${USE_DIRECT_WRITE:-false}" != "true" ]; then
    ROUTE="hootsuite"
  else
    ROUTE="direct"
  fi
else
  ROUTE="direct"
fi
```

Resolve credentials for direct route:

```bash
if [ "$ROUTE" = "direct" ]; then
  REDDIT_TOKEN=$(get_reddit_oauth_token)  # OAuth refresh as needed
  USER_AGENT=$(jq -r '.integrations.reddit.userAgent // empty' \
                     product/.pencil-integrations.json)
  
  [ -n "$REDDIT_TOKEN" ] && [ -n "$USER_AGENT" ] || {
    echo "Reddit credentials missing. Run /integrations:setup reddit"
    exit 1
  }
fi
```

Reddit requires a custom `User-Agent` header — the integration
enforces this. Format: `<platform>:<app-name>:<version> (by /u/<username>)`.

## Phase 1: prompt interpretation

### Read operations (direct)

- **Subreddit listing**: hot/new/top posts in a subreddit
- **Post details**: full post with comments
- **Comment thread**: nested comment tree
- **User profile**: posts, comments, karma
- **Search**: across Reddit or within subreddit
- **Multireddit**: aggregated feed from multiple subreddits
- **Subreddit info**: rules, subscriber count, activity
- **Saved posts**: user's saved content
- **Inbox**: messages, mentions, replies (when authenticated
  as user)

### Write operations (delegated when possible)

- **Submit post**: text or link to a subreddit
- **Comment**: reply to post or comment
- **Edit own content**: update post text or comment
- **Delete**: remove own content
- **Vote**: upvote/downvote (use VERY sparingly to avoid
  manipulation flags)
- **Save / unsave**: bookmark posts
- **Send message**: DM to user
- **Subscribe / unsubscribe**: subreddit membership

## Phase 2: execution

### Direct path

```bash
REDDIT_TOKEN=$(get_reddit_oauth_token)
USER_AGENT=$(jq -r '.integrations.reddit.userAgent' \
                   product/.pencil-integrations.json)

# Subreddit hot posts
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://oauth.reddit.com/r/sysadmin/hot?limit=25"

# Post details
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://oauth.reddit.com/r/sysadmin/comments/${POST_ID}"

# Search
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://oauth.reddit.com/r/k12sysadmin/search?q=FERPA&restrict_sr=true&sort=top&t=year"

# User profile (own user)
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://oauth.reddit.com/api/v1/me"

# Inbox unread
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  "https://oauth.reddit.com/message/unread"

# Submit text post (direct write)
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  -X POST "https://oauth.reddit.com/api/submit" \
  -d "kind=self" \
  -d "sr=k12sysadmin" \
  -d "title=Question about FERPA-compliant student data export" \
  -d "text=Long-form question text here..."

# Comment on a post
curl -sS \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H "User-Agent: $USER_AGENT" \
  -X POST "https://oauth.reddit.com/api/comment" \
  -d "thing_id=t3_${POST_ID}" \
  -d "text=Thoughtful response here..."

unset REDDIT_TOKEN
```

### Delegation path

When delegation is active and the prompt is a write
operation:

```
=== Reddit Write — Delegating to Hootsuite ===

⚠ Reddit-specific consideration:
  Reddit communities react strongly to inauthentic posting.
  Even via Hootsuite, posts should sound authentically you,
  reference subreddit context, and follow each subreddit's
  rules.
  
Content prepared:
  Subreddit: r/k12sysadmin
  Title:     Anyone using SkoolScout for FERPA-compliant
             student data exports?
  Type:      text post
  Body:      "We've been evaluating SkoolScout for our
              district. Curious if anyone here has..."
              [200 chars]
  
Subreddit rules check:
  ✓ Not a self-promotion (you're asking for input, not
    promoting)
  ✓ Title length within range
  ⚠ This subreddit prohibits posts about specific products
    by name unless you flair as "Vendor Discussion"
  
  Suggestion: add flair "Vendor Discussion" or rephrase
  to ask the broader question without product name.

Continue? [Y/edit/abort]
```

The integration runs subreddit-rule heuristics where possible
(based on rules listed in subreddit info) but doesn't
guarantee compliance. Reddit's culture is subtle and varies
substantially across subreddits.

## Phase 3: result formatting

### Subreddit hot posts

```
=== r/k12sysadmin: Hot Posts ===
Subscribers: 23,400 · Active now: 412

  [1] 145 ↑  47 💬  Posted 4 hours ago by u/teacherIT
      "What's everyone using for FERPA-compliant LMS now?"
      
  [2] 89 ↑   23 💬  Posted 8 hours ago by u/districtsysadmin
      "Migrating from Skyward to PowerSchool — anyone done it?"
  
  [3] 76 ↑   18 💬  Posted 12 hours ago by u/k12techlead
      "Annual reminder: review your Google Workspace student
       data settings"
  
  ... (22 more)

To read post: /integrations:reddit "show post 1"
To search: /integrations:reddit "search this subreddit for FERPA"
```

### Post details with comments

```
=== r/k12sysadmin: FERPA-compliant LMS ===
Posted by u/teacherIT · 4 hours ago · 145 ↑

Body:
  We're looking to migrate off [old LMS] this summer due to
  ongoing FERPA concerns. What's everyone using these days
  that you trust with student data?
  
  Specifically interested in:
  - Audit logging
  - Granular permissions
  - Data export controls

47 comments, sorted by best:

  u/sysadminveteran · 2 hours ago · 28 ↑
    Canvas with Cidi Labs has worked well for us. The
    audit logging in particular...
  
    └─ u/teacherIT (OP) · 1 hour ago · 8 ↑
         Thanks. We trialed Canvas before but didn't try
         Cidi Labs add-on...
  
  u/districtsysadmin · 1 hour ago · 18 ↑
    We just migrated from Schoology to Brightspace. The
    FERPA documentation Brightspace publishes is...
  
  ... (more comments)

Sentiment: positive (community offering experiences)
Relevant for: SkoolScout positioning research
```

### Inbox

```
=== Reddit Inbox: Unread (3) ===

  [u/sysadminveteran] 2 hours ago
    Reply to your comment in r/k12sysadmin
    "Thanks for the SkoolScout suggestion. We tried it last
     month and..."
  
  [u/k12techlead] 1 day ago
    Direct message
    "Hey, saw your post about FERPA. Mind if I ask about..."
  
  [r/sysadmin Mod] 3 days ago
    "Your post in r/sysadmin has been flagged for..."
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| 401 | Token expired | OAuth refresh attempted; re-auth if persists |
| 403 | Banned subreddit OR user banned | Some content not accessible |
| 404 | Subreddit doesn't exist OR private | Verify name; check if private |
| 429 Rate limited | Too many requests | Reddit limits aggressively; backoff |
| 503 | Reddit having an outage | Try later |
| RATELIMIT response body | Submission throttle (account too new / too active) | New accounts have limits; wait |

Reddit specifies rate limits in `X-Ratelimit-*` headers. The
integration respects these.

## Cross-namespace integration

Reddit is consumed by:

- **Direct user invocation** for community research
- **`market:social:reddit`** content commands — produce
  posts; user reviews; this integration publishes (via
  delegation when possible)
- **`market:workflows:launch-campaign`** — community
  outreach as campaign component
- **Research workflows** — gathering competitive
  intelligence and user pain-points from communities

## Reddit-specific cultural caveats

Unlike LinkedIn (professional), Twitter/X (broadcast), or
Instagram (visual), Reddit communities have strong norms
against:

- **Self-promotion** without community contribution
  history
- **Posts that read as marketing copy** (banner-ad style)
- **Cross-posting identical content** to multiple subreddits
- **Use of "we" or "our" in product references** when not
  established as a vendor poster
- **Posts with obvious "engagement bait" patterns**

The integration doesn't enforce these but documents the
risk. For SkoolScout / jefelabs marketing: prefer
genuinely-helpful contributions over promotional posts;
keep heavy promotion to subreddits that explicitly allow
it (with vendor flair or in vendor-friendly subreddits).

## What this integration does NOT do

- **Replace Reddit web/app for browsing.** UI is faster
  for casual reading.
- **Bulk-vote or coordinate engagement.** Vote
  manipulation is against Reddit ToS and Reddit detects
  this aggressively.
- **Bypass subreddit-specific moderation.** Each subreddit
  has its own mods and AutoMod; the integration submits
  posts that mods may remove.
- **Provide rich Reddit search beyond what API offers.**
  Reddit search is famously limited; the integration
  doesn't compensate.

## Examples

```bash
# Read subreddit
/integrations:reddit "show me hot posts in r/k12sysadmin"

# Read specific post
/integrations:reddit "show me the FERPA migration discussion"

# Search
/integrations:reddit "search r/sysadmin for posts about FERPA in the last year"

# Inbox
/integrations:reddit "show my unread Reddit messages"

# Profile activity
/integrations:reddit "show my Reddit comments from this week"

# Submit post (delegates to Hootsuite when configured)
/integrations:reddit --subreddit k12sysadmin \
  "submit a question about FERPA-compliant student data tools"

# Force direct submit
/integrations:reddit --subreddit k12sysadmin --use-direct-write \
  "submit this question: ..."
```

---

# Registry definition

## Integration metadata

```yaml
name: reddit
displayName: Reddit
provider: reddit-inc
category: social-network
multiInstance: false
canBeDelegated: true
delegateTarget: hootsuite
```

## Interfaces

### CLI

**Not available.** Reddit doesn't ship a canonical CLI;
community CLIs (rtv, tuir) exist but aren't suite-ready.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://oauth.reddit.com
authMethod: oauth2-bearer
authHeaders:
  - "Authorization: Bearer {REDDIT_ACCESS_TOKEN}"
  - "User-Agent: {REDDIT_USER_AGENT}"   # required, custom format
documentationUrl: https://www.reddit.com/dev/api/
notes: |
  User-Agent header is mandatory and must be unique per app.
  Format: <platform>:<app-name>:<version> (by /u/<username>)
  Example: linux:agentx-skillzkit:v1.0.0 (by /u/jefelabs)
```

## Credentials

### `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`

- **Description**: OAuth app credentials from
  https://www.reddit.com/prefs/apps
- **Sensitive**: yes (client secret is sensitive; client ID
  less so but treated as sensitive for safety)
- **Storage**: keychain

### `REDDIT_REFRESH_TOKEN`

- **Description**: Long-lived refresh token from initial
  OAuth authorization
- **Sensitive**: yes
- **Storage**: keychain

### `REDDIT_USER_AGENT` (in manifest, not keychain)

- **Description**: Required custom User-Agent string
- **Sensitive**: no (identifier)
- **Storage**: manifest field

## Required by skillz commands

Auto-populated.

## Compliance considerations

- **Reddit ToS**: posting / commenting must be authentic;
  vote manipulation prohibited
- **GDPR**: Reddit user data subject to GDPR for EU users
- **Subreddit rules**: each subreddit has its own rules;
  not enforced by API, only by mods
- **Suspended accounts**: API access tied to account; if
  account suspended, integration breaks

For SkoolScout marketing context: prefer organic
contribution over automated posting. The delegation pattern
exists to make scheduling possible but the cultural
recommendation is sparing use.

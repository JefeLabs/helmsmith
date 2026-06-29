---
description: LinkedIn integration for posts, articles, mentions, and analytics. REST API only — no canonical CLI or MCP. WRITE DELEGATION: when Hootsuite is configured as delegate, write operations (posts, articles) route through Hootsuite by default. READS always use direct LinkedIn API (richer analytics, mentions, audience data). The first integration validating the delegation client pattern.
argument-hint: <free-form-prompt> [--use-direct] [--use-delegate] [--read-only]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of LinkedIn for posts, content publishing,
mention tracking, and analytics. The first integration where
write operations may be delegated to Hootsuite.

## Phase 0: pre-flight

1. Read `product/.pencil-integrations.json`. Verify `linkedin`
   is active.

2. Verify direct REST credentials are available (always
   needed for reads, even when delegation handles writes):

   ```bash
   LINKEDIN_TOKEN=$(resolve_credential "linkedin" "LINKEDIN_ACCESS_TOKEN")
   if [ -z "$LINKEDIN_TOKEN" ]; then
     echo "LinkedIn credentials missing. Run /core:integrations:setup linkedin"
     echo ""
     echo "Note: Direct LinkedIn API access is required even if you've"
     echo "configured Hootsuite for write delegation, because read"
     echo "operations always go direct."
     exit 1
   fi
   ```

3. Read delegation configuration:

   ```bash
   DELEGATE=$(jq -r '.integrations.linkedin.writeDelegation.delegate // empty' \
                   product/.pencil-integrations.json)
   DELEGATION_ENABLED=$(jq -r '.integrations.linkedin.writeDelegation.enabled // false' \
                              product/.pencil-integrations.json)
   DELEGATE_CHANNEL_ID=$(jq -r '.integrations.linkedin.writeDelegation.channelId // empty' \
                              product/.pencil-integrations.json)
   FALLBACK_TO_DIRECT=$(jq -r '.integrations.linkedin.writeDelegation.fallbackToDirect // true' \
                             product/.pencil-integrations.json)
   ```

## Phase 1: prompt classification

Classify the operation as read or write:

```bash
classify_operation() {
  local PROMPT="$1"
  
  # Write keywords
  if echo "$PROMPT" | grep -qiE "(post|publish|share|create|update|comment|reply|delete)"; then
    echo "write"
    return
  fi
  
  # Read keywords
  if echo "$PROMPT" | grep -qiE "(show|find|search|fetch|list|get|analyze|monitor|view)"; then
    echo "read"
    return
  fi
  
  # Ambiguous — surface to user
  echo "ambiguous"
}

OPERATION=$(classify_operation "$PROMPT")
```

When ambiguous, prompt user:

```
Operation type isn't clear from your prompt. Is this a:
  [r] Read (fetch/search/analyze existing content)
  [w] Write (post/publish/comment)
  [a] Abort

Choice:
```

## Phase 2: routing decision

### Read operations (always direct)

Read operations skip delegation entirely:

```bash
if [ "$OPERATION" = "read" ]; then
  do_direct_read
  exit 0
fi
```

Reads include:
- Search posts (own posts, mentions, hashtags)
- Fetch analytics (engagement, impressions, click-through)
- Get profile details, follower lists, connection data
- Query company page metrics

### Write operations

Write operations check delegation configuration:

```bash
# User-explicit override
if [ "$USE_DIRECT" = "true" ]; then
  do_direct_write
  exit 0
fi

if [ "$USE_DELEGATE" = "true" ]; then
  if [ -z "$DELEGATE" ]; then
    echo "No delegate configured. Run /core:integrations:setup linkedin"
    echo "and enable Hootsuite delegation."
    exit 1
  fi
  do_delegate_write
  exit 0
fi

# No explicit flag — use configured default
if [ -n "$DELEGATE" ] && [ "$DELEGATION_ENABLED" = "true" ]; then
  do_delegate_write
else
  do_direct_write
fi
```

## Phase 3: delegate write path

When routing through Hootsuite:

```bash
do_delegate_write() {
  echo "Routing via Hootsuite (configured delegate)..."
  
  # Verify delegate is available
  HOOTSUITE_ACTIVE=$(jq -r '.integrations.hootsuite.active // false' \
                          product/.pencil-integrations.json)
  if [ "$HOOTSUITE_ACTIVE" != "true" ]; then
    handle_delegate_unavailable "delegate-not-active"
    return
  fi
  
  HOOTSUITE_TOKEN=$(resolve_credential "hootsuite" "HOOTSUITE_ACCESS_TOKEN")
  if [ -z "$HOOTSUITE_TOKEN" ]; then
    handle_delegate_unavailable "delegate-no-credentials"
    return
  fi
  
  # Verify the channel ID is still valid
  CHANNEL_VALID=$(curl -sS \
    -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
    "https://platform.hootsuite.com/v1/socialProfiles/${DELEGATE_CHANNEL_ID}" \
    | jq -r '.id // empty')
  
  if [ -z "$CHANNEL_VALID" ]; then
    handle_delegate_unavailable "channel-invalid"
    return
  fi
  
  # POST to Hootsuite with the channel ID
  RESPONSE=$(curl -sS \
    -H "Authorization: Bearer $HOOTSUITE_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST "https://platform.hootsuite.com/v1/messages" \
    -d "{
      \"text\": \"$CONTENT\",
      \"socialProfileIds\": [\"$DELEGATE_CHANNEL_ID\"]
    }")
  
  unset HOOTSUITE_TOKEN
  
  echo "Posted via Hootsuite to LinkedIn (@channel-displayname)"
  echo "Response: $RESPONSE"
}
```

### Handling delegate unavailable

```bash
handle_delegate_unavailable() {
  local REASON="$1"
  
  echo ""
  echo "Hootsuite (your configured write delegate) isn't currently usable."
  case "$REASON" in
    delegate-not-active)
      echo "  Reason: Hootsuite integration is inactive in this project"
      ;;
    delegate-no-credentials)
      echo "  Reason: Hootsuite credentials missing or invalid"
      ;;
    channel-invalid)
      echo "  Reason: Hootsuite channel ${DELEGATE_CHANNEL_ID} no longer valid"
      echo "  (channel may have been disconnected in Hootsuite)"
      ;;
  esac
  echo ""
  echo "Options:"
  echo "  [r] Retry Hootsuite (after fixing the issue)"
  
  if [ "$FALLBACK_TO_DIRECT" = "true" ]; then
    echo "  [d] Use LinkedIn direct API for this invocation only"
  fi
  
  echo "  [c] Change delegation permanently (disable; use direct)"
  echo "  [a] Abort"
  echo ""
  read -p "Choice: " CHOICE
  
  case "$CHOICE" in
    r|R) do_delegate_write ;;
    d|D)
      if [ "$FALLBACK_TO_DIRECT" = "true" ]; then
        do_direct_write
      else
        echo "Direct fallback disabled by configuration."
        exit 1
      fi
      ;;
    c|C)
      jq '.integrations.linkedin.writeDelegation.enabled = false' \
        product/.pencil-integrations.json > /tmp/manifest.json
      mv /tmp/manifest.json product/.pencil-integrations.json
      echo "Delegation disabled. Routing direct."
      do_direct_write
      ;;
    *) exit 1 ;;
  esac
}
```

## Phase 4: direct write path

When routing direct (no delegation OR delegation overridden
OR delegation failed and user chose direct):

LinkedIn REST API for posting:

```bash
do_direct_write() {
  echo "Posting via LinkedIn direct API..."
  
  LINKEDIN_TOKEN=$(resolve_credential "linkedin" "LINKEDIN_ACCESS_TOKEN")
  PERSON_URN=$(jq -r '.integrations.linkedin.personUrn' \
                    product/.pencil-integrations.json)
  
  curl -sS \
    -H "Authorization: Bearer $LINKEDIN_TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Restli-Protocol-Version: 2.0.0" \
    -X POST "https://api.linkedin.com/v2/ugcPosts" \
    -d "{
      \"author\": \"urn:li:person:${PERSON_URN}\",
      \"lifecycleState\": \"PUBLISHED\",
      \"specificContent\": {
        \"com.linkedin.ugc.ShareContent\": {
          \"shareCommentary\": { \"text\": \"$CONTENT\" },
          \"shareMediaCategory\": \"NONE\"
        }
      },
      \"visibility\": {
        \"com.linkedin.ugc.MemberNetworkVisibility\": \"PUBLIC\"
      }
    }"
  
  unset LINKEDIN_TOKEN
}
```

LinkedIn's API has quirks:
- Posts are called "UGC Posts" (User Generated Content) in
  legacy v2 API; "Posts" in newer Posts API
- Author URNs (`urn:li:person:XXX` for personal,
  `urn:li:organization:YYY` for company pages)
- Content uses ShareContent / ArticleContent / etc. depending
  on type
- Image/video posting requires multi-step upload flow

## Phase 5: direct read path

Reads always use direct LinkedIn API:

```bash
do_direct_read() {
  LINKEDIN_TOKEN=$(resolve_credential "linkedin" "LINKEDIN_ACCESS_TOKEN")
  
  case "$READ_TYPE" in
    own-posts)
      curl -sS \
        -H "Authorization: Bearer $LINKEDIN_TOKEN" \
        "https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aperson%3A${PERSON_URN})"
      ;;
    
    mentions)
      # LinkedIn API has limited public mention search;
      # depends on tier/scope
      echo "Note: Public mention search is restricted by LinkedIn's API"
      echo "tier. This may require LinkedIn Marketing Developer Platform."
      ;;
    
    analytics)
      curl -sS \
        -H "Authorization: Bearer $LINKEDIN_TOKEN" \
        "https://api.linkedin.com/v2/socialActions/{shareUrn}"
      ;;
  esac
  
  unset LINKEDIN_TOKEN
}
```

## Phase 6: result formatting

### Post confirmation (delegate path)

```
=== LinkedIn Post Scheduled (via Hootsuite) ===
Channel:       LinkedIn — @helmsmith
Routing:       Hootsuite (delegated)
Hootsuite ID:  msg_xyz789

Content preview:
  "Excited to share our latest update on the AgentX
   ecosystem..."

Send time: immediate
Status:    queued by Hootsuite

View in Hootsuite: https://hootsuite.com/dashboard
```

### Post confirmation (direct path)

```
=== LinkedIn Post Published (direct) ===
Author:    @helmsmith
Post URN:  urn:li:share:7234567890

Content preview:
  "Excited to share our latest update on the AgentX
   ecosystem..."

Visibility: PUBLIC
Posted:     2026-05-03 19:45 UTC

View on LinkedIn: https://www.linkedin.com/feed/update/urn:li:share:7234567890
```

### Read result (analytics)

```
=== LinkedIn Analytics ===
Post: "Excited to share our latest update..."
URN:  urn:li:share:7234567890
Posted: 2026-05-03 (2d ago)

Engagement:
  Impressions:   1,247
  Clicks:        38
  Reactions:     52  (👍 41, 🎉 6, 💡 5)
  Comments:      8
  Reposts:       3
  Engagement rate: 4.9%

Top reactions from:
  Senior Engineer at <Company>
  Director of Engineering at <Company>
  CTO at <Company>
  ...
```

## Cross-namespace integration

This integration is invoked by:

- **`market/social/linkedin`** for content production →
  invokes `/core:integrations:linkedin` for publishing (which
  routes via Hootsuite when configured)
- **Direct user invocation** for analytics, mentions,
  one-off posts
- **`workflows:manage`** for campaign workflows that include
  LinkedIn posts

## What this integration does NOT do

- **Replace LinkedIn's web/mobile UI.** Comment threading,
  connection management, messaging, profile editing — all
  LinkedIn UI work.
- **Bypass LinkedIn API restrictions.** LinkedIn's API tiers
  matter: free tier is read-mostly; richer write access
  requires Partner Program approval. The integration works
  within whatever tier the user has.
- **Auto-detect optimal post times.** Hootsuite has features
  for this; the suite delegates to Hootsuite for scheduling
  optimization.
- **Handle LinkedIn Ads.** Different API surface; potential
  future integration as `/core:integrations:linkedin-ads`.

---

# Registry definition

## Integration metadata

```yaml
name: linkedin
displayName: LinkedIn
provider: linkedin
category: social-network
multiInstance: false
canBeDelegated: true   # supports writeDelegation pattern
```

## Interfaces

### CLI

**Not available.** No canonical LinkedIn CLI.

### MCP

**Not available** at this time. May change as ecosystem
matures.

### REST

```yaml
baseUrl: https://api.linkedin.com/v2
authMethod: oauth2-bearer
authHeaders:
  - "Authorization: Bearer {LINKEDIN_ACCESS_TOKEN}"
  - "X-Restli-Protocol-Version: 2.0.0"
rateLimit: tier-dependent (free tier has strict limits)
documentationUrl: https://learn.microsoft.com/en-us/linkedin/
```

## Credentials

### `LINKEDIN_ACCESS_TOKEN`

- **Description**: OAuth access token for LinkedIn API
- **Sensitive**: yes (keychain storage)
- **Lifetime**: 60 days (LinkedIn's default)
- **Where to obtain**: setup walks through OAuth flow via
  LinkedIn Developer Portal (https://developer.linkedin.com/)

### `LINKEDIN_REFRESH_TOKEN`

- **Description**: Long-lived refresh token
- **Sensitive**: yes (keychain storage)
- **Lifetime**: 365 days
- **Used for**: refreshing access token without re-auth

### Person URN (in manifest, not credentials)

After OAuth, the user's person URN
(`urn:li:person:XXXXXXXX`) is fetched via `/me` endpoint and
stored in `personUrn` field of integration entry. Used as
author for direct posts.

## Write delegation

```yaml
canBeDelegated: true
delegateOptions:
  - hootsuite
  - buffer  # if/when Buffer integration is added
```

When the user has Hootsuite (or Buffer) configured AND
LinkedIn's `writeDelegation.enabled: true`, write operations
route through the delegate.

## Scopes

LinkedIn OAuth scopes (depend on intended use):
- `r_liteprofile` — read user's profile (always)
- `r_emailaddress` — read user's email
- `w_member_social` — write posts on behalf of user
- `r_organization_social` — read organization's posts
- `w_organization_social` — write on behalf of organization
- `rw_organization_admin` — manage org page (admin)

For full posting + analytics: usually `r_liteprofile` +
`w_member_social` is sufficient. Org page posting requires
admin scope and Partner Program for some tiers.

## Rate limits

LinkedIn's rate limits depend on:
- Token tier (free vs Marketing Developer Platform)
- Scope (some scopes have stricter limits)
- Endpoint (analytics endpoints stricter than profile reads)

Surfaced in `X-RateLimit-Remaining` headers. The integration
flags when limits approach.

For high-volume needs (multi-page management, frequent
posting), Marketing Developer Platform tier required.

## Required by skillz commands

(Auto-populated.)

## Compliance considerations

LinkedIn integration is generally less compliance-sensitive
than financial-data integrations. Standard token rotation
applies.

For corporate compliance contexts (financial institution
posting from official corporate LinkedIn), additional
considerations:
- Token typically belongs to a corporate communications
  account, not individual user
- Posting may require pre-approval workflow (Hootsuite
  approval queue handles this)
- Audit logs available via LinkedIn's enterprise tools

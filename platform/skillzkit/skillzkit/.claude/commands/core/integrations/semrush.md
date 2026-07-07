---
description: SEMrush integration for marketing intelligence — keyword research, domain analysis, backlink data, traffic estimation, competitor analysis, and SERP tracking. REST only. Read-only API; no write/delegation pattern. Heavily relevant for SkoolScout's content marketing and competitive positioning work.
argument-hint: <free-form-prompt> [--domain <domain>] [--database <country-code>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `integrations/_context.md`,
> `integrations/credentials.md`.

Direct invocation of SEMrush for marketing intelligence
queries. SEMrush data informs positioning, content strategy,
and competitive analysis — heavily relevant for SkoolScout's
content marketing and education-sector keyword work.

This integration is **read-only**. SEMrush is data-retrieval;
no write/delegation pattern applies.

## Phase 0: pre-flight

1. Verify integration is active:

   ```bash
   ACTIVE=$(jq -r '.integrations.semrush.active // false' \
                 product/.pencil-integrations.json)
   if [ "$ACTIVE" != "true" ]; then
     echo "SEMrush not active. Run /core:integrations:setup semrush"
     exit 1
   fi
   ```

2. Resolve credentials:

   ```bash
   SEMRUSH_API_KEY=$(resolve_credential "semrush" "SEMRUSH_API_KEY")
   [ -n "$SEMRUSH_API_KEY" ] || {
     echo "SEMrush API key missing. Run /core:integrations:setup semrush"
     exit 1
   }
   ```

3. Check API unit balance (SEMrush charges API units per call):

   ```bash
   UNIT_BALANCE=$(curl -sS \
     "https://api.semrush.com/?type=user_balance&key=${SEMRUSH_API_KEY}")
   
   if [ "$UNIT_BALANCE" -lt 1000 ]; then
     echo "⚠ Low SEMrush API unit balance: $UNIT_BALANCE units remaining"
     echo "  Each query consumes 10-50 units typically"
   fi
   ```

   The integration surfaces unit cost estimates before
   expensive operations.

## Phase 1: prompt interpretation

Operations SEMrush handles:

### Domain analysis

- **Domain overview**: organic and paid traffic estimation,
  authority score, keyword count
- **Domain organic keywords**: top keywords driving traffic
- **Domain paid keywords**: keywords competitors bid on
- **Domain anchor links**: backlinks pointing in
- **Domain referring domains**: unique domains linking
- **Top pages**: highest-traffic pages on domain

### Keyword research

- **Keyword overview**: search volume, CPC, competition,
  trend
- **Keyword variants**: related keywords with metrics
- **Keyword questions**: question-form variants
- **Keyword difficulty**: estimated SEO difficulty (0-100)
- **Keyword broad match**: broader queries containing the
  keyword
- **Keyword phrase match**: queries with exact phrase

### Competitive analysis

- **Domain competitors**: organic competitors of a domain
- **Common keywords**: keywords two domains both rank for
- **Domain vs domain**: side-by-side metric comparison
- **SERP comparison**: who's ranking for a specific query

### Backlink analytics

- **Referring domains**: who links to a domain
- **Backlink quality**: authority distribution of backlinks
- **Lost / new backlinks**: changes over time
- **Anchor text distribution**: how backlinks are anchored

### Position tracking

- **Domain SERP position**: where a domain ranks for a
  keyword
- **Position changes**: rank changes over time
- **Featured snippets**: positions where domain holds
  snippet

## Phase 2: execution

SEMrush API uses query parameters with API key:

```bash
SEMRUSH_API_KEY=$(resolve_credential "semrush" "SEMRUSH_API_KEY")

# Domain organic keywords (top 100)
curl -sS \
  "https://api.semrush.com/?type=domain_organic&key=${SEMRUSH_API_KEY}&domain=skoolscout.com&database=us&display_limit=100&export_columns=Ph,Po,Nq,Cp,Co,Tr,Tc,Td,Nr"

# Keyword overview
curl -sS \
  "https://api.semrush.com/?type=phrase_this&key=${SEMRUSH_API_KEY}&phrase=ferpa+compliance+software&database=us&export_columns=Ph,Nq,Cp,Co,Nr,Td"

# Domain overview
curl -sS \
  "https://api.semrush.com/?type=domain_ranks&key=${SEMRUSH_API_KEY}&domain=skoolscout.com&database=us&export_columns=Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac"

# Backlinks
curl -sS \
  "https://api.semrush.com/analytics/v1/?key=${SEMRUSH_API_KEY}&type=backlinks&target=skoolscout.com&target_type=root_domain&display_limit=50&export_columns=source_url,source_title,page_ascore,external_num,internal_num,redirect_url,anchor"

# Referring domains
curl -sS \
  "https://api.semrush.com/analytics/v1/?key=${SEMRUSH_API_KEY}&type=backlinks_refdomains&target=skoolscout.com&target_type=root_domain&display_limit=100&export_columns=domain,domain_ascore,backlinks_num,ip,country"

# Common keywords (compare two domains)
curl -sS \
  "https://api.semrush.com/?type=domain_domains&key=${SEMRUSH_API_KEY}&domains=*|*|skoolscout.com|*|*|powerschool.com&database=us&display_limit=50"

unset SEMRUSH_API_KEY
```

### Database selection

SEMrush data is per-country (called "database"). Default for
US-focused work is `us`. The integration prompts for database
when multi-region:

```
=== Database Selection ===

Available SEMrush databases for this query:
  [u] us  (United States) — 240M keywords [recommended for English-language US-focused queries]
  [k] uk  (United Kingdom)
  [c] ca  (Canada)
  [a] au  (Australia)
  [d] de  (Germany)
  [+] more (full list)

Default: us
Choice:
```

## Phase 3: result formatting

### Domain overview

```
=== SEMrush: skoolscout.com ===
Database: us
API units consumed: 10

Authority score:    42 / 100
Organic keywords:   1,247
Organic traffic:    8,400/mo (estimated)
Paid keywords:      18
Paid traffic:       340/mo (estimated)

Trend (last 12 months):
  Organic traffic:  ▁▁▂▃▄▅▆▇█▇▆▆ (growing)
  Keywords:         ▂▃▃▄▅▅▆▆▇▇█▇

Top organic keywords:
  1. "ferpa compliance software" 
     position 4 · 2,400 vol/mo · KD 67
  2. "k12 student data platform"
     position 7 · 880 vol/mo · KD 54
  3. "school district compliance tool"
     position 3 · 1,100 vol/mo · KD 49
  
  ... (plus 1,244 more)

Suggested follow-ups:
  - Domain organic keywords: /core:integrations:semrush "list top 100 organic keywords for skoolscout.com"
  - Backlinks: /core:integrations:semrush "show backlinks pointing to skoolscout.com"
  - Competitors: /core:integrations:semrush "show domain competitors for skoolscout.com"
```

### Keyword overview

```
=== SEMrush Keyword: "ferpa compliance software" ===
Database: us · API units: 10

Search volume:  2,400 / month
Trend (12mo):   ▃▄▄▅▆▆▇▇▇▇█▇  (growing)
CPC:            $14.50
Competition:    0.62 (medium-high)
Keyword difficulty: 67 / 100  (hard)
SERP results:   2,840,000

Top 10 ranking domains:
  1. powerschool.com
  2. clever.com
  3. skoolscout.com  ← us
  4. infinitecampus.com
  5. naviance.com
  ...

Featured snippet: yes (held by powerschool.com)
People also ask: 4 questions
Related keywords:
  - "ferpa compliant software" (1,800/mo)
  - "ferpa compliance tools" (980/mo)
  - "ferpa compliance for schools" (720/mo)

Question variants:
  - "what is ferpa compliance software" (320/mo)
  - "how to choose ferpa compliance software" (180/mo)
  - "best ferpa compliance software for schools" (140/mo)

Suggested actions:
  - Content gaps: /core:integrations:semrush "what keywords does powerschool.com rank for that skoolscout.com doesn't"
  - SERP analysis: /core:integrations:semrush "analyze the SERP for 'ferpa compliance software'"
  - Long-tail: /core:integrations:semrush "find long-tail variants of 'ferpa compliance' under KD 30"
```

### Competitive analysis

```
=== SEMrush: skoolscout.com vs powerschool.com ===
Database: us · API units: 25

Domain authority:
  skoolscout.com:    42 (smaller, growing)
  powerschool.com:   78 (established)

Organic keyword overlap:
  Both rank for:     347 keywords
  Only skoolscout:   900 keywords  
  Only powerschool:  47,200 keywords

Common high-value keywords (top 10 by volume):
  1. "k12 sis software"           (volume 5,400)
     skoolscout: pos 12 · powerschool: pos 1
  2. "student information system"  (volume 4,800)
     skoolscout: pos 18 · powerschool: pos 2
  ...

Keyword opportunity gaps:
  Powerschool ranks well for these where you don't:
  - "student data analytics" (3,200/mo, KD 58)
  - "gradebook software" (2,800/mo, KD 71)
  - "k-12 attendance tracking" (1,900/mo, KD 45)
  
  These could be content opportunities. The KD 45 one is
  most achievable given your authority score.

Backlink overlap:
  Both linked from: 124 domains
  PowerSchool exclusive: 4,200+ domains
```

### Backlink summary

```
=== SEMrush: Backlinks to skoolscout.com ===
API units consumed: 30

Total backlinks:        1,247
Referring domains:      318
Authority distribution: median 35, top quartile 52+

Recent backlinks (last 30 days):
  + edu-news.example.com (AS 67) - 'SkoolScout in our review'
  + districtsysadmin.blog (AS 41) - 'Tools we evaluated for FERPA'
  ... (12 more new)

Lost backlinks (last 30 days):
  - some-blog.example.com (AS 32) - removed
  ... (3 more lost)

Top referring domains by authority:
  1. district-leadership.org (AS 78)
  2. edutech-monthly.com (AS 71)
  3. k12-news.example.com (AS 67)
  ...

Anchor text distribution:
  Branded ('skoolscout'): 67%
  Generic ('learn more'): 12%
  Topic-relevant ('FERPA tool'): 14%
  Other: 7%
  
  Healthy distribution (no over-optimization signals).
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| ERROR :: NOT ENOUGH UNITS | API balance depleted | Top up SEMrush account; defer query |
| ERROR :: WRONG KEY | Invalid API key | Re-run /core:integrations:setup semrush |
| ERROR :: WRONG REQUEST | Malformed query | Check parameters, especially database code |
| ERROR :: NOTHING FOUND | No data for query | Try different domain / keyword / database |
| HTTP 429 | Rate limited | SEMrush throttles; backoff |

SEMrush returns errors as plain text starting with "ERROR ::"
in the response body, not standard HTTP status codes for many
issues. The integration parses this format.

## API unit awareness

SEMrush charges API units per query:

| Query type | Approximate cost |
|------------|------------------|
| Domain overview | 10 units |
| Domain organic keywords | 10 + (rows × 0.1) units |
| Keyword overview | 10 units |
| Backlinks | 30 units + (rows × 0.5) |
| Referring domains | 30 units |
| Domain competitors | 25 units |

The integration estimates cost before queries with >50 units
expected:

```
Estimated cost: ~75 API units
Current balance: 4,200 units
Continue? [Y/n]
```

This prevents accidental cost spikes from bulk queries.

## Cross-namespace integration

SEMrush is consumed by:

- **Direct user invocation** for marketing research
- **`market:social:` and `market:email:` content commands**
  — keyword research informs content topic selection
- **`market:ads:` commands** — keyword research and CPC data
  inform paid campaign budgeting
- **`product/strategy/positioning`** — competitive analysis
  informs positioning decisions
- **Content workflow planning** — keyword gaps suggest
  editorial calendar topics

## What this integration does NOT do

- **Real-time SERP rank checking.** SEMrush data has lag
  (typically 1-7 days). For real-time positions, use
  Position Tracking project (more expensive).
- **Replace the SEMrush UI.** Many advanced reports live
  only in the UI; the API surfaces a subset.
- **Provide SEMrush Trends data** without separate
  subscription. Trends, .Trends, and Market Explorer have
  separate APIs.
- **Manage SEMrush projects.** Project creation/management
  is UI-only.
- **Bulk export at SEMrush UI scale.** UI exports allow
  tens of thousands of rows; API caps lower per-query (use
  pagination).

## Examples

```bash
# Domain overview
/core:integrations:semrush "show domain overview for skoolscout.com"

# Keyword research
/core:integrations:semrush "research the keyword 'ferpa compliance software'"

# Competitive analysis
/core:integrations:semrush "compare skoolscout.com to powerschool.com"

# Long-tail keyword research
/core:integrations:semrush "find long-tail keywords for 'ferpa compliance' under KD 40"

# Backlink analysis
/core:integrations:semrush "show backlinks to skoolscout.com"

# Top organic keywords
/core:integrations:semrush "list top 100 organic keywords for skoolscout.com"

# Question-form keywords (content opportunities)
/core:integrations:semrush "find question-form keywords about FERPA compliance"

# SERP gap analysis
/core:integrations:semrush "what keywords does clever.com rank for that skoolscout.com doesn't"
```

---

# Registry definition

## Integration metadata

```yaml
name: semrush
displayName: SEMrush
provider: semrush
category: marketing-intelligence
multiInstance: false
canBeDelegated: false
readOnly: true   # API does not support write operations
```

## Interfaces

### CLI

**Not available.** SEMrush doesn't ship a canonical CLI.

### MCP

**Not available** at this time.

### REST

```yaml
baseUrl: https://api.semrush.com
authMethod: api-key-query-param
authQueryParam: key={SEMRUSH_API_KEY}
documentationUrl: https://www.semrush.com/api-documentation/
notes: |
  Two API endpoints:
    Standard API: api.semrush.com (most reports)
    Analytics API: api.semrush.com/analytics/v1 (backlinks)
  
  Both use same key. Returns CSV-style responses by default;
  can request JSON for some endpoints.
```

## Credentials

### `SEMRUSH_API_KEY`

- **Description**: SEMrush API key
- **Sensitive**: yes (keychain)
- **Where to obtain**:
  https://www.semrush.com/accounts/subscription-info/api/
  (requires SEMrush subscription with API access)
- **Rotation**: 90 days default; rotate via SEMrush UI

## API unit budget (in manifest)

```jsonc
{
  "semrush": {
    "active": true,
    "preference": "rest",
    "credentials": { "SEMRUSH_API_KEY": { "storage": "keychain" } },
    "apiUnitBudget": {
      "warnAt": 1000,
      "haltAt": 100,
      "monthlyAllocation": 100000
    },
    "defaultDatabase": "us"
  }
}
```

The budget thresholds make exhaustion warnings explicit.

## Required by skillz commands

Auto-populated.

## Compliance considerations

SEMrush usage doesn't have notable compliance constraints
for typical marketing-intelligence work — the data is about
public web presence, not personally-identifiable user data.

For Edwin's contexts:
- **SkoolScout**: SEMrush is highly relevant for content
  strategy and competitive positioning in K-12 ed-tech
- **jefelabs marketing**: relevant for any public-facing
  content
- **Financial-institution work**: SEMrush is unlikely to
  apply; consulting work is internal-facing

---
outcome: List existing journeys
description: List journeys in the project's UX manifest. Filter by type (customer-journey, user-flow, service-blueprint), by persona served, by completeness, by activity. Show summaries or full details. Useful for finding journeys to anchor story maps to, or identifying coverage gaps.
argument-hint: [--type customer-journey|user-flow|service-blueprint] [--persona <id>] [--stale] [--full]
allowed-tools: Read, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/journeys/_context.md`.

Query the journey inventory in `product/.pencil-ux.json`.
Default output is a compact summary; flags expand or filter
the output.

## Phase 0: pre-flight

1. Verify UX manifest exists:

   ```bash
   if [ ! -f product/.pencil-ux.json ]; then
     echo "No UX manifest found at product/.pencil-ux.json"
     echo "Map a journey to initialize: /product:ux:journeys:map"
     exit 0
   fi
   ```

2. Parse flags:

   ```bash
   FILTER_TYPE=""        # customer-journey | user-flow | service-blueprint
   FILTER_PERSONA=""     # persona ID
   STALE_ONLY=false      # lastReviewed > 180 days
   SHOW_FULL=false       # all fields including stage details
   
   while [[ "$#" -gt 0 ]]; do
     case "$1" in
       --type) FILTER_TYPE="$2"; shift 2 ;;
       --persona) FILTER_PERSONA="$2"; shift 2 ;;
       --stale) STALE_ONLY=true; shift ;;
       --full) SHOW_FULL=true; shift ;;
       *) shift ;;
     esac
   done
   ```

## Phase 1: query and filter

```bash
QUERY='.journeys'

if [ -n "$FILTER_TYPE" ]; then
  QUERY="$QUERY | map(select(.type == \"$FILTER_TYPE\"))"
fi

if [ -n "$FILTER_PERSONA" ]; then
  QUERY="$QUERY | map(select(.personaRefs | index(\"$FILTER_PERSONA\")))"
fi

if [ "$STALE_ONLY" = "true" ]; then
  STALE_THRESHOLD=$(date -u -d "180 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                     date -u -v-180d +%Y-%m-%dT%H:%M:%SZ)
  QUERY="$QUERY | map(select(.lastReviewed < \"$STALE_THRESHOLD\"))"
fi

JOURNEYS=$(jq -r "$QUERY" product/.pencil-ux.json)
COUNT=$(echo "$JOURNEYS" | jq 'length')
```

## Phase 2: format and display

### Compact output (default)

```
=== Journeys (3) ===

journey-admin-onboarding (user-flow)
  Name:    School Admin Onboarding
  Personas: persona-school-admin
  Stages:  4
  Pain points: 3 (1 major)
  Last reviewed: 2 weeks ago

journey-tournament-acquisition (customer-journey)
  Name:    Tournament Organizer Acquisition
  Personas: persona-tournament-organizer
  Stages:  6 (Awareness, Consideration, Evaluation, Adoption, Engagement, Advocacy)
  Pain points: 5 (2 blocker, 3 moderate)
  Last reviewed: 1 month ago

journey-compliance-audit (service-blueprint)
  Name:    Compliance Audit Response
  Personas: persona-school-admin, persona-district-it-director
  Stages:  5
  Pain points: 7 (3 major, 4 moderate)
  Last reviewed: 3 months ago
```

### With `--full`

Show every field for each journey:

```
=== Journeys (3, full) ===

journey-admin-onboarding (user-flow)
  Name:    School Admin Onboarding
  Type:    user-flow
  Created: 2026-04-15
  Reviewed: 2026-05-10
  Markdown: docs/ux/journeys/admin-onboarding.md
  
  Summary:
    First-time school admin getting set up on the platform;
    sub-30-minute target.
  
  Personas:
    - persona-school-admin
  
  Stages (4):
    1. Sign up
       Actions: Visit landing page, click sign up, enter
                school details, verify email
       Touchpoints: Landing page, signup form, welcome email
       Pain points: pain-account-verification-delay (major)
    
    2. School profile setup
       Actions: Enter school details, configure settings,
                invite team members
       Touchpoints: Web app
       Pain points: pain-team-invite-friction (moderate)
    
    3. First useful action
       Actions: Run first compliance check
       Touchpoints: Web app
       Pain points: pain-first-action-discovery (moderate)
    
    4. Settings configured
       Actions: Configure notification preferences,
                integration settings
       Touchpoints: Web app, third-party integrations
  
  Cross-references:
    Used in 1 story map (map-admin-onboarding-v1)
    Stories addressing this journey: 8 stories

[continues for each journey]
```

### With `--stale`

Show only journeys with lastReviewed > 180 days:

```
=== Stale Journeys (1) ===

These journeys haven't been reviewed in over 180 days.
Consider revisiting to confirm they still match current
product reality.

journey-compliance-audit (service-blueprint)
  Last reviewed: 7 months ago
  Update: /product:ux:journeys:map journey-compliance-audit --update
```

### Filtered by persona

```
=== Journeys for persona-school-admin (3) ===

journey-admin-onboarding (user-flow)
  Stages: 4 · 3 pain points

journey-compliance-audit (service-blueprint)
  Stages: 5 · 7 pain points

journey-monthly-review (user-flow)
  Stages: 6 · 2 pain points
```

## Phase 3: coverage analysis

When run without filters, surface coverage gaps at the bottom:

```
=== Coverage Analysis ===

Personas without journeys:
  - persona-superintendent (defined but not in any journey)

Journeys without personas: 0

Pain points concentrated in:
  - journey-compliance-audit (7 pain points; consider
    splitting or addressing systematically)

Type distribution:
  customer-journey: 1
  user-flow: 5
  service-blueprint: 1

Personas with most journey coverage:
  persona-school-admin: 3 journeys
  persona-district-it-director: 2 journeys
  persona-tournament-organizer: 1 journey
```

This surface-coverage view helps identify:
- Personas that need journeys mapped
- Concentrations of pain that suggest systematic issues
- Imbalanced type distribution (all user flows, no customer
  journey — might indicate missing strategic view)

## Empty state

When no journeys exist:

```
=== Journeys (0) ===

No journeys mapped yet.

To map a journey:
  /product:ux:journeys:map <name>

Example:
  /product:ux:journeys:map "User Onboarding" --type user-flow
```

## Cross-namespace usage

The `journeys:list` command output is referenced when:

- **Building story maps** — story maps anchor to journeys
- **Capability introduction** — capabilities affect specific
  journey stages
- **Marketing campaigns** — campaigns target customer
  journey stages
- **Audit triage** — surfacing stale journeys, coverage
  gaps, pain-point concentrations

The command is read-only.

## What this command does NOT do

- **Modify journeys.** That's `map`.
- **Validate journey quality.** Surfaces what exists.
- **Detect overlapping journeys.** Two journeys may cover
  similar territory; review is manual.
- **Visualize journey diagrams.** Output is text. Future
  commands could generate diagrams (Mermaid, etc.).

## Examples

```bash
# Quick inventory
/product:ux:journeys:list

# Customer journeys only
/product:ux:journeys:list --type customer-journey

# Journeys for a specific persona
/product:ux:journeys:list --persona persona-school-admin

# Full details
/product:ux:journeys:list --full

# Stale journeys
/product:ux:journeys:list --stale

# User flows for school admin
/product:ux:journeys:list --type user-flow --persona persona-school-admin
```

---
outcome: Surface journey pain points
description: Query the pain point registry. Aggregate by severity, journey, persona, status. Surface unaddressed pain needing attention. Identify candidates for capability-introduction or story prioritization. Pain points are first-class entries with cross-references; this command queries them across the project.
argument-hint: [--severity blocker|major|moderate|minor] [--persona <id>] [--journey <id>] [--unaddressed] [--by-persona] [--by-journey]
allowed-tools: Read, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/journeys/_context.md`.

Query the pain-point registry in `product/.pencil-ux.json`.
Pain points are first-class entries (not strings inside
journeys), enabling cross-referencing, prioritization, and
resolution tracking.

## Phase 0: pre-flight

1. Verify UX manifest exists.

2. Parse flags:

   ```bash
   FILTER_SEVERITY=""    # blocker | major | moderate | minor
   FILTER_PERSONA=""
   FILTER_JOURNEY=""
   UNADDRESSED_ONLY=false
   GROUP_BY_PERSONA=false
   GROUP_BY_JOURNEY=false
   
   while [[ "$#" -gt 0 ]]; do
     case "$1" in
       --severity) FILTER_SEVERITY="$2"; shift 2 ;;
       --persona) FILTER_PERSONA="$2"; shift 2 ;;
       --journey) FILTER_JOURNEY="$2"; shift 2 ;;
       --unaddressed) UNADDRESSED_ONLY=true; shift ;;
       --by-persona) GROUP_BY_PERSONA=true; shift ;;
       --by-journey) GROUP_BY_JOURNEY=true; shift ;;
       *) shift ;;
     esac
   done
   ```

## Phase 1: query and filter

```bash
QUERY='.painPoints'

if [ -n "$FILTER_SEVERITY" ]; then
  QUERY="$QUERY | map(select(.severity == \"$FILTER_SEVERITY\"))"
fi

if [ -n "$FILTER_PERSONA" ]; then
  QUERY="$QUERY | map(select(.personaRefs | index(\"$FILTER_PERSONA\")))"
fi

if [ -n "$FILTER_JOURNEY" ]; then
  QUERY="$QUERY | map(select(.journeyRefs | index(\"$FILTER_JOURNEY\")))"
fi

if [ "$UNADDRESSED_ONLY" = "true" ]; then
  QUERY="$QUERY | map(select(.status == \"unaddressed\" or .status == null))"
fi

PAIN_POINTS=$(jq -r "$QUERY" product/.pencil-ux.json)
COUNT=$(echo "$PAIN_POINTS" | jq 'length')
```

## Phase 2: format output

### Default — flat list with severity ordering

```
=== Pain Points (12) ===

Sorted by severity (blocker → minor) then by frequency.

BLOCKER (2):
  pain-cant-export-compliance-report
    "School admins cannot export compliance reports for
     district auditors; must use screenshots."
    Severity: blocker · Frequency: always
    Personas: persona-school-admin
    Journeys: journey-compliance-audit
    Status: unaddressed
    
    Address: /product:ux:stories:write
             /core:workflows:manage start engineer:capability-introduction

  pain-data-loss-on-session-expire
    "Form data is lost when session expires during long
     compliance entries."
    Severity: blocker · Frequency: frequently
    Personas: persona-school-admin, persona-district-it-director
    Journeys: journey-compliance-audit, journey-admin-onboarding
    Status: in-progress
    Addressed by: 
      - story-persist-form-state (in-progress)
      - SCOOL-1247 (Jira ticket)

MAJOR (4):
  pain-vendor-evaluation-takes-weeks
    "Vendor evaluation takes 2-4 weeks; risk of bad pick
     is high."
    Severity: major · Frequency: always
    ...

MODERATE (5):
  ...

MINOR (1):
  ...
```

### With `--by-persona`

Group pain points by which persona experiences them:

```
=== Pain Points by Persona ===

persona-school-admin (8 pain points)
  Blocker (2):
    - pain-cant-export-compliance-report
    - pain-data-loss-on-session-expire
  Major (3):
    - pain-vendor-evaluation-takes-weeks
    - pain-audit-prep-takes-40-hours
    - pain-no-cross-school-comparison
  Moderate (3):
    - ...

persona-district-it-director (5 pain points)
  Blocker (1):
    - pain-data-loss-on-session-expire (shared with school-admin)
  Major (2):
    - ...

persona-tournament-organizer (3 pain points)
  ...
```

### With `--by-journey`

Group pain points by journey:

```
=== Pain Points by Journey ===

journey-compliance-audit (7 pain points)
  Blocker: 2
  Major:   3
  Moderate: 2
  Minor:   0
  
  This journey has the highest pain concentration.
  Consider whether the journey itself needs redesign.

journey-admin-onboarding (3 pain points)
  Major: 1, Moderate: 2

journey-tournament-registration (2 pain points)
  Major: 1, Moderate: 1
```

### With `--unaddressed`

Show only pain points without active resolution work:

```
=== Unaddressed Pain Points (8) ===

These pain points have status "unaddressed" — no story,
capability, ADR, or ticket actively resolving them.

BLOCKER (1):
  pain-cant-export-compliance-report
    "School admins cannot export compliance reports..."
    Personas: persona-school-admin
    
    Recommendation: Address blocker pain points within the
    next sprint. Options:
      - Write a story: /product:ux:stories:write
      - Plan a capability: /core:workflows:manage start
                            engineer:capability-introduction

MAJOR (3):
  ...

MODERATE (3):
  ...

MINOR (1):
  ...
```

## Phase 3: aggregate analysis

When no filter is applied, surface aggregate insights at the
bottom:

```
=== Aggregate Analysis ===

Total pain points: 12
By status:
  unaddressed: 8 (67%)
  in-progress: 3 (25%)
  resolved: 1 (8%)
  wontfix: 0

By severity:
  blocker: 2 (17%)
  major: 4 (33%)
  moderate: 5 (42%)
  minor: 1 (8%)

Cross-journey pain points (appear in 2+ journeys): 3
  - pain-data-loss-on-session-expire (2 journeys)
  - pain-slow-page-load (3 journeys)
  - pain-confusing-navigation (2 journeys)
  
  These are systematic issues. Resolution may benefit
  multiple journeys.

Resolution velocity:
  Resolved this quarter: 1
  Resolved last quarter: 3
  
  (Velocity decreasing — consider reviewing the resolution
   pipeline.)
```

## Phase 4: surface recommendations

When unaddressed blocker or major pain points exist:

```
=== Recommendations ===

You have 2 unaddressed blocker pain points and 3 unaddressed
major pain points. Suggested next actions:

1. For pain-cant-export-compliance-report (blocker):
   This is a single-feature issue. Address with a story:
   /product:ux:stories:write "Export compliance report PDF"

2. For pain-vendor-evaluation-takes-weeks (major):
   This is broader than a single story. Consider
   capability-introduction:
   /core:workflows:manage start engineer:capability-introduction
     "Vendor evaluation accelerator"

3. Cross-journey pain pain-data-loss-on-session-expire:
   Affects 2 journeys; systemic. Worth an ADR for the
   approach. Already in-progress; track via SCOOL-1247.

4. Pain concentration in journey-compliance-audit:
   7 pain points in one journey suggests journey-level
   rethink. Consider:
   /product:ux:journeys:map journey-compliance-audit --update
```

## Empty state

When no pain points exist:

```
=== Pain Points (0) ===

No pain points registered yet.

Pain points are typically captured during journey mapping:
  /product:ux:journeys:map <name>

The journey mapping command prompts for pain points at each
stage and registers them in this registry automatically.
```

## Cross-namespace usage

This command's output drives:

- **Story prioritization** — stories addressing high-severity
  pain are higher-priority
- **Capability planning** — capability-introduction often
  starts from "address these pain points"
- **Marketing positioning** — pain-driven messaging targets
  real frustrations
- **Engineering roadmap discussions** — pain points provide
  user-facing justification for technical work

The command is read-only.

## Pain point status lifecycle

Pain points have status field values:

- **unaddressed**: no active work; default for newly-
  captured pain
- **in-progress**: at least one addressing reference
  (story, capability, ticket) is active
- **resolved**: addressed; verified that pain no longer
  appears
- **wontfix**: deliberately not addressing (e.g., pain
  affects out-of-scope persona, or addressing would
  introduce worse trade-offs)

Status changes happen via:
- `/product:ux:journeys:map --update` (during journey re-review)
- Future: dedicated pain-point status update command
- Manual manifest editing (acceptable but loses history)

## What this command does NOT do

- **Modify pain points.** That's `journeys:map` (creating)
  or future status-update commands.
- **Auto-resolve pain.** Status changes are deliberate
  human decisions.
- **Predict resolution time.** Surfaces what's there;
  estimation is human judgment.
- **Generate Jira tickets.** Cross-namespace integration
  with `/core:integrations:jira` (when using together) handles
  ticket creation; this command surfaces the pain.

## Examples

```bash
# All pain points
/product:ux:journeys:pain-points

# Blockers only
/product:ux:journeys:pain-points --severity blocker

# Pain for a specific persona
/product:ux:journeys:pain-points --persona persona-school-admin

# Pain in a specific journey
/product:ux:journeys:pain-points --journey journey-compliance-audit

# Unaddressed pain (backlog candidates)
/product:ux:journeys:pain-points --unaddressed

# Grouped by journey (find concentration)
/product:ux:journeys:pain-points --by-journey

# Grouped by persona (find who's most affected)
/product:ux:journeys:pain-points --by-persona
```

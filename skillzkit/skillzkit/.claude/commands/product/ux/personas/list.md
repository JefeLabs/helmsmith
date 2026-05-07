---
outcome: List existing personas
description: List personas in the project's UX manifest. Filter by type (traditional/jtbd/hybrid), by tags, by activity (recently created, stale, etc.). Show summaries or full details. Useful for quick reference, audit, and finding the right persona to anchor stories or journeys to.
argument-hint: [--type traditional|jtbd|hybrid] [--show-jtbd] [--stale] [--full]
allowed-tools: Read, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/personas/_context.md`.

Query the persona inventory in `product/.pencil-ux.json`. The
default output is a compact summary suitable for quick
reference. Flags expand the output with JTBD details, full
fields, or filter to specific subsets.

## Phase 0: pre-flight

1. Verify UX manifest exists:

   ```bash
   if [ ! -f product/.pencil-ux.json ]; then
     echo "No UX manifest found at product/.pencil-ux.json"
     echo "Define a persona to initialize: /product:ux:personas:define"
     exit 0
   fi
   ```

2. Parse flags:

   ```bash
   FILTER_TYPE=""        # traditional | jtbd | hybrid (or empty for all)
   SHOW_JTBD=false       # include JTBD statements in output
   SHOW_FULL=false       # include all fields (goals, frustrations, etc.)
   STALE_ONLY=false      # only personas with lastReviewed > 180 days
   
   while [[ "$#" -gt 0 ]]; do
     case "$1" in
       --type) FILTER_TYPE="$2"; shift 2 ;;
       --show-jtbd) SHOW_JTBD=true; shift ;;
       --full) SHOW_FULL=true; shift ;;
       --stale) STALE_ONLY=true; shift ;;
       *) shift ;;
     esac
   done
   ```

## Phase 1: query the manifest

```bash
# Build jq filter based on flags
QUERY='.personas'

if [ -n "$FILTER_TYPE" ]; then
  QUERY="$QUERY | map(select(.type == \"$FILTER_TYPE\"))"
fi

if [ "$STALE_ONLY" = "true" ]; then
  STALE_THRESHOLD=$(date -u -d "180 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                     date -u -v-180d +%Y-%m-%dT%H:%M:%SZ)
  QUERY="$QUERY | map(select(.lastReviewed < \"$STALE_THRESHOLD\"))"
fi

PERSONAS=$(jq -r "$QUERY" product/.pencil-ux.json)
COUNT=$(echo "$PERSONAS" | jq 'length')
```

## Phase 2: format and display

### Compact output (default)

```
=== Personas (3) ===

persona-school-admin (hybrid)
  Name: School Admin
  Role: Principal or Assistant Principal at single-school site
        or small multi-site district
  3 goals · 4 frustrations · 3 JTBDs
  Last reviewed: 2 weeks ago
  
persona-district-it-director (traditional)
  Name: District IT Director
  Role: IT Director at small-to-mid district (5-15 schools)
  4 goals · 5 frustrations
  Last reviewed: 3 months ago
  Research: 8 interviews + analytics summary
  
persona-tournament-organizer (jtbd)
  Name: Tournament Organizer
  5 JTBDs (2 primary, 2 secondary, 1 tertiary)
  Last reviewed: 1 week ago
  Research: hypothesis-based
```

### With `--show-jtbd`

```
=== Personas with JTBDs (3) ===

persona-school-admin (hybrid)
  Name: School Admin
  
  Primary JTBDs:
    "When evaluating a new ed-tech vendor, I want to verify
     FERPA/COPPA compliance and data handling, so I can
     avoid liability and protect student data."
  
  Secondary JTBDs:
    "When preparing for an annual audit, I want to gather all
     compliance documentation in one place, so I can complete
     audit prep in 4 hours instead of 40."
    
    "When reviewing student outcomes after a quarter, I want
     to see what's working across teachers and grades, so I
     can replicate effective practices across the school."

[continues for each persona]
```

### With `--full`

Show every field for each persona:

```
=== Personas (3, full) ===

persona-school-admin (hybrid)
  Name:    School Admin
  Type:    hybrid
  Created: 2026-04-15
  Reviewed: 2026-05-10
  Markdown: docs/ux/personas/school-admin.md
  
  Summary:
    Mid-career school administrator juggling compliance and
    budget concerns; primary platform user.
  
  Role: Principal or Assistant Principal at single-school
        site or small multi-site district.
  
  Context: Part of 3-5 person admin team. Reports to district
           superintendent. Manages 5-50 staff and 200-2000
           students.
  
  Goals (4):
    1. Stay compliant with FERPA, COPPA, state student-data
       laws
    2. Maximize student outcomes within tight budgets
    3. Reduce time spent on compliance documentation
    4. Build trust with families and community
  
  Frustrations (4):
    1. Vendor evaluation takes weeks; risk of bad pick high
    2. Data silos across district systems prevent insights
    3. Audit prep takes 40+ hours of manual work each year
    4. Time pressure leads to hasty decisions
  
  Tech profile:
    Comfortable with web apps. Less comfortable with deep
    configuration. Mobile-first in classrooms, laptop for
    analysis.
  
  JTBDs (3):
    [shown as in --show-jtbd output]
  
  Research:
    - Interview: 10 interviews with school admins across
      3 states (2026-04-15)
    - Support tickets: 6 months of theme analysis (2026-04-20)
  
  Cross-references:
    Used in 4 journeys, 12 stories, 3 pain points
    
[continues for each persona]
```

### With `--stale`

Show only personas with lastReviewed > 180 days. Useful for
identifying personas that need re-validation:

```
=== Stale Personas (2) ===

These personas haven't been reviewed in over 180 days. Consider
revisiting to confirm they still match user understanding.

persona-district-it-director (traditional)
  Name: District IT Director
  Last reviewed: 7 months ago
  Research: 8 interviews (1 year old)
  
  Update: /product:ux:personas:define persona-district-it-director --update

persona-superintendent (jtbd)
  Name: Superintendent
  Last reviewed: 9 months ago
  Research: hypothesis-based (no formal validation yet)
  
  Update: /product:ux:personas:define-jtbd persona-superintendent --update
```

## Phase 3: cross-reference summary

When showing personas, include cross-reference counts to
indicate how connected each persona is to other artifacts:

```bash
# For each persona, count references in journeys, stories, pain points
for PERSONA_ID in $(echo "$PERSONAS" | jq -r '.[].id'); do
  JOURNEY_REFS=$(jq -r ".journeys[] | select(.personaRefs | index(\"$PERSONA_ID\")) | .id" \
                       product/.pencil-ux.json | wc -l)
  STORY_REFS=$(jq -r ".stories[] | select(.personaRefs | index(\"$PERSONA_ID\")) | .id" \
                     product/.pencil-ux.json | wc -l)
  PAIN_REFS=$(jq -r ".painPoints[] | select(.personaRefs | index(\"$PERSONA_ID\")) | .id" \
                    product/.pencil-ux.json | wc -l)
done
```

A persona with 0 cross-references is a candidate for cleanup
or for "use it now or remove it" review. Personas should earn
their keep through use.

## Empty state

When no personas exist:

```
=== Personas (0) ===

No personas defined yet.

To define a traditional persona:
  /product:ux:personas:define <name>

To define via JTBD framing:
  /product:ux:personas:define-jtbd <name>
```

## Cross-namespace usage

The `personas:list` command output is referenced when:

- **Defining new journeys** — identifying which personas the
  journey serves
- **Writing stories** — finding the persona to anchor
- **Capability introduction** — identifying serves-personas
  references
- **Marketing campaigns** — choosing target persona
- **Audit triage** — surfacing stale or unreferenced personas

The command is read-only; no manifest changes.

## What this command does NOT do

- **Modify personas.** That's `define` and `define-jtbd`.
- **Validate persona quality.** Surfaces what exists; doesn't
  judge whether a persona is well-defined.
- **Find similar/duplicate personas.** Manual review needed
  for that. The command shows what's there.
- **Export to other formats.** Output is text. Future
  commands could add JSON/CSV export.

## Examples

```bash
# Quick inventory
/product:ux:personas:list

# Full details
/product:ux:personas:list --full

# Only JTBD-flavored personas
/product:ux:personas:list --type jtbd

# With JTBD statements expanded
/product:ux:personas:list --show-jtbd

# Stale personas needing review
/product:ux:personas:list --stale

# Hybrid personas only
/product:ux:personas:list --type hybrid
```

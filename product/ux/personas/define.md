---
description: Define a traditional persona — role, demographics (optional), goals, frustrations, context, tech profile. Writes both a manifest entry in product/.pencil-ux.json and a markdown content file at docs/ux/personas/. Supports creating new personas and updating existing ones.
argument-hint: <persona-name> [--update] [--from-research <source>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/personas/_context.md`, `product/_context.md`.

Define a traditional persona using role, goals, frustrations,
context, and tech profile fields. The traditional format is
best for stable mental-model artifacts referenced across many
stories, journeys, and decisions.

For Jobs-to-be-Done framing, use
`/product:ux:personas:define-jtbd`. Both can target the same
persona — a hybrid persona has both traditional fields and
JTBD statements.

## Phase 0: pre-flight

1. Verify UX manifest exists or initialize:

   ```bash
   if [ ! -f product/.pencil-ux.json ]; then
     echo "UX manifest not yet initialized. Creating..."
     cat > product/.pencil-ux.json <<'EOF'
   {
     "version": 1,
     "lastUpdated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
     "personas": [],
     "journeys": [],
     "painPoints": [],
     "stories": [],
     "storyMaps": []
   }
   EOF
   fi
   ```

2. Resolve persona ID. From the provided name, generate a
   stable slug:

   ```bash
   PERSONA_NAME="$1"
   PERSONA_SLUG=$(echo "$PERSONA_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
   PERSONA_ID="persona-${PERSONA_SLUG}"
   ```

3. Check if persona already exists:

   ```bash
   EXISTS=$(jq -r ".personas[] | select(.id == \"$PERSONA_ID\") | .id" \
                  product/.pencil-ux.json 2>/dev/null)
   
   if [ -n "$EXISTS" ] && [ "$UPDATE_MODE" != "true" ]; then
     echo "Persona '$PERSONA_ID' already exists."
     echo ""
     echo "Options:"
     echo "  [u] Update the existing persona"
     echo "  [d] Define as a different persona (use a more specific name)"
     echo "  [a] Abort"
     read -p "Choice: " CHOICE
     # ... handle choice
   fi
   ```

## Phase 1: information gathering

Walk the user through the persona's core fields. For each, the
command provides examples and prompts for the user's input.

### Step 1: Role

```
=== Persona: <name> ===

Step 1 of 6: Role

What's this persona's role or job title?

Examples:
  - "School District IT Director"
  - "Principal at a single-school site"
  - "Senior DevOps Engineer at a financial institution"
  - "Tournament Organizer (volunteer or staff)"

Specificity helps. "Manager" is too broad; "Engineering
Manager at 50-200 person company" is specific enough to be
actionable.

Role:
> 
```

### Step 2: Context

```
Step 2 of 6: Context

Describe the situational context this persona operates in —
team size, time pressures, organizational dynamics, anything
that shapes their day-to-day reality.

Examples:
  - "Part of a 3-5 person admin team. Reports to district
     superintendent. Manages 200-2000 students."
  - "Solo IT person at a 5-school district. Stretched thin;
     reactive most of the time."
  - "Engineering Manager with 5-8 reports. Half their week
     is meetings; remaining time fragmented."

Context:
> 
```

### Step 3: Goals

```
Step 3 of 6: Goals

What's this persona trying to achieve in their context?
3-5 primary goals. Frame as outcomes, not features.

Examples (good):
  - "Stay compliant with FERPA, COPPA, state student-data
     laws"
  - "Maximize student outcomes within tight budgets"
  - "Reduce time spent on compliance documentation"

Examples (less useful — too feature-focused):
  - "Use the SkoolScout dashboard daily"
  - "Generate compliance reports"

Goals (one per line, 3-5 total):
> 
```

### Step 4: Frustrations

```
Step 4 of 6: Frustrations

What pain points and friction does this persona experience in
their current state? 3-5 primary frustrations.

Frame around real friction, not feature wishes. "Wants better
search" is a feature wish; "spends 20 minutes finding
candidates that meet certification requirements" is a
frustration.

Examples:
  - "Vendor evaluation takes weeks; risk of bad pick is high"
  - "Data silos across district systems prevent insights"
  - "Audit prep takes 40+ hours of manual work each year"

Frustrations (one per line, 3-5 total):
> 
```

### Step 5: Tech profile

```
Step 5 of 6: Tech profile

Describe their technical sophistication and tooling
preferences. Skip if not relevant to product decisions.

Examples:
  - "Comfortable with web apps. Less comfortable with
     deep configuration. Mobile-first in classrooms,
     laptop for analysis."
  - "Heavy CLI user. Comfortable with Git, Docker,
     cloud consoles. Prefers terminal over GUI."
  - "Spreadsheet power user. Light coder. Strong with
     SQL but not other languages."

Tech profile (optional; press enter to skip):
> 
```

### Step 6: Demographics (optional)

```
Step 6 of 6: Demographics (optional)

Modern persona practice often skips demographics unless they
materially affect the persona's needs. Common reason to
include: persona spans a regulated industry where age, role
seniority, or geographic location affects compliance needs.

If skipping, press enter.

Age range:
> 
Geographic context:
> 
Other demographics:
> 
```

## Phase 2: research source attribution

```
=== Research Sources ===

Is this persona grounded in research, or hypothesis-based?

Hypothesis-only personas are normal for greenfield work; they
become evidence-based as research accumulates.

Sources informing this persona (zero or more):
  [i] Interview: "X interviews with [users]" date
  [s] Survey: "summary" date
  [a] Analytics: "behavioral data summary" date
  [t] Support tickets: "ticket theme analysis" date
  [c] Competitor research: "summary" date
  [k] Stakeholder input: "from [stakeholder]" date
  [h] Hypothesis (no formal research yet)
  [done]

Type to add (e.g., "i" then prompts for details), or "done":
> 
```

If user says "h" (hypothesis), record:

```jsonc
"researchSources": [
  {
    "type": "hypothesis",
    "summary": "Initial hypothesis based on team domain knowledge; no formal research yet.",
    "date": "<today>"
  }
]
```

## Phase 3: summary review

Show the assembled persona for confirmation:

```
=== Persona Summary ===

ID:    persona-school-admin
Name:  School Admin
Type:  traditional

Role: Principal or Assistant Principal at a single-school
site or small multi-site district.

Context: Part of a 3-5 person admin team. Reports to district
superintendent. Manages 5-50 staff and 200-2000 students.

Goals:
  1. Stay compliant with FERPA, COPPA, state student-data laws
  2. Maximize student outcomes within tight budgets
  3. Reduce time spent on compliance documentation
  4. Build trust with families and community

Frustrations:
  1. Vendor evaluation takes weeks; risk of bad pick is high
  2. Data silos across district systems prevent insights
  3. Audit prep takes 40+ hours of manual work each year
  4. Time pressure leads to hasty decisions

Tech profile: Comfortable with web apps. Less comfortable with
deep configuration. Mobile-first in classrooms, laptop for
analysis.

Research: hypothesis-based (no formal research yet)

Save this persona? [Y/edit/abort]
```

## Phase 4: write artifacts

When confirmed, write to both layers:

### Manifest entry

```bash
# Append to personas array
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

PERSONA_ENTRY=$(jq -n \
  --arg id "$PERSONA_ID" \
  --arg name "$PERSONA_NAME" \
  --arg filePath "docs/ux/personas/${PERSONA_SLUG}.md" \
  --arg summary "$SUMMARY" \
  --arg role "$ROLE" \
  --arg context "$CONTEXT" \
  --arg techProfile "$TECH_PROFILE" \
  --argjson goals "$GOALS_JSON" \
  --argjson frustrations "$FRUSTRATIONS_JSON" \
  --argjson researchSources "$RESEARCH_JSON" \
  --arg now "$NOW" \
  '{
    id: $id,
    name: $name,
    type: "traditional",
    filePath: $filePath,
    summary: $summary,
    traditional: {
      role: $role,
      goals: $goals,
      frustrations: $frustrations,
      context: $context,
      techProfile: $techProfile
    },
    researchSources: $researchSources,
    created: $now,
    lastReviewed: $now
  }')

jq ".personas += [$PERSONA_ENTRY] | .lastUpdated = \"$NOW\"" \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json
```

### Markdown content file

```bash
mkdir -p docs/ux/personas
cat > "docs/ux/personas/${PERSONA_SLUG}.md" <<EOF
# $PERSONA_NAME

## Summary
$SUMMARY

## Role
$ROLE

## Context
$CONTEXT

## Goals
$(printf -- "- %s\n" "${GOALS[@]}")

## Frustrations
$(printf -- "- %s\n" "${FRUSTRATIONS[@]}")

## Tech profile
$TECH_PROFILE

## Research backing
$([ "$RESEARCH_TYPE" = "hypothesis" ] && echo "Hypothesis-based — no formal research yet." || echo "$RESEARCH_SUMMARY")

## Notes
(Add ongoing observations, contradictions from research, or
nuances as the persona evolves.)
EOF
```

## Phase 5: result

```
=== Persona Defined ===

ID:           persona-school-admin
Name:         School Admin
Type:         traditional
Manifest:     product/.pencil-ux.json (1 of 1 personas)
Content:      docs/ux/personas/school-admin.md

Next steps:
  - Add JTBD statements: /product:ux:personas:define-jtbd school-admin
  - Map a journey for this persona: /product:ux:journeys:map
  - Write user stories: /product:ux:stories:write
  - List all personas: /product:ux:personas:list
```

## Update mode

When `--update` flag is set OR persona already exists and user
chooses to update:

1. Read existing persona from manifest
2. Walk through the same fields with current values
   pre-populated
3. User edits any fields they want to change
4. Update manifest entry (preserves `created`, updates
   `lastReviewed`)
5. Update markdown content file (preserves any `## Notes`
   section the user has added)

The lastReviewed timestamp is significant — it's used by the
audit plane (when added) to identify stale personas.

## What this command does NOT do

- **Conduct research.** Personas grounded in research require
  the research first; this command captures the synthesized
  persona, not the raw research data.
- **Replace ongoing observation.** The `## Notes` section in
  the markdown is for ongoing observations; the command
  preserves it across updates.
- **Validate against actual users.** Hypothesis-based personas
  are fine but should be flagged for validation when research
  becomes possible.
- **Manage persona segments or sub-personas.** A persona is
  a single archetype. If the team needs multiple variations
  (e.g., Admin-at-elementary vs Admin-at-high-school), define
  them as separate personas.

## Examples

```bash
# Define a new persona
/product:ux:personas:define "School Admin"

# Update an existing persona (after research)
/product:ux:personas:define "School Admin" --update

# Define grounded in research
/product:ux:personas:define "District IT Director" \
  --from-research interview-summary-2026-04
```

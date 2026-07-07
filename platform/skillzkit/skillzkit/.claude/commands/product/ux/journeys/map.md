---
outcome: Map a customer journey
description: Map a journey. Type-aware — handles customer-journey (high-level marketing arc), user-flow (task-level sequence), and service-blueprint (front-stage + back-stage). Walks through stages, touchpoints, emotions, and pain points. Pain points are registered in the painPoints array for cross-referencing across journeys.
argument-hint: <journey-name> [--type customer-journey|user-flow|service-blueprint] [--persona <id>]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/journeys/_context.md`, `product/_context.md`.

Create or update a journey map. The command is type-aware —
choose customer-journey, user-flow, or service-blueprint and
the command walks through the appropriate fields for that
type.

## Phase 0: pre-flight

1. Verify UX manifest exists; initialize if not (same pattern
   as personas).

2. Resolve journey ID from name:

   ```bash
   JOURNEY_NAME="$1"
   JOURNEY_SLUG=$(echo "$JOURNEY_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
   JOURNEY_ID="journey-${JOURNEY_SLUG}"
   ```

3. Check for existing journey:

   ```bash
   EXISTS=$(jq -r ".journeys[] | select(.id == \"$JOURNEY_ID\") | .id" \
                  product/.pencil-ux.json 2>/dev/null)
   
   if [ -n "$EXISTS" ]; then
     echo "Journey '$JOURNEY_ID' already exists."
     echo ""
     echo "Options:"
     echo "  [u] Update (walk through fields with current values)"
     echo "  [v] View existing"
     echo "  [a] Abort"
     # ...
   fi
   ```

## Phase 1: type selection

If `--type` not specified, prompt:

```
=== Journey: <name> ===

What type of journey is this?

  [c] customer-journey
       High-level arc: awareness → consideration → evaluation
       → adoption → engagement → expansion → advocacy.
       Marketing-flavored. Best for cross-functional alignment
       and identifying experience breakdowns.
  
  [u] user-flow
       Task-level step sequence with touchpoints, emotions,
       pain points. Engineering-flavored. Best for shaping
       specific features and identifying implementation
       requirements.
  
  [s] service-blueprint
       Front-stage (user-facing) + back-stage (system /
       team / operations) parallel rows. Best for service
       design, cross-functional planning, and identifying
       handoff gaps.

Type:
> 
```

## Phase 2: persona attribution

```
=== Personas ===

Which persona(s) does this journey serve?

Existing personas:
  [1] persona-school-admin (School Admin, hybrid)
  [2] persona-district-it-director (District IT Director, traditional)
  [3] persona-tournament-organizer (Tournament Organizer, jtbd)

Select by number (comma-separated for multi-persona, e.g., "1,3"):
> 

Or type a new persona name to create one:
> 
```

If user enters numbers, resolve to persona IDs. If user enters
a name, prompt:

```
'<name>' isn't an existing persona. Create as a stub and
continue? [Y/n]
(Stub will create a persona with type 'jtbd' and no JTBD
 statements yet; you can flesh it out later with
 /product:ux:personas:define-jtbd)
```

## Phase 3: type-specific stage walkthrough

Each journey type has different stage prompts.

### Customer journey

```
=== Customer Journey: <name> ===

Customer journeys typically have these stages. You can use
some or all, and add others as needed:

  1. Awareness
  2. Consideration
  3. Evaluation
  4. Adoption
  5. Engagement
  6. Expansion
  7. Advocacy

Use these defaults? [Y/customize]
```

For each stage:

```
=== Stage: Awareness ===

User actions in this stage:
  (What does the user do? Comma-separated or one per line)
> 

Touchpoints:
  (Where do they encounter your product/brand? — search,
   social, blog, conference, ads, word-of-mouth, etc.)
> 

Emotions:
  (What's the user feeling at this stage?)
> 

Pain points (zero or more):
  Describe each pain point. The command will register each
  in the pain-point registry with auto-generated IDs.
  
  Pain 1 description (or "done"):
> 
  Severity? [b]locker / [m]ajor / m[o]derate / m[i]nor:
> 
  Frequency? [a]lways / [f]requently / [s]ometimes / [r]are:
> 

  Pain 2 description (or "done"):
> ...
```

### User flow

```
=== User Flow: <name> ===

User flows are step-sequenced. Steps span seconds to minutes
typically.

Step 1 of N: 
  Step name (e.g., "Sign up", "Fill in school details"):
> 
  
  User actions:
> 
  
  System response (what does the system show or do):
> 
  
  Touchpoints:
> 
  
  Pain points (zero or more, same as customer-journey):
> 

Add another step? [Y/n]
> 
```

User flows don't typically have an "emotions" field per step
(emotions are micro-shifts at this zoom level, less useful).
Stage emotions are optional in the schema.

### Service blueprint

```
=== Service Blueprint: <name> ===

Service blueprints have front-stage (user-facing) and
back-stage (operational/system) for each stage.

Stage 1 of N:
  Stage name:
> 
  
  Front-stage:
    User actions:
> 
    Touchpoints:
> 
    Emotions:
> 
  
  Back-stage:
    System / team activities (one per line):
> 
    e.g., "Eligibility check runs against district roster
           database"
          "Compliance team manually reviews enrollment paperwork"
          "Email confirmation queued for delivery"
  
  Pain points (zero or more, can be front-stage OR back-stage):
> 

Add another stage? [Y/n]
> 
```

## Phase 4: pain point registration

For each pain point captured during stage walkthrough,
register in the painPoints array:

```bash
for PAIN_DESC in "${PAIN_POINTS[@]}"; do
  PAIN_SLUG=$(echo "$PAIN_DESC" | head -c 50 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
  PAIN_ID="pain-${PAIN_SLUG}"
  
  # Check for existing pain with same ID; if exists, prompt to use existing or create new
  EXISTING_PAIN=$(jq -r ".painPoints[] | select(.id == \"$PAIN_ID\") | .id" \
                        product/.pencil-ux.json)
  
  if [ -n "$EXISTING_PAIN" ]; then
    echo "Similar pain point already registered: $PAIN_ID"
    echo "Use existing reference, or register as new with disambiguated ID? [u/n]"
    # ...
  fi
done
```

The journey's `painPointRefs` array stores the IDs; the pain
points themselves get full entries in the registry with
severity, frequency, journey backreferences, and persona
references.

## Phase 5: review

```
=== Journey Review ===

ID:        journey-admin-onboarding
Name:      School Admin Onboarding
Type:      user-flow
Personas:  persona-school-admin

Stages (4):

1. Sign up
   Actions: Visit landing page, click sign up, enter details
   Touchpoints: Web app, welcome email
   Pain points: 
     - pain-account-verification-delay (major, frequently)

2. School profile setup
   ...

3. First useful action
   ...

4. Settings configured
   ...

Pain points registered: 3 (1 major, 2 moderate)

Save this journey? [Y/edit/abort]
```

## Phase 6: write artifacts

### Manifest entry

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Append journey
jq --arg id "$JOURNEY_ID" \
   --arg name "$JOURNEY_NAME" \
   --arg type "$JOURNEY_TYPE" \
   --arg filePath "docs/ux/journeys/${JOURNEY_SLUG}.md" \
   --arg summary "$SUMMARY" \
   --argjson personaRefs "$PERSONA_REFS_JSON" \
   --argjson stages "$STAGES_JSON" \
   --arg now "$NOW" \
  '.journeys += [{
    id: $id,
    name: $name,
    type: $type,
    filePath: $filePath,
    summary: $summary,
    personaRefs: $personaRefs,
    stages: $stages,
    created: $now,
    lastReviewed: $now
  }]
  | .painPoints += $NEW_PAIN_POINTS
  | .lastUpdated = $now' \
  product/.pencil-ux.json > /tmp/ux.json && \
  mv /tmp/ux.json product/.pencil-ux.json
```

### Markdown content

```bash
mkdir -p docs/ux/journeys
cat > "docs/ux/journeys/${JOURNEY_SLUG}.md" <<EOF
# $JOURNEY_NAME

## Summary
$SUMMARY

## Type
$JOURNEY_TYPE

## Personas
$(format_persona_list "$PERSONA_REFS")

## Stages

$(format_stages_for_markdown "$STAGES" "$JOURNEY_TYPE")

## Pain points
$(format_pain_summary "$PAIN_POINTS")

## Notes
(Add ongoing observations as the journey evolves.)
EOF
```

Stage formatting differs by type. User flows use numbered
steps; customer journeys use named stages; service blueprints
use front-stage / back-stage parallel structure.

## Phase 7: result

```
=== Journey Mapped ===

ID:        journey-admin-onboarding
Type:      user-flow
Stages:    4
Pain points registered: 3

Manifest:  product/.pencil-ux.json
Content:   docs/ux/journeys/admin-onboarding.md

Next steps:
  - View pain points: /product:ux:journeys:pain-points
  - Build a story map for this journey:
    /product:ux:story-maps:build (when available)
  - Write stories addressing pain points:
    /product:ux:stories:write (when available)
  - List all journeys: /product:ux:journeys:list
```

## Update mode

When updating an existing journey:

1. Read existing journey from manifest
2. Walk through stages with current values shown
3. User edits any stages; new pain points added; existing
   pain points referenced or modified
4. Update manifest entry (preserve `created`, update
   `lastReviewed`)
5. Update markdown file (preserve `## Notes` section)

When pain points change in update mode:

- New pain points: register in `painPoints` array
- Removed pain points: leave in registry but remove journey's
  `painPointRefs` reference (the pain may exist elsewhere or
  be addressed)
- Modified pain points: update in registry

## What this command does NOT do

- **Validate stage completeness.** A journey with 1 stage and
  no pain points is recorded as written. Quality is the
  user's judgment.
- **Auto-detect customer-journey vs user-flow.** Type
  selection is explicit because the artifacts differ
  meaningfully.
- **Replace user research.** Journeys grounded in research
  are more reliable. The command captures the journey;
  research-source attribution is at the persona level.
- **Generate cross-references automatically.** If this journey
  reuses a pain point from another journey, the user
  references the existing pain ID; the command doesn't
  fuzzy-match.

## Examples

```bash
# Map a new user flow
/product:ux:journeys:map "School Admin Onboarding" --type user-flow

# Map a customer journey
/product:ux:journeys:map "Tournament Organizer Acquisition" \
  --type customer-journey

# Map a service blueprint
/product:ux:journeys:map "Compliance Audit Response" \
  --type service-blueprint --persona persona-school-admin

# Update existing
/product:ux:journeys:map journey-admin-onboarding --update
```

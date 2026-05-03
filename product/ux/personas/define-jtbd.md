---
description: Define Jobs-to-be-Done statements for a persona. Each statement uses when/I want/so I can structure focused on situational outcomes rather than demographic identity. Multiple JTBD statements can attach to one persona with priority ranking. Writes to product/.pencil-ux.json.
argument-hint: <persona-id-or-name> [--priority primary|secondary|tertiary]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `product/ux/_context.md`,
> `product/ux/personas/_context.md`, `product/_context.md`.

Add Jobs-to-be-Done statements to a persona. JTBD framing is
best for outcome-focused work where situational motivation
matters more than demographic identity.

If the target persona doesn't exist yet, this command creates
it as a JTBD-only persona. To use both traditional fields and
JTBD statements, define the persona with
`/product:ux:personas:define` first, then add JTBD statements
with this command — the result is a hybrid persona.

## Phase 0: pre-flight

1. Verify UX manifest exists (initialize if not, same as
   `define.md` Phase 0).

2. Resolve target persona:

   ```bash
   PERSONA_ARG="$1"
   
   # Try as ID first
   if jq -e ".personas[] | select(.id == \"$PERSONA_ARG\")" \
            product/.pencil-ux.json >/dev/null 2>&1; then
     PERSONA_ID="$PERSONA_ARG"
     PERSONA_TYPE=$(jq -r ".personas[] | select(.id == \"$PERSONA_ID\") | .type" \
                          product/.pencil-ux.json)
   else
     # Try as name (find or create)
     PERSONA_SLUG=$(echo "$PERSONA_ARG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')
     PERSONA_ID="persona-${PERSONA_SLUG}"
     
     EXISTING=$(jq -r ".personas[] | select(.id == \"$PERSONA_ID\") | .id" \
                      product/.pencil-ux.json)
     
     if [ -z "$EXISTING" ]; then
       echo "Persona '$PERSONA_ID' doesn't exist. Create as JTBD-only? [Y/n]"
       read -p "> " CREATE
       if [[ "$CREATE" =~ ^[Nn] ]]; then
         echo "Aborting. Run /product:ux:personas:define first to create traditional persona."
         exit 0
       fi
       NEW_PERSONA=true
     fi
   fi
   ```

3. Determine resulting persona type:

   ```
   - New persona, no traditional fields: type = "jtbd"
   - Existing traditional persona, adding JTBD: type = "hybrid"
   - Existing JTBD persona, adding more JTBD: type stays "jtbd"
   - Existing hybrid persona, adding more JTBD: type stays "hybrid"
   ```

## Phase 1: gather JTBD statement(s)

Walk the user through one or more JTBD statements:

```
=== JTBD for persona-school-admin ===

Each Jobs-to-be-Done statement has three parts:

  When [situation],
  I want [motivation],
  So I can [outcome].

The "when" anchors the situational trigger.
The "I want" describes what they're trying to do.
The "so I can" describes the outcome they value.

Examples:

  When evaluating a new ed-tech vendor,
  I want to verify FERPA/COPPA compliance and data handling,
  So I can avoid liability and protect student data.

  When preparing for an annual audit,
  I want to gather all compliance documentation in one place,
  So I can complete audit prep in 4 hours instead of 40.

  When reviewing student outcomes after a quarter,
  I want to see what's working across teachers and grades,
  So I can replicate effective practices across the school.

Add JTBD statements (you can add multiple):
```

For each statement, prompt the three clauses individually:

```
=== JTBD Statement 1 ===

Step 1 of 4: Situation (the "when" clause)

What triggering situation does this job activate in?

Tip: Specific situations are more useful than abstract
contexts. "When deciding next quarter's curriculum focus" is
specific; "When working on planning" is too abstract.

When:
> 

Step 2 of 4: Motivation (the "I want" clause)

In that situation, what are they trying to do?

Tip: Frame the motivation as user-facing action, not
implementation. "Filter candidates by certification" is
implementation; "find candidates that meet our hiring
requirements" is user motivation.

I want:
> 

Step 3 of 4: Outcome (the "so I can" clause)

What outcome do they value? What does success look like?

Tip: The outcome is the whole point. A JTBD without a
meaningful "so I can" is just feature description.

So I can:
> 

Step 4 of 4: Priority

How important is this job to this persona, relative to their
other JTBDs?

  [p] Primary — one of their top jobs; we should be great at this
  [s] Secondary — important but not their main reason for
                  being here
  [t] Tertiary — useful but they could live without it

Priority:
> 
```

## Phase 2: continuation prompt

```
JTBD statement 1 added. Add another? [Y/n]
```

If yes, loop to Phase 1 for next statement. If no, proceed to
Phase 3.

## Phase 3: review

```
=== JTBD Review for persona-school-admin ===

Statements added (3):

Primary:
  When evaluating a new ed-tech vendor,
  I want to verify FERPA/COPPA compliance and data handling,
  So I can avoid liability and protect student data.

Secondary:
  When preparing for an annual audit,
  I want to gather all compliance documentation in one place,
  So I can complete audit prep in 4 hours instead of 40.

Secondary:
  When reviewing student outcomes after a quarter,
  I want to see what's working across teachers and grades,
  So I can replicate effective practices across the school.

Save these JTBD statements? [Y/edit/abort]
```

## Phase 4: write to manifest

```bash
# For each statement, generate ID and append to persona's jtbd array
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Build the new JTBD array entries
JTBD_ENTRIES=$(jq -n --arg now "$NOW" \
  '[
    {
      id: "jtbd-vendor-vetting",
      situation: "...",
      motivation: "...",
      outcome: "...",
      priority: "primary"
    },
    ...
  ]')

# Append to existing persona's jtbd array, or create new persona
if [ "$NEW_PERSONA" = "true" ]; then
  # Create persona with JTBD-only type
  PERSONA_NAME="$PERSONA_NAME"  # might prompt for display name
  
  jq --arg id "$PERSONA_ID" \
     --arg name "$PERSONA_NAME" \
     --arg now "$NOW" \
     --argjson jtbd "$JTBD_ENTRIES" \
    '.personas += [{
      id: $id,
      name: $name,
      type: "jtbd",
      filePath: ("docs/ux/personas/" + ($id | sub("^persona-"; "")) + ".md"),
      jtbd: $jtbd,
      researchSources: [],
      created: $now,
      lastReviewed: $now
    }] | .lastUpdated = $now' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
else
  # Append to existing persona's jtbd; update type to hybrid if was traditional
  jq --arg id "$PERSONA_ID" \
     --arg now "$NOW" \
     --argjson new_jtbd "$JTBD_ENTRIES" \
    '
    .personas |= map(
      if .id == $id then
        .jtbd = ((.jtbd // []) + $new_jtbd) |
        .type = (if .type == "traditional" then "hybrid" else .type end) |
        .lastReviewed = $now
      else . end
    ) | .lastUpdated = $now
    ' \
    product/.pencil-ux.json > /tmp/ux.json && \
    mv /tmp/ux.json product/.pencil-ux.json
fi
```

## Phase 5: markdown sync

If a markdown file exists for this persona, append/update the
JTBD section. If the persona is JTBD-only and no markdown
exists yet, create one:

```bash
MD_FILE="docs/ux/personas/${PERSONA_SLUG}.md"
mkdir -p docs/ux/personas

if [ ! -f "$MD_FILE" ]; then
  cat > "$MD_FILE" <<EOF
# $PERSONA_NAME

## Summary
($PERSONA_TYPE persona; expand summary as understanding grows)

## JTBD
$(format_jtbd_for_markdown "$JTBD_ENTRIES")

## Research backing
$RESEARCH_BACKING

## Notes
(Add ongoing observations as the persona evolves.)
EOF
else
  # Update or append the ## JTBD section
  if grep -q "^## JTBD" "$MD_FILE"; then
    # Replace existing JTBD section (preserve other sections)
    update_jtbd_section "$MD_FILE" "$JTBD_ENTRIES"
  else
    # Append JTBD section
    cat >> "$MD_FILE" <<EOF

## JTBD
$(format_jtbd_for_markdown "$JTBD_ENTRIES")
EOF
  fi
fi
```

JTBD formatted for markdown:

```markdown
## JTBD

### Primary
**When** evaluating a new ed-tech vendor,
**I want** to verify FERPA/COPPA compliance and data handling,
**so I can** avoid liability and protect student data.

### Secondary
**When** preparing for an annual audit,
**I want** to gather all compliance documentation in one place,
**so I can** complete audit prep in 4 hours instead of 40.

[...]
```

## Phase 6: result

```
=== JTBD Statements Added ===

Persona:    persona-school-admin (now hybrid)
Added:      3 JTBD statements (1 primary, 2 secondary)
Manifest:   product/.pencil-ux.json
Content:    docs/ux/personas/school-admin.md

Persona now has:
  - Traditional fields: role, context, goals, frustrations, tech profile
  - 3 JTBD statements

Next steps:
  - Map a journey for one of these jobs:
    /product:ux:journeys:map
  - Write a story addressing a JTBD:
    /product:ux:stories:write
  - View all JTBDs: /product:ux:personas:list --show-jtbd
```

## What this command does NOT do

- **Validate JTBD quality.** A bad JTBD ("when using the
  product, I want to use the dashboard, so I can use the
  dashboard") is recorded as written. Quality is the
  user's judgment.
- **Force every persona to have JTBDs.** Some personas use
  traditional fields only; that's fine.
- **Replace user research.** JTBDs grounded in research are
  more reliable than hypothesis JTBDs. The command captures
  the JTBD; research-source attribution happens at the
  persona level.
- **Auto-deduplicate similar JTBDs.** If two JTBDs overlap
  significantly, the command stores both. Cleanup happens
  manually.

## Examples

```bash
# Add JTBDs to existing persona
/product:ux:personas:define-jtbd persona-school-admin

# Create new JTBD-only persona
/product:ux:personas:define-jtbd "Tournament Organizer"

# Add specific priority
/product:ux:personas:define-jtbd persona-it-director \
  --priority primary
```

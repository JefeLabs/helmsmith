---
description: Query or manage the framework bindings runtime manifest. Show current state, query specific fields via jq path, deactivate bindings, perform explicit review (updates lastReviewed). Read-only by default; mutations require explicit flags.
argument-hint: [--query <jq-path>] [--review] [--deactivate <binding>] [--reactivate <binding>]
allowed-tools: Read, Write, Edit, Bash
---

Query or manage the framework bindings runtime manifest at
`product/.pencil-frameworks.json`. Read-only by default; the
`--review`, `--deactivate`, and `--reactivate` flags trigger
mutations.

## Phase 0: discovery

1. Read `product/.pencil-frameworks.json`. If missing:
   - In query/show mode: report "no framework manifest exists;
     run `/core:frameworks:init` to create one."
   - In review mode: same message; no manifest to review.
   - In deactivate/reactivate mode: same message; nothing to
     deactivate.

## Modes

### Default — show current state

```bash
/core:frameworks:manifest
```

Renders the current manifest in human-readable form:

```
=== Framework Bindings ===
Last updated: 2026-05-03T16:30:00Z

Component bindings:
  heroui (active)
    Version:       3.0.0
    Stack:         react, tailwind, next.js
    Detected:      2026-05-03 (today)
    Verified:      2026-05-03 (today)
    Reviewed:      2026-05-03 (today)
    Detected from: package.json:@heroui/react,
                   package.json:tailwindcss

Documentation bindings:
  storybook (active)
    Version:       10.3.4
    Adapter:       @storybook/nextjs
    Config dir:    app-ui/.storybook/
    Detected:      2026-05-03 (today)
    Verified:      2026-05-03 (today)
    Reviewed:      2026-05-03 (today)

Staleness thresholds (effective):
  Detection:    30 days
  Verification: 14 days
  Review:       180 days

Status: All bindings fresh.
```

When timestamps approach thresholds:

```
storybook (active)
    Verified:      2026-04-15 (18 days ago) ⚠ stale
                   Run /core:frameworks:init --check to re-verify.
```

### Query mode — `--query <jq-path>`

Read specific fields via jq:

```bash
/core:frameworks:manifest --query componentBindings.heroui.active
# → true

/core:frameworks:manifest --query componentBindings.heroui.version
# → "3.0.0"

/core:frameworks:manifest --query "documentationBindings | keys"
# → ["storybook"]

/core:frameworks:manifest --query "componentBindings | to_entries | map(select(.value.active)) | length"
# → 1
```

Useful for:
- Other commands programmatically checking state
- Scripts validating CI-time configuration
- Debugging activation gate failures

The query is passed directly to `jq`. Standard jq syntax
applies.

### Review mode — `--review`

Explicit user revisitation. The user is affirming "yes I still
want these bindings active." Updates `lastReviewed` for all
active bindings:

```
=== Framework Bindings Review ===

heroui (active)
  Version:       3.0.0
  Stack:         react, tailwind, next.js
  Last reviewed: 2025-11-01 (183 days ago)
  
  Still want this binding active? [Y/n/edit]

storybook (active)
  Version:       10.3.4
  Adapter:       @storybook/nextjs
  Last reviewed: 2025-11-01 (183 days ago)
  
  Still want this binding active? [Y/n/edit]
```

For each binding:
- **Y** — confirm; updates `lastReviewed` to now
- **n** — deactivate; sets `active: false`; the entry is
  preserved (with new `lastReviewed`) so future detection
  knows the user chose not to use it
- **edit** — modify version/stack/etc. inline; updates all
  three timestamps

After all bindings reviewed:

```
=== Review Complete ===
Reviewed: 2 bindings
Confirmed: 2
Deactivated: 0
Manifest written.
```

### Deactivate mode — `--deactivate <binding>`

Remove a binding from active status. The user is saying "I no
longer want this binding active":

```bash
/core:frameworks:manifest --deactivate storybook
```

Effect:
- Sets `componentBindings.<binding>.active` (or
  `documentationBindings.<binding>.active`) to `false`
- Updates `lastReviewed` to now
- Doesn't delete the entry; preserves detection signals so
  re-activation later doesn't require re-detecting from
  scratch
- Reports cross-binding implications: "Deactivating storybook;
  /core:frameworks:storybook:* commands will refuse to run until
  reactivation."

```
=== Deactivation Confirmation ===

Binding:   storybook (documentation)
Currently: active (version 10.3.4)

Deactivating means:
  - All /core:frameworks:storybook:* commands will refuse to run
  - The maintenance:remediation:storybook-drift routine will
    not run
  - Storybook deep configuration in .pencil-storybook.json
    is preserved (not deleted)
  - Detection signals are preserved; reactivate via
    /core:frameworks:manifest --reactivate storybook

Confirm deactivation? [y/N]
```

### Reactivate mode — `--reactivate <binding>`

Inverse of deactivate. Re-enables a previously deactivated
binding:

```bash
/core:frameworks:manifest --reactivate storybook
```

Effect:
- Sets `active: true`
- Updates `lastReviewed` to now (explicit user re-affirmation)
- Suggests running `/core:frameworks:init --check --binding <name>`
  to verify the binding's values still match current project
  state (since deactivation may have left the binding's stored
  values stale)

## Cross-namespace integration

Other suite commands query this manifest as part of their
pre-flight checks:

```bash
# Pre-flight in /core:frameworks:storybook:stories:gen
ACTIVE=$(jq -r '.documentationBindings.storybook.active // false' product/.pencil-frameworks.json 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  # ... fail with clear message
fi
```

This command provides the human-readable surface; commands
read the JSON directly for performance.

The `--query` mode is for cases where another command wants
human-readable output rather than raw JSON.

## Staleness reporting

The default show mode flags any timestamp approaching its
threshold. Three signals:

- **Verification stale** (>14 days default): visible warning
  (⚠) with suggested action
- **Detection stale** (>30 days default) AND project has
  changed since: visible warning + suggested `--update`
- **Review stale** (>180 days default): visible warning +
  suggested `--review`

Thresholds are read from the manifest's `stalenessThresholds`
field; defaults apply when absent or partial.

## What this command does NOT do

- **Detect new bindings.** That's `/core:frameworks:init`'s job.
- **Verify values against project state.** That's
  `/core:frameworks:init --check`'s job.
- **Modify per-binding deep config.** Storybook deep config
  lives in `.pencil-storybook.json`; this command only touches
  `.pencil-frameworks.json`.
- **Auto-act on staleness.** It surfaces warnings; the user
  decides whether to run `--check`, `--update`, or `--review`.
- **Modify project files.** Reads project state via reading
  package.json (during related init flows) but writes only to
  the framework manifest.

## Examples

```bash
# Show all framework binding state
/core:frameworks:manifest

# Quick check: is storybook active?
/core:frameworks:manifest --query documentationBindings.storybook.active

# Periodic review (typical: every 6 months)
/core:frameworks:manifest --review

# Disable a binding
/core:frameworks:manifest --deactivate storybook

# Re-enable after deactivation
/core:frameworks:manifest --reactivate storybook
```

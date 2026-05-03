---
description: Detect and activate framework bindings for this project. Scans package.json and filesystem for known component bindings (heroui, mui, chakra, shadcn) and documentation bindings (storybook, ladle, histoire); presents findings; user confirms; persists to product/.pencil-frameworks.json. The activation gate every framework-binding command checks before running. Auto-triggers when other framework-binding commands run with empty manifest.
argument-hint: [--check] [--update] [--scope component|documentation] [--binding <name>]
allowed-tools: Read, Write, Edit, Bash
---

Detect framework bindings (component + documentation) from
project state and activate them in the runtime manifest at
`product/.pencil-frameworks.json`.

This command is the activation gate's foundation. Every
framework-binding command checks the manifest for activation
before running; this command writes the manifest.

## Mode selection

Three primary modes via flags:

- **(no flags)** — full init. Detect all bindings. User confirms
  each. Updates `lastDetected`, `lastVerified`, `lastReviewed`
  for activated bindings.
- **`--check`** — verification only. Re-check existing active
  bindings against current project state (version matches?
  adapter matches?). Updates `lastVerified` only. Doesn't add
  or remove bindings.
- **`--update`** — re-detection without explicit user review.
  Updates `lastDetected` and `lastVerified` for all active
  bindings; surfaces newly-detected bindings for activation.
  Doesn't update `lastReviewed`.

Plus scope flags:

- **`--scope component`** — only handle component bindings
- **`--scope documentation`** — only handle documentation bindings
- **`--binding <name>`** — only handle the named binding

## Phase 0: discovery

1. Read `product/.pencil-frameworks.json` if it exists.
2. If missing AND not in `--check` mode: this is fresh
   activation. Proceed to detection.
3. If missing AND `--check` mode: nothing to verify; report
   and stop.
4. Read `.product-frameworks-schema.json` to validate against
   schema after writing.

## Phase 1: locate package.json

The detection patterns rely on package.json. Locate it:

```bash
# Try in order
candidates=(
  "package.json"                         # current dir
  "app-ui/package.json"
  "apps/web/package.json"
  "packages/ui/package.json"
  "web/package.json"
  "frontend/package.json"
)

for c in "${candidates[@]}"; do
  if [ -f "$c" ]; then
    PKG_JSON="$c"
    break
  fi
done
```

If no package.json found:

> No package.json detected in standard locations. This may be
> a non-JavaScript project (e.g., Spring Boot, Python data
> platform, native mobile-only). Framework bindings don't apply
> to such projects.
>
> Continue with empty framework manifest? [Y/n]

If yes, write empty manifest with current timestamp; stop.

## Phase 2: detect component bindings

Scan dependencies and devDependencies for component-binding
markers:

### heroui

```bash
HEROUI_PRESENT=$(jq -r '
  (.dependencies // {}) + (.devDependencies // {})
  | has("@heroui/react") and has("tailwindcss")
' "$PKG_JSON")

if [ "$HEROUI_PRESENT" = "true" ]; then
  HEROUI_VERSION=$(jq -r '.dependencies."@heroui/react" // .devDependencies."@heroui/react"' "$PKG_JSON" | sed 's/[\^~]//')
  
  # Detect stack
  STACK=("react")
  jq -e '.dependencies.tailwindcss' "$PKG_JSON" >/dev/null && STACK+=("tailwind")
  jq -e '.dependencies.next' "$PKG_JSON" >/dev/null && STACK+=("next.js")
  
  CANDIDATES+=("heroui")
fi
```

### mui

```bash
MUI_PRESENT=$(jq -r '(.dependencies // {}) | has("@mui/material")' "$PKG_JSON")
```

### chakra

```bash
CHAKRA_PRESENT=$(jq -r '(.dependencies // {}) | has("@chakra-ui/react")' "$PKG_JSON")
```

### shadcn

shadcn isn't a package — it's files copied into your repo. Detect via:

```bash
# Heuristic
if [ -d "components/ui" ] && \
   jq -e '(.dependencies // {}) | has("tailwindcss-animate")' "$PKG_JSON" >/dev/null && \
   ls components/ui/*.tsx >/dev/null 2>&1; then
  SHADCN_PRESENT=true
fi
```

Less reliable than package detection; surface as candidate
with a note that it's heuristic-based.

## Phase 3: detect documentation bindings

### storybook

```bash
STORYBOOK_PRESENT=$(jq -r '(.devDependencies // {}) | has("storybook")' "$PKG_JSON")

if [ "$STORYBOOK_PRESENT" = "true" ]; then
  STORYBOOK_VERSION=$(jq -r '.devDependencies.storybook' "$PKG_JSON" | sed 's/[\^~]//')
  
  # Find adapter
  ADAPTER=$(jq -r '.devDependencies | keys[] | select(startswith("@storybook/") and (. | test("(nextjs|react-vite|sveltekit|vue3-vite|angular|web-components-vite|html-vite)")))' "$PKG_JSON" | head -1)
  
  # Find config dir
  CONFIG_DIR=""
  for c in ".storybook" "app-ui/.storybook" "apps/web/.storybook"; do
    if [ -d "$c" ]; then
      CONFIG_DIR="${c}/"
      break
    fi
  done
  
  CANDIDATES+=("storybook")
fi
```

### ladle

```bash
LADLE_PRESENT=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | has("@ladle/react")' "$PKG_JSON")
```

### histoire

```bash
HISTOIRE_PRESENT=$(jq -r '(.devDependencies // {}) | has("histoire")' "$PKG_JSON")
```

## Phase 4: present findings

In full init mode, show what was detected:

```
=== Framework Binding Detection ===
Project: SkoolScout (package.json at app-ui/package.json)

Component bindings detected:
  ✓ heroui (version 3.0.0; stack: react, tailwind, next.js)
    Detected from:
      - package.json:@heroui/react
      - package.json:tailwindcss

Documentation bindings detected:
  ✓ storybook (version 10.3.4; adapter @storybook/nextjs)
    Config dir: app-ui/.storybook/
    Detected from:
      - package.json:storybook
      - package.json:@storybook/nextjs

Not detected (skipped):
  Component:    mui, chakra, shadcn
  Documentation: ladle, histoire

Activate detected bindings? [Y/edit/skip]
```

User can:
- **Y** — activate all detected; proceed
- **edit** — pick which to activate, modify version/stack values
- **skip** — abandon (manifest unchanged)

In `--check` mode, the report differs:

```
=== Framework Binding Verification ===

heroui: ✓ matches manifest (version 3.0.0)
        lastVerified updated to 2026-05-03T16:30:00Z

storybook: ⚠ DRIFT
        Manifest says: version 10.3.4
        Actual:        version 10.4.1
        
        Run /frameworks:init --update to refresh.
```

In `--update` mode, drifted values are corrected automatically;
`lastDetected` and `lastVerified` updated; `lastReviewed`
preserved.

## Phase 5: per-binding follow-up suggestions

For activated bindings that have their own deep init,
suggest running it:

```
✓ storybook activated. For full configuration including
  screenshot settings, addon inventory, and provider stack,
  run /frameworks:storybook:init

✓ heroui activated. (No deep init; binding is configured
  via Pencil specs.)
```

The suggestion is informational; the user can run the deep
init now or later. Storybook commands will auto-trigger
storybook init for fields they need anyway.

## Phase 6: persist manifest

Write `product/.pencil-frameworks.json`:

```jsonc
{
  "version": 1,
  "lastUpdated": "<now>",
  "componentBindings": {
    "heroui": {
      "active": true,
      "version": "3.0.0",
      "stack": ["react", "tailwind", "next.js"],
      "detectedFrom": [
        "package.json:@heroui/react",
        "package.json:tailwindcss"
      ],
      "lastDetected": "<now>",
      "lastVerified": "<now>",
      "lastReviewed": "<now>"
    }
  },
  "documentationBindings": {
    "storybook": {
      "active": true,
      "version": "10.3.4",
      "adapter": "@storybook/nextjs",
      "configDir": "app-ui/.storybook/",
      "detectedFrom": [
        "package.json:storybook",
        "package.json:@storybook/nextjs"
      ],
      "lastDetected": "<now>",
      "lastVerified": "<now>",
      "lastReviewed": "<now>"
    }
  }
}
```

The three timestamps are set per the mode:

| Mode | lastDetected | lastVerified | lastReviewed |
|------|--------------|--------------|--------------|
| Full init (new binding) | now | now | now |
| Full init (existing binding) | now | now | now |
| `--check` | unchanged | now | unchanged |
| `--update` | now | now | unchanged |

If the file already existed, a backup at
`product/.pencil-frameworks.json.backup` is created before
overwriting.

## Phase 7: report

```
=== Framework Init Report ===
Mode:                full init
Manifest written:    product/.pencil-frameworks.json

Activated bindings:
  Component:        heroui (3.0.0; react, tailwind, next.js)
  Documentation:    storybook (10.3.4; @storybook/nextjs)

Total bindings active: 2

Next steps:
  - Configure storybook deep settings: /frameworks:storybook:init
  - Build components: /frameworks:heroui:build-components
  - Or simply invoke any /frameworks:* command — bindings are ready.
```

## Auto-trigger pattern

When any other framework-binding command runs and
`product/.pencil-frameworks.json` is missing, that command
auto-triggers this command for activation:

```
$ /frameworks:storybook:stories:gen Button

Framework manifest not found. Running /frameworks:init to
detect and activate bindings...

[init runs as above]

Continuing with /frameworks:storybook:stories:gen Button...
```

This makes first-time use smooth: the user runs any framework
command, init runs transparently, the original command resumes.
No "you must run init first" friction.

## Error handling

### No package.json

Already covered in Phase 1. Empty manifest written; no failure.

### Detection but user declines activation

User chose to not activate detected bindings. Manifest is
written with the binding's `active: false`:

```jsonc
{
  "componentBindings": {
    "heroui": {
      "active": false,
      "version": "3.0.0",
      "detectedFrom": [...],
      "lastDetected": "<now>",
      "lastVerified": "<now>",
      "lastReviewed": "<now>"
    }
  }
}
```

The detection signal is preserved; future runs know the binding
exists but isn't activated. Audit may surface "heroui present
in package.json but not active in framework manifest — was
this intentional?"

### Detection fails for active binding (--check mode)

```
storybook: ✗ NO LONGER DETECTED
        Manifest says active; package.json no longer has
        storybook in devDependencies.
        
        Has Storybook been removed? If so, run
        /frameworks:manifest --deactivate storybook.
        Otherwise, /frameworks:init --update to re-detect.
```

Surface clearly; don't auto-deactivate. The user decides what
to do.

## Examples

```bash
# First-time activation
/frameworks:init

# Quick re-verification (after a few weeks)
/frameworks:init --check

# Re-detect after adding new bindings
/frameworks:init --update

# Targeted update for one binding
/frameworks:init --update --binding storybook

# Component bindings only
/frameworks:init --check --scope component
```

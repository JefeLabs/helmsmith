---
description: Migrate a Pencil-managed project from one suite version to another. Handles renamed tokens, renamed commands, new mandatory foundations, and structural changes between suite versions. The design-system equivalent of a dependency-bumper tool, but for the design system itself.
argument-hint: <target-version> [--from <current-version>] [--dry-run] [--auto-fix-safe]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Migrate a Pencil-managed project from one suite version to another.
When the Pencil suite ships a new version (renamed tokens, new
mandatory foundations, restructured manifests, deprecated commands),
existing projects need a migration path or they'll silently drift
into incompatibility.

This is the lowest-priority of the architectural commands because
it only matters when a Pencil version actually ships. Documenting
it now avoids the v2 surprise where everyone's projects break.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Read `product/.pencil-version.json` (the project's current
   recorded suite version). If absent, infer from the structure
   present (e.g. has `patterns/` folder → ≥ v1.5; has
   `foundations/motion.md` references → ≥ v1.4).
3. Resolve target version:
   - From `product/design/.suite-version.json` (the suite's current version,
     committed with the suite source)
   - Or `--target <version>` for explicit target
4. Resolve flags:
   - `--from <current-version>`: override the inferred current
     version
   - `--dry-run`: print migration steps without applying
   - `--auto-fix-safe`: apply only changes that can't break the
     project (additive token renames, new file creation). Don't
     auto-apply changes that affect rendered output without explicit
     review.

## Phase 1 — Build migration plan

Migration plans are version-pair specific. The suite ships a
`product/design/migrations/<from>-to-<to>.json` describing what changes:

```jsonc
// Example: pencil/migrations/1.4-to-1.5.json
{
  "from": "1.4",
  "to": "1.5",
  "steps": [
    {
      "type": "new-file",
      "path": "pencil/patterns/states.md",
      "action": "copy-from-suite",
      "rationale": "Patterns layer added in v1.5",
      "userImpact": "none-additive",
      "rollback": "delete the file"
    },
    {
      "type": "token-rename",
      "from": "--accent",
      "to": "--color-accent-500",
      "files": ["app/globals.css", "src/**/*.tsx", "design/foundations/colors.pen"],
      "rationale": "Color tokens namespaced under --color-* in v1.5",
      "userImpact": "rebuild-required",
      "rollback": "reverse the rename"
    },
    {
      "type": "manifest-shape-change",
      "manifest": "product/.pencil-build-manifest.json",
      "transform": "add-briefSlug-field",
      "rationale": "Brief drift detection added in v1.5",
      "userImpact": "additive-with-default-empty",
      "rollback": "remove the field"
    }
  ]
}
```

Walk migrations sequentially from current to target. If user is on
1.3 and target is 1.5, walk 1.3 → 1.4 → 1.5.

## Phase 2 — Classify steps by safety

Each step gets classified by user-impact:

| Class                    | Auto-apply with --auto-fix-safe? | Why                              |
| ------------------------ | -------------------------------- | -------------------------------- |
| **none-additive**        | Yes                              | New file, new option, no existing behavior changes |
| **rebuild-required**     | No                               | Token rename — visual output may change subtly |
| **manual-review**        | No                               | Structural changes (manifest shape, command rename) |
| **breaking**             | No                               | Removes capability or changes behavior — needs deliberate decision |

`--auto-fix-safe` only applies `none-additive` steps. Everything
else is surfaced for review.

## Phase 3 — Surface plan + dry-run

Before applying anything, print the full plan:

```
Migration plan: 1.4 → 1.5

Step 1 [none-additive]: Create pencil/patterns/ folder with states.md
  Rationale: Patterns layer added in v1.5
  Action: cp from suite to project
  Impact: no existing files changed
  
Step 2 [rebuild-required]: Rename --accent → --color-accent-500
  Rationale: Color tokens namespaced under --color-* in v1.5
  Files affected: 47 files (app/globals.css, 32 .tsx files, 14 .pen files)
  Impact: visual output should be identical, but rebuild advised
  
Step 3 [manual-review]: Add briefSlug field to build manifest
  Rationale: Brief drift detection in v1.5
  Action: backfill from existing brief references where possible
  Impact: enables Plane 6 of audit; old manifests still work
  
Step 4 [breaking]: Remove deprecated /product:design:colors command
  Rationale: split into colors-select + colors in v1.5
  Workaround: existing usage should call colors-select then colors
  Impact: any scripts referencing /product:design:colors will fail
  
With --auto-fix-safe: 1 step will auto-apply (Step 1).
3 steps require manual review.

Continue? [Y/n]
```

`--dry-run` stops here without applying.

## Phase 4 — Apply auto-fix-safe steps

For each `none-additive` step:

1. Apply the change.
2. Log the action with rollback details.
3. Mark the step complete in a migration log.

Migration log written to `product/.pencil-migration-log.json`:

```json
{
  "from": "1.4",
  "to": "1.5",
  "startedAt": "<ISO>",
  "completedAt": "<ISO>",
  "stepsApplied": [
    { "step": 1, "action": "create-file", "path": "...", "rollback": "..." }
  ],
  "stepsSkipped": [
    { "step": 2, "reason": "rebuild-required, awaiting user", "guidance": "..." },
    { "step": 3, "reason": "manual-review", "guidance": "..." },
    { "step": 4, "reason": "breaking", "guidance": "..." }
  ]
}
```

## Phase 5 — Print remaining work

For each non-auto-applied step, print specific user actions:

```
✅ Auto-applied: 1 step
⚠️  Manual review needed: 3 steps

Step 2: Token rename --accent → --color-accent-500
   Run: /audit --plane 1  (will surface code references to update)
   Or:  Find/replace across the codebase, then re-run /frameworks:heroui:build-components
   
Step 3: Backfill briefSlug in build manifest
   Run: /frameworks:heroui:build-components --reconcile-briefs
   
Step 4: Remove /product:design:colors usage
   Search your repo for `/product:design:colors` invocations
   Replace with /product:design:foundations:colors-select && /product:design:foundations:colors

After completing manual steps, run:
  /product:strategy:migrate --resume

To verify migration:
  /audit
```

## Phase 6 — Resume / verify

`/product:strategy:migrate --resume` re-reads the migration log and either:

1. Confirms all steps complete + bumps version → success
2. Lists remaining steps + their guidance

After successful migration, write the new version to
`product/.pencil-version.json`:

```json
{
  "suiteVersion": "1.5",
  "migratedAt": "<ISO>",
  "migrationLog": "product/.pencil-migration-log.json"
}
```

## Reporting

```
✅ Migration complete: 1.4 → 1.5
   Steps applied:    4 of 4
   Files modified:   53
   Manifests bumped: 3 (build, brief, brand)
   
   New capabilities available:
   - Patterns layer (10 patterns now generatable)
   - Brief drift detection (audit Plane 6)
   - Industry-driven recommendations (research → select)

📝 Next steps:
   - Run /audit to validate the migration
   - Review what's new in v1.5: <link to changelog>
   - If anything broke, /product:strategy:migrate --rollback restores prior state
```

## Rollback

`/product:strategy:migrate --rollback` undoes the most recent migration:

1. Reads `product/.pencil-migration-log.json`
2. Walks each `stepsApplied` entry in reverse
3. Executes each step's `rollback` action
4. Restores `product/.pencil-version.json` to prior version

Rollback is best-effort — if the user has hand-edited files
between migration and rollback, conflicts may appear. The log
records pre-migration file hashes so rollback detects this.

## What this command does NOT do

- Does not handle rollback across multiple major versions (only the
  most recent migration). Multi-step rollback requires manual git
  reverts.
- Does not migrate user content — only structural state. Brand
  JSON, page content, etc. are preserved as-is.
- Does not fix code drift. Run `/audit` after migration to
  identify code that needs adjustment for new tokens / patterns.

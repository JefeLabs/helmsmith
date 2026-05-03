---
description: Audit drift across all installed personas. Discovers and dispatches plane checks defined per persona in core/audit/_planes/. Runs the full audit suite by default; flags scope to specific personas or planes. Cross-persona audit dispatcher — the single audit entry point regardless of which persona kits are in use.
argument-hint: [--persona product|market|engineer] [--planes 1,2,3,...] [--all] [--fix] [--since <git-ref|date>] [--json] [--ignore <pattern>] [--strict-<plane>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Walk every relationship that should hold across the installed
personas' tooling and report where reality has diverged. The
audit's role is **drift detection**, not enforcement — it
surfaces findings classified by severity (info / warn / fail);
the team decides what to act on. `--fix` enables narrowly-
scoped safe corrections; `--strict-*` flags escalate severity
levels.

This command is **persona-agnostic at the dispatch level**.
The actual plane checks are defined per persona in
`core/audit/_planes/<persona>.md`. Audit discovers what's
installed, dispatches to the relevant plane definitions, and
aggregates results into a single report.

## Plane registration

Each persona's plane definitions live in
`core/audit/_planes/<persona>.md`:

| File | Persona | Planes covered |
|------|---------|----------------|
| `core/audit/_planes/product.md` | product | 1-7 (code drift, design drift, token drift, orphans, lock divergence, brief drift, composition + research-staleness + brand-fit + feature-gap) |
| `core/audit/_planes/market.md` | marketer | 8-10 (editorial drift, SEO+AIO drift, cadence drift) |
| `core/audit/_planes/engineer.md` | engineer | 11+ (maintenance drift, architecture drift, development drift) |

Plane numbers are globally unique. New planes are assigned the
next available number when added.

When future namespaces (testing, development) add planes, they
extend the relevant persona's plane definition file. UX planes
live in `_planes/product.md` (UX is a product persona concern);
testing planes go into `_planes/engineer.md`.

## Pre-flight

1. Read `core/_context.md` for suite-wide conventions.
2. Discover installed personas by checking which
   `_planes/<persona>.md` files exist. Suite ships with all
   three; if a persona's plane file is removed (project doesn't
   use that persona), planes for that persona are skipped.
3. Read manifest inventory at suite root:
   `.product-*-schema.json` files name the runtime manifests
   each persona expects to find at `product/.pencil-*.json`.
   Missing runtime manifests downgrade the planes that depend
   on them (info-level note rather than fail).
4. Resolve flags:
   - `--all` (default): runs every plane from every installed
     persona
   - `--persona <persona>`: runs planes from one persona only
   - `--planes <list>`: runs specific planes by number
     (e.g. `--planes 1,2,11` runs Plane 1, 2, 11)
   - `--fix`: enables autofix scope (each plane defines what's
     safe to autofix)
   - `--since <ref>`: limits audit to changes since git ref
     or date — useful in CI scoping to a PR
   - `--json`: emits structured report instead of human-
     readable
   - `--ignore <glob>`: skips paths matching glob (repeatable)
   - `--strict-<plane-id>`: escalates that plane's severity
     (e.g. `--strict-token-drift` makes warn → fail in
     Plane 3)

## Dispatch

For each persona in scope:

1. Read `core/audit/_planes/<persona>.md` — that file's body
   is treated as a sequence of plane definitions, each
   self-contained with its checks, severity classification,
   autofix scope, and reporting structure
2. For each plane in scope (per `--planes` filter or all
   if `--all`), execute the plane's check sequence
3. Collect findings with consistent metadata (plane number,
   severity, location, suggested action)

## Severity model

| Severity | Meaning | Default behavior |
|----------|---------|------------------|
| `info` | Notable but not actionable | Surface in report; don't fail |
| `warn` | Should be addressed; not urgent | Surface with attention; don't fail |
| `fail` | Drift requires immediate action | Surface as failure; non-zero exit if running in CI |

`--strict-<plane>` escalates severity within a plane:
- `info → warn` for the plane
- `warn → fail` for the plane

`--strict-all` escalates across all planes (rarely useful;
breeds noise).

## Autofix scope

`--fix` is allowed only for genuinely safe corrections:

- Refreshing manifests from canonical sources (e.g.,
  re-deriving `.pencil-component-manifest.json` from
  current `.pen` files)
- Mirroring foundation tokens into `@theme` when foundation
  is canonical
- Cleaning up dead state (removing manifest entries for
  files that no longer exist on disk)
- **Never** code edits to source files (component code,
  CSS, application code) — those route through the
  appropriate command (`/frameworks:heroui:build-components`,
  `/product:design:design-page`, etc.)

Each plane definition documents its autofix scope explicitly.
Planes without safe autofixes simply don't act on `--fix`.

## Aggregation

After all in-scope planes complete:

1. **Group findings** by severity (fail / warn / info)
2. **Group within severity** by persona (design / market /
   engineer)
3. **Group within persona** by plane
4. **Compute summary**: total findings, severity breakdown,
   per-persona counts

## Report format

### Human-readable (default)

```
=== Audit Report ===
Run:           2026-05-03T15:42:18Z
Scope:         all personas, all planes
Since:         (full audit)

Summary:
  fail:  2 findings  (Plane 1: 1, Plane 11: 1)
  warn:  7 findings  (Plane 3: 2, Plane 8: 3, Plane 10: 2)
  info:  14 findings (across 5 planes)

=== FAIL ===

Plane 1 — Code drift (product persona)
  src/components/Button.tsx
    Component code edited 2026-04-29 but source
    .pen frame `core-atoms-button` last touched 2026-04-15.
    Expected: code matches build output of frame.
    Action:  Run /frameworks:heroui:build-components --component Button
             to rebuild from current frame, OR run
             /product:design:design-page to update the frame to
             match current code (then re-build).

Plane 11 — Maintenance drift (engineer persona)
  Sub-check: 11b upgrade lag
    Maven ecosystem 47 days behind cadence target (target: 30 days).
    Action:  Run /workflows:manage start engineer:polyglot-maintenance-cycle

=== WARN ===

Plane 3 — Token drift
  ... (and so on)

=== INFO ===

... (collapsed by default; --verbose to expand)
```

### JSON (`--json`)

Structured output for CI / agent consumption:

```jsonc
{
  "version": 1,
  "runAt": "2026-05-03T15:42:18Z",
  "scope": {
    "personas": ["product", "market", "engineer"],
    "planes": "all"
  },
  "summary": {
    "fail": 2,
    "warn": 7,
    "info": 14
  },
  "findings": [
    {
      "plane": 1,
      "planeName": "Code drift",
      "persona": "product",
      "severity": "fail",
      "subCheck": "1",
      "location": "src/components/Button.tsx",
      "description": "...",
      "suggestedAction": "..."
    }
    // ...
  ]
}
```

## Exit codes

- `0` — no findings, or only `info` findings
- `1` — at least one `warn` finding (and no `fail`)
- `2` — at least one `fail` finding

CI pipelines typically treat exit codes 0 and 1 as pass, exit
code 2 as fail.

## Cross-persona considerations

When findings in one persona depend on outputs from another
persona, the audit surfaces the cross-persona relationship:

- Plane 8 (editorial drift) depends on `.pencil-tone.json`
  from the product persona (since tone is curated under
  product even when consumed by marketing). If that manifest
  is missing, Plane 8 surfaces `info: tone manifest absent;
  editorial checks limited`.
- Plane 11 (maintenance drift) consumes `.pencil-decisions.json`
  from the engineer persona itself (architecture decisions
  pinning libraries) — no cross-persona dependency, but
  noted here for symmetry.
- Plane 12 (architecture drift, when added) may surface
  ADR violations that imply downstream component or
  framework binding changes — surface as cross-persona
  follow-up suggestions.

## What this command does NOT do

- **Make decisions.** The audit reports drift; the team
  decides what to act on.
- **Modify source code.** Autofix is limited to manifest
  refreshes and dead-state cleanup; code lives under
  command-specific build pipelines.
- **Dispatch follow-up workflows.** When findings suggest
  workflow-level work (e.g., "run a maintenance cycle"),
  the audit names the workflow but doesn't auto-start it.
  The user invokes `/workflows:manage start` if they choose.
- **Replace per-persona reports.** Each persona's commands
  may produce their own focused reports (e.g.,
  `/engineer:architecture:dependency` produces a
  dependency-specific report). Audit is the integrated
  view across all personas; per-command reports stay
  available.

## Examples

```bash
# Full audit across all personas
/audit

# Designer-only audit (planes 1-7)
/audit --persona product

# Specific planes
/audit --planes 1,3,11

# Strict mode on specific plane
/audit --strict-token-drift

# CI usage with JSON output
/audit --json --since origin/main

# Audit with autofix scope enabled
/audit --fix
```

## Plane definitions

The actual plane checks are defined in:

- **`core/audit/_planes/product.md`** — Planes 1-7 (design
  system drift)
- **`core/audit/_planes/market.md`** — Planes 8-10 (marketing
  drift)
- **`core/audit/_planes/engineer.md`** — Planes 11+ (engineering
  drift)

Each file structures its planes the same way: plane number,
name, severity defaults, sub-checks, autofix scope,
cross-persona dependencies, and reporting fields. The
dispatch loop above doesn't need to know plane internals —
it loads the persona's plane file and walks the plane
definitions in order.

When adding new planes, edit the appropriate persona's plane
file. The dispatcher discovers them automatically.

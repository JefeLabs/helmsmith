# Maintenance — Namespace Context (`engineer/maintenance/`)

> Read this in addition to `product/strategy/_context.md` whenever any
> `/engineer:maintenance:*` command runs. Sub-namespace `_context.md`
> files (`engineer/maintenance/remediation/_context.md`,
> `engineer/maintenance/upgrades/_context.md`,
> `engineer/maintenance/workflows/_context.md`) are also read when their
> sub-namespace's commands run.
>
> The `engineer/maintenance/` namespace covers **quality routines** —
> recurring upkeep that keeps the fleet healthy: dependency
> upgrades, code-quality remediation, structural drift fixes,
> security scans, regression verification. Distinct from
> `development/` (which is forward-motion product work) and
> `product/strategy/` (which is design-system orchestration).

## Why maintenance is its own namespace

The skillz suite serves two fundamentally different kinds of
software work:

1. **Forward motion** — building new features, designing systems,
   shipping product. Owned by `product/strategy/` (orchestration),
   `product/design/` (design), `frameworks/heroui/` (implementation), and forthcoming
   `development/` (engineering practice).

2. **Quality routines** — keeping what you've shipped working.
   Dependency upgrades, lint cleanup, atomic-design enforcement,
   component dedup, security scans, regression verification.
   Owned here.

These have different cadences (forward motion is sprint-driven;
maintenance is calendar-driven), different stakeholders (product
team vs platform/SRE), different success criteria (new capability
vs reduced drift), and different agent consumers (Phase 3 sub-
agents Amara/Kai/Zara/Reese for forward motion; Janitr / Bumpr /
Verifly for maintenance). Mixing them in one namespace produces
confusion about ownership and cadence.

## Sub-namespaces

```
maintenance/
├── _context.md             this file (shared meta-anatomy + topology detection)
├── remediation/            find existing drift, fix in place
├── upgrades/               advance version state forward
└── workflows/              orchestration layer (cycle + calendar)
```

Future sub-namespaces (when needed):
- `scans/` — detect-only routines (Snyk, Qodana, accessibility,
  vulnerability) that produce findings consumed by remediation
- `verifications/` — confirm correctness post-change (regression
  via Verifly, build, deploy)
- `cleanup/` — debt-driven removal (dead-code, unused-deps,
  stale-feature-flags)

Start with the two sub-namespaces matching existing routines;
add others as routines emerge.

## Two archetypes — remediation and upgrade

Maintenance routines fall into two distinct archetypes that share
structural anatomy but differ functionally:

### Remediation
Find existing drift in committed code/artifacts; fix in place.
- **Input**: the current state of the codebase
- **Output**: pull request that reduces drift count
- **Examples**: lint findings (Biome), atomic-design rule violations,
  duplicate components, accessibility issues, security findings
- **Order**: priority by impact / auto-fixability
- **Sub-namespace**: `engineer/maintenance/remediation/`

See `engineer/maintenance/remediation/_context.md` for archetype-specific
patterns.

### Upgrade
Advance version state of dependencies forward.
- **Input**: current dependency state (lockfiles, manifests)
- **Output**: pull request that bumps versions while preserving
  behavior (verified via tests + builds + plans)
- **Examples**: npm packages, gradle dependencies, maven dependencies,
  infrastructure providers (Terraform, Docker, GHActions)
- **Order**: risk tier, low to high, never reordered
- **Sub-namespace**: `engineer/maintenance/upgrades/`

See `engineer/maintenance/upgrades/_context.md` for archetype-specific
patterns including per-topology upgrade strategies.

## Shared meta-anatomy — every maintenance routine has

These structural elements are universal across both archetypes
and all routines (current and future). The `_scaffold.md` files in
each sub-namespace codify these as templates.

1. **Phase 0 baseline establishment**
   - Different goals per archetype: reconnaissance for remediators,
     validation for upgraders ("don't upgrade on top of a broken
     project")
   - **Step 0.0: topology detection** runs first, before everything
     else (see "Topology detection" section below)

2. **Severity-classified inventory**
   - Remediators classify rules/findings as error/warn/info
   - Upgraders classify groupings by risk tier (low/medium/high)
   - Severity drives execution order

3. **Project-specific architectural context** where relevant
   - Routines that depend on project structure (atomic-design,
     component-dedup) document the structure they assume
   - Generic routines (biome, dep upgraders) read project config
     files for their context

4. **Phased execution with priority/risk ordering**
   - Phases are explicit and labeled
   - Order within phases is deterministic
   - Reordering risk tiers (in upgraders) or skipping reconnaissance
     (in remediators) is a guard rail violation

5. **One unit at a time**
   - Remediators: file batches of 20-30
   - Upgraders: one library-family grouping per cycle
   - Smaller units = easier rollback, better verification per change

6. **Verification between units**
   - Type check / compile after each batch or grouping
   - Build verification appropriate to the ecosystem
   - Tests run when scope warrants

7. **Final mandatory verification gate**
   - All routines end with a comprehensive gate before declaring
     completion
   - Specific gates vary by ecosystem (lint+tsc+build+e2e for npm
     remediators; mvn verify + JaCoCo for maven; terraform plan
     clean + actionlint for infra)
   - Skipping the gate is a guard rail violation

8. **Reporting structure**
   - Before/after counts or version diffs
   - List of completed units (commits)
   - List of skipped units with reasons
   - Outstanding follow-up items

9. **Failure tolerance**
   - 3-strike rule (remediation): if a batch fails verification 3
     times, document and defer
   - 3-retry rule (visual remediation): if visual diff fails 3
     retries, flag for manual review
   - Skip-and-document (upgrades): if a grouping doesn't resolve
     cleanly, skip it and continue with subsequent groupings
   - **Never auto-revert** — the user decides whether to revert

10. **Hard guard rails**
    - Project-specific don'ts (Next.js page/layout default exports,
      Spring Boot parent-managed deps, hashicorp/template provider,
      etc.)
    - Each routine documents its own; common ones are referenced in
      sub-namespace `_context.md`

11. **Idempotency**
    - Running the routine twice should be safe
    - Second run picks up new drift (remediation) or new outdated
      (upgrades) without redoing already-completed work

12. **Cross-routine awareness**
    - Composition contracts: atomic-design → dedup pipeline (called
      with `all` scope after relocations)
    - Strict isolation: gradle / maven / npm / infra upgraders
      never interleave (separate branches, separate PRs, different
      blast radii)

13. **Conventional commits**
    - Commit prefix derives from topology: `chore:` for
      single-package, `chore(<scope>):` for monorepo
    - One unit = one commit (with multi-module exceptions noted)

14. **`$ARGUMENTS` for scope narrowing**
    - Default behavior runs the whole scope
    - Argument narrows to a specific area, family, or module
    - Special argument `all` (when not the default) expands beyond
      default scope

## Topology detection — first-class pattern (Step 0.0)

Every maintenance routine begins with **Step 0.0: topology
detection**, before package-manager detection or any other Phase
0 work. Detection has two layers.

### Layer 1 — Outer: where is the ecosystem's project root in this repo?

The skillz suite is consumed across diverse repos: single-package
repos with `package.json` at root, monorepos with subdirectories,
polyglot repos where multiple ecosystems coexist. Routines must
discover where they apply rather than assuming root-level
placement.

```bash
# Maven project roots — pom.xml files where <parent> is absent or external
find . -maxdepth 4 -name "pom.xml" -not -path "*/node_modules/*" -not -path "*/target/*" \
  | while read pom; do
      grep -L '<parent>' "$pom" || true
    done

# Gradle project roots — settings.gradle or settings.gradle.kts
find . -maxdepth 4 \( -name "settings.gradle" -o -name "settings.gradle.kts" \) \
  -not -path "*/node_modules/*" -not -path "*/build/*"

# npm projects — package.json at root or conventional monorepo dirs
find . -maxdepth 4 -name "package.json" -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  | xargs grep -l '"name"' 2>/dev/null

# Terraform roots — .tf files in directories without parent .tf
find . -maxdepth 4 -name "*.tf" -type f | xargs dirname | sort -u

# Infrastructure tooling
find . -maxdepth 3 -name "Dockerfile*" -not -path "*/node_modules/*"
ls docker-compose*.yml 2>/dev/null
ls .github/workflows/*.y*ml 2>/dev/null
```

**Outer topology variations**:
- Single-ecosystem repo at root
- Single-ecosystem in subdirectory (e.g., backend-only with `services/pom.xml`)
- **Polyglot monorepo** — multiple ecosystems coexist
- Multiple independent reactors of the same ecosystem (rare;
  handled per-ecosystem)

When multiple roots exist for the same ecosystem (multiple Maven
reactors, multiple Gradle projects), routines treat each as
independent and never combine them in one upgrade session.

### Layer 2 — Inner: once project root is found, what's the topology within?

Inner topology is ecosystem-specific:

- **Maven**: parse parent POM `<module>` entries for reactor
  structure
- **Gradle**: parse `settings.gradle` `include` entries for
  multi-module
- **npm**: detect workspace declarations, `pnpm-workspace.yaml`,
  `nx.json`, `turbo.json`, `lerna.json`
- **Terraform**: identify all `.tf` files at the root level (no
  sub-directory traversal)

**Inner topologies (npm specifically)**:

```
single-package           workspaces                 workspace tool
├── package.json         ├── package.json (root,    ├── nx.json | turbo.json |
├── lockfile             │   declares workspaces)   │   rush.json | lerna.json
└── src/                 ├── lockfile (hoisted)     ├── workspace declarations
                         └── packages/ or apps/     └── tooling-specific commands
```

### Per-topology branching

Different topologies require different baseline-validation, build,
test, and rebuild logic. Each routine documents its
per-topology branching in its own file. Common npm-specific
example:

| Aspect | Single-package | Workspaces | Nx / Turborepo |
|--------|----------------|------------|----------------|
| Baseline build | `npm run build` | `npm run build --workspaces` | `nx run-many --target=build` / `turbo run build` |
| Outdated detection | One package.json | Per-workspace + root | Tooling-aggregated |
| Dependency chain | None | Topological scan | Tooling-provided graph |
| Phase 1.5 consumer verification | Skipped | Active | Use affected-graph |
| Multi-module mode (`all`) | No-op | Iterates workspaces | Iterates Nx projects / Turbo packages |
| Commit convention | `chore: ...` | `chore(<workspace>): ...` | `chore(<project>): ...` |

### Capturing topology in routine state

After Step 0.0 detection, routines record what they found:

```
Repository topology detected:
- Outer: polyglot monorepo
- Maven roots:  ./maven-dependency/pom.xml (reactor with 4 modules)
- Gradle roots: ./app-service/ (single-module Gradle project)
- npm projects: ./app-ui/package.json (single-package)
                ./npm-dependency/package.json (root)
                ./npm-dependency/* (workspaces declaration found)
- Terraform:    ./.infra/, ./.infra-shared/
- Infra tools:  Dockerfile, docker-compose*.yml, .github/workflows/

This routine targets: <ecosystem>
Project root(s):      <list>
Inner topology:       <single-module | reactor | workspaces | nx | turbo>
```

This output goes into the routine's report and any state files it
maintains. Other routines and orchestration workflows (e.g.
`engineer:polyglot-maintenance-cycle`) can read it.

## Skillz consumer model — agents and humans

Maintenance routines are **agent-friendly capabilities**. Multiple
consumers:

1. **Humans** running `/engineer:maintenance:remediation:biome-issues`
   directly in a terminal
2. **Claude Code sessions** helping humans through the routine
3. **Harness-core-powered agents**:
   - **Janitr** — maintenance planning agent; reads
     `.pencil-maintenance-calendar.json`, identifies what's due,
     dispatches to specific routines
   - **Bumpr** — fleet upgrade execution; consumes upgrade routines
   - **Verifly** — component-reactive testing; consumes verification
     routines (when implemented)
4. **Future agent orchestrators** stringing capabilities together

Each consumer interacts with the same commands. Commands don't
know who's calling — they read inputs (manifests, project
configs), produce structured outputs (JSON metadata + human-
readable reports), and compose with other commands.

This is why structured output formats matter for maintenance
routines specifically — they're consumed by both humans (who read
the report) and agents (who parse the JSON metadata).

## Cross-routine isolation rules

Sister routines within the same archetype have strict isolation
contracts:

### Upgrade routines never interleave

`gradle-deps` / `maven-deps` / `npm-deps` / `infra-deps` each run
on separate branches, separate PRs. Reasons:
- Different blast radii — JVM dep upgrade affecting backend differs
  from npm dep upgrade affecting frontend differs from Terraform
  upgrade affecting production
- Different review domains — JVM expert reviews JVM upgrades; FE
  expert reviews npm; SRE reviews infra
- Bisect cleanliness — when something breaks, narrowing to one
  ecosystem's branch is critical

The polyglot-maintenance-cycle workflow's state machine enforces
this — it won't start a sister upgrade routine until the current
one's branch is committed/PR'd.

### Remediation routines compose into pipelines

`atomic-design` → `component-dedup` is a documented pipeline:
atomic-design's relocations may introduce new duplicates that
dedup catches. atomic-design explicitly invokes dedup with `all`
scope after its relocations complete.

Other compositions emerge: lint cleanup → dead-code cleanup →
unused-deps cleanup is a natural sequence (lint surfaces unused
imports that dead-code detects, which surface unused deps).

When composition exists, the upstream routine documents it
explicitly with the invocation arguments to use.

## Naming conventions

### File slugs (within sub-namespaces)

Strip `-remediator` and `-upgrade` suffixes since the
sub-namespace folder conveys the archetype:

- `biome-issues-remediator.md` → `engineer/maintenance/remediation/biome-issues.md`
- `npm-deps-upgrade.md` → `engineer/maintenance/upgrades/npm-deps.md`

### Invocation paths

`/engineer:maintenance:<sub-namespace>:<slug>`:

- `/engineer:maintenance:remediation:biome-issues`
- `/engineer:maintenance:remediation:atomic-design`
- `/engineer:maintenance:remediation:component-dedup`
- `/engineer:maintenance:upgrades:npm-deps`
- `/engineer:maintenance:upgrades:gradle-deps`
- `/engineer:maintenance:upgrades:maven-deps`
- `/engineer:maintenance:upgrades:infra-deps`

### Workflow paths (in `engineer/maintenance/workflows/`)

`/workflows:manage start maintenance:<workflow-slug>`:

- `/workflows:manage start engineer:polyglot-maintenance-cycle`
- `/workflows:manage start engineer:maintenance-calendar-annual`

## Anti-patterns

- **Conflating maintenance with development** — refactoring for
  forward intent is development; refactoring for debt remediation
  is maintenance. The same code change can be either depending on
  why; the namespace placement reflects intent.
- **Routines that don't establish a baseline** — upgrade routines
  especially must verify the project is healthy before adding
  changes; remediating on top of broken state makes attribution
  impossible.
- **Routines that interleave with sister routines** — npm and
  gradle upgrades sharing a branch make bisect impossible when
  something breaks. Always separate.
- **Routines that auto-fix structural decisions** — atomic-design
  AD-5 (data fetching in core/) and AD-10 (duplicates) require
  human judgment about correctness. Auto-fixing produces wrong
  results.
- **Skipping topology detection** — assuming root-level placement
  works in single-package repos but breaks in monorepos. Always
  Step 0.0.
- **Routines that don't end with a final verification gate** —
  declaring completion without verifying the project still builds
  is how regressions ship.
- **Routines that auto-revert on failure** — never. User decides
  whether to revert. Routines flag and skip.

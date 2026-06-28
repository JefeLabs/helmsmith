# Upgrades — Sub-Namespace Context (`engineer/maintenance/upgrades/`)

> Read this in addition to `engineer/maintenance/_context.md`,
> `product/strategy/_context.md`, and the project's relevant build
> configuration (e.g., `pom.xml`, `build.gradle`, `package.json`,
> `*.tf`) whenever any `/engineer:maintenance:upgrades:*` command runs.
>
> This sub-namespace holds **dependency upgrade routines** —
> commands that advance version state of dependencies forward
> while preserving behavior. Distinct from remediation (which
> reduces drift in existing code) and from scans (detect-only
> routines, when added).

## What dependency upgrade is

Upgrade routines operate on **dependency manifests** and advance
versions forward. The manifests differ by ecosystem:

- **npm**: `package.json` + lockfile (`package-lock.json` /
  `pnpm-lock.yaml` / `yarn.lock`)
- **Gradle**: `build.gradle` + `gradle.properties` + version
  catalog (when used)
- **Maven**: `pom.xml` (parent + reactor modules)
- **Infrastructure**: `provider.tf` (Terraform), `Dockerfile`
  (base images), `.github/workflows/*.yml` (Actions),
  `docker-compose*.yml` (services)

The input is "what versions are currently pinned"; the output is
"newer versions, behavior verified preserved."

## Why upgrade is its own archetype

Upgrades differ structurally from remediation in important ways
(see `engineer/maintenance/remediation/_context.md` for the comparison
table). Key distinguishing properties:

### Risk-tiered grouping plan IS the routine's identity

Every upgrade routine sorts its work into risk tiers and
processes them low-to-high. This isn't a phase ordering
convenience — it's the structural reason the routine exists.

The naive alternative (`npm update` / `mvn versions:use-latest-releases` /
`./gradlew useLatestVersions`) bumps everything at once and
produces unreviewable changes that fail unpredictably. The
routine's value is **proceeding deliberately, one grouping at a
time, low risk first**.

Risk tiers are roughly:

- **Tier 1 — patches** (lowest risk): bug fixes only, no API
  changes. Type-only packages (`@types/*` patches), patch-only
  family bumps, standalone patches.
- **Tier 2 — minors** (low-medium risk): new features, possibly
  subtle changes. Dev tools, test libraries, build tools, UI
  components, SDKs, utilities.
- **Tier 3 — majors** (high risk): breaking changes expected.
  Dev tool majors, test framework majors, build tool majors,
  type system majors, UI framework majors, SDK majors, framework
  majors (React/Next/etc.).
- **Tier 4 — security remediation**: after all family groupings
  are done, re-audit and address remaining vulnerabilities.

**Reordering risk tiers is a guard rail violation** — it's the
entire point of the routine.

### Family groupings as scope unit

Within tiers, work is grouped by **library family** rather than
individual packages. Reasons:

- Related packages (`@storybook/*`, `@heroui/*`, `@tanstack/*`)
  must move together — bumping one without others creates peer
  dependency conflicts
- BOMs (Maven/Gradle) atomically manage many transitive versions
  — bumping the BOM cascades; pinning individual libs under it
  is wrong
- Framework ecosystems (React + react-dom + @types/react;
  Next + eslint-config-next) coordinate

Detection rules vary by ecosystem:
- **npm**: by scope (`@scope/*`) or shared prefix (`eslint-*`)
- **Gradle**: by GAV `group:artifact` prefix; BOM platforms
  recognized by name (Spring Boot, Spring Cloud, AWS SDK, etc.)
- **Maven**: by `groupId` prefix; `<dependencyManagement>` BOM
  imports recognized; Spring Boot parent inheritance recognized
- **Infrastructure**: by tool (Terraform, Actions, Docker, etc.)
  with sub-groupings within each

When a family grouping contains a mix of bump types (some patch,
one major), classify the **entire grouping** by its highest bump
type so it lands in the correct risk tier.

### Phase 0 baseline validation — "don't upgrade on top of broken"

Where remediators run reconnaissance in Phase 0 to find drift,
upgraders run **baseline validation** to confirm the project is
healthy before adding changes. Reasons:

- Upgrading on top of broken state makes attribution impossible
  ("did the upgrade break this, or was it already broken?")
- Reverting becomes harder when baseline was already failing
- Coverage/test gates can't be enforced if baseline is below
  threshold

The baseline validation runs:

- **Clean build / install** — works from scratch?
- **Compile / type-check** — no errors?
- **Tests** — unit + integration pass?
- **Coverage** — meets project's threshold? (e.g., 90% JaCoCo)
- **Build artifact** — production build succeeds?

If baseline is broken, the routine **stops immediately** and
reports the failure to the user. The user fixes the baseline
(usually via a remediator), then re-runs the upgrader.

This is why upgraders should run AFTER remediators in a
maintenance cycle — clean baseline first, then dependency
advancement.

### One grouping, one commit (with reactor exceptions)

The atomic unit is "one library family grouping bumped + verified
+ committed." Reasons:

- Bisect cleanliness — when something breaks weeks later,
  narrowing to a single family is critical
- Review domain — different reviewers for different families
- Rollback clarity — reverting one commit reverts one family

**Exception**: Maven reactors. Parent POM property edits touch
all modules at once; the commit unit is "one family grouping
across the reactor" rather than "one family grouping per module."
Gradle multi-module commits per-module-per-grouping (the more
common pattern); Maven's reactor model is the exception.

### Constraint / version-style preservation

Upgraders preserve the project's existing version-pinning style:

- If `package.json` uses caret ranges (`^1.2.3`), keep caret
  ranges
- If `pom.xml` uses `<properties>` with `<foo.version>` and
  references via `${foo.version}`, keep that style — don't inline
  hard-coded versions in `<dependency>`
- If `build.gradle` uses `gradle.properties` variables
  (`foo_version=1.2.3`) and references via `${foo_version}`, keep
  that style
- If Terraform `required_providers` uses `~> 6.0` (pessimistic
  operator), keep pessimistic; don't pin to exact

Style-changing is a separate concern from version-bumping. If
the team wants to switch styles, that's its own task.

### Skip prereleases unless project already uses them

Alpha / beta / rc / milestone versions are skipped by default.
Reasons:

- Production-running projects shouldn't depend on prereleases
- Prereleases churn (a v2.0.0-rc.1 may be replaced by v2.0.0-rc.2
  before stable)
- The latest stable is the upgrade target, not the latest version

Per-ecosystem flags:

- **npm**: skip versions matching `-alpha`, `-beta`, `-rc`,
  `-canary`, `-next`
- **Maven**: pass `-DallowMilestoneUpdates=false -DallowSnapshots=false`
  to versions-maven-plugin
- **Gradle**: ben-manes versions plugin's default behavior
- **Terraform**: registry queries return only stable releases by
  default

Override only when the project already uses prereleases for that
specific package.

### Don't cross language-version line

Upgrading the language/runtime version is **never** combined with
dependency upgrades. Separate ticket. Examples:

- **Java**: `java_version` in `gradle.properties` /
  `<java.version>` in `pom.xml` — separate migration
- **Node**: `.nvmrc` / `engines.node` in package.json — separate
- **Terraform core**: `required_version` in `provider.tf` —
  separate (and CI's `setup-terraform` action pin must coordinate)

Reasons: language version bumps cascade to many dependencies'
compatibility; mixing creates unbounded scope and unclear failure
attribution.

### Security scan integration

When the project has security scanning configured (OWASP
dependency-check for Maven/Gradle, `npm audit`, Snyk integration,
CycloneDX SBOM), the upgrader runs the scan and incorporates
findings:

- **Vulnerabilities elevate the affected grouping by ONE tier**
  (a Tier 2 grouping with critical vulns becomes Tier 1)
- **Vulns never jump the queue entirely** — a critical vuln in a
  Tier 3 (major-bump) grouping doesn't become Tier 1
- **Tier 4 — Security Remediation** is the catch-all for vulns
  not resolved by family groupings; runs after all groupings
  complete

This balances "address security promptly" with "don't violate the
risk-tier discipline that prevents upgrades from breaking the
project."

### Strict non-interleaving with sister upgrade routines

The most important upgrade-archetype rule:
**never interleave sister upgrade routines**.

`gradle-deps` / `maven-deps` / `npm-deps` / `infra-deps` each run:

- On separate branches (`chore/gradle-deps-upgrade-<date>`,
  `chore/npm-deps-upgrade-<date>`, etc.)
- In separate PRs
- Without sharing commits

Reasons:

- **Different blast radii** — JVM upgrade affects backend; npm
  affects frontend; infra affects production. One PR mixing them
  creates review confusion and rollback ambiguity.
- **Different reviewers** — JVM expert reviews JVM upgrades; FE
  expert reviews npm; SRE reviews infra. Mixing forces all
  reviewers on every PR.
- **Different cadences** — npm patches monthly might fit a
  cadence that gradle quarterly bumps don't.
- **Different verification gates** — Maven's `mvn verify` differs
  from npm's `npm run build && npm test`.

The polyglot-maintenance-cycle workflow's state machine enforces
this: it won't start a sister upgrade routine until the current
one's branch is committed/PR'd.

### Rollback as normal

When a grouping doesn't resolve cleanly:

- **Don't force it** — auto-revert isn't appropriate; user
  decides whether to revert
- **Skip and document** — note the grouping in the report with the
  reason (e.g., "Spring Boot 3.5 → 3.6: TenantResolver
  auto-config regression; needs dedicated migration PR")
- **Continue with subsequent groupings** — one skipped grouping
  doesn't block the rest of the upgrade run
- **Skipped groupings become follow-up tickets** — the report
  drives ticket creation for dedicated migration work

Sometimes "skip" is the right answer permanently — `hashicorp/template`
is deprecated, not actually upgradeable; it gets flagged for
migration to `templatefile()` rather than version-bumping.

### Per-topology branching (the operational layer)

Topology detection (Step 0.0, see `engineer/maintenance/_context.md`)
classifies the project. Per-topology branching translates that
classification into specific commands:

#### npm topology branches

| Aspect | Single-package | Workspaces (npm/pnpm/yarn) | Workspace tool (Nx/Turbo) |
|--------|----------------|----------------------------|----------------------------|
| Baseline build | `npm run build` | `npm run build --workspaces` / `pnpm -r build` | `nx run-many --target=build` / `turbo run build` |
| Outdated detection | One `npm outdated` | Per-workspace + root | Tooling-aggregated |
| Dependency chain | None | Topological scan | Tooling-provided graph |
| Phase 1.5 consumer verification | Skipped | Active for workspace consumers | Use affected-graph |
| Multi-module mode (`all`) | No-op (= scoped) | Iterates workspaces | Iterates Nx projects / Turbo packages |
| Commit convention | `chore: ...` | `chore(<workspace>): ...` | `chore(<project>): ...` |

#### Gradle topology branches

| Aspect | Single-module | Multi-module |
|--------|---------------|---------------|
| Baseline | `./gradlew clean build -x test` | Same; `settings.gradle` parsed for module list |
| Test gate | `./gradlew check` | Same; reactor-wide |
| Outdated detection | `./gradlew dependencyUpdates` | Same; aggregated |
| Multi-module mode (`all`) | Same as single | Iterates modules per grouping |
| Commit convention | `chore: ...` | `chore(<module>): ...` per module per grouping |

#### Maven topology branches

| Aspect | Single-module | Reactor (multi-module) |
|--------|---------------|------------------------|
| Baseline | `./mvnw verify` | Same; reactor-wide |
| Outdated detection | Versions plugin reports | Same; aggregated reactor-wide |
| Property edits | One `pom.xml` | Parent POM property; cascades to reactor |
| Multi-module mode (`all`) | Same as single | One commit per grouping (reactor-wide), not per-module |
| Commit convention | `chore: ...` | `chore(<reactor>): ...` for reactor-wide; `chore(<module>): ...` only when edit is module-confined |

#### Infrastructure topology branches

Infra is multi-tool by nature; argument selector (`terraform |
localstack | actions | docker | all`) narrows scope. Per-tool
branches:

| Tool | Detection | Verification |
|------|-----------|--------------|
| Terraform | `*.tf` files in directories | `fmt -check + validate + plan -detailed-exitcode` |
| LocalStack | `localstack-pro` in docker-compose | `docker compose config + start + health check` |
| GitHub Actions | `.github/workflows/*.yml` | `actionlint` (when available) + tag resolution check |
| Docker base | `Dockerfile` `FROM` lines | Dry-build first stage |

Multi-root Terraform (e.g., `.infra/` + `.infra-shared/`) must
move together — provider bump needs clean plan in BOTH roots
before commit. Single grouping touches both roots' `provider.tf`.

### Multi-module / multi-root coordination

Where ecosystems support multi-module structure (Gradle reactor,
Maven reactor, npm workspaces, Nx projects, Terraform multi-root),
upgrade routines coordinate across modules:

- **Detection layer**: list all modules from the canonical config
  (`settings.gradle`, parent `pom.xml`, `package.json` workspaces,
  `nx.json`, etc.)
- **Cross-module grouping plan**: families that appear in multiple
  modules become a single logical grouping that's executed
  module-by-module
- **Per-module gating**: each module's verification runs
  independently
- **Failure isolation**: if one module fails a grouping, skip it
  for that module only; other modules in the grouping continue
  (Maven exception: failing module gets pinned via explicit
  `<dependency>` override OR the whole grouping reverts; user
  decides)
- **Commit conventions** (per-ecosystem; see tables above)

## Cross-routine isolation contract

Sister upgrade routines NEVER share a branch, NEVER share a PR,
NEVER co-locate commits in the same session.

The polyglot-maintenance-cycle workflow's state machine enforces
this:
- Detects which sister branch is currently open
- Won't start the next routine until current is committed/PR'd
- Surfaces violations as workflow errors

When running upgraders manually (without the cycle workflow),
the convention is the same — the routines themselves document
the rule and refuse to proceed if a sister routine's branch is
dirty.

## Final verification gate

Every upgrade routine ends with a comprehensive gate:

| Step | Verification |
|------|--------------|
| Re-run baseline | Build + tests + coverage at or above pre-upgrade levels |
| Re-run outdated | Fewer (ideally zero) outdated dependencies |
| Re-run security scan | Fewer (ideally zero) vulnerabilities |
| Verification gate per ecosystem | npm: `npm run build && npm test && npx tsc --noEmit`; Gradle: `./gradlew check`; Maven: `./mvnw verify`; Infra: `fmt + validate + plan + actionlint + Dockerfile build` |

The gate output goes into the routine's report alongside before/
after pin diffs.

## Anti-patterns specific to upgrades

- **Reordering risk tiers** — the low-to-high order is the
  routine's identity. Never reorder.
- **Mixing language-version bumps with dependency upgrades** —
  separate tickets. Always.
- **Auto-running `audit fix --force` (npm) / `versions:use-latest-releases` (Maven)
  / `./gradlew useLatestVersions` (Gradle)** — these ignore semver
  and break things silently. Never use.
- **`--force` / `--legacy-peer-deps` (npm) / `resolutionStrategy { force(...) }` (Gradle)**
  as shortcuts to sidestep peer conflicts — resolve the root
  cause instead.
- **Pinning under a BOM-managed dep** — bumping the BOM is the
  correct lever; explicitly pinning a lib that the BOM/parent
  manages is almost always wrong.
- **Combining sister upgraders in one branch/PR** — different
  blast radii; bisect impossible. Always separate.
- **Skipping baseline validation** — upgrading on top of broken
  state makes attribution impossible.
- **Skipping the final verification gate** — declaring completion
  without verifying is how regressions ship.
- **Auto-revert on failure** — never. Skip the grouping; document;
  user decides about revert.
- **Co-locating multiple groupings in one commit** — bisect
  ambiguity. One grouping = one commit (Maven reactor exception
  noted above).

## Routines in this sub-namespace

4 routines currently (Edwin's existing files, suite-fitted):

- **`gradle-deps`** — JVM/Spring Boot via Gradle; BOM-aware
  family groupings; 90% JaCoCo coverage gate; multi-module via
  `settings.gradle`
- **`maven-deps`** — JVM/Spring Boot via Maven; parent-POM
  inheritance + 4 versions-plugin reports; reactor-wide commits;
  `<annotationProcessorPaths>` watch
- **`infra-deps`** — Terraform + LocalStack + GH Actions + Docker;
  `plan` as gate; tag-pinning rule; license-tier verification;
  context7 MCP for major migrations
- **`npm-deps`** — JavaScript/TypeScript; package manager
  detection (npm/pnpm/yarn); 9-tier major bump ordering; full
  topology generalization (single-package + workspaces + Nx +
  Turborepo); component pattern change detection; CJS interop
  check

Future routines (placeholder gaps to fill):
- `cargo-deps` — Rust dependencies
- `pip-deps` / `poetry-deps` / `uv-deps` — Python
- `helm-charts` — Kubernetes Helm chart upgrades
- `container-images` — base image updates beyond Dockerfile
- `submodules` — git submodule version updates

## Scaffold for new upgraders

When adding a new upgrader, see `_scaffold.md` (TBD — to be
written when first new routine is added) for the template
structure. The scaffold codifies the meta-anatomy + upgrade
archetype patterns into a fill-in-the-blanks template.

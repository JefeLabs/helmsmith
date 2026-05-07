---
type: upgrader
description: Tactfully upgrade JVM (Gradle) dependencies by library-family groupings, proceeding from lowest to highest risk. Upgrade one grouping at a time, fully resolve all issues (compile, unit + integration tests, JaCoCo coverage, quality checks) before moving to the next.
argument-hint: [<module-path> | all]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/upgrades/_context.md` (upgrade
> archetype patterns + per-topology branching), `product/strategy/_context.md`.
>
> This is the Gradle counterpart to
> `/engineer:maintenance:upgrades:maven-deps` and
> `/engineer:maintenance:upgrades:npm-deps`. Same principles, same rigor,
> adapted to Gradle + Spring Boot semantics.

Tactfully upgrade JVM (Gradle) dependencies by **library-family
groupings**, proceeding from lowest risk to highest. Upgrade one
grouping at a time, fully resolve all issues (compile, unit +
integration tests, JaCoCo coverage, quality checks) before moving
to the next. Never blindly `./gradlew useLatestVersions` or edit
`gradle.properties` in bulk.

**Invoke with:** `/engineer:maintenance:upgrades:gradle-deps` + optional
argument:

- **Single module path:** `/engineer:maintenance:upgrades:gradle-deps app-service`
- **All modules:** `/engineer:maintenance:upgrades:gradle-deps all`
- **No argument:** defaults to `all` — upgrades every Gradle
  module in the project

## Step 0.0 — Topology detection (outer + inner)

### Outer: where are the Gradle project root(s)?

Edwin's prior version assumed Gradle at the repo root. The
suite-fit version discovers Gradle project roots dynamically:

```bash
# Find Gradle project roots (settings.gradle or settings.gradle.kts)
find . -maxdepth 4 \( -name "settings.gradle" -o -name "settings.gradle.kts" \) \
  -not -path "*/node_modules/*" -not -path "*/build/*" \
  | xargs -n1 dirname 2>/dev/null
```

**Outer topology variations**:

- **Single Gradle project at repo root**: `./settings.gradle`
- **Single Gradle project in subdirectory**: `./<subdir>/settings.gradle`
  (e.g., backend-only repo with `./services/settings.gradle`)
- **Multiple independent Gradle projects**: rare; treat each as
  its own upgrade session, never combine

If multiple Gradle roots are found, prompt the user to pick one or
process sequentially with separate branches per root.

### Inner: single-module vs multi-module reactor?

Once the Gradle root is identified, parse `settings.gradle` for
multi-module structure:

```bash
GRADLE_ROOT=<detected from outer>
cd "$GRADLE_ROOT"

# Parse module declarations
grep -E "^include\s" settings.gradle | sed "s/include\s*['\"]:\?//; s/['\"].*//"
```

**Inner topology variations**:

- **Single-module**: only the root module; no `include` statements
- **Multi-module reactor**: `include 'module-a'`, `include 'module-b'`, etc.

Detection output:

```
Gradle project detected:
- Root:   <path>
- Type:   <single-module | multi-module>
- Modules: <list when multi-module>

Targeting: <user-selected module or "all">
```

## Principles

1. **Group by family.** Upgrade related libraries together
   (`org.springframework.*`, `com.fasterxml.jackson.*`,
   `software.amazon.awssdk:*`, `org.junit.jupiter.*`).
2. **Low-to-high risk, always.** Process groupings in strict risk
   order — never jump ahead.
3. **Resolve before advancing.** Every grouping must compile, pass
   `./gradlew check` (unit + integration), and maintain coverage
   threshold (project-specific; commonly 90% JaCoCo per
   `<project>/CLAUDE.md`'s definition-of-done) before touching the
   next grouping.
4. **One commit per grouping.** Clean git history for easy bisect.
5. **Respect BOM management.** Spring Boot's
   `io.spring.dependency-management` plugin centrally manages the
   versions of dozens of transitive libraries. If a library's
   version is controlled by a BOM (Spring Boot, Spring Cloud, AWS
   SDK, Testcontainers, Jackson, JUnit, Netty, HttpClient5,
   HttpComponents), **do not pin it explicitly** — bump the BOM
   instead. Comments in `gradle.properties` like
   `# Let Spring Boot manage flyway version (11.7.2)` mark managed
   versions.
6. **Preserve version variable style.** If the project declares
   versions in `gradle.properties` as `foo_version=1.2.3` and
   references them in `build.gradle` via `${foo_version}`,
   maintain that style — don't inline hard-coded versions in
   `build.gradle`.
7. **Don't cross the Java line.** Upgrading the Java
   language/runtime version (`java_version` in
   `gradle.properties`) is NEVER combined with dep upgrades.
   That's a separate ticket.

## Phase 0: Reconnaissance

### 0.1 Detect Gradle and inventory modules

(Done in Step 0.0. Capture the module list.)

```bash
cd "$GRADLE_ROOT"
./gradlew --version 2>&1 | head -15
cat settings.gradle
```

Verify the wrapper is present and executable (`./gradlew`). If
missing, stop and ask the user — never fall back to a system
`gradle`.

### 0.2 Validate Baseline

Before any upgrades, confirm the project is currently healthy.
**Do not upgrade on top of a broken project.**

#### Clean build

```bash
cd "$GRADLE_ROOT"
./gradlew clean build -x test 2>&1 | tail -40
```

`-x test` skips tests during the baseline build to fail fast on
compile errors. Tests run in the next step.

#### Unit + integration tests (`check`)

```bash
./gradlew check 2>&1 | tail -60
```

`check` runs tests + any configured quality tasks (JaCoCo
verification, spotbugs, etc.). Capture the full summary.

#### JaCoCo coverage

```bash
./gradlew jacocoTestReport 2>&1 | tail -20
# Then read the report
find . -path '*/build/reports/jacoco*/index.html' 2>/dev/null | head
```

Record the baseline coverage percentage (line coverage, branch
coverage). **The project's definition-of-done threshold** is
typically declared in `CLAUDE.md` or similar (commonly 90% for
unit + integration). If the baseline is already below threshold,
stop and surface this to the user — upgrading on top of a failing
coverage gate will make attribution impossible.

#### Dependency tree (sanity)

```bash
./gradlew <module>:dependencies --configuration runtimeClasspath 2>&1 | head -200
```

Optional but useful — catches structural oddities (duplicate libs
on different classpaths, unexpected version selections) before
upgrades start.

#### Baseline Snapshot

Record all results before proceeding:

```
Baseline (<module>):
- ./gradlew clean build -x test: PASS/FAIL
- ./gradlew check: X tests, Y passed, Z failed
- JaCoCo line coverage:   XX.X%  (threshold: 90%)
- JaCoCo branch coverage: XX.X%
- Baseline commit: <sha>
```

**If baseline is broken:** Stop immediately. Report the failure to
the user. Do not upgrade on top of a broken project.

### 0.3 Collect Outdated Dependencies

The `com.github.ben-manes.versions` plugin should be applied. Use
it:

```bash
./gradlew dependencyUpdates -Drevision=release 2>&1 | tail -80
```

This emits a report at `build/dependencyUpdates/report.txt`
listing:

- The current version of each resolvable dependency
- The latest release version available
- Dependencies that are already up to date
- Dependencies whose version couldn't be resolved (flag these —
  they may indicate registry auth issues)

Read the `report.txt` and capture every "exceeded version" entry.
These are your upgrade candidates.

For Gradle **plugins**, the ben-manes plugin reports them
separately. Don't miss them — plugin upgrades are just as
important as library upgrades, and majors can be breaking
(e.g. Spring Boot plugin 3.x → 4.x).

### 0.4 Check Security Vulnerabilities

If the project has the OWASP `dependency-check` plugin or
`CycloneDX` SBOM plugin configured:

```bash
# OWASP dep check (if plugin applied)
./gradlew dependencyCheckAnalyze 2>&1 | tail -30

# CycloneDX SBOM (if applied as org.cyclonedx.bom)
./gradlew cyclonedxBom 2>&1 | tail -20
```

Note critical/high severity issues — these get flagged in the
plan but do NOT jump the queue. Security and version-upgrade
tiering interact: a vulnerable lib gets its grouping elevated one
tier, but not above its natural risk tier.

If neither plugin is configured, skip this step and note it in the
final report as a suggested follow-up.

### 0.5 Identify BOM-Managed vs. Explicitly-Pinned

This step is JVM-specific and critical. For every outdated dep,
classify:

| Type | How to identify | Upgrade strategy |
|---|---|---|
| **BOM-managed** | Version is omitted in `build.gradle` (e.g., `implementation "org.springframework.boot:spring-boot-starter-web"`), OR a comment in `gradle.properties` says "Let X manage Y" | Bump the BOM, never pin the individual library |
| **Explicitly pinned via `gradle.properties`** | `foo_version=1.2.3` in `gradle.properties`, referenced as `${foo_version}` in `build.gradle` | Bump the variable in `gradle.properties` |
| **Inlined in `build.gradle`** | `implementation "com.nimbusds:nimbus-jose-jwt:9.37.3"` (hard-coded version string) | Bump the inline version and, as cleanup, consider moving it to `gradle.properties` — but only as a separate commit, never mixed with the version bump |

For BOM-managed deps, bumping the BOM atomically cascades to all
its managed versions. This is an **advantage** — BOM releases are
internally version-consistent — but also a **risk amplifier**
because one bump affects many transitive versions.

### 0.6 Build the Grouping Plan

Analyze dep GAVs (`group:artifact:version`) and organize into
**family groupings** by `group` (and for split projects, by
`group + common artifact prefix`):

**Auto-detect groupings by these rules (in priority order)**:

1. **BOM platforms** — each BOM is its own atomic grouping:
   - `org.springframework.boot:spring-boot-dependencies` (Spring Boot BOM)
   - `org.springframework.cloud:spring-cloud-dependencies` (Spring Cloud BOM)
   - `software.amazon.awssdk:bom` (AWS SDK v2 BOM)
   - `org.testcontainers:testcontainers-bom`
   - `com.fasterxml.jackson:jackson-bom`
   - `org.junit:junit-bom`
   - `io.netty:netty-bom`
   - `org.apache.httpcomponents.client5:httpclient5-parent`
   - `org.apache.httpcomponents:httpcomponents-parent`

2. **Spring family** (when not BOM-managed) — group `org.springframework.*`
3. **Test framework families** — `org.junit.*`, `org.testcontainers.*`,
   `org.mockito.*`, `io.rest-assured.*`, `org.assertj.*`
4. **AWS SDK family** — `software.amazon.awssdk.*`
5. **Logging family** — `org.slf4j.*`, `ch.qos.logback.*`,
   `org.apache.logging.log4j.*`
6. **Jackson family** — `com.fasterxml.jackson.*`
7. **Apache HttpComponents** — `org.apache.httpcomponents.client5.*`,
   `org.apache.httpcomponents.*`
8. **Netty** — `io.netty.*`
9. **Database drivers** — `org.postgresql.*`, `mysql:mysql-connector-java`,
   `com.oracle.database.*`, `com.h2database.*`
10. **Build tools / plugins** — `com.github.ben-manes.versions`,
    `io.spring.dependency-management`, `org.flywaydb`,
    `org.liquibase`, `com.diffplug.spotless`, `com.adarshr.test-logger`
11. **Lombok** (special — annotation processor; needs JDK
    compatibility check)
12. **Standalone packages** — everything else, grouped by `group`
    or as singletons

### 0.7 Sort Groupings into Execution Order

**This is mandatory. Always execute in this exact order.** Do not
rearrange, do not skip ahead. If a grouping is empty (no outdated
packages match), skip it silently and proceed to the next.

#### Tier 1 — Patch Only (Lowest Risk)

| Order | Category | What matches |
|-------|----------|--------------|
| 1.1 | JUnit / test framework patches | Patch-only on test libs |
| 1.2 | Plugin patches | `com.github.ben-manes.versions`, `io.spring.dependency-management`, etc. patches |
| 1.3 | Logging patches | `org.slf4j.*`, `ch.qos.logback.*` patches |
| 1.4 | Standalone patches | Individual packages with patch bumps |

#### Tier 2 — Minor Bumps (Low-Medium Risk)

| Order | Category | What matches |
|-------|----------|--------------|
| 2.1 | Test framework families (minor) | JUnit BOM minor, Testcontainers BOM minor, Mockito minor |
| 2.2 | Build tool families (minor) | Plugin minors, spotless, test-logger |
| 2.3 | Jackson family (minor) | `com.fasterxml.jackson.*` minor (often via BOM) |
| 2.4 | AWS SDK BOM minor | Bumps AWS SDK BOM; cascades to all `software.amazon.awssdk.*` |
| 2.5 | Netty / HttpComponents (minor) | Network library minors |
| 2.6 | Database driver minors | PostgreSQL, MySQL, H2, etc. |
| 2.7 | Spring Cloud BOM minor | When applicable |
| 2.8 | Standalone minors | Individual packages with minor bumps |

#### Tier 3 — Major Bumps (High Risk)

**Major bumps require extra reconnaissance before installation.**

| Order | Category | What matches | Why high risk |
|-------|----------|--------------|---------------|
| 3.1 | Test framework majors | JUnit major, Testcontainers major | Test rewrites possible |
| 3.2 | Build tool majors | Plugin majors | Config/API changes |
| 3.3 | Jackson major | `jackson-bom` major | API breaking; impacts every JSON serialization |
| 3.4 | AWS SDK major | AWS SDK v2 → v3 if it ever happens | API contract changes |
| 3.5 | Netty / HttpComponents majors | Network library majors |
| 3.6 | Spring Cloud major | When applicable | Spring framework realignment |
| 3.7 | Lombok major | Possible source-incompatible changes | Annotation processor |
| 3.8 | Apache HttpClient major | Network protocol behavior |
| 3.9 | Database driver majors | Driver protocol changes |
| 3.10 | Hibernate/JPA majors | When applicable |
| 3.11 | Logging framework majors | Log format / config changes |
| 3.12 | Spring Boot major | `spring-boot-dependencies` BOM major | Highest blast radius — cascades to ~100 transitive versions; auto-config changes |
| 3.13 | Other majors | Anything else | Case-by-case |

#### Tier 4 — Security Remediation (After All Tiers)

Re-audit after all upgrades. Fix remaining vulnerabilities using
the same grouping + gate cycle.

### 0.8 Present the Grouping Plan

Before making ANY changes, present the sorted plan as a numbered
checklist showing tier, grouping name, package count, and bump
types. Mark any security-flagged packages with a warning icon.

## Phase 1: Execute Groupings (in tier order)

For each grouping in tier order:

### Step 1 — Update version

Edit `gradle.properties` (for property-managed) or `build.gradle`
(for inlined) or BOM declarations. Preserve version-variable style
(don't move from `${foo_version}` to inline unless it's a separate
cleanup commit).

### Step 2 — Compile

```bash
./gradlew clean compileJava 2>&1 | tail -30
```

Resolve any compile errors before proceeding. If errors are
breaking-change-related (renamed classes, removed methods),
either:

1. Apply the migration (preferred when straightforward)
2. Skip this grouping and document as a major-migration follow-up

### Step 3 — Test

```bash
./gradlew check 2>&1 | tail -60
```

Resolve test failures. Same options as above.

### Step 4 — Coverage

```bash
./gradlew jacocoTestReport 2>&1 | tail -20
# Verify coverage hasn't regressed
```

If coverage drops below threshold, the grouping introduced
untested behavior changes. Either add tests OR skip.

### Step 5 — Security re-check (when applicable)

```bash
./gradlew dependencyCheckAnalyze 2>&1 | tail -30
```

Note any new vulns introduced (rare, but possible — newer version
of A may pull in vulnerable B).

### Step 6 — Commit

```
chore(<module>): upgrade <grouping-name>

<library>: <old> → <new>
<library>: <old> → <new>
...

Validation:
- ./gradlew check:        PASS (X tests)
- JaCoCo coverage:        line XX.X% / branch XX.X%
- Vulns introduced:       <none|N>
```

For multi-module projects, commit per-module-per-grouping (Gradle
convention; differs from Maven's reactor-wide commit pattern).
For shared `gradle.properties` edits affecting all modules, use
`chore: upgrade <grouping>` (no module scope) and verify every
module in the same commit's gate.

### Step 7 — Advance

Automatically proceed to the next grouping.

## Major Bump Pre-Flight (Tier 3 only)

Before any Tier 3 major bump:

### Fetch Migration Guide via context7

```
mcp__context7__resolve-library-id → "spring-boot" | "jackson-databind" | etc.
mcp__context7__query-docs → "<library> migration v<old> to v<new>"
```

Key things to extract:

- Removed/renamed classes
- Method signature changes
- Default behavior changes
- New required configuration
- Deprecation warnings to address

### Check Gradle Wrapper Compatibility

Some Spring Boot majors require newer Gradle:

| Spring Boot | Min Gradle |
|-------------|------------|
| 3.0.x       | 7.5 / 8.0  |
| 3.2.x       | 7.6.4 / 8.4 |
| 3.5.x       | 7.6.4 / 8.4 |
| 4.0.x (when released) | TBD, likely 8.x |

If `gradle/wrapper/gradle-wrapper.properties` is on a version below
the minimum, bump it as a SEPARATE commit before the Spring Boot
bump.

### Verify No Source-Incompatible Lombok Changes

Lombok has historically broken on JDK major bumps. If the same
grouping bumps JDK AND Lombok, split them — test Lombok against
the current JDK first, then bump JDK separately.

## Phase 2: Security Remediation

After all family groupings are done, re-run the security scan:

```bash
./gradlew dependencyCheckAnalyze 2>&1 | tail -30
# or
./gradlew cyclonedxBom && # inspect the generated SBOM for vulns
```

If vulnerabilities remain that weren't resolved by the grouping
upgrades:

- If the fix is a patch/minor within an already-upgraded package:
  apply it directly with the same gate cycle.
- If the fix requires a major bump: treat it as a single-package
  grouping and run the full Step 1-7 cycle.
- **Never blindly accept `./gradlew dependencyCheckUpdate`
  suggestions without reviewing the diff.**
- For vulns with no available fix (CVE open but no patched
  version), document them in the final report with a severity +
  exploit-context note.

## Phase 3: Final Verification

Run the full gate one last time against the final state:

```bash
./gradlew clean build check jacocoTestReport 2>&1 | tail -60
./gradlew dependencyUpdates -Drevision=release 2>&1 | tail -40
./gradlew dependencyCheckAnalyze 2>&1 | tail -30  # if plugin is configured
```

Compare before/after:

- `dependencyUpdates` should show fewer (ideally zero) outdated
- `dependencyCheckAnalyze` should show fewer (ideally zero)
  vulnerabilities
- JaCoCo coverage should be at or above threshold

## Phase 4: Report

Present the final summary:

```
## Gradle Dependency Upgrade Report for <module-name>

### Completed Groupings (in execution order)
| # | Tier | Grouping | Libraries | Status |
|---|------|----------|-----------|--------|
| 1 | 1.1 | JUnit patches     | 3 | DONE |
| 2 | 1.3 | Logback + SLF4J   | 2 | DONE |
| 3 | 2.4 | AWS SDK BOM minor | 1 (cascades many) | DONE |
| 4 | 3.12| Spring Boot BOM   | 1 (cascades ~100) | SKIPPED — auto-config regression in TenantResolver |
...

### Skipped / Pinned
| Grouping | Reason |
|----------|--------|
| Spring Boot 3.5.9 → 3.6.0 | TenantResolver auto-config failed to load after bump; needs dedicated migration PR |

### Security
- Vulnerabilities before: X
- Vulnerabilities after:  Y
- Remaining: <details, CVE IDs, severity, exploit context>

### Coverage
- Before: line XX.X% / branch XX.X%
- After:  line XX.X% / branch XX.X%
- Threshold (project definition-of-done): 90%

### Final Gate
- compileJava:            PASS / FAIL
- test:                   PASS / FAIL (X passed, Y failed)
- check (incl. integration): PASS / FAIL
- jacoco verification:    PASS / FAIL
```

## Multi-Module Mode (`all`)

When the user specifies `all` instead of a single module path, OR
omits the argument:

1. **Detect all Gradle modules** — parse `settings.gradle` for
   `include '...'` entries. Include the root build as its own
   module if it declares direct dependencies.
2. **Run Phase 0 for every module** — collect outdated lists across
   all modules (ben-manes versions plugin aggregates per-module
   natively when applied to each module).
3. **Build a cross-module grouping plan** — families that appear
   in multiple modules (e.g., Jackson BOM in several services)
   become a single grouping executed module-by-module. Shared
   `gradle.properties` variables become one edit that affects all
   modules simultaneously.
4. **Execute in risk order across all modules** — for each grouping
   in the sorted list, apply it to every affected module, gating
   each module independently.
5. **If one module fails a grouping, skip it for that module only**
   — other modules in the same grouping continue.
6. **Commit per module per grouping** —
   `chore(<module>): upgrade Jackson BOM 2.18 → 2.19` as a separate
   commit from any other module's Jackson bump. For shared
   `gradle.properties` edits affecting all modules, use
   `chore: upgrade Jackson BOM 2.18 → 2.19` (no scope) and verify
   every affected module in the same commit's gate.

For a single-module project, `all` is equivalent to the single
module's name. The command handles future growth automatically.

## Guard Rails

- **Never blindly bump `java_version`** — it's a separate
  migration.
- **Never override a BOM-managed version** to pin it explicitly
  without a documented reason. If Spring Boot manages Flyway's
  version and you want a newer Flyway, bump Spring Boot — don't
  pin Flyway in `gradle.properties` to override.
- **Never use `resolutionStrategy { force(...) }`** as a shortcut
  to sidestep a dep conflict — resolve the root cause instead.
- **Never skip `check`** — running only `test` misses integration
  tests and coverage verification.
- **Watch `gradle/wrapper/gradle-wrapper.properties`** — don't
  upgrade to a dep version that requires a newer Gradle than the
  wrapper pins, unless you ALSO bump the wrapper in the same
  commit. (`./gradlew wrapper --gradle-version=<version>`)
- **Respect `configurations.all { resolutionStrategy { ... } }`**
  blocks — understand why any `force`, `dependencySubstitution`,
  or `eachDependency` rules exist before touching them.
- **Respect `dependency-management { imports { mavenBom ... } }`**
  — bumping a BOM is the correct lever; pinning individual libs
  from a BOM is almost always wrong.
- **Watch JVM bytecode version** — libraries compiled for a newer
  JDK target than the project's `java_version` will fail at
  compile time. Check `sourceCompatibility` /
  `targetCompatibility` and the library's announced JDK target
  before bumping.
- **Plugin version variables are versions too** —
  `versions_plugin_version`, `gradle_docker_plugin_version`, etc.
  in `gradle.properties` must be upgraded via the same
  grouping-and-gate process.
- **One grouping, one commit** — never combine multiple groupings
  in a single commit.
- **Rollback is normal** — if a grouping can't be cleanly
  resolved, skip it. Report it. Don't force it.
- **Never reorder the risk tiers** — the low-to-high order is the
  entire point of this routine.
- **Skip alpha/beta/rc versions** — unless the project already
  uses prereleases for that library, never upgrade to a prerelease
  version (e.g., `3.6.0-M1`). Pin at the latest stable.

## Rollback

If a grouping goes sideways mid-resolution:

```bash
# Discard all uncommitted changes in this module
git checkout -- gradle.properties build.gradle <module>/build.gradle

# Refresh cache and rebuild baseline
./gradlew --refresh-dependencies clean build -x test
```

If the entire upgrade session needs to be undone:

```bash
git log --oneline -20
# Ask user before resetting
```

Never force-reset without user confirmation.

## Interaction with Sibling Upgrade Commands

This routine is one of the dep-upgrade family in
`engineer/maintenance/upgrades/`. **Never interleave** sister upgraders:

| Routine | Scope | Branch convention |
|---|---|---|
| `/engineer:maintenance:upgrades:npm-deps` | npm/JS projects | `chore/npm-upgrade-<date>` |
| `/engineer:maintenance:upgrades:gradle-deps` | Gradle/JVM (this routine) | `chore/gradle-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:maven-deps` | Maven/JVM projects | `chore/maven-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:infra-deps` | Infra (TF, Actions, Docker) | `chore/infra-deps-upgrade-<date>` |

Run one to completion (CI green or all groupings committed),
push and open the PR, THEN start the next. Each creates its own
`chore/*-upgrade-<date>` branch — never share a branch between
them, so bisect and revert stay clean.

The `polyglot-maintenance-cycle` workflow's state machine
enforces this — it won't start a sister upgrade routine until
the current one's branch is committed/PR'd.

If a project has both Gradle and Maven (rare; multi-build-tool
JVM repos), run them sequentially on separate branches.

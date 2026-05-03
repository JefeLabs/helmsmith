---
type: upgrader
description: Tactfully upgrade JVM (Maven) dependencies by library-family groupings, proceeding from lowest to highest risk. Upgrade one grouping at a time, fully resolve all issues (compile, unit + integration tests, JaCoCo coverage, quality checks) before moving to the next. Reactor-aware with parent-POM inheritance handling and `<annotationProcessorPaths>` watch.
argument-hint: [<module-path> | all]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/upgrades/_context.md` (upgrade
> archetype patterns + per-topology branching), `product/strategy/_context.md`.
>
> This is the Maven counterpart to
> `/engineer:maintenance:upgrades:gradle-deps` and
> `/engineer:maintenance:upgrades:npm-deps`. Same principles, same rigor,
> adapted to Maven + Spring Boot semantics — including parent-POM
> inheritance, `<dependencyManagement>` BOMs, reactor-wide
> commits, and the `<annotationProcessorPaths>` watch.

Tactfully upgrade JVM (Maven) dependencies by **library-family
groupings**, proceeding from lowest risk to highest. Upgrade one
grouping at a time, fully resolve all issues (compile, unit +
integration tests, JaCoCo coverage, quality checks) before moving
to the next. Never blindly run `mvn versions:use-latest-releases`.

**Invoke with:** `/engineer:maintenance:upgrades:maven-deps` + optional
argument:

- **Single module path:** `/engineer:maintenance:upgrades:maven-deps maven-dependency`
- **All modules:** `/engineer:maintenance:upgrades:maven-deps all`
- **No argument:** defaults to `all` — upgrades every Maven module
  in the project

## Step 0.0 — Topology detection (outer + inner)

### Outer: where are the Maven project root(s)?

Edwin's prior version assumed Maven at the repo root or under a
known subdirectory (`maven-dependency/`). The suite-fit version
discovers Maven project roots dynamically:

```bash
# Find Maven project roots — pom.xml files where <parent> is absent
# or external (i.e., not pointing to a local relative path)
find . -maxdepth 4 -name "pom.xml" -not -path "*/node_modules/*" \
  -not -path "*/target/*" \
  | while read pom; do
      # Extract <parent> if present
      parent=$(grep -A 3 "<parent>" "$pom" | grep "<relativePath>" | head -1)
      if [ -z "$parent" ]; then
        # No parent declaration — likely a root pom
        echo "$pom"
      else
        # Parent declared — check if it's external (e.g., spring-boot-starter-parent)
        # vs. local relative path
        relpath=$(echo "$parent" | sed -E 's/.*<relativePath>([^<]*)<.*/\1/')
        if [ -z "$relpath" ] || [ "$relpath" = "../pom.xml" ] || [[ "$relpath" == ../* ]]; then
          # Has local parent — not a root
          true
        else
          # External parent (no relativePath or empty) — this IS a root
          echo "$pom"
        fi
      fi
    done
```

A simpler heuristic: a Maven root is a `pom.xml` where the
`<parent>` element is either absent OR explicitly empty
(`<relativePath/>`), indicating the parent is resolved from
the registry rather than a local module.

**Outer topology variations**:

- **Single Maven project at repo root**: `./pom.xml`
- **Single Maven project in subdirectory**: `./<subdir>/pom.xml`
  (e.g., `./services/pom.xml`, `./maven-dependency/pom.xml`)
- **Multiple independent Maven reactors**: rare; each reactor is
  its own upgrade session, never combined

If multiple Maven roots are found, prompt the user to pick one or
process sequentially with separate branches per root.

### Inner: single-module vs reactor (multi-module)?

Once the Maven root is identified, parse the parent POM for
reactor structure:

```bash
MAVEN_ROOT=<detected from outer>
cd "$(dirname $MAVEN_ROOT)"

# Parse <module> declarations in the parent POM
grep -oE "<module>[^<]+</module>" pom.xml \
  | sed -E 's/<module>([^<]+)<\/module>/\1/'
```

**Inner topology variations**:

- **Single-module**: no `<module>` entries; just the root POM
- **Reactor (multi-module)**: parent POM declares child modules
  via `<module>` entries; each child has its own `pom.xml`

Detection output:

```
Maven project detected:
- Root POM:    <path>
- Type:        <single-module | reactor>
- Modules:     <list when reactor>
- Parent:      <e.g., spring-boot-starter-parent 3.5.5 | none | other>

Targeting: <user-selected module or "all">
```

## Maven-specific reactor concepts

### Parent POM inheritance

A reactor's parent POM holds:

- `<properties>` (e.g., `<spring-boot.version>3.5.5</spring-boot.version>`)
  that child modules reference via `${spring-boot.version}`
- `<dependencyManagement>` declarations that ALL child modules
  inherit
- `<pluginManagement>` declarations that all children inherit
- `<dependencies>` (if any) that ALL children include implicitly

When the parent inherits from `spring-boot-starter-parent`, **the
parent inherits Spring Boot's BOM** and gets ~100 transitively-
managed versions automatically. Child modules then declare deps
without versions; Spring Boot's BOM provides them.

### Four version classification types

When upgrading, classify each outdated dep into one of four
types:

| Type | How to identify | Upgrade strategy |
|---|---|---|
| **Parent-managed** | Parent POM is `spring-boot-starter-parent` (or similar); the dep is in Spring Boot's managed list; child uses dep without `<version>` | Bump parent version; never override |
| **Imported BOM** | Parent has `<dependencyManagement>` with `<scope>import</scope>` BOM (e.g., AWS SDK BOM); child uses dep without `<version>` | Bump BOM version in parent's dependencyManagement; never pin individual deps |
| **Property-driven** | `<properties>` in parent declares `<foo.version>1.2.3</foo.version>`; references via `${foo.version}` | Bump the property value in parent POM |
| **Inline `<version>`** | Hard-coded `<version>1.2.3</version>` in a `<dependency>` element | Bump inline; consider extracting to property as a separate cleanup commit |

Misclassifying causes problems:
- Pinning a parent-managed dep to override Spring Boot's choice
  defeats the BOM
- Bumping a property whose actual driver is an imported BOM
  achieves nothing (BOM still wins)

### Reactor-wide commits

Unlike Gradle (commit per-module-per-grouping), Maven reactor
edits typically touch ONLY the parent POM (property bump or
BOM bump). The change cascades to all modules through inheritance.
**One grouping, one commit, reactor-wide** is the canonical
pattern:

```
chore(maven-dependency): upgrade Spring Boot BOM 3.5.5 → 3.5.9
```

The commit edits one file (parent `pom.xml`), but all reactor
modules' compile + test gates run against the new version.

Module-specific commits exist when:
- A child module has its own `<dependencyManagement>` for a
  module-specific dep
- An inline `<version>` in a child's `pom.xml` is being bumped
- A child has a unique `<dependencies>` entry not shared with
  siblings

In those cases, use `chore(<module>): upgrade <grouping>`.

## Principles

1. **Group by family.** Upgrade related libraries together
   (`org.springframework.*`, `com.fasterxml.jackson.*`,
   `software.amazon.awssdk:*`, `org.junit.jupiter.*`).
2. **Low-to-high risk, always.** Process groupings in strict risk
   order — never jump ahead.
3. **Resolve before advancing.** Every grouping must compile, pass
   `./mvnw verify` (unit + integration), and maintain coverage
   threshold (project-specific; commonly via parent's
   `<jacoco.minimum.coverage>` property) before touching the next
   grouping.
4. **One grouping, one commit, reactor-wide.** Parent POM property
   edits touch all modules through inheritance.
5. **Respect parent-POM inheritance.** Don't override parent-managed
   versions; bump the parent.
6. **Respect imported BOMs.** Don't pin individual libs; bump the
   BOM.
7. **Preserve property style.** If the project uses
   `<foo.version>` properties, maintain that style — don't inline.
8. **Don't cross the Java line.** Upgrading
   `<java.version>` / `<maven.compiler.release>` is NEVER combined
   with dep upgrades — separate ticket.
9. **Watch `<annotationProcessorPaths>`.** MapStruct, Lombok,
   Immutables, MapStruct-Lombok-Binding all live in
   `<annotationProcessorPaths>` and have JDK-version
   compatibility constraints.

## Phase 0: Reconnaissance

### 0.1 Detect Maven and inventory modules

(Done in Step 0.0. Capture the module list.)

```bash
cd "$MAVEN_ROOT"
./mvnw --version 2>&1 | head -10
```

Verify the wrapper is present and executable (`./mvnw`). If
missing, stop and ask the user — never fall back to a system
`mvn`.

### 0.2 Validate Baseline

Before any upgrades, confirm the project is currently healthy.
**Do not upgrade on top of a broken project.**

#### Clean build + tests + integration tests + coverage

The project's `verify` lifecycle phase runs everything in one go:

```bash
cd "$MAVEN_ROOT"
./mvnw clean verify 2>&1 | tail -60
```

`verify` runs:
- `compile` (main sources)
- `test-compile` (test sources)
- `test` (unit tests via Surefire)
- `package` (JAR assembly)
- `pre-integration-test`, `integration-test` (Failsafe ITs if
  configured)
- `verify` (final coverage check via JaCoCo `check` goal,
  Spotbugs/Checkstyle, etc.)

This catches everything in one command, unlike Gradle which
splits `build` and `check`.

#### JaCoCo dual-gate verification

Unlike Gradle's typical setup, Maven projects often have BOTH:

1. **Project minimum threshold** — declared in parent POM as
   `<jacoco.minimum.coverage>0.90</jacoco.minimum.coverage>` (or
   similar), enforced in `<execution><goals><goal>check</goal></goals>`
2. **Baseline regression gate** — coverage must not drop below the
   pre-upgrade baseline, even when the project minimum is `0.00`
   (some projects set the minimum to 0 during early development
   but still want to track regression)

Read the parent POM for the configured threshold:

```bash
grep -E "<jacoco\.minimum\.coverage>" "$MAVEN_ROOT/pom.xml"
```

Capture the baseline coverage from the post-build report:

```bash
find . -path '*/target/site/jacoco*/jacoco.xml' 2>/dev/null | head
# Parse line + branch coverage from the XML reports
```

**The dual gate**: pre-upgrade baseline coverage MUST be preserved,
AND project minimum MUST be met. Both apply simultaneously.

#### Dependency tree (sanity)

```bash
./mvnw dependency:tree -DoutputFile=baseline-tree.txt
```

Optional but useful — catches structural oddities (duplicate libs
on different classpaths, unexpected version selections via BOM)
before upgrades start.

#### Baseline Snapshot

Record all results before proceeding:

```
Baseline (<reactor>):
- ./mvnw verify:                 PASS / FAIL
  - test:                        X tests, Y passed, Z failed
  - integration-test:            X ITs, Y passed, Z failed
- JaCoCo line coverage:          XX.X%
- JaCoCo branch coverage:        XX.X%
- jacoco.minimum.coverage:       0.XX (project threshold)
- Baseline commit:               <sha>
```

**If baseline is broken:** Stop immediately. Report the failure to
the user. Do not upgrade on top of a broken project.

### 0.3 Collect Outdated Dependencies

The `versions-maven-plugin` produces multiple distinct reports —
all four are needed:

```bash
# 1. Property updates (versions held in <properties>)
./mvnw versions:display-property-updates 2>&1 \
  -DallowMilestoneUpdates=false -DallowSnapshots=false \
  | tee versions-property-updates.txt

# 2. Dependency updates (inline versions or imported BOM versions)
./mvnw versions:display-dependency-updates 2>&1 \
  -DallowMilestoneUpdates=false -DallowSnapshots=false \
  | tee versions-dependency-updates.txt

# 3. Plugin updates
./mvnw versions:display-plugin-updates 2>&1 \
  -DallowMilestoneUpdates=false -DallowSnapshots=false \
  | tee versions-plugin-updates.txt

# 4. Parent updates (NEW: parent POM is its own category)
./mvnw versions:display-parent-updates 2>&1 \
  -DallowMilestoneUpdates=false -DallowSnapshots=false \
  | tee versions-parent-updates.txt
```

The `-DallowMilestoneUpdates=false -DallowSnapshots=false` flags
skip alpha/beta/rc/M1/M2 versions, per
`engineer/maintenance/upgrades/_context.md`'s prerelease-skip rule.

**Why parent-updates is its own category**: when the parent is
`spring-boot-starter-parent`, bumping the parent cascades ~100
transitive versions through Spring Boot's BOM. It's not a normal
"dependency update" — it's the highest-blast-radius bump in the
reactor. Treat it as Tier 3 always.

### 0.4 Check Security Vulnerabilities

If the project has the OWASP `dependency-check-maven` plugin
configured:

```bash
./mvnw dependency-check:aggregate -DfailBuildOnAnyVulnerability=false 2>&1 | tail -30
```

Or CycloneDX SBOM:

```bash
./mvnw cyclonedx:makeAggregateBom 2>&1 | tail -20
```

Note critical/high severity issues. Per the upgrade archetype:
**vulns elevate the affected grouping by ONE tier; never jump the
queue**.

### 0.5 Identify version classification per outdated dep

For each outdated dep from step 0.3, classify per the four-type
table above (parent-managed / imported BOM / property-driven /
inline). This determines the edit location:

| Type | Edit |
|------|------|
| Parent-managed | Parent POM `<parent><version>X</version>` |
| Imported BOM | Parent POM `<dependencyManagement>` BOM `<version>` |
| Property-driven | Parent POM `<properties><foo.version>X</foo.version>` |
| Inline | The specific `<dependency><version>X` in the using module's POM |

### 0.6 Build the Grouping Plan

Apply the same family-grouping rules as
`/engineer:maintenance:upgrades:gradle-deps` (BOM platforms first, then
Spring family, test framework families, AWS SDK, logging,
Jackson, Apache HttpComponents, Netty, database drivers, build
tools, Lombok, then standalone packages).

Maven-specific BOM platforms:
- `org.springframework.boot:spring-boot-dependencies`
- `org.springframework.cloud:spring-cloud-dependencies`
- `software.amazon.awssdk:bom`
- `org.testcontainers:testcontainers-bom`
- `com.fasterxml.jackson:jackson-bom`
- `org.junit:junit-bom`
- `io.netty:netty-bom`

**Annotation processor paths get their own grouping check**: when
the parent POM declares `<annotationProcessorPaths>` (for
MapStruct, Lombok, Immutables, mapstruct-lombok-binding),
upgrading those processor versions requires verifying the
generated code still compiles with the project's JDK. Flag
annotation-processor bumps for extra scrutiny.

### 0.7 Sort Groupings into Execution Order

Same tier structure as `/engineer:maintenance:upgrades:gradle-deps`, with
two Maven-specific changes:

- **Tier 3.12 (Spring Boot) becomes "parent POM bump"** if the
  parent is `spring-boot-starter-parent`. Highest blast radius —
  cascades to ~100 transitive versions; auto-config changes;
  may require parent-managed property name updates (Spring Boot
  occasionally renames properties between majors).
- **Tier 3 also includes annotation processor majors**
  (MapStruct/Lombok majors) because they affect compilation
  itself, not just runtime behavior.

### 0.8 Present the Grouping Plan

Same as `/engineer:maintenance:upgrades:gradle-deps` — present the sorted
plan as a numbered checklist showing tier, grouping name, package
count, and bump types.

## Phase 1: Execute Groupings (in tier order)

For each grouping in tier order:

### Step 1 — Update version

Edit the canonical location per the version-classification:

- **Parent bump**: edit `<parent><version>` in parent POM
- **BOM bump**: edit `<dependencyManagement><dependency><version>`
  in parent POM
- **Property bump**: edit `<properties><foo.version>` in parent POM
- **Inline bump**: edit `<dependency><version>` in the using
  module's POM

**Use `versions-maven-plugin` commands when possible** to avoid
manual edits:

```bash
# Set a property
./mvnw versions:set-property -Dproperty=foo.version -DnewVersion=1.2.3 \
  -DgenerateBackupPoms=false

# Update parent
./mvnw versions:update-parent -DnewVersion=3.5.9 -DgenerateBackupPoms=false

# Set a specific dep version (for inline)
./mvnw versions:set -DartifactId=foo -DnewVersion=1.2.3 \
  -DgenerateBackupPoms=false
```

**Always use `-DgenerateBackupPoms=false`** to prevent
`pom.xml.versionsBackup` files from littering the repo. (Without
this flag, `versions-maven-plugin` defaults to creating backup
files that need cleanup before commit.)

For BOM-managed deps within a `<dependencyManagement>` import,
no command exists — edit the BOM's `<version>` directly.

### Step 2 — Compile

```bash
./mvnw clean compile 2>&1 | tail -40
```

Resolve any compile errors before proceeding. If errors are
breaking-change-related (renamed classes, removed methods),
either:

1. Apply the migration (preferred when straightforward)
2. Skip this grouping and document as a major-migration follow-up

**Watch `<annotationProcessorPaths>` failures** — MapStruct/Lombok
version changes can produce mysterious compile errors that look
like main-source bugs but are actually processor incompatibilities.

### Step 3 — Test (unit + integration)

```bash
./mvnw verify 2>&1 | tail -60
```

`verify` runs unit tests (Surefire), integration tests
(Failsafe), and JaCoCo verification in one command. Resolve test
failures.

### Step 4 — Coverage dual-gate

After `verify`, parse the JaCoCo report:

```bash
find . -path '*/target/site/jacoco*/jacoco.xml' 2>/dev/null | head
```

Verify both gates:

1. **Project minimum**: line + branch coverage ≥
   `<jacoco.minimum.coverage>` from parent POM
2. **Baseline regression**: line + branch coverage ≥ baseline
   captured in Phase 0

Both must pass. If coverage drops, the grouping introduced
untested behavior changes — either add tests OR skip.

### Step 5 — Security re-check (when applicable)

```bash
./mvnw dependency-check:aggregate -DfailBuildOnAnyVulnerability=false 2>&1 | tail -30
```

Note any new vulns introduced.

### Step 6 — Failing-module escape hatch (reactor-specific)

When a single module within the reactor fails its gate after a
parent POM property bump, two options:

1. **Pin the failing module via explicit `<dependency>` override**
   in the failing module's POM, which overrides the parent's
   inherited version FOR THAT MODULE ONLY:
   ```xml
   <dependency>
     <groupId>com.fasterxml.jackson.core</groupId>
     <artifactId>jackson-databind</artifactId>
     <version>2.18.2</version>  <!-- pin while reactor moves to 2.19 -->
   </dependency>
   ```
   Document this in the commit message and the report. The pin
   becomes a follow-up ticket to migrate the failing module.

2. **Revert the entire grouping**, marking it SKIPPED in the
   report.

The user decides which option. Default: revert (cleaner state);
pin only when most modules pass and one is a known migration
holdout.

### Step 7 — Commit

```
chore(<reactor>): upgrade <grouping-name>

<library>: <old> → <new>
<library>: <old> → <new>
...

Validation:
- ./mvnw verify:           PASS (X tests, Y ITs)
- JaCoCo line coverage:    XX.X% (threshold 90.0%, baseline XX.X%)
- JaCoCo branch coverage:  XX.X%
- Vulns introduced:        <none|N>

[Reactor-wide: parent POM property edit cascades to all modules]
```

For module-specific edits (inline `<version>` in a child POM):
`chore(<module>): upgrade <grouping>` instead.

### Step 8 — Advance

Automatically proceed to the next grouping.

## Major Bump Pre-Flight (Tier 3 only)

Before any Tier 3 major bump, run these extra steps:

### Fetch Migration Guide via context7

```
mcp__context7__resolve-library-id → "spring-boot" | "jackson-databind" | etc.
mcp__context7__query-docs → "<library> migration v<old> to v<new>"
```

Key things to extract for **Spring Boot majors**:
- Removed/renamed auto-configuration properties
- Bean lifecycle changes
- Default value changes
- Required Java version changes (Spring Boot 4.x will require
  Java 21+; verify before bumping)
- Property file changes (`application.properties` /
  `application.yml`)

Key things for **Jackson majors**:
- Default deserialization behavior changes
- Annotation API changes
- Subtype handling changes (security-related in 2.x)

Key things for **AWS SDK majors** (v2 → v3 if it ever happens):
- Client builder API changes
- Region/credential resolution changes

### Verify Maven version compatibility

Some Spring Boot majors require newer Maven:

| Spring Boot | Min Maven |
|-------------|-----------|
| 3.0.x       | 3.6.3     |
| 3.2.x       | 3.6.3     |
| 3.5.x       | 3.6.3     |
| 4.0.x       | TBD; possibly 3.9.x |

If the wrapper pins below the minimum, bump the wrapper as a
SEPARATE commit before the parent bump:

```bash
./mvnw wrapper:wrapper -Dmaven=3.9.x
```

### Check `<annotationProcessorPaths>` compatibility

For MapStruct / Lombok / Immutables version bumps:
- Check the project's JDK target (`<maven.compiler.release>`)
- Verify the new processor version supports that JDK
- If JDK target needs to bump too, that's a SEPARATE migration

### Verify required-version cascades

Spring Boot's BOM transitively manages versions of ~100 libraries.
Before committing the bump:

```bash
./mvnw dependency:tree -DoutputFile=after-tree.txt
diff baseline-tree.txt after-tree.txt | head -100
```

Inspect the diff for unexpected transitive changes. A Spring Boot
3.5.5 → 3.6.0 bump might transitively bump Hibernate from 6.4 to
6.5, which is its own breaking-change surface.

## Phase 2: Security Remediation

After all family groupings are done, re-run the security scan:

```bash
./mvnw dependency-check:aggregate -DfailBuildOnAnyVulnerability=false 2>&1 | tail -30
```

If vulnerabilities remain that weren't resolved by the grouping
upgrades:

- Patch/minor within an already-upgraded package: apply directly
- Major bump for the fix: treat as single-package grouping with
  full Step 1-8 cycle
- **Never blindly accept `versions:use-latest-releases`** — it
  ignores semver and breaks things silently
- Vulns with no available fix: document in the final report with
  severity + exploit-context note

## Phase 3: Final Verification

Run the full gate one last time:

```bash
./mvnw clean verify 2>&1 | tail -60
./mvnw versions:display-property-updates -DallowMilestoneUpdates=false 2>&1 | tail -20
./mvnw versions:display-dependency-updates -DallowMilestoneUpdates=false 2>&1 | tail -20
./mvnw versions:display-plugin-updates -DallowMilestoneUpdates=false 2>&1 | tail -20
./mvnw versions:display-parent-updates -DallowMilestoneUpdates=false 2>&1 | tail -20
./mvnw dependency-check:aggregate 2>&1 | tail -30  # if plugin is configured
```

Compare before/after:

- All four `display-*-updates` outputs should show fewer (ideally
  zero) outdated entries
- `dependency-check` should show fewer (ideally zero)
  vulnerabilities
- JaCoCo coverage should be at or above threshold AND baseline

## Phase 4: Report

Present the final summary:

```
## Maven Dependency Upgrade Report for <reactor-name>

### Completed Groupings (in execution order)
| # | Tier | Grouping | Libraries | Status |
|---|------|----------|-----------|--------|
| 1 | 1.1 | JUnit patches              | 3 | DONE (reactor-wide) |
| 2 | 1.3 | Logback + SLF4J            | 2 | DONE (reactor-wide) |
| 3 | 2.4 | AWS SDK BOM minor          | 1 (cascades 30+) | DONE (reactor-wide) |
| 4 | 3.12| Spring Boot parent 3.5.5 → 3.5.9 | 1 (cascades ~100) | DONE (reactor-wide) |
| 5 | 3.12| Spring Boot parent 3.5.9 → 3.6.0 | 1 (cascades ~100) | SKIPPED — TenantResolver auto-config regression |
...

### Skipped / Pinned
| Grouping | Reason |
|----------|--------|
| Spring Boot 3.5.9 → 3.6.0 | TenantResolver auto-config failed to load after bump; needs dedicated migration PR |
| jackson-databind 2.18.2 → 2.19.0 (in mtauth-module) | Module pinned to 2.18.2 via explicit override; reactor moved to 2.19; needs follow-up ticket to remove pin |

### Security
- Vulnerabilities before: X
- Vulnerabilities after:  Y
- Remaining: <details, CVE IDs, severity, exploit context>

### Coverage (dual-gate)
- Before: line XX.X% / branch XX.X%
- After:  line XX.X% / branch XX.X%
- Project minimum:  0.XX (<jacoco.minimum.coverage>)
- Baseline gate:    PASS / FAIL

### Final Gate
- compile:                  PASS / FAIL
- test (Surefire):          PASS / FAIL (X passed, Y failed)
- integration-test (Failsafe): PASS / FAIL (X passed, Y failed)
- jacoco verification:      PASS / FAIL
- versions:display-*:       <count of remaining outdated>
```

## Multi-Module Mode (`all`)

When the user specifies `all` instead of a single module path, OR
omits the argument:

1. **Detect all reactor modules** — parse parent POM `<module>`
   entries plus the root POM itself.
2. **Run Phase 0 reactor-wide** — `./mvnw verify` covers everything;
   `versions:display-*-updates` reports across the reactor.
3. **Build a cross-reactor grouping plan** — per the
   parent-inheritance model, most groupings are reactor-wide
   (parent POM property edit cascades to all modules). Module-
   specific groupings exist only when a child has its own
   `<dependencyManagement>` or inline `<version>`.
4. **Execute in risk order across the reactor** — for each
   grouping, the parent POM edit affects all modules
   simultaneously. Verify each module independently within the
   reactor's `verify` cycle.
5. **If one module fails after a parent bump**: apply the
   failing-module escape hatch (Step 6 in Phase 1).
6. **Commit per grouping reactor-wide** —
   `chore(<reactor>): upgrade <grouping>` for parent POM edits;
   `chore(<module>): upgrade <grouping>` for module-specific
   edits.

For a single-module project, `all` is equivalent to the single
module's name. The command handles future growth automatically.

## Guard Rails

- **Never blindly bump `<java.version>`** — it's a separate
  migration.
- **Never override a parent-managed version** to pin it explicitly
  without a documented reason. Bump the parent.
- **Never override a BOM-imported version** to pin it explicitly.
  Bump the BOM.
- **Always use `-DgenerateBackupPoms=false`** with `versions-*`
  commands.
- **Never use `versions:use-latest-releases`** — it ignores semver
  and bumps everything at once.
- **Never skip `verify`** — running only `test` misses integration
  tests and coverage verification.
- **Watch the Maven wrapper** — don't upgrade to a parent version
  that requires a newer Maven than the wrapper pins, unless you
  ALSO bump the wrapper in the same commit.
- **Watch JVM bytecode version** — libraries compiled for newer
  JDK target than the project's `<maven.compiler.release>` will
  fail at compile time.
- **Watch `<annotationProcessorPaths>`** — MapStruct/Lombok
  version changes can break compilation in subtle ways. Treat
  processor bumps as Tier 3.
- **Plugin versions are versions too** — `<pluginManagement>`
  entries in parent POM must be upgraded via the same
  grouping-and-gate process. Use `versions:display-plugin-updates`.
- **Parent-updates is its own category** — `versions:display-parent-updates`
  must be checked separately; it's not part of the regular
  display-dependency-updates output.
- **One grouping, one commit, reactor-wide** — parent POM property
  edits cascade through inheritance. Don't split the cascade
  across multiple commits.
- **Rollback is normal** — if a grouping can't be cleanly
  resolved, skip it. Report it. Don't force it.
- **Never reorder the risk tiers** — the low-to-high order is the
  entire point of this routine.
- **Skip alpha/beta/rc/M1 versions** — `-DallowMilestoneUpdates=false
  -DallowSnapshots=false` flags must be passed on every
  `versions:display-*` command. Pin at latest stable.

## Rollback

If a grouping goes sideways mid-resolution:

```bash
# Discard all uncommitted changes in this reactor
git checkout -- pom.xml */pom.xml

# Refresh local Maven cache and rebuild baseline
./mvnw -U clean verify -DskipTests
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
| `/engineer:maintenance:upgrades:gradle-deps` | Gradle/JVM projects | `chore/gradle-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:maven-deps` | Maven/JVM (this routine) | `chore/maven-deps-upgrade-<date>` |
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

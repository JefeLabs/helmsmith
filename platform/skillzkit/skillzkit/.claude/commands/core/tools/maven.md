---
description: Maven build tool for Java projects (Spring Boot, plain Java, JVM libraries). CLI only — no MCP. Heavily consumed by /engineer:maintenance:upgrades:* routines for dependency management, OpenRewrite recipe execution, and build verification during upgrade cycles. Composed with Bumpr (Edwin's CLI) for fleet-wide upgrade orchestration.
argument-hint: <free-form-prompt> [<lifecycle-phase>] [-DskipTests] [--profile <name>] [--module <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of Maven for build, dependency management,
and upgrade operations. Primary consumer is the maintenance
upgrade routines for Java projects.

## Phase 0: pre-flight

1. Verify maven active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.maven.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Maven not active. Run /core:tools:setup maven"
     exit 1
   fi
   ```

2. Verify Maven is invokable. Prefer wrapper `./mvnw` over
   system `mvn`:

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.maven.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   if [ -f "${PROJECT_ROOT}/mvnw" ]; then
     MVN_CMD="${PROJECT_ROOT}/mvnw"
   elif command -v mvn >/dev/null 2>&1; then
     MVN_CMD="mvn"
     echo "Note: Using system mvn. Project wrapper (./mvnw) preferred for"
     echo "version reproducibility. Generate via: mvn wrapper:wrapper"
   else
     echo "Maven not installed and no wrapper found."
     echo "  Install: https://maven.apache.org/install.html"
     echo "  Or generate wrapper: cd \"$PROJECT_ROOT\" && mvn wrapper:wrapper"
     exit 1
   fi
   ```

3. Verify pom.xml exists:

   ```bash
   if [ ! -f "${PROJECT_ROOT}/pom.xml" ]; then
     echo "pom.xml not found at ${PROJECT_ROOT}"
     echo "This doesn't appear to be a Maven project."
     exit 1
   fi
   ```

4. Verify Java is on PATH at sufficient version:

   ```bash
   if ! command -v java >/dev/null 2>&1; then
     echo "Java not on PATH. Set JAVA_HOME and update PATH."
     exit 1
   fi
   
   JAVA_VER=$(java -version 2>&1 | head -1)
   echo "Java: $JAVA_VER"
   ```

## Phase 1: prompt interpretation

Maven operations:

### Build lifecycle

- **clean** — remove target/ output
- **compile** — compile main sources
- **test** — run unit tests
- **package** — produce JAR/WAR
- **verify** — run integration tests
- **install** — install to local Maven repo
- **deploy** — publish to remote repo

### Dependency management

- **Dependency tree** — `mvn dependency:tree`
- **Find conflicts** — `mvn dependency:tree -Dverbose`
- **Outdated dependencies** — `mvn versions:display-dependency-updates`
- **Outdated plugins** — `mvn versions:display-plugin-updates`
- **Resolve dependencies** — `mvn dependency:resolve`
- **Effective POM** — `mvn help:effective-pom` (full
  inheritance resolved)

### Upgrade operations

- **Bump dependency version** — `mvn versions:set-property`
  for `<properties>` versions, or
  `mvn versions:use-latest-versions` for direct deps
- **Bump parent version** — `mvn versions:update-parent`
- **OpenRewrite recipes** — `mvn rewrite:run` with configured
  recipe (Spring Boot 2→3, JUnit 4→5, etc.)

### Diagnostics

- **Help describe goal** — `mvn help:describe -Dplugin=<name>`
- **Active profiles** — `mvn help:active-profiles`
- **Effective settings** — `mvn help:effective-settings`

## Phase 2: execution

### Common build invocations

```bash
# Clean + compile + test + package
$MVN_CMD clean package

# Skip tests (during upgrade verification)
$MVN_CMD clean package -DskipTests

# With specific profile
$MVN_CMD clean package -P production

# Module-scoped (multi-module builds)
$MVN_CMD clean package -pl my-module -am

# Parallel execution
$MVN_CMD clean package -T 1C   # 1 thread per core
```

### Dependency tree

```bash
# Full tree
$MVN_CMD dependency:tree

# Only conflicts
$MVN_CMD dependency:tree -Dverbose

# Filter by groupId
$MVN_CMD dependency:tree -Dincludes=org.springframework.*

# Output to file for later analysis
$MVN_CMD dependency:tree -DoutputFile=/tmp/deptree.txt
```

### Version checks

```bash
# Direct dependency updates available
$MVN_CMD versions:display-dependency-updates

# Plugin updates available
$MVN_CMD versions:display-plugin-updates

# Property-based version updates (common pattern)
$MVN_CMD versions:display-property-updates
```

### OpenRewrite (heavily used by Bumpr / upgrade routines)

```bash
# Run a specific recipe
$MVN_CMD rewrite:run \
  -Drewrite.activeRecipes=org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_0

# Dry-run to preview changes
$MVN_CMD rewrite:dryRun \
  -Drewrite.activeRecipes=org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_0
```

The plugin must be configured in pom.xml first:

```xml
<plugin>
  <groupId>org.openrewrite.maven</groupId>
  <artifactId>rewrite-maven-plugin</artifactId>
  <version>5.x</version>
  <configuration>
    <activeRecipes>...</activeRecipes>
  </configuration>
</plugin>
```

The integration handles the plugin-not-installed case
explicitly when invoked for OpenRewrite operations.

## Phase 3: result formatting

### Build success

```
=== Maven Build ===
Project:    skoolscout-api
Modules:    3 (api, core, integration)
Profile:    production

Phases run: clean, compile, test, package
Tests:      247 passed, 0 failed, 0 skipped
JARs built:
  api/target/skoolscout-api-1.2.3.jar (32 MB)
  core/target/skoolscout-core-1.2.3.jar (8 MB)

Build duration: 2m 14s
Status:        SUCCESS
```

### Build failure with diagnostic

```
=== Maven Build FAILED ===
Project:    skoolscout-api
Failed at:  test phase

Failures:
  api/src/test/java/com/skoolscout/UserTest.java
    testCreateUser FAILED
      Expected: status=201
      Actual:   status=500
      
  api/src/test/java/com/skoolscout/AuthTest.java
    testInvalidToken ERROR
      java.lang.NullPointerException at AuthService.java:42

Build duration: 1m 12s before failure
```

### Dependency tree summary

```
=== Maven Dependency Tree ===
Project:        skoolscout-api
Total deps:     147 (87 direct, 60 transitive)
Conflicts:      3

Direct dependencies (top-level):
  org.springframework.boot:spring-boot-starter-web:3.2.4
    └─ Provides Spring MVC, Tomcat embedded
  org.springframework.boot:spring-boot-starter-data-jpa:3.2.4
  org.postgresql:postgresql:42.7.3
  ... (84 more)

Conflicts detected:
  com.fasterxml.jackson.core:jackson-databind
    Version 2.15.4 (chosen)
    Version 2.16.1 (omitted; from spring-boot-starter)
    
  org.slf4j:slf4j-api
    Version 2.0.7 (chosen)
    Version 1.7.36 (omitted; from older transitive dep)

To investigate: mvn dependency:tree -Dincludes=jackson-databind
```

### Outdated dependencies

```
=== Outdated Dependencies ===
Project: skoolscout-api

Major version updates available (manual review needed):
  org.springframework.boot:spring-boot-starter-parent
    Current: 3.2.4 → Available: 3.3.0
    Type: Minor (low risk)
    
  com.fasterxml.jackson.core:jackson-databind
    Current: 2.15.4 → Available: 2.18.0
    Type: Minor

Patch updates available (typically safe):
  org.postgresql:postgresql
    Current: 42.7.3 → Available: 42.7.4
    Type: Patch
  
  ... (12 more patches)

To upgrade safely:
  /engineer:maintenance:upgrades:maven-deps --tier patch
  /engineer:maintenance:upgrades:maven-deps --tier minor
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `mvn: command not found` | Maven not installed and no wrapper | Install Maven or generate wrapper |
| `JAVA_HOME not set` | JDK not configured | Set JAVA_HOME pointing to JDK |
| Build hung at "downloading" | Slow Maven Central or proxy issue | Check ~/.m2/settings.xml; configure proxy if needed |
| OutOfMemoryError | Heap too small | `export MAVEN_OPTS="-Xmx2g"` |
| Plugin not found | OpenRewrite plugin not in pom | Add plugin configuration |
| Dependency convergence error | Conflicts with enforcer rules | Investigate via dependency:tree -Dverbose |

## Cross-namespace integration

Maven is consumed by:

- **`engineer/maintenance/upgrades/maven-deps`** — full Maven
  dependency upgrade routine (when added; planned)
- **`engineer/maintenance/upgrades/spring-boot`** — Spring
  Boot major-version upgrades using OpenRewrite recipes
- **`engineer/maintenance/upgrades/java-version`** — JDK
  upgrades requiring Maven coordination
- **Bumpr** (Edwin's CLI) — orchestrates Maven across the fleet
- **Build verification in upgrade routines** — after applying
  changes, run `mvn package -DskipTests` to verify build still
  succeeds

## What this tool does NOT do

- **Configure Maven settings.** ~/.m2/settings.xml,
  authentication, mirrors — user-managed.
- **Replace Bumpr.** Bumpr orchestrates Maven invocations
  across multiple repos; this tool is single-project Maven
  invocation.
- **Manage Java version.** SDKMAN or jenv handle JDK
  switching; not in scope.
- **Edit pom.xml directly.** Some operations
  (versions:set-property) modify pom.xml via Maven's own
  versions plugin; manual XML edits are user/agent work.

## Examples

```bash
# Standard build
/core:tools:maven "clean package"

# Skip tests (upgrade verification)
/core:tools:maven "clean package -DskipTests"

# Show outdated dependencies
/core:tools:maven "show me available dependency updates"

# Run OpenRewrite Spring Boot 3 upgrade
/core:tools:maven "run OpenRewrite Spring Boot 3 upgrade recipe"

# Module-scoped build
/core:tools:maven "build only the api module" --module api

# Dependency tree with conflicts
/core:tools:maven "show me dependency tree with conflicts"
```

---

# Registry definition

## Tool metadata

```yaml
name: maven
displayName: Apache Maven
provider: apache
category: jvm-build
optional: true   # only required when project uses Maven
mutuallyExclusive: []   # can coexist with Gradle in polyglot setups
```

## Interfaces

### CLI

```yaml
executable:
  preferred: ./mvnw   # wrapper (project-local)
  fallback: mvn       # system installation
detectionCommand: |
  test -f ./mvnw || command -v mvn
installCommand: |
  Wrapper (recommended for project version reproducibility):
    cd <project-root> && mvn wrapper:wrapper
    (requires mvn installed once; thereafter ./mvnw is self-contained)
  
  System install:
    macOS:   brew install maven
    Linux:   apt install maven (Debian/Ubuntu)
             dnf install maven (Fedora/RHEL)
    Windows: choco install maven
             or download from https://maven.apache.org/
notes: |
  Always prefer ./mvnw when available. The wrapper pins Maven
  version per project, avoiding "works on my machine" issues
  when team members have different Maven versions.
```

### MCP

**Not available.** No Maven MCP server exists.

## Version constraint

Recommended: Maven 3.9+. Older versions work but lack newer
features (resolver V2, etc.).

## Required by skillz commands

Auto-populated. Currently:
- /engineer:maintenance:upgrades:* (Java projects)
- Bumpr orchestration

## Cross-tool dependencies

- JDK (Java Development Kit) compatible with project's
  Java version
- Network access to Maven Central (or configured corporate
  Nexus/Artifactory)

## System requirements

- JDK 17+ for modern projects (varies per project)
- ~50 MB disk for ~/.m2 metadata; varies for ~/.m2/repository
  (can grow large)
- JAVA_HOME environment variable
- Network: HTTPS to Maven Central or corporate repo

## Compliance considerations

Financial institution Maven setups often:
- Require corporate Nexus/Artifactory mirror (no direct
  Maven Central access)
- Require credential auth for the corporate repo
  (~/.m2/settings.xml with `<servers>` blocks)
- May restrict which artifacts/groupIds are allowed

The suite reads but doesn't manage settings.xml. Users
configure their corporate repo independently.

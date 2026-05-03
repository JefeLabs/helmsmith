---
description: Gradle build tool for JVM and Android projects. CLI only — no MCP. Used by /engineer:maintenance:upgrades:gradle-deps and similar routines for dependency management, version catalogs, and OpenRewrite recipe execution. Composed with Bumpr for fleet-wide upgrade orchestration.
argument-hint: <free-form-prompt> [<task-name>] [--no-daemon] [--build-cache] [--scan]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of Gradle for build, dependency management,
and upgrade operations. Heavily composed with the Bumpr tool
for fleet-wide upgrade work.

## Phase 0: pre-flight

1. Verify gradle active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.gradle.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Gradle not active. Run /tools:setup gradle"
     exit 1
   fi
   ```

2. Verify Gradle is invokable. Strongly prefer wrapper
   `./gradlew`:

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.gradle.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   if [ -f "${PROJECT_ROOT}/gradlew" ]; then
     GRADLE_CMD="${PROJECT_ROOT}/gradlew"
     # Ensure executable on Unix
     chmod +x "$GRADLE_CMD" 2>/dev/null || true
   elif command -v gradle >/dev/null 2>&1; then
     GRADLE_CMD="gradle"
     echo "Note: Using system gradle. Project wrapper (./gradlew) strongly"
     echo "preferred. Generate via: gradle wrapper"
   else
     echo "Gradle not installed and no wrapper found."
     echo "  Install: https://gradle.org/install/"
     echo "  Or generate wrapper: cd \"$PROJECT_ROOT\" && gradle wrapper"
     exit 1
   fi
   ```

   Wrapper preference is stronger for Gradle than Maven —
   Gradle's API evolves faster and version mismatches between
   developer machines cause frequent build failures.

3. Verify build script exists:

   ```bash
   if [ ! -f "${PROJECT_ROOT}/build.gradle" ] && \
      [ ! -f "${PROJECT_ROOT}/build.gradle.kts" ] && \
      [ ! -f "${PROJECT_ROOT}/settings.gradle" ] && \
      [ ! -f "${PROJECT_ROOT}/settings.gradle.kts" ]; then
     echo "No Gradle build script found at ${PROJECT_ROOT}"
     exit 1
   fi
   ```

4. Verify Java available:

   ```bash
   if ! command -v java >/dev/null 2>&1; then
     echo "Java not on PATH. Required for Gradle."
     exit 1
   fi
   ```

## Phase 1: prompt interpretation

Gradle operations:

### Build tasks (most commonly invoked)

- **build** — full build (compile, test, assemble)
- **assemble** — compile + package (no tests)
- **test** — run tests
- **check** — all verification tasks (test + lint + etc.)
- **clean** — remove build/ output
- **clean build** — clean + build chained

### Task discovery

- **tasks** — list available tasks
- **dependencies** — show dependency graph for a configuration
- **projects** — multi-project structure
- **buildEnvironment** — Gradle version + plugin versions

### Dependency management

- **dependencies** — full dependency tree
  (`./gradlew dependencies --configuration=runtimeClasspath`)
- **dependencyInsight** — why a specific dep is included
  (`./gradlew dependencyInsight --dependency=jackson-databind`)
- **dependencyUpdates** — outdated deps (requires
  `com.github.ben-manes.versions` plugin)

### Upgrade operations

- **Version catalog updates** — `gradle/libs.versions.toml`
  pattern; modern Gradle's recommended dependency declaration
- **OpenRewrite recipes** — via `org.openrewrite.rewrite`
  Gradle plugin
- **Wrapper version update** — `./gradlew wrapper --gradle-version 8.6`

### Diagnostics

- **--scan** — produce build scan (Gradle Enterprise)
- **--info / --debug** — verbose logging
- **--profile** — performance profiling
- **--stacktrace** — full stack traces on failure

## Phase 2: execution

### Common build invocations

```bash
# Full build
$GRADLE_CMD build

# Skip tests (upgrade verification)
$GRADLE_CMD build -x test

# Specific module (multi-project)
$GRADLE_CMD :api:build

# Parallel + build cache (faster)
$GRADLE_CMD build --parallel --build-cache

# No daemon (CI / clean state)
$GRADLE_CMD build --no-daemon
```

The Gradle daemon is on by default and speeds up subsequent
invocations significantly. For CI or one-off invocations,
`--no-daemon` keeps things clean.

### Task discovery

```bash
# List available tasks
$GRADLE_CMD tasks

# Including unstable / advanced tasks
$GRADLE_CMD tasks --all

# Multi-project structure
$GRADLE_CMD projects
```

### Dependency tree

```bash
# Full dependencies for a configuration
$GRADLE_CMD dependencies --configuration runtimeClasspath

# Specific module
$GRADLE_CMD :api:dependencies --configuration runtimeClasspath

# Why a specific dep is included
$GRADLE_CMD dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

### Outdated dependencies

```bash
# Requires com.github.ben-manes.versions plugin in build.gradle.kts:
# plugins {
#   id("com.github.ben-manes.versions") version "0.51.0"
# }

$GRADLE_CMD dependencyUpdates -Drevision=release
```

The integration handles plugin-not-installed:

```bash
if ! $GRADLE_CMD dependencyUpdates 2>&1 | grep -q "Task :"; then
  echo "Versions plugin not configured. Add to build.gradle.kts:"
  echo "  plugins { id(\"com.github.ben-manes.versions\") version \"0.51.0\" }"
fi
```

### OpenRewrite

```bash
# With rewrite plugin configured:
$GRADLE_CMD rewriteRun

# Dry-run mode
$GRADLE_CMD rewriteDryRun
```

### Version catalog updates

When project uses `gradle/libs.versions.toml`, version updates
modify TOML file directly:

```bash
# Suite reads libs.versions.toml; doesn't directly modify it
# Instead, suggests changes for user/agent to apply

# Read current versions
cat "${PROJECT_ROOT}/gradle/libs.versions.toml"
```

### Wrapper version update

```bash
# Update Gradle version itself
$GRADLE_CMD wrapper --gradle-version 8.6

# After running, ./gradlew uses Gradle 8.6
```

## Phase 3: result formatting

### Build success

```
=== Gradle Build ===
Project:   skoolscout-platform
Tasks run: clean, compileJava, test, jar, assemble
Tests:     342 passed, 0 failed
JARs built:
  api/build/libs/api-1.2.3.jar
  core/build/libs/core-1.2.3.jar

Duration: 3m 24s
Status:   SUCCESS

Build cache: 47 of 89 tasks cached (53%)
```

### Build failure

```
=== Gradle Build FAILED ===
Project:    skoolscout-platform
Failed at:  :api:compileJava

Errors:
  api/src/main/java/com/skoolscout/UserService.java:42
    error: cannot find symbol
      symbol:   class UserRepository
      location: package com.skoolscout.repo
    
  Likely cause: import path changed or new module not configured

Run with --stacktrace for more detail.
```

### Dependency tree

```
=== Gradle Dependencies ===
Project:        :api
Configuration:  runtimeClasspath

\--- org.springframework.boot:spring-boot-starter-web:3.2.4
     +--- org.springframework.boot:spring-boot-starter:3.2.4
     |    +--- org.springframework.boot:spring-boot:3.2.4
     |    +--- org.springframework.boot:spring-boot-autoconfigure:3.2.4
     |    +--- org.springframework.boot:spring-boot-starter-logging:3.2.4
     |    \--- jakarta.annotation:jakarta.annotation-api:2.1.1
     +--- ... (more)

(*) - dependencies omitted (listed previously)

To investigate a specific conflict:
  /tools:gradle "explain why jackson-databind is included"
  → ./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

### Outdated dependencies

```
=== Outdated Dependencies ===
Project: skoolscout-platform

Major version updates:
  org.springframework.boot:spring-boot-starter-web
    Current: 3.2.4 → Available: 3.3.0
    
Patch updates:
  org.postgresql:postgresql
    Current: 42.7.3 → Available: 42.7.4

Plugin updates:
  org.jetbrains.kotlin.jvm: 1.9.20 → 2.0.0 (major)

To upgrade:
  - Patches/minor: /engineer:maintenance:upgrades:gradle-deps --tier minor
  - Major: requires migration plan; review breaking changes first
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `gradlew: Permission denied` | Wrapper not executable | `chmod +x gradlew` |
| `Could not determine the dependencies of task ...` | Build script error | Run with `--stacktrace`; common: typo in plugin id |
| `Java home is set to ...` | JAVA_HOME points to wrong JDK | Set JAVA_HOME to JDK matching project's targetCompatibility |
| Daemon disappeared | OOM or system kill | `--no-daemon` for one-off, or increase heap: `org.gradle.jvmargs=-Xmx4g` in gradle.properties |
| Network timeout | Corporate proxy or slow mirror | Configure ~/.gradle/init.gradle for proxy/mirror |

## Cross-namespace integration

Gradle is consumed by:

- **`engineer/maintenance/upgrades/gradle-deps`** — Gradle
  dependency upgrade routine
- **`engineer/maintenance/upgrades/spring-boot`** — Spring
  Boot upgrades for Gradle-based projects
- **`engineer/maintenance/upgrades/kotlin`** — Kotlin version
  upgrades
- **Bumpr** (Edwin's CLI) — orchestrates Gradle across the
  fleet
- **Build verification in upgrade routines** — after applying
  changes, run `./gradlew build -x test` to verify

## Distinction from Maven

| Aspect | Gradle | Maven |
|--------|--------|-------|
| Build script | Groovy (legacy) or Kotlin DSL | XML |
| Speed | Faster (incremental builds, daemon) | Slower (no daemon by default) |
| Flexibility | High (custom tasks easy) | Lower (plugin-driven) |
| Learning curve | Steeper | Gentler |
| Android | Required | Not used |
| Spring Boot | Common | Most common |

Many JVM projects use one or the other; rarely both. Some
multi-project setups have both (legacy Maven modules + new
Gradle modules during migration). Gradle and Maven coexist in
the suite — `mutuallyExclusive` is empty.

## What this tool does NOT do

- **Configure Gradle settings.** ~/.gradle/init.gradle,
  gradle.properties, settings.gradle.kts — user-managed.
- **Replace Bumpr.** Bumpr orchestrates Gradle across multiple
  repos; this tool is single-project Gradle invocation.
- **Manage JDK version.** Use SDKMAN, jenv, or asdf for JDK
  switching.
- **Edit build scripts directly.** Some operations modify
  build files via Gradle plugins (versions:bump-version);
  manual edits are user/agent work.

## Examples

```bash
# Standard build
/tools:gradle "build the project"

# Skip tests (upgrade verification)
/tools:gradle "build skipping tests" -x test

# Show outdated dependencies
/tools:gradle "show me available dependency updates"

# Module build
/tools:gradle "build only the api module"

# Dependency insight
/tools:gradle "explain why jackson-databind is included"

# Run OpenRewrite recipes
/tools:gradle "run OpenRewrite recipes"
```

---

# Registry definition

## Tool metadata

```yaml
name: gradle
displayName: Gradle
provider: gradle-inc
category: jvm-build
optional: true   # only required when project uses Gradle
mutuallyExclusive: []
```

## Interfaces

### CLI

```yaml
executable:
  preferred: ./gradlew (or ./gradlew.bat on Windows)
  fallback: gradle
detectionCommand: |
  test -f ./gradlew || command -v gradle
installCommand: |
  Wrapper (strongly recommended):
    cd <project-root> && gradle wrapper
    (requires gradle installed once; thereafter ./gradlew is self-contained)
  
  System install:
    macOS:   brew install gradle
    Linux:   apt install gradle (often outdated; SDKMAN preferred)
             sdk install gradle  (via SDKMAN)
    Windows: choco install gradle
notes: |
  Wrapper is even more important for Gradle than Maven —
  Gradle's API evolves rapidly and version mismatches cause
  build failures. Always prefer ./gradlew.
```

### MCP

**Not available.** No Gradle MCP server.

## Version constraint

Recommended: Gradle 8.5+. Older versions miss Kotlin DSL
improvements, version catalog support, and configuration
caching.

## Required by skillz commands

Auto-populated. Currently:
- /engineer:maintenance:upgrades:* (Gradle projects)
- Bumpr orchestration

## Cross-tool dependencies

- JDK (compatible with project's Java version)
- Network access to Gradle Plugin Portal, Maven Central,
  or configured corporate repo

## System requirements

- JDK 17+ for modern Gradle (Gradle 8+ requires JDK 17 to RUN
  even if compiling for older targets)
- ~200 MB disk for ~/.gradle/caches (varies)
- JAVA_HOME environment variable
- Network: HTTPS to Gradle Plugin Portal + Maven Central (or
  corporate mirrors)

## Common companion plugins

- `com.github.ben-manes.versions` — outdated dependency
  detection
- `org.openrewrite.rewrite` — automated refactoring recipes
- `com.diffplug.spotless` — formatter
- `io.gitlab.arturbosch.detekt` — Kotlin static analysis

## Compliance considerations

Same as Maven — financial institutions typically use corporate
Nexus/Artifactory mirrors. Configure in ~/.gradle/init.gradle
or gradle.properties; user-managed.

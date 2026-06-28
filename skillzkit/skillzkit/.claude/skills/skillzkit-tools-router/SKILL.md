---
name: skillzkit-tools-router
description: Route local-tool intent to the right slash command in the skillzkit suite. Fires when the user wants to run a build (npm / Maven / Gradle), provision infrastructure (Terraform), lint or format code (Biome / ESLint), automate a browser (Playwright), inspect the DOM and capture network or console output (Chrome DevTools), compare images pixel-by-pixel (pixelmatch), do general image manipulation or palette extraction (ImageMagick), push or pull Storybook visual baselines (Chromatic), open a .pen file in the Pencil desktop app (open-pencil), query Pencil's structured design data via MCP (pencil-mcp), look up current library documentation (Context7), install or verify which tools the project depends on (tools setup), or query the tool manifest. Prefer this router over product/engineer/market/integrations when the user's verb is run, build, install, lint, format, screenshot, diff, compare, automate, look up docs, or scaffold a tool dependency.
---

# skillzkit-tools-router

Routes natural-language intent for **local tools** — anything
that runs on the developer's machine without reaching a remote
service — to the correct slash command.

## In scope

The 14 declared tools plus the three tool-management commands:

- **Build / package managers** — npm, Maven, Gradle
- **Infrastructure** — Terraform
- **Linting / formatting** — Biome, ESLint
- **Browser automation** — Playwright, Chrome DevTools
- **Visual / image** — pixelmatch, ImageMagick, Chromatic
- **Pencil tooling** — open-pencil, pencil-mcp
- **Documentation lookup** — Context7
- **Manifest / setup** — tools:setup, tools:manifest, tools:declare

## Out of scope

- **Personas, journeys, design systems, .pen file generation** →
  `skillzkit-product-router` (this router *runs* the underlying
  tools; the product router *generates designs*)
- **Architecture, ADRs, code remediation** →
  `skillzkit-engineer-router` (which calls these tools
  indirectly through upgrade and remediation flows)
- **Marketing copy, posting** → `skillzkit-market-router`
- **External services** → `skillzkit-integrations-router`
- **HeroUI / Storybook story generation** → use
  `/core:frameworks:*` directly

## Routing decision rules

### One-off invocation vs orchestrated flow

Tools have two natural usage modes:

- **Direct invocation** — "run biome on this file", "diff these
  two PNGs", "open the .pen file" → route here.
- **Inside a larger flow** — "upgrade dependencies", "fix
  Storybook drift" → these are engineer-router commands that
  *use* the tools internally. Route to engineer-router; do not
  invoke the tool directly.

When in doubt, ask whether the user wants the raw tool or the
orchestrated flow.

### Action vs question

- "What's the difference between Biome and ESLint?" → answer;
  do not invoke either.
- "Why did Chromatic fail my baseline?" → look at the failure;
  do not re-run.
- "Run biome on src/" → route.

### Tense awareness

- "I ran the tests, they're failing" → next step is debug, not
  rerun; ask before invoking.
- "Let me lint this", "I want to compare these images" → route.

### Confirmation before high-stakes

Most tool invocations are read-only or trivially reversible, but
a few have outsized impact:

- `/core:tools:terraform` with `apply` — provisions or destroys real
  cloud infrastructure; **always confirm** the target workspace
  / state file and the planned diff before applying
- `/core:tools:npm` with `install`, `update`, or destructive scripts
  — modifies `node_modules` and lock file; confirm only if the
  user hasn't explicitly asked
- `/core:tools:gradle` with `clean`, publish tasks, or version
  bumps — confirm
- `/core:tools:maven` with deploy phases or release plugins — confirm
- `/core:tools:chromatic` with `--auto-accept-changes` — accepts
  visual baselines without review; **always confirm**

For everything else (lint, format, screenshot, dry-run, diff,
read-only inspection), invoke without ceremony.

### Show reasoning briefly

When the user's intent maps to multiple tools, name the choice:

> Routing to `/core:tools:pixelmatch` rather than `imagemagick`
> because you said "pixel-by-pixel" — pixelmatch is purpose-
> built for visual diffs with anti-aliasing tolerance.

### Manifest awareness

Two manifests govern this layer:

- `product/.pencil-tools.json` — which tools are installed and
  active in the project. If the user asks for a tool that
  isn't in the manifest, suggest `/core:tools:setup` first or
  `/core:tools:declare` to register a new one.
- `package.json`, `pom.xml`, `build.gradle*`, `*.tf` — presence
  determines which build tool to use when the user says "build
  it" or "run tests".

### Override is cheap

If the user says "actually use ESLint instead of Biome", drop
and re-route. Both lint, but with different rule sets and
performance trade-offs.

---

## Command catalog

### Tool management

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:setup`                                   | Install or verify tools the suite depends on (auto-detect ecosystems) |
| `/core:tools:manifest`                                | Query or manage the tools runtime manifest                           |
| `/core:tools:declare`                                 | Add a new tool definition to the registry                            |

Use `/core:tools:setup` whenever the user says "I just cloned this
repo, set me up" or "make sure tools are installed."

### Build / package managers

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:npm`                                     | Run npm scripts (install, run, test, build) for Node.js projects     |
| `/core:tools:maven`                                   | Run Maven phases (clean, compile, test, package) for Java projects   |
| `/core:tools:gradle`                                  | Run Gradle tasks (build, test, assemble) for JVM/Android projects    |

**Disambiguation** — "build the project" or "run the tests":

| Project file                       | Route to        |
| ---------------------------------- | --------------- |
| `package.json`                     | `/core:tools:npm`    |
| `pom.xml`                          | `/core:tools:maven`  |
| `build.gradle` / `build.gradle.kts`| `/core:tools:gradle` |

If multiple are present (polyglot repo), ask which the user
means — or check the working subdirectory first.

If none of the above is present, ask the user what build system
they use rather than guessing.

### Infrastructure

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:terraform`                               | Plan, apply, or destroy Terraform-managed cloud infrastructure       |

**Hard rule** — surface the planned diff (terraform plan output)
before applying. Refuse `terraform destroy` without an explicit
"yes, destroy" from the user.

### Linting / formatting

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:biome`                                   | Lint and format JavaScript / TypeScript / JSON / JSX / TSX (fast)    |
| `/core:tools:eslint`                                  | Lint JavaScript / TypeScript with the long-standing ESLint ruleset   |

**Disambiguation** — "lint this":

- Check the project for `biome.json` (or `biome.jsonc`) →
  Biome.
- Check for `.eslintrc*` or `eslint.config.*` → ESLint.
- If both are present, ask the user which one is canonical for
  this repo (some projects use Biome for formatting and ESLint
  for advanced rules).
- For new projects without either, suggest Biome (faster, fewer
  config files).

### Browser automation

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:playwright`                              | Browser automation — screenshots, interaction tests, DOM queries     |
| `/core:tools:chrome-devtools`                         | Rich DOM inspection, console capture, network monitoring, perf       |

**Disambiguation** — "test the page" / "check the page":

- For **scripted scenarios** (login, click, form, screenshot at
  end) → Playwright.
- For **deep diagnostic capture** (console errors, network
  waterfall, perf trace) → Chrome DevTools.
- For **visual regression** specifically → Chromatic, not these.

### Visual / image

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:pixelmatch`                              | Pixel-by-pixel PNG diff with anti-aliasing tolerance                 |
| `/core:tools:imagemagick`                             | General image manipulation: format conversion, resize, palette       |
| `/core:tools:chromatic`                               | Cloud-hosted visual regression for Storybook stories                 |

**Disambiguation** — "compare images":

| Intent                                          | Route to            |
| ----------------------------------------------- | ------------------- |
| Strict pixel-level diff with tolerance          | `/core:tools:pixelmatch` |
| General comparison, format conversion, palette  | `/core:tools:imagemagick`|
| Storybook visual regression baselines           | `/core:tools:chromatic`  |

For "make this image smaller" / "convert to WebP" /
"extract the palette" → `/core:tools:imagemagick`.

### Pencil tooling

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:open-pencil`                             | Open the Pencil desktop app, optionally with a `.pen` file argument  |
| `/core:tools:pencil-mcp`                              | Query Pencil's MCP server for structured design data                 |

**Hard rule** — `.pen` files are encrypted. Never read with
`Read` or `Grep`. All structured access goes through
`/core:tools:pencil-mcp`. Visual access goes through
`/core:tools:open-pencil`.

### Documentation lookup

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/core:tools:context7`                                | Look up current library documentation via Context7 MCP               |

**When to invoke** — any time the user asks about a library,
framework, SDK, API, CLI, or cloud service. Context7 is more
current than training data and is preferred over web search for
library docs. (The Context7 MCP server itself is invoked
through this router; the underlying tools are MCP-only.)

---

## Cross-router handoffs

### To `skillzkit-engineer-router`

Engineer-router commands wrap several tools:

| Engineer command                                          | Underlying tools         |
| --------------------------------------------------------- | ------------------------ |
| `/engineer:maintenance:upgrades:npm-deps`                 | `/core:tools:npm`             |
| `/engineer:maintenance:upgrades:maven-deps`               | `/core:tools:maven`           |
| `/engineer:maintenance:upgrades:gradle-deps`              | `/core:tools:gradle`          |
| `/engineer:maintenance:upgrades:infra-deps`               | `/core:tools:terraform`       |
| `/engineer:maintenance:remediation:biome-issues`          | `/core:tools:biome`           |
| `/engineer:maintenance:remediation:storybook-drift`       | `/core:tools:chromatic`, `/core:frameworks:storybook:verify:*` |

If the user wants a strategic remediation flow rather than a
one-off tool run, route to engineer-router.

### To `skillzkit-product-router`

For Pencil-managed design work that uses the underlying tools:

- `/product:design:diff` uses pixelmatch internally — the
  product command provides Pencil-aware framing
- `/product:design:export` uses open-pencil's native `.fig` codec

### To `skillzkit-integrations-router`

After a build or test fails, the user may want to:

- File a GitHub issue → `/core:integrations:github`
- Post to Discord / Teams / Slack → integrations-router
- Track in Jira → `/core:integrations:jira`

These are publishing-side; this router stops at "test failed and
here's the output."

### To `skillzkit-market-router`

Tools rarely feed marketing directly, but **ImageMagick** is
used to prep brand assets for the media kit
(`/market:pr:media-kit`). Run the tool here, then hand the
output to market-router.

### To non-routed namespaces

- **`/core:frameworks:storybook:verify:*`** — for Storybook-specific
  verification (health, a11y, screenshot, interactions, deploy).
  These wrap Playwright and the Storybook test runner. Prefer
  the framework command over raw `/core:tools:playwright` when the
  intent is Storybook-scoped.
- **`/core:frameworks:storybook:chromatic`** — for Chromatic
  integration *health* (missing baselines, unreviewed changes,
  config issues). For raw `chromatic publish`, use this router's
  `/core:tools:chromatic`.

---

## Anti-patterns

Do not:

- **Apply Terraform without showing the plan.** Always run plan,
  surface the diff, and require explicit confirmation.
- **Auto-accept Chromatic baselines.** Visual regression review
  is the entire point of the tool.
- **Run npm install or update without confirmation if the user
  didn't ask.** Lock-file changes are committed; surprises hurt.
- **Run lint with `--fix` on a dirty working tree.** Suggest
  committing first, or run without `--fix` and review the
  diagnostics.
- **Read .pen files with Read or Grep.** Encrypted; use
  `/core:tools:pencil-mcp` (or `/core:tools:open-pencil` for visual).
- **Reach for raw Playwright when a Storybook verify command
  exists.** The framework command knows about story conventions.
- **Match keywords without checking project state.** "Build it"
  with no `package.json` and no `pom.xml` should prompt, not
  guess.
- **Pretend tools that aren't installed are available.** Check
  `product/.pencil-tools.json` and offer `/core:tools:setup` if the
  user wants something not present.
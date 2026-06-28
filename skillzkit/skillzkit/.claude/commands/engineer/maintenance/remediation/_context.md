# Remediation — Sub-Namespace Context (`engineer/maintenance/remediation/`)

> Read this in addition to `engineer/maintenance/_context.md`,
> `product/strategy/_context.md`, and any project-specific config the
> remediator depends on (e.g., `biome.json`,
> `components/CLAUDE.md`) whenever any
> `/engineer:maintenance:remediation:*` command runs.
>
> This sub-namespace holds **remediation routines** —
> commands that find existing drift in committed code/artifacts
> and fix it in place. Distinct from upgrade routines (which
> advance version state) and from scans (detect-only routines,
> when added).

## What remediation is

Remediation operates on the **current state** of the codebase
and reduces drift. The drift may be:

- **Lint findings** — Biome / ESLint / RuboCop / Pylint
  reports issues; remediation resolves them
- **Convention violations** — atomic-design rules, naming
  conventions, file structure conventions
- **Structural drift** — duplicate components, dead code,
  unused dependencies, stale feature flags
- **Quality findings** — Qodana / SonarQube smells,
  Snyk vulnerabilities, accessibility violations
- **Test coverage gaps** — when coverage drops below threshold

The input is "what's already there"; the output is "less drift
than before."

## Why remediation is its own archetype

Remediation differs structurally from upgrades in important
ways:

| Aspect | Remediation | Upgrades |
|--------|-------------|----------|
| Input | Current code state | Current dependency state |
| Scope unit | Files / components / lint rules | Library family groupings |
| Order | Priority by impact / auto-fixability | Risk tier (low → high, never reordered) |
| Phase 0 goal | Reconnaissance (find drift) | Validation (project healthy first) |
| User checkpoint | After discovery, before fixing (sometimes formal, sometimes implicit) | Implicit at risk-tier boundaries |
| Batch unit | 20-30 files | One library-family grouping |
| Cross-routine pattern | Pipeline composition (one routine invokes another) | Strict isolation (sister routines never interleave) |
| Failure tolerance | 3-strike rule per batch; flag for manual review | Skip grouping, document, continue |
| Idempotency mechanism | Re-run picks up new violations | Re-run compares to current dependency state |

These differences justify distinct sub-namespaces with their own
patterns.

## Remediation archetype anatomy

Beyond the universal meta-anatomy in `engineer/maintenance/_context.md`,
remediation routines have these archetype-specific elements:

### Discovery phase always read-only

Phase 0 (sometimes Phase 1, depending on routine) scans the
codebase and produces a complete drift report **without modifying
any files**. This is the "Scan everything, fix nothing" principle.
Reasons:

1. **Scope visibility** — the user sees the full extent of drift
   before any work begins
2. **Approval opportunity** — the user can choose to address all,
   subset, or none
3. **No mid-work surprises** — fixing in scan order would leave
   half-fixed states if interrupted

Some routines (e.g., `biome-issues`) make this implicit; some
(e.g., `component-dedup`) make it formal with an explicit user
approval gate. The archetype assumes discovery-first regardless;
the formality varies.

When suite-fitting existing remediators that don't have this
phase explicitly, add a discovery phase in front. Routines without
discovery are a gap to fill, not an exception to maintain.

### User checkpoint before destructive action

Some changes warrant explicit user approval, not just severity-
classified auto-fix:

- **File relocations** (atomic-design AD-13: removing `features/`
  directory; AD-11: moving feature-local atoms to core/) — destination
  decisions require human judgment
- **Duplicate consolidation** (component-dedup) — picking the
  canonical version, deciding what to keep from each duplicate's
  unique features
- **Structural changes** (atomic-design AD-5: data fetching in
  core/) — moving data-fetching from atom to higher level requires
  understanding the component's usage

Other changes are safe to auto-apply:
- Auto-fixable lint rules (Biome's `--fix` mode)
- Adding missing barrel files (`index.ts`)
- File renames per documented naming convention

The remediator's `_context.md` (or its own command file) documents
which actions auto-fix versus which prompt the user.

### Severity-classified inventory

Every remediator surfaces what it's about to do classified by
severity:

- **error**: blocks CI / breaks builds / security risk; must fix
- **warn**: code quality issue; should fix but not blocking
- **info**: optimization opportunity; nice-to-have

Severity drives execution order — errors first, warnings second,
info last (when in scope at all). Severity also informs the
final verification gate: a routine that addressed errors must
verify zero errors remain; warnings can be deferred with
documentation.

### Detection precision matters

False positives are worse than false negatives in remediation.
Reasons:

- A missed violation (false negative) gets caught in the next run
- A wrongly-flagged violation (false positive) wastes review time
  and erodes trust in the routine
- Fixing a false positive may introduce real bugs (changing
  correct code to "fix" a non-issue)

Routines therefore favor conservative detection. When in doubt,
classify as "needs human review" rather than "auto-fix."
Pattern-group searches (component-dedup) classify EXACT / NEAR /
FALSE-POSITIVE explicitly. Atomic-design rules check structure
before declaring violations.

### In-place vs PR-based fixes

Most remediation produces a series of commits on a branch that
becomes a PR. The routine doesn't auto-merge; review is human.
Some patterns:

- **Per-rule branches**: complex remediation (atomic-design across
  15 rules) may split into multiple PRs by rule, each reviewable
  independently
- **Per-area branches**: fixes scoped to one feature area get one
  PR
- **Single sweep**: simple remediation (auto-fixable lint rules)
  is one PR

The routine documents which pattern it uses. Default is
single-sweep with one PR per routine run.

### Scope-creep avoidance

Remediation routines are **scope-bounded**. A Biome remediator
doesn't fix dependency-upgrade-shaped issues. An atomic-design
remediator doesn't fix lint issues. A dedup remediator doesn't
restructure the design system.

When the routine encounters out-of-scope drift, it documents the
finding in the report (so the team can address it via the
appropriate routine) but doesn't act on it. Crossing scope creates
review-burden conflicts (different reviewers needed for different
concerns) and bisect ambiguity.

### Pipeline composition

Some remediators compose into pipelines:

- **atomic-design → component-dedup**: atomic-design's relocations
  may introduce new duplicates (when feature-local atoms move to
  core/, they may collide with existing core atoms). atomic-design
  explicitly invokes component-dedup with `all` scope after
  relocations.

When composition exists, the upstream routine documents:
- Which routine to invoke after completion
- What scope argument to use
- Why the composition matters (what failure mode it prevents)

Composition is documented per-routine. The pattern is established;
new compositions get added as routines emerge.

### Failure tolerance — 3-strike rule

When a batch fails verification (tsc, build, tests) after a fix
attempt, the routine retries up to 3 times:

- **Retry 1**: re-attempt the fix with same approach
- **Retry 2**: re-attempt with adjusted approach (smaller batch,
  different ordering)
- **Retry 3**: re-attempt one more time
- **After 3 strikes**: flag the batch for manual review, document
  in report, **skip — never auto-revert**, continue with the next
  batch

For visual-regression remediators (component-dedup), the same
pattern applies to visual diffs:
- 3 retries to resolve DRIFT/REGRESSION
- After 3 strikes, flag the diff for manual review

Auto-revert is never appropriate. The user decides whether to
revert; the routine reports.

### Project-specific architectural context

Remediators that depend on project structure document the
structure they assume:

- **biome-issues**: assumes Biome is configured (`biome.json` at
  project root); reads rule severities and auto-fix metadata
- **atomic-design**: assumes a specific app structure (5 apps +
  core/ in SkoolScout's case) and an atomic-design taxonomy
- **component-dedup**: assumes components live under
  `<project>/components/`; default scope is `core/`

When the structure differs from what the routine assumes, the
routine either:
1. Detects the difference and adapts (best)
2. Fails gracefully with a clear error (acceptable)
3. Produces incorrect results (unacceptable; this is a routine
   bug)

For routines being suite-fit from project-specific origins
(atomic-design, component-dedup), the structure assumption is
documented as a pre-condition and the routine acts as a template
that other projects adapt to their structure.

### Final verification gate

Every remediator ends with a mandatory verification gate before
declaring completion:

| Step | What it verifies |
|------|------------------|
| Re-run discovery | Drift count is now zero (or matches expected post-fix) |
| Type check | `tsc --noEmit` (or language equivalent) — no new errors |
| Lint check | Configured linter — no new errors |
| Build | Production build — exits 0 |
| Tests | Unit + integration — all pass |
| E2E (when relevant) | App still renders / regression tests pass |

Skipping any step is a guard rail violation. The specific gates
vary by routine and project; the principle is that completion
isn't declared until the project is verifiably healthy at the
new state.

## Anti-patterns specific to remediation

- **Auto-fixing structural decisions** — moving files, picking
  canonical duplicates, restructuring components requires human
  judgment. Surface for review; don't auto-apply.
- **Mixing remediation with upgrades** — fixing lint AND bumping
  dependencies in one PR creates blast-radius confusion. Run
  remediators first, then upgrades, on separate branches.
- **Crossing routine scope** — Biome remediator that "also fixes
  this small atomic-design issue I noticed" produces unbounded
  scope. Document the finding; let the right routine handle it.
- **Fix-then-discover-then-fix loops** — discover everything once,
  fix in batches, re-verify at the end. Loops produce inconsistent
  states.
- **Auto-revert on failure** — never. Flag and skip; user decides.
- **Skipping the final verification gate** — declaring completion
  without verifying the project still builds is how regressions
  ship.
- **Routines without idempotency** — re-running should be safe.
  If running twice produces different results, the routine is
  buggy.

## Routines in this sub-namespace

4 routines currently:

- **`biome-issues`** — Biome lint errors and warnings; rule
  inventory + 5 phases by auto-fixability + promotion strategy
  (warn → error)
- **`atomic-design`** — atomic-design convention enforcement;
  AD-1 through AD-15 rules + 3-tier verification (tsc + storybook
  + page-level rendering); cross-routine invocation contract with
  component-dedup; AD-7 missing-stories invokes
  `/core:frameworks:storybook:stories:gen-missing`
- **`component-dedup`** — duplicate component detection with
  pixelmatch visual regression; 3-retry budget + diagnostic table;
  reads Storybook configuration from `.pencil-storybook.json`
  manifest
- **`storybook-drift`** — Storybook namespace drift across 7
  classes (broken stories, coverage gaps, stale MDX, a11y
  violations, Chromatic baseline drift, orphaned story files,
  deploy regressions); orchestrates verify:health, verify:a11y,
  catalog, chromatic, verify:deploy as detection sources;
  dispatches verify:fix and stories:gen-missing for auto-fix;
  cross-grouping invocation pattern (lives in engineer/, invokes
  frameworks/storybook/ commands)

Future routines (placeholder gaps to fill):
- `snyk-vulnerabilities` — Snyk findings remediation
- `qodana-smells` — Qodana code-quality remediation
- `accessibility-issues` — automated a11y findings remediation
  (broader than storybook-drift's SD-4; for non-Storybook a11y)
- `dead-code` — unused exports / unused functions removal
- `unused-dependencies` — unused npm/maven/gradle deps removal
- `stale-feature-flags` — long-resolved feature flags cleanup

## Scaffold for new remediators

When adding a new remediator, see `_scaffold.md` (TBD — to be
written when first new routine is added) for the template
structure. The scaffold codifies the meta-anatomy + remediation
archetype patterns into a fill-in-the-blanks template.

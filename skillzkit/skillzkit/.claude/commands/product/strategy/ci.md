---
description: Reference guide for wiring Pencil into continuous integration. Example workflows for GitHub Actions, GitLab CI, CircleCI, plus pre-commit hooks and recommended gating thresholds. The audit command produces 5 exit codes; this doc maps them to CI gating decisions.
allowed-tools: Read
---

Reference guide for wiring Pencil into continuous integration. Not
an executable command — read for setup, copy the example workflows
into your project's CI configuration.

## What CI does for a Pencil-managed project

Three responsibilities:

1. **Gate PRs** — block merging if `audit` finds drift
2. **Validate generated artifacts** — ensure `.pen` files and React
   stay in sync
3. **Report regressions** — surface visual / contrast / pattern
   composition drift before it ships

The audit command produces 5 exit codes that map to gating
decisions:

| Exit | Meaning                          | Recommended CI action                |
| ---- | -------------------------------- | ------------------------------------ |
| 0    | All planes ok                    | Continue (PR mergeable)              |
| 1    | Warnings only                    | Continue with annotation (mergeable but flagged) |
| 2    | Failures (token / contrast / brand-fit) | Block merge; require fix       |
| 3    | Tooling / config error           | Block; surface as broken CI          |
| 4    | Brief drift only (info-severity) | Continue with annotation             |

For PR gating, **block on exit ≥ 2**. For periodic main-branch
audits, surface all exit codes as alerts but only fail builds on
exit ≥ 2.

## Example: GitHub Actions

```yaml
# .github/workflows/pencil-audit.yml
name: Pencil Audit

on:
  pull_request:
    paths:
      - 'design/**'
      - 'src/components/**'
      - 'src/patterns/**'
      - 'src/templates/**'
      - 'app/globals.css'
      - 'tailwind.config.*'
  push:
    branches: [main]
    paths:
      - 'design/**'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Install Pencil CLI
        run: npm install -g @pencil/cli
      - name: Run Pencil audit
        env:
          PENCIL_CLI_KEY: ${{ secrets.PENCIL_CLI_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: pencil run audit --json --out audit-report.json
      - name: Annotate PR with findings
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const report = require('./audit-report.json');
            const summary = `## Pencil Audit
            Exit code: ${report.exitCode}
            Findings: ${report.findings.length}
            ${report.findings.map(f => `- **${f.severity}** [${f.plane}] ${f.message}`).join('\n')}
            `;
            github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: summary
            });
      - name: Fail if blocking
        run: |
          EXIT=$(jq '.exitCode' audit-report.json)
          if [ "$EXIT" -ge 2 ]; then exit 1; fi
```

## Example: GitLab CI

```yaml
# .gitlab-ci.yml (excerpt)
pencil-audit:
  stage: validate
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - design/**
        - src/components/**
        - src/patterns/**
        - src/templates/**
        - app/globals.css
  before_script:
    - npm ci
    - npm install -g @pencil/cli
  script:
    - pencil run audit --json --out audit-report.json
    - |
      EXIT=$(jq '.exitCode' audit-report.json)
      if [ "$EXIT" -ge 2 ]; then exit 1; fi
  artifacts:
    when: always
    paths:
      - audit-report.json
    reports:
      junit: audit-report.junit.xml
  variables:
    PENCIL_CLI_KEY: $PENCIL_CLI_KEY
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
```

## Example: CircleCI

```yaml
# .circleci/config.yml (excerpt)
version: 2.1

jobs:
  pencil-audit:
    docker:
      - image: cimg/node:20.10
    steps:
      - checkout
      - run: npm ci
      - run: npm install -g @pencil/cli
      - run:
          name: Run Pencil audit
          command: |
            pencil run audit --json --out audit-report.json || true
            EXIT=$(jq '.exitCode' audit-report.json)
            if [ "$EXIT" -ge 2 ]; then
              echo "Pencil audit blocked merge (exit $EXIT)"
              cat audit-report.json
              exit 1
            fi
      - store_artifacts:
          path: audit-report.json

workflows:
  pr-validation:
    jobs:
      - pencil-audit:
          filters:
            branches:
              ignore: main
```

## Pre-commit hooks (faster local feedback)

Use [Husky](https://typicode.github.io/husky/) or
[Lefthook](https://github.com/evilmartians/lefthook) to run audit
checks locally before push.

### Husky example

```bash
# .husky/pre-push
#!/bin/sh

# Run audit on staged design + component changes only (fast)
pencil run audit --staged --planes 1,3 --json --out /tmp/audit.json
EXIT=$(jq '.exitCode' /tmp/audit.json)

if [ "$EXIT" -ge 2 ]; then
  echo "❌ Pencil audit blocked push (exit $EXIT)"
  jq '.findings[] | "  [\(.severity)] [\(.plane)] \(.message)"' /tmp/audit.json -r
  echo ""
  echo "To bypass: git push --no-verify (use sparingly)"
  exit 1
fi
```

The `--staged` flag scopes the audit to only files in the staging
area. The `--planes 1,3` argument runs only Plane 1 (code drift)
and Plane 3 (token drift) — the fastest two planes — for
sub-second pre-push feedback. Heavier planes (composition,
research-staleness) run only on CI.

## Visual regression in CI

If your project uses Storybook + visual regression (Percy, Chromatic,
Playwright snapshots), wire that as a separate CI step:

```yaml
# Storybook visual regression — runs after audit passes
visual-regression:
  needs: audit
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run build-storybook
    - run: npx playwright test --project=visual-regression
    - name: Upload diff artifacts
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: visual-diffs
        path: tests/__regression__/diff/
```

## Recommended gating thresholds

| Stage          | What to gate on                                        | Why |
| -------------- | ------------------------------------------------------ | --- |
| **Pre-commit** | Plane 1 (code drift) only                              | Fastest feedback; catches inline drift |
| **Pre-push**   | Planes 1 + 3 (code + token drift)                      | Catches token-foundation parity issues |
| **PR**         | All planes; block on exit ≥ 2                          | Full validation before merge |
| **Main**       | All planes + visual regression; alert on any change    | Surfaces drift on any merge to main |
| **Periodic**   | Plane 7b (research staleness) weekly                   | Surface aging research without blocking |

## Specific plane gating recommendations

- **Plane 1 (Code drift)**: ALWAYS gate on PR. The lints (motion /
  z-index / arbitrary value / i18n) are the quickest to fix and the
  most likely to drift.
- **Plane 2 (Design drift)**: gate on PR. Surfaces when `.pen` files
  ship without matching code updates.
- **Plane 3 (Token drift)**: gate on PR. Token parity is foundational.
- **Plane 4 (Orphans)**: warn on PR (don't block). Orphans are
  cleanup, not bugs.
- **Plane 5 (Locked divergence)**: never block. Informational only.
- **Plane 6 (Brief drift)**: warn on PR. Heuristic; not actionable
  enough to block.
- **Plane 7 (Composition / research / brand-fit)**:
  - 7a (composition): warn (recommends pattern composition but
    inline composition might be intentional)
  - 7b (research staleness): annotate, don't block
  - 7c (brand-fit / k-12 compliance variants): **BLOCK**. Missing
    K-12 / HIPAA / financial variants is a regulatory issue.

## Constrained-mode CI

For environments where MCP / Anthropic API isn't permitted, the audit
command runs against the existing `.pen` files and code without
calling external services. The lints (Plane 1) and token parity
(Plane 3) work fully offline. Composition and research planes (Plane
7) require research data already committed to the repo.

See `product/design/constrained-mode.md` for setup specifics. CI in
constrained mode skips:

- Pencil MCP server calls (uses CLI only)
- External token-from / research operations (existing data only)
- AI-generated content evaluations

Lint-driven gating still works fully.

## Failure modes and remediation

### Audit times out

Most often: large repo + Plane 7a (composition check) walking many
templates. Mitigate by scoping audit to changed files: `--changed`
flag (default off; opt in for CI).

### Audit reports a fail but local run passes

Likely a stale checkout — CI may have an older brand JSON than your
local. Add `git pull` to the CI step or pin the audit to the PR's
HEAD specifically.

### Audit fails for missing imagery assets

Plane 7's missing-asset check will fail if `imagery.assets["..."]`
keys referenced by patterns aren't populated. Run
`/product:design:foundations:imagery-select --update` to record asset URLs
or update the brand JSON manually.

### Pre-commit hook is too slow

Drop down to Plane 1 only (`--planes 1`) for sub-second feedback,
or skip entirely on rebase pushes (`--no-verify` is acceptable for
work-in-progress branches; require validation on PR open).

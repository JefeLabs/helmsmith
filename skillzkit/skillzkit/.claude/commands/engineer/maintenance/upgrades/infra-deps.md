---
type: upgrader
description: Tactfully upgrade infrastructure dependencies — Terraform core, Terraform providers, LocalStack, GitHub Actions, and Docker base images — by family groupings from lowest to highest risk. Multi-tool family scoping; plan-as-gate for Terraform; tag-pinning rule for Actions.
argument-hint: [terraform | localstack | actions | docker | all]
allowed-tools: Read, Write, Edit, Bash, mcp__context7__*
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy +
> topology detection), `engineer/maintenance/upgrades/_context.md` (upgrade
> archetype patterns + per-topology branching), `product/strategy/_context.md`.
>
> This is the infra counterpart to
> `/engineer:maintenance:upgrades:gradle-deps`,
> `/engineer:maintenance:upgrades:maven-deps`, and
> `/engineer:maintenance:upgrades:npm-deps`. Same principles, same rigor,
> adapted for Terraform + Docker + GitHub Actions semantics.

Tactfully upgrade infrastructure dependencies — **Terraform core,
Terraform providers, LocalStack, GitHub Actions, and Docker base
images** — by family groupings, proceeding from lowest to highest
risk. Upgrade one grouping at a time, fully resolve all issues
(fmt, validate, plan, CI dry-run) before moving to the next.
Never blindly bump versions.

**Invoke with:** `/engineer:maintenance:upgrades:infra-deps` + optional
argument:

- **Single scope:** `terraform`, `localstack`, `actions`, or
  `docker`
- **All scopes:** `all`
- **No argument:** defaults to `all`

## Step 0.0 — Topology detection

Detect which infra scopes are present in this repository:

```bash
# Terraform roots
find . -maxdepth 3 -name "*.tf" -type f \
  -not -path "*/.terraform/*" \
  | xargs -n1 dirname 2>/dev/null | sort -u

# LocalStack (in docker-compose files)
grep -l "localstack-pro\|localstack/localstack" \
  docker-compose*.yml 2>/dev/null

# GitHub Actions
ls .github/workflows/*.yaml .github/workflows/*.yml 2>/dev/null

# Docker base images
find . -maxdepth 3 -name "Dockerfile*" \
  -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -not -path "*/build/*"
```

**Skip any scope silently if absent.** Different projects have
different infra surfaces:

- Some have only Terraform; some have only Dockerfile + GH Actions;
  some have all four
- Multi-root Terraform (separate `.infra/` and `.infra-shared/`
  for example) requires both roots to upgrade together for
  shared providers

Detection output goes into the routine report:

```
Infra scopes detected:
- Terraform roots: <list>
- LocalStack:      <yes/no, with image tag if yes>
- GH Actions:      <count of workflow files>
- Docker:          <Dockerfile count>

Targeting: <user-selected scope or "all">
```

## Principles

1. **Group by tool family.** Terraform core, Terraform providers,
   GH Actions, LocalStack, and Docker bases are separate families
   — never mix in one commit.
2. **Low-to-high risk, always.** Never jump ahead in the tier
   order.
3. **`plan` is a gate, not a preview.** For Terraform, a clean
   `plan` with zero resource replacements is a hard requirement
   before committing a provider bump. A grouping that forces
   replacement is a SKIP unless the user explicitly opts in.
4. **Respect tag-pinning rule.** GitHub Actions upgrades MUST use
   version tags (`@v5`), NOT commit SHAs. Verify the tag resolves
   on GitHub before committing.
5. **Preserve constraint style.** If `required_providers` uses
   `~> 6.0`, keep the pessimistic operator. If a workflow uses
   `@v4`, keep major-tag pinning (don't pin to `@v4.2.1`).
6. **Multi-root coordination.** When a project has multiple
   Terraform roots, every Terraform step MUST run against all of
   them. A bump to a shared provider (e.g., `hashicorp/aws`)
   needs to pass `plan` in all roots before committing.
7. **One grouping, one commit.**

## Phase 0: Reconnaissance

### 0.1 Detect Infra Scopes Present

(Done in Step 0.0 above. Capture the targeted scopes.)

### 0.2 Validate Baseline

**Do not upgrade on top of a broken project.**

#### Terraform (per root)

For each detected Terraform root:

```bash
(cd <tf-root> && terraform fmt -check -recursive \
  && terraform init -upgrade=false -backend=false \
  && terraform validate)
(cd <tf-root> && terraform plan -detailed-exitcode -lock=false \
  -out=/tmp/baseline-<tf-root>.tfplan 2>&1 || true)
```

`plan` exit codes: `0` = no changes, `2` = changes pending
(baseline drift), `1` = error.

If the baseline `plan` already shows pending changes, **stop** —
fix drift before upgrading.

**Lock file note:** when `.terraform.lock.hcl` is committed, exact
provider versions are pinned across checkouts. When it's not
committed, you can read the **constraint** (e.g., `~> 5.99`)
from `provider.tf` but not the exact resolved version.

#### LocalStack (when present)

```bash
docker compose -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.local.yml up -d localstack
sleep 10
curl -sf http://localhost:4566/_localstack/health | jq '.services' | head
docker compose -f docker-compose.local.yml down
```

**License note:** when the project uses `localstack-pro` (paid
tier), verify the org's LocalStack Pro license is active before
bumping — a newer image may require a newer license tier, and a
breaking image tag will make local dev unavailable for every
engineer.

#### Other docker-compose files

```bash
for f in docker-compose*.yml app-service/docker-compose*.yml; do
  [ -f "$f" ] && docker compose -f "$f" config --quiet && echo "$f OK"
done
```

These are parsed for validity only — they aren't brought up
during baseline because they're not part of the bump gate.

#### GitHub Actions

```bash
# Syntax check via actionlint if available, else yq parse
command -v actionlint >/dev/null && actionlint || \
  for f in .github/workflows/*.y*ml; do
    yq eval '.' "$f" >/dev/null || echo "PARSE FAIL: $f"
  done
```

Also record current pins:

```bash
grep -rhE "uses:\s*[^@]+@" .github/workflows/ | sort -u
```

#### Docker Base

```bash
for df in $(find . -maxdepth 3 -name "Dockerfile*" \
  -not -path "*/node_modules/*"); do
  echo "=== $df ==="
  grep -E "^FROM " "$df"
  # Validate with a dry build of first stage if possible
  docker build --target $(grep -E "^FROM .* AS " "$df" | head -1 | awk '{print $4}') \
    --no-cache -f "$df" . 2>&1 | tail -5 || echo "dry-build unsupported"
done
```

### 0.3 Collect Outdated Versions

#### Terraform Core

```bash
terraform version
# Compare against: https://github.com/hashicorp/terraform/releases/latest
# ALSO compare against the setup-terraform pin in CI:
grep -rE "terraform_version:\s*" .github/workflows/ | head
# Never upgrade Terraform core above what CI runs. If CI lags, either:
#   (a) bump CI's terraform_version in the SAME commit, or
#   (b) pin to CI's current version and defer.
```

#### Terraform Providers

```bash
for tf_root in <list>; do
  (cd "$tf_root" && terraform providers)
done

# Constraints in provider.tf for each root. Example:
#   aws = { source = "hashicorp/aws", version = "~> 5.99" }
#   template = { source = "hashicorp/template", version = "~> 2.2.0" }
```

For each provider, query the registry for the latest version:

```bash
curl -s https://registry.terraform.io/v1/providers/hashicorp/aws \
  | jq -r '.version'
```

**Flag deprecated providers** specially:

- **`hashicorp/template`** — deprecated by HashiCorp, maintenance-
  only mode. Recommended migration: use the `templatefile()`
  built-in function (Terraform 0.12+) and remove the provider
  entirely. Do NOT upgrade `hashicorp/template`; flag for
  migration ticket instead.

#### LocalStack (when present)

```bash
grep -E "localstack-pro:" docker-compose*.yml
# Compare to: https://hub.docker.com/v2/repositories/localstack/localstack-pro/tags/
curl -s "https://hub.docker.com/v2/repositories/localstack/localstack-pro/tags/?page_size=20" \
  | jq -r '.results[].name' \
  | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
  | sort -V | tail -5
```

#### GitHub Actions

For each `uses: org/repo@vX` line, query the repo's latest release
tag:

```bash
grep -rhoE 'uses:\s*[^@]+@v[0-9]+' .github/workflows/ \
  | sed 's/uses:\s*//; s/@.*//' \
  | sort -u \
  | while read -r action; do
      latest=$(gh api "repos/${action}/releases/latest" --jq '.tag_name' 2>/dev/null || echo "?")
      echo "${action}: ${latest}"
    done
```

Record `current → latest` per action.

#### Docker Base

```bash
for df in <list-of-dockerfiles>; do
  echo "=== $df ==="
  grep -E "^FROM " "$df"
  # Look up newer stable tags for each base image on Docker Hub / ECR Public
done
```

### 0.4 Build the Grouping Plan

Organize findings into these families:

- **T1-core** — Terraform core (binary + `required_version` in all
  roots + CI `setup-terraform` pin)
- **T2-providers-patch** — provider patch bumps
- **T2-providers-minor** — provider minor bumps
- **T3-providers-major** — provider major bumps (high risk; need
  `plan` analysis for replacements)
- **A1-actions-official-patch** — official actions (actions/*) patches
- **A1-actions-official-minor** — official actions minors
- **A2-actions-third-party** — third-party action versions
- **A3-actions-major** — major action bumps
- **L1-localstack** — LocalStack Pro image bumps
- **D1-docker-base** — Docker base image bumps

## Phase 1: Execute Groupings (in tier order)

For each grouping in tier order:

### Step 1 — Update version

Edit the relevant config:
- Terraform core: bump `required_version` in all `provider.tf` roots
  AND CI's `setup-terraform` `terraform_version` input
- Provider: update `version` constraint in `provider.tf` (all roots
  if shared)
- Action: update `@vX` tag in workflow files
- LocalStack: update image tag in docker-compose files
- Docker base: update `FROM` line in Dockerfile

### Step 2 — Validate

Run validation appropriate to the tool:

```bash
# Terraform (per root)
for tf_root in <list>; do
  (cd "$tf_root" && terraform init -upgrade && terraform validate)
done

# Actions: actionlint (if available)
command -v actionlint >/dev/null && actionlint

# Docker: dry build
docker build --no-cache -f <Dockerfile> . | tail -10
```

### Step 3 — Plan (Terraform-specific)

```bash
for tf_root in <list>; do
  echo "=== $tf_root ==="
  (cd "$tf_root" && terraform plan -out=/tmp/grouping-${tf_root#.}.tfplan)
done
```

**Inspect the plan output for replacements**:

```
^.*forces replacement
^.*must be replaced
```

If any line indicates replacement, evaluate:

1. Is this replacement acceptable?
   - **Stateful resources** (S3, RDS, DynamoDB, Cognito): almost
     always **NO** — replacement loses data
   - **Stateless resources** (IAM policies, security groups,
     null_resources): often **YES**
2. Can a `moved {}` block or `lifecycle { ignore_changes }` avoid
   it?
3. If not, **SKIP the grouping** and note it in the report

### Step 4 — Verify across multi-root coordination

When the grouping touches a shared resource (e.g., `hashicorp/aws`
across multiple TF roots), verify all roots together:

```bash
for tf_root in <list>; do
  echo "=== $tf_root ==="
  (cd "$tf_root" && terraform plan -detailed-exitcode -lock=false)
done
```

All roots must show clean plans (exit 0) before committing.

### Step 5 — Commit

```
chore(infra): upgrade <grouping-name>

<tool>: <old> → <new>

Validation:
- terraform plan (root1):  <clean|N safe updates>
- terraform plan (root2):  <clean|N safe updates>
- localstack health:       <OK|N/A>
- actionlint:              <clean|N/A>
- dockerfile build:        <PASS|N/A>
```

### Step 6 — Advance

Automatically proceed to the next grouping. Pause once before
entering Tier 3 to inform the user:

```
Tiers 1–2 complete. Entering Tier 3 (high-risk groupings).
Next: <grouping>. Terraform plan will be inspected closely for
replacements in all <N> roots.
```

## Major Bump Pre-Flight (Tier 3 only)

Before any Tier 3 major bump, run these extra steps:

### Fetch Migration Guide via context7

```
mcp__context7__resolve-library-id → "terraform-provider-aws" | "actions/checkout" | etc.
mcp__context7__query-docs → "<library> migration v<old> to v<new>"
```

Key things to extract for **AWS provider majors**:

- Removed/renamed resources (e.g., `aws_s3_bucket_*` sub-resources
  split in v4)
- Attribute type changes (string → list, map → object)
- New required arguments
- Default value changes that trigger replacement

Key things for **GitHub Actions majors** (e.g.,
`actions/checkout@v4 → @v5`):

- Runtime change (Node 16 → Node 20 → Node 22)
- Removed inputs
- Changed default behaviors

### Dry-Run Terraform Plan in BOTH/ALL roots

```bash
for tf_root in <list>; do
  echo "=== $tf_root ==="
  (cd "$tf_root" && terraform init -upgrade \
    && terraform plan -out=/tmp/major-${tf_root#.}.tfplan)
  terraform -chdir="$tf_root" show "/tmp/major-${tf_root#.}.tfplan" \
    | grep -E "^\s*[-+~]|# .* will be|forces replacement" | head -50
done
```

If any line contains `must be replaced` or `forces replacement` in
ANY root, extract the offending resources and evaluate per the
acceptable/unacceptable framework above.

### Check the CI `setup-terraform` pin

```bash
grep -rE "terraform_version:\s*" .github/workflows/ | head
```

If the CI pin is BELOW the version you're about to commit, bump
CI in the same commit — otherwise CI will fail with a
state-file-format error.

## Phase 2: Final Verification

```bash
# Terraform (all roots)
for tf_root in <list>; do
  echo "=== $tf_root ==="
  (cd "$tf_root" && terraform fmt -check -recursive \
    && terraform validate \
    && terraform plan -detailed-exitcode -lock=false)
done

# docker-compose files all parse
for f in docker-compose*.yml app-service/docker-compose*.yml; do
  [ -f "$f" ] && docker compose -f "$f" config --quiet && echo "$f OK"
done

# Actions
command -v actionlint && actionlint

# Dockerfile (each)
for df in <list-of-dockerfiles>; do
  docker build --no-cache -f "$df" . >/dev/null && echo "$df OK"
done
```

Compare before/after pins and produce the report.

## Phase 3: Report

```
## Infra Upgrade Report

### Completed Groupings
| # | Tier | Grouping | Items | Status |
|---|------|----------|-------|--------|
| 1 | 1.1  | actions/* official | 4 | DONE |
| 2 | 1.2  | third-party actions | 2 | DONE |
| 3 | 2.1  | LocalStack Pro | 1 | DONE |
| 4 | 2.2  | Dockerfile base | 1 | DONE |
| 5 | 3.1  | hashicorp/aws 5.99 → 6.x | 1 | SKIPPED — 3 S3 replacements |
| 6 | 3.2  | other providers | 0 | N/A |
| 7 | 3.3  | hashicorp/template | 1 | SKIPPED — deprecated, needs templatefile() migration |
| 8 | 3.4  | Terraform core | 1 | DONE |

### Skipped / Pinned
| Grouping | Reason |
|----------|--------|
| aws 5.99 → 6.x | `aws_s3_bucket_lifecycle` attribute rename forces replacement on 3 buckets. Needs `moved {}` migration. |
| hashicorp/template | Provider deprecated. Migration to `templatefile()` is the real fix, not a version bump. |

### Final Status
- terraform fmt/validate (all roots): PASS
- terraform plan (all roots):         0 changes
- LocalStack Pro health:              OK
- actionlint:                         clean
- Dockerfile build:                   PASS
- CI setup-terraform pin:             updated to match
```

## Guard Rails

- **Never SHA-pin GitHub Actions.** Version tags only.
- **Never `terraform apply`.** This routine only runs `plan`.
  Apply is always a human step.
- **Never `--force` terraform init.** If lock file conflicts
  appear, delete `.terraform/` and re-init cleanly.
- **Never upgrade Terraform core past what CI uses.** Check CI's
  `terraform_version` first. If CI needs to move, bump it in the
  SAME commit as the root `required_version` bump.
- **Never upgrade LocalStack past the Pro license tier the org
  pays for.** Verify license compatibility before touching the
  tag.
- **Never bundle multi-root provider bumps into separate commits.**
  When multiple TF roots share a provider, they must move together
  to stay in sync. A single grouping commit touches all roots'
  `provider.tf`.
- **Never touch `hashicorp/template`.** It's deprecated. Flag the
  migration to `templatefile()` as a separate ticket instead.
- **Inspect every `plan` diff manually for replacements before
  committing a provider bump.** Stateful resources (S3, RDS,
  DynamoDB, Cognito) must never be replaced silently.
- **One grouping, one commit.**
- **Rollback is normal.**
- **Follow-up: commit `.terraform.lock.hcl` for all roots when
  not committed.** Without it, exact provider versions drift
  between checkouts and `plan` reproducibility suffers. Not in
  scope for a dep-upgrade session, but flag in the Phase 3
  report.

## Rollback

If a grouping goes sideways mid-resolution:

```bash
# Discard all uncommitted infra changes
git checkout -- <tf-roots>/ docker-compose*.yml \
  .github/workflows/ Dockerfile

# Re-init terraform from the committed state for all roots
for tf_root in <list>; do
  (cd "$tf_root" && rm -rf .terraform && terraform init -backend=false)
done
```

If the entire upgrade session needs to be undone:

```bash
git log --oneline -20
# Ask user before resetting
```

Never force-reset without user confirmation.

## Interaction with Sibling Upgrade Commands

This routine is one of the dep-upgrade family in `engineer/maintenance/upgrades/`.
**Never interleave** sister upgraders:

| Routine | Scope | Branch convention |
|---|---|---|
| `/engineer:maintenance:upgrades:npm-deps` | npm/JS projects | `chore/npm-upgrade-<date>` |
| `/engineer:maintenance:upgrades:gradle-deps` | Gradle/JVM projects | `chore/gradle-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:maven-deps` | Maven/JVM projects | `chore/maven-deps-upgrade-<date>` |
| `/engineer:maintenance:upgrades:infra-deps` | Infra (this routine) | `chore/infra-deps-upgrade-<date>` |

Run one to completion (CI green or all groupings committed/SKIPPED),
push and open the PR, THEN start the next. Each creates its own
`chore/*-deps-upgrade-<date>` branch — never share a branch
between them, so bisect and revert stay clean.

The `polyglot-maintenance-cycle` workflow's state machine
enforces this — it won't start a sister upgrade routine until
the current one's branch is committed/PR'd.

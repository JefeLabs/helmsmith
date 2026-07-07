---
description: Terraform infrastructure-as-code for cloud resource provisioning. CLI only — no MCP. Used by infrastructure work for AWS (ECS, Aurora, CloudFront, NAT Gateways, VPC Endpoints), GCP, Azure, and other providers. Heavily relevant for SkoolScout AWS optimization and TourneySeason multi-region deployments.
argument-hint: <free-form-prompt> [<command>] [-target=<resource>] [-var=<key=value>] [--workspace <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of Terraform for infrastructure operations.
Used by infrastructure-related routines and ad-hoc cloud
resource management.

## Phase 0: pre-flight

1. Verify terraform active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.terraform.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Terraform not active. Run /core:tools:setup terraform"
     exit 1
   fi
   ```

2. Verify Terraform is invokable:

   ```bash
   if ! command -v terraform >/dev/null 2>&1; then
     # Some teams use OpenTofu (open-source Terraform fork)
     if command -v tofu >/dev/null 2>&1; then
       TF_CMD="tofu"
       echo "Using OpenTofu (tofu) instead of terraform"
     else
       echo "Terraform not installed."
       echo "  macOS:   brew install terraform"
       echo "  Linux:   see https://developer.hashicorp.com/terraform/install"
       echo "  Windows: choco install terraform"
       echo ""
       echo "Or install OpenTofu (open-source fork): https://opentofu.org/"
       exit 1
     fi
   else
     TF_CMD="terraform"
   fi
   ```

3. Verify working directory has Terraform config:

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.terraform.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   if ! ls "${PROJECT_ROOT}"/*.tf >/dev/null 2>&1 && \
      ! ls "${PROJECT_ROOT}"/*.tf.json >/dev/null 2>&1; then
     echo "No Terraform config files found at ${PROJECT_ROOT}"
     echo "Terraform expects .tf or .tf.json files in the working dir"
     exit 1
   fi
   ```

4. Verify state backend is configured:

   ```bash
   # Check for terraform { backend "..." } block
   if grep -q 'terraform\s*{[^}]*backend' "${PROJECT_ROOT}"/*.tf 2>/dev/null; then
     echo "Backend configuration detected"
   else
     echo "Note: No backend configured; using local state."
     echo "For team work, configure remote state (S3 + DynamoDB lock,"
     echo "Terraform Cloud, etc.)"
   fi
   ```

## Phase 1: prompt interpretation

Terraform operations:

### State operations

- **init** — initialize working directory (download providers,
  configure backend)
- **plan** — preview changes without applying
- **apply** — apply planned changes
- **destroy** — tear down resources
- **state list** — list resources in state
- **state show <addr>** — inspect specific resource
- **state mv** — move resources within state
- **import** — bring existing infrastructure into state

### Validation and inspection

- **validate** — check syntax and provider config
- **fmt** — format .tf files
- **plan -detailed-exitcode** — exit code indicates change presence
- **show** — inspect current state or plan file
- **graph** — produce DOT visualization of resource graph

### Workspace management

- **workspace list / new / select** — manage workspaces
  (typically environments: dev, staging, prod)

### Provider management

- **providers** — list configured providers
- **init -upgrade** — update provider plugins

### Diagnostic operations

- **console** — interactive REPL for HCL expressions
- **output** — show output values
- **refresh** — reconcile state with real infrastructure

## Phase 2: execution

### Standard plan/apply workflow

```bash
# Initialize (first time, or after backend changes)
$TF_CMD init

# Format check
$TF_CMD fmt -check -recursive

# Validate syntax
$TF_CMD validate

# Plan (preview)
$TF_CMD plan -out=tfplan.bin

# Apply the saved plan
$TF_CMD apply tfplan.bin

# Or interactive apply (no saved plan)
$TF_CMD apply
```

### Targeted operations

```bash
# Plan only specific resource
$TF_CMD plan -target=aws_ecs_service.api

# Apply with variable
$TF_CMD apply -var="env=staging"

# Apply with var file
$TF_CMD apply -var-file=environments/staging.tfvars
```

### State manipulation

```bash
# List all resources
$TF_CMD state list

# Inspect a resource
$TF_CMD state show 'aws_ecs_service.api'

# Remove a resource from state (without destroying it)
$TF_CMD state rm 'aws_s3_bucket.legacy_bucket'

# Import existing resource into state
$TF_CMD import 'aws_ecs_service.api' arn:aws:ecs:...

# Move a resource (e.g., after refactoring)
$TF_CMD state mv 'aws_ecs_service.old' 'module.api.aws_ecs_service.main'
```

### Workspace switching

```bash
# List workspaces
$TF_CMD workspace list

# Switch
$TF_CMD workspace select staging

# Create new
$TF_CMD workspace new dev
```

### Read-only operations

```bash
# Format check (CI-friendly; non-destructive)
$TF_CMD fmt -check -recursive

# Validate
$TF_CMD validate

# Plan with detailed exit code
$TF_CMD plan -detailed-exitcode
# Exit codes: 0 (no changes), 1 (error), 2 (changes pending)

# Show current state
$TF_CMD show

# Show pending plan
$TF_CMD show tfplan.bin
```

## Phase 3: result formatting

### Plan summary

```
=== Terraform Plan ===
Project:    skoolscout-infra
Workspace:  staging
Provider:   aws (5.61.0)

Plan: 3 to add, 1 to change, 0 to destroy

Changes detected:
  + aws_ecs_service.api  (replacement)
      Reason: Container image changed
      Downtime: ~30s during replacement
  
  + aws_cloudwatch_log_group.api_logs (new)
      Retention: 30 days
  
  + aws_iam_role_policy.api_logs (new)
      Permissions: cloudwatch:CreateLogStream, etc.
  
  ~ aws_security_group.api_sg
      Modified: ingress rule added for port 8443

Apply this plan? [y/N]
```

### Apply result

```
=== Terraform Apply ===
Project:    skoolscout-infra
Workspace:  staging
Duration:   2m 34s

Applied:
  ✓ aws_cloudwatch_log_group.api_logs created
  ✓ aws_iam_role_policy.api_logs created
  ✓ aws_security_group.api_sg modified
  ✓ aws_ecs_service.api replaced

Outputs:
  api_endpoint = "https://api-staging.example.com"
  log_group    = "/aws/ecs/skoolscout-api-staging"

Status: SUCCESS
```

### State inspection

```
=== Terraform State: skoolscout-infra/staging ===
Workspace: staging
Resources: 87

By type:
  aws_ecs_service           :  3
  aws_ecs_task_definition   :  3
  aws_security_group        :  4
  aws_iam_role              :  6
  aws_iam_role_policy       :  8
  aws_cloudwatch_log_group  :  5
  aws_lb                    :  2
  aws_lb_listener           :  4
  aws_lb_target_group       :  6
  aws_route53_record        :  4
  aws_rds_cluster           :  1
  aws_rds_cluster_instance  :  2
  ... (39 more)

Total tracked: 87 resources
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `Error acquiring the state lock` | Another operation in progress (or stale lock) | Wait, or force-unlock if stale: `terraform force-unlock <id>` |
| Provider authentication failed | AWS / cloud credentials missing | Check provider auth (env vars, ~/.aws/credentials, etc.) |
| `Error: No state file was found!` | Backend not initialized | Run `terraform init` |
| Plan shows unexpected destroy | Resource was renamed or refactored | Use `state mv` to update state without destroying |
| Provider version conflict | terraform.lock.hcl out of sync | `terraform init -upgrade` |

## Cross-namespace integration

Terraform is consumed by:

- **Infrastructure work commands** (when added) — provisioning,
  upgrades, drift detection
- **`engineer/architecture/workflows/capability-introduction`**
  — when introducing capabilities that need infrastructure
  (new database, new compute, new edge config)
- **Cost optimization workflows** (relevant to SkoolScout's
  ~$450/month AWS spend) — VPC Endpoints replacing NAT
  Gateways, Aurora Serverless v2 scaling, ALB consolidation

## Distinction from cloud CLIs

| Tool | Best for |
|------|----------|
| Terraform | Declarative infrastructure (multiple resources, state-tracked) |
| AWS CLI / gcloud / az | Imperative one-off operations, scripts |
| Cloud SDKs (boto3, etc.) | Application-level cloud calls |

Terraform manages durable infrastructure declaratively. Cloud
CLIs are appropriate for one-off queries, scripts that don't
need state, and operations Terraform doesn't model well
(certain admin operations).

## What this tool does NOT do

- **Manage cloud authentication.** Provider auth is handled
  by AWS/GCP/Azure CLI tooling, env vars, or instance roles.
  Terraform reads from those sources.
- **Replace cloud-native CLIs.** AWS CLI, gcloud, az are
  separate tools; Terraform is for declarative infrastructure
  management.
- **Edit .tf files directly.** Some operations modify lockfile
  via `terraform init -upgrade`; .tf source edits are
  user/agent work.
- **Auto-rollback on failure.** Terraform applies what it can;
  partial-apply states need manual intervention.
- **Manage Terraform Cloud / Spacelift workflows.** Those
  layers wrap Terraform; the suite invokes Terraform directly.

## Examples

```bash
# Initialize
/core:tools:terraform "initialize the working directory"

# Plan changes
/core:tools:terraform "plan changes"

# Apply (with confirmation)
/core:tools:terraform "apply the plan"

# Plan a specific resource
/core:tools:terraform "plan changes to the api ECS service" \
  -target=aws_ecs_service.api

# Show state
/core:tools:terraform "show me what's in state"

# Switch workspace
/core:tools:terraform "switch to staging workspace"

# Format check
/core:tools:terraform "check formatting of all tf files"
```

---

# Registry definition

## Tool metadata

```yaml
name: terraform
displayName: Terraform
provider: hashicorp
category: infrastructure-as-code
optional: true   # only required when project uses Terraform
mutuallyExclusive: []   # can coexist with Pulumi, CDK, etc.
```

## Interfaces

### CLI

```yaml
executable: terraform (or tofu for OpenTofu)
detectionCommand: |
  command -v terraform || command -v tofu
installCommand: |
  Terraform:
    macOS:   brew install terraform
    Linux:   See https://developer.hashicorp.com/terraform/install
    Windows: choco install terraform
  
  OpenTofu (open-source fork; same syntax, BSL-license-free):
    macOS:   brew install opentofu
    Linux:   See https://opentofu.org/docs/intro/install/
notes: |
  Suite detects either terraform or tofu and uses whichever
  is available. OpenTofu is a community-maintained fork after
  HashiCorp's BSL license change. For most operations the
  commands are interchangeable.
```

### MCP

**Not available.** No widely-adopted Terraform MCP. Some
community MCPs exist for state inspection but aren't
canonical.

## Version constraint

Recommended: Terraform 1.6+ (or OpenTofu 1.6+). Pin via
`required_version` in `terraform { ... }` block.

## Required by skillz commands

Auto-populated. Currently:
- (Future) Infrastructure-related commands

## Cross-tool dependencies

- Cloud provider CLI (AWS CLI for AWS provider, gcloud for
  GCP, etc.) — for authentication
- Backend storage (S3, GCS, Terraform Cloud, etc.) — for
  remote state

## System requirements

- ~80 MB disk for the binary
- Network: HTTPS to provider registries (registry.terraform.io,
  or registry.opentofu.org)
- Cloud provider credentials configured

## State backend considerations

For team / production use, configure remote state:

- **AWS**: S3 backend with DynamoDB lock
- **GCP**: GCS backend with object versioning
- **Azure**: Azure Storage backend
- **Terraform Cloud**: hosted state with team workflows
- **Local** (development only): file-based state

The suite reads but doesn't configure backends; user manages
in `terraform { backend "..." {} }` block.

## Compliance considerations

Financial institution Terraform setups typically:
- Use private provider registries (corporate registries)
- Have approval workflows (Terraform Cloud, Spacelift,
  Atlantis) gating apply operations
- Restrict who can apply via IAM / SSO integration
- Audit all state changes

The suite invokes Terraform locally; integration with
approval workflows happens at the workflow layer, not in
this tool.

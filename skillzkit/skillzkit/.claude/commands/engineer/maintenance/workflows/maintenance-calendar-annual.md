---
type: workflow
outcome: Plan annual maintenance calendar
description: Strategic 12-month maintenance planning. Per-ecosystem cadence targets, compliance-driven scan frequency, capacity assumptions, risk tolerance settings. Outputs `.pencil-maintenance-calendar.json` for downstream cycle workflows to consume.
estimatedDuration: 2-4 hours interactive (single working session)
phases: 7
prerequisites:
  - Repository topology established (the project has detectable ecosystems)
  - Honest team capacity input available (maintenance hours/week or hours/cycle)
  - Compliance requirements documented (FERPA/COPPA/HIPAA/PCI-DSS/SOC2 if applicable)
  - Historical maintenance data if available (informs realistic cadence targets)
---

# Workflow — Maintenance Calendar Annual Planning

> **When to use**: planning maintenance cadence at fiscal year
> start, when compliance requirements shift, when team capacity
> changes materially, or when the previous cadence has failed
> (consistently overdue cycles, missed compliance windows).
>
> **When NOT to use**:
> - Tactical execution (use `engineer:polyglot-maintenance-cycle`)
> - Single-ecosystem cadence-setting (do it inline in the
>   ecosystem's routine; don't run a workflow)
> - Mid-year minor adjustments (edit
>   `.pencil-maintenance-calendar.json` directly; quarterly
>   review checkpoint catches this)
> - Marketing planning (use
>   `market:marketing-calendar-annual`)

## Outputs of a complete run

- **`product/.pencil-maintenance-calendar.json`** — the canonical
  maintenance calendar manifest with all cadence targets,
  compliance constraints, capacity assumptions, and risk
  tolerance settings
- **Human-readable strategy doc** — narrative version of the
  calendar for team alignment
- **Quarterly review checkpoints scheduled** — calendar entries
  for review meetings

## Phase 1 — Pre-flight + capacity baseline

Establish the current state before designing forward.

### Repository topology

Run the same topology census as
`polyglot-maintenance-cycle.md` Phase 1 to inventory ecosystems.
The annual calendar plans for what's actually present.

### Historical data

If a previous calendar exists at
`product/.pencil-maintenance-calendar.json`:

- How many cycles ran last year? (Target vs actual)
- Which ecosystems were over/under-served?
- What was deferred most often?
- Where did compliance windows get missed?

If no previous calendar exists, this is a greenfield planning
session — note it in the strategy doc.

### Honest capacity

The team's maintenance time, declared honestly:

```
Maintenance Capacity Assessment

Team size:                            <N engineers>
Time allocated to maintenance:        <X% of engineering time>
Hours/week per engineer:              <H>
Total maintenance hours/week:         <N * H * X%>
Cycle frequency:                      <weekly | biweekly | monthly>
Hours per cycle:                      <derived>

70% planning ratchet applied:         <hours per cycle * 0.7>
```

The 70% ratchet (consistent with `marketing-calendar-annual`)
leaves slack for unplanned work, security incidents, and the
occasional rollback. **Plan to 70%; that's the realistic ceiling.**

**Mark complete**: `/core:workflows:manage complete preflight-capacity`

## Phase 2 — Capacity input (the honest conversation)

Surface the capacity numbers and force the calibration conversation:

```
Available maintenance time per cycle: <N hours>
Compliance non-negotiables per cycle: <hours>
Available for elective work:          <N - compliance hours>
```

If "available for elective work" is < 50% of total capacity,
escalate: compliance is consuming most of maintenance capacity,
and there's no room for technical-debt remediation. The team has
a structural problem.

If "available for elective work" is > 80% of total capacity and
compliance items exist: are compliance hours estimated too low?
Re-check.

The right answer is usually 50-70% available for elective work
after compliance non-negotiables. This drives all subsequent
phases.

**Mark complete**: `/core:workflows:manage complete capacity-input`

## Phase 3 — Per-ecosystem cadence targets

For each detected ecosystem, set cadence targets. Defaults:

### Security scans (per-ecosystem)

| Project type | Default cadence | Compliance override |
|--------------|-----------------|---------------------|
| Standard | Monthly | — |
| FERPA / COPPA (ed-tech) | Biweekly | Required |
| HIPAA | Weekly | Required |
| PCI-DSS | Weekly | Required |
| SOC 2 | Monthly | Required |

### npm dependencies

| Bump type | Default cadence |
|-----------|-----------------|
| Patches | Monthly |
| Minors | Monthly (alongside patches) |
| Majors | Quarterly review (run separately when needed) |

### Gradle / Maven dependencies

| Bump type | Default cadence |
|-----------|-----------------|
| Patches | Monthly |
| Minors | Quarterly |
| Majors | Quarterly review (semi-annual major migrations typical) |

### Infra dependencies

| Tool | Default cadence |
|------|-----------------|
| Terraform providers (patch/minor) | Quarterly |
| Terraform core | Annually (or when CI mandates) |
| GitHub Actions | Monthly (high-frequency releases) |
| Docker base images | Monthly |
| LocalStack | Monthly when Pro license active |

### Code quality remediation

| Routine | Default cadence |
|---------|-----------------|
| Biome lint cleanup | Continuous (on every PR via CI) + monthly sweep |
| Atomic-design enforcement | Quarterly (project-specific) |
| Component dedup | Quarterly + post-relocation pipelines |

### Full audit

| Audit scope | Default cadence |
|-------------|-----------------|
| Plane 11 (maintenance drift) | Every cycle |
| All planes | Quarterly |
| Annual review | Annually |

Adjust defaults based on:
- Compliance constraints (override defaults to required cadence)
- Team capacity (relax defaults when capacity is below threshold)
- Project maturity (early-stage projects can run looser cadence
  on majors; mature projects need tighter)

**Mark complete**: `/core:workflows:manage complete cadence-targets`

## Phase 4 — Compliance-driven cadence

Document compliance requirements as constraints (not preferences):

```json
{
  "compliance": {
    "frameworks": ["FERPA", "COPPA"],
    "constraints": [
      {
        "framework": "FERPA",
        "constraint": "Security scans biweekly minimum",
        "applies_to": ["npm", "gradle", "maven", "infra"]
      },
      {
        "framework": "FERPA",
        "constraint": "Critical CVE remediation within 30 days",
        "applies_to": ["all"]
      },
      {
        "framework": "COPPA",
        "constraint": "Annual penetration testing",
        "applies_to": ["infrastructure"]
      }
    ]
  }
}
```

These constraints take priority over elective cadence targets.
When the cycle workflow runs, compliance items dispatch first.

**Mark complete**: `/core:workflows:manage complete compliance-cadence`

## Phase 5 — Risk tolerance settings

Establish what triggers immediate action vs scheduled action.

```json
{
  "risk_tolerance": {
    "auto_dispatch_triggers": [
      "Critical CVE in active dependency",
      "Compliance scan overdue by >7 days",
      "Production incident traced to outdated dependency"
    ],
    "scheduled_dispatch_triggers": [
      "High CVE in active dependency",
      "Routine cadence reached"
    ],
    "deferable_triggers": [
      "Medium / Low CVE",
      "Outdated patch >90 days",
      "Cosmetic lint findings"
    ]
  }
}
```

These determine cycle scheduling behavior:

- **Auto-dispatch**: trigger an out-of-band cycle even if the next
  scheduled cycle is days away
- **Scheduled-dispatch**: queue for next scheduled cycle
- **Deferable**: queue but allow capacity-driven deferral

**Mark complete**: `/core:workflows:manage complete risk-tolerance`

## Phase 6 — Persist to manifest

Write the canonical maintenance calendar manifest:

```bash
# Path
DESIGN_DIR=design
mkdir -p "$DESIGN_DIR"
```

```json
// product/.pencil-maintenance-calendar.json
{
  "$schema": "../.product-maintenance-calendar-schema.json",
  "version": 1,
  "last_updated": "2026-05-03",
  "last_updated_by": "/core:workflows:manage start engineer:maintenance-calendar-annual",

  "capacity": {
    "team_size": 3,
    "maintenance_allocation_pct": 20,
    "hours_per_cycle": 24,
    "planning_ratchet": 0.7,
    "available_for_elective": 14
  },

  "compliance": {
    "frameworks": ["FERPA", "COPPA"],
    "constraints": [
      {
        "framework": "FERPA",
        "constraint": "Security scans biweekly minimum",
        "applies_to": ["npm", "gradle", "maven", "infra"]
      }
    ]
  },

  "ecosystems": {
    "npm": {
      "roots": ["app-ui/"],
      "cadence": {
        "patches": "monthly",
        "minors": "monthly",
        "majors": "quarterly-review"
      },
      "last_run": "2026-04-04",
      "next_target": "2026-05-04"
    },
    "gradle": {
      "roots": ["app-service/"],
      "cadence": {
        "patches": "monthly",
        "minors": "quarterly",
        "majors": "quarterly-review"
      },
      "last_run": "2026-02-04",
      "next_target": "2026-05-04"
    },
    "maven": {
      "roots": ["maven-dependency/"],
      "cadence": {
        "patches": "monthly",
        "minors": "quarterly",
        "majors": "quarterly-review"
      },
      "last_run": "2026-02-04",
      "next_target": "2026-05-04"
    },
    "infra": {
      "roots": [".infra/", ".infra-shared/"],
      "cadence": {
        "providers_minor": "quarterly",
        "actions": "monthly",
        "docker": "monthly",
        "terraform_core": "annually"
      },
      "last_run": "2026-02-04",
      "next_target": "2026-05-04"
    }
  },

  "remediation_routines": {
    "biome-issues": {
      "cadence": "monthly-sweep",
      "ci_continuous": true,
      "last_run": "2026-04-15"
    },
    "atomic-design": {
      "cadence": "quarterly",
      "last_run": "2026-02-04"
    },
    "component-dedup": {
      "cadence": "quarterly + post-relocation",
      "last_run": "2026-02-04"
    }
  },

  "audit": {
    "plane_11_per_cycle": true,
    "full_audit": "quarterly",
    "annual_review": "2027-01"
  },

  "risk_tolerance": {
    "auto_dispatch_triggers": [
      "Critical CVE in active dependency",
      "Compliance scan overdue by >7 days"
    ],
    "scheduled_dispatch_triggers": [
      "High CVE in active dependency",
      "Routine cadence reached"
    ],
    "deferable_triggers": [
      "Medium / Low CVE",
      "Cosmetic lint findings"
    ]
  },

  "cycle_history": [
    {
      "cycle_id": "polyglot-maintenance-cycle-2026-05-03",
      "completed_at": "2026-05-04T17:00:00Z",
      "routines_run": ["infra-deps", "npm-deps", "maven-deps", "biome-issues"],
      "audit_plane_11_result": "clean",
      "retro_notes": ""
    }
  ],

  "checkpoints": [
    {
      "type": "quarterly-review",
      "scheduled": "2026-08-01",
      "purpose": "Review cycle performance Q1-Q2; adjust cadence if needed"
    },
    {
      "type": "annual-review",
      "scheduled": "2027-01-15",
      "purpose": "Re-run /core:workflows:manage start engineer:maintenance-calendar-annual"
    }
  ]
}
```

Validate the manifest against the schema:

```bash
# Validate JSON syntax
cat product/.pencil-maintenance-calendar.json | jq . > /dev/null && echo "VALID JSON"

# Schema validation if tooling available
ajv validate -s .product-maintenance-calendar-schema.json \
  -d product/.pencil-maintenance-calendar.json 2>/dev/null \
  || echo "Schema validation skipped (ajv not available)"
```

**Mark complete**: `/core:workflows:manage complete persist-manifest`

## Phase 7 — Strategy document + checkpoints scheduled

Generate a human-readable strategy document for team alignment:

```markdown
# Maintenance Strategy — <Year>

**Generated**: <date>
**Calendar**: product/.pencil-maintenance-calendar.json

## Capacity assumptions

We've allocated <N hours/cycle> to maintenance, applying the 70%
ratchet for sustainability. Compliance requirements consume
<X hours/cycle>, leaving <Y hours/cycle> for elective work.

## Cadence summary

| Ecosystem | Patches | Minors | Majors |
|-----------|---------|--------|--------|
| npm | Monthly | Monthly | Quarterly review |
| Gradle | Monthly | Quarterly | Quarterly review |
| Maven | Monthly | Quarterly | Quarterly review |
| Infra | Quarterly (providers) | — | Annually (TF core) |

## Compliance constraints

- FERPA / COPPA: biweekly security scans across all ecosystems
- Critical CVE: 30-day remediation window
- Annual penetration testing for infrastructure

## Risk dispatch

- Critical CVE → out-of-band cycle within 7 days
- High CVE → next scheduled cycle
- Medium/Low → deferable to next cycle's capacity allows

## Quarterly checkpoints

- 2026-08-01: Review Q1-Q2 performance, adjust cadence
- 2027-01-15: Annual re-planning (re-run this workflow)

## Anticipated cycle schedule

Cycle 1: 2026-05-03 (this week)
  - infra (Critical CVE in hashicorp/aws)
  - npm patches + minors
  - maven minors (Spring Boot patch)
  - biome-issues sweep

Cycle 2: ~2026-06-03
  - npm cadence
  - infra cadence (if quarterly tick)
  - gradle cadence (deferred from cycle 1)

Cycle 3: ~2026-07-03
  - npm cadence
  - quarterly major review across all ecosystems

[etc. for remainder of year]
```

Persist the strategy document at `design/maintenance-strategy.md`.

Schedule the quarterly review:

```bash
# Add to project's calendar/issue tracker as appropriate
# (manual step — surface to user)
echo "ACTION: Schedule quarterly review on <date>"
echo "ACTION: Schedule annual replanning on <date>"
```

**Mark complete**: `/core:workflows:manage complete strategy-doc`

## Workflow complete

Final summary:

```
Maintenance Calendar Annual — Complete

Calendar manifest:    product/.pencil-maintenance-calendar.json
Strategy doc:         design/maintenance-strategy.md
Ecosystems planned:   <N>
Compliance frameworks: <list>
Cycles per year (target): <N>
Quarterly checkpoints scheduled: 4

Next steps:
1. Run first cycle: /core:workflows:manage start engineer:polyglot-maintenance-cycle
2. First quarterly review: <date>
3. Annual replan: <date>
```

The calendar is now the authoritative source for downstream
workflows (`polyglot-maintenance-cycle`) and agents (Janitr) to
consume.

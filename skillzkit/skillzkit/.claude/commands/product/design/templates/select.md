---
description: Read research.json and recommend which templates this project should generate, based on industry frequency and product type. Outputs a manifest the user reviews; running the recommended templates is a separate explicit step.
argument-hint: [--informed-by <research-json-path>] [--product-type marketing|saas|app|content|commerce|hybrid] [--out <path>] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash
---

Read research output and recommend which templates this project
should render. Templates appearing in 75%+ of competitors are
universal for the category; templates under 30% are niche or
product-type-specific and need explicit justification.

This command is a **selection helper, not a renderer**. It outputs a
manifest of recommended templates; the user reviews and runs the
actual `/product:design:templates:<name>` commands separately.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve `--informed-by` (same logic as `patterns:select`).
3. Resolve `--product-type`:
   - `marketing` (marketing site only — landing, about, blog, contact)
   - `saas` (full B2B SaaS — adds dashboard, settings, pricing, auth)
   - `app` (consumer app — auth, onboarding, dashboard, profile)
   - `content` (publication / docs — adds documentation, blog,
     content-detail)
   - `commerce` (storefront — adds product-detail, cart, checkout,
     order-confirmation)
   - `hybrid` (combinations — for products that span types like
     products that span types like K-12 ed-tech which is SaaS +
     content + auth-heavy)
4. If `--product-type` not provided, infer from the research:
   - If `templateFrequency` includes `dashboard-app-shell` ≥ 0.5 →
     likely `saas` or `app`
   - If `documentation-tree-content` ≥ 0.5 → likely `content` or
     `dev-tools`
   - If `product-detail` + `cart` ≥ 0.7 → likely `commerce`

## Phase 1 — Templates by product type

Each product type has a baseline set of templates expected regardless
of research. Research adds or removes from this baseline based on
industry conventions.

| Template            | marketing | saas | app | content | commerce |
| ------------------- | :-------: | :--: | :-: | :-----: | :------: |
| **Marketing landing**     | ✅       | ✅   | ✅  | ✅      | ✅       |
| **Auth (signin/signup)**  |          | ✅   | ✅  | ✅*     | ✅       |
| **Auth (forgot/MFA/etc)** |          | ✅   | ✅  | ✅*     | ✅       |
| **Pricing**         | ✅       | ✅   |     |         | ✅       |
| **Onboarding**      |          | ✅   | ✅  |         | ✅*      |
| **Dashboard (app shell)** |          | ✅   | ✅  |         |          |
| **Settings**        |          | ✅   | ✅  | ✅      | ✅       |
| **Profile**         |          | ✅*  | ✅  | ✅      | ✅       |
| **Detail page**     |          | ✅   | ✅  | ✅      | ✅       |
| **List / index**    |          | ✅   | ✅  | ✅      | ✅       |
| **Documentation**   |          | ✅*  |     | ✅      |          |
| **Marketing pages** (about, features, blog) | ✅* | ✅* |     | ✅      | ✅*      |
| **Confirmation / success** | ✅* | ✅   | ✅  |         | ✅       |
| **Legal**           | ✅       | ✅   | ✅  | ✅      | ✅       |
| **Error pages**     | ✅       | ✅   | ✅  | ✅      | ✅       |

`✅*` = optional / contextual (depends on research). `✅` = required.

## Phase 2 — Layer in research-driven adjustments

Walk `templateFrequency` from research and adjust the baseline:

- If a template is at ≥75% in research but baseline says optional →
  upgrade to required
- If a template is at <30% in research but baseline says required →
  surface as "industry-divergent" (still recommend, but flag)
- If a template not in baseline appears at ≥50% in research → add as
  "industry-driven addition" (e.g. dev-tools sites have changelog/
  release-notes templates that aren't in standard baselines)

Combined logic:

```
final_required = baseline_required ∪ research_high_frequency
final_recommended = baseline_optional ∪ research_medium_frequency
final_skipped = baseline_skip ∩ research_low_frequency
flagged = (baseline_required ∩ research_low_frequency)
       ∪ (baseline_skip ∩ research_high_frequency)
```

## Phase 2.5 — Feature-driven recommendations (when `featureMatrix` is in research)

When the research file includes a `featureMatrix` (produced by
`/product:strategy:research --features`), this phase adds **feature-driven
recommendations** alongside the archetype-driven Phase 2.
Templates aren't just "what kind of page" — they also need to
surface specific features. The matrix tells the selector which
templates need feature-specific molecules.

Skip entirely without a featureMatrix. Phase 2 results stand on
their own.

The mapping logic walks the matrix and adds recommendations:

- **Table-stakes feature absent from product** (`classification:
  "table-stakes"` + `ourPosition: "absent"` or `"unknown"`):
  surface in the recommendation as a feature gap. Don't change
  template recommendations — gaps are about features, not
  templates — but flag the affected templates so the user knows
  which templates *should* surface this feature when it lands.
- **Common feature surfacing in dashboard or settings**:
  recommend the corresponding molecule. E.g. `saved-searches`
  appearing in 3+ competitors' dashboards → recommend
  `dashboard` template includes a saved-searches molecule.
- **Differentiation candidate present in product**: surface as
  "lean into this" — the user has a feature few competitors have;
  the template should make it prominent.

The Phase 4 manifest gains a "Feature-driven additions" section
alongside the existing "Industry-driven additions":

```markdown
## Feature-driven additions (from research featureMatrix)

| Template     | Feature              | Reason                                      |
| ------------ | -------------------- | ------------------------------------------- |
| dashboard    | saved-searches       | Table-stakes (75% of competitors); recommend prominent placement |
| dashboard    | analytics-summary    | Table-stakes (100% of competitors); standard module |
| auth         | sso                  | Common (60% of competitors); add to signin variant |
| profile      | guardian-portal      | K-12-specific; ourPosition planned          |

## Feature gaps (table-stakes features not yet in product)

| Feature              | Frequency | Affected templates              |
| -------------------- | --------- | ------------------------------- |
| in-app-messaging     | 75%       | dashboard, settings (notifications page) |
| api-access           | 75%       | settings (developer page)       |

## Differentiation features (low-frequency in market, present in product)

| Feature              | Frequency | Affected templates                   |
| -------------------- | --------- | ------------------------------------ |
| ai-summarization     | 25%       | dashboard (lean into prominent placement) |
```

Audit Plane 7 reads these annotations during ongoing runs and
warns when a template scaffolds without surfacing a flagged
feature.

## Phase 3 — Brand-fit filtering

Some recommendations get filtered based on brand context:

- **Audience-regulation = k-12 (FERPA/COPPA)**: auth flow needs
  guardian-consent variants; profile pages need parental access
  controls. Add `auth-guardian-consent` and `profile-with-guardian`
  variants to recommendations.
- **Multilingual support required**: every template must be
  i18n-aware. Annotate the manifest with i18n notes per template.
- **Compliance-heavy industry (fintech/healthcare/govt)**: legal
  template gets upgraded scope (multiple legal pages instead of
  one consolidated).
- **Account-management complexity**: settings template needs sub-
  pages section (account / billing / security / team / API / etc.).

## Phase 4 — Generate the manifest

Write `product/.pencil-recommended-templates.md`:

```markdown
---
generatedAt: <ISO date>
industry: <industry>
productType: <product-type>
researchAge: <days since research>
---

# Recommended Templates for {{brand}}

Product type: **{{product-type}}**
Industry: **{{industry}}** (research age: {{n}} days)

## Required (universal for this product type)

Every product like {{brand}} has these. Skipping any creates real
gaps in the user experience.

- [ ] **marketing-landing** (research: 100%)
      Run: `/product:design:templates:landing-page`
- [ ] **auth** (research: signin 100%, signup 100%, forgot 95%)
      Run: `/product:design:templates:auth`
      Variants: signin, signup, password-reset, MFA, magic-link,
      verification, OAuth-callback
- [ ] **pricing** (research: 85%)
      Run: `/product:design:templates:pricing`
- [ ] **dashboard** (research: 90% of saas competitors)
      Run: `/product:design:templates:dashboard`
- [ ] **settings** (research: 80%)
      Run: `/product:design:templates:settings`
- [ ] **legal** (research: 95%)
      Run: `/product:design:templates:legal`
      Variants: terms, privacy, cookie-policy
- [ ] **error-pages** (research: universal)
      Run: `/product:design:templates:error-page`

## Recommended (common but not universal)

Present in 50–75% of competitors. Strong fit for most products in
this category.

- [ ] **onboarding** (research: 65%)
      Run: `/product:design:templates:onboarding`
- [ ] **profile** (research: 55%)
      Run: `/product:design:templates:profile`
- [ ] **list / index** (research: 70% — needed for content pages)
      Run: `/product:design:templates:list`
- [ ] **detail** (research: 75% — needed for record/article views)
      Run: `/product:design:templates:detail`
- [ ] **confirmation** (research: 60% — needed after critical actions)
      Run: `/product:design:templates:confirmation`

## Optional (industry-specific or brand-fit)

- [ ] **documentation** (research: 30% in ed-tech, would be 90% in
      dev-tools) — recommended only if {{brand}} has API or developer
      surface
      Run: `/product:design:templates:documentation`
- [ ] **marketing pages** (about, features, blog, careers, contact)
      (research: about 80%, features 70%, blog 55%, careers 40%,
      contact 75%)
      Run: `/product:design:templates:marketing` (select variants)

## Industry-divergent

These templates are unusual for the category but might still apply:

{{ if any flagged templates }}
- ⚠️  **<template>** — baseline says required but research shows only
  {{n}}% adoption in {{industry}}. Reasoning: ... Recommendation: ...
{{ /if }}

## Industry-driven additions

Templates not in the standard baseline that appear consistently in
{{industry}}:

{{ if any research-driven additions }}
- ✨ **<template>** — appears in {{n}}% of {{industry}} competitors
  but not in the {{product-type}} baseline. Specific to this category
  because: ...
{{ /if }}

## Brand-context adjustments

{{ if audience-regulation = k-12 }}
**FERPA / COPPA compliance adjustments:**
- Auth template gets `guardian-consent` variant (required)
- Profile template gets `with-guardian-access` variant (required)
- Legal template gains: parental-rights, FERPA-disclosure, COPPA-disclosure
- Onboarding template gets `family-flow` variant (separate from
  educator flow)
{{ /if }}

{{ if multilingual }}
**Multilingual notes:**
- All templates render content via the i18n token chain (per
  Foundations / I18n)
- Logical-property CSS used throughout
- Auth template's "Continue with…" social row tested in RTL layouts
- Legal templates available in all supported languages
{{ /if }}

---

## Summary

- Required: {{n}} templates ({{n-variants}} total page variants)
- Recommended: {{n}} templates
- Optional / industry-specific: {{n}} templates
- Brand-context adjustments: {{n}} variant additions

To render all required templates at once: `--render-required`
To render required + recommended: `--render-recommended`
```

## Phase 5 — Optionally render

`--render-required` invokes each required-tier template in sequence.
`--render-recommended` extends to recommended-tier. Default behavior
prints the manifest as a checklist.

## Reporting

```
✅ product/.pencil-recommended-templates.md
   Product type:    saas
   Industry:        B2B ed-tech (research age: 3 days)
   
   Recommendations:
     Required:        7 templates (15 page variants total)
     Recommended:     5 templates (8 page variants)
     Optional:        2 templates (10 page variants)
   
   Brand-context adjustments:
     Audience: k-12 (FERPA/COPPA)
     - Auth: +guardian-consent variant
     - Profile: +with-guardian-access variant
     - Legal: +parental-rights, FERPA-disclosure, COPPA-disclosure
     - Onboarding: +family-flow variant
   
   Multilingual: yes (per brand JSON)
     - All templates rendered with i18n token chain
     - RTL layouts validated for auth's social-OAuth row

📝 Next steps:
   Review product/.pencil-recommended-templates.md
   Run each unchecked template command, OR pass --render-required
```

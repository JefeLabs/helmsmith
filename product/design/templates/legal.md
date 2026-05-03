---
description: Generate the consolidated legal template — terms of service, privacy policy, cookie policy, plus K-12-specific disclosures (parental rights, FERPA, COPPA) for products serving minors. Boring but every product needs them.
argument-hint: [--variants terms,privacy,cookie-policy,parental-rights,ferpa-disclosure,coppa-disclosure] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/legal.pen` — the legal-page templates
nearly every product needs. Boring but mandatory; standardizing
their structure means content writers can focus on the actual
clauses rather than figuring out the layout.

For K-12 products, the legal pages are not optional
extras — FERPA and COPPA both require specific disclosures presented
in specific ways.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for `audience-regulation`.
3. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["legal"]`.
   Legal pages are SEO-light by nature (low organic search target;
   navigational intent dominates), but trust-signal-heavy. Date-
   stamping is the high-leverage discipline here. See SEO + AIO
   contract below.
4. Variants to render are determined by:
   - Default (any product): terms, privacy, cookie-policy
   - K-12 (audience-regulation = k-12): + parental-rights,
     ferpa-disclosure, coppa-disclosure
   - EU-serving products: cookie-policy uses GDPR-strict variant
   - California-serving products: privacy includes "Do Not Sell"
     section
   - Healthcare: privacy includes HIPAA notice

## Embedded prompt

> Build a Pencil page named **`Templates / Legal`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Shared layout (all variants)
>
> All legal pages share the same structural layout:
>
> Composition:
> - **Marketing chrome**: top nav + footer (legal pages are public-
>   facing, often arrived at via footer links)
> - **Page header**:
>   - Title (h1, display-md)
>   - "Last updated: [date]" + "Effective date: [date]"
>   - "View previous versions" link (changelog-style)
> - **Two-column body** (desktop):
>   - **Left rail** (240px): in-page table of contents (sticky,
>     auto-highlighted as user scrolls)
>   - **Main content** (max 720px): the legal text itself
> - **Footer of content**: "Questions? Contact [legal@brand.com]"
>   + "View previous versions" link
>
> ### Typography rules for legal content
>
> - Body: `body-lg` with generous line-height (1.7 minimum) — legal
>   text is hard to read; don't make it harder
> - Section headings (h2): numbered ("1. Acceptance", "2. Definitions")
> - Sub-headings (h3): lettered ("a) ...", "b) ...")
> - Important highlights: callout boxes (uses
>   `frameworks/heroui/components/feedback.pen` Alert variants)
> - Definitions: bold the term + body text
> - **No fancy formatting**: legal is content-first. Reading clarity
>   over visual interest.
>
> ### Variant 1 — Terms of Service
>
> Standard sections (placeholder content for layout):
> 1. Acceptance of Terms
> 2. Definitions
> 3. User Accounts
> 4. Acceptable Use
> 5. Intellectual Property
> 6. Termination
> 7. Disclaimers
> 8. Limitation of Liability
> 9. Indemnification
> 10. Governing Law
> 11. Changes to Terms
> 12. Contact Information
>
> Each as h2 with content below.
>
> ### Variant 2 — Privacy Policy
>
> Standard sections:
> 1. Information We Collect
> 2. How We Use Information
> 3. Information Sharing
> 4. Data Retention
> 5. Your Rights
> 6. Cookies and Tracking
> 7. Third-Party Services
> 8. Children's Privacy (when applicable)
> 9. International Users
> 10. Changes to This Policy
> 11. Contact Us
>
> Conditional sections to include based on context:
> - **California "Do Not Sell"** (CCPA): dedicated section
> - **EU "Your GDPR Rights"** (GDPR): dedicated section with
>   subject access request flow
> - **HIPAA Notice** (healthcare): dedicated section
>
> ### Variant 3 — Cookie Policy
>
> Standard sections:
> 1. What Are Cookies
> 2. Types of Cookies We Use (with table breaking down each
>    category: essential, analytics, marketing)
> 3. Third-Party Cookies
> 4. Managing Cookies
> 5. Changes to This Policy
>
> Cookie inventory table:
>
> | Cookie name | Purpose | Duration | Provider |
> | ----------- | ------- | -------- | -------- |
> | `session_id` | Authentication | Session | First-party |
> | `_ga`        | Analytics      | 2 years | Google   |
> | ...          | ...            | ...     | ...      |
>
> GDPR-strict variant: includes opt-out controls inline in the
> policy (toggle each cookie category).
>
> ### Variant 4 — Parental Rights (K-12 only)
>
> K-12 products serving minors must disclose parental rights under
> applicable law. Standard sections:
>
> 1. Your Rights as a Parent or Guardian
> 2. Reviewing Your Child's Information
> 3. Requesting Corrections
> 4. Requesting Deletion
> 5. Withdrawing Consent
> 6. Receiving Notifications
> 7. How to Exercise These Rights
> 8. School and District Roles
> 9. Contact Information
>
> Each section explains the right + how to exercise it. Includes
> a clear "Submit a parental request" CTA at the top and bottom.
>
> ### Variant 5 — FERPA Disclosure (K-12 only)
>
> Required for products handling student educational records.
> Standard sections:
>
> 1. What FERPA Is and Who It Protects
> 2. {{brand}}'s Role Under FERPA (school official designation)
> 3. Educational Records {{brand}} Handles
> 4. Permitted Uses
> 5. Sharing of Educational Records
> 6. Directory Information
> 7. Annual Notification of Rights
> 8. Filing a Complaint
> 9. Contact Information
>
> Critical: the language must be precise. Many phrasings are not
> interchangeable under FERPA. This template is structural only;
> actual content requires legal counsel review.
>
> ### Variant 6 — COPPA Disclosure (K-12 only)
>
> Required for products knowingly collecting data from children
> under 13. Standard sections:
>
> 1. What COPPA Is
> 2. Information {{brand}} Collects from Children Under 13
> 3. How We Use That Information
> 4. Parental Consent Process
> 5. Parental Review and Deletion Rights
> 6. Sharing of Children's Information (typically: prohibited)
> 7. Data Security for Children's Information
> 8. Changes to This Practice
> 9. Contact Information
>
> ### Section 7 — Version history reference
>
> A reference card for the version-history pattern legal pages
> should support:
>
> - **Live current version**: the URL `/legal/terms` always renders
>   the current
> - **Versioned URLs**: `/legal/terms/v3`, `/legal/terms/v4` retain
>   prior versions
> - **Diff view**: optional "What changed in v4" page showing
>   diff between consecutive versions
> - **Notification of changes**: when terms change in a way that
>   affects users, the product surfaces an in-app notice / banner
>   (uses `patterns/banner.pen` deprecation hard-warning) requiring
>   acknowledgment
>
> ### Section 8 — Print / PDF support
>
> Legal pages should be print-friendly:
> - Hide nav and chrome on print (CSS `@media print`)
> - Single-column layout, legible font, page breaks between
>   sections
> - Include URL and "Last updated" in printed footer
> - Optional: "Download as PDF" button at top of page
>
> ### Section 9 — Responsive behavior
>
> A canonical-3-breakpoint render of one variant (Privacy):
>
> - Desktop (1440): two-column with sticky TOC sidebar
> - Tablet (768): same as desktop, narrower sidebar
> - Mobile (390): TOC sidebar collapses to top-of-page accordion
>   ("On this page"); main content becomes full-width
>
> ### Naming
> - Frame names: `legal-{{variant}}-{{breakpoint}}`
> - Reference frames: `version-history-pattern`, `print-pdf-support`
> - Cookie-inventory table: `cookie-inventory`

## Execution

```bash
pencil --out design/templates/legal.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## SEO + AIO contract

Legal pages have a different SEO profile than other archetypes.
Organic search target is minimal (users find legal pages via
in-product navigation, footer links, or compliance-required
links — not Google search). AIO citation is similarly low (AI
search engines rarely cite legal text directly). The discipline
shifts to **trust signals + accessibility + date-stamping** —
making legal pages findable for the small group of users who
need them and clearly date-stamped for compliance and audit
trails.

When `archetypeTargets` is resolved from `.pencil-seo.json`, apply:

**Heading hierarchy** — exactly one `<h1>` per variant (e.g.
"Terms of Service", "Privacy Policy", "Cookie Policy"). Each
major clause section is `<h2>` (e.g. "Acceptance of Terms",
"Information We Collect", "Cookie Categories"). Sub-clauses are
`<h3>`. Legal documents are often long and heading-dense;
disciplined cascade aids both readability and AI extraction.

**Primary keyword placement** — minimal SEO emphasis. Brand-
modified legal keywords ("{{brand}} terms", "{{brand}} privacy
policy") appear in H1 + meta description; deep keyword
optimization isn't valuable here.

**Meta description** — concrete document summary. "{{brand}}
Privacy Policy explaining what data we collect, how we use it,
your rights, and how to contact us. Last updated [date]."

**Structured data emission points** —

- `Article` — site-wide for legal pages; **datePublished and
  dateModified are critical** (legal documents have effective
  dates that must be machine-readable for compliance audits)
- `Organization` — site-wide; legal pages are where the
  Organization schema's "legal name" and contact info matter
- `BreadcrumbList` — when legal nests under a footer section

**Effective date + last revised date — design-prominent**

The most important non-clause content is the date-stamping pair:

```
Effective: May 2, 2026
Last revised: May 2, 2026
```

Both dates appear at the top of every legal variant, in a
visually distinct treatment (smaller type, neutral color, but
not buried). The Article schema's datePublished reads from
"Effective"; dateModified reads from "Last revised". When
dates are missing or stale, the design surfaces the gap — legal
pages without dates are a compliance and trust failure.

**AIO patterns** — light emphasis:

- `date-stamped-facts` — **required**. Effective date + last
  revised date are the canonical example. Any clause referencing
  time-sensitive practices ("As of [date], we [practice]") gets
  explicit dates.
- `definitive-headings` — section H2s as definitive ("Information
  We Collect" not "About Information")
- `citation-ready` — bullet lists for enumerated rights, data
  categories, cookie types; tables for cookie-category breakdowns

Skip in legal:
- `faq-schema` — generally not required (legal pages aren't
  Q&A-structured); some teams add a brief FAQ above the legal
  text for accessibility, which is fine
- `comparison-table` — rare in legal pages
- `factual-density` — legal text is dense by nature; this rule
  doesn't add value

**Internal linking** — between related legal pages (Terms ↔
Privacy ↔ Cookie Policy). When K-12 variants exist (parental-
rights, ferpa-disclosure, coppa-disclosure), they cross-link.
Footer links to all legal pages from every page on the site —
this is universal good practice.

**Print-friendliness** — legal documents often need print-
friendly layout. The design includes print-CSS or a PDF-export
path (some compliance scenarios require physical document
versions). Design notes should call out print-friendly intent.

**Accessibility** — legal pages must meet WCAG AA at minimum.
This overlaps with SEO baseline (alt text, heading cascade,
semantic HTML) but adds: sufficient color contrast for body
text (legal pages often use lighter type to be visually
"quieter"; verify contrast holds), keyboard-navigable accordions
when used, screen-reader-friendly clause structure.

**K-12 / regulated-audience handling** — when `audience-
regulation` triggers parental-rights / FERPA / COPPA variants,
the SEO contract still applies but with regulation-specific
emphasis: COPPA-required disclosures are visually prominent
(not hidden behind "see more"); FERPA disclosures include
specific date-stamped-fact patterns about data retention; parental-
rights pages link to the contact mechanism for opt-out requests.

When `.pencil-seo.json` is missing, apply baseline correctness +
prominent date-stamping. Surface the recommendation.



Screenshot the page. Confirm: all variants matching the
audience-regulation context rendered (3 base + up to 3 K-12 specific),
shared structural layout consistent, version history + print/PDF
references present, canonical 3 breakpoints rendered.

## Critical caveat

**This template generates structural layouts only — not legal
content.** The placeholder text in any rendered output must be
replaced by content reviewed by qualified legal counsel before any
of these pages goes live. Pencil produces the page structure; the
words in legal text are not Pencil's domain to write.

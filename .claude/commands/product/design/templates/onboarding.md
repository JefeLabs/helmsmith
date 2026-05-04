---
description: Generate the onboarding template — multi-step wizard with progress indicator, welcome states, first-run UX. Covers the canonical post-signup flow that turns sign-ups into activated users.
argument-hint: [--steps n] [--with-product-tour] [--with-team-invite] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/onboarding.pen` — the multi-step wizard
users see immediately after signup. Onboarding is where conversion
becomes activation; the design here directly affects retention.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `patterns/states.pen` (onboarding uses welcome empty-state
   and progress-indicator patterns).

## Embedded prompt

> Build a Pencil page named **`Templates / Onboarding`** for
> **{{brand}}**. Render at the canonical 3 breakpoints.
>
> ### Shared chrome (all wizard steps)
>
> Minimal chrome — onboarding is a focused flow, not the app.
> No sidebar, no main-app navigation.
>
> Composition:
> - **Top bar**: brand mark (left) + "Skip for now" link (right,
>   when applicable) + sign-out link
> - **Progress indicator**: step dots or progress bar showing
>   "Step 2 of 5" or visual progress
> - **Step container**: centered, max-width 640px, with current
>   step content
> - **Bottom navigation**: back button (left, when applicable) +
>   primary action (right, "Continue" / "Get started")
>
> ### Step 1 — Welcome
>
> First step after signup. Composition:
> - Hero illustration (per imagery direction) or product mark
> - Heading: "Welcome to {{brand}}, {{firstName}}"
> - Subhead: brief value reinforcement (1–2 lines)
> - List of what they'll do in onboarding (3 short bullets):
>   "Set up your profile · Connect your tools · Invite your team"
> - Primary action: "Let's get started"
> - Optional: "Skip onboarding" secondary link (only if onboarding
>   is genuinely optional — most products shouldn't allow this)
>
> ### Step 2 — Profile setup
>
> Composition:
> - Step heading: "Tell us about yourself"
> - Subhead: brief reasoning (why we ask)
> - Form fields (per brand context):
>   - Full name (pre-filled from signup if available)
>   - Display name / username (optional)
>   - Avatar upload
>   - Role / position (select)
>   - Team size (select, B2B only)
> - Primary action: "Continue"
> - "Back" link to previous step
>
> ### Step 3 — Use case / goal selection
>
> Helps personalize subsequent product experience:
> - Step heading: "What brings you to {{brand}}?"
> - Multi-select cards (4–8 options): icon + title + brief description
>   for each use case
> - Skip link if user prefers not to specify
> - Primary action: "Continue"
>
> ### Step 4 — Connect / configure (optional)
>
> When applicable, integrations or initial setup:
> - Step heading: "Connect your [tools / data sources / whatever]"
> - Subhead explaining why this helps
> - Grid of integration cards: icon + name + "Connect" button per
>   card
> - "Connected" state for completed integrations
> - "Skip — I'll do this later" link
> - Primary action: "Continue"
>
> ### Step 5 — Invite team (when `--with-team-invite`)
>
> B2B onboarding for products with collaboration:
> - Step heading: "Invite your team"
> - Subhead: value prop ("{{brand}} works better with your team")
> - Multi-email input (chip-style, paste-supported)
> - Role selector per invitee
> - Optional message field
> - "Skip — invite team later" link
> - Primary action: "Send invites" or "Skip and continue"
>
> ### Step 6 — Product tour entry (when `--with-product-tour`)
>
> Optional guided tour offering:
> - Step heading: "Want a quick tour?"
> - Subhead: "We'll walk you through the main features in 90 seconds"
> - Two actions:
>   - "Start tour" (primary) — launches in-product overlay tour
>   - "Skip tour, take me to the app" (secondary)
>
> ### Step 7 — Completion / success
>
> Final step:
> - Hero illustration: success-state (per imagery direction)
> - Heading: "You're all set!"
> - Subhead: brief next-step nudge ("Here's what you can do first:")
> - 3 quick-start cards linking to common first actions
> - Primary action: "Take me to {{brand}}" (routes to dashboard)
>
> ### Section 8 — Progress indicator variants
>
> A reference card showing onboarding progress patterns:
>
> | Pattern              | When to use                                |
> | -------------------- | ------------------------------------------ |
> | **Step dots**        | 3–7 steps, equal weight                    |
> | **Progress bar**     | Long flows (5+ steps) where %% complete is meaningful |
> | **Numbered steps**   | Steps have distinct names users should remember |
> | **Stepper with status** | Multi-task onboarding where steps complete asynchronously (e.g., team-invite waits on responses) |
>
> ### Section 9 — Skip / resume patterns
>
> A reference card:
>
> - **Skippable per step**: each step has "Skip" link (suitable when
>   personalization data isn't critical)
> - **Skippable from any step**: top-bar "Skip for now" exits to
>   dashboard (suitable when product works without onboarding data)
> - **Required completion**: no skip; user must complete to access
>   the product (suitable when product fundamentally requires the
>   data — e.g., compliance flows)
> - **Resume from where left**: user closes browser mid-onboarding,
>   returns to the same step on next signin
>
> ### Section 10 — Family-flow variant (K-12, optional)
>
> For K-12 ed-tech products: a family-onboarding flow where
> the first user (parent / guardian) sets up the account but
> additional users (children, family members) are added with
> appropriate access controls.
>
> Composition adjustments:
> - Step 2 includes guardian/parent confirmation
> - Step 3+ adds children to the account with age-appropriate
>   COPPA gates
> - Step 5+ replaces "Invite team" with "Add family members" with
>   guardian approval requirement for under-13 accounts
>
> ### Section 11 — Responsive behavior
>
> A canonical-3-breakpoint render of the wizard:
>
> - Desktop (1440): centered 640px container, full progress
>   indicator visible
> - Tablet (768): same composition, container becomes 90% width
> - Mobile (390): full-width container with edge padding, progress
>   indicator may collapse to "Step n of m" text-only
>
> ### Naming
> - Frame names: `onboarding-step-{{n}}-{{breakpoint}}`
> - Reference frames: `progress-indicator-variants`,
>   `skip-resume-patterns`, `family-flow-variant` (if applicable)

## Execution

```bash
pencil --out design/templates/onboarding.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5–7 wizard steps rendered with
consistent chrome, progress indicator visible, completion state
present, references for progress / skip / family-flow variants.
Canonical 3 breakpoints rendered.

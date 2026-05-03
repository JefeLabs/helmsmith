---
description: Generate the confirmation / success template — post-action confirmation pages for purchases, sign-ups, submissions, account changes. Establishes consistent treatment for the "you successfully did X" page.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/confirmation.pen` — the post-action
confirmation page. These are the "you successfully did X" pages
that close the loop after critical actions: purchase complete,
form submitted, account verified, etc.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.

## Embedded prompt

> Build a Pencil page named **`Templates / Confirmation`** for
> **{{brand}}**. Render at the canonical 3 breakpoints.
>
> ### Layout
>
> Confirmation pages can use either marketing chrome (for
> public-facing actions like purchase) or app chrome (for
> in-app actions). Render variants for both.
>
> ### Variant 1 — Purchase / order confirmation
>
> Use marketing chrome.
>
> Composition:
> - **Success illustration / icon** (centered): large checkmark
>   in a circle, brand-colored
> - **Heading**: "Order confirmed!" or "Thanks for your purchase!"
> - **Confirmation details**:
>   - Order number (prominent, copy-able)
>   - Order date
>   - Order summary (line items + total)
>   - Receipt sent to email (X@email.com)
> - **What happens next**:
>   - Numbered list of next steps (delivery / activation /
>     onboarding link)
> - **Primary action**: "Get started" or "Track your order"
> - **Secondary actions**: "View receipt", "Print"
> - **Optional**: related products / upsell
>
> ### Variant 2 — Form submission confirmation
>
> Use marketing chrome.
>
> Composition:
> - Success icon
> - **Heading**: "We got your [submission]"
> - **Subhead**: brief context (e.g. "Our team will review and
>   respond within 24 hours")
> - **What happens next**: 2–3 brief steps
> - **Reference number** (when applicable): for tracking
> - **Primary action**: "Back to home" or "Explore [product]"
>
> ### Variant 3 — Account creation success
>
> Use marketing chrome.
>
> Composition:
> - Success icon
> - **Heading**: "Welcome to {{brand}}!"
> - **Subhead**: "Check your email to verify your account"
> - **Email indicator**: "We sent a verification email to X@email.com"
> - **Primary action**: "Resend email" (with cooldown timer)
> - **Secondary**: "Use a different email"
> - **Help section**: "Didn't get the email? [Check spam, or
>   contact support]"
>
> ### Variant 4 — In-app action confirmation
>
> Use app chrome.
>
> Composition (modal-style, rendered within the app shell):
> - Success icon (smaller than full-page variants)
> - **Heading**: "Project created" or "Settings saved" or
>   action-specific
> - **Brief detail**: 1 line about what happened
> - **Primary action**: "Go to [next thing]"
> - **Secondary**: "Stay here" or related action
>
> Often a confirmation page is overkill for in-app actions —
> consider a toast notification (uses `frameworks/heroui/components/feedback.pen`)
> instead. Reserve full-page confirmations for actions that
> warrant a moment of focus (subscription change, big delete, etc.)
>
> ### Variant 5 — Subscription / billing change confirmation
>
> Use app chrome.
>
> Composition:
> - Success icon
> - **Heading**: "Your plan was updated"
> - **Change summary**:
>   - Previous plan (struck-through)
>   - New plan (highlighted)
>   - Effective date
>   - Next billing date + amount
> - **What this means**: 2–3 bullets explaining new capabilities
>   or limits
> - **Primary action**: "Continue to dashboard"
> - **Secondary**: "View invoice" or "Manage billing"
>
> ### Section 6 — Confirmation pattern reference
>
> A reference card showing when each pattern fits:
>
> | Action                   | Pattern                              |
> | ------------------------ | ------------------------------------ |
> | Purchase complete        | Full-page marketing chrome (Variant 1) |
> | Form submitted           | Full-page marketing chrome (Variant 2) |
> | Account created          | Full-page marketing chrome (Variant 3) |
> | Quick in-app save        | Toast notification (skip confirmation page) |
> | Substantial in-app action | Full-page app chrome (Variant 4)    |
> | Billing change           | Full-page app chrome (Variant 5)    |
> | Destructive irreversible | Confirmation modal BEFORE action; then full-page after |
>
> ### Section 7 — Optional content patterns
>
> Reference card for what to include in confirmation pages
> (besides the core success message):
>
> - **Calendar invite** (subscription / event): button to add to
>   user's calendar
> - **Print / PDF** (orders, registrations): "Save as PDF" link
> - **Share** (achievements, public actions): social-share buttons
> - **Email me a copy**: send confirmation to email if not
>   automatically done
> - **Track / status**: link to a status page (orders, requests)
> - **Related actions**: contextual next-steps the user might
>   want
>
> Don't include all of these — pick 2–3 most relevant.
>
> ### Section 8 — Empty / loading / error states
>
> Confirmation pages typically arrive after a successful action,
> so the "loading" state is usually just a brief spinner during
> redirect. The "error" state belongs on the action page (e.g.
> the checkout page itself), not the confirmation.
>
> However: confirmation pages can have edge cases:
> - **Token expired** (e.g. for verification confirmation pages):
>   redirect to error template
> - **Already used** (e.g. one-time confirmation links): show
>   "This link was already used" with appropriate next-action
>
> ### Section 9 — Responsive behavior
>
> A canonical-3-breakpoint render of one variant:
>
> - Desktop (1440): centered content, max width ~720px, prominent
>   illustration
> - Tablet (768): same composition, illustration scales
> - Mobile (390): full-width, illustration sized down, vertical
>   stack
>
> ### Naming
> - Frame names: `confirmation-{{variant}}-{{breakpoint}}`
> - Reference frames: `confirmation-pattern-reference`,
>   `optional-content-patterns`

## Execution

```bash
pencil --out design/templates/confirmation.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 confirmation variants rendered
(purchase, form, account, in-app, billing), pattern reference card,
canonical 3 breakpoints rendered for one variant.

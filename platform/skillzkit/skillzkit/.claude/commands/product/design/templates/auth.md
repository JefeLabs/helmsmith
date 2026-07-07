---
description: Generate the auth-flow templates — signin, signup, password reset, MFA challenge, magic-link, account verification, OAuth callback. All 7 auth surfaces in one .pen with consistent layout chrome and security-conscious copy.
argument-hint: [--variants <list>] [--with-passkeys] [--with-guardian-consent] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/auth.pen` — the seven auth-flow surfaces
that nearly every product needs. Internal tools' auth surfaces, and any
consumer SaaS launch hit these pages from day one.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for brand mark, accent color,
   and `audience-regulation` (k-12 brands need
   guardian-consent variants).
3. Resolve flags:
   - `--variants` — comma list to filter which variants to render.
     Default all 7.
   - `--with-passkeys` — adds passkey/WebAuthn affordances to the
     signin/signup variants. Required for K-12 products with
     WebAuthn passkey auth.
   - `--with-guardian-consent` — adds COPPA/FERPA guardian-consent
     flow for k-12 audiences.

## Embedded prompt

> Build a Pencil page named **`Templates / Auth`** for **{{brand}}**.
> Render at the canonical 3 breakpoints (mobile 390, tablet 768,
> desktop 1440) per `_context.md` rule 8.
>
> ### Shared layout (all auth pages)
>
> Single column, centered, max width 480px. Vertically centered in
> viewport with brand-mark + tagline above the auth card.
>
> Composition:
> - **Brand block** (above card, ~80px from top): logo lockup +
>   optional 1-line value prop
> - **Auth card** (`--color-surface-raised`, `--radius-lg`,
>   subtle shadow): main content
> - **Footer links** (below card): legal links + alternative
>   auth path link ("Don't have an account? Sign up")
>
> The minimal-footer pattern from `patterns/footer.pen` applies
> to all auth pages.
>
> ### Variant 1 — Sign-in
>
> Auth card content:
> - Heading: "Welcome back"
> - Optional: passkey button (when `--with-passkeys`) prominently
>   above the form: "Continue with passkey" + key icon
> - OAuth row: "Continue with [provider]" buttons (Google, Microsoft,
>   etc. per brand context). Use OAuth provider's official logos.
> - "OR" divider
> - Email field
> - Password field with show/hide toggle
> - "Forgot password?" link (right-aligned, body-sm)
> - Primary button: "Sign in"
> - Below button: "Don't have an account? **Sign up**"
>
> Error states (uses `patterns/states.pen` inline-error variant):
> - Invalid credentials → field-level + summary error
> - Account locked → page-level info banner with retry timer
> - Email not verified → CTA to resend verification
>
> ### Variant 2 — Sign-up
>
> Auth card content:
> - Heading: "Create your {{brand}} account"
> - Subhead: brief value prop (1 line)
> - Optional passkey signup (when `--with-passkeys`)
> - OAuth row + divider (same as signin)
> - Email field with availability check (debounced API call)
> - Password field with strength indicator (visual: weak / ok /
>   strong) + "Show requirements" tooltip listing rules
> - Optional fields per brand context (full name, organization,
>   role)
> - Terms acceptance checkbox: "I agree to the {{brand}}
>   [Terms](/legal/terms) and [Privacy Policy](/legal/privacy)"
> - Primary button: "Create account"
> - Below: "Already have an account? **Sign in**"
>
> Variants by audience:
> - **B2B**: organization name + role fields
> - **Consumer**: email + password only
> - **K-12 educator**: school district selector + verification
>   email check
> - **K-12 family** (when `--with-guardian-consent`): see Variant 8
>
> ### Variant 3 — Password reset (request)
>
> Auth card content:
> - Heading: "Reset your password"
> - Body: "Enter your email and we'll send you a reset link."
> - Email field
> - Primary button: "Send reset link"
> - "Back to sign in" link
>
> Success state: replaces card with "Check your email" message +
> link "Didn't receive it? Resend (in 60s)" with countdown timer.
>
> ### Variant 4 — Password reset (confirm)
>
> Reached via tokenized link from email. Auth card content:
> - Heading: "Choose a new password"
> - Body: "Your link expires in {{n}} minutes."
> - New password field with strength indicator
> - Confirm password field
> - Primary button: "Update password"
>
> Error states: link expired (CTA: "Request a new link"), link
> already used (CTA: "Sign in").
>
> ### Variant 5 — MFA challenge
>
> Reached after primary credential success when MFA is enabled.
> Auth card content:
> - Heading: "Verify it's you"
> - Body: "Enter the 6-digit code from your authenticator app." OR
>   "We sent a code to ***-***-1234." per MFA method
> - 6-digit input (single field with auto-advance per digit, or
>   one-line input that accepts paste)
> - Primary button: "Verify"
> - Secondary actions:
>   - "Use a different method" — opens method selector
>   - "Use a backup code" — switches to backup code entry
>   - "Resend code" (with cooldown timer for SMS/email methods)
>
> Method-selector overlay shows: TOTP, SMS, Email, Backup codes.
> Each clearly labeled with last-used hint and a security ranking
> (TOTP highest).
>
> ### Variant 6 — Magic link
>
> Two surfaces:
>
> **6a — Request magic link**
> - Heading: "Sign in with email"
> - Body: "We'll email you a link that signs you in."
> - Email field
> - Primary button: "Send magic link"
> - "Use password instead" link
>
> **6b — Magic link landing**
> - Reached via tokenized link from email.
> - Auto-attempts sign-in on load.
> - States: loading ("Signing you in..."), success (redirects),
>   error ("Link expired" / "Link already used"), invalid token
>   ("Invalid link — request a new one").
>
> ### Variant 7 — Account verification
>
> Reached via tokenized link sent after signup. Auth card content:
> - Heading: "Email verified" (success) or "Verification failed"
>   (error)
> - Body explaining what just happened
> - Primary button: "Continue to {{brand}}" (success) or
>   "Resend verification" (error)
>
> Pre-verification state (user clicked the link but token still
> validating): show loading skeleton briefly before resolving to
> success or error state.
>
> ### Variant 8 — Guardian consent (K-12, optional)
>
> Only render when `--with-guardian-consent` is set. The COPPA-
> compliant flow for accounts created on behalf of a minor:
>
> - Heading: "Family setup"
> - Body explaining the consent process: "Your child {{name}} is
>   creating a {{brand}} account. As required by law, we need a
>   parent or guardian to confirm consent."
> - Guardian email field
> - Guardian relationship select (Parent / Legal Guardian / Other)
> - Verification checkboxes:
>   - "I am {{name}}'s parent or legal guardian"
>   - "I have read and agree to the [Family Terms]"
>   - "I understand what data {{brand}} collects from {{name}}"
> - Primary button: "Send verification email"
>
> Follow-up: guardian receives email with verification link;
> separate landing page completes the consent flow.
>
> ### Variant 9 — OAuth callback
>
> The intermediate page user sees after authenticating with an
> OAuth provider. Brief, often invisible:
> - Centered loading spinner
> - "Signing you in..." (body-md)
> - Auto-redirects to dashboard or onboarding on success
>
> Error states (when OAuth fails or is denied):
> - "We couldn't sign you in" + reason ("You denied access",
>   "Provider error", etc.)
> - Primary action: "Try again"
> - Secondary action: "Use email instead"
>
> ### Section 10 — Security copy reference
>
> A reference card showing security-conscious copy patterns:
>
> | Situation                                | Bad copy                | Good copy                   |
> | ---------------------------------------- | ----------------------- | --------------------------- |
> | User enters wrong email at signin        | "Email not found"       | "Wrong email or password"   |
> | User enters wrong password at signin     | "Wrong password"        | "Wrong email or password"   |
> | Account locked after N attempts          | "Locked"                | "Too many attempts. Try in 15 minutes or [reset password]." |
> | Reset link clicked twice                 | "Already used"          | "This link was already used. [Request a new one]." |
> | Reset link expired                       | "Token expired"         | "This link has expired. [Request a new one]." |
>
> Don't leak account-existence — use ambiguous copy on signin
> errors. The good versions don't reveal whether the email exists
> in the system.
>
> ### Section 11 — Responsive behavior
>
> All variants render at all 3 canonical breakpoints. The auth-card
> max-width stays 480px on tablet and desktop; mobile uses
> full-width with edge padding.
>
> ### Naming
> - Per-variant frames: `auth-{{variant-slug}}-{{breakpoint}}`
>   (e.g. `auth-signin-desktop`, `auth-mfa-mobile`)
> - Shared layout reference: `auth-shared-layout`
> - Security copy reference: `security-copy-reference`

## Execution

```bash
pencil --out design/templates/auth.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- All 7 base variants present + 2 conditional (passkeys, guardian-
  consent) per flags
- Each variant rendered at all 3 canonical breakpoints
- Security copy reference present with at least 5 examples
- Loading / success / error states visible for variants that have
  them (magic-link landing, MFA, OAuth callback)
- Footer links + brand block consistent across all variants

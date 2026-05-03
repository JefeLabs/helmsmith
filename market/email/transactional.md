---
description: Generate transactional emails — receipts, password reset, account verification, security alerts, invoices, refunds, account-change confirmations. These are user-triggered, informational, time-sensitive, and exempt from many marketing-email rules but carry their own correctness requirements (legal accuracy, reachability, plain language).
argument-hint: <type> [--variant <slug>] [--informed-by <brief-slug>] [--render-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate a transactional email for a specific user-triggered
event. Transactional emails are different from marketing in
intent, voice, compliance posture, and visual restraint:

- **User-triggered** — sent in response to a user action (signup,
  purchase, password reset, account change), not on a marketing
  schedule
- **Informational, not promotional** — the email's purpose is to
  confirm or inform, not to convert
- **Often legally consequential** — receipts have tax implications;
  confirmations are evidence; security alerts trigger user actions
- **Compliance posture differs** — CAN-SPAM doesn't require
  unsubscribe (users can't unsubscribe from receipts they need);
  GDPR data-processing rules still apply
- **Visual restraint** — avoid promotional flourish; be readable,
  printable, and unambiguous

## Supported types

The `type` positional argument:

- **`receipt`** — purchase confirmation with itemization, totals,
  tax, payment method, customer info
- **`password-reset`** — password reset link with expiry,
  request-source info, "didn't request this" guidance
- **`account-verify`** — email verification on signup, with
  one-time link
- **`security-alert`** — security-relevant event notification
  (new device login, password changed, 2FA changes, suspicious
  activity)
- **`invoice`** — recurring billing invoice with line items,
  payment status, payment-method update link
- **`refund`** — refund processed, with original transaction
  reference
- **`account-change`** — confirmation of email change, plan
  change, data export, account closure
- **`shipping`** — order shipped, tracking number, ETA (for
  physical goods; less relevant for SaaS)
- **`other`** — freeform; the command asks what's needed

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/email/_context.md`, and `product/.pencil-tone.json`.
2. Read `product/.pencil-brand.json` for visual identity and
   compliance settings (audience-regulation matters: K-12 may
   need parent CC; healthcare needs HIPAA-aware handling of
   PHI in email).
3. Resolve inputs:
   - First positional: type (per list above)
   - `--variant <slug>` — sub-type (e.g. `password-reset` with
     `--variant 2fa-disabled` for a security-alert-flavored
     variant). Optional.
   - `--informed-by <brief-slug>` — context from a brief if the
     transactional flow is part of a larger feature (e.g.
     password-reset for a new auth system).
   - `--render-only` — skip MJML compile.
   - `--dry-run` — preview without producing files.
4. **Critical compliance check** — for `password-reset`,
   `account-verify`, `security-alert`, verify the brand JSON has:
   - `brand.email.fromName` (recognizable display name; spoofing
     concerns are highest for these emails)
   - `brand.email.fromAddress` (matches DKIM-signed domain)
   - DMARC policy declared somewhere in project config
   These emails are phishing targets — getting from-address and
   sender authentication right is correctness, not nice-to-have.

## Phase 1 — Determine voice modulation

Transactional voice differs by sub-type:

| Type             | Warmth   | Authority  | Energy   | Notes                                |
| ---------------- | -------- | ---------- | -------- | ------------------------------------ |
| receipt          | +0.5     | unchanged  | -0.5     | Acknowledge purchase warmly; precise |
| password-reset   | unchanged| +0.5       | -0.5     | Calm, precise, no exclamation        |
| account-verify   | +0.5     | unchanged  | unchanged| Welcoming but not over-celebratory   |
| security-alert   | unchanged| +0.5       | -1.0     | Calm, factual, action-oriented       |
| invoice          | unchanged| unchanged  | -0.5     | Neutral, professional                |
| refund           | +0.5     | unchanged  | unchanged| Acknowledge, don't apologize         |
| account-change   | unchanged| +0.5       | -0.5     | Confirmatory, factual                |
| shipping         | +0.5     | unchanged  | unchanged| Excited but brief                    |

Voice should NEVER cross into urgent for transactional —
"YOUR PASSWORD WAS RESET ACT NOW" reads as phishing. Calm
precision is the discipline.

## Phase 2 — Generate subject line + preheader

Transactional subject conventions:

- **Specific over generic** — "Your receipt from Acme" beats
  "Receipt"
- **Reference-number when applicable** — "Order #4839 confirmed"
  helps users find it later
- **No emoji in subject** for security/financial types — emoji
  reads as low-trust in security context
- **No A/B variants** — transactional emails aren't tested for
  open rate; they need to arrive predictably
- **Length 30-50 chars** standard

Preheader for transactional:

- Often references the action's outcome plainly: "Order total:
  $48.92, ships Friday" or "Reset link expires in 30 minutes"
- Calmer than marketing preheaders

Examples:

```
receipt:
  Subject:   "Your receipt from Acme — Order #4839"
  Preheader: "Total: $48.92. Charged to •••• 4242."

password-reset:
  Subject:   "Reset your Acme password"
  Preheader: "This link expires in 30 minutes. Didn't request this? Read on."

account-verify:
  Subject:   "Verify your email for Acme"
  Preheader: "One click confirms your address. Takes 5 seconds."

security-alert:
  Subject:   "New sign-in to your Acme account"
  Preheader: "Tuesday 2:47 PM, Chrome on Windows, San Francisco. If this was you, no action needed."
```

## Phase 3 — Design

Transactional layout differs from marketing:

- **Information-density first** — the user wants the info, not
  the experience
- **Clear hierarchy** — primary info at top, action/link prominent
  but not flashy, supporting details below
- **Print-friendly** — receipts often get printed; CSS should
  support print media gracefully
- **Plain-language always** — no marketing copy in body
- **Single CTA when applicable** — "Reset password", "Verify
  email", "View receipt" — one button, not three

Specific patterns by type:

**receipt**:
```
[Logo]

Receipt

Order #4839 — confirmed Tuesday, May 2, 2026

  [Item 1]              $19.99
  [Item 2]              $24.99
  Subtotal              $44.98
  Tax                    $3.94
  ─────────────────────────────
  Total                 $48.92

Charged to •••• 4242 (Visa)
Sent to: customer@example.com

[View order details — primary CTA]

Questions? Reply to this email.
```

**password-reset**:
```
[Logo]

Reset your password

We got a request to reset the password for {{ email }}.

[Reset password — primary CTA]

This link expires in 30 minutes.

Didn't request this? Your account is safe — just ignore this
email. If you're concerned, contact support@acme.com.

Request details:
  Tuesday, May 2, 2026 at 2:47 PM PT
  IP: 198.51.100.42
  Browser: Chrome on macOS
```

**security-alert**:
```
[Logo]

New sign-in to your account

A new device just signed in to your Acme account.

  When:    Tuesday, May 2 at 2:47 PM PT
  Where:   San Francisco, CA (approximate)
  Device:  Chrome on Windows
  IP:      198.51.100.42

If this was you, no action needed.

If you don't recognize this:
  - Change your password: [Change password]
  - Review active sessions: [View sessions]
  - Contact support: support@acme.com
```

Run the design generation per `market/email/_context.md` MJML
patterns. Use brand colors but **less of them** — transactional
should read as official, not branded-marketing-y.

## Phase 4 — Compile + validate

Standard MJML compile per `market/email/_context.md`. For
transactional, additional validation:

- **Verify all links are absolute** (no relative paths — they
  break in clients)
- **Verify dynamic data uses placeholders correctly** — typos in
  `{{ user_email }}` vs `{{ email }}` produce broken sends
- **Verify reference numbers are placeholder-style** — never
  hardcode `#4839` in design
- **Print-stylesheet check** — receipts especially should render
  cleanly when printed

For password-reset, verify the link is single-use, time-limited,
and doesn't include sensitive data in the URL itself (the token
should be opaque, not the user's email or password hash).

## Phase 5 — Plain-text alternative

Transactional plain-text is **especially important** because:

- Power users with strict email setups force plain-text rendering
- Some compliance contexts require plain-text alternative for
  archive/audit purposes
- Email forwarding can lose HTML; plain-text survives

The .txt should preserve all critical info, in readable plain
text formatting. For receipts especially, the .txt should be
self-contained — no "view in browser" required to understand
the purchase.

## Phase 6 — Metadata JSON

Critical fields for transactional:

```jsonc
{
  "kind": "transactional",
  "subType": "password-reset",                     // matches the type argument
  "name": "password-reset",
  "trigger": {
    "type": "event",
    "event": "auth.password.reset.requested",
    "delay": "0m"
  },
  "subject": {
    "primary": "Reset your Acme password"
    // No variants — transactional doesn't A/B
  },
  "compliance": {
    "isMarketing": false,                          // transactional exemption
    "regions": ["US", "EU", "CA"],
    "requiresUnsubscribe": false,                  // exempt for transactional
    "physicalAddress": "from .pencil-brand.json"
  },
  "security": {                                    // present for security-relevant types
    "phishingTarget": true,                        // password-reset, security-alert flagged
    "linkExpirySeconds": 1800,                     // 30 min for password-reset
    "singleUseToken": true
  },
  "rendering": {
    "supportsDark": true,
    "supportsLight": true,
    "primaryClient": "auto",
    "fallbackFontStack": "Inter, Helvetica, Arial, sans-serif"
  }
}
```

The `security.phishingTarget` field signals to ESP integrations
that this email is a phishing target — many ESPs apply additional
authentication when sending these (BIMI logo display, branded
sender, header markers).

## Reporting

Illustrative:

```
✓ Transactional email generated: password-reset

Files:
  design/marketing/email/transactional/password-reset.pen
  design/marketing/email/transactional/password-reset.mjml
  design/marketing/email/transactional/password-reset.html  (18KB)
  design/marketing/email/transactional/password-reset.txt
  design/marketing/email/transactional/password-reset.json

Subject:    "Reset your Acme password"
Preheader:  "This link expires in 30 minutes..."
Trigger:    auth.password.reset.requested (immediate)
Voice:      Confident Mentor (authority +0.5, energy -1.0)

Security:
  Phishing target:     yes
  Link expiry:         1800s (30 min)
  Single-use token:    yes

Compliance:
  CAN-SPAM unsubscribe: not required (transactional exemption)
  GDPR data minimization: verified (no PII in link payload)

Action items:
  1. Wire to your auth system's password-reset trigger
  2. Verify DKIM signing covers this from-address
  3. Test the from-address has BIMI configured if you want
     branded sender display in supporting clients
```

## Compliance edge cases

**Transactional + marketing in one email**: legally risky. Adding
"Did you know we also sell X?" to a receipt makes the receipt
subject to CAN-SPAM marketing rules (unsubscribe required, etc.).
Don't do this. Keep them separate.

**Receipts in regulated industries**:
- **Financial services**: receipts may need specific FDIC
  disclosures, dispute-resolution language
- **Healthcare**: PHI cannot appear in unencrypted email. Receipts
  for healthcare purchases need careful redaction.
- **K-12 (FERPA/COPPA)**: receipts for parent purchases on behalf
  of minors have specific data-handling rules

When `audienceRegulation` is set in brand JSON, surface relevant
constraints during generation.

**International tax**: receipts in EU/UK need VAT itemization;
in some countries, registered VAT number must appear. Generate
placeholder fields the ESP integration fills from order data.

## Idempotency

Same as `welcome.md` — re-running overwrites design files; metadata
regenerates.

## What this command does NOT do

- **Does not handle multi-language transactional copy.** Receipts
  in multiple languages typically come from the order system,
  not from a design-system command. Generate per-language
  variants manually if needed.
- **Does not validate legal accuracy of receipt text.** The
  command produces the receipt template; legal/finance review
  the substantive content.
- **Does not configure DKIM/SPF/DMARC.** Infrastructure work.
- **Does not implement abuse rate-limiting on password-reset
  emails.** That's auth-system code; the email design assumes
  rate-limiting is upstream.

# Email — Medium Context (`market/email/`)

> Read this in addition to `product/strategy/_context.md`,
> `market/_context.md`, and (when established)
> `product/.pencil-tone.json` whenever any `/market:email:*`
> command runs.
>
> Email is the most technically-constrained marketing medium. The
> rules in this file aren't preferences — they're correctness
> requirements rooted in what email clients actually render.
> Violating them produces broken email on real users' devices.

## Why email is hard

Email rendering is fragmented across ~40 distinct rendering
engines. The same HTML produces different output in Gmail web,
Gmail iOS, Gmail Android, Apple Mail (iOS / iPadOS / macOS),
Outlook 2007-2019 (Word rendering engine — the hardest target),
Outlook 365 (web — better), Outlook iOS, Outlook Android, Yahoo
Mail, AOL, ProtonMail, plus a long tail. Modern web techniques
(flexbox, grid, custom fonts, CSS variables, animations, JS) are
unreliable or unsupported. The medium is closer to 2003-era HTML
than to modern web design.

The discipline is **defensive rendering**: build for the worst
client (Outlook on Windows), then progressively enhance for
better ones.

## File layout

```
design/marketing/email/
├── welcome.pen              (or welcome/step-1.pen ... step-N.pen for series)
├── welcome.mjml             (MJML source)
├── welcome.html             (compiled, deliverable)
├── welcome.txt              (plain-text alternative — required)
├── welcome.json             (metadata: subject lines, preheader, audience, triggers)
├── transactional/
│   ├── receipt.{pen,mjml,html,txt,json}
│   ├── password-reset.{pen,mjml,html,txt,json}
│   └── ...
├── newsletter/
│   └── monthly.{pen,mjml,html,txt,json}
├── nurture/
│   └── trial-conversion/
│       ├── step-1.{pen,mjml,html,txt,json}
│       ├── ...
│       └── sequence.json    (orchestration: triggers, delays, branches)
└── promo/
    ├── feature-launch-saved-searches.{pen,mjml,html,txt,json}
    └── ...
```

The `.pen` is the design source (visual layout). The `.mjml` is
the developer-facing markup. The `.html` is the compiled output
sent to ESPs. The `.txt` is the plain-text alternative (required
by RFC 2822 best practice + spam filters). The `.json` carries
metadata that ESP integrations consume.

## MJML — the recommended authoring layer

[MJML](https://mjml.io) is a markup language that compiles to
email-safe HTML. It handles client compatibility automatically:
table-based layouts for Outlook, conditional comments where
needed, dark-mode meta tags, mobile responsiveness via media
queries, all generated.

Why MJML over hand-crafted HTML:

- **Outlook compatibility comes free** — VML backgrounds,
  conditional comments, table-based fallbacks all generated
- **Mobile-responsive by default** — `<mj-section>` and
  `<mj-column>` produce the right media queries
- **Dark-mode handling baked in** — meta tags + color-scheme
  support generated when configured
- **Maintainable** — MJML source is ~30% the size of compiled
  HTML and far more readable
- **Battle-tested** — used by major ESPs (Mailjet authored it),
  millions of emails sent

When NOT to use MJML:

- The user has an existing email template system they want to
  preserve (Foundation for Emails, hand-rolled HTML, ESP-specific
  WYSIWYG output). Don't force-migrate.
- The email is so simple that MJML overhead isn't worth it
  (e.g. plain-text-only with minimal HTML). For these, hand-craft
  with a minimal table wrapper.

When MJML is the path, install once: `npm i -g mjml`. Compile
with `mjml input.mjml -o output.html`.

## Width, columns, and responsive behavior

- **Standard width**: 600px desktop; 320-480px mobile (depends on
  device). Email clients vary — some give you 600px guaranteed
  (Gmail web), some constrain to 280-320px on phones.
- **Don't exceed 640px** — some clients clip beyond this.
- **Single column is safest** for primary content. Two-column is
  fine on desktop, stacks on mobile. Three+ columns rarely render
  well on mobile and are usually a smell.
- **Padding > margin** — margin support is unreliable in Outlook;
  padding works everywhere.

## Dark mode

Three behavior categories across clients:

1. **Respects color-scheme** (Apple Mail, iOS Mail): reads `meta
   name="color-scheme"` and `meta name="supported-color-schemes"`.
   When set to `"light dark"`, the email's CSS dark-mode rules
   apply on dark devices.
2. **Auto-inverts everything** (some Outlook variants, older
   Yahoo): inverts colors regardless of meta tags. Logos and
   brand colors can flip ugly. Counter with media queries
   targeting `prefers-color-scheme: dark` and explicit color
   overrides.
3. **Stays light always** (Gmail dark mode applies a partial
   tint but doesn't fully invert): generally less hostile.

Strategies:

- **Always set color-scheme meta tags** when supporting both:
  `<meta name="color-scheme" content="light dark">` and
  `<meta name="supported-color-schemes" content="light dark">`
- **Provide a dark-mode CSS block** with media query
  `@media (prefers-color-scheme: dark)`. Override critical
  colors (background, text, brand colors) explicitly.
- **Test logo on dark backgrounds** — if the logo is dark on
  light, provide a light variant for dark-mode and swap via
  media query
- **Avoid pure white backgrounds** — `#ffffff` triggers
  aggressive inversion in some clients. `#fafafa` or `#f7f7f7`
  is safer

Brand JSON's `supportsDark` and `supportsLight` flags drive
which CSS blocks the email includes.

## Outlook — the hardest target

Outlook 2007-2019 on Windows uses Microsoft Word's HTML rendering
engine, which is unrelated to any web browser's. It's the reason
email design feels stuck in 2005.

What Outlook breaks:

- **CSS background images** — use VML fallback:
  `<!--[if mso]><v:rect>...</v:rect><![endif]-->`
- **Flexbox, Grid, transforms** — none. Tables only.
- **Border-radius** — partial support; corners can render square.
- **CSS animations** — none.
- **Custom fonts** — fallback fonts only on Windows desktop.
  Specify a web-safe fallback chain.
- **Padding on `<a>` tags** — broken; wrap in table cells with
  padding.
- **SVG** — no. Use PNG fallbacks.
- **Margin: auto centering** — unreliable. Use `align="center"`
  on tables.

What's reliable in Outlook:

- Table-based layout with explicit widths
- Inline CSS (more reliable than `<style>` blocks)
- Web-safe fonts (Arial, Helvetica, Georgia, Times New Roman,
  Verdana, Tahoma, Trebuchet MS, Courier New)
- Bullet-proof buttons (table-based, not styled `<a>`)
- `bgcolor` attribute (older but reliable)

Rule: when in doubt, view the rendered email in Outlook. Litmus,
Email on Acid, and Mailtrap provide multi-client previews. For
critical sends, screenshot every client variant before
committing.

## Deliverability fundamentals

These aren't optional — modern email infrastructure rejects mail
that fails them:

- **SPF (Sender Policy Framework)** — DNS TXT record listing
  servers authorized to send on the domain's behalf
- **DKIM (DomainKeys Identified Mail)** — cryptographic signature
  on outbound mail; receiver verifies via public key in DNS
- **DMARC (Domain-based Message Authentication)** — policy layer
  on top of SPF + DKIM; tells receivers what to do with failures
- **BIMI (Brand Indicators for Message Identification)** —
  optional; displays brand logo in supporting clients (Gmail,
  Apple Mail) when SVG meets spec + organization is verified
- **Reverse DNS (PTR)** — sending IP should resolve to a hostname

The email design commands don't configure these (that's
infrastructure work), but they reference what's needed in
generated metadata so the team knows what's required for
deliverability.

## Anti-spam considerations

What triggers spam filters in 2026:

- **Image-only emails** — must have meaningful HTML text content
- **Excessive use of capital letters in subject** — `WIN BIG NOW`
  flags hard
- **Excessive exclamation points** — one is fine; three is bad
- **Spam-trigger words in subject** — "free", "guarantee",
  "click here", "act now", "limited time" — context-dependent
  but some are heavily weighted
- **Missing physical address footer** (CAN-SPAM violation +
  spam signal)
- **Missing unsubscribe link** (CAN-SPAM violation + spam signal)
- **Broken HTML** (parser errors trigger filters)
- **Mismatched display name vs. from address** ("Trusted
  Source <random@example.com>")
- **Attachment-heavy** (most marketing email shouldn't have
  attachments)
- **Suspicious link patterns** — link text saying "yourbank.com"
  but hrefing elsewhere; redirect chains; URL shorteners with
  history of abuse

The `tone:test` voice tool catches some of these (avoid-list
words). Compliance-specific anti-spam is documented per-command.

## Required structural elements

Every marketing email must have:

1. **Subject line** — 30-50 chars typical; 30-60 for mobile preview
2. **Preheader text** — 50-110 chars, hidden in body but shown in
   inbox preview; critical for open rates
3. **From name + from address** — recognizable display name +
   a real, monitored sender address (not noreply@)
4. **Logo** — usually top, dark + light variants for dark-mode
5. **Body content** — single clear CTA when promotional;
   informational structure when transactional
6. **CTA button** (when applicable) — bullet-proof button pattern,
   not styled `<a>`
7. **Footer** — physical address (CAN-SPAM), unsubscribe link
   (CAN-SPAM, GDPR), preferences link (GDPR-soft), social links
   (optional), copyright/legal text

Transactional emails (receipts, password reset) skip some of
these — unsubscribe is not required for transactional under
CAN-SPAM (and shouldn't be present, since users can't unsubscribe
from receipts they need). Footer rules differ.

## Subject line + preheader generation

Both pull from `product/.pencil-tone.json` for voice. Both should
be generated with intent — not as afterthoughts.

**Subject line rules**:

- 30-50 chars in voice
- Specific over abstract ("Saved searches launched" beats
  "Big news inside")
- Front-load the meaningful word — Gmail truncates at ~50 chars
  on mobile
- Personalization (`{{ first_name }}`) when ESP supports it; not
  required, often overused
- A/B testing two variants is standard practice for marketing
  emails (one tested per send is enough; running 4+ variants
  needs significant volume to detect winner)
- Avoid spam triggers (caps, exclamation chains, dollar signs,
  free/guarantee/now)
- Voice consistency — run through `tone:test --context
  welcome-subject` (or matching context) before committing

**Preheader rules**:

- 50-110 chars; longer than subject, shorter than body
- Doesn't repeat the subject — extends or complements it
- First sentence of body content is a common preheader source,
  but standalone preheaders that frame the email's intent
  outperform generic openers ("Hi {{name}},")
- Hidden in body via inline styles:
  `<div style="display:none;font-size:1px;line-height:1px;...">`

## Plain-text alternative (`.txt`)

Required by RFC 2822 best practice and most ESPs. Spam filters
weight emails without plain-text alternative more harshly.

The `.txt` should:
- Carry the same essential information as the HTML
- Use plain text formatting (no markdown ASCII art)
- Include the same links (as full URLs)
- Include the unsubscribe instruction in plain text
- Be generated alongside the HTML, not as an afterthought

ESP integrations typically allow specifying both; the recipient's
client picks based on its preferences. Most users see HTML; some
see .txt.

## Voice modulation per email type

Email is a relatively voice-faithful medium (more than SMS, less
than social). Standard modulations:

- **Welcome / onboarding**: warmth +0.5 over canonical voice;
  energy +0.5; the user just signed up — meet them with
  enthusiasm without overdoing it
- **Transactional (receipt, confirmation)**: warmth +0.5 (small
  acknowledgment), authority unchanged, energy slightly lowered
  (don't celebrate a routine confirmation as if it were a feature
  launch)
- **Transactional (password reset, security alert)**: warmth
  unchanged, authority +0.5 (this is a serious operation),
  energy -0.5 (no exclamation points; calm precision)
- **Newsletter**: voice fully expressed; this is the brand's
  recurring read
- **Nurture**: warmth +0.5 over canonical; the reader is in a
  consideration window, not a transactional moment
- **Promotional**: voice fully expressed; energy +0.5 OK for
  launches but never crossing into urgent (which reads as desperate)

These are starting points. Per-channel commands document their
specific modulation in their own files.

## Compliance — explicit rules

**CAN-SPAM (US, marketing email)**:
- Don't deceive (subject must reflect content)
- Identify as advertisement when applicable
- Tell recipients where you're located (physical address)
- Tell recipients how to opt out
- Honor opt-out requests within 10 business days
- Monitor what others do on your behalf

**GDPR (EU, all marketing email)**:
- Lawful basis required (consent, legitimate interest, contract)
- Granular consent (separate marketing-email opt-in)
- Easy withdrawal of consent (one-click unsubscribe)
- Right to be forgotten (deletion requests honored)
- Privacy policy link required

**CASL (Canada, all commercial email)**:
- Express consent required (opt-in, not opt-out)
- Identify sender clearly
- Provide unsubscribe mechanism

**Country-specific**:
- Australia (Spam Act 2003) — similar to CAN-SPAM + CASL hybrid
- UK (PECR) — GDPR-aligned, with some UK-specific retention rules
- Brazil (LGPD) — GDPR-equivalent

When the brand JSON's `audienceRegulation` is set, additional
compliance applies (FERPA/COPPA for K-12, HIPAA for healthcare,
etc.). The audit's compliance plane catches violations.

## Metadata file structure (`<email>.json`)

Every email produces a metadata JSON file that ESP integrations
consume:

```jsonc
{
  "kind": "welcome",                            // welcome | transactional | newsletter | nurture | promotional
  "name": "welcome-step-1",
  "audience": "new-signups",                    // matches channelAudience in .pencil-marketing.json
  "trigger": {
    "type": "event",                            // event | scheduled | manual
    "event": "user.signup.completed",
    "delay": "0m"                               // ISO 8601 duration
  },
  "subject": {
    "primary": "Welcome — let's get you set up",
    "variants": [                               // for A/B testing
      "You're in. Here's where to start.",
      "Welcome aboard. 3 things to do first."
    ]
  },
  "preheader": "Quick tour of your new dashboard, plus the 3 things to set up first.",
  "from": {
    "name": "Acme",                             // display name
    "address": "hello@acme.com"                 // monitored, not noreply
  },
  "replyTo": "support@acme.com",                // optional
  "voice": {
    "tone": "product/.pencil-tone.json",         // reference; voice is canonical
    "modulation": {                             // medium-specific overrides
      "warmth": "+0.5",
      "energy": "+0.5"
    }
  },
  "compliance": {
    "isMarketing": true,                        // affects unsubscribe requirements
    "regions": ["US", "EU", "CA"],              // jurisdiction list
    "physicalAddress": "from .pencil-brand.json",
    "unsubscribeUrl": "{{ unsubscribe_url }}",  // ESP-injected
    "preferencesUrl": "{{ preferences_url }}"   // ESP-injected
  },
  "rendering": {
    "supportsDark": true,                       // pulled from brand JSON
    "supportsLight": true,
    "primaryClient": "auto",                    // auto-detect or specify (gmail, outlook, etc.)
    "fallbackFontStack": "Inter, Helvetica, Arial, sans-serif"
  },
  "deliverable": {
    "html": "design/marketing/email/welcome-step-1.html",
    "text": "design/marketing/email/welcome-step-1.txt",
    "mjml": "design/marketing/email/welcome-step-1.mjml",
    "design": "design/marketing/email/welcome-step-1.pen"
  }
}
```

ESP-specific integrations (Customer.io, Loops, Resend, Mailchimp,
Klaviyo, etc.) consume this metadata. The `compliance.physicalAddress`
field is dereferenced from `.pencil-brand.json` at send time — keeping
it in one canonical place avoids drift.

## Constrained-mode notes

Email design is more network-tolerant than research (no Semrush
dependency). When MJML CLI isn't installed, fall back to
hand-crafted HTML using table-based layout. Document the fallback
in the email's `.json` so the team knows it skipped MJML
compilation.

## Anti-patterns

- **Designing for Gmail web only** — what looks great in Gmail
  often breaks in Outlook. Always test in Outlook (real or
  Litmus/EmailOnAcid).
- **CSS-heavy designs** — every CSS feature you use is a
  potential rendering bug. Restraint is the discipline.
- **Image-only emails** — broken when images are blocked
  (corporate firewalls, Gmail's image-blocking-by-default for
  unknown senders). Always have meaningful HTML text.
- **No-reply sender** — `noreply@` is a deliverability and trust
  signal that this brand doesn't want to hear from users.
  Use a monitored address.
- **Subject + preheader say the same thing** — wastes preheader
  real estate; preheader should extend or complement, not echo.
- **Unsubscribe in 4-point gray text** — illegal under GDPR and
  bad practice everywhere else. Make it visible.
- **Generating a "responsive" email that's just shrunk desktop**
  — mobile email rendering needs intentional mobile design, not
  a smaller version of desktop. Single-column on mobile is the
  standard.

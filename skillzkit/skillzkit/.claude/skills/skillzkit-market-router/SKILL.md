---
name: skillzkit-market-router
description: Route marketing, content, and campaign intent to the right slash command in the skillzkit suite. Fires when the user wants to draft a press release, build a media kit, pitch journalists, populate a newsroom page, write organic social posts (LinkedIn / X / Instagram / Facebook / TikTok), generate paid ad copy (Google search / display / social / video / retargeting / landing-page pairing), draft emails (welcome / promotional / newsletter / nurture / transactional), establish or refine brand voice, test copy against the established tone, coordinate a multi-channel social campaign, or run launch / seasonal / reactivation / annual-marketing-calendar / monthly-marketing-calendar workflows. Prefer this router over product/engineer/tools/integrations when the user's verb is write copy, draft, post, send, announce, pitch, campaign, schedule, or tone.
---

# skillzkit-market-router

Routes natural-language intent in the **market layer** — voice,
email, ads, social, PR, campaigns — to the correct slash command.

## In scope

Five medium sub-namespaces and a workflows folder under `market/`:

- **`market/tone/`** — establish, refine, and test brand voice
- **`market/email/`** — newsletter, promotional, transactional,
  welcome, nurture
- **`market/ads/`** — paid search, display, social, video,
  retargeting, ad-landing pairing
- **`market/social/`** — organic posts on LinkedIn, X, Instagram,
  Facebook, TikTok, plus cross-channel campaign coordination
- **`market/pr/`** — press release, media kit, journalist
  outreach, newsroom page coordination
- **`market/workflows/`** — launch, seasonal, reactivation,
  annual / monthly marketing calendars

## Out of scope

- **Personas, journeys, design tokens, .pen files, story maps** →
  `skillzkit-product-router`
- **Architecture, ADRs, dependency upgrades, code remediation** →
  `skillzkit-engineer-router`
- **Build / lint / test tools, image diffing, browser automation**
  → `skillzkit-tools-router`
- **Actual publishing of posts, sending of emails, distributing
  to journalists** → `skillzkit-integrations-router` (this
  router *generates* the content; integrations-router *sends*
  it)
- **HeroUI / Storybook component generation** → not routed; the
  newsroom and landing templates live in product-router

## Routing decision rules

### Generation vs publishing

This is the most important distinction in this router:

- **Generation** (drafting, writing, designing copy) stays here.
  Example: "Write a LinkedIn post about the launch" →
  `/market:social:linkedin`.
- **Publishing** (actually posting, sending, scheduling on the
  external platform) goes to `skillzkit-integrations-router`.
  Example: "Now post it to LinkedIn" → integrations-router.

When the user blurs these ("post a tweet about X"), default to
generation first, then *ask* before handing off to publishing.

### Action vs question

- "What's the difference between a nurture sequence and a
  promotional email?" → answer; do not invoke a command.
- "Why is our voice considered authoritative?" → look up
  `market/tone` content; do not run `/market:tone:explore`.
- "Draft a nurture sequence" → route.

### Tense awareness

- "I already drafted the post, what now?" → suggest
  `/market:tone:test` to validate against voice, or
  integrations-router to publish; do not regenerate.
- "We launched last week" → past tense, no command needed; this
  is context, not a request.

### Confirmation before high-stakes

The market layer has fewer destructive commands than engineer,
but **anything that could reach customers needs confirmation**:

- `/market:pr:journalist-outreach` — confirm distribution list
  before generating personalized pitches
- `/market:workflows:launch-campaign` — long-running, multi-channel
- `/market:workflows:seasonal-campaign` — long-running
- `/market:workflows:reactivation-campaign` — touches lapsed
  users; confirm audience criteria before drafting
- `/market:workflows:marketing-calendar-annual` — sets quarterly
  themes for a year
- `/market:tone:refine` — modifies the established voice;
  confirm before overwriting voice definition

For low-stakes drafting (single email, single post, single ad
variant), invoke without ceremony — the user can always discard
the draft.

### Show reasoning briefly

When picking between similar commands, name the choice and the
disambiguation criterion:

> Routing to `/market:email:nurture` rather than `promotional`
> because you said "five-step sequence" — that's nurture
> (multi-step with branching), not a one-off send.

### Manifest awareness

- `product/.pencil-market.json` — established voice, channels,
  brand assets, calendar state
- `product/.pencil-ux.json` — personas (referenced by
  persona-targeted campaigns)
- `product/.pencil-workflow-state.json` — in-flight marketing
  workflows

When the user says "the persona" or "our voice", read the manifest
first.

### Override is cheap

If the user says "actually do an Instagram post instead of
LinkedIn", drop and re-route. The output of the prior command (if
any) can usually be adapted rather than discarded.

---

## Command catalog

### `market/tone/` — voice

| Command                                          | Triggers when user wants…                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/market:tone:explore`                           | Explore N candidate brand voices along five dimensions               |
| `/market:tone:refine`                            | Evolve the established voice based on feedback                       |
| `/market:tone:test`                              | Rate a piece of copy against the established voice; surface drift    |

**Disambiguation** — "set the brand voice":

- No voice yet → `explore` (generates candidates).
- Voice exists, needs adjustment → `refine`.
- Voice exists, validating new copy → `test`.

### `market/email/` — email content

| Command                                          | Triggers when user wants…                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `/market:email:newsletter`                       | Recurring newsletter template (repeat-send with content slots)             |
| `/market:email:promotional`                      | One-off promotional email (feature launch, sale, win-back)                 |
| `/market:email:transactional`                    | Transactional emails (receipt, reset, verification, security alert)        |
| `/market:email:welcome`                          | Welcome email — single send or multi-step onboarding triggered by signup   |
| `/market:email:nurture`                          | Multi-step nurture sequence with branching, exit conditions, pacing        |

**Disambiguation** — "draft an email":

| If the user says…                                       | Route to        |
| ------------------------------------------------------- | --------------- |
| "newsletter", "weekly digest", "monthly update"         | `newsletter`    |
| "promo", "sale", "launch announcement", "limited offer" | `promotional`   |
| "receipt", "password reset", "verification", "alert"    | `transactional` |
| "welcome", "onboarding", "first-week"                   | `welcome`       |
| "drip", "sequence", "five-step", "branching"            | `nurture`       |

If unclear, ask.

### `market/ads/` — paid

| Command                                          | Triggers when user wants…                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `/market:ads:search`                             | Search ads (Google, Bing, Apple Search) — responsive search ads            |
| `/market:ads:display`                            | Display network ads (Google Display, programmatic, image-based)            |
| `/market:ads:social`                             | Paid social ads (Meta, X, LinkedIn, TikTok) — distinct from organic posts  |
| `/market:ads:video`                              | Video ads (YouTube TrueView, pre-roll, Meta in-stream)                     |
| `/market:ads:retargeting`                        | Retargeting creative for users who already engaged                         |
| `/market:ads:landing`                            | Coordinate ad-creative ↔ landing-page pairing for message match            |

**Disambiguation** — "social ad" vs "social post":

- **Paid placement** → `/market:ads:social` (creative for paid
  campaign).
- **Organic content** → `/market:social:<channel>` (post
  appearing in feed without paid promotion).

This trips users up. Always confirm if the verb is ambiguous.

### `market/social/` — organic

| Command                                          | Triggers when user wants…                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `/market:social:linkedin`                        | Organic LinkedIn posts (text-led, single-image, document carousel, video)  |
| `/market:social:x`                               | Organic X posts — single tweets and threads (280-char compression)         |
| `/market:social:instagram`                       | Organic IG (feed single-image / carousel / video, Stories, Reels)          |
| `/market:social:facebook`                        | Organic FB Page posts (image, video, carousel, link, status, event)        |
| `/market:social:tiktok`                          | Organic TikTok (short vertical 9:16; sound-on, native-feeling)             |
| `/market:social:campaign`                        | Coordinate a multi-channel organic social campaign from one source brief   |

**Disambiguation** — "write a post":

- Ask which channel. Each has different conventions:
  - LinkedIn — long-form-friendly, professional voice
  - X — 280-char compression, conversational
  - Instagram — visual-first, longer captions
  - Facebook — broader audience, lower density
  - TikTok — vertical video, sound-on, trend-aware

If the user wants to fan-out one message across all of them →
`campaign`.

### `market/pr/` — press

| Command                                          | Triggers when user wants…                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `/market:pr:press-release`                       | Press release — news genre, third-person, AP-style                         |
| `/market:pr:media-kit`                           | Downloadable press kit — logos in multiple formats, brand assets, boilerplate |
| `/market:pr:journalist-outreach`                 | Personalized pitch emails to specific journalists                          |
| `/market:pr:newsroom`                            | Coordinate newsroom page content (releases archive + media-kit + boilerplate) |

**Disambiguation**:

- "Press release" — formal news genre (`press-release`)
- "Pitch a journalist" — personalized 1:1 email (`journalist-outreach`)
- "Send the release to journalists" — combine: generate the
  release here, then either generate pitch emails (still here)
  or hand off publishing/distribution to integrations-router

**Hard rule** — `journalist-outreach` writes individualized
emails. Confirm distribution list and tone before generating, and
never hand off to publishing without explicit user approval per
recipient.

### `market/workflows/` — long-running marketing flows

Invoke through `/core:workflows:manage start market:<workflow-slug>`:

| Workflow                                                  | Triggers when user wants…                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `market:launch-campaign`                                  | Coordinated launch across email + ads + organic social + PR + landing page      |
| `market:seasonal-campaign`                                | Calendar-tied campaign (Black Friday, year-end, back-to-school, fiscal moments) |
| `market:reactivation-campaign`                            | Win back lapsed users via email reactivation + retargeting + tuned landing      |
| `market:marketing-calendar-annual`                        | Strategic 12-month marketing calendar (quarterly themes, channel mix)           |
| `market:marketing-calendar-monthly`                       | Tactical 4-6 week schedule fed by the annual calendar                           |

**Disambiguation** — workflow vs single command:

- One-off content (one email, one post, one release) → direct
  command.
- Multi-channel coordinated push (announcement landing on email,
  social, PR, ads simultaneously) → `launch-campaign` workflow.
- Recurring planning artifact → calendar workflows.

---

## Cross-router handoffs

### To `skillzkit-integrations-router` (publishing)

This is the most common handoff. After drafting copy, the user
typically wants to publish it:

| Generated here                       | Publish via                                                              |
| ------------------------------------ | ------------------------------------------------------------------------ |
| LinkedIn post                        | `/core:integrations:linkedin` (or `/core:integrations:hootsuite` if delegated)     |
| X post                               | `/core:integrations:x` (or `/core:integrations:hootsuite` if delegated)            |
| Instagram post                       | `/core:integrations:instagram` (or `/core:integrations:hootsuite`)                 |
| Reddit post                          | `/core:integrations:reddit`                                                   |
| Discord message                      | `/core:integrations:discord`                                                  |
| Email newsletter / promo             | `/core:integrations:outlook`, Gmail (if configured), or marketing platform   |
| Press release distribution           | Wire service via integrations (or `/core:integrations:linkedin` company page) |
| Journalist pitch email               | `/core:integrations:outlook` (or Gmail)                                       |

Confirm before handing off to publishing — content reaching real
users is irreversible.

### To `skillzkit-product-router`

- **Persona-targeted campaigns** reference personas from
  product-router. If the user says "for the school admin
  persona", read `product/.pencil-ux.json` to find the persona.
  If it doesn't exist, route to product-router to define it
  before drafting.
- **Newsroom landing pages** for major announcements are
  designed via `/product:design:templates:newsroom`. The
  newsroom *content coordination* lives here
  (`/market:pr:newsroom`); the *page template* lives there.

### To `skillzkit-engineer-router`

- Major product / engineering changes that warrant external
  comms route from engineer-router into this router. Confirm
  the change has been accepted (ADR or release tag) before
  drafting press materials.

### To `skillzkit-tools-router`

- For brand asset image manipulation (resizing logos for media
  kit, format conversion) → `/core:tools:imagemagick`.
- For SEMrush keyword research that informs ad copy →
  integrations-router (not tools-router).

### To non-routed namespaces

- **`/core:audit`** — when the user wants a cross-cutting audit
  that includes market plane drift (voice consistency, calendar
  adherence). The audit defines plane checks per persona.

---

## Anti-patterns

Do not:

- **Confuse paid social with organic social.** Always check
  whether the user means `/market:ads:social` (paid placement)
  or `/market:social:<channel>` (organic feed post).
- **Hand off to publishing without explicit approval.**
  Generation is reversible; publication is not.
- **Run `journalist-outreach` without confirming the
  distribution list.** Personalized pitches sent to the wrong
  journalist damage relationships.
- **Run launch/seasonal/reactivation workflows without
  confirming the audience and timing.** These touch real
  customers.
- **Overwrite the established voice with `tone:refine`** unless
  the user explicitly asked. Default to drafting an alternative
  and showing the diff first.
- **Generate copy without consulting the established voice.**
  Read `product/.pencil-market.json` first; if voice exists,
  cite it in the prompt.
- **Match keywords without checking tense.** "Posted" /
  "shipped" / "sent" are usually past tense, not requests.
- **Pretend the suite has channels it doesn't.** There is no
  `market:social:youtube` or `market:social:bluesky`. Say so
  and offer the closest channel.
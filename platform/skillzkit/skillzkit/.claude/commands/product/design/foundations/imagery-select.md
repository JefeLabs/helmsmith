---
description: Explore stock photography, illustration platforms, AI-generated services, and pattern libraries to suggest N candidate imagery directions for a creative brief. Surfaces vendor strategy, style guidelines, license terms, model-release implications, and search-term / collection-ID mappings. Records the chosen direction — does NOT auto-download assets, manage rights, or call vendor APIs.
argument-hint: [brief text or @path/to/brief.md] [--n 3] [--informed-by <research-json>] [--vendor unsplash|pexels|pixabay|adobe-stock|getty|storyset|undraw|humaaans|firefly|midjourney|any] [--license commercial|free|attribution-ok|opensource] [--style photographic|illustrated|mixed|abstract] [--representation people|abstract|mixed] [--ai-gen allowed|preferred|forbidden] [--render-candidates] [--lock] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Explore curated imagery sources — photographic libraries (Unsplash,
Pexels, Adobe Stock, Getty), illustration platforms (Storyset, unDraw,
Humaaans, Blush, Ouch), AI-generated services (Adobe Firefly,
Midjourney, DALL-E), pattern libraries (Hero Patterns, SVG
Backgrounds), and 3D asset sources — to suggest N candidate imagery
directions for a brand. Outputs style guidelines, vetted vendor list,
license + model-release terms, and the search-term / collection-ID
references the design and content teams use during page production.

This command is a **selection and curation tool, not an asset
fetcher.** It does not download images, manage CDN hosting, embed
files in the design system, or call vendor APIs to retrieve assets.
Image acquisition happens through the vendor platforms — the command
tells you what to look for, where, why, and under what license.

## Where this fits

```
brief
  ├── colors-select   → palette
  ├── fonts-select    → typefaces
  ├── icons-select    → icon family
  └── imagery-select  → photography / illustration direction   ← THIS
        ↓
     foundations:imagery (renders the direction page)
        ↓
     design-page (consumes imagery direction when composing pages)
```

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve the brief input (same priority chain as `colors-select` /
   `fonts-select`):
   - Inline `$ARGUMENTS` (free text or `@path/to/file.md`).
   - `design/briefs/<slug>.md` if it exists.
   - `tagline`, `industry`, `audience`, `tone` from
     `product/.pencil-brand.json`.
   - Otherwise prompt for a 2–3 sentence brief.
3. Resolve flags:
   - `--n` — number of candidate directions. Default `3`, max `5`.
   - `--vendor` — restrict candidate pool to one vendor. Default `any`.
   - `--license` — `commercial` (allows paid), `free` (vendor-free),
     `attribution-ok` (allows attribution-required free sources),
     `opensource` (CC0 / public domain only).
   - `--style` — `photographic` / `illustrated` / `mixed` / `abstract`.
     Constrains the direction set.
   - `--representation` — `people` / `abstract` / `mixed`. Critical
     for products with regulated audiences (K-12, healthcare, finance).
   - `--ai-gen` — `allowed` / `preferred` / `forbidden`. The legal
     landscape for AI-generated imagery is unsettled; products with
     IP / legal sensitivity should set `forbidden`.
   - `--informed-by <research-json>` — load competitive research and
     use it to:
     - **Surface category-conventional imagery directions**:
       research's `industryConventions.imageryDirections` describes
       what's standard (e.g. consumer SaaS tends to use
       people-illustration; B2B enterprise tends toward abstract
       gradients; education tends to lifestyle-photography).
     - **Tag candidates**: each candidate gets a tag —
       `[category-convention]` / `[differentiation]`.
     - **Bias `--style` and `--representation` defaults** when the
       brief is ambivalent: match conventions or diverge depending
       on project strategy.

   Research input is advisory — never overrides explicit user
   selection or audience-regulation constraints.

## Phase 1 — Brief analysis

Standard dimensions plus imagery-specific ones:

| Dimension          | Values                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `tone`             | formal • playful • technical • luxurious • friendly • editorial        |
| `industry`         | (same as elsewhere)                                                     |
| `audience-regulation` | none • k-12 • healthcare-hipaa • financial-services • government     |
| `representation`   | people-first • abstract-only • mixed                                    |
| `composition`      | formal (centered, symmetric) • candid (off-balance, lifestyle) • mixed |
| `color-treatment`  | full-color • desaturated • duotone • monochrome • brand-tinted-overlay |
| `mood`             | bright • neutral • moody • clinical                                     |
| `realism`          | photorealistic • illustrated • abstract • mixed-media                   |
| `era`              | classic • modern • futuristic                                           |

Print the "Read of the brief" block before recommending.

**Audience-regulation is special** — it constrains the entire vendor
strategy. Products serving minors (K-12) should default to
illustration-only or AI-gen-with-no-real-people, not photographs of
children regardless of model release. Healthcare-HIPAA products must
avoid identifiable patient imagery. The command flags this loudly:

```
⚠️  Audience regulation detected: k-12

   Products targeting children under 13 (COPPA) and educational
   contexts (FERPA) face elevated imagery risk. Even with model
   releases, photos of real minors raise consent, age-verification,
   and "right to be forgotten" issues that compound over time.

   Recommended default: illustration or abstract directions.
   Photographic directions are still offered but with explicit
   warnings on each.
```

## Phase 2 — Vendor strategy decision

Resolve vendor strategy before specific directions, like
`fonts-select` does. The strategy constrains the candidate pool and
sets license expectations:

| Strategy           | Vendors                                         | Pros                                          | Cons                                          | Best for                          |
| ------------------ | ----------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------- |
| `free-stock`       | Unsplash, Pexels, Pixabay                      | Free; broad library; lifestyle-strong        | Overused images; attribution loose; quality varies | Marketing sites, MVPs, low-stakes |
| `licensed-stock`   | Adobe Stock, Getty, Shutterstock, iStock       | Premium quality; legal protection; model releases verified | Paid (subscription or per-image); per-domain licensing | Production; legal-sensitive contexts |
| `illustrated`      | Storyset, unDraw, Humaaans, Blush, Ouch        | Friendly; brand-tintable; no model issues; consistent | Limited topical range; can feel generic    | Empty states, dashboards, B2B SaaS, K-12 |
| `mixed`            | Photo for hero, illustration for spot          | Best of both; section-appropriate            | Two style systems to maintain                 | Mature product brands             |
| `ai-generated`     | Adobe Firefly, Midjourney, DALL-E              | Bespoke; on-brand; unlimited variants        | Legal landscape unsettled; no model releases; some platforms ban AI-gen content | Marketing exploration, internal-facing |
| `commissioned`     | Hire an illustrator or photographer            | Fully custom; clear rights; brand-aligned    | Cost; lead time; out of this command's scope | Established brands, high-budget   |
| `mixed-with-ai`    | Photo + illustration + AI for unique compositions | Maximum flexibility                       | Triple maintenance; license patchwork         | Sophisticated content ops         |

**Default recommendations** by brief shape:

- B2B SaaS + dashboard-heavy → `illustrated` (Storyset / unDraw)
- Marketing site + lifestyle-heavy → `free-stock` (Unsplash for hero,
  Storyset for spot illustrations)
- Production app + legal-sensitive → `licensed-stock` (Adobe Stock)
  or `illustrated` for any people imagery
- K-12 / regulated audience → `illustrated` or `ai-generated (Adobe
  Firefly only — commercially safe)`
- Internal tools / MVP → `free-stock` (Pexels / Unsplash)
- Editorial / luxury → `licensed-stock` (Getty / Stocksy curated)

**Adobe Firefly is highlighted in the AI-gen options** because it's
the only major AI image service trained exclusively on licensed
content (Adobe Stock + public domain + Adobe-owned). For commercial
work in legal-sensitive contexts, Firefly is the safest AI choice;
Midjourney and DALL-E carry training-data ambiguity.

User confirms or overrides vendor strategy before Phase 3.

## Phase 3 — Style direction

Within the strategy, generate N candidate directions that vary along
**stylistic dimensions** the brief allows. The pairing principles:

### Photographic style directions (when strategy includes photo)

| Direction              | Visual signature                                            | Best for                          |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- |
| `editorial`            | Cinematic, magazine-like, intentional composition           | Luxury, fashion, editorial brands |
| `lifestyle-candid`     | Off-balance, real moments, natural light                    | Consumer, social, friendly        |
| `product-focused`      | Clean studio, single subject, dramatic lighting             | E-commerce, devices, fintech      |
| `abstract-conceptual`  | Textures, abstract patterns, non-representational           | Tech, finance, B2B SaaS           |
| `architectural`        | Built environments, clean lines, geometric                  | Real estate, dev-tools, govt      |
| `documentary`          | Authentic, often desaturated, journalistic                  | Civic, education, healthcare      |

### Illustration style directions (when strategy includes illustration)

| Direction              | Visual signature                                            | Best for                          |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- |
| `flat-geometric`       | Hard edges, limited palette, vector-like (Storyset, unDraw) | B2B SaaS, dashboards, education   |
| `isometric`            | 3/4 angle, depth without perspective                        | Tech products, data-heavy         |
| `hand-drawn-organic`   | Imperfect lines, sketch quality (Open Peeps, Ouch)          | Friendly consumer, creative brands |
| `3d-illustrated`       | Dimensional, often glossy (IRA Design, Spline)              | Modern tech, gaming, futuristic   |
| `character-driven`     | People-centric illustrations (Humaaans, Blush)              | Social, education, friendly       |
| `editorial-line`       | Thin-line drawings, magazine-style                          | Editorial, luxury, classic        |

### Cross-cutting treatment dimensions

Independent of style, every direction has:

- **Color treatment**: full-color • desaturated • duotone •
  monochrome • brand-tinted overlay
- **Composition**: formal (centered, symmetric) • candid
  (off-balance, lifestyle) • mixed
- **People presence**: heavy (every hero has people) • spot (people
  in some sections) • abstract-only

## Phase 4 — Asset categories

Each direction gets guidelines for **all major asset categories** used
across a typical web product. Not every page needs every category, but
the foundation should cover them so production teams have direction
when each comes up:

| Category              | Typical use                                        | Direction-specific guidance |
| --------------------- | -------------------------------------------------- | --------------------------- |
| `hero`                | Above-the-fold marketing, landing pages            | Largest, most attention; matches direction's primary signature |
| `section-break`       | Mid-page sections, feature transitions             | Lighter weight than hero; same color treatment |
| `spot-illustration`   | Inline illustrations within content                | Always illustration even if hero is photo |
| `empty-state`         | When no records / data exists                      | Friendly variant of spot illustration |
| `error-state`         | 404, 500, offline, generic errors                  | Matches empty-state but with mood shift |
| `avatar-placeholder`  | When user has no profile image                     | Initials on color OR neutral character icon |
| `pattern-background`  | Subtle texture behind sections                     | Ties to color treatment, never competes |
| `icon-illustration`   | Decorative icons larger than UI icons              | Bridge between icon foundation and full illustration |
| `data-viz-imagery`    | Charts, graphs, abstract data representations      | Matches color treatment of brand colors |
| `video-thumbnail`     | Video player poster frames                         | Same composition rules as hero photography |

For each category, the candidate output specifies:
- The vendor source(s) and search terms / collection IDs
- Sample reference URLs (3–5 per category)
- Composition rules
- Color treatment to apply
- Restrictions (no people / no minors / no recognizable brands / etc.)

## Phase 5 — Vendor catalog with search-term mapping

For each candidate set, the command resolves the direction to specific
vendor sources and the **search terms / collection IDs** to use on
each. This is the imagery equivalent of `fonts-select`'s
brief-to-Adobe-Fonts-filter mapping.

### Unsplash

- License: free for commercial use, attribution appreciated but not
  legally required (Unsplash License since 2017)
- API: free with attribution; collection-based curation works well
- Brief-to-search mapping examples:
  - `tone: technical` + `industry: dev-tools` → search "abstract
    technology", collection IDs covering "code" "abstract gradients"
  - `tone: editorial` + `industry: luxury` → search "minimalism",
    "neutral tones", curated collections "Editorial"
  - `tone: friendly` + `industry: education` → ⚠️  flag if subject
    matter includes minors; suggest illustration alternative
- Caveat: highly trafficked images (e.g. "the laptop guy") read as
  generic; favor less-discovered work and verify uniqueness

### Pexels

- License: Pexels License (free for commercial, no attribution legally
  required)
- API: free; videos available alongside photos
- Strengths: lifestyle photography, video clips for hero backgrounds
- Brief-to-search mapping similar to Unsplash; smaller catalog

### Pixabay

- License: Pixabay License (free for most commercial uses; some image
  exclusions); attribution not required
- Strengths: vector illustrations alongside photos; broad multi-format
- Caveat: variable curation quality — verify per-image

### Adobe Stock

- License: Standard or Extended via Creative Cloud subscription or
  per-image purchase; per-domain limits on Standard
- Strengths: premium quality; verified model releases; legal protection
  via Adobe's indemnification (Standard tier)
- Brief-to-search via Adobe Stock filters (similar taxonomy to Adobe
  Fonts):
  - **Categories**: Photos, Illustrations, Vectors, Videos, 3D, Audio
  - **Style filters**: composition, color, depth-of-field, isolated
  - **Demographic filters**: age range, ethnicity, group size
- Note: this command does not pick specific Adobe Stock images — it
  surfaces collection IDs and search filter combos for the design team
  to browse fonts.adobe.com (yes, also imagery — Adobe Stock and Adobe
  Fonts share the Creative Cloud account)

### Getty Images / iStock / Shutterstock

- License: per-image or subscription; significantly more expensive
  than Adobe Stock for similar quality
- Strengths: editorial photography, news, sports, celebrity (the only
  legal source for editorial-context imagery)
- Use when: editorial use cases that other libraries can't fulfill

### Storyset (by Freepik)

- License: free with attribution; premium without; commercial use OK
- Strengths: customizable illustration styles (flat, isometric,
  monochrome, gradient, hand-drawn, rounded — all from same library)
  with per-illustration color customization
- Brief-to-source mapping:
  - `style: flat-geometric` → "Flat" pack
  - `style: isometric` → "Isometric" pack
  - `style: hand-drawn-organic` → "Hand-drawn" pack
- Recommend when: B2B SaaS needing consistent spot illustrations

### unDraw

- License: free, no attribution required (MIT License) — the easiest
  license in the catalog
- Strengths: 1000+ illustrations, single style (flat geometric), single
  customizable accent color (matches brand color)
- Recommend when: starting fast, brand has a defined accent, want
  zero-friction licensing

### Humaaans

- License: free for personal and commercial (CC BY 4.0 — attribution
  required)
- Strengths: customizable people illustrations — mix and match heads,
  bodies, poses for diverse representation
- Recommend when: brand needs diverse people imagery and wants control
  over composition

### Open Peeps, Blush Design, Ouch (Icons8)

Specialized illustration libraries — included in candidate sets when
the direction calls for hand-drawn (Open Peeps), highly customizable
(Blush), or curated-by-style (Ouch). License terms vary; surface per
candidate.

### Adobe Firefly (commercially safe AI-gen)

- License: Adobe's commercial license — trained on Adobe Stock,
  public domain, and Adobe-owned imagery only. Adobe indemnifies
  enterprise customers.
- Strengths: legally safe AI generation; integrates with Creative
  Cloud; supports brand-color and style references
- Recommend when: bespoke imagery needed; budget for AI subscription;
  legal team comfortable with AI-gen for the use case
- Caveat: Adobe Firefly cannot generate recognizable real people or
  branded products

### Midjourney / DALL-E / Stable Diffusion

- License: varies — Midjourney commercial requires paid plan; DALL-E
  via OpenAI gives commercial rights to subscribers; Stable Diffusion
  is open-source but training data is contested
- Strengths: maximum creative range; large community; rapid iteration
- Caveat: training-data lawsuits unresolved (as of brief date); some
  publishers ban AI-gen content (Getty has banned, Adobe Stock embraces
  with disclosure). Surface this risk explicitly per candidate.

### Hero Patterns / SVG Backgrounds / Cool Backgrounds

- License: typically MIT or CC0 (free, no attribution)
- Strengths: SVG patterns, gradient backgrounds, geometric textures
- Recommend when: brand needs section backgrounds without imagery
  competing for attention

## Phase 6 — Output the recommendation

Print one block per candidate direction:

```
🎨 Direction A — Editorial Abstract (B2B fintech)
   Strategy:       free-stock + pattern (Unsplash + Hero Patterns)
   Style:          abstract-conceptual photography
   Color treatment: brand-tinted overlay (accent at 20% opacity)
   Composition:    centered, symmetric
   People:         abstract-only (no people imagery)

   Asset categories:
     hero            Unsplash search: "abstract gradient blue", curated
                     collection "Tech & Abstracts"; reference URLs:
                       - https://unsplash.com/photos/<id>
                       - https://unsplash.com/photos/<id>
                       - https://unsplash.com/photos/<id>
                     Composition: full-bleed, centered focal point
                     Treatment: brand-tinted overlay
     section-break   Hero Patterns "topography" + "circuit-board" with
                     accent color tint at 8% opacity
     spot-illustration  Storyset Isometric pack — abstract finance theme
     empty-state     Storyset Isometric pack — "empty box" / "no data"
                     variants, brand-tinted
     error-state     Storyset Isometric pack — "error" / "404"
                     variants, brand-tinted
     avatar-placeholder  Initials on accent-100 background; no
                         photographic placeholders
     pattern-background  Hero Patterns "wiggle" or "topography" at low
                         opacity
   License summary:
     Unsplash: free commercial, attribution appreciated
     Hero Patterns: free, no attribution
     Storyset: free with attribution OR premium without
   Rights notes:
     No model release issues (no people imagery)
     No editorial restrictions
   Watch:
     Unsplash images get reused widely — verify uniqueness against
     competitor sites before locking individual hero images.

🎨 Direction B — Friendly Illustrated (B2B fintech)
   Strategy:       illustrated (Storyset + Humaaans)
   Style:          flat-geometric + character-driven
   Color treatment: brand-tinted (accent + secondary in illustrations)
   ...

🎨 Direction C — Premium Licensed (B2B fintech)
   Strategy:       licensed-stock (Adobe Stock)
   ...
```

Repeat for all N candidates. Pause for user pick or override.

## Phase 7 — Render candidates (optional)

If `--render-candidates`, generate
`design/foundations/imagery-candidates.pen`:

> Build a Pencil page named **`Foundations / Imagery / Candidates`**
> for **{{brand}}**. Render N rows side by side, each row
> representing one direction. For each row, show **6 sample
> compositions** at 240×180 each, demonstrating the direction's
> approach across categories:
>
> 1. Hero composition — full-bleed sample with title overlay
> 2. Section-break composition — narrower aspect, treatment visible
> 3. Spot illustration — empty state example
> 4. Avatar placeholder — initials on tinted bg
> 5. Pattern background — texture sample with section content overlay
> 6. Mixed composition — multiple categories in one realistic page section
>
> Use placeholder rectangles with diagonal lines for sample images
> (the same convention as `/product:design:explore`) — the goal is showing the
> direction's *shape and treatment*, not specific assets. Annotate
> each composition with the vendor source and license summary.
>
> Mark the recommended row with a `--accent` ring + "Recommended"
> Badge. Render once on Light surface and once on Dark.
>
> Below each row, a spec card listing:
> - Vendor + license summary
> - Brief-to-search mapping highlights
> - Rights notes (model release, AI-gen disclosure, attribution)

## Phase 8 — Persist the choice

When `--dry-run` is set, this phase does NOT write. Instead it prints
a full diff of what would be written to brand JSON + imagery manifest.
The user reviews and re-runs without `--dry-run` to commit. See
`colors-select.md` for the dry-run output format — imagery-select
follows the same pattern.

When confirmed (or `--lock`), write atomically to:

### 8a — Brand JSON

```jsonc
{
  // ...existing...
  "imagery": {
    "direction":         "Editorial Abstract",
    "strategy":          "free-stock + pattern",
    "style":             "abstract-conceptual",
    "colorTreatment":    "brand-tinted-overlay",
    "composition":       "formal",
    "representation":    "abstract-only",
    "vendors": [
      { "name": "Unsplash",       "license": "Unsplash License",       "scope": ["hero", "section-break"] },
      { "name": "Storyset",       "license": "Free with attribution",  "scope": ["spot", "empty-state", "error-state"] },
      { "name": "Hero Patterns",  "license": "MIT",                    "scope": ["pattern-background"] }
    ],
    "categoryGuidelines": {
      "hero":             { "search": "abstract gradient blue", "collectionIds": ["..."], "treatment": "brand-tinted-overlay" },
      "spot-illustration":{ "vendor": "Storyset", "pack": "Isometric", "tint": "accent" },
      "avatar-placeholder":{ "type": "initials-on-color", "bg": "accent-100" }
      // ...all categories...
    },

    // Concrete asset references — patterns/templates read these to know
    // WHICH illustrations to use, not just the direction.
    "assets": {
      "empty-state": {
        "never-used":     { "vendor": "Storyset", "url": "https://storyset.com/illustration/empty-amico", "license": "free-attribution" },
        "filtered":       { "vendor": "Storyset", "url": "https://storyset.com/illustration/no-data-pana", "license": "free-attribution" },
        "welcome":        { "vendor": "Storyset", "url": "https://storyset.com/illustration/welcome-bro", "license": "free-attribution" },
        "inbox-zero":     { "vendor": "Storyset", "url": "https://storyset.com/illustration/all-done-rafiki", "license": "free-attribution" }
      },
      "error-state": {
        "page-error":     { "vendor": "Storyset", "url": "https://storyset.com/illustration/error-amico", "license": "free-attribution" },
        "section-error":  { "vendor": "Storyset", "url": "https://storyset.com/illustration/connection-bro", "license": "free-attribution" },
        "404":            { "vendor": "Storyset", "url": "https://storyset.com/illustration/lost-amico", "license": "free-attribution" },
        "500":            { "vendor": "Storyset", "url": "https://storyset.com/illustration/server-error-rafiki", "license": "free-attribution" }
      },
      "loading-state": {
        "skeleton-pattern": { "type": "css-shimmer", "tokens": ["--color-neutral-100", "--color-neutral-200"] }
      },
      "success-state": {
        "checkmark-celebrate": { "vendor": "Storyset", "url": "https://storyset.com/illustration/winners-pana", "license": "free-attribution" },
        "completion":          { "vendor": "Storyset", "url": "https://storyset.com/illustration/done-amico", "license": "free-attribution" }
      },
      "hero": {
        "marketing-default":   { "vendor": "Unsplash", "url": "https://unsplash.com/photos/...", "license": "unsplash-license" },
        "product-screenshot":  { "type": "user-supplied-screenshot", "placeholder": "/assets/hero-placeholder.svg" }
      },
      "pattern-background": {
        "subtle":              { "vendor": "Hero Patterns", "patternId": "topography", "tint": "accent-50" },
        "geometric":           { "vendor": "Hero Patterns", "patternId": "circuit-board", "tint": "accent-100" }
      }
    },

    "rightsNotes": [
      "No model release issues (abstract-only)",
      "No editorial-context restrictions",
      "Storyset attribution required in footer or about page (link to storyset.com)"
    ],
    "aiGenAllowed": false
  }
}
```

The `assets` keys are referenced by:

- **`patterns/states.pen`** for empty / error / success state
  illustrations
- **Templates with empty states** (list, detail, dashboard) for
  matching illustration choice
- **Hero patterns** (`patterns/hero.pen`) for marketing-default
  imagery
- **Pattern backgrounds** (CTAs, marketing sections) for subtle
  visual texture

If a downstream artifact references a key that doesn't exist in
`assets`, audit Plane 7 surfaces it as a missing-asset warning. The
fix is either to add the asset to brand JSON or to update the
artifact to reference an existing key.

For brands using **AI-generated illustration** (when
`aiGenAllowed: true`), the `vendor` field is `"firefly"` or
`"midjourney"` and `url` may be a project-specific generated-asset
storage path. License must reference the AI tool's commercial-use
terms.

### 8b — Foundation `.pen` (optional, on next `/product:design:foundations:imagery` run)

The render command (`/product:design:foundations:imagery`, not yet built) would
read this brand JSON and produce a foundation reference page showing
the chosen direction with style guidelines and rights notes — a single
page the design team can hand to content producers.

### 8c — No `@theme` writes

Unlike colors and fonts, imagery does not produce CSS tokens. The
brand JSON entry is the source of truth; rendering happens at the
component level (e.g. `<Hero src={...}>` consumes the imagery direction
through prop conventions, not CSS variables).

### 8d — Atomicity

The brand JSON write succeeds atomically or rolls back. No other
sources of truth are involved.

## Phase 9 — Setup snippets (printed, not executed)

After persisting, print the **next-step instructions** for whoever
will produce content under this direction. Like `fonts-select`, this
is copy-paste guidance for humans, not file writes.

```
🎨 Imagery direction recorded: Editorial Abstract

   For the team producing content under this direction:

   1. Vendor accounts to set up:
      - Unsplash:    free signup at unsplash.com (no API key needed
                     for browsing; API key needed if you build a CMS
                     integration)
      - Storyset:    free download with attribution; premium for
                     attribution-free at storyset.com
      - Hero Patterns: no signup needed; copy SVG inline at
                      heropatterns.com

   2. Per-category search starting points (also recorded in brand JSON):
      hero:           Unsplash → search "abstract gradient blue", curated
                      collection "Tech & Abstracts"
      spot-illustration: Storyset → "Isometric" pack, finance category
      ...

   3. Rights checklist before publishing any image:
      [ ] Vendor allows commercial use for your context
      [ ] Attribution applied where required (Storyset, Humaaans)
      [ ] No recognizable people requiring model release (or releases
          on file)
      [ ] No editorial-only images used in commercial context
      [ ] If AI-generated: disclosure applied per platform requirement

   4. Sourcing rule (avoid the "stock photo cliché"):
      Before using any photographic image, search for it on Google
      Images "by image" — if it appears on >5 unrelated sites, find
      another. Direction A's strategy is especially vulnerable to this
      because Unsplash's most popular images are heavily reused.

   This command does NOT download any images. Acquisition happens
   through the vendor platforms — typically download-and-host for
   self-served images, or CMS integration via vendor API for dynamic
   image selection. Storage and CDN are your tooling decisions.
```

## Phase 10 — Idempotency

Same shape as `colors-select` / `fonts-select`:

1. Re-running with no brief change → no-op (compares brief hash).
2. Brand-changed → diff and ask whether to apply.
3. `--replace` forces fresh generation regardless.
4. `--re-direct` (alias for `--replace`) for terminology that matches
   the imagery domain.

## Reporting

```
✅ Recorded imagery direction: Editorial Abstract
   Strategy:       free-stock + pattern (Unsplash + Hero Patterns +
                   Storyset for spot)
   Style:          abstract-conceptual + flat-geometric (illustration)
   Color treatment: brand-tinted overlay
   Representation: abstract-only (no people imagery)
   AI-gen:         not used in this direction
   License risk:   low (all sources free for commercial; one requires
                   attribution)

   Recorded in:
   - product/.pencil-brand.json (imagery section)

   NOT generated by this command (manual steps below):
   - Image downloads or CDN uploads
   - Vendor API integrations
   - CMS schema for imagery
   - Per-page asset selection (that's per-page editorial work)

⚠️  Watch:
   - Audience regulation flagged: none — no special restrictions.
   - Unsplash images get reused widely; verify uniqueness for hero
     selections.

📝 Next steps (in order):

   1. Brief content producers using the printed setup snippet above
      (Phase 9 output). Direction details are also in brand JSON for
      future reference.

   2. (Future) /product:design:foundations:imagery
      Render the foundation reference page so the direction is visible
      alongside colors, typography, and icons.

   3. /product:design:design-page can now reference the imagery direction when
      composing pages — hero compositions, empty states, and
      illustrations follow the recorded guidelines.
```

## What this command does NOT do

- Does not download, fetch, or store image assets.
- Does not call vendor APIs (Unsplash, Pexels, Adobe Stock, etc.).
- Does not manage CDN paths, image optimization, or `next/image` setup.
- Does not handle attribution rendering — components handle that based
  on the brand JSON's `imagery.vendors[].license` info.
- Does not generate AI imagery directly. Adobe Firefly / Midjourney /
  DALL-E are surfaced as vendor strategies, but generation happens on
  the vendor's platform.
- Does not pick specific image files. It picks a *direction* — the
  team picks individual assets within the direction during content
  production.

## Audience-regulation guardrails

For products with regulated audiences (`audience-regulation: k-12`,
`healthcare-hipaa`, etc.), the command applies additional rules:

### K-12 / COPPA (children under 13)

- Photographic directions involving children are flagged with explicit
  warnings.
- Illustration-only or abstract-only directions are recommended as
  defaults.
- AI-gen is allowed only with `Adobe Firefly` (commercially safe) and
  not for generating images of children.

### Healthcare / HIPAA

- Photographic directions involving identifiable patients flagged.
- Stock medical imagery (with model releases) acceptable; real
  patient imagery is not.
- Editorial-context medical photography (Getty editorial) marked as
  not-for-commercial-use even when otherwise tempting.

### Financial Services

- Photographic directions involving real financial documents,
  account screens, or recognizable institution branding flagged.
- Illustration with abstract money / data themes preferred.

### Government / Civic

- Editorial photography (Getty) often appropriate but per-license.
- Avoid imagery suggesting endorsement of partisan figures.

These guardrails are flags, not hard blocks — the command surfaces
the risk and lets the user override with explicit acknowledgment if
the use case warrants.

---
description: Generate organic LinkedIn posts — text-led posts (long-form-friendly), single-image, document carousels (PDFs in feed), video, native carousels, articles. Professional context dominant; voice tilts measured + insight-driven. B2B's strongest organic platform; rewards depth and substantive content over polish.
argument-hint: <post-slug> [--type text|image|document|video|carousel|article|poll] [--length short|medium|long] [--informed-by <brief-slug>] [--campaign <slug>] [--scheduled-for <ISO>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate organic LinkedIn posts. LinkedIn is the rare social
platform that rewards length and substantive thinking over
polish and brevity. The professional context is dominant —
voice tilts measured + insight-driven. B2B brands' strongest
organic channel for this reason; consumer brands often
underperform here because the platform expects business value.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`. LinkedIn-specific brand
   considerations: company-page vs employee-page distinction
   (employee posts often outperform company-page posts;
   consider where the post should originate).
3. Resolve inputs:
   - First positional: post slug.
   - `--type text|image|document|video|carousel|article|poll` —
     post type:
     - `text`: text-only post; LinkedIn's strongest organic format
     - `image`: text + single image
     - `document`: PDF carousel (B2B-specific format; high engagement)
     - `video`: native video upload
     - `carousel`: multi-slide native carousel
     - `article`: long-form article (separate from posts; lives
       on author's profile)
     - `poll`: 2-4 option poll
   - `--length short|medium|long` — caption length intent.
     Short = under 600 chars; medium = 600-1500; long =
     1500-3000. Default `medium`. LinkedIn supports up to ~3000
     chars in a post.
   - `--informed-by <brief-slug>`.
   - `--campaign <slug>`.
   - `--scheduled-for <ISO>`.

## Post types in detail

### Text post (the strongest organic format)

LinkedIn's algorithm rewards text posts that drive comments and
discussion. No image required; pure-text often outperforms
image-bearing posts when the text is substantive.

Structure:

- **Hook line** — 1-2 sentences that earn the click into the
  full post. The first 2-3 lines (~150 chars) appear before
  "...see more"; everything after is gated behind a click.
- **Body** — develops the idea, with line breaks between
  paragraphs (LinkedIn's reader is not great with long
  paragraphs; broken-up text is more readable).
- **Engagement prompt** — question or invitation to share
  perspective at the end.
- **Hashtags** at the end (3-5 max).

Example:

```
We shipped saved searches today.

Sounds simple. Took 4 months. Here's what we learned —

(line break — this is where "see more" cuts off in feed)

The hard part wasn't building the feature. It was deciding
what "saved" should mean across different views in the product.

Three options:
- Save the inputs (filter values) — portable, flexible
- Save the result (record set) — fast, but breaks when data changes
- Save the query (SQL-equivalent) — most powerful, hardest UX

We picked inputs. Reapplies on every view automatically. The
result-saving folks (we tested with both) said the inputs version
"felt smarter" — even though we initially built the result-saving
version because we thought users wanted speed.

What they wanted was speed AND continuity. Inputs gave both.

If you're building filter-saving anywhere, the question to ask
your users isn't "do you want this saved?" but "what does
'saved' mean to you?"

What's the most surprising thing you've learned from a feature
you thought was simple?

#productdevelopment #productdesign #buildinpublic
```

### Image post

Text + single image. Image specs:

- **Aspect ratio**: 1.91:1 (1200x627) primary; supports 1:1
  (1200x1200) too
- **Image content**: less brand-polished than Instagram works
  on LinkedIn — screenshots, charts, behind-the-scenes photos
  perform well

The image supports the text but text still leads. Captions
follow text-post conventions.

### Document carousel (PDF in feed)

Distinctly LinkedIn — upload a PDF that displays as a swipeable
carousel in feed. Strong for:

- Industry insights / data reports
- Process breakdowns
- Tutorials and how-tos
- Case study summaries

Specs:

- 1:1 (1080x1080) per page recommended
- 5-15 pages typical (more = lower swipe-through)
- Branded but readable; high text density acceptable
- First page is the hook (works as feed preview)

Documents drive significantly higher engagement than image posts
on LinkedIn. Underused by most brands — high-leverage format.

### Video post

Specs:
- **Duration**: 30s-3min sweet spot; max 10min
- **Aspect ratio**: 1:1 or 16:9 (1:1 wins more feed real
  estate); some brands use 9:16 for native-feeling
- **Sound-off design**: autoplay-mute; captions essential
- **Cover image**: 1200x627 thumbnail before play

LinkedIn video gets less reach per impression than text but
higher when impressions land — viewers who watch video engage
deeply.

### Native carousel (slides)

LinkedIn's native carousel format (separate from documents):
multi-image slide-style. 2-10 cards. Similar discipline to
Instagram carousels — first card is the hook; subsequent cards
develop the idea.

### Article (long-form)

LinkedIn Articles are separate from posts — they live on the
author's profile under "Articles" rather than in the feed. Articles
are 500-2000 words typically, with a featured image, formatted
like a blog post.

Articles get distributed differently than posts — they don't get
the same algorithmic feed boost, but they accumulate over time as
the author's body of work. Best for:

- Substantial industry analysis
- Detailed case studies
- Thought-leadership essays

The command for articles produces a markdown article + featured
image. Publishing happens via LinkedIn's article editor.

### Poll

2-4 options, 1-day to 2-week duration. Polls drive engagement
but rarely drive conversion. Used for conversation-starting and
sentiment-checking.

## Voice modulation for LinkedIn

Per `market/social/_context.md` LinkedIn row: formality
+0.5, energy unchanged. Plus LinkedIn-specific:

- **Insight-driven** — frame ideas in terms of what was learned,
  what surprised, what you'd do differently
- **Substantive** — empty corporate posts ("excited to share",
  "honored to announce") underperform on LinkedIn dramatically
- **Personal but professional** — first-person ("I", "we")
  works; humble-brag avoids; vulnerable-but-controlled performs
- **Industry-relevant** — content adjacent to the brand's
  industry context performs better than pure brand-promotion

Avoid:
- "Thrilled to announce..." opening — LinkedIn-cliché
- Emoji-bracket text decoration (✨...✨) — Instagram-pattern,
  off on LinkedIn
- Excessive hashtags (>5) — reads as inexperienced
- Aggressive sales language — LinkedIn audience is sophisticated
  about ad detection

## Phase 1 — Determine post angle

LinkedIn organic content angles that work:

- **Build-in-public** — what you shipped + what you learned
- **Counter-conventional wisdom** — "Most teams think X; we
  found Y instead"
- **Specific failure / lesson** — "We got this wrong. Here's
  what we learned."
- **Customer story** — concrete outcome with permission
- **Industry analysis** — perspective on a relevant industry
  trend or development
- **Process breakdown** — how the team approaches X

The brand voice + the campaign context narrow which angle fits.

## Phase 2 — Generate copy

Per `--type` and `--length`, generate the post copy. For text-
heavy types, the copy IS the post; for visual types, copy is
secondary.

For text/medium length:

```
Generated text post [1147/3000 chars]:

We shipped saved searches today.

Sounds simple. Took 4 months. Here's what we learned —

[full body...]

What's the most surprising thing you've learned from a feature
you thought was simple?

#productdevelopment #productdesign #buildinpublic

Hook line (visible before "see more"):
  "We shipped saved searches today."

  Strong: short, concrete, and the followup question ("Sounds
  simple. Took 4 months.") earns the click into the full post.
```

## Phase 3 — Generate visual (when applicable)

Per type:
- Image: standard `.pen` design + `.jpg` rendered
- Document carousel: multi-page `.pen` rendered to a single PDF
- Video: storyboard `.pen` (production downstream)
- Native carousel: multi-frame `.pen` rendered per-slide
- Article: featured image as `.pen` + `.jpg`

```bash
# Document example
pencil --out design/marketing/social/linkedin/saved-searches-launch-doc.pen \
       --prompt "<embedded prompt: LinkedIn document carousel, 8 pages 1:1,
                 voice formal +0.5,
                 page 1: hook 'How we built saved searches in 4 months — and what we learned'
                 page 2-7: process breakdown with diagrams, decisions, learnings
                 page 8: 'Read the full story on our blog → acme.com/saved-searches'
                 brand-consistent typography, high information density acceptable>"
```

## Phase 4 — Hashtags

LinkedIn hashtag strategy: 3-5 max. More reads as
inexperienced.

Mix:
- 1-2 industry-relevant general (#productdevelopment, #saas)
- 1-2 specific niche (#productdesign, #b2bsaas)
- 1 brand-specific or topic-specific (#buildinpublic when
  authentic)

LinkedIn's algorithm follows hashtags less actively than
Instagram or TikTok — they're more about classification and
topic-discovery than reach amplification.

## Phase 5 — Voice + compliance check

Standard pass. LinkedIn-specific:

- No corporate-speak triggers ("thrilled", "honored", "humbled")
- Substance over polish (LinkedIn rewards content with depth)
- Hashtag count ≤ 5
- Engagement prompt at end (drives comment count, which is the
  key algorithmic signal)
- Length aligns with `--length` arg

Compliance:
- FTC disclosure if partnership
- Industry regulation: financial services / healthcare claims
  are LinkedIn-common given the audience; flag when relevant
- LinkedIn's specific rules on personal data, employment claims
  (don't make hiring discrimination signals; don't claim
  protected characteristics)

## Phase 6 — Generate metadata

```jsonc
{
  "kind": "social-post",
  "platform": "linkedin",
  "postType": "text",                          // text | image | document | video | carousel | article | poll
  "name": "saved-searches-launch-text",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "linkedin": {
    "postType": "text",
    "characterCount": 1147,
    "lengthClass": "medium",
    "hashtagCount": 3,
    "mentions": [],
    "engagementPrompt": "What's the most surprising thing you've learned from a feature you thought was simple?",
    "originatingProfile": "company"           // company | personal-employee | external-author
  },
  "content": {
    "primaryText": "We shipped saved searches today.\n\n...",
    "hashtags": ["#productdevelopment", "#productdesign", "#buildinpublic"],
    "altText": null,                          // text post; no image
    "linkUrl": null                           // text-only; link in comment if needed
  },
  "media": null,                              // text post
  "scheduling": {
    "scheduledFor": "2026-05-02T09:00:00-04:00",  // Tuesday 9 AM ET — LinkedIn B2B peak
    "timezone": "America/New_York",
    "publishMode": "manual"
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "formality": "+0.5" }
  },
  "compliance": { ... },
  "performance": {
    "hypothesis": "Build-in-public framing earns engagement from product-development audience.",
    "successMetric": "comments >= 30, post impressions >= 5000"
  }
}
```

## Reporting

```
✓ LinkedIn post generated: saved-searches-launch-text

File:    design/marketing/social/linkedin/saved-searches-launch-text.json

Type:           text post
Length:         1147 chars (medium length class)
Hook:           "We shipped saved searches today." — visible
                before "see more"
Body angle:     build-in-public + lesson learned
Hashtags:       3 (#productdevelopment #productdesign #buildinpublic)
Engagement prompt: present at end
Originating profile: company

Voice:          Confident Mentor (formality +0.5)
Scheduled:      Tuesday May 2, 9:00 AM ET
                (LinkedIn B2B peak; weekday morning)

Compliance:
  No partnership disclosure required
  No industry regulation flagged

Action items:
  1. Decide originating profile: company page or
     individual employee account (employee posts often
     outperform; consider founder/lead post)
  2. Verify the substance — LinkedIn punishes empty content;
     the post should genuinely teach or share insight
  3. Schedule via team's posting tool
  4. Plan reply-engagement: the post's success depends on the
     comments it generates; commit to engaging with the first
     5-10 comments within 1-2 hours of posting
  5. Consider follow-up document carousel for depth:
     /market:social:linkedin saved-searches-process-doc --type document
```

## Idempotency

Re-running overwrites. Variant tests with distinct slugs.

## What this command does NOT do

- **Does not handle company page vs employee post selection.**
  That's a strategic decision; the command flags it but doesn't
  pick.
- **Does not auto-post.** LinkedIn's API for organic is limited;
  scheduling tools or manual posting.
- **Does not handle LinkedIn Live (live streaming).** Live
  events are real-time production; out of scope.
- **Does not write the article body for `--type article`.** It
  generates structure + featured image; the article body itself
  is editorial work (could pair with /pencil/templates if a
  documentation/article template applies).
- **Does not measure performance.** LinkedIn Analytics or
  third-party tools.

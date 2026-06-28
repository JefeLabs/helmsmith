# Pencil Tool — Stack Context (`product/design/`)

> Read this in addition to `product/strategy/_context.md` whenever any
> `/product:design:*` command runs, or any `product/strategy/` command produces or
> consumes `.pen` files.
>
> The `product/design/` namespace covers operations specific to **Pencil**
> ([pencil.dev](https://pencil.dev)) — the visual design tool the
> suite targets. This file documents `.pen` file conventions,
> Pencil-specific invocation paths, file naming, and the
> verification flow.

## File layout — Pencil-specific paths

The conceptual hierarchy is documented in `product/strategy/_context.md`. Here
are the specific Pencil file paths:

```
design/
├── foundations/
│   ├── colors.pen
│   ├── typography.pen
│   ├── spaces.pen
│   ├── grids.pen
│   ├── icons.pen
│   ├── imagery.pen
│   ├── logos.pen
│   ├── motion.pen
│   ├── z-index.pen
│   ├── a11y.pen
│   ├── density.pen
│   └── i18n.pen
├── patterns/
│   ├── states.pen
│   ├── hero.pen
│   ├── footer.pen
│   ├── cta.pen
│   ├── feature-grid.pen
│   ├── pricing-tier.pen
│   ├── faq.pen
│   ├── testimonial.pen
│   ├── banner.pen
│   └── stat-section.pen
├── templates/
│   ├── landing-page.pen
│   ├── error-page.pen
│   ├── auth.pen
│   ├── dashboard.pen
│   ├── settings.pen
│   ├── pricing.pen
│   ├── onboarding.pen
│   ├── documentation.pen
│   ├── detail.pen
│   ├── list.pen
│   ├── profile.pen
│   ├── marketing.pen
│   ├── confirmation.pen
│   └── legal.pen
├── pages/
│   └── <page-slug>.pen
└── research/
    └── <industry-slug>.{md,pen,json}
```

Component `.pen` files live in the framework namespace (e.g.
`frameworks/heroui/components/buttons.pen` would correspond to
`design/heroui/components/buttons.pen` in the user's project)
because component specs are framework-specific.

## Invocation strategy — Pencil-specific paths

Each `/product:design:*` command must pick **one** of these execution
paths in order of preference. Detect what is available before
generating.

### Path A — Pencil MCP server (preferred when desktop/IDE extension is running)

Pencil's MCP server exposes the same tool surface as the CLI.
Prefer it when the user has the desktop app or VS Code/Cursor
extension open, because the editor renders changes live.

Useful tools to chain:

- `get_guidelines({ category: "guide", name: "<name>" })` — fetch
  any built-in Pencil guidelines that match the topic before
  generating
- `batch_design({ operations: "..." })` — emit nodes in Pencil's
  batch DSL
- `get_screenshot({ nodeId })` — verify a frame after generation
- `save()` — persist to the `.pen` path

### Path B — Pencil CLI (headless, scriptable)

Use when no MCP server is available, or when running from CI / a
headless agent.

```bash
# Create
pencil --out design/<area>/<file>.pen \
       --model claude-sonnet-4-7 \
       --prompt "<embedded prompt from the command>"

# Modify in place
pencil --in  design/<area>/<file>.pen \
       --out design/<area>/<file>.pen \
       --prompt "<refinement prompt>"
```

Authenticate once via `pencil login` (writes
`~/.pencil/session-cli.json`) or export `PENCIL_CLI_KEY` and
`ANTHROPIC_API_KEY` for unattended runs.

### Path C — Tasks file (batch / scaffold)

For multi-file generations (`/product:strategy:scaffold`), build a `tasks.json`
and run:

```bash
pencil --tasks product/.pencil-tasks.json
```

Each task is `{ in?, out, prompt, model? }` and runs sequentially
with its own editor instance.

### Path D — open-pencil (introspection, conversion, lint)

For operations that **read or transform** existing `.pen` or
`.fig` files — token analysis, format conversion, design-layer
linting, and Figma round-trip — the suite delegates to
**open-pencil**, an MIT-licensed open-source design editor with a
headless CLI and an MCP server.

```bash
# Install (one-time):
brew install open-pencil          # or:
npm install -g @open-pencil/cli

# Then commands like:
open-pencil convert <pen-file> --to fig --out <out>.fig
open-pencil variables <fig-or-pen> --json
open-pencil analyze colors <fig-or-pen> --json
open-pencil lint <fig-or-pen> --rule color-contrast
```

Where Pencil's CLI (Path B) generates new content and renders,
open-pencil works on the produced files. The two paths are
complementary — most workflows use both.

The suite uses open-pencil for:

- **`/product:design:export --to figma`** — `.pen` → `.fig` conversion
  (Figma's native binary codec, round-trip fidelity)
- **`/product:design:export --from-fig`** — bringing designer edits back
- **`/product:strategy:tokens-from <file.fig>`** or `<file.pen>` — structured
  token extraction (highest fidelity)
- **`/audit`** Plane 1 augmentation — design-layer linting
  on `.pen` files themselves
- **`/product:design:diff`** — high-fidelity rendering of `.pen` files
  for pixel-diff comparison

For environments without external network access (constrained
mode), open-pencil's offline-first architecture is a perfect fit
— it requires no account, no server, no internet to run
conversions and analyses.

## Naming conventions in the `.pen` file

- **Pages**: `Foundations / Colors`, `Components / Buttons`,
  `Templates / Landing`
- **Sections (top-level frames)**: `Light`, `Dark`, `Desktop`,
  `Tablet`, `Mobile`
- **Component frames**: BEM block name in kebab-case (`button`,
  `alert-dialog`)
- **Variant frames**: `<component> / <variant> / <state>`
  e.g. `button / primary / hover`
- **Tokens (text labels)**: emit the variable name, not the value
  (e.g. `--accent-500` not `#0A84FF`)

## Verification step (every `/product:design:*` command)

After generation, call `get_screenshot` on the page root frame
and tell the user where the `.pen` was written and what was
rendered. If the screenshot shows missing states or broken
layout, automatically run a follow-up `pencil --in ... --out ...`
pass to fix the gap before reporting completion.

## When the user asks to update an existing `.pen`

Always pass `--in` to read the current state, then write to the
same path with `--out`. Never regenerate from scratch unless
explicitly told to — Pencil files are version-controlled and the
user may have hand-edited them.

## Hi-fi copy — read editorial style

When generating hi-fi designs (the default for
`product/design/templates/*`, `product/design/patterns/*`, `product/design/design-page`,
`product/design/foundations/*`), read `product/.pencil-editorial.json` if
it exists. The file carries mechanical-style rules
(capitalization, oxford comma, em-dash spacing, number/date
formatting, terminology, abbreviation policy) that hi-fi copy
must apply consistently.

When `.pencil-editorial.json` doesn't exist, hi-fi commands
should default to sentence-case + oxford comma + smart quotes +
`May 2, 2026` long dates + active voice + direct address — a
SaaS-conventional baseline. Surface a recommendation in the
report:

```
Note: No editorial style established. Generated copy used SaaS-
conventional defaults. Run /product:strategy:editorial to formalize the
project's editorial conventions and prevent drift.
```

When `.pencil-editorial.json` exists, every text element in the
generated `.pen` applies its rules. Audit Plane 8 detects drift
between artifacts and the canonical editorial style.

## Hi-fi pages — read SEO + AIO strategy

When generating hi-fi page-level designs (the default for
`product/design/templates/*` and `product/design/design-page` when producing
production pages), read `product/.pencil-seo.json` if it exists.
The file carries the project's SEO + AIO strategy — keyword
targets, content cluster topology, structured data depth,
per-archetype heading and content requirements, and AIO patterns.

The relationship between the strategy and the design:

- The **strategy** lives in `.pencil-seo.json` (produced by
  `/product:strategy:seo`)
- The **design** (`.pen` file) must include content that satisfies
  the strategy's per-archetype targets — primary keyword in the
  H1, correct heading cascade, FAQ section when required,
  comparison table when required, alt text on every image, and
  so on
- The **HTML emission** happens in `frameworks/heroui/build-components.md`,
  which translates the design into SEO-correct HTML — semantic
  tags, JSON-LD structured data, meta tags, ARIA attributes

In other words: the `.pen` file produces the *content shape* the
SEO strategy demands; build-components produces the *HTML
emission* the search engines and AI search engines consume.

When `.pencil-seo.json` doesn't exist, hi-fi commands fall back to
SEO baseline correctness (universal good practice independent of
strategy):

- One H1 per page, containing a meaningful page-specific phrase
- Heading cascade (H1 → H2 → H3) without level skips
- Alt text on every image
- Semantic content structure (lists for lists, tables for
  comparisons, definitions for jargon)

When `.pencil-seo.json` doesn't exist and the project is
producing public-facing pages, surface a recommendation in the
report:

```
Note: No SEO + AIO strategy established. Generated pages used
baseline correctness (single H1, sequential cascade, alt text).
Run /product:strategy:seo to formalize the project's discoverability
strategy and unlock per-archetype optimization (structured data,
FAQ schema, AIO patterns).
```

When `.pencil-seo.json` exists, hi-fi page commands read the
relevant per-archetype target and apply it. Audit Plane 9 detects
drift between artifacts and the canonical SEO + AIO strategy.

### Per-archetype targets — how templates read them

Each `product/design/templates/*` archetype has a corresponding entry in
`strategy.perArchetypeTargets`. The template command reads its
own archetype's targets in pre-flight:

```
strategy = read(product/.pencil-seo.json)
archetypeTargets = strategy.perArchetypeTargets["landing-page"]

archetypeTargets contains:
  - primaryKeyword
  - headingHierarchy
  - structuredData[]
  - metaDescriptionLength
  - wordCountTarget
  - aioPatterns[]
  - internalLinksMin
  - imageAltRequired
```

The template applies these in the embedded prompt and in the
post-generation verify step. When archetypeTargets is missing for
an archetype (e.g. project hasn't configured all archetypes), the
template falls back to SEO baseline correctness for that
archetype and surfaces a note.

### AIO patterns — what they mean in practice

AIO patterns from the strategy translate to specific design
content:

| Pattern             | What the design must include                                          |
| ------------------- | --------------------------------------------------------------------- |
| `faq-schema`        | A clearly-marked FAQ section with question-answer pairs               |
| `comparison-table`  | A table comparing options/features when content compares them         |
| `definitive-headings` | Headings as definitive statements ("X does Y") not vague topics    |
| `structured-qa`     | Q&A patterns in body content where applicable                         |
| `explicit-definitions` | Inline definitions for jargon on first use                         |
| `date-stamped-facts` | Time-sensitive claims include dates ("as of May 2026")               |
| `citation-ready`    | Numbered lists, comparison tables, definitive-statement structure     |
| `factual-density`   | High concentration of specific facts vs narrative prose               |
| `numbered-lists`    | Steps and ordered enumerations as numbered lists, not prose           |

These translate to design-time content discipline. The build-
components command emits the structured-data JSON-LD that makes
the patterns machine-readable.

## Fidelity — low-fi vs hi-fi (universal convention)

Every command that produces visual artifacts implicitly supports
`--fidelity low|hi` (default `hi`). The flag controls how copy
gets populated in the generated `.pen` file.

### Three tiers of fidelity in this suite

The suite distinguishes three fidelity levels, not two:

| Tier               | Produced by                                       | Visual character                                | Copy treatment                                        |
| ------------------ | ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| **Wireframe**      | `product/design/explore` (always)                         | Grayscale, schematic, geometric shapes          | Descriptive labels everywhere (no lorem at all)       |
| **Low-fi**         | `--fidelity low` on design-page/templates/patterns | Real layout + components but neutral/grayscale  | Lorem at D1/H1/H2; realistic everywhere else          |
| **Hi-fi** (default)| `--fidelity hi` on design-page/templates/patterns | Production-ready, full color, polished states   | Realistic everywhere with voice + editorial applied   |

**Wireframe fidelity** (pencil/explore) is the most schematic.
Reviewers compare structural alternatives at a high level. Real
labels reveal what kind of page each alternative represents
("Pricing" vs "Save changes" vs "Email"). Lorem at this stage
*hides* the structural intent that descriptive labels reveal —
which is the opposite of what the exploration is for.

**Low-fi** sits between wireframe and hi-fi. The layout is real
(real component shapes, real spacing, real typographic hierarchy);
the copy carries lorem at structural anchors where length-as-
layout-signal matters. Reviewers focus on layout-with-real-content-
length without getting distracted by specific words at the
headline level.

**Hi-fi** is production-ready. Real copy applied per established
voice (`product/.pencil-tone.json`) and editorial (`product/.pencil-
editorial.json`). The handoff target.

### Why fidelity matters

**Low-fi** is structural exploration. The goal is to validate
layout, hierarchy, and information architecture before investing
in details. Reviewers should react to *structure*, not copy.

**Hi-fi** is production-ready. The goal is shippable design with
real copy, polished states, full color, and brand fidelity.
Reviewers should react to the finished product.

The two failure modes when copy treatment is wrong:

- **Real copy in low-fi**: reviewers focus on the words instead
  of the structure. "Should it say 'Get started' or 'Sign up'?"
  becomes the conversation when the structural decision matters.
  Layout problems get masked by copy that happens to fit.
- **Lorem ipsum in hi-fi**: looks unfinished even at the design-
  review stage. Distracting in stakeholder reviews. Hard for
  engineers to plan length budgets. Eventually has to get
  replaced anyway.

The discipline: lorem at structural anchors where length-as-
layout-signal matters; realistic everywhere short enough that
lorem produces noise.

### The convention — what gets lorem, what gets realistic

| Element                           | Low-fi treatment                                              | Hi-fi treatment              |
| --------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| **Display 1** (hero, 60-80px)     | Lorem ipsum, 5-9 words                                        | Realistic, voice + editorial |
| **H1** (page title, 32-48px)      | Lorem ipsum, 4-7 words                                        | Realistic, voice + editorial |
| **H2** (section, 24-32px)         | Lorem ipsum (default) OR short realistic label (3-5 words)    | Realistic, voice + editorial |
| **H3+ subheadings**               | Realistic short label ("Pricing", "How it works")             | Realistic, voice + editorial |
| **Body paragraphs**               | Realistic length-matched copy                                 | Realistic, voice + editorial |
| **Button labels**                 | Realistic ("Get started", "Learn more")                       | Realistic, voice + editorial |
| **Form labels**                   | Realistic ("Email", "Password")                               | Realistic, voice + editorial |
| **Microcopy / hints / errors**    | Realistic                                                     | Realistic, voice + editorial |
| **Numbers / prices / data**       | Realistic-shape ("$24,999" not "$X,XXX,XXX")                  | Realistic + editorial format |
| **Names / locations**             | Category-realistic ("John Smith / San Francisco")             | Project-realistic            |
| **Image content / asset slots**   | Solid placeholder rect with size/aspect label                 | Real or staged imagery       |

The rule of thumb: **lorem at structural anchors where length is
the layout signal; realistic everywhere short enough that lorem
produces noise.**

### Why this specific cutoff

- **Display 1 / H1**: these dominate the layout. A 3-word D1
  vs a 9-word D1 produces dramatically different visual
  weight. Low-fi reviewers would obsess over the specific
  words ("we'd never say that"); lorem keeps the discussion on
  layout. Length is the only signal that matters at this stage.
- **H2**: borderline. Section-level. Sometimes realistic works
  ("Pricing", "How it works"), sometimes lorem is better when
  the section title would distract. Either is valid; the
  command should default to lorem and the user can override.
- **H3+ subheadings**: realistic labels are 1-3 words. Loremizing
  produces nonsense and reveals less than the realistic label
  ("Pricing" reveals the section's intent; lorem doesn't).
- **Body paragraphs**: length and rhythm matter for layout
  validation. Lorem ipsum has Latin-flavored rhythm that
  doesn't match real product copy. Realistic length-matched
  copy is the better signal — it doesn't have to be production
  copy, just plausible product copy in real cadence.
- **Buttons / labels / microcopy**: these are 1-3 words. Lorem
  produces gibberish; realistic is short enough to not dominate
  the review.

### Lorem ipsum content — what to use

When the convention calls for lorem, use **structured Latin
filler** (not Lorem-ipsum-the-cliché-pickup-artist-text). Options:

- **Cicero-derived classical lorem ipsum** — the standard
  ("Lorem ipsum dolor sit amet, consectetur adipiscing elit")
- **Word-count-targeted variants** — when 5-9 words is the
  target, pick or generate lorem matching that length
- **Bacon ipsum / corporate ipsum / startup ipsum** — alternatives
  with category-specific flavoring (less universally
  recognizable as placeholder; can be confused with real copy)

Default to Cicero-derived lorem unless the project explicitly
opts for a variant. The convention's core purpose — "this is
placeholder" — works best with the most-recognizable form.

### Audit Plane 8 exemption for lorem

Audit Plane 8 (editorial drift) recognizes lorem ipsum and
exempts those text strings from editorial-style checks. Detection
heuristic: any string starting with "Lorem ipsum" or matching the
classical lorem patterns (consectetur, adipiscing, eiusmod,
tempor, etc.) is treated as placeholder, not subject to the
project's editorial rules.

When low-fi files are converted to hi-fi (the lorem strings get
replaced with real copy), Plane 8 starts applying the editorial
rules to the new strings normally.

### `--fidelity` flag behavior

- **`--fidelity hi`** (default): all copy is realistic, applied
  per the established voice (`product/.pencil-tone.json`) and
  editorial style (`product/.pencil-editorial.json`).
- **`--fidelity low`**: D1/H1/H2 use lorem ipsum per the table
  above; everything else is realistic. The output `.pen` is
  marked as low-fi via metadata so future commands and audit
  understand the file's stage.

The flag is **universal across all `/product:design:*` commands that
produce visual artifacts**. Individual commands don't need to
list it in their argument-hint to support it; the convention
established here applies to all generation commands.

For discoverability, commands with established argument-hints
should append `[--fidelity low|hi]` so users see the flag when
reading the command file. Commands without argument-hints
inherit the convention silently.

### Promoting low-fi to hi-fi

A common workflow:

1. Generate low-fi exploration (`product/design/explore`) or low-fi
   page (`product/design/design-page --fidelity low`) for structural
   review
2. Stakeholder approval on structure
3. Promote to hi-fi: re-run with `--fidelity hi` (using the
   existing low-fi `.pen` as `--inherit-from`), keeping
   structure but populating real copy via voice + editorial

The promotion is non-destructive — the low-fi file can stay
in `design/explorations/` for reference; the hi-fi version
becomes the production source.

### When fidelity gets ambiguous

Some artifacts genuinely don't fit either bucket cleanly:

- **Sales/marketing demo decks** — sometimes hi-fi enough to
  ship to customers but low-fi enough that copy is placeholder.
  Treat as hi-fi for editorial purposes (real copy in voice);
  treat as low-fi for engineering-readiness (don't expect
  production-ready handoff).
- **Foundation `.pen` files** (colors.pen, typography.pen) —
  these don't have meaningful "copy" in the body sense. Apply
  no fidelity treatment; foundations are foundations.
- **Pattern `.pen` files** — patterns are reusable; they're
  generated hi-fi so they can be composed into hi-fi templates,
  but their *content* is naturally minimal (a hero pattern's
  headline is `{{ headline }}` placeholder). The fidelity flag
  for patterns affects placeholder treatment: low-fi uses lorem;
  hi-fi uses representative voice-aligned placeholders.



In constrained environments where Pencil's MCP server can't be
reached, Path A is unavailable. Path B (CLI) is the default; Path
D (open-pencil) handles operations that don't require generation.
See `product/strategy/constrained-mode.md` for the full setup.

---
type: workflow
outcome: Set up a new product design system end to end
description: The parent product workflow for a new product from zero — UX (personas, journeys, stories, story maps), low-fi wireframes, research, brand decisions, deterministic design-system generation (mech-pencil), audit, and the first production page. Every product workflow runs as a phase here; optional phases prompt to skip.
estimatedDuration: 4-8 hours interactive
phases: 8
prerequisites:
  - Pencil MCP server (for wireframes / pages) and/or @jefelabs/mech-pencil (for system generation)
  - LLM provider credentials configured
  - Empty or new project repo
---

# Workflow — Greenfield (parent)

> **When to use**: starting a new product from zero.
>
> **When NOT to use**: an existing product UI worth preserving — use
> `migrate-to-pencil` instead. To add to / improve an existing system,
> use the `brownfield-*` workflows.

This is the **parent workflow**. Every other product workflow/command runs
as a phase below. The dependency graph (not strict linear order):

```
ux-foundation ─┬─→ wireframes ───────────────────────────────┐
               └─→ stories ──────────────────────────────────┤
research ──────────→ brand-foundation → foundation-selection → system-generation → audit → first-production-page
                     (research feeds brand + selection)        (HITL gate)         (system)   (page + page-audit)
```

Two tracks run in parallel and **converge at the first page**: the
**UX/structure** track (`ux:*` → `design:explore`) and the **brand/system**
track (`research` → `scaffold` → `*-select` → `mech-pencil system`).

## Optional-step convention (skip prompts)

Phases marked **OPTIONAL** must **prompt the user before running**:

> *"Run **<phase>**? — <one-line value>. It's optional; skip if <reason>.
> [run / skip]"*

- On **run**: execute the phase, then `/core:workflows:manage complete <phase>`.
- On **skip**: `/core:workflows:manage complete <phase> --skip` and continue.
  Never silently skip or silently run — always surface the choice.

**Required** phases run without a skip prompt (they still pause for review
where noted). If a required phase's input is missing because an upstream
optional phase was skipped, use the documented **fallback**.

## Outputs of a complete run

- `product/.pencil-ux.json` + `docs/ux/**` — personas, journeys, stories, story map *(if UX run)*
- `design/explorations/<story>.pen` — low-fi wireframes *(if wireframes run)*
- `design/research/<industry>.{md,pen,json}` *(if research run)*
- `product/.pencil-brand.json` — brand decisions (colors/typography/icons/grids)
- `product/design/system/**` — generated system: `foundations/`, `components/`, `templates/`, `base.pen` (each `.lib.pen` + PNG)
- `design/pages/<first-page>.pen` + `src/pages/<first-page>.tsx` — first production page

---

## Phase 1 — UX foundation  **(OPTIONAL, recommended)**

Prompt: *"Run UX foundation? — personas, journeys, stories, and a story
map that justify every screen. Skip only if you already have these or the
surface is trivial. [run / skip]"*

```bash
/product:ux:personas:define            # who (+ define-jtbd)
/product:ux:journeys:map <name>        # user journeys (+ pain-points)
/product:ux:stories:write              # user stories (+ acceptance-criteria)
/product:ux:story-maps:build <name>    # backbone + stories per journey (+ slice for MVP)
```

⇒ `product/.pencil-ux.json`. **These stories are the source of truth reused
by Phase 2 and Phase 8 — they are not regenerated downstream.**

**Mark complete**: `/core:workflows:manage complete ux-foundation`

## Phase 2 — Low-fi wireframes  **(OPTIONAL, recommended)**

Prompt: *"Run low-fi wireframes? — grayscale structural explorations per
story before committing to a direction. Skip if layouts are obvious.
[run / skip]"*

Per MVP story, generate structurally-different low-fi wireframes (grayscale,
FA icons, storyboard rows). Token-independent — does **not** need the brand:

```bash
/product:design:explore "@docs/ux/stories/<id>.md" --n 3 --device desktop
```

**Input / fallback:** consumes Phase 1 stories. **If Phase 1 was skipped**,
`design:explore` also accepts a brief/intent string directly —
`/product:design:explore "<one-line page intent>"` — so it never blocks on
missing stories. Note the chosen structural direction per screen; it feeds
Phase 8.

**Mark complete**: `/core:workflows:manage complete wireframes`

## Phase 3 — Research  **(OPTIONAL)**

Prompt: *"Run competitive/industry research? Surfaces category conventions
+ differentiation (~1h). Skip if the industry is novel or budget is tight.
[run / skip]"*

```bash
/product:strategy:research "<industry>" --depth standard --competitors <urls>
```

**Sequencing:** research runs **before brand (Phase 4)** so it can shape
brand strategy, and it feeds **foundation-selection (Phase 5)**. It may also
run first (parallel to Phase 1) to inform the UX framing. Both
`strategy:scaffold` and the `*-select` deciders accept
`--informed-by design/research/<industry>.json`.

**Mark complete**: `/core:workflows:manage complete research` (or `--skip`)

## Phase 4 — Brand foundation  **(required)**

Define core brand inputs — this **authors `product/.pencil-brand.json`**.
Pass research from Phase 3 so it actually shapes the brand:

```bash
/product:strategy:scaffold [--informed-by design/research/<industry>.json]
# interactive: brand name, industry, audience, audience-regulation,
# primary/secondary, fonts, dark-mode, scripts
```

**Mark complete**: `/core:workflows:manage complete brand-foundation`

## Phase 5 — Foundation selection  **(required)**

The `*-select` deciders — they **update `product/.pencil-brand.json`** (the
single source Phase 6 generates from). Pass `--informed-by` if Phase 3 ran:

```bash
/product:design:foundations:colors-select  [--informed-by design/research/<industry>.json]
/product:design:foundations:fonts-select
/product:design:foundations:icons-select
/product:design:foundations:imagery-select
```

**Ordering note (a choice, not a hard rule):** this is linear — colors are
chosen before icons/imagery, so icons/imagery don't feed back into the
palette. If `icons-select`/`imagery-select` surface a reason to shift the
ramp, re-run `colors-select` (selection is safe to iterate; each writes
atomically). Each step pauses for review.

**Mark complete**: `/core:workflows:manage complete foundation-selection`

## Phase 6 — Design-system generation  **(required)**

Generate the entire system **deterministically (zero-LLM)** from the brand
JSON with **`@jefelabs/mech-pencil`** — this **replaces** the kit's former
foundation-rendering, component, pattern, and template phases:

```bash
# from agentx-toolbox/apps/mech-pencil (run under bun):
mech-pencil system -a <accent> -b <base> --font <family> -r <radius> -d product/design/system
# (or: the no-args wizard → same system)
```

Produces `product/design/system/`: `foundations/{colors,typography,icons,grids}.lib.pen`,
`components/<category>.lib.pen`, `templates/<page>-<viewport>.lib.pen`, and `base.pen` —
each with a faithful PNG (Pencil headless export; auth-gated).

> **Single-source goal:** route this from `product/.pencil-brand.json` (the
> brand path) so the file Phase 5 wrote actually drives generation.
> See [[reference_mech_pencil_design_system_generator]].
>
> **Legacy kit path** (only if not using mech-pencil): the former
> `foundations:*`, `core:frameworks:heroui:components:*`, `patterns:*`, and
> `templates:*` render commands. Deprecated by the deterministic generator.

**Review gate (HITL — required before audit).** This one phase replaces four
former phases in a single shot, so do **not** auto-flow into audit. Open
`product/design/system/base.pen` in Pencil and skim the foundation /
component / template PNGs.

> Prompt: *"System generated — review `base.pen` + the PNGs (palette, type,
> icons, component fidelity). Proceed to audit, or regenerate? [proceed /
> regenerate]"*

On **regenerate**: adjust Phase 5 (or the brand path) and re-run Phase 6.

**Mark complete**: `/core:workflows:manage complete system-generation`

## Phase 7 — System audit  **(required)**

A quick **system-level** audit — spec conformance only:

```bash
/audit
```

This catches **generation** problems (contrast, regulated-audience variants,
design-layer lint) but **not usage** problems — a system audited in isolation
looks fine until a real page exercises it. So this is the *cheap* pass; the
real stress test (a page-level audit) is folded into Phase 8. Address all
`fail`-severity findings; warnings are deferrable.

**Mark complete**: `/core:workflows:manage complete audit`

## Phase 8 — First production page + page audit  **(required to ship)**

Compose the first real page — the cheapest real stress test of the system —
then audit *in use*.

**Reuse, don't regenerate:** this phase consumes Phase 1 stories and Phase 2
wireframes directly. Only fall back to writing a brief / deriving stories /
exploring here if those phases were skipped.

```bash
# brief + stories ONLY if Phase 1 was skipped (else reuse Phase 1 stories):
/product:strategy:brief
/product:strategy:user-stories <brief-slug>
# wireframe ONLY if Phase 2 was skipped (else reuse design/explorations/<story>.pen):
/product:design:explore "<story>"

/product:design:design-page <page-name> --based-on design/explorations/<story>.pen
/core:frameworks:heroui:build-components <page-slug>

# page-level audit — the usage stress test the system audit can't do:
/audit --scope page:<page-name>
```

Fold any **system**-level issues the page surfaces back into Phase 5/6 and
re-run those phases — the first page is where system gaps actually show up.

**Mark complete**: `/core:workflows:manage complete first-production-page`

## Workflow complete

State moves to `history` with `status: "complete"`. The project is now ready
for ongoing `brownfield-*` work.

## Resume points

- After **Phase 4** (brand): resume runs Phase 5 (selection).
- After **Phase 5**: resume runs Phase 6 (system generation).
- After **Phase 6**: resume pauses at the HITL review gate, then audit.
- After **Phase 7**: resume reuses Phase 1/2 inputs for the first page.
- Skipped optional phases are recorded (`--skip`) so resume doesn't re-prompt.

## Troubleshooting

- **System audit fails after Phase 6**: usually a contrast issue from
  `colors-select`. Re-run `/product:design:foundations:colors-select`, then re-run Phase 6.
- **`mech-pencil system` PNGs skipped**: the Pencil CLI isn't authenticated —
  `pencil login` or set `PENCIL_CLI_KEY` (the `.lib.pen` files still emit).
- **Generated system doesn't match the brand JSON**: confirm Phase 6 runs the
  brand path (consuming `.pencil-brand.json`), not the accent-only theme path.
- **Research didn't influence the brand**: it must run before Phase 4 and be
  passed via `--informed-by` to `scaffold`; running it after only affects selection.
- **Page (Phase 8) reveals a system gap**: don't patch the page — fix Phase 5/6
  and regenerate, so the fix lives in the system, not the page.
---
name: skillzkit-suggest-next
description: Suggest a next task or workflow after the user has completed a slash command or workflow phase. Fires when the user says things like "what's next", "I just finished X", "I just ran X — what should I do now", "what should I do after X", "suggest a next step", "what comes after this", "what builds on what I just did", "where do I go from here", "any follow-up I should run", "is there a workflow that uses this", or otherwise signals completion of a runnable item and asks for direction. Reviews the catalog's dependency graph (forward references and the precomputed referencedBy reverse-edge index) plus the active-workflow state file when present, and returns a small ranked list mixing single-shot tasks and multi-phase workflows.
---

# skillzkit-suggest-next

A graph-walker. After the user finishes a runnable thing (a task or a
workflow phase), this skill consults the suite's dependency graph and
proposes what they could do next.

## In scope

- Reading `catalog.json` (commands, workflows, skills) — the suite's
  authoritative graph
- Reading `product/.pencil-workflow-state.json` when present — the
  user's runtime workflow position
- Producing a ranked list of next-step candidates, mixing **tasks**
  (single-shot commands that report done) and **workflows**
  (multi-phase, persisted state)

## Out of scope

- Starting/advancing workflows — that's `/core:workflows:manage`
- Installing items into a project — that's `skillzkit install` (or
  `/core:tools:setup`, etc., for tool-specific install)
- Routing free-form intent ("I want to scaffold a brand") — that's
  the persona routers (`skillzkit-product-router`, etc.)
- Ranking items the user hasn't run anything related to (cold-start) —
  the routers handle "where do I begin" intent

## When to fire

Strongest triggers — fire without hesitation:

- "I just finished `/core:tools:setup` — what's next?"
- "I just ran `<slash-command>`. What should I do after?"
- "What builds on what I just did?"
- "Any follow-up tasks for `<slug>`?"
- "Is there a workflow that uses `<slug>`?"

Softer triggers — fire when context makes the completion implicit:

- A previous turn in the conversation showed a successful run of a
  slash command, and the user asks "now what?" or "next step?"
- The user describes finishing work that maps cleanly to a known slug
  (e.g. "I scaffolded the design system" → `/product:strategy:scaffold`)

Do NOT fire when:

- The user is asking how to *do* something (route via the persona
  routers instead)
- The user is mid-debugging or asking about errors (they want help
  with the current thing, not a next thing)
- The user is asking about installation, configuration, or tool setup
  (route to `skillzkit-tools-router` / `skillzkit-integrations-router`)

## Algorithm

### Step 1 — Identify the completed slug

The slug is the slash-command form, e.g. `core:tools:npm` or
`product:strategy:scaffold`, or a workflow's qualified name like
`product:greenfield`.

If the user named it directly (`/core:tools:npm`), strip the leading
slash and use it as-is. If the user described it in prose ("I scaffolded
the brand"), map their phrasing to a known slug by searching
`catalog.commands[].description` and `catalog.commands[].outcome`
for the closest match. **Confirm the inferred slug with the user
before proceeding** if it isn't obvious — wrong slug → wrong
suggestions.

### Step 2 — Get suggestions

**Preferred path**: shell out to the CLI when available.

```bash
skillzkit suggest <slug>
# Optional: surface positional next-step from active workflow
skillzkit suggest <slug> --state product/.pencil-workflow-state.json
# Optional: cap output
skillzkit suggest <slug> --limit 5
```

The CLI returns a ranked list with `kind` ([task] vs [workflow]),
`rationale`, and `score` per item. Print or summarize as-is.

**Fallback path** (no CLI installed): read `catalog.json` directly
and produce a minimal list inline.

1. Find `commands[]` where `slug === X`. Extract `referencedBy[]` —
   these are slugs whose body references X.
2. For each `slug` in `referencedBy[]`, look up the entry; skip ones
   with `kind === "context"` or `kind === "workflow"` (workflows
   handled separately).
3. Find `workflows[]` where `references` includes X — these are
   multi-phase wrappers that contain X. Suggest each with the tag
   "[workflow] — multi-phase".
4. If `product/.pencil-workflow-state.json` exists and its
   `active.workflow` is a workflow whose body contains X, find the
   slug appearing immediately after X in the workflow body's
   reference list (in document order, not alphabetical) and surface
   it as the strongest candidate ("next step in active workflow").
5. Skip ranking in the fallback — present the categorized list and
   tell the user "for ranked output, install `skillzkit` and re-run."

### Step 3 — Check if each candidate is installed

For each top-ranked candidate, check whether its file exists in the
target project's `.claude/`:

- **Tasks/workflows** — `.claude/commands/<slug-as-path>.md`
  (e.g. `core:tools:playwright` → `.claude/commands/core/tools/playwright.md`)
- **Skills** — `.claude/skills/<name>/SKILL.md`

If the file is missing, mark the candidate as `(not installed)` and
offer to install it on demand:

```bash
skillzkit install <slug>
```

`skillzkit install <slug>` does a **selective install with transitive
dependency resolution** — it copies the requested slug *plus* every
slug its body references (BFS-walk over `references[]`), so the user
gets a working set, not a dangling file. Multiple slugs in one call
are fine.

When presenting, format like:

```
  [task]       /core:tools:playwright          (not installed)
               Builds on tools setup
               → Run: skillzkit install core:tools:playwright
                 (will also install: pixelmatch, chrome-devtools, …)
```

If the user picks one to install, run the install command, then offer
to invoke the slug right after.

### Step 4 — Present

Show **at most 5–8 candidates** unless the user asks for more. Use
this shape:

```
Next steps after /core:tools:setup:

  [task]       /core:tools:npm
               Builds on tools setup

  [workflow]   product:greenfield
               Multi-phase workflow that uses tools setup

  [task]       /core:tools:playwright
               Builds on tools setup
```

If there's an active workflow and a positional next step, lead with
it and label it clearly:

```
You're inside workflow: product:greenfield
Next step in the workflow:
  → /product:design:foundations:colors
```

If the result is empty (the slug has no consumers and isn't in any
workflow), say so plainly. Don't pad with unrelated suggestions.

## Ranking philosophy

When multiple signals fire on the same candidate, the rank should
reflect:

- **Strongest** — the literal next step in the active workflow
  (the user is mid-flow; this isn't a guess)
- **Strong** — workflows that wrap the completed slug (committing
  to a multi-phase flow is a bigger step but unlocks more)
- **Baseline** — single-task consumers (small, focused next move)

The executable ranker lives in `lib/suggest.ts:rankSuggestions` and
is the single source of truth — when the CLI is available, this
skill consumes its output verbatim. When falling back to inline
reasoning, follow the same priority above qualitatively but keep
the output simple.

## Examples

### Example 1 — direct slug, no active workflow

> User: "I just finished /core:tools:setup. What's next?"

Run `skillzkit suggest core:tools:setup --limit 5`, summarize the
top results, and offer to `/core:tools:setup --check` if relevant.

### Example 2 — prose completion, infer slug

> User: "I scaffolded the brand foundations. What now?"

Map "scaffolded brand foundations" → `/product:strategy:scaffold`.
Confirm with user: "Did you mean `/product:strategy:scaffold`?"
Then suggest.

### Example 3 — active workflow

> User: "Done with /core:frameworks:heroui:components:buttons.
> What's next?"

If `product/.pencil-workflow-state.json` shows
`active.workflow: product:greenfield`, the positional next-step
signal will dominate. Lead with the in-workflow next step,
secondary suggestions follow.

### Example 4 — empty result

> User: "What's next after /core:tools:open-pencil?"

If the slug has no consumers in the catalog, say:

> No suggestions found — `/core:tools:open-pencil` isn't referenced
> by any other command, workflow, or skill. You may have wrapped up
> a one-shot task.

Don't fabricate suggestions to fill the screen.

## Anti-patterns

Do not:

- **Suggest the same slug the user just completed.** Self-loops in
  the graph are filtered, but verify if you're reasoning inline.
- **Suggest `_context` or `_index` files.** They aren't runnable.
- **Recommend installing a workflow the user is already inside.**
  Read the active state first.
- **Over-rank by score.** When scores are within ~0.1 of each other,
  present them as roughly equivalent — don't pretend to precision
  that isn't there.
- **Pad empty results.** "No suggestions" is a valid, useful answer.
- **Re-route to a persona router.** This skill answers a *specific*
  question ("what's next after X?"), not the broader "what should I
  do?" question routers handle.
- **Touch the TUI.** The skillzkit TUI is browse + install only;
  suggestion is a query/runtime concern that lives in the CLI and
  library.

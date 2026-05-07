/**
 * "What should I do next?" suggestion engine.
 *
 * Given a slug X that the user just completed, returns a ranked list of
 * NextSuggestion candidates pulled from three signals:
 *
 *   1. Reverse-deps          — items whose body references X
 *                              (read straight from catalog.referencedBy)
 *   2. Workflow wrappers     — workflows whose body references X; the
 *                              whole multi-phase workflow is offered as
 *                              a single candidate ("you did one piece;
 *                              here's the surrounding flow")
 *   3. Active-workflow next  — if the caller passes the contents of
 *                              .pencil-workflow-state.json AND the active
 *                              workflow's body references X, the slug
 *                              that comes immediately after X in that
 *                              workflow's body is suggested as the
 *                              positional next step
 *
 * All three signals are gathered deterministically below. The final
 * ranking — how to combine scores when multiple signals fire on the
 * same candidate, what weights to use, how to break ties — lives in
 * `rankSuggestions()` near the bottom of this file. That's the piece
 * worth tuning by hand.
 */

import { getCommand, getCommands, getWorkflows } from "./index.js";
import type { NextReason, NextSuggestion } from "./types.js";

/**
 * Minimal shape of `.pencil-workflow-state.json` we care about.
 * Caller can pass the parsed file or a hand-built object — any extra
 * fields are ignored.
 */
export interface ActiveWorkflowState {
  workflow: string; // e.g. "product:greenfield"
  currentStep?: string;
}

export interface SuggestOptions {
  /** Truncate the returned list to this many items. Default: 8. */
  limit?: number;
  /** Parsed contents of product/.pencil-workflow-state.json, if any. */
  activeWorkflowState?: ActiveWorkflowState;
}

/**
 * Internal candidate before ranking. Multiple signals may produce the
 * same slug — `mergeAndRank` collapses them into one NextSuggestion.
 */
interface RawCandidate {
  slug: string;
  kind: "command" | "workflow";
  reason: NextReason;
  rationale: string;
}

export function suggestNext(
  completedSlug: string,
  options: SuggestOptions = {},
): NextSuggestion[] {
  const limit = options.limit ?? 8;
  const completed = getCommand(completedSlug);
  if (!completed) return [];

  const raw: RawCandidate[] = [
    ...gatherReverseDeps(completedSlug),
    ...gatherWorkflowWrappers(completedSlug),
    ...gatherActiveWorkflowNext(completedSlug, options.activeWorkflowState),
  ];

  return rankSuggestions(raw).slice(0, limit);
}

// ─── Signal 1: reverse-deps ───────────────────────────────────────────

function gatherReverseDeps(completedSlug: string): RawCandidate[] {
  const completed = getCommand(completedSlug);
  if (!completed) return [];
  const out: RawCandidate[] = [];
  for (const consumerSlug of completed.referencedBy) {
    const consumer = getCommand(consumerSlug);
    if (!consumer || consumer.kind === "context") continue; // context files aren't runnable
    if (consumer.kind === "workflow") continue; // workflow wrappers handled by signal 2
    out.push({
      slug: consumerSlug,
      kind: "command",
      reason: "consumes-X",
      rationale: `Builds on ${completedSlug}`,
    });
  }
  return out;
}

// ─── Signal 2: workflow wrappers ──────────────────────────────────────

function gatherWorkflowWrappers(completedSlug: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const wf of getWorkflows()) {
    if (!wf.references.includes(completedSlug)) continue;
    out.push({
      slug: wf.qualifiedName,
      kind: "workflow",
      reason: "wraps-X",
      rationale: `Multi-phase workflow that includes ${completedSlug}`,
    });
  }
  return out;
}

// ─── Signal 3: positional next in active workflow ─────────────────────

function gatherActiveWorkflowNext(
  completedSlug: string,
  state: ActiveWorkflowState | undefined,
): RawCandidate[] {
  if (!state) return [];
  const activeWf = getWorkflows().find((w) => w.qualifiedName === state.workflow);
  if (!activeWf) return [];

  // Walk the workflow body's reference list in document order. The
  // catalog stores `references` sorted alphabetically (see load.ts), so
  // we re-derive document order from the body to honor authorial intent.
  const orderedRefs = extractReferencesInOrder(activeWf.body);
  const idx = orderedRefs.indexOf(completedSlug);
  if (idx === -1 || idx === orderedRefs.length - 1) return [];

  // Skip ahead past any context-file refs to find the next runnable.
  for (let i = idx + 1; i < orderedRefs.length; i++) {
    const candidate = getCommand(orderedRefs[i]);
    if (!candidate || candidate.kind === "context") continue;
    return [
      {
        slug: orderedRefs[i],
        kind: candidate.kind === "workflow" ? "workflow" : "command",
        reason: "next-in-active-workflow",
        rationale: `Next step in active workflow ${state.workflow}`,
      },
    ];
  }
  return [];
}

/**
 * Extract slash-command references from a body in *document order*,
 * preserving duplicates' first-occurrence position. Mirrors the regex
 * used in load.ts but skips the alphabetic dedup so positional logic
 * sees the order the author wrote.
 */
function extractReferencesInOrder(body: string): string[] {
  const REF = /\/([a-z][a-z0-9_-]*(?::[a-z0-9_*-]+)+)/gi;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of body.matchAll(REF)) {
    const ref = match[1].replace(/[.,;:)\]*]+$/, "");
    if (ref.includes("*")) continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    ordered.push(ref);
  }
  return ordered;
}

// ─── Ranking ──────────────────────────────────────────────────────────

/**
 * Merge raw candidates into a final ranked list of NextSuggestion.
 *
 * Inputs you have to work with (per RawCandidate):
 *   - slug:       the candidate's identifier
 *   - kind:       "command" (single task) or "workflow" (multi-phase)
 *   - reason:     "consumes-X" | "wraps-X" | "next-in-active-workflow"
 *   - rationale:  pre-formatted human string
 *
 * The same `slug` may appear multiple times (e.g. a workflow could be
 * BOTH `wraps-X` AND `next-in-active-workflow`). Decide how to merge:
 *   - Pick the highest-priority reason and drop the others?
 *   - Keep all reasons and surface as one entry with combined rationale?
 *   - Boost the score when multiple signals fire on the same candidate?
 *
 * Suggested starting weights (feel free to ignore):
 *   "next-in-active-workflow"  → strongest (you're literally mid-flow)
 *   "wraps-X"                  → medium-strong (committing to a workflow
 *                                 is a bigger ask than running a task)
 *   "consumes-X"               → baseline
 *
 * Other knobs to consider:
 *   - Penalize candidates whose slug is itself a `_context` or `_index`
 *     entry (these aren't runnable) — though gatherReverseDeps already
 *     filters those.
 *   - Boost candidates whose `outcome` frontmatter is non-empty (they
 *     declare what they produce, which means they're well-described).
 *   - When the candidate is a workflow, its NextSuggestion.slug should
 *     be the qualifiedName form (e.g. "product:greenfield"), which the
 *     CLI/agent passes to /core:workflows:manage start.
 *
 * Return the suggestions sorted by `score` descending (highest first).
 *
 * TODO(you): implement this — see the comments above for the inputs and
 * trade-offs. Replace the placeholder return below.
 */
function rankSuggestions(raw: RawCandidate[]): NextSuggestion[] {
  // ────────── PLACEHOLDER ranking — REPLACE ME ──────────
  // Naive: dedup by slug (last-wins), uniform score of 1, preserve
  // gather order. This is just to make the wiring runnable end-to-end;
  // it produces inconsistent results when multiple signals fire.
  const bySlug = new Map<string, NextSuggestion>();
  for (const c of raw) {
    bySlug.set(c.slug, {
      slug: c.slug,
      kind: c.kind,
      reason: c.reason,
      score: 1,
      rationale: c.rationale,
    });
  }
  return Array.from(bySlug.values());
  // ─────────────────────────────────────────────────────
}

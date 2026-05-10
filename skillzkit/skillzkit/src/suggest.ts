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
 * Per-reason base weight. The numbers express *confidence* that this
 * candidate is the right next step, not magnitude of importance:
 *
 *   - next-in-active-workflow → 1.0  (positional ground truth from
 *                                     the runtime workflow state file)
 *   - wraps-X                 → 0.5  (a multi-phase commitment that
 *                                     bundles the completed slug as
 *                                     one of its steps)
 *   - consumes-X              → 0.3  (one of potentially many tasks
 *                                     that mention the completed slug)
 */
const REASON_WEIGHTS: Record<NextReason, number> = {
  "next-in-active-workflow": 1.0,
  "wraps-X": 0.5,
  "consumes-X": 0.3,
};

/** Bonus added per additional signal firing on the same candidate. */
const MULTI_SIGNAL_BONUS = 0.1;

/**
 * Merge raw candidates into a ranked NextSuggestion list. The same
 * slug may appear multiple times (e.g. a workflow could be BOTH
 * `wraps-X` AND `next-in-active-workflow`); group by slug, take the
 * highest-weight reason as primary, add a small bonus per extra
 * signal, and combine the rationale strings so the user sees every
 * reason this candidate scored.
 *
 * Sorting: score desc, workflows-before-commands at score ties (the
 * workflow unlocks a multi-phase flow for the same numeric confidence,
 * so it's the bigger payoff), then alphabetical for stable output.
 */
function rankSuggestions(raw: RawCandidate[]): NextSuggestion[] {
  // Group by slug so multi-signal candidates collapse to one row.
  const groups = new Map<string, RawCandidate[]>();
  for (const c of raw) {
    const list = groups.get(c.slug) ?? [];
    list.push(c);
    groups.set(c.slug, list);
  }

  const ranked: NextSuggestion[] = [];
  for (const [slug, candidates] of groups) {
    // Sort the candidate's signals by reason weight; the strongest is
    // the "primary" reason that drives kind/reason fields and leads
    // the rationale string.
    const sorted = [...candidates].sort(
      (a, b) => REASON_WEIGHTS[b.reason] - REASON_WEIGHTS[a.reason],
    );
    const primary = sorted[0];

    // Confidence = max base + (n-1) * bonus, clamped to [0, 1] so
    // score stays interpretable as a probability-shaped number.
    const score = Math.min(
      1.0,
      REASON_WEIGHTS[primary.reason] +
        (sorted.length - 1) * MULTI_SIGNAL_BONUS,
    );

    const rationale =
      sorted.length === 1
        ? primary.rationale
        : `${primary.rationale}. Also: ${sorted
            .slice(1)
            .map((c) => c.rationale.toLowerCase())
            .join("; ")}`;

    ranked.push({
      slug,
      kind: primary.kind,
      reason: primary.reason,
      score,
      rationale,
    });
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === "workflow" ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });

  return ranked;
}

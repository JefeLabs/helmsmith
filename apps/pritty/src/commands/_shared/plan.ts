import type { CommitMessage } from '../../ai.js';
import type { CategorizedFiles } from '../../categorizer.js';
import { applyTrailers } from './attribution.js';

/** Committed after the code, in this order: tests exercise it, stories render it. */
const LAST_CATEGORIES: readonly string[] = ['test', 'storybook'];

/**
 * The model writes the messages; the categorizer decides the files. Whatever
 * file list the model returned is replaced by the deterministic grouping, so
 * neither a hallucinated path nor text inside a diff can steer what gets
 * committed. A plan that does not cover every non-empty category one time
 * each is rejected before anything is committed.
 *
 * The order is not the model's either: code categories first, in the
 * categorizer's order, then `test`, then `storybook`, so every commit builds
 * and passes its own tests on its own (a test committed before the code it
 * exercises is red at that commit and breaks bisect).
 */
export function reconcileCommitPlan(
  plan: readonly CommitMessage[],
  grouped: CategorizedFiles,
  onRename?: (from: string, to: string) => void,
): CommitMessage[] {
  const seen = new Set<string>();
  const out: CommitMessage[] = [];
  for (const step of pairRenamedCategory(plan, grouped, onRename)) {
    const files = grouped[step.category];
    if (files === undefined) {
      throw new Error(`AI plan names a category the categorizer did not produce: ${step.category}`);
    }
    if (seen.has(step.category)) {
      throw new Error(`AI plan lists category ${step.category} more than once`);
    }
    seen.add(step.category);
    if (files.length === 0) continue;
    out.push({ ...step, files: [...files] });
  }
  const missing = Object.entries(grouped)
    .filter(([cat, files]) => files.length > 0 && !seen.has(cat))
    .map(([cat]) => cat);
  if (missing.length > 0) {
    throw new Error(`AI plan omits categories with staged files: ${missing.join(', ')}`);
  }
  const position = Object.keys(grouped);
  const rank = (c: CommitMessage): [number, number] => [
    LAST_CATEGORIES.indexOf(c.category) + 1,
    position.indexOf(c.category),
  ];
  return out.sort((a, b) => {
    const [ra, pa] = rank(a);
    const [rb, pb] = rank(b);
    return ra - rb || pa - pb;
  });
}

/**
 * A model sometimes renames a category in its answer (`unknown` came back as
 * `feature`). With exactly one name the categorizer did not produce and
 * exactly one category with staged files that no step claims, only one
 * pairing is possible, so it is made and reported. Anything less certain is
 * left for `reconcileCommitPlan` to refuse.
 */
function pairRenamedCategory(
  plan: readonly CommitMessage[],
  grouped: CategorizedFiles,
  onRename?: (from: string, to: string) => void,
): readonly CommitMessage[] {
  const strangers = plan.filter((s) => grouped[s.category] === undefined);
  if (strangers.length !== 1) return plan;
  const claimed = new Set(plan.map((s) => s.category));
  const unclaimed = Object.entries(grouped)
    .filter(([cat, files]) => files.length > 0 && !claimed.has(cat))
    .map(([cat]) => cat);
  if (unclaimed.length !== 1) return plan;
  const from = strangers[0]!.category;
  const to = unclaimed[0]!;
  onRename?.(from, to);
  return plan.map((s) => (s.category === from ? { ...s, category: to } : s));
}

/** Subject, optional body, then the configured trailers. */
export function composeCommitMessage(c: CommitMessage, trailers: readonly string[]): string {
  const base = c.body ? `${c.message}\n\n${c.body}` : c.message;
  return applyTrailers(base, trailers);
}

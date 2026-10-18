import type { CommitMessage } from '../../ai.js';
import type { CategorizedFiles } from '../../categorizer.js';
import { applyTrailers } from './attribution.js';

/**
 * The model writes the messages; the categorizer decides the files. Whatever
 * file list the model returned is replaced by the deterministic grouping, so
 * neither a hallucinated path nor text inside a diff can steer what gets
 * committed. A plan that does not cover every non-empty category one time
 * each is rejected before anything is committed.
 */
export function reconcileCommitPlan(
  plan: readonly CommitMessage[],
  grouped: CategorizedFiles,
): CommitMessage[] {
  const seen = new Set<string>();
  const out: CommitMessage[] = [];
  for (const step of plan) {
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
  return out;
}

/** Subject, optional body, then the configured trailers. */
export function composeCommitMessage(c: CommitMessage, trailers: readonly string[]): string {
  const base = c.body ? `${c.message}\n\n${c.body}` : c.message;
  return applyTrailers(base, trailers);
}

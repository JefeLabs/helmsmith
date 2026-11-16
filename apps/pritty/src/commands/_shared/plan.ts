import type { CommitMessage } from '../../ai.js';
import type { CategorizedFiles } from '../../categorizer.js';
import type { CommitGrouping } from '../../config.js';
import { applyTrailers } from './attribution.js';

/** Committed after the code, in this order: tests exercise it, stories render it. */
const LAST_CATEGORIES: readonly string[] = ['test', 'storybook'];

/**
 * The model writes the messages; the categorizer decides the categories. A
 * category the model leaves whole (one step) gets the categorizer's full file
 * list, whatever list the model returned, so neither a hallucinated path nor
 * text inside a diff can steer what gets committed. With `grouping: 'change'`
 * the model may split a category into one step per change; only then do its
 * file lists count, and they must divide that category's staged files exactly
 * (see splitCategory). A plan that does not cover every non-empty category is
 * rejected before anything is committed.
 *
 * The order is not the model's either, except for the order of changes: steps
 * go change by change, in the order the model first names each change, and
 * inside a change code categories come first, in the categorizer's order, then
 * `test`, then `storybook`, so every commit builds and passes its own tests on
 * its own (a test committed before the code it exercises is red at that
 * commit and breaks bisect). Steps without a change label form one change, so
 * a plan without labels is ordered exactly as before.
 */
export function reconcileCommitPlan(
  plan: readonly CommitMessage[],
  grouped: CategorizedFiles,
  onRename?: (from: string, to: string) => void,
  grouping: CommitGrouping = 'category',
): CommitMessage[] {
  const paired = pairRenamedCategory(plan, grouped, onRename);
  const byCategory = new Map<string, CommitMessage[]>();
  for (const step of paired) {
    if (grouped[step.category] === undefined) {
      throw new Error(`AI plan names a category the categorizer did not produce: ${step.category}`);
    }
    const steps = byCategory.get(step.category) ?? [];
    if (steps.length > 0 && grouping === 'category') {
      throw new Error(`AI plan lists category ${step.category} more than once`);
    }
    steps.push(step);
    byCategory.set(step.category, steps);
  }
  const out: CommitMessage[] = [];
  for (const [category, steps] of byCategory) {
    const files = grouped[category]!;
    if (files.length === 0) continue;
    if (steps.length === 1) out.push(labelled({ ...steps[0]!, files: [...files] }));
    else out.push(...splitCategory(category, steps, files));
  }
  const missing = Object.entries(grouped)
    .filter(([cat, files]) => files.length > 0 && !byCategory.has(cat))
    .map(([cat]) => cat);
  if (missing.length > 0) {
    throw new Error(`AI plan omits categories with staged files: ${missing.join(', ')}`);
  }
  const changeOrder = new Map<string, number>();
  for (const step of paired) {
    const key = changeKey(step);
    if (!changeOrder.has(key)) changeOrder.set(key, changeOrder.size);
  }
  const position = Object.keys(grouped);
  const rank = (c: CommitMessage): [number, number, number] => [
    changeOrder.get(changeKey(c)) ?? 0,
    LAST_CATEGORIES.indexOf(c.category) + 1,
    position.indexOf(c.category),
  ];
  return out.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
}

function changeKey(step: CommitMessage): string {
  return typeof step.change === 'string' ? step.change.trim() : '';
}

/** The step with its change label trimmed, or without one when it is blank. */
function labelled(step: CommitMessage): CommitMessage {
  const { change: _raw, ...rest } = step;
  const change = changeKey(step);
  return change ? { ...rest, change } : rest;
}

function refuseSplit(category: string, detail: string): never {
  throw new Error(
    `AI plan does not split ${category} cleanly: ${detail}. Run pritty commit again, or set "commitGrouping": "category".`,
  );
}

/**
 * A category the model split into one step per change. Each step needs its own
 * change label and at least one file; every file must be one of the
 * category's staged files, in exactly one step, and every staged file must be
 * in a step. Files keep the categorizer's order.
 */
function splitCategory(
  category: string,
  steps: readonly CommitMessage[],
  files: readonly string[],
): CommitMessage[] {
  const staged = new Set(files);
  const owner = new Map<string, string>();
  const labels: string[] = [];
  for (const step of steps) {
    const label = changeKey(step);
    if (!label) refuseSplit(category, 'a commit has no change label');
    if (labels.includes(label)) refuseSplit(category, `two commits are both "${label}"`);
    labels.push(label);
    const listed: unknown[] = Array.isArray(step.files) ? step.files : [];
    if (listed.length === 0) refuseSplit(category, `the "${label}" commit lists no files`);
    for (const file of listed) {
      if (typeof file !== 'string' || !staged.has(file)) {
        refuseSplit(category, `${String(file)} is not one of its staged files`);
      }
      const other = owner.get(file);
      if (other !== undefined)
        refuseSplit(category, `${file} is in both "${other}" and "${label}"`);
      owner.set(file, label);
    }
  }
  const left = files.filter((f) => !owner.has(f));
  if (left.length > 0) refuseSplit(category, `${left.join(', ')} in no commit`);
  return steps.map((step, i) => ({
    ...labelled(step),
    files: files.filter((f) => owner.get(f) === labels[i]),
  }));
}

/**
 * A model sometimes renames a category in its answer (`unknown` came back as
 * `feature`). With exactly one name the categorizer did not produce (on one
 * step, or on every step of a split) and exactly one category with staged
 * files that no step claims, only one pairing is possible, so it is made and
 * reported. Anything less certain is left for `reconcileCommitPlan` to refuse.
 */
function pairRenamedCategory(
  plan: readonly CommitMessage[],
  grouped: CategorizedFiles,
  onRename?: (from: string, to: string) => void,
): readonly CommitMessage[] {
  const strangers = new Set(
    plan.filter((s) => grouped[s.category] === undefined).map((s) => s.category),
  );
  if (strangers.size !== 1) return plan;
  const claimed = new Set(plan.map((s) => s.category));
  const unclaimed = Object.entries(grouped)
    .filter(([cat, files]) => files.length > 0 && !claimed.has(cat))
    .map(([cat]) => cat);
  if (unclaimed.length !== 1) return plan;
  const from = [...strangers][0]!;
  const to = unclaimed[0]!;
  onRename?.(from, to);
  return plan.map((s) => (s.category === from ? { ...s, category: to } : s));
}

/** Subject, optional body, then the configured trailers. */
export function composeCommitMessage(c: CommitMessage, trailers: readonly string[]): string {
  const base = c.body ? `${c.message}\n\n${c.body}` : c.message;
  return applyTrailers(base, trailers);
}

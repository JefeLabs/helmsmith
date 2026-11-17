import { z } from 'zod';
import type { CommitMessage } from '../../ai.js';
import { type CategoryMap, categorize, UNKNOWN_CATEGORY } from '../../categorizer.js';
import {
  formatConventional,
  isCommitScope,
  isCommitType,
  parseConventional,
} from './conventional.js';
import { normalizeLabel } from './label.js';
import { subjectOf } from './plan.js';

/** One commit an agent asked for, from args or a JSON body. */
export interface ExplicitCommit {
  label?: string;
  type: string;
  scope: string;
  /** A breaking change: `!` after the scope. */
  breaking?: boolean;
  description: string;
  body?: string;
  paths?: string[];
}

/** What --input=json wants on stdin; the refusal for an empty, non-JSON or terminal stdin. */
export const STDIN_HINT = 'expected a JSON document on stdin: { "commits": [...] }';

const commitShape = z.object({
  label: z.string().optional(),
  type: z.string(),
  scope: z.string(),
  breaking: z.boolean().optional(),
  description: z.string(),
  body: z.string().optional(),
  files: z.array(z.string()).optional(),
});

const inputShape = z.object({ commits: z.array(commitShape).min(1) });

/** Parse `{ "commits": [...] }`; `files` becomes `paths`, `breaking: false` is dropped, other keys are ignored. */
export function parseCommitInput(text: string): ExplicitCommit[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(STDIN_HINT);
  }
  const parsed = inputShape.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('\n'),
    );
  }
  return parsed.data.commits.map(({ files, breaking, ...rest }) => ({
    ...rest,
    ...(breaking ? { breaking: true } : {}),
    ...(files ? { paths: files } : {}),
  }));
}

export interface ExplicitContext {
  staged: readonly string[];
  /** Each given path, mapped to the staged files it names. */
  matched: ReadonlyMap<string, readonly string[]>;
  categories: CategoryMap;
  labelsRequired: boolean;
}

const VERIFICATION = ['test', 'storybook'];
const CAPITALISED = /^[A-Z][a-z]+([^A-Za-z]|$)/;

/** Check the commits and order them; every problem is reported in one error. */
export function planExplicit(
  commits: readonly ExplicitCommit[],
  ctx: ExplicitContext,
): { plan: CommitMessage[]; warnings: string[] } {
  const several = commits.length > 1;
  const problems: string[] = [];
  const entries: CommitMessage[] = [];
  const owner = new Map<string, number>();
  const shared = new Set<string>();

  commits.forEach((c, i) => {
    const at = i + 1;
    const found: string[] = [];
    const bad = (msg: string) => found.push(msg);

    let label: string | undefined;
    if (c.label !== undefined && c.label.trim() !== '') {
      const n = normalizeLabel(c.label);
      if (n.ok) label = n.label;
      else bad(n.error);
    } else if (ctx.labelsRequired) {
      bad('--label is required: this repository sets commitLabels');
    }
    if (!isCommitType(c.type)) bad(`type "${c.type}" is not a conventional commit type`);
    if (!isCommitScope(c.scope)) {
      bad(`scope "${c.scope}" must be one to three lowercase segments, like api or org/network`);
    }
    const d = c.description;
    if (d.trim() === '') bad('description is empty');
    else {
      if (CAPITALISED.test(d))
        bad(`description "${d}" starts with a capital letter; start lower-case`);
      if (d.endsWith('.')) bad(`description "${d}" ends with a "."`);
      if (parseConventional(d)) {
        bad(
          `description "${d}" already looks like a conventional subject; give only the description`,
        );
      }
    }

    let files: string[];
    if (c.paths && c.paths.length > 0) {
      const set = new Set<string>();
      for (const p of c.paths) {
        const hit = ctx.matched.get(p) ?? [];
        if (hit.length === 0) bad(`${p} matches no staged file`);
        for (const f of hit) set.add(f);
      }
      files = ctx.staged.filter((f) => set.has(f));
    } else if (several) {
      bad('lists no files; only a single commit may omit them');
      files = [];
    } else {
      files = [...ctx.staged];
    }
    if (files.length === 0 && found.length === 0) bad('nothing is staged to commit');

    for (const f of files) {
      const first = owner.get(f);
      if (first === undefined) owner.set(f, at);
      else if (!shared.has(`${f}\0${first}\0${at}`)) {
        shared.add(`${f}\0${first}\0${at}`);
        problems.push(`${f} is in commit ${first} and commit ${at}`);
      }
    }

    let category = UNKNOWN_CATEGORY;
    const buckets = Object.entries(categorize(files, ctx.categories)).filter(
      ([, fs]) => fs.length > 0,
    );
    if (buckets.length > 1) {
      bad(
        `spans ${buckets.length} categories, one commit per category: ${buckets
          .map(([name, fs]) => `${name} (${fs.join(', ')})`)
          .join('; ')}`,
      );
    } else if (buckets.length === 1) {
      category = buckets[0]![0];
      const verifies = VERIFICATION.includes(category);
      if (verifies && c.type !== 'test')
        bad(`a ${category} commit must have type test, not ${c.type}`);
      if (!verifies && c.type === 'test')
        bad(`type test is only for the test and storybook categories, not ${category}`);
    }

    problems.push(...found.map((m) => (several ? `commit ${at}: ${m}` : m)));
    entries.push({
      ...(label ? { label } : {}),
      category,
      message: formatConventional({
        type: c.type,
        scope: c.scope,
        breaking: Boolean(c.breaking),
        description: d,
      }),
      ...(c.body ? { body: c.body } : {}),
      files,
    });
  });

  if (problems.length > 0) throw new Error(problems.join('\n'));

  const labelOrder: Array<string | undefined> = [];
  for (const e of entries) if (!labelOrder.includes(e.label)) labelOrder.push(e.label);
  const position = [...Object.keys(ctx.categories), UNKNOWN_CATEGORY];
  const rank = (e: CommitMessage): number => {
    const last = VERIFICATION.indexOf(e.category);
    return last >= 0 ? position.length + last : position.indexOf(e.category);
  };
  const plan = entries
    .map((e, i) => ({ e, i }))
    .sort(
      (a, b) =>
        labelOrder.indexOf(a.e.label) - labelOrder.indexOf(b.e.label) ||
        rank(a.e) - rank(b.e) ||
        a.i - b.i,
    )
    .map(({ e }) => e);

  const warnings = plan.flatMap((e) => {
    const n = subjectOf(e).length;
    return n > 72 ? [`subject is ${n} characters; aim for 72 or fewer`] : [];
  });
  return { plan, warnings };
}

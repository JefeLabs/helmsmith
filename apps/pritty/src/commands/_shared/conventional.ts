import type { CommitMessage } from '../../ai.js';
import type { Config } from '../../config.js';

/** Conventional commit types, most significant first: the order a PR title picks by. */
const TYPE_RANK = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'build',
  'ci',
  'docs',
  'style',
  'test',
  'chore',
] as const;

const SUBJECT = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/s;

export interface ConventionalSubject {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

/** `fix(phone)!: x` → { type, scope, breaking, description }; null for a type outside TYPE_RANK. */
export function parseConventional(subject: string): ConventionalSubject | null {
  const m = subject.match(SUBJECT);
  if (!m || !(TYPE_RANK as readonly string[]).includes(m[1]!)) return null;
  return {
    type: m[1]!,
    ...(m[2] ? { scope: m[2] } : {}),
    breaking: m[3] === '!',
    description: m[4]!,
  };
}

const BRANCH_PREFIX: Record<string, string> = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  hotfix: 'fix',
};
for (const t of TYPE_RANK) BRANCH_PREFIX[t] ??= t;

/** The type a branch's first segment names (`fix/area--task` → `fix`, `feature/x` → `feat`), or null. */
export function branchType(branch: string): string | null {
  const m = branch.match(/^([a-z]+)\//);
  return m ? (BRANCH_PREFIX[m[1]!] ?? null) : null;
}

const STYLES_WITH_TYPES: ReadonlyArray<Config['commitStyle']> = ['conventional', 'angular'];

/** What a model writes when the diff alone hides that the change repairs something. */
const RETYPED_ON_FIX_BRANCH = new Set(['feat', 'build', 'chore']);
/** These commits add tests or stories for the fix; they keep their own type. */
const OWN_TYPE_CATEGORIES = new Set(['test', 'storybook']);

/**
 * On a `fix/…` branch the change fixes a bug, which a diff rarely says: the
 * model types a fix that adds a country `feat`, a version pin `build` or
 * `chore`. Those three become `fix` (scope, `!` and subject kept), except in
 * the test and storybook categories. docs, refactor, test and the rest are
 * left alone: a bug report or a refactor on a fix branch is still that.
 */
export function retypeForBranch(
  plan: readonly CommitMessage[],
  branch: string,
  style: Config['commitStyle'],
): { plan: CommitMessage[]; retyped: Array<{ category: string; from: string; to: string }> } {
  const retyped: Array<{ category: string; from: string; to: string }> = [];
  if (branchType(branch) !== 'fix' || !STYLES_WITH_TYPES.includes(style)) {
    return { plan: [...plan], retyped };
  }
  const out = plan.map((c) => {
    const parsed = parseConventional(c.message);
    if (!parsed || OWN_TYPE_CATEGORIES.has(c.category) || !RETYPED_ON_FIX_BRANCH.has(parsed.type)) {
      return c;
    }
    const message = `fix${c.message.slice(parsed.type.length)}`;
    retyped.push({ category: c.category, from: c.message, to: message });
    return { ...c, message };
  });
  return { plan: out, retyped };
}

/**
 * A PR title in the commits' own convention: `<type>(<scope>)<!>: <model's summary>`.
 * The type is the branch's when a commit carries it (a `fix/` branch whose
 * commits are fix + test is a fix), else the most significant type among the
 * commits. The scope is the one scope that type's commits share, else the one
 * every commit shares, else none. A prefix the model wrote is replaced. The
 * title is unchanged when no commit is conventional or the style has no types.
 */
export function conventionalPrTitle(
  title: string,
  subjects: readonly string[],
  branch: string,
  style: Config['commitStyle'],
): string {
  if (!STYLES_WITH_TYPES.includes(style)) return title;
  const commits = subjects
    .map(parseConventional)
    .filter((c): c is ConventionalSubject => c !== null);
  if (commits.length === 0) return title;

  const types = new Set(commits.map((c) => c.type));
  const fromBranch = branchType(branch);
  const type =
    fromBranch && types.has(fromBranch) ? fromBranch : TYPE_RANK.find((t) => types.has(t))!;
  const ofType = commits.filter((c) => c.type === type);
  const scope = sharedScope(ofType) ?? sharedScope(commits);
  const breaking = ofType.some((c) => c.breaking);

  const own = parseConventional(title);
  const summary = own ? own.description : title.trim();
  return `${type}${scope ? `(${scope})` : ''}${breaking ? '!' : ''}: ${lowerFirstWord(summary)}`;
}

function sharedScope(commits: readonly ConventionalSubject[]): string | undefined {
  const scopes = new Set(commits.map((c) => c.scope));
  if (scopes.size !== 1) return undefined;
  return [...scopes][0];
}

/** `Reject phone numbers` → `reject phone numbers`; `API v1`, `HeroUI` and `iOS` stay as written. */
function lowerFirstWord(text: string): string {
  return /^[A-Z][a-z]+\b/.test(text) ? `${text[0]!.toLowerCase()}${text.slice(1)}` : text;
}

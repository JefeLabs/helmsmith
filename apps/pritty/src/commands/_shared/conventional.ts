import type { CommitMessage } from '../../ai.js';
import type { Config } from '../../config.js';
import { splitLabel } from './label.js';

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
  label?: string;
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

/** `[LABEL ]fix(phone)!: x` → { label?, type, scope, breaking, description }; null for a type outside TYPE_RANK. */
export function parseConventional(subject: string): ConventionalSubject | null {
  const { label, rest } = splitLabel(subject);
  const m = rest.match(SUBJECT);
  if (!m || !(TYPE_RANK as readonly string[]).includes(m[1]!)) return null;
  return {
    ...(label ? { label } : {}),
    type: m[1]!,
    ...(m[2] ? { scope: m[2] } : {}),
    breaking: m[3] === '!',
    description: m[4]!,
  };
}

/** `{ label, type, scope, breaking, description }` → `[label ]type[(scope)][!]: description`. */
export function formatConventional(p: ConventionalSubject): string {
  return `${p.label ? `${p.label} ` : ''}${p.type}${p.scope ? `(${p.scope})` : ''}${p.breaking ? '!' : ''}: ${p.description}`;
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
    const message = formatConventional({ ...parsed, type: 'fix' });
    retyped.push({ category: c.category, from: c.message, to: message });
    return { ...c, message };
  });
  return { plan: out, retyped };
}

/** Whether `style` writes `<type>(<scope>):` subjects, so `--type` and `--scope` mean something. */
export function styleHasTypes(style: Config['commitStyle']): boolean {
  return STYLES_WITH_TYPES.includes(style);
}

/** A type `--type` accepts: one of the conventional types. */
export function isCommitType(type: string): boolean {
  return (TYPE_RANK as readonly string[]).includes(type);
}

/** One to three lowercase segments: `network`, `org/global`, `org/network/directory`. */
const SCOPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,2}$/;

/** A scope `--scope` accepts: an area-shaped path of one to three lowercase segments. */
export function isCommitScope(scope: string): boolean {
  return SCOPE.test(scope);
}

/**
 * What the caller already knows, applied over the model's subjects the way
 * `retypeForBranch` applies the branch: `type` sets the code commits' type
 * (test and storybook commits keep theirs), `scope` sets every commit's
 * scope; `!` and the subject are kept. A subject that is not conventional is
 * kept as written and its category returned in `kept`, so the caller can say
 * so rather than invent a prefix.
 */
export function applySubjectOverrides(
  plan: readonly CommitMessage[],
  o: { type?: string; scope?: string },
): { plan: CommitMessage[]; kept: string[] } {
  const kept: string[] = [];
  const out = plan.map((c) => {
    const setsType = o.type !== undefined && !OWN_TYPE_CATEGORIES.has(c.category);
    if (!setsType && o.scope === undefined) return c;
    const parsed = parseConventional(c.message);
    if (!parsed) {
      kept.push(c.category);
      return c;
    }
    const type = setsType ? o.type! : parsed.type;
    const scope = o.scope ?? parsed.scope;
    const message = formatConventional({ ...parsed, type, scope });
    return { ...c, message };
  });
  return { plan: out, kept };
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

export interface SharedLabel {
  label: string;
  tags: string[];
}

/**
 * The label every non-merge commit carries, with the tags a PR title lists:
 * each type once in TYPE_RANK order, then each scope once in the order the
 * commits used them. `commits` is newest first (git log order). Null unless
 * at least one commit remains and all parse with the same label.
 */
export function sharedLabel(
  commits: ReadonlyArray<{ subject: string; merge?: boolean }>,
): SharedLabel | null {
  const parsed: ConventionalSubject[] = [];
  for (const c of commits) {
    if (c.merge) continue;
    const p = parseConventional(c.subject);
    if (!p?.label) return null;
    parsed.push(p);
  }
  const label = parsed[0]?.label;
  if (!label || parsed.some((p) => p.label !== label)) return null;
  const types = TYPE_RANK.filter((t) => parsed.some((p) => p.type === t));
  const scopes = new Set<string>();
  for (const p of [...parsed].reverse()) if (p.scope) scopes.add(p.scope);
  return { label, tags: [...types, ...scopes] };
}

/**
 * `LABEL: summary [tag] [tag]`: the model's summary under the label every
 * commit shares. Only that label's own `LABEL:` is taken off the model's
 * title; another upper-case word (`API: …`) is part of the summary.
 */
export function labelledPrTitle(modelTitle: string, shared: SharedLabel): string {
  const trimmed = modelTitle.trim();
  const prefix = `${shared.label}:`;
  const bare = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trimStart() : trimmed;
  const own = parseConventional(bare);
  const summary = lowerFirstWord(own ? own.description : bare);
  return addSharedLabel(`${shared.label}: ${summary}`, shared);
}

/**
 * A title as written, with the label in front and any missing `[tag]` after
 * it. A title that already opens with the label (`LABEL: …`, or a labelled
 * subject `LABEL type(scope): …`) gets no second one.
 */
export function addSharedLabel(title: string, shared: SharedLabel): string {
  const labelled = title.startsWith(`${shared.label}: `) || title.startsWith(`${shared.label} `);
  let out = labelled ? title : `${shared.label}: ${title}`;
  for (const tag of shared.tags) if (!out.includes(`[${tag}]`)) out += ` [${tag}]`;
  return out;
}

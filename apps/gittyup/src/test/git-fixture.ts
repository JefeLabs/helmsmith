/**
 * Declarative temp-git-repo fixture for gittyup tests.
 *
 * `makeRepo(spec)` builds a throwaway repository from an ordered list of
 * commits, fully isolated from the developer's git config (no global
 * config, no system config, no signing, fixed author/dates). Every repo
 * is tracked so `cleanupFixtures()` removes them all; when the module is
 * loaded inside vitest it registers that cleanup as an `afterEach` hook
 * itself, so a forgotten call still cleans.
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';

export interface CommitSpec {
  /** Branch to commit on; created if missing. Default: `spec.defaultBranch`. */
  branch?: string;
  /** Branch to cut a new branch from. Default: current HEAD. */
  from?: string;
  message: string;
  /** path → content; `null` deletes the file. */
  files: Record<string, string | null>;
}

export interface RepoSpec {
  /** Default: `'main'`. */
  defaultBranch?: string;
  commits: CommitSpec[];
  /** Branch to leave checked out at the end. Default: `defaultBranch`. */
  checkout?: string;
  /** Create a bare remote named `origin` and push every branch. Default: `false`. */
  remote?: boolean;
}

export interface FixtureRepo {
  path: string;
  remotePath?: string;
  /** Pre-configured with `FIXTURE_GIT_ENV`. */
  git: SimpleGit;
  sha(ref: string): Promise<string>;
  read(file: string): Promise<string>;
  exists(file: string): Promise<boolean>;
  currentBranch(): Promise<string>;
}

/** Isolation env applied to every fixture git call; exported for e2e reuse. */
export const FIXTURE_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'gittyup-fixture',
  GIT_AUTHOR_EMAIL: 'fixture@gittyup.test',
  GIT_COMMITTER_NAME: 'gittyup-fixture',
  GIT_COMMITTER_EMAIL: 'fixture@gittyup.test',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_TERMINAL_PROMPT: '0',
};

/** Process env keys a fixture git child inherits; everything else is dropped. */
const INHERITED_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SystemRoot',
];

/**
 * Child-process env for fixture git calls: a whitelist of the current env
 * (no inherited `GIT_*`, `PAGER`, editor or credential settings), then
 * `FIXTURE_GIT_ENV`, then `extra`.
 */
export function fixtureEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of INHERITED_ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, ...FIXTURE_GIT_ENV, ...extra };
}

/**
 * simple-git bound to `baseDir` with the fixture env; config-path overrides
 * allowed (test-only). HOME and XDG_CONFIG_HOME point inside `root` so git
 * never reads the developer's `~/.config/git/{ignore,attributes}` — those
 * are default file paths, not config, and GIT_CONFIG_GLOBAL does not
 * disable them.
 */
function fixtureGit(baseDir: string, root: string): SimpleGit {
  const env = fixtureEnv({ HOME: root, XDG_CONFIG_HOME: join(root, 'xdg') });
  return simpleGit({ baseDir, unsafe: { allowUnsafeConfigPaths: true } }).env(env);
}

const created = new Set<string>();

export async function makeRepo(spec: RepoSpec): Promise<FixtureRepo> {
  const defaultBranch = spec.defaultBranch ?? 'main';
  const root = await mkdtemp(join(tmpdir(), 'gittyup-fx-'));
  created.add(root);

  const path = join(root, 'repo');
  await mkdir(path);
  const git = fixtureGit(path, root);
  await git.init(['-b', defaultBranch]);

  const known = new Set<string>();
  // After `init -b`, HEAD already points at the (unborn) default branch.
  let current = defaultBranch;

  for (const commit of spec.commits) {
    const branch = commit.branch ?? defaultBranch;
    if (branch !== current) {
      if (known.has(branch)) {
        await git.checkout(branch);
      } else {
        await git.checkout(commit.from ? ['-b', branch, commit.from] : ['-b', branch]);
      }
      current = branch;
    }

    for (const [file, content] of Object.entries(commit.files)) {
      if (content === null) {
        await git.rm([file]);
      } else {
        const full = join(path, file);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, 'utf-8');
      }
    }
    await git.add(['-A']);
    await git.commit(commit.message, undefined, { '--allow-empty': null });
    known.add(branch);
  }

  let remotePath: string | undefined;
  if (spec.remote) {
    remotePath = join(root, 'origin.git');
    await fixtureGit(root, root).init(['--bare', remotePath]);
    await git.addRemote('origin', remotePath);
    await git.push(['-q', 'origin', '--all']);
  }

  await git.checkout(spec.checkout ?? defaultBranch);

  return {
    path,
    remotePath,
    git,
    sha: async (ref) => (await git.revparse([ref])).trim(),
    read: (file) => readFile(join(path, file), 'utf-8'),
    exists: (file) =>
      access(join(path, file)).then(
        () => true,
        () => false,
      ),
    currentBranch: async () => (await git.revparse(['--abbrev-ref', 'HEAD'])).trim(),
  };
}

/** Remove every repo `makeRepo` created since the last call. */
export async function cleanupFixtures(): Promise<void> {
  const dirs = [...created];
  created.clear();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
}

// Self-register cleanup when running under vitest; harmless elsewhere.
try {
  const vitest = await import('vitest');
  vitest.afterEach(cleanupFixtures);
} catch {
  /* not under vitest */
}

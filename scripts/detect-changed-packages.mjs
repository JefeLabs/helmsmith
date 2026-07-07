#!/usr/bin/env node
/**
 * Detect which publishable workspace packages changed recently, so the
 * weekly-publish workflow can release ONLY those packages.
 *
 * How a package qualifies as "changed": any commit in the window
 * (default: last 7 days) touched a file under the package directory that
 * survives the isReleaseWorthy() filter below.
 *
 * Why packages can be "blocked": a package with `"private": false` but a
 * *runtime* dependency on a private workspace package cannot be published
 * usably — `workspace:*` is rewritten at pack time to a version that does
 * not exist on npm, so consumers get an uninstallable tarball. changesets
 * does NOT catch this; we refuse here instead.
 *
 * Modes:
 *   node scripts/detect-changed-packages.mjs                 human report
 *   node scripts/detect-changed-packages.mjs --json          machine JSON
 *   node scripts/detect-changed-packages.mjs --github-output write `changed=`
 *       and `packages=` to $GITHUB_OUTPUT (used by the workflow gate)
 *   node scripts/detect-changed-packages.mjs --write-changeset
 *       emit .changeset/weekly-<date>.md with a patch bump for each changed
 *       package not already covered by a pending human-written changeset
 *   --since "<git date>"                                     override window
 *
 * Commits whose message contains `[skip release]` are ignored entirely —
 * the escape hatch for repo-wide mechanical churn (folder restructures,
 * formatting sweeps) that would otherwise mark every package "changed"
 * and trigger a pointless publish wave the following Sunday.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const SINCE = opt('--since', '7 days ago');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

// Commit-limiting flags shared by every history query: honour the
// `[skip release]` marker (see header). --invert-grep drops matching commits.
const SKIP_MARKER = ['--grep=\\[skip release\\]', '--invert-grep'];

/**
 * Which changed files count toward "this package needs a release"?
 * Return false for churn that shouldn't trigger a publish on its own.
 * `file` is repo-relative, e.g. "platform/core/cli-kit-lib/src/index.ts".
 *
 * TODO(edwin): this is release policy — tune it. Candidates to exclude:
 *   - docs-only churn:      file.endsWith('.md')
 *   - tests:                /\.(test|spec)\.tsx?$/.test(file)
 *   - local tooling:        file.includes('/.issues/')
 * Excluding too much means a real fix ships late (next week, piggybacked
 * on other work); excluding nothing means a README typo publishes a patch.
 */
function isReleaseWorthy(file) {
  return true;
}

// ── Enumerate workspace packages ────────────────────────────────────────
// `pnpm -r list --depth -1` resolves members from pnpm-workspace.yaml +
// package.jsons; it does not need node_modules, so the workflow gate can
// run this without `pnpm install`.
const workspace = JSON.parse(
  execFileSync('pnpm', ['-r', '--json', 'list', '--depth', '-1'], { cwd: ROOT, encoding: 'utf8' }),
);
const packages = workspace.filter((p) => p.path !== ROOT);
const privateNames = new Set(packages.filter((p) => p.private).map((p) => p.name));

// ── Classify each public package ────────────────────────────────────────
const changed = [];
const blocked = [];
const unchanged = [];

for (const pkg of packages.filter((p) => !p.private)) {
  const dir = relative(ROOT, pkg.path);
  const pj = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'));

  // Runtime deps only — devDependencies never reach the published tarball.
  const privateRuntimeDeps = Object.entries({
    ...pj.dependencies,
    ...pj.optionalDependencies,
  })
    .filter(([name, range]) => String(range).startsWith('workspace:') && privateNames.has(name))
    .map(([name]) => name);

  if (privateRuntimeDeps.length > 0) {
    blocked.push({ name: pkg.name, dir, deps: privateRuntimeDeps });
    continue;
  }

  // All files touched in the window under this package's directory.
  const files = git(
    'log',
    `--since=${SINCE}`,
    ...SKIP_MARKER,
    '--name-only',
    '--format=',
    '--',
    dir,
  )
    .split('\n')
    .filter(Boolean);
  const releaseWorthy = [...new Set(files)].filter(isReleaseWorthy);

  if (releaseWorthy.length > 0) {
    const commits = Number(
      git('rev-list', '--count', `--since=${SINCE}`, ...SKIP_MARKER, 'HEAD', '--', dir),
    );
    changed.push({ name: pkg.name, dir, version: pkg.version, commits, files: releaseWorthy });
  } else {
    unchanged.push(pkg.name);
  }
}

// ── Report ──────────────────────────────────────────────────────────────
if (flag('--json')) {
  console.log(JSON.stringify({ since: SINCE, changed, blocked, unchanged }, null, 2));
} else {
  console.log(`Window: since "${SINCE}"\n`);
  for (const c of changed)
    console.log(`  CHANGED   ${c.name}  (${c.commits} commits, ${c.files.length} files)`);
  for (const b of blocked)
    console.log(`  BLOCKED   ${b.name}  — private runtime deps: ${b.deps.join(', ')}`);
  for (const u of unchanged) console.log(`  unchanged ${u}`);
  if (changed.length === 0) console.log('  (nothing to publish)');
}

if (flag('--github-output') && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length > 0}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `packages=${changed.map((c) => c.name).join(',')}\n`);
}

// ── Optionally emit an auto-changeset for the changed packages ──────────
// A human-written pending changeset for the same package wins: changesets
// merges entries and applies the highest bump, so we simply skip packages
// that are already covered to keep the release notes human-authored.
if (flag('--write-changeset') && changed.length > 0) {
  const changesetDir = join(ROOT, '.changeset');
  const pending = readdirSync(changesetDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => readFileSync(join(changesetDir, f), 'utf8'));
  const covered = (name) => pending.some((body) => body.includes(`"${name}"`));

  const toBump = changed.filter((c) => !covered(c.name));
  if (toBump.length > 0) {
    const date = new Date().toISOString().slice(0, 10);
    const file = join(changesetDir, `weekly-${date}.md`);
    const frontmatter = toBump.map((c) => `"${c.name}": patch`).join('\n');
    const summary = toBump
      .map((c) => `Weekly release: ${c.commits} commit(s) touched ${c.name} since ${SINCE}.`)
      .join('\n');
    writeFileSync(file, `---\n${frontmatter}\n---\n\n${summary}\n`);
    console.log(`\nWrote ${relative(ROOT, file)} (${toBump.length} package(s))`);
  } else {
    console.log('\nAll changed packages already covered by pending changesets.');
  }
}

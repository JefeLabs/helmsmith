import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  checkCommit,
  checkPush,
  currentOwner,
  Git,
  homeDir,
  installHooks,
  loadManifest,
  Registry,
  WorkkitError,
} from '../core/index.js';
import { fail, printJson } from './_shared/output.js';

const ZEROS = /^0+$/;

/** A hook must never break a repo that stopped using the tool: no manifest → nothing to check. */
async function hookContext(cwd: string) {
  const git = new Git(cwd);
  const repoRoot = git.mainRoot();
  try {
    const manifest = await loadManifest(repoRoot);
    return { git, repoRoot, manifest, registry: Registry.open(homeDir()) };
  } catch (err) {
    if (err instanceof WorkkitError && err.code === 'MANIFEST_NOT_FOUND') return null;
    throw err;
  }
}

export async function runPreCommit(cwd: string): Promise<number> {
  const c = await hookContext(cwd);
  if (!c) return 0;
  const root = c.git.root();
  touchByWorktree(c.registry, c.manifest, root);
  const { refusals, warnings } = checkCommit({
    m: c.manifest,
    registry: c.registry,
    git: c.git,
    project: c.manifest.project,
    branch: c.git.currentBranch(),
    stagedPaths: c.git.changedPathsStaged(),
    ownerSession: currentOwner().session,
    checkoutRoot: root,
  });
  for (const w of warnings) console.error(chalk.yellow(`work: ${w}`));
  for (const r of refusals) console.error(chalk.red(`work: ${r}`));
  return refusals.length ? 2 : 0;
}

/** stdin carries `<local ref> <local sha> <remote ref> <remote sha>` per ref being pushed. */
export async function runPrePush(cwd: string, stdin: string): Promise<number> {
  const c = await hookContext(cwd);
  if (!c) return 0;
  touchByWorktree(c.registry, c.manifest, c.git.root());
  let code = 0;
  for (const line of stdin.split('\n').filter(Boolean)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localRef || !localSha || !remoteRef) continue;
    const isDelete = ZEROS.test(localSha);
    const branch = isDelete ? '' : localRef.replace(/^refs\/heads\//, '');
    let changed: string[] = [];
    if (!isDelete) {
      const from =
        remoteSha && !ZEROS.test(remoteSha) ? remoteSha : `origin/${c.manifest.baseBranch}`;
      const range =
        remoteSha && !ZEROS.test(remoteSha) ? `${from}..${localSha}` : `${from}...${localSha}`;
      changed = c.git
        .tryRun(['diff', '--name-only', '--no-renames', range])
        .out.split('\n')
        .filter(Boolean);
    }
    const { refusals, warnings } = checkPush({
      m: c.manifest,
      registry: c.registry,
      git: c.git,
      project: c.manifest.project,
      branch,
      remoteRef,
      isDelete,
      changedPaths: changed,
    });
    for (const w of warnings) console.error(chalk.yellow(`work: ${w}`));
    for (const r of refusals) console.error(chalk.red(`work: ${r}`));
    if (refusals.length) code = 2;
  }
  return code;
}

/** A commit or push from an effort's worktree is activity on that effort. */
function touchByWorktree(
  registry: Registry,
  m: {
    project: string;
    expiry: { slotHours: number; commonsHours: number; storybookHours: number };
  },
  root: string,
): void {
  const same = (p: string) => {
    try {
      return realpathSync(p) === realpathSync(root);
    } catch {
      return false;
    }
  };
  const hours = {
    slot: m.expiry.slotHours,
    storybook: m.expiry.storybookHours,
    commons: m.expiry.commonsHours,
  };
  for (const e of registry.efforts({ project: m.project })) {
    if ((e.state !== 'active' && e.state !== 'starting') || !same(e.worktree)) continue;
    for (const l of registry.leases({ effort: e.id })) registry.touch(l.id, hours[l.kind]);
    registry.updateEffort(e.id, { lastActivity: new Date().toISOString() });
  }
}

export function registerHook(program: Command): void {
  const hook = program.command('hook').description('Entry points the installed git hooks call');
  hook
    .command('pre-commit')
    .description('Refuse commits on protected branches and writes under write-locked commons')
    .action(async () => {
      try {
        process.exit(await runPreCommit(process.cwd()));
      } catch (err) {
        fail(err, false);
      }
    });
  hook
    .command('pre-push')
    .description(
      'Refuse pushes to protected branches; warn when paths leave the effort scope or touch commons',
    )
    .argument('[remote]', 'passed by git, unused')
    .argument('[url]', 'passed by git, unused')
    .action(async () => {
      try {
        const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
        process.exit(await runPrePush(process.cwd(), stdin));
      } catch (err) {
        fail(err, false);
      }
    });

  const hooks = program.command('hooks').description('Manage the git hooks in a clone');
  hooks
    .command('install')
    .description(
      "Write .helmsmith/hooks and point this clone's core.hooksPath at them (for a repo whose manifest already exists)",
    )
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(async (o: { projectRoot?: string; json?: boolean }) => {
      try {
        const repoRoot = o.projectRoot ? resolve(o.projectRoot) : new Git(process.cwd()).mainRoot();
        const manifest = await loadManifest(repoRoot);
        const out = installHooks(repoRoot, { protectedBranches: manifest.protectedBranches });
        if (o.json) printJson(out);
        else for (const f of out.files) console.log(`installed ${f}`);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  claimRanges,
  Git,
  homeDir,
  installHooks,
  MANIFEST_FILES,
  Registry,
  validateManifest,
  WorkkitError,
} from '@helmsmith/workkit';
import type { Command } from 'commander';
import { fail, printJson } from './_shared/output.js';

export interface InitOptions {
  repoRoot: string;
  home: string;
  project: string;
  baseBranch: string;
  /** `name=port`, repeatable */
  services: string[];
  storybookHost?: string;
  worktreeRoot?: string;
  hooks: boolean;
  force: boolean;
}

const STORYBOOK_BASE = 6100;

function defaultService(name: string): Record<string, unknown> {
  const PORT = `\${PORT_${name.toUpperCase()}}`;
  if (name === 'postgres' || name === 'db') {
    return {
      start: `docker compose up -d ${name}`,
      stop: `docker compose stop ${name}`,
      health: `pg_isready -h 127.0.0.1 -p ${PORT} -q`,
      healthTimeoutMs: 120000,
    };
  }
  return {
    start: `make -C ${name} dev`,
    stop: `make -C ${name} dev-stop`,
    health: `curl -sf -o /dev/null http://127.0.0.1:${PORT}/health`,
    healthTimeoutMs: 300000,
  };
}

/** The starter manifest: real, loadable, with every project-specific line marked for editing. */
export function buildStarterManifest(o: InitOptions): Record<string, unknown> {
  const ports: Record<string, { base: number }> = {};
  const services: Record<string, unknown> = {};
  for (const spec of o.services) {
    const m = /^([a-z][a-z0-9_-]*)=(\d{4,5})$/.exec(spec);
    if (!m)
      throw new WorkkitError('MANIFEST_INVALID', `--service expects name=port, got "${spec}"`);
    ports[m[1]] = { base: Number(m[2]) };
    services[m[1]] = defaultService(m[1]);
  }
  if (o.storybookHost) ports.storybook = { base: STORYBOOK_BASE };
  const manifest: Record<string, unknown> = {
    project: o.project,
    baseBranch: o.baseBranch,
    protectedBranches: [o.baseBranch],
    worktreeRoot: o.worktreeRoot ?? '.claude/worktrees',
    branch: { types: ['feature', 'chore', 'fix'] },
    slots: { count: 10, reserved: [0] },
    ports: { services: ports },
    services,
    ...(o.storybookHost ? { storybook: { hostRoot: o.storybookHost } } : {}),
    logs: { dir: '.logs' },
    refresh: [],
    scopes: {
      frontend: [
        'app/{group}/{section}/**',
        'components/{group}/{section}/**',
        'app/api/{section}/**',
      ],
      backend: ['services/{module}/**'],
    },
    areas: {},
    commons: {},
    expiry: { slotHours: 12, commonsHours: 4, storybookHours: 2 },
    archive: { paths: [], keepDays: 30, keepPerArea: 5 },
  };
  validateManifest(manifest);
  return manifest;
}

const HEADER = `// helmsmith.config.mjs — read by \`work\` (@helmsmith/workbrokr). Written by \`work init\`.
// Edit: the services' start/stop/health commands, the scope templates, the areas (leaves only,
// each with its backend module) and the commons. Nothing here is read by the application.
`;

export function runInit(o: InitOptions): { manifestPath: string; hooks: string[] } {
  const repoRoot = resolve(o.repoRoot);
  for (const name of MANIFEST_FILES) {
    if (existsSync(join(repoRoot, name)) && !o.force) {
      throw new WorkkitError(
        'MANIFEST_INVALID',
        `${name} already exists in ${repoRoot}; pass --force to overwrite`,
      );
    }
  }
  const manifest = buildStarterManifest(o);
  const manifestPath = join(repoRoot, 'helmsmith.config.mjs');
  writeFileSync(manifestPath, `${HEADER}export default ${JSON.stringify(manifest, null, 2)};\n`);
  claimRanges(Registry.open(o.home), validateManifest(manifest), repoRoot);
  const hooks = o.hooks ? installHooks(repoRoot).files : [];
  return { manifestPath, hooks };
}

function defaultRepoRoot(): string {
  try {
    return new Git(process.cwd()).mainRoot();
  } catch {
    return process.cwd();
  }
}

function defaultBaseBranch(repoRoot: string): string {
  const g = new Git(repoRoot);
  const head = g.tryRun(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head.code === 0) return head.out.trim().replace(/^origin\//, '');
  return 'main';
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Write helmsmith.config.mjs for this repo, claim its port ranges, install the git hooks',
    )
    .requiredOption('--project <name>', 'project name (lowercase, digits, dashes)')
    .option('--base-branch <branch>', "base branch (default: origin's HEAD, else main)")
    .option(
      '--service <name=port>',
      'a service and its slot-0 port; repeat per service',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--storybook-host <dir>', 'the package whose .storybook storybrokr boots from')
    .option('--worktree-root <dir>', 'where area worktrees live (default .claude/worktrees)')
    .option('--repo-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--no-hooks', 'do not install the git hooks')
    .option('--force', 'overwrite an existing manifest')
    .option('--json', 'print the result as JSON')
    .action(
      (o: {
        project: string;
        baseBranch?: string;
        service: string[];
        storybookHost?: string;
        worktreeRoot?: string;
        repoRoot?: string;
        hooks: boolean;
        force?: boolean;
        json?: boolean;
      }) => {
        try {
          const repoRoot = o.repoRoot ? resolve(o.repoRoot) : defaultRepoRoot();
          if (o.service.length === 0)
            throw new WorkkitError(
              'MANIFEST_INVALID',
              'at least one --service name=port is required',
            );
          const out = runInit({
            repoRoot,
            home: homeDir(),
            project: o.project,
            baseBranch: o.baseBranch ?? defaultBaseBranch(repoRoot),
            services: o.service,
            storybookHost: o.storybookHost,
            worktreeRoot: o.worktreeRoot,
            hooks: o.hooks,
            force: o.force === true,
          });
          if (o.json) printJson(out);
          else {
            console.log(`wrote ${out.manifestPath}`);
            for (const h of out.hooks) console.log(`installed ${h}`);
            console.log(
              'next: edit the services and areas, commit helmsmith.config.mjs and .helmsmith/hooks, then `work start`',
            );
          }
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}

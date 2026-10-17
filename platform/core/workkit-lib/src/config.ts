import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
import { Git } from './git.js';
import type { Manifest } from './types.js';

/** Substitute `${NAME}` placeholders; an unknown name is a manifest error, never an empty string. */
export function renderTemplate(s: string, vars: Record<string, string>): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    if (!(name in vars)) {
      throw new WorkkitError(
        'MANIFEST_INVALID',
        `template references ${name}, which this effort does not define`,
      );
    }
    return vars[name];
  });
}

export interface EmitConfigArgs {
  m: Manifest;
  worktree: string;
  /** absent for a frontend effort: no .slot is written and SLOT is empty */
  slot?: number;
  ports: Record<string, number>;
  storybookPort?: number;
  area: string;
  branch: string;
}

export interface EmittedConfig {
  envFile: string;
  slotFile?: string;
  logDir: string;
  vars: Record<string, string>;
}

/** The variables a slot derives, in the shape templates and `work env` expose. */
export function slotVars(
  m: Manifest,
  o: {
    slot?: number;
    ports: Record<string, number>;
    storybookPort?: number;
    area?: string;
    branch?: string;
    worktree?: string;
    logDir?: string;
  },
): Record<string, string> {
  const vars: Record<string, string> = {
    SLOT: o.slot === undefined ? '' : String(o.slot),
    PROJECT: m.project,
    AREA: o.area ?? '',
    BRANCH: o.branch ?? '',
    WORKTREE: o.worktree ?? '',
    LOG_DIR: o.logDir ?? '',
    PORT_STORYBOOK: o.storybookPort === undefined ? '' : String(o.storybookPort),
  };
  for (const service of Object.keys(m.ports.services)) {
    const p = o.ports[service];
    vars[`PORT_${service.toUpperCase()}`] = p === undefined ? '' : String(p);
  }
  return vars;
}

/**
 * Make sure git never sees the emitted files: patterns go into the repo's shared
 * `info/exclude` (one per clone, applies to every worktree), so no .gitignore edit is needed.
 */
export function ensureExcluded(worktree: string, patterns: string[]): void {
  const r = new Git(worktree).tryRun(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (r.code !== 0) return; // not a git checkout (tests, scratch dirs): nothing to exclude from
  const common = realpathSync(r.out.trim());
  const file = join(common, 'info', 'exclude');
  mkdirSync(join(common, 'info'), { recursive: true });
  const present = new Set(
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .map((l) => l.trim())
      : [],
  );
  const missing = patterns.filter((p) => !present.has(p));
  if (missing.length === 0) return;
  appendFileSync(
    file,
    `${present.size ? '\n' : ''}# written by @helmsmith/workkit: per-worktree config and logs\n${missing.join('\n')}\n`,
  );
}

/** Write `.slot`, the env file and the log dir into the worktree; nothing is tracked by git. */
export function emitWorktreeConfig(a: EmitConfigArgs): EmittedConfig {
  ensureExcluded(a.worktree, [
    '.slot',
    a.m.env.file,
    `${a.m.logs.dir.replace(/\/+$/, '')}/`,
    `${a.m.worktreeRoot.replace(/\/+$/, '')}/`,
  ]);
  const logDir = join(a.worktree, a.m.logs.dir);
  mkdirSync(logDir, { recursive: true });
  const vars = slotVars(a.m, { ...a, logDir });
  const envFile = join(a.worktree, a.m.env.file);
  const lines = Object.entries(a.m.env.template).map(([k, v]) => `${k}=${renderTemplate(v, vars)}`);
  writeFileSync(envFile, `${lines.join('\n')}\n`);
  let slotFile: string | undefined;
  if (a.slot !== undefined) {
    slotFile = join(a.worktree, '.slot');
    writeFileSync(slotFile, `${a.slot}\n`);
  }
  return slotFile ? { envFile, slotFile, logDir, vars } : { envFile, logDir, vars };
}

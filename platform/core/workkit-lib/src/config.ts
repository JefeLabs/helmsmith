import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
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

/** Write `.slot`, the env file and the log dir into the worktree; nothing is tracked by git. */
export function emitWorktreeConfig(a: EmitConfigArgs): EmittedConfig {
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

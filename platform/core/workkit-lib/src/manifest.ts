import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WorkkitError } from './errors.js';
import type { Manifest } from './types.js';

export const MANIFEST_FILES = [
  'helmsmith.config.ts',
  'helmsmith.config.mjs',
  'helmsmith.config.json',
] as const;

const Service = z.object({
  start: z.string().min(1),
  stop: z.string().min(1),
  health: z.string().min(1),
  healthyCodes: z.array(z.number().int()).optional(),
  reset: z.string().optional(),
  healthTimeoutMs: z.number().int().positive().optional(),
});

const Schema = z.object({
  project: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  baseBranch: z.string().min(1),
  protectedBranches: z.array(z.string()).optional(),
  worktreeRoot: z.string().default('.claude/worktrees'),
  branch: z
    .object({ types: z.array(z.string().regex(/^[a-z]+$/)).min(1) })
    .default({ types: ['feature', 'chore', 'fix'] }),
  slots: z
    .object({
      count: z.number().int().min(1).max(100),
      reserved: z.array(z.number().int().min(0)),
    })
    .default({ count: 10, reserved: [0] }),
  ports: z.object({
    services: z.record(z.string(), z.object({ base: z.number().int().min(1024).max(65535) })),
  }),
  services: z.record(z.string(), Service),
  storybook: z.object({ hostRoot: z.string() }).optional(),
  logs: z.object({ dir: z.string() }).default({ dir: '.logs' }),
  env: z.object({ file: z.string(), template: z.record(z.string(), z.string()) }).optional(),
  refresh: z
    .array(
      z.object({
        when: z.string().optional(),
        always: z.boolean().optional(),
        run: z.string().optional(),
        mark: z.string().optional(),
      }),
    )
    .default([]),
  scopes: z.object({ frontend: z.array(z.string()), backend: z.array(z.string()) }),
  areas: z.record(
    z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/),
    z.object({
      module: z.string().optional(),
      commons: z.array(z.string()).optional(),
      extraScopes: z.array(z.string()).optional(),
    }),
  ),
  commons: z.record(z.string(), z.array(z.string())).default({}),
  expiry: z
    .object({
      slotHours: z.number().positive(),
      commonsHours: z.number().positive(),
      storybookHours: z.number().positive(),
    })
    .default({ slotHours: 12, commonsHours: 4, storybookHours: 2 }),
  archive: z
    .object({
      paths: z.array(z.string()),
      keepDays: z.number().int().positive(),
      keepPerArea: z.number().int().positive(),
    })
    .default({ paths: [], keepDays: 30, keepPerArea: 5 }),
});

/** Variables the env template may reference. */
export function templateVariables(m: {
  ports: { services: Record<string, unknown> };
}): Set<string> {
  const vars = new Set([
    'SLOT',
    'LOG_DIR',
    'PROJECT',
    'AREA',
    'BRANCH',
    'WORKTREE',
    'PORT_STORYBOOK',
  ]);
  for (const s of Object.keys(m.ports.services)) vars.add(`PORT_${s.toUpperCase()}`);
  return vars;
}

function defaultEnv(services: string[]): Manifest['env'] {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: these ARE the manifest's template placeholders
  const template: Record<string, string> = { SLOT: '${SLOT}', LOG_DIR: '${LOG_DIR}' };
  for (const s of services) template[`PORT_${s.toUpperCase()}`] = `\${PORT_${s.toUpperCase()}}`;
  return { file: '.env.slot', template };
}

export function validateManifest(raw: unknown): Manifest {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkkitError(
      'MANIFEST_INVALID',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const m = parsed.data;
  const problems: string[] = [];
  const areas = Object.keys(m.areas).sort();
  for (const a of areas) {
    for (const b of areas) {
      if (a !== b && b.startsWith(`${a}/`)) {
        problems.push(`area "${a}" is an ancestor of "${b}": areas must be leaves`);
      }
    }
  }
  for (const s of Object.keys(m.services)) {
    if (!m.ports.services[s]) problems.push(`service "${s}" has no port base under ports.services`);
  }
  for (const s of Object.keys(m.ports.services)) {
    if (!m.services[s] && s !== 'storybook') problems.push(`port "${s}" names no service`);
  }
  for (const r of m.slots.reserved) {
    if (r >= m.slots.count) problems.push(`reserved slot ${r} is outside 0..${m.slots.count - 1}`);
  }
  const env = m.env ?? defaultEnv(Object.keys(m.ports.services));
  const allowed = templateVariables(m);
  for (const [k, v] of Object.entries(env.template)) {
    for (const [, name] of v.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      if (!allowed.has(name)) {
        problems.push(
          `env.template.${k} references ${name}, which no slot derives (allowed: ${[...allowed].join(', ')})`,
        );
      }
    }
  }
  for (const [area, spec] of Object.entries(m.areas)) {
    for (const c of spec.commons ?? []) {
      if (!m.commons[c])
        problems.push(`area "${area}" names commons "${c}", which is not declared`);
    }
  }
  if (problems.length) throw new WorkkitError('MANIFEST_INVALID', problems.join('; '));
  return { ...m, protectedBranches: m.protectedBranches ?? [m.baseBranch], env } as Manifest;
}

export async function loadManifest(repoRoot: string): Promise<Manifest> {
  for (const name of MANIFEST_FILES) {
    const file = join(repoRoot, name);
    if (!existsSync(file)) continue;
    if (name.endsWith('.json')) return validateManifest(JSON.parse(readFileSync(file, 'utf8')));
    // Node >= 24 strips types from an imported .ts file natively; the query string defeats the
    // module cache so a re-read inside one process sees edits.
    const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
      default?: unknown;
    };
    return validateManifest(mod.default);
  }
  throw new WorkkitError(
    'MANIFEST_NOT_FOUND',
    `no ${MANIFEST_FILES.join(' | ')} in ${repoRoot}; run \`work init\``,
  );
}

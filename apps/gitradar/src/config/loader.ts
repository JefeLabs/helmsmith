import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { Document, isMap, isSeq, parseDocument, YAMLSeq } from 'yaml';
import { ZodError } from 'zod';
import { getConfigPath } from '../store/paths.js';
import { Config, ConfigSchema, type Org, OrgSchema } from '../types/schema.js';
import { writeFileAtomically } from './atomic-write.js';

/** config.yml does not exist. Callers may start from an empty config; any other load error means "do not write" (#113). */
export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Load, parse, and validate the YAML config file.
 *
 * - Default path: ~/.agentx/gitradar/config.yml
 * - Validates with ConfigSchema (Zod)
 * - A `repos:` key is ignored (repos come only from the workspace registry,
 *   `gitradar repo add` / ~/.agentx/repos.yml); warns once if present.
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const resolvedConfigPath = configPath ?? getConfigPath();

  // Read config file
  let raw: string;
  try {
    raw = await readFile(resolvedConfigPath, 'utf-8');
  } catch {
    throw new ConfigNotFoundError(`Config file not found at ${resolvedConfigPath}`);
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    throw new Error('Invalid YAML');
  }

  // Validate with Zod
  let config: Config;
  try {
    config = ConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => {
        const path = issue.path.join('.');
        return `  - '${path}': ${issue.message}`;
      });
      throw new Error(`Config validation failed:\n${details.join('\n')}`);
    }
    throw new Error('Config validation error');
  }

  // `repos:` in config.yml is a leftover from before the workspace registry
  // existed — repos now come exclusively from `gitradar repo add` (~/.agentx/repos.yml).
  // Ignore it here (never merged into the runtime repo list), warning once if present.
  if (config.repos.length > 0) {
    console.warn(
      'config.yml: "repos:" is ignored — manage repos with "gitradar repo add" (workspace registry)',
    );
  }
  config.repos = [];

  return config;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** True when the YAML node, validated as an org, equals `org` exactly. */
function sameOrg(node: unknown, org: Org): boolean {
  const parsed = OrgSchema.safeParse(
    node && typeof (node as { toJSON?: unknown }).toJSON === 'function'
      ? (node as { toJSON: () => unknown }).toJSON()
      : node,
  );
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(org);
}

/**
 * Replace the `orgs:` list in `doc` with `orgs`, keeping the YAML node (and its
 * comments) of every org whose content did not change, so an `org add` touches only
 * the new org's lines (#113).
 */
function patchOrgs(doc: Document, orgs: Org[]): void {
  const existing = doc.get('orgs', true);
  const oldItems = isSeq(existing) ? existing.items : [];
  const items = orgs.map((org, i) =>
    i < oldItems.length && sameOrg(oldItems[i], org) ? oldItems[i] : doc.createNode(org),
  );
  if (isSeq(existing)) {
    existing.items = items;
  } else {
    const seq = new YAMLSeq<unknown>(doc.schema);
    seq.items = items;
    doc.set('orgs', seq);
  }
}

/**
 * Save configuration back to a YAML file.
 *
 * Patches the existing document in place (comments and ordering survive), refuses to
 * write over a file that is not valid YAML, keeps the previous file as `<file>.bak`,
 * and writes through a temp file + rename (#113).
 */
export async function saveConfig(
  configPath: string | undefined,
  patch: Partial<Pick<Config, 'orgs' | 'settings'>>,
): Promise<void> {
  const resolvedPath = configPath ?? getConfigPath();

  let doc: Document;
  let raw: string | null = null;
  try {
    raw = await readFile(resolvedPath, 'utf-8');
  } catch {
    // File doesn't exist yet — start fresh
  }
  if (raw === null) {
    doc = new Document({});
  } else {
    doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      const first = doc.errors[0].message.split('\n')[0];
      throw new Error(`Refusing to write ${resolvedPath}: it is not valid YAML (${first})`);
    }
    if (!isMap(doc.contents)) doc = new Document({});
  }

  if (patch.orgs !== undefined) patchOrgs(doc, patch.orgs);
  if (patch.settings !== undefined) doc.set('settings', doc.createNode(patch.settings));

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFileAtomically(resolvedPath, doc.toString({ lineWidth: 120 }), {
    backup: await fileExists(resolvedPath),
  });
}

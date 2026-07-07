/**
 * Contribute orchestrator for the CLI + TUI surfaces.
 *
 * Splits the contribute flow into:
 *   - readBundle()          load file or skill directory from disk
 *   - inferSlugAndKind()    derive kind + slug from path conventions
 *   - submitInteractive()   prompt for PIN, decrypt key, POST via client
 *
 * Each piece is testable independently. The CLI subcommand wires
 * them together with stdio prompts; the TUI wires the same flow
 * through a spawned subprocess so opentui doesn't have to render
 * forms.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import matter from 'gray-matter';
import { SkillzkitApiClient } from '../api/client.js';
import type {
  ContributionFile,
  ContributionKind,
  CreateContributionRequest,
} from '../api/contracts.js';
import { readConfig } from './config.js';
import { decryptApiKey } from './crypto.js';

/* ── Reading from disk ──────────────────────────────────────── */

export interface LoadedBundle {
  /** Absolute path resolved from the user's input. */
  resolvedPath: string;
  /** True when the path is a directory (skill bundles only). */
  isDirectory: boolean;
  /** Files comprising the bundle. For commands/workflows, exactly one
   *  .md entry. For skills, SKILL.md + any companion files. */
  files: ContributionFile[];
  /** Frontmatter from the primary file (the .md or SKILL.md). */
  frontmatter: Record<string, unknown>;
  /** Body of the primary file, with frontmatter stripped. */
  primaryBody: string;
  /** Path of the primary file relative to the bundle root, e.g.
   *  "core/tools/biome.md" or "SKILL.md". */
  primaryPath: string;
}

const ALLOWED_COMPANION_EXTS = new Set([
  '.md',
  '.py',
  '.sh',
  '.ts',
  '.js',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
]);

/**
 * Read a contribution bundle from disk. The path may point at:
 *   - A single .md file (command/workflow contribution)
 *   - A directory containing SKILL.md (skill contribution)
 */
export function readBundle(inputPath: string, cwd = process.cwd()): LoadedBundle {
  const resolvedPath = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Path not found: ${resolvedPath}`);
  }
  const stat = statSync(resolvedPath);

  if (stat.isDirectory()) {
    return loadSkillBundle(resolvedPath);
  }
  if (stat.isFile()) {
    if (!resolvedPath.endsWith('.md')) {
      throw new Error(
        `Single-file contributions must be .md (command or workflow). For skills, point at the directory containing SKILL.md.`,
      );
    }
    return loadSingleFile(resolvedPath);
  }
  throw new Error(`Path is neither a regular file nor a directory: ${resolvedPath}`);
}

function loadSingleFile(filePath: string): LoadedBundle {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const primaryPath = basename(filePath);
  return {
    resolvedPath: filePath,
    isDirectory: false,
    files: [
      {
        path: primaryPath,
        content: raw,
      },
    ],
    frontmatter: parsed.data ?? {},
    primaryBody: parsed.content.trimStart(),
    primaryPath,
  };
}

function loadSkillBundle(dir: string): LoadedBundle {
  const skillMdPath = join(dir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    throw new Error(`Directory ${dir} has no SKILL.md - skill bundles require it at the root.`);
  }
  const files: ContributionFile[] = [];
  for (const entry of walkBundle(dir)) {
    files.push({
      path: entry.relPath,
      content: readFileSync(entry.absPath, 'utf8'),
    });
  }
  const skillRaw = readFileSync(skillMdPath, 'utf8');
  const parsed = matter(skillRaw);
  return {
    resolvedPath: dir,
    isDirectory: true,
    files,
    frontmatter: parsed.data ?? {},
    primaryBody: parsed.content.trimStart(),
    primaryPath: 'SKILL.md',
  };
}

interface BundleEntry {
  absPath: string;
  relPath: string;
}

function walkBundle(root: string): BundleEntry[] {
  const out: BundleEntry[] = [];
  function recurse(dir: string) {
    for (const name of readdirSync(dir)) {
      // Skip hidden files / typical noise
      if (name.startsWith('.')) continue;
      if (name === 'node_modules' || name === 'dist') continue;
      const absPath = join(dir, name);
      const stat = statSync(absPath);
      if (stat.isDirectory()) {
        recurse(absPath);
        continue;
      }
      if (!stat.isFile()) continue;
      const dotIdx = name.lastIndexOf('.');
      const ext = dotIdx === -1 ? '' : name.slice(dotIdx);
      if (!ALLOWED_COMPANION_EXTS.has(ext)) continue;
      out.push({ absPath, relPath: relative(root, absPath) });
    }
  }
  recurse(root);
  return out;
}

/* ── Slug + kind inference ─────────────────────────────────── */

export interface InferredIdentity {
  kind: ContributionKind;
  slug: string;
}

/**
 * Infer kind + slug from the path. Strategy:
 *   - Skills: bundle is a directory. Slug = directory name.
 *   - Commands/workflows: file path is a single .md. We look for the
 *     `.claude/commands/` (or trailing `commands/`) segment in the path
 *     and derive the slug from what follows. Within that, paths
 *     containing a `workflows/` segment are kind=workflow.
 *
 * If the heuristic can't infer, returns null and the caller must
 * accept --slug / --kind from the user explicitly.
 */
export function inferSlugAndKind(bundle: LoadedBundle): InferredIdentity | null {
  if (bundle.isDirectory) {
    return {
      kind: 'skill',
      slug: basename(bundle.resolvedPath),
    };
  }
  // Single .md - look for the commands/ root
  const segments = bundle.resolvedPath.split(sep);
  const commandsIdx = segments.lastIndexOf('commands');
  if (commandsIdx === -1) return null;
  const after = segments.slice(commandsIdx + 1);
  if (after.length === 0) return null;

  // Drop the .md extension on the last segment
  const last = after[after.length - 1];
  if (!last.endsWith('.md')) return null;
  after[after.length - 1] = last.slice(0, -3);

  const slug = after.join(':');
  const kind: ContributionKind = after.includes('workflows') ? 'workflow' : 'command';
  return { kind, slug };
}

/* ── Submit via API ────────────────────────────────────────── */

export interface SubmitArgs {
  bundle: LoadedBundle;
  identity: InferredIdentity;
  /** Plaintext API key (already decrypted). */
  apiKey: string;
  /** Base URL of the API. */
  apiUrl: string;
  /** Optional bump hint - patch by default. */
  versionBump?: 'major' | 'minor' | 'patch';
  /** Optional changelog message. */
  changelog?: string;
}

/**
 * Submit a loaded bundle to the API. Returns the server's
 * ContributionResponse on success, or throws SkillzkitApiError on
 * any non-2xx response. Validation findings are exposed via
 * `err.details.findings` on a 422 SkillzkitApiError.
 */
export async function submitBundle(args: SubmitArgs) {
  const client = new SkillzkitApiClient({
    baseUrl: args.apiUrl,
    apiKey: args.apiKey,
  });
  const req: CreateContributionRequest = {
    kind: args.identity.kind,
    slug: args.identity.slug,
    frontmatter: args.bundle.frontmatter,
    files: args.bundle.files,
    versionBump: args.versionBump,
    changelog: args.changelog,
  };
  return await client.createContribution(req);
}

/* ── Convenience: end-to-end with PIN prompt ─────────────────── */

export interface ContributeRunArgs {
  /** Path the user provided (file or directory). */
  inputPath: string;
  /** Override kind from the inferred value (or required if path
   *  doesn't match the .claude/commands/ heuristic). */
  kindOverride?: ContributionKind;
  /** Override slug (same conditions as kindOverride). */
  slugOverride?: string;
  versionBump?: 'major' | 'minor' | 'patch';
  changelog?: string;
  /** Provider for the PIN. The CLI passes a function that calls
   *  promptHidden; tests pass a fixed string. */
  pinProvider: () => Promise<string>;
}

export interface ContributeRunResult {
  status: 'accepted';
  id: string;
  slug: string;
  kind: ContributionKind;
  version: string;
}

/**
 * One-shot contribute flow used by the CLI subcommand. Loads the
 * config, reads the bundle, infers identity, prompts for PIN,
 * decrypts the API key, submits, returns the result. Throws on any
 * step that fails - the CLI handler maps thrown errors to user-
 * friendly messages (or to SkillzkitApiError findings on 422).
 */
export async function runContribute(args: ContributeRunArgs): Promise<ContributeRunResult> {
  const config = readConfig();
  if (config.mode !== 'team') {
    throw new Error(
      `Contribute requires team mode; current config is mode=${config.mode}. Run \`skillzkit init --force --mode team\` to switch.`,
    );
  }
  const team = config.team;

  const bundle = readBundle(args.inputPath);
  const inferred = inferSlugAndKind(bundle);
  const kind = args.kindOverride ?? inferred?.kind;
  const slug = args.slugOverride ?? inferred?.slug;
  if (!kind || !slug) {
    throw new Error(
      `Could not infer kind/slug from path. Either place the file under a \`.claude/commands/\` tree, or pass --kind and --slug explicitly.`,
    );
  }

  const pin = await args.pinProvider();
  let plaintextKey: string;
  try {
    plaintextKey = decryptApiKey({
      email: config.email,
      pin,
      encrypted: team.keyEncrypted,
    });
  } catch (err) {
    throw new Error(
      `Could not decrypt API key: ${(err as Error).message}. Re-enter your PIN, or run \`skillzkit init --force\` if you've forgotten it.`,
    );
  }

  try {
    const response = await submitBundle({
      bundle,
      identity: { kind, slug },
      apiKey: plaintextKey,
      apiUrl: team.apiUrl,
      versionBump: args.versionBump,
      changelog: args.changelog,
    });
    if (!response.version) {
      throw new Error('Server returned a response without a version');
    }
    return {
      status: 'accepted',
      id: response.id,
      slug: response.slug,
      kind: response.kind,
      version: response.version,
    };
  } finally {
    // Best-effort scrubbing of the plaintext key - the JS engine
    // may keep it interned but we drop the local reference ASAP.
    plaintextKey = '';
  }
}

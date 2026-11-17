/**
 * Pritty config — Zod-validated. Phase-1 surface: just the schema +
 * a single-file loader. The full multi-source merge ladder (.pritty.json
 * → package.json → CLI flags → built-in) lands in a follow-up phase.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { searchDirs } from './repo-root.js';

// ── Per-adapter validation configs (discriminated union by `type`)
const JiraRestValidationSchema = z.object({
  type: z.literal('jira-rest'),
  baseUrl: z.string().url(),
  emailEnv: z.string().default('JIRA_EMAIL'),
  tokenEnv: z.string().default('JIRA_API_TOKEN'),
});

const JiraCliValidationSchema = z.object({
  type: z.literal('jira-cli'),
});

const LinearValidationSchema = z.object({
  type: z.literal('linear'),
  apiKeyEnv: z.string().default('LINEAR_API_KEY'),
});

export const ValidationSchema = z.discriminatedUnion('type', [
  JiraRestValidationSchema,
  JiraCliValidationSchema,
  LinearValidationSchema,
]);

export const TicketSchema = z.object({
  pattern: z.string(),
  linkTemplate: z.string().optional(),
  validate: z.boolean().default(false),
  inferFromCommits: z.boolean().default(false),
  freshWindowHours: z.number().positive().default(24),
  /**
   * Live validation against an external ticket system. When unset,
   * pritty does pattern-based detection only. When set, the
   * configured adapter resolves ticket existence (cached forever
   * until `pritty cache clear`).
   */
  validation: ValidationSchema.optional(),
  /**
   * When the live adapter says the ticket doesn't exist:
   *   true  → fast-fail (gate fires).
   *   false → warn, proceed (default — adapter outages don't block).
   */
  validateStrict: z.boolean().default(false),
});

export const ProviderSchema = z.enum(['copilot', 'anthropic', 'openai', 'claude']);

/**
 * How `pritty commit` splits the staged files. `change`: the model groups
 * each category's files into changes, one commit per change per category.
 * `category`: one commit per category.
 */
export const CommitGroupingSchema = z.enum(['change', 'category']);
export type CommitGrouping = z.infer<typeof CommitGroupingSchema>;

export const ConfigSchema = z.object({
  /** Unset means the provider's own default (see effectiveModel). */
  model: z.string().optional(),
  /** Unset means "the repository's default branch"; an explicit value is never overridden. */
  baseBranch: z.string().optional(),
  autoApprove: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  commitStyle: z.enum(['conventional', 'gitmoji', 'angular', 'simple']).default('conventional'),
  commitGrouping: CommitGroupingSchema.default('change'),
  /** Prefix each commit subject with a label (ticket, change or run label). */
  commitLabels: z.boolean().default(false),
  /**
   * Primary AI provider. `claude` (default) runs the Claude Code binary
   * on PATH headlessly, on its own login (a claude.ai subscription works;
   * no key passes through pritty). `copilot` uses the OAuth Device Flow
   * login at ~/.pritty/auth.json. `anthropic` reads the API key from
   * `anthropicKeyEnv`; `openai` from `openaiKeyEnv`.
   */
  provider: ProviderSchema.default('claude'),
  /**
   * Fallback providers tried (in order) if the primary isn't
   * configured on this machine. Default: empty (no fallback). Set
   * explicitly to opt into multi-provider behavior.
   */
  fallback: z.array(ProviderSchema).default([]),
  anthropicKeyEnv: z.string().default('ANTHROPIC_API_KEY'),
  openaiKeyEnv: z.string().default('OPENAI_API_KEY'),
  categories: z.record(z.string(), z.array(z.string())).optional(),
  ticket: TicketSchema.optional(),
  rebaseStrategy: z.enum(['interactive', 'squash', 'fixup', 'auto']).default('interactive'),
  /** Lines appended to every commit `pritty commit` makes (e.g. Co-Authored-By). */
  commitTrailers: z.array(z.string()).default([]),
  /** Paragraph appended to every PR body, idempotently. */
  prFooter: z.string().optional(),
  /** Give up on a model call after this long. */
  aiTimeoutMs: z.number().int().positive().default(60_000),
  /** Per-repository GitHub identity: the `gh` login whose token opens PRs here. */
  github: z.object({ account: z.string().optional() }).optional(),
  /** Options for the `claude` provider. */
  claude: z
    .object({
      /**
       * true (default): the child runs with `--strict-mcp-config` and an empty
       * `--mcp-config`, so no MCP server from any source loads. Set false where
       * a managed (enterprise) Claude Code policy refuses those flags: both are
       * dropped and the servers that policy allows load as usual.
       */
      strictMcpConfig: z.boolean().default(true),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_MODEL_BY_PROVIDER: Record<z.infer<typeof ProviderSchema>, string> = {
  copilot: 'claude-opus-5-5',
  anthropic: 'claude-opus-5-5',
  claude: 'claude-opus-5-5',
  openai: 'gpt-6-astra',
};

/** The model to ask `provider` for: an explicit `model` wins, else that provider's default, so switching provider never sends another vendor's model name. */
export function effectiveModel(
  config: Config,
  provider: Config['provider'] = config.provider,
): string {
  return config.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];
}

/**
 * Candidate config filenames in load priority. First match wins.
 * Yaml files are detected by extension; everything else is JSON.
 */
const CONFIG_FILES = [
  '.pritty.json',
  '.prittyrc',
  '.prittyrc.json',
  '.prittyrc.yaml',
  '.prittyrc.yml',
  'pritty.config.json',
  'pritty.config.yaml',
];

/**
 * The same config kept with the other helmsmith files of a repository
 * (`.helmsmith/`, beside workbrokr's hooks and gitradar's repos.yml).
 */
const HELMSMITH_CONFIG_FILES = [
  '.helmsmith/pritty.json',
  '.helmsmith/pritty.yaml',
  '.helmsmith/pritty.yml',
];

function firstExisting(dir: string, filenames: readonly string[]): string | undefined {
  return filenames.map((f) => join(dir, f)).find((path) => existsSync(path));
}

function readConfigFile(path: string): Config {
  const raw = readFileSync(path, 'utf8');
  const isYaml = path.endsWith('.yaml') || path.endsWith('.yml');
  const parsed = isYaml ? parseYaml(raw) : JSON.parse(raw);
  return ConfigSchema.parse(parsed ?? {});
}

/**
 * Load and validate config, searching cwd and then each parent up to the
 * repository root (nearest wins), so running from a package directory still
 * finds the repository's config. In each directory the config is
 * `.helmsmith/pritty.{json,yaml,yml}` or one of CONFIG_FILES. Both may exist
 * while a team moves to `.helmsmith/` (older pritty reads only the second),
 * but only holding the same config: files never merge, so two that differ
 * would let one silently hide the other's settings, and that throws.
 * Falls back to schema defaults when no file exists. Throws ZodError when a
 * file exists but is invalid. Keys the schema no longer knows (the old
 * preCommit / prePush / skipHooks / verbose) are dropped silently.
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  for (const dir of searchDirs(cwd)) {
    const helmsmith = firstExisting(dir, HELMSMITH_CONFIG_FILES);
    const legacy = firstExisting(dir, CONFIG_FILES);
    if (!helmsmith && !legacy) continue;
    if (!helmsmith) return readConfigFile(legacy!);

    const config = readConfigFile(helmsmith);
    if (legacy && !isDeepStrictEqual(readConfigFile(legacy), config)) {
      throw new Error(
        `Two pritty configs in ${dir} disagree: ${legacy} and ${helmsmith}. ` +
          `Keep ${helmsmith} and delete ${legacy}, or make them identical while ` +
          'someone still runs a pritty that reads only the old name.',
      );
    }
    return config;
  }
  return ConfigSchema.parse({});
}

/** Produce the starter config used by `pritty init`. */
export function defaultStarterConfig(): unknown {
  return {
    provider: 'claude',
    commitStyle: 'conventional',
  };
}

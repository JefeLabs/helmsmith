/**
 * Pritty config — Zod-validated. Phase-1 surface: just the schema +
 * a single-file loader. The full multi-source merge ladder (.pritty.json
 * → package.json → CLI flags → built-in) lands in a follow-up phase.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

// ── Per-adapter validation configs (discriminated union by `type`)
const JiraRestValidationSchema = z.object({
  type: z.literal("jira-rest"),
  baseUrl: z.string().url(),
  emailEnv: z.string().default("JIRA_EMAIL"),
  tokenEnv: z.string().default("JIRA_API_TOKEN"),
});

const JiraCliValidationSchema = z.object({
  type: z.literal("jira-cli"),
});

const LinearValidationSchema = z.object({
  type: z.literal("linear"),
  apiKeyEnv: z.string().default("LINEAR_API_KEY"),
});

export const ValidationSchema = z.discriminatedUnion("type", [
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

export const ConfigSchema = z.object({
  model: z.string().default("gpt-4o"),
  baseBranch: z.string().default("main"),
  autoApprove: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  commitStyle: z
    .enum(["conventional", "gitmoji", "angular", "simple"])
    .default("conventional"),
  preCommit: z.array(z.string()).default([]),
  prePush: z.array(z.string()).default([]),
  skipHooks: z.boolean().default(false),
  categories: z.record(z.string(), z.array(z.string())).optional(),
  ticket: TicketSchema.optional(),
  rebaseStrategy: z
    .enum(["interactive", "squash", "fixup", "auto"])
    .default("interactive"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Candidate config filenames in load priority. First match wins.
 * Yaml files are detected by extension; everything else is JSON.
 */
const CONFIG_FILES = [
  ".pritty.json",
  ".prittyrc",
  ".prittyrc.json",
  ".prittyrc.yaml",
  ".prittyrc.yml",
  "pritty.config.json",
  "pritty.config.yaml",
];

/**
 * Load and validate config from cwd. Falls back to schema defaults
 * when no file exists. Throws ZodError when a file exists but is
 * invalid.
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  for (const filename of CONFIG_FILES) {
    const path = join(cwd, filename);
    if (!existsSync(path)) continue;

    const raw = readFileSync(path, "utf8");
    const isYaml = filename.endsWith(".yaml") || filename.endsWith(".yml");
    const parsed = isYaml ? parseYaml(raw) : JSON.parse(raw);
    return ConfigSchema.parse(parsed ?? {});
  }
  return ConfigSchema.parse({});
}

/** Produce the starter config used by `pritty init`. */
export function defaultStarterConfig(): unknown {
  return {
    model: "gpt-4o",
    baseBranch: "main",
    commitStyle: "conventional",
    preCommit: ["eslint", "prettier"],
    prePush: ["test"],
  };
}

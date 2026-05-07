/**
 * Pritty config — Zod-validated. Phase-1 surface: just the schema +
 * a single-file loader. The full multi-source merge ladder (.pritty.json
 * → package.json → CLI flags → built-in) lands in a follow-up phase.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

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

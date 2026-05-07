import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ZodError } from "zod";
import { Config, ConfigSchema } from "../types/schema.js";
import { getConfigPath, expandTilde } from "../store/paths.js";

/**
 * Load, parse, and validate the YAML config file.
 *
 * - Default path: ~/.agentx/gitradar/config.yml
 * - Resolves ~ and relative repo paths against the config file directory
 * - Validates with ConfigSchema (Zod)
 * - Warns (does not crash) if a repo path doesn't exist on disk
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const resolvedConfigPath = configPath ?? getConfigPath();

  // Read config file
  let raw: string;
  try {
    raw = await readFile(resolvedConfigPath, "utf-8");
  } catch {
    throw new Error(`Config file not found at ${resolvedConfigPath}`);
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    throw new Error("Invalid YAML");
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
      throw new Error(
        `Config validation failed:\n${details.join('\n')}`,
      );
    }
    throw new Error("Config validation error");
  }

  // Resolve repo paths
  const configDir = path.dirname(resolvedConfigPath);

  for (const repo of config.repos) {
    // Expand ~ first
    let repoPath = expandTilde(repo.path);

    // Resolve relative paths against config file directory
    if (!path.isAbsolute(repoPath)) {
      repoPath = path.resolve(configDir, repoPath);
    }

    repo.path = repoPath;

    // Warn if repo path doesn't exist
    try {
      await access(repoPath);
    } catch {
      console.warn(
        `Warning: repo path does not exist: ${repoPath}`
      );
    }
  }

  return config;
}

/**
 * Save configuration back to a YAML file.
 * Loads the existing file first (to preserve comments/ordering where possible),
 * patches the provided fields, and writes it back.
 */
export async function saveConfig(
  configPath: string | undefined,
  patch: Partial<Pick<Config, 'orgs' | 'settings'>>,
): Promise<void> {
  const resolvedPath = configPath ?? getConfigPath();

  // Load existing content or start with empty object
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(resolvedPath, "utf-8");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object") {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Patch the fields
  if (patch.orgs !== undefined) existing.orgs = patch.orgs;
  if (patch.settings !== undefined) existing.settings = patch.settings;

  // Write back
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const content = yaml.dump(existing, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });
  await writeFile(resolvedPath, content, "utf-8");
}

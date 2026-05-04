import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Catalog } from "../lib/types.js";
import { getInterfaces } from "../lib/interfaces.js";
import type { ResolvedSelection } from "./state.js";

export interface InstallResult {
  installedFiles: number;
  skippedExisting: number;
  targetDir: string;
}

/**
 * Copy the selected commands plus core infrastructure plus all skills
 * from the package's bundled `.claude/` tree into the target project.
 *
 * Always installs (regardless of user selection):
 *   - All 5 skills (the routers) — tiny and bind to overall suite shape
 *   - core:audit/* (audit dispatcher + plane definitions)
 *   - core:workflows/* (workflow management state machine + indices)
 *   - Top-level _context.md and core/_context.md (orientation docs)
 *
 * Everything else is opt-in via the cascade resolver's
 * `selected ∪ locked` set.
 */
export function installSelection(
  resolved: ResolvedSelection,
  catalog: Catalog,
  packageRoot: string,
  targetDir: string,
  options: { force?: boolean } = {}
): InstallResult {
  const userPicked = new Set([...resolved.selected, ...resolved.locked]);

  // Add infrastructure that the suite always needs to function.
  const infra = catalog.commands.filter(
    (c) =>
      c.slug.startsWith("core:audit") ||
      c.slug.startsWith("core:workflows") ||
      c.slug === "_context" ||
      c.slug === "core:_context"
  );
  const all = new Set(userPicked);
  for (const cmd of infra) all.add(cmd.slug);

  const sourceCommands = join(packageRoot, ".claude", "commands");
  const sourceSkills = join(packageRoot, ".claude", "skills");
  const targetCommands = join(targetDir, ".claude", "commands");
  const targetSkills = join(targetDir, ".claude", "skills");

  let installed = 0;
  let skipped = 0;

  for (const slug of all) {
    const cmd = catalog.commands.find((c) => c.slug === slug);
    if (!cmd) continue;
    const src = join(sourceCommands, cmd.path);
    const dest = join(targetCommands, cmd.path);
    if (existsSync(dest) && !options.force) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    installed++;
  }

  // Always install all skills (routers).
  for (const skill of catalog.skills) {
    const src = join(sourceSkills, skill.path);
    const dest = join(targetSkills, skill.path);
    if (existsSync(dest) && !options.force) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    installed++;
  }

  // Write/merge runtime manifests so consumer commands can read the
  // available interfaces at execution time. We only stub the entries —
  // the user runs /core:integrations:setup or /core:tools:setup later
  // to configure credentials and pick a preferred interface.
  writeRuntimeManifests(userPicked, targetDir, options.force ?? false);

  return {
    installedFiles: installed,
    skippedExisting: skipped,
    targetDir,
  };
}

interface IntegrationManifestEntry {
  interfaces: string[];
  preferred: string | null;
  credentialsConfigured: boolean;
}

interface ToolManifestEntry {
  interfaces: string[];
  preferred: string | null;
}

interface IntegrationManifest {
  version: number;
  integrations: Record<string, IntegrationManifestEntry>;
}

interface ToolManifest {
  version: number;
  tools: Record<string, ToolManifestEntry>;
}

function writeRuntimeManifests(picked: Set<string>, targetDir: string, force: boolean): void {
  const productDir = join(targetDir, "product");
  mkdirSync(productDir, { recursive: true });

  // Integrations manifest
  const integrationsPath = join(productDir, ".pencil-integrations.json");
  const integrationsManifest: IntegrationManifest = readJsonOrDefault(integrationsPath, {
    version: 1,
    integrations: {},
  });
  for (const slug of picked) {
    if (!slug.startsWith("core:integrations:")) continue;
    const leaf = slug.slice("core:integrations:".length).split(":")[0];
    const interfaces = getInterfaces(slug);
    if (interfaces.length === 0) continue;
    if (integrationsManifest.integrations[leaf] && !force) continue;
    integrationsManifest.integrations[leaf] = {
      interfaces,
      preferred: interfaces[0], // sensible default; user can change via setup
      credentialsConfigured: false,
    };
  }
  writeFileSync(integrationsPath, JSON.stringify(integrationsManifest, null, 2) + "\n");

  // Tools manifest
  const toolsPath = join(productDir, ".pencil-tools.json");
  const toolsManifest: ToolManifest = readJsonOrDefault(toolsPath, {
    version: 1,
    tools: {},
  });
  for (const slug of picked) {
    if (!slug.startsWith("core:tools:")) continue;
    const leaf = slug.slice("core:tools:".length).split(":")[0];
    const interfaces = getInterfaces(slug);
    if (interfaces.length === 0) continue;
    if (toolsManifest.tools[leaf] && !force) continue;
    toolsManifest.tools[leaf] = {
      interfaces,
      preferred: interfaces[0],
    };
  }
  writeFileSync(toolsPath, JSON.stringify(toolsManifest, null, 2) + "\n");
}

function readJsonOrDefault<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

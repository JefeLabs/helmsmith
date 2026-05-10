/**
 * Shared install primitive — used by both `skillzkit install` (CLI) and
 * the interactive TUI installer. The single source of truth for *what
 * lands on disk* when something is installed.
 *
 * Responsibilities, in order:
 *   1. Always-install infrastructure (audit dispatcher, workflows
 *      manager, top-level _context.md, core/_context.md). Without these
 *      the suite can't function regardless of which items the user
 *      picked.
 *   2. Copy each user-selected slug to .claude/commands/<path>.
 *   3. Always copy ALL skills to .claude/skills/. Skills are tiny
 *      router bindings; bundling all of them avoids the
 *      what-skill-do-I-need decision.
 *   4. Write/merge the runtime manifests
 *      (product/.pencil-tools.json, product/.pencil-integrations.json)
 *      so consumer commands at runtime see the same interface set the
 *      user picked at install time.
 *
 * Inputs:
 *   selectedSlugs — already-resolved set of command/workflow/skill
 *                   slugs. The caller is responsible for any cascade /
 *                   transitive resolution (TUI does this in its own
 *                   resolver; CLI uses lib/resolve.ts:resolveInstallPlan).
 *                   Skill names in the set are tolerated — they're
 *                   installed via the always-copy-all-skills loop.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getInterfaces } from "./interfaces.js";
import type { Catalog } from "./types.js";

export interface InstallOptions {
  /** Overwrite existing files in the target. Off by default. */
  force?: boolean;
}

export interface InstallResult {
  /** Files newly written this run (excludes already-existing skips). */
  installedFiles: number;
  /** Files skipped because they already existed and force was not set. */
  skippedExisting: number;
  /** Of installedFiles, how many came from the always-install infra set. */
  alwaysInstalledCount: number;
  /** Target directory the install wrote into (the .claude/ parent). */
  targetDir: string;
}

export function installSlugs(
  selectedSlugs: Set<string>,
  catalog: Catalog,
  packageRoot: string,
  targetDir: string,
  options: InstallOptions = {},
): InstallResult {
  const force = options.force ?? false;
  const sourceCommands = join(packageRoot, ".claude", "commands");
  const sourceSkills = join(packageRoot, ".claude", "skills");
  const targetCommands = join(targetDir, ".claude", "commands");
  const targetSkills = join(targetDir, ".claude", "skills");

  let installedFiles = 0;
  let skippedExisting = 0;
  let alwaysInstalledCount = 0;

  // 1. Always-install infrastructure.
  const infra = catalog.commands.filter(
    (c) =>
      c.slug.startsWith("core:audit") ||
      c.slug.startsWith("core:workflows") ||
      c.slug === "_context" ||
      c.slug === "core:_context",
  );
  for (const cmd of infra) {
    const result = copyFile(
      join(sourceCommands, cmd.path),
      join(targetCommands, cmd.path),
      force,
    );
    if (result === "written") {
      installedFiles++;
      alwaysInstalledCount++;
    } else if (result === "skipped") {
      skippedExisting++;
    }
  }

  // 2. User-selected slugs (skills are tolerated and skipped here —
  // they're installed by step 3 below).
  for (const slug of selectedSlugs) {
    const cmd = catalog.commands.find((c) => c.slug === slug);
    if (!cmd) continue;
    const result = copyFile(
      join(sourceCommands, cmd.path),
      join(targetCommands, cmd.path),
      force,
    );
    if (result === "written") installedFiles++;
    else if (result === "skipped") skippedExisting++;
  }

  // 3. All skills, always.
  for (const skill of catalog.skills) {
    const result = copyFile(
      join(sourceSkills, skill.path),
      join(targetSkills, skill.path),
      force,
    );
    if (result === "written") installedFiles++;
    else if (result === "skipped") skippedExisting++;
  }

  // 4. Runtime manifests for picked tools/integrations.
  writeRuntimeManifests(selectedSlugs, targetDir, force);

  return {
    installedFiles,
    skippedExisting,
    alwaysInstalledCount,
    targetDir,
  };
}

function copyFile(
  src: string,
  dest: string,
  force: boolean,
): "written" | "skipped" | "missing" {
  if (!existsSync(src)) return "missing";
  if (existsSync(dest) && !force) return "skipped";
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return "written";
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

/**
 * Stub the runtime manifests for any picked tool/integration so consumer
 * commands at runtime can see the same interface set the user picked at
 * install. Never writes credentials — the user runs
 * /core:integrations:setup or /core:tools:setup later.
 */
function writeRuntimeManifests(
  picked: Set<string>,
  targetDir: string,
  force: boolean,
): void {
  const productDir = join(targetDir, "product");
  mkdirSync(productDir, { recursive: true });

  const integrationsPath = join(productDir, ".pencil-integrations.json");
  const integrationsManifest: IntegrationManifest = readJsonOrDefault(
    integrationsPath,
    { version: 1, integrations: {} },
  );
  for (const slug of picked) {
    if (!slug.startsWith("core:integrations:")) continue;
    const leaf = slug.slice("core:integrations:".length).split(":")[0];
    const interfaces = getInterfaces(slug);
    if (interfaces.length === 0) continue;
    if (integrationsManifest.integrations[leaf] && !force) continue;
    integrationsManifest.integrations[leaf] = {
      interfaces,
      preferred: interfaces[0],
      credentialsConfigured: false,
    };
  }
  writeFileSync(
    integrationsPath,
    JSON.stringify(integrationsManifest, null, 2) + "\n",
  );

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

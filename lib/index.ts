import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Catalog, Command, Skill, Workflow } from "./types.js";

export type { Catalog, Command, Skill, Workflow, ItemKind, Frontmatter } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find catalog.json by walking up from this file's directory.
 * Handles both the compiled layout (dist/lib/index.js → ../../catalog.json)
 * and the source layout when run via tsx (lib/index.ts → ../catalog.json).
 */
function findCatalogPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "catalog.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `catalog.json not found searching upward from ${__dirname}. ` +
      `Run \`npm run catalog\` to generate it.`
  );
}

let cached: Catalog | undefined;

export function loadCatalog(): Catalog {
  if (!cached) {
    const raw = readFileSync(findCatalogPath(), "utf8");
    cached = JSON.parse(raw) as Catalog;
  }
  return cached;
}

export function getCommands(): Command[] {
  return loadCatalog().commands;
}

export function getCommand(slug: string): Command | undefined {
  return getCommands().find((c) => c.slug === slug);
}

export function getSkills(): Skill[] {
  return loadCatalog().skills;
}

export function getSkill(name: string): Skill | undefined {
  return getSkills().find((s) => s.name === name);
}

export function getWorkflows(): Workflow[] {
  return loadCatalog().workflows;
}

export function getWorkflow(qualifiedName: string): Workflow | undefined {
  return getWorkflows().find((w) => w.qualifiedName === qualifiedName);
}

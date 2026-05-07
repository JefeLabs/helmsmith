import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveWorkflows, loadCommands, loadSkills } from "../lib/load.js";
import type { Catalog } from "../lib/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const commandsRoot = join(repoRoot, ".claude", "commands");
const skillsRoot = join(repoRoot, ".claude", "skills");
const catalogPath = join(repoRoot, "catalog.json");
const packageJsonPath = join(repoRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const commands = loadCommands(commandsRoot);
const skills = loadSkills(skillsRoot, commands);
const workflows = deriveWorkflows(commands);

const catalog: Catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  packageVersion: packageJson.version,
  commands,
  skills,
  workflows,
};

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");

const counts = {
  commands: commands.filter((c) => c.kind === "command").length,
  workflows: workflows.length,
  context: commands.filter((c) => c.kind === "context").length,
  skills: skills.length,
};

console.log(`✓ Wrote ${catalogPath}`);
console.log(`  commands: ${counts.commands}`);
console.log(`  workflows: ${counts.workflows}`);
console.log(`  context files: ${counts.context}`);
console.log(`  skills: ${counts.skills}`);

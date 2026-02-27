import { select, input } from "@inquirer/prompts";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { ReposRegistrySchema, type ReposRegistry } from "../types/schema.js";
import { loadReposRegistry } from "../config/repos-registry.js";
import { detectGitRoot } from "../config/git-root.js";
import { expandTilde } from "../store/paths.js";

/**
 * Import a portable repos.yml file into a local registry.
 * Prompts for destination, workspace, and local paths.
 */
export async function importWorkspace(filePath: string): Promise<void> {
  // 1. Read and parse the imported file
  const resolvedPath = expandTilde(filePath);
  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf-8");
  } catch {
    console.error(`File not found: ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    console.error(`Invalid YAML in ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

  let imported: ReposRegistry;
  try {
    imported = ReposRegistrySchema.parse(parsed);
  } catch {
    console.error(`Invalid repos.yml format in ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

  const workspaceNames = Object.keys(imported.workspaces);
  if (workspaceNames.length === 0) {
    console.error("Imported file contains no workspaces.");
    process.exitCode = 1;
    return;
  }

  // 2. Select which workspace to import (auto-select if only one)
  let sourceWorkspaceName: string;
  if (workspaceNames.length === 1) {
    sourceWorkspaceName = workspaceNames[0];
  } else {
    const choices = workspaceNames.map((name) => {
      const ws = imported.workspaces[name];
      return {
        name: `${name}${ws.label ? ` — ${ws.label}` : ""} (${ws.repos.length} repos)`,
        value: name,
      };
    });

    sourceWorkspaceName = await select<string>({
      message: "Which workspace to import?",
      choices,
    });
  }

  const sourceWorkspace = imported.workspaces[sourceWorkspaceName];

  // 3. Prompt for destination: global or project
  const gitRoot = await detectGitRoot();

  type DestinationValue = { type: "global"; path: string } | { type: "project"; path: string };

  let destination: DestinationValue;

  if (!gitRoot) {
    // Not in a git project — only offer global
    destination = {
      type: "global",
      path: path.join(homedir(), ".agentx", "repos.yml"),
    };
    console.log("Not inside a git project. Using global destination.");
  } else {
    const destChoices: Array<{ name: string; value: DestinationValue }> = [
      {
        name: `Global (~/.agentx/repos.yml)`,
        value: { type: "global", path: path.join(homedir(), ".agentx", "repos.yml") },
      },
      {
        name: `Project (${gitRoot}/.agentx/repos.yml)`,
        value: { type: "project", path: path.join(gitRoot, ".agentx", "repos.yml") },
      },
    ];

    destination = await select<DestinationValue>({
      message: "Import destination:",
      choices: destChoices,
    });
  }

  // 4. Load existing registry at destination (if exists)
  let existingRegistry = await loadReposRegistry(destination.path);

  if (!existingRegistry) {
    existingRegistry = { workspaces: {}, groups: {}, tags: {} };
  }

  // 5. Prompt for target workspace
  const existingWorkspaceNames = Object.keys(existingRegistry.workspaces);
  let targetWorkspaceName: string;

  if (existingWorkspaceNames.length === 0) {
    // No existing workspaces — use the source name
    targetWorkspaceName = sourceWorkspaceName;
  } else {
    const wsChoices: Array<{ name: string; value: string }> = [
      ...existingWorkspaceNames.map((name) => {
        const ws = existingRegistry!.workspaces[name];
        const label = ws.label ? ` — ${ws.label}` : "";
        return {
          name: `Merge into "${name}"${label} (${ws.repos.length} repos)`,
          value: name,
        };
      }),
      {
        name: `Create new workspace "${sourceWorkspaceName}"`,
        value: `__new__:${sourceWorkspaceName}`,
      },
    ];

    const selection = await select<string>({
      message: "Target workspace:",
      choices: wsChoices,
    });

    if (selection.startsWith("__new__:")) {
      targetWorkspaceName = selection.slice("__new__:".length);
    } else {
      targetWorkspaceName = selection;
    }
  }

  // Ensure target workspace exists in the registry
  if (!existingRegistry.workspaces[targetWorkspaceName]) {
    existingRegistry.workspaces[targetWorkspaceName] = {
      label: sourceWorkspace.label,
      repos: [],
    };
  }

  const targetWorkspace = existingRegistry.workspaces[targetWorkspaceName];

  // 6. For each repo in the imported workspace, prompt for local path
  for (const importedRepo of sourceWorkspace.repos) {
    const existingRepo = targetWorkspace.repos.find((r) => r.name === importedRepo.name);

    if (existingRepo) {
      // Existing repo: update group/tags, keep existing path
      if (importedRepo.group && importedRepo.group !== "default") {
        existingRepo.group = importedRepo.group;
      }
      if (importedRepo.tags && importedRepo.tags.length > 0) {
        const mergedTags = new Set([...existingRepo.tags, ...importedRepo.tags]);
        existingRepo.tags = [...mergedTags];
      }
      console.log(`  Existing: ${importedRepo.name} (keeping path: ${existingRepo.path ?? "none"})`);
    } else {
      // New repo: prompt for path
      const defaultPath = `~/code/${importedRepo.name}`;

      const enteredPath = await input({
        message: `Local path for "${importedRepo.name}" (empty or "skip" to skip):`,
        default: defaultPath,
      });

      const newRepo = {
        name: importedRepo.name,
        path: undefined as string | undefined,
        group: importedRepo.group,
        tags: [...importedRepo.tags],
      };

      if (enteredPath && enteredPath !== "skip") {
        newRepo.path = enteredPath;
      }

      targetWorkspace.repos.push(newRepo);
    }
  }

  // 7. Merge groups and tags without overwriting existing labels
  for (const [key, value] of Object.entries(imported.groups)) {
    if (!existingRegistry.groups[key]) {
      existingRegistry.groups[key] = value;
    }
  }

  for (const [key, value] of Object.entries(imported.tags)) {
    if (!existingRegistry.tags[key]) {
      existingRegistry.tags[key] = value;
    }
  }

  // 8. Save with atomic write
  const yamlOutput = yaml.dump(existingRegistry, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });

  const destDir = path.dirname(destination.path);
  await mkdir(destDir, { recursive: true });

  const tmpPath = destination.path + ".tmp";
  await writeFile(tmpPath, yamlOutput, "utf-8");
  await rename(tmpPath, destination.path);

  console.log(`Imported workspace "${sourceWorkspaceName}" into ${destination.path}`);
}

import { select } from "@inquirer/prompts";
import yaml from "js-yaml";
import { loadAllRegistries, getAvailableWorkspaces } from "../config/repos-registry.js";
import { detectGitRoot } from "../config/git-root.js";
import type { LoadedWorkspace } from "../config/repos-registry.js";

/**
 * Export a workspace as portable YAML to stdout.
 * Strips local paths from repos — output contains only name, group, tags.
 */
export async function exportWorkspace(): Promise<void> {
  // 1. Discover workspaces
  const gitRoot = await detectGitRoot();
  const registries = await loadAllRegistries(gitRoot ?? undefined);
  const workspaces = getAvailableWorkspaces(registries);

  if (workspaces.length === 0) {
    console.error("No workspaces found. Create ~/.agentx/repos.yml first.");
    process.exitCode = 1;
    return;
  }

  // 2. Select workspace
  let selected: LoadedWorkspace;
  if (workspaces.length === 1) {
    selected = workspaces[0];
  } else {
    // Build choices grouped by source
    const choices = workspaces.map((w) => ({
      name: `${w.name}${w.label ? ` — ${w.label}` : ""} (${w.repos.length} repos) [${w.source.type}]`,
      value: w,
    }));

    selected = await select<LoadedWorkspace>({
      message: "Select workspace to export:",
      choices,
    });
  }

  // 3. Strip paths and build portable output
  const portableRepos = selected.repos.map((r) => {
    const portable: Record<string, unknown> = { name: r.name };
    if (r.group && r.group !== "default") portable.group = r.group;
    if (r.tags && r.tags.length > 0) portable.tags = r.tags;
    return portable;
  });

  // 4. Collect groups and tags from the source registry
  const sourceRegistry = selected.source.registry;

  const output: Record<string, unknown> = {
    workspaces: {
      [selected.name]: {
        ...(selected.label ? { label: selected.label } : {}),
        repos: portableRepos,
      },
    },
  };

  // Only include non-empty groups/tags
  if (Object.keys(sourceRegistry.groups).length > 0) {
    output.groups = sourceRegistry.groups;
  }
  if (Object.keys(sourceRegistry.tags).length > 0) {
    output.tags = sourceRegistry.tags;
  }

  // 5. Output YAML to stdout
  const yamlOutput = yaml.dump(output, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });

  process.stdout.write(yamlOutput);
}

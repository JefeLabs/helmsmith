import { select, Separator } from "@inquirer/prompts";
import type { LoadedWorkspace } from "./repos-registry.js";

/**
 * Select a workspace from available options.
 * - If preselected name matches exactly one, returns it (no prompt).
 * - If only 1 workspace total, returns it automatically.
 * - If 0 workspaces, returns null.
 * - If multiple, shows interactive prompt grouped by source.
 */
export async function selectWorkspace(
  workspaces: LoadedWorkspace[],
  preselected?: string,
): Promise<LoadedWorkspace | null> {
  if (workspaces.length === 0) return null;

  // Check preselected
  if (preselected) {
    const matches = workspaces.filter((w) => w.name === preselected);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      console.error(`Workspace "${preselected}" not found.`);
      return null;
    }
    // Multiple matches (same name in global + project) -- fall through to prompt
  }

  // Auto-select if only one
  if (workspaces.length === 1) return workspaces[0];

  // Group by source type for display
  const globalWorkspaces = workspaces.filter(
    (w) => w.source.type === "global",
  );
  const projectWorkspaces = workspaces.filter(
    (w) => w.source.type === "project",
  );

  type Choice = { name: string; value: LoadedWorkspace };
  const choices: (Choice | Separator)[] = [];

  if (globalWorkspaces.length > 0) {
    choices.push(
      new Separator(`\n  Global (${globalWorkspaces[0].source.path})`),
    );
    for (const w of globalWorkspaces) {
      choices.push({
        name: `${w.name}${w.label ? ` — ${w.label}` : ""} (${w.repos.length} repos)`,
        value: w,
      });
    }
  }

  if (projectWorkspaces.length > 0) {
    choices.push(
      new Separator(`\n  Project (${projectWorkspaces[0].source.path})`),
    );
    for (const w of projectWorkspaces) {
      choices.push({
        name: `${w.name}${w.label ? ` — ${w.label}` : ""} (${w.repos.length} repos)`,
        value: w,
      });
    }
  }

  const selected = await select<LoadedWorkspace>({
    message: "Select workspace:",
    choices,
  });

  return selected;
}

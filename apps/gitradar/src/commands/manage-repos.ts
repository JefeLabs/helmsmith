import path from 'node:path';
import { homedir } from 'node:os';
import { loadAllRegistries, getAvailableWorkspaces, addReposToWorkspace, removeRepoFromWorkspace, saveReposRegistry } from '../config/repos-registry.js';
import { detectGitRoot } from '../config/git-root.js';
import { selectWorkspace } from '../config/workspace-selector.js';
import { scanDirectory } from '../collector/dir-scanner.js';
import { expandTilde } from '../store/paths.js';

export interface AddReposOptions {
  path: string;
  group?: string;
  depth?: number;
  workspace?: string;
}

export async function addRepos(options: AddReposOptions): Promise<void> {
  const gitRoot = await detectGitRoot();
  const registries = await loadAllRegistries(gitRoot ?? undefined);
  const workspaces = getAvailableWorkspaces(registries);

  if (workspaces.length === 0) {
    console.error('No workspaces found. Run "gitradar" first to create one.');
    process.exitCode = 1;
    return;
  }

  const selected = await selectWorkspace(workspaces, options.workspace);
  if (!selected) {
    console.error('No workspace selected.');
    process.exitCode = 1;
    return;
  }

  const dirPath = expandTilde(options.path);
  const depth = options.depth ?? 2;
  const group = options.group ?? 'default';

  console.log(`Scanning ${dirPath} (depth ${depth})...`);
  const discovered = await scanDirectory(dirPath, depth);

  if (discovered.length === 0) {
    console.log('No git repositories found.');
    return;
  }

  console.log(`Found ${discovered.length} repositories.`);

  const added = addReposToWorkspace(
    selected,
    discovered.map((r) => ({ name: r.name, path: r.path, group })),
  );

  if (added > 0) {
    await saveReposRegistry(selected.source.path, selected.source.registry);
    console.log(`Added ${added} new repos to workspace "${selected.name}".`);
  } else {
    console.log('All discovered repos already in workspace.');
  }
}

export interface RemoveRepoOptions {
  name: string;
  workspace?: string;
}

export async function removeRepo(options: RemoveRepoOptions): Promise<void> {
  const gitRoot = await detectGitRoot();
  const registries = await loadAllRegistries(gitRoot ?? undefined);
  const workspaces = getAvailableWorkspaces(registries);

  if (workspaces.length === 0) {
    console.error('No workspaces found.');
    process.exitCode = 1;
    return;
  }

  const selected = await selectWorkspace(workspaces, options.workspace);
  if (!selected) {
    console.error('No workspace selected.');
    process.exitCode = 1;
    return;
  }

  const ws = selected.source.registry.workspaces[selected.name];
  const exists = ws?.repos.some((r) => r.name === options.name);
  if (!exists) {
    console.error(`Repo "${options.name}" not found in workspace "${selected.name}".`);
    process.exitCode = 1;
    return;
  }

  removeRepoFromWorkspace(selected, options.name);
  await saveReposRegistry(selected.source.path, selected.source.registry);
  console.log(`Removed "${options.name}" from workspace "${selected.name}".`);
}

export interface ListReposOptions {
  workspace?: string;
  json?: boolean;
}

export async function listRepos(options: ListReposOptions = {}): Promise<void> {
  const gitRoot = await detectGitRoot();
  const registries = await loadAllRegistries(gitRoot ?? undefined);
  const workspaces = getAvailableWorkspaces(registries);

  if (workspaces.length === 0) {
    console.log('No workspaces found.');
    return;
  }

  const selected = await selectWorkspace(workspaces, options.workspace);
  if (!selected) {
    console.error('No workspace selected.');
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(selected.repos, null, 2));
    return;
  }

  console.log(`\nWorkspace: ${selected.name} (${selected.repos.length} repos)\n`);

  // Group by group
  const byGroup = new Map<string, typeof selected.repos>();
  for (const repo of selected.repos) {
    const g = repo.group ?? 'default';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(repo);
  }

  for (const [group, repos] of byGroup) {
    console.log(`  [${group}]`);
    for (const repo of repos) {
      const tags = repo.tags?.length ? ` (${repo.tags.join(', ')})` : '';
      console.log(`    ${repo.name}${tags}  ${repo.path ?? ''}`);
    }
  }
}

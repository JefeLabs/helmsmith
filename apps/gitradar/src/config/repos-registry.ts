import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { ZodError } from 'zod';
import { expandTilde } from '../store/paths.js';
import { type ReposRegistry, ReposRegistrySchema, type WorkspaceRepo } from '../types/schema.js';
import { writeFileAtomically } from './atomic-write.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RegistrySource {
  type: 'global' | 'project';
  path: string;
  registry: ReposRegistry;
}

export interface LoadedWorkspace {
  name: string;
  label?: string;
  repos: WorkspaceRepo[];
  source: RegistrySource;
}

// ── Loading ────────────────────────────────────────────────────────────────

/**
 * Load and validate a repos.yml file.
 * Returns null if file doesn't exist. Throws on invalid YAML/schema.
 */
export async function loadReposRegistry(registryPath: string): Promise<ReposRegistry | null> {
  const resolved = expandTilde(registryPath);

  try {
    await access(resolved);
  } catch {
    return null; // File doesn't exist — not an error
  }

  const raw = await readFile(resolved, 'utf-8');

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    throw new Error(`Invalid YAML in ${resolved}`);
  }

  let registry: ReposRegistry;
  try {
    registry = ReposRegistrySchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        console.error(`  - '${issue.path.join('.')}': ${issue.message}`);
      }
    }
    throw new Error(`Invalid repos.yml format in ${resolved}`);
  }

  // Resolve repo paths
  const registryDir = path.dirname(resolved);
  for (const workspace of Object.values(registry.workspaces)) {
    for (const repo of workspace.repos) {
      if (repo.path) {
        let repoPath = expandTilde(repo.path);
        if (!path.isAbsolute(repoPath)) {
          repoPath = path.resolve(registryDir, repoPath);
        }
        repo.path = repoPath;
      }
    }
  }

  return registry;
}

/**
 * Load registries from global (~/.agentx/repos.yml) and optionally project-level paths.
 *
 * A missing file is simply absent from the result. An invalid file throws: treating it
 * as missing led the engine to offer "Create one?" and overwrite a hand-curated
 * registry with an empty one (#114).
 */
export async function loadAllRegistries(gitRoot?: string): Promise<RegistrySource[]> {
  const sources: RegistrySource[] = [];

  // Global registry
  const globalPath = path.join(homedir(), '.agentx', 'repos.yml');
  const globalRegistry = await loadReposRegistry(globalPath);
  if (globalRegistry) {
    sources.push({ type: 'global', path: globalPath, registry: globalRegistry });
  }

  // Project-level registry
  if (gitRoot) {
    const projectPath = path.join(gitRoot, '.agentx', 'repos.yml');
    const projectRegistry = await loadReposRegistry(projectPath);
    if (projectRegistry) {
      sources.push({ type: 'project', path: projectPath, registry: projectRegistry });
    }
  }

  return sources;
}

/**
 * Flatten all workspaces from all registry sources.
 * Same-name workspaces from different sources are kept separate.
 */
export function getAvailableWorkspaces(registries: RegistrySource[]): LoadedWorkspace[] {
  const workspaces: LoadedWorkspace[] = [];

  for (const source of registries) {
    for (const [name, workspace] of Object.entries(source.registry.workspaces)) {
      workspaces.push({
        name,
        label: workspace.label,
        repos: workspace.repos,
        source,
      });
    }
  }

  return workspaces;
}

// ── Creating ──────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new empty workspace registry and save it to disk.
 * Returns the registry source and loaded workspace.
 * Refuses when the file already exists: this is only for a missing registry (#114).
 */
export async function createWorkspace(
  registryPath: string,
  workspaceName: string,
): Promise<{ source: RegistrySource; workspace: LoadedWorkspace }> {
  const resolved = expandTilde(registryPath);
  if (await fileExists(resolved)) {
    throw new Error(`Refusing to create a registry: ${resolved} already exists`);
  }
  const registry: ReposRegistry = {
    workspaces: {
      [workspaceName]: { repos: [] },
    },
    groups: {},
    tags: {},
  };

  await saveReposRegistry(registryPath, registry);

  const source: RegistrySource = {
    type: 'global',
    path: expandTilde(registryPath),
    registry,
  };

  const workspace: LoadedWorkspace = {
    name: workspaceName,
    repos: registry.workspaces[workspaceName].repos,
    source,
  };

  return { source, workspace };
}

// ── Saving ────────────────────────────────────────────────────────────────

/**
 * Save a repos registry back to a YAML file.
 * Creates parent directories if needed. Keeps the previous file as `<file>.bak` and
 * writes through an exclusively created temp file + rename (see `writeFileAtomically`),
 * so a crash mid-write cannot leave a truncated registry behind (#114).
 */
export async function saveReposRegistry(
  registryPath: string,
  registry: ReposRegistry,
): Promise<void> {
  const resolved = expandTilde(registryPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const content = yaml.dump(registry, {
    lineWidth: 120,
    noRefs: true,
    quoteStyle: 'double',
  });
  await writeFileAtomically(resolved, content, { backup: await fileExists(resolved) });
}

/**
 * Add discovered repos to a workspace, skipping duplicates by name.
 * Returns the count of newly added repos.
 */
export function addReposToWorkspace(
  workspace: LoadedWorkspace,
  newRepos: Array<{ name: string; path: string; group: string }>,
): number {
  const existingNames = new Set(workspace.repos.map((r) => r.name));
  let added = 0;

  for (const repo of newRepos) {
    if (existingNames.has(repo.name)) continue;
    workspace.repos.push({
      name: repo.name,
      path: repo.path,
      group: repo.group,
      tags: [],
    });
    existingNames.add(repo.name);
    added++;
  }

  // Also update the source registry so it stays in sync for saving
  const wsEntry = workspace.source.registry.workspaces[workspace.name];
  if (wsEntry) {
    wsEntry.repos = workspace.repos;
  }

  return added;
}

/**
 * Remove a repo from a workspace by name.
 * Returns true if the repo was found and removed.
 */
export function removeRepoFromWorkspace(workspace: LoadedWorkspace, repoName: string): boolean {
  const idx = workspace.repos.findIndex((r) => r.name === repoName);
  if (idx === -1) return false;

  workspace.repos.splice(idx, 1);

  // Keep source registry in sync
  const wsEntry = workspace.source.registry.workspaces[workspace.name];
  if (wsEntry) {
    wsEntry.repos = workspace.repos;
  }

  return true;
}

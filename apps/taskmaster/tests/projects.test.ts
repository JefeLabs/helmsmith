import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapHome, bootstrapRepoHome, getProjectDir } from '../src/utils/home.js';
import {
  createProject,
  getActiveProject,
  listAllProjects,
  readGlobalProjects,
  readRepoProjects,
  removeProject,
  switchProject,
} from '../src/utils/projects.js';

const TEST_DIR = join(tmpdir(), `agentx-test-projects-${Date.now()}`);

describe('projects manager (home location)', () => {
  beforeEach(async () => {
    process.env.AGENTX_HOME = TEST_DIR;
    await bootstrapHome();
  });

  afterEach(() => {
    delete process.env.AGENTX_HOME;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('returns empty registry when no projects.yaml exists', async () => {
    const registry = await readGlobalProjects();
    expect(registry.active).toBeNull();
    expect(registry.active_location).toBeNull();
    expect(registry.projects).toEqual([]);
  });

  it('creates a project and sets it as active', async () => {
    const entry = await createProject('api-backend', 'home', null, 'REST API');

    expect(entry.name).toBe('api-backend');
    expect(entry.description).toBe('REST API');

    const active = await getActiveProject();
    expect(active).toEqual({ name: 'api-backend', location: 'home' });
  });

  it('scaffolds project directory with tasks.json and config.yaml', async () => {
    await createProject('my-project', 'home', null);

    const dir = getProjectDir('my-project', 'home');
    expect(existsSync(join(dir, 'tasks.json'))).toBe(true);
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'tasks'))).toBe(true);
    expect(existsSync(join(dir, 'templates'))).toBe(true);
    expect(existsSync(join(dir, 'docs'))).toBe(true);
  });

  it('prevents duplicate project names', async () => {
    await createProject('alpha', 'home', null);
    await expect(createProject('alpha', 'home', null)).rejects.toThrow('already exists');
  });

  it('lists multiple projects via listAllProjects', async () => {
    await createProject('proj-a', 'home', null, 'Project A');
    await createProject('proj-b', 'home', null, 'Project B');

    const result = await listAllProjects();
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].name).toBe('proj-a');
    expect(result.projects[0].location).toBe('home');
    expect(result.projects[1].name).toBe('proj-b');
    expect(result.projects[1].location).toBe('home');
  });

  it('switches active project', async () => {
    await createProject('proj-a', 'home', null);
    await createProject('proj-b', 'home', null);

    expect((await getActiveProject())?.name).toBe('proj-b'); // last created is active

    await switchProject('proj-a', 'home');
    expect((await getActiveProject())?.name).toBe('proj-a');
  });

  it('throws when switching to non-existent project', async () => {
    await expect(switchProject('ghost', 'home')).rejects.toThrow('not found');
  });

  it('removes a project from registry', async () => {
    await createProject('proj-a', 'home', null);
    await createProject('proj-b', 'home', null);

    await removeProject('proj-a', 'home', null);

    const result = await listAllProjects();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('proj-b');
  });

  it('switches active to first remaining project after removing active', async () => {
    await createProject('proj-a', 'home', null);
    await createProject('proj-b', 'home', null);
    await switchProject('proj-a', 'home');

    await removeProject('proj-a', 'home', null);
    expect((await getActiveProject())?.name).toBe('proj-b');
  });

  it('sets active to null when removing the last project', async () => {
    await createProject('only-one', 'home', null);
    await removeProject('only-one', 'home', null);

    expect(await getActiveProject()).toBeNull();
  });

  it('throws when removing non-existent project', async () => {
    await expect(removeProject('ghost', 'home', null)).rejects.toThrow('not found');
  });
});

describe('projects manager (repo location)', () => {
  let repoDir: string;

  beforeEach(async () => {
    process.env.AGENTX_HOME = TEST_DIR;
    await bootstrapHome();
    repoDir = join(tmpdir(), `agentx-test-repo-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    await bootstrapRepoHome(repoDir);
  });

  afterEach(() => {
    delete process.env.AGENTX_HOME;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('creates a repo-local project', async () => {
    const entry = await createProject('repo-proj', 'repo', repoDir, 'A repo project');
    expect(entry.name).toBe('repo-proj');

    const repoRegistry = await readRepoProjects(repoDir);
    expect(repoRegistry.projects).toHaveLength(1);
    expect(repoRegistry.projects[0].name).toBe('repo-proj');

    // Should also be set as active in global registry
    const active = await getActiveProject();
    expect(active).toEqual({ name: 'repo-proj', location: 'repo' });
  });

  it('prevents duplicate names within repo registry', async () => {
    await createProject('same-name', 'repo', repoDir);
    await expect(createProject('same-name', 'repo', repoDir)).rejects.toThrow('already exists');
  });

  it('allows same name in different locations', async () => {
    await createProject('shared-name', 'home', null);
    // Should not throw — different registries
    const repoEntry = await createProject('shared-name', 'repo', repoDir);
    expect(repoEntry.name).toBe('shared-name');
  });

  it('listAllProjects merges both locations', async () => {
    await createProject('home-proj', 'home', null);
    await createProject('repo-proj', 'repo', repoDir);

    const result = await listAllProjects(repoDir);
    expect(result.projects).toHaveLength(2);

    const homeProj = result.projects.find((p) => p.name === 'home-proj');
    const repoProj = result.projects.find((p) => p.name === 'repo-proj');
    expect(homeProj?.location).toBe('home');
    expect(repoProj?.location).toBe('repo');
  });

  it('removes a repo-local project', async () => {
    await createProject('repo-proj', 'repo', repoDir);
    await removeProject('repo-proj', 'repo', repoDir);

    const repoRegistry = await readRepoProjects(repoDir);
    expect(repoRegistry.projects).toHaveLength(0);
  });

  it('switches to a repo-local project', async () => {
    await createProject('home-proj', 'home', null);
    await createProject('repo-proj', 'repo', repoDir);
    await switchProject('home-proj', 'home');

    expect((await getActiveProject())?.name).toBe('home-proj');

    await switchProject('repo-proj', 'repo', repoDir);
    const active = await getActiveProject();
    expect(active).toEqual({ name: 'repo-proj', location: 'repo' });
  });
});

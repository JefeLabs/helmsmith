import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapHome, getProjectDir } from '../src/utils/home.js';
import {
  readProjects,
  createProject,
  removeProject,
  switchProject,
  getActiveProject,
  listProjects,
} from '../src/utils/projects.js';

const TEST_DIR = join(tmpdir(), `agentx-test-projects-${Date.now()}`);

describe('projects manager', () => {
  beforeEach(async () => {
    process.env.AGENTX_USERDATA = TEST_DIR;
    await bootstrapHome();
  });

  afterEach(() => {
    delete process.env.AGENTX_USERDATA;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('returns empty registry when no projects.yaml exists', async () => {
    const registry = await readProjects();
    expect(registry.active).toBeNull();
    expect(registry.projects).toEqual([]);
  });

  it('creates a project and sets it as active', async () => {
    const entry = await createProject('api-backend', 'REST API');

    expect(entry.name).toBe('api-backend');
    expect(entry.description).toBe('REST API');

    const active = await getActiveProject();
    expect(active).toBe('api-backend');
  });

  it('scaffolds project directory with tasks.json and config.yaml', async () => {
    await createProject('my-project');

    const dir = getProjectDir('my-project');
    expect(existsSync(join(dir, 'tasks.json'))).toBe(true);
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'tasks'))).toBe(true);
    expect(existsSync(join(dir, 'templates'))).toBe(true);
    expect(existsSync(join(dir, 'docs'))).toBe(true);
  });

  it('prevents duplicate project names', async () => {
    await createProject('alpha');
    await expect(createProject('alpha')).rejects.toThrow('already exists');
  });

  it('lists multiple projects', async () => {
    await createProject('proj-a', 'Project A');
    await createProject('proj-b', 'Project B');

    const list = await listProjects();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('proj-a');
    expect(list[1].name).toBe('proj-b');
  });

  it('switches active project', async () => {
    await createProject('proj-a');
    await createProject('proj-b');

    expect(await getActiveProject()).toBe('proj-b'); // last created is active

    await switchProject('proj-a');
    expect(await getActiveProject()).toBe('proj-a');
  });

  it('throws when switching to non-existent project', async () => {
    await expect(switchProject('ghost')).rejects.toThrow('not found');
  });

  it('removes a project from registry', async () => {
    await createProject('proj-a');
    await createProject('proj-b');

    await removeProject('proj-a');

    const list = await listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('proj-b');
  });

  it('switches active to first remaining project after removing active', async () => {
    await createProject('proj-a');
    await createProject('proj-b');
    await switchProject('proj-a');

    await removeProject('proj-a');
    expect(await getActiveProject()).toBe('proj-b');
  });

  it('sets active to null when removing the last project', async () => {
    await createProject('only-one');
    await removeProject('only-one');

    expect(await getActiveProject()).toBeNull();
  });

  it('throws when removing non-existent project', async () => {
    await expect(removeProject('ghost')).rejects.toThrow('not found');
  });
});

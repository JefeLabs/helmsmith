import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapHome } from '../src/utils/home.js';
import { createProject, switchProject } from '../src/utils/projects.js';
import { resolveProject, resolveProjectOrThrow } from '../src/config/resolver.js';

const TEST_DIR = join(tmpdir(), `agentx-test-resolver-${Date.now()}`);

describe('project resolver', () => {
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

  it('returns null when no projects exist and no flag given', async () => {
    const result = await resolveProject();
    expect(result).toBeNull();
  });

  it('resolves active project from projects.yaml', async () => {
    await createProject('backend');
    await createProject('frontend');
    await switchProject('backend');

    const result = await resolveProject();
    expect(result).toBe('backend');
  });

  it('explicit --project flag overrides active', async () => {
    await createProject('backend');
    await createProject('frontend');
    await switchProject('backend');

    const result = await resolveProject('frontend');
    expect(result).toBe('frontend');
  });

  it('throws when explicit project does not exist', async () => {
    await createProject('backend');
    await expect(resolveProject('ghost')).rejects.toThrow('not found');
  });

  it('auto-detects single project', async () => {
    await createProject('only-project');
    // Clear active to test auto-detect
    const { writeProjects, readProjects } = await import('../src/utils/projects.js');
    const registry = await readProjects();
    registry.active = null;
    await writeProjects(registry);

    const result = await resolveProject();
    expect(result).toBe('only-project');
  });

  it('resolveProjectOrThrow throws with helpful message when no project', async () => {
    await expect(resolveProjectOrThrow()).rejects.toThrow('No active project');
  });

  it('resolveProjectOrThrow returns project name when active exists', async () => {
    await createProject('my-app');
    const result = await resolveProjectOrThrow();
    expect(result).toBe('my-app');
  });
});

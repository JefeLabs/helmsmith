import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapHome, bootstrapRepoHome } from '../src/utils/home.js';
import { createProject, switchProject } from '../src/utils/projects.js';
import { resolveProject, resolveProjectOrThrow } from '../src/config/resolver.js';

const TEST_DIR = join(tmpdir(), `agentx-test-resolver-${Date.now()}`);

describe('project resolver (home only)', () => {
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

  it('returns null when no projects exist and no flag given', async () => {
    const result = await resolveProject();
    expect(result).toBeNull();
  });

  it('resolves active project from projects.yaml', async () => {
    await createProject('backend', 'home', null);
    await createProject('frontend', 'home', null);
    await switchProject('backend', 'home');

    const result = await resolveProject();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('backend');
    expect(result!.location).toBe('home');
  });

  it('explicit --project flag overrides active', async () => {
    await createProject('backend', 'home', null);
    await createProject('frontend', 'home', null);
    await switchProject('backend', 'home');

    const result = await resolveProject('frontend');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('frontend');
  });

  it('throws when explicit project does not exist', async () => {
    await createProject('backend', 'home', null);
    await expect(resolveProject('ghost')).rejects.toThrow('not found');
  });

  it('auto-detects single project', async () => {
    await createProject('only-project', 'home', null);
    // Clear active to test auto-detect
    const { writeGlobalProjects, readGlobalProjects } = await import('../src/utils/projects.js');
    const registry = await readGlobalProjects();
    registry.active = null;
    registry.active_location = null;
    await writeGlobalProjects(registry);

    const result = await resolveProject();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('only-project');
    expect(result!.location).toBe('home');
  });

  it('resolveProjectOrThrow throws with helpful message when no project', async () => {
    await expect(resolveProjectOrThrow()).rejects.toThrow('No active project');
  });

  it('resolveProjectOrThrow returns ResolvedProject when active exists', async () => {
    await createProject('my-app', 'home', null);
    const result = await resolveProjectOrThrow();
    expect(result.name).toBe('my-app');
    expect(result.location).toBe('home');
    expect(result.projectDir).toContain('my-app');
    expect(result.gitRoot).toBeNull();
  });
});

describe('project resolver (with repo)', () => {
  let repoDir: string;

  beforeEach(async () => {
    process.env.AGENTX_HOME = TEST_DIR;
    await bootstrapHome();
    repoDir = join(tmpdir(), `agentx-test-repo-resolver-${Date.now()}`);
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

  it('resolves repo-local project when set as active', async () => {
    await createProject('repo-proj', 'repo', repoDir);

    const result = await resolveProject(undefined, repoDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('repo-proj');
    expect(result!.location).toBe('repo');
  });

  it('explicit --project searches repo first', async () => {
    await createProject('shared', 'home', null);
    await createProject('shared', 'repo', repoDir);

    // Without qualifier, should find repo first
    const result = await resolveProject('shared', repoDir);
    expect(result!.location).toBe('repo');
  });

  it('explicit location qualifier resolves in specified location', async () => {
    await createProject('shared', 'home', null);
    await createProject('shared', 'repo', repoDir);

    const homeResult = await resolveProject('home:shared', repoDir);
    expect(homeResult!.location).toBe('home');

    const repoResult = await resolveProject('repo:shared', repoDir);
    expect(repoResult!.location).toBe('repo');
  });

  it('auto-detects single repo project when no active', async () => {
    await createProject('repo-only', 'repo', repoDir);
    // Clear active
    const { writeGlobalProjects, readGlobalProjects } = await import('../src/utils/projects.js');
    const registry = await readGlobalProjects();
    registry.active = null;
    registry.active_location = null;
    await writeGlobalProjects(registry);

    const result = await resolveProject(undefined, repoDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('repo-only');
    expect(result!.location).toBe('repo');
  });

  it('ResolvedProject contains correct projectDir and taskmasterHome', async () => {
    await createProject('my-repo-proj', 'repo', repoDir);

    const result = await resolveProjectOrThrow(undefined, repoDir);
    expect(result.projectDir).toBe(join(repoDir, '.agentx', 'taskmaster', 'my-repo-proj'));
    expect(result.taskmasterHome).toBe(join(repoDir, '.agentx', 'taskmaster'));
    expect(result.gitRoot).toBe(repoDir);
  });
});

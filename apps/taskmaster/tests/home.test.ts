import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapHome,
  bootstrapRepoHome,
  getConfigRoot,
  getHomePath,
  getProjectDir,
  getTaskmasterHome,
  getTaskmasterHomeFor,
  homeExists,
  scaffoldProjectDir,
} from '../src/utils/home.js';

const TEST_DIR = join(tmpdir(), `agentx-test-home-${Date.now()}`);

describe('home manager', () => {
  beforeEach(() => {
    process.env.AGENTX_HOME = TEST_DIR;
  });

  afterEach(() => {
    delete process.env.AGENTX_HOME;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('respects AGENTX_HOME env var', () => {
    expect(getConfigRoot()).toBe(TEST_DIR);
  });

  it('returns taskmaster home under userdata root', () => {
    expect(getTaskmasterHome()).toBe(join(TEST_DIR, 'taskmaster'));
  });

  it('returns project directory path for home location', () => {
    expect(getProjectDir('my-app')).toBe(join(TEST_DIR, 'taskmaster', 'my-app'));
    expect(getProjectDir('my-app', 'home')).toBe(join(TEST_DIR, 'taskmaster', 'my-app'));
  });

  it('returns project directory path for repo location', () => {
    const gitRoot = '/tmp/fake-repo';
    const expected = join(gitRoot, '.agentx', 'taskmaster', 'my-app');
    expect(getProjectDir('my-app', 'repo', gitRoot)).toBe(expected);
  });

  it('throws when repo location is used without gitRoot', () => {
    expect(() => getProjectDir('my-app', 'repo')).toThrow('gitRoot is required');
    expect(() => getProjectDir('my-app', 'repo', null)).toThrow('gitRoot is required');
  });

  it('returns home path for a filename', () => {
    expect(getHomePath('defaults.yaml')).toBe(join(TEST_DIR, 'taskmaster', 'defaults.yaml'));
  });

  it('bootstrapHome creates directory and returns true on first call', async () => {
    expect(homeExists()).toBe(false);
    const created = await bootstrapHome();
    expect(created).toBe(true);
    expect(homeExists()).toBe(true);
  });

  it('bootstrapHome returns false if directory already exists', async () => {
    await bootstrapHome();
    const created = await bootstrapHome();
    expect(created).toBe(false);
  });

  it('scaffoldProjectDir creates project directory structure (home)', async () => {
    await bootstrapHome();
    await scaffoldProjectDir('test-project');

    const projectDir = getProjectDir('test-project');
    expect(existsSync(projectDir)).toBe(true);
    expect(existsSync(join(projectDir, 'tasks'))).toBe(true);
    expect(existsSync(join(projectDir, 'templates'))).toBe(true);
    expect(existsSync(join(projectDir, 'docs'))).toBe(true);
  });

  it('scaffoldProjectDir creates project directory structure (repo)', async () => {
    const fakeGitRoot = join(TEST_DIR, 'repo');
    mkdirSync(fakeGitRoot, { recursive: true });

    await scaffoldProjectDir('test-project', 'repo', fakeGitRoot);

    const projectDir = getProjectDir('test-project', 'repo', fakeGitRoot);
    expect(existsSync(projectDir)).toBe(true);
    expect(existsSync(join(projectDir, 'tasks'))).toBe(true);
    expect(existsSync(join(projectDir, 'templates'))).toBe(true);
    expect(existsSync(join(projectDir, 'docs'))).toBe(true);
  });
});

describe('getTaskmasterHomeFor', () => {
  beforeEach(() => {
    process.env.AGENTX_HOME = TEST_DIR;
  });

  afterEach(() => {
    delete process.env.AGENTX_HOME;
  });

  it('returns global home for home location', () => {
    expect(getTaskmasterHomeFor('home')).toBe(join(TEST_DIR, 'taskmaster'));
  });

  it('returns repo-local home for repo location', () => {
    const gitRoot = '/tmp/fake-repo';
    expect(getTaskmasterHomeFor('repo', gitRoot)).toBe(join(gitRoot, '.agentx', 'taskmaster'));
  });

  it('throws when repo location is used without gitRoot', () => {
    expect(() => getTaskmasterHomeFor('repo')).toThrow('gitRoot is required');
    expect(() => getTaskmasterHomeFor('repo', null)).toThrow('gitRoot is required');
  });
});

describe('bootstrapRepoHome', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `agentx-test-repo-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('creates repo-local taskmaster home and returns true', async () => {
    const created = await bootstrapRepoHome(repoDir);
    expect(created).toBe(true);
    expect(existsSync(join(repoDir, '.agentx', 'taskmaster'))).toBe(true);
  });

  it('returns false if already exists', async () => {
    await bootstrapRepoHome(repoDir);
    const created = await bootstrapRepoHome(repoDir);
    expect(created).toBe(false);
  });
});

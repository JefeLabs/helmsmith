import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getUserdataRoot,
  getTaskmasterHome,
  getProjectDir,
  getHomePath,
  bootstrapHome,
  homeExists,
  scaffoldProjectDir,
} from '../src/utils/home.js';

const TEST_DIR = join(tmpdir(), `agentx-test-home-${Date.now()}`);

describe('home manager', () => {
  beforeEach(() => {
    process.env.AGENTX_USERDATA = TEST_DIR;
  });

  afterEach(() => {
    delete process.env.AGENTX_USERDATA;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('respects AGENTX_USERDATA env var', () => {
    expect(getUserdataRoot()).toBe(TEST_DIR);
  });

  it('returns taskmaster home under userdata root', () => {
    expect(getTaskmasterHome()).toBe(join(TEST_DIR, 'taskmaster'));
  });

  it('returns project directory path', () => {
    expect(getProjectDir('my-app')).toBe(join(TEST_DIR, 'taskmaster', 'my-app'));
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

  it('scaffoldProjectDir creates project directory structure', async () => {
    await bootstrapHome();
    await scaffoldProjectDir('test-project');

    const projectDir = getProjectDir('test-project');
    expect(existsSync(projectDir)).toBe(true);
    expect(existsSync(join(projectDir, 'tasks'))).toBe(true);
    expect(existsSync(join(projectDir, 'templates'))).toBe(true);
    expect(existsSync(join(projectDir, 'docs'))).toBe(true);
  });
});

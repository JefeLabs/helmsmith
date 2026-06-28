import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempHome, createTempHome, runCli } from './helpers.js';

describe('E2E: Error scenarios', () => {
  let tempHome: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tempHome = await createTempHome();
    env = { AGENTX_HOME: tempHome };
  });

  afterEach(async () => {
    await cleanupTempHome(tempHome);
  });

  it('parse with nonexistent file returns error', async () => {
    // Init a project first
    await runCli(['init', '--name', 'err-test', '--no-interactive'], env);

    const result = await runCli(['parse', '/tmp/nonexistent-plan-file-abc123.md'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('show with invalid task ID returns error', async () => {
    await runCli(['init', '--name', 'err-test', '--no-interactive'], env);

    const result = await runCli(['show', 'T-999'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('set-status with invalid task ID returns error', async () => {
    await runCli(['init', '--name', 'err-test', '--no-interactive'], env);

    const result = await runCli(['set-status', 'T-999', 'done'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('init --no-interactive without --name returns error', async () => {
    const result = await runCli(['init', '--no-interactive'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--name is required');
  });

  it('list with no project returns error', async () => {
    // No init, so no active project
    const result = await runCli(['list'], env);
    expect(result.exitCode).toBe(1);
    // Should complain about no active project
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('remove with invalid task ID returns error', async () => {
    await runCli(['init', '--name', 'err-test', '--no-interactive'], env);

    const result = await runCli(['remove', 'T-999', '--force'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });
});

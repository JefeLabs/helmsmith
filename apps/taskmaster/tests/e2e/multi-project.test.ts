import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempHome, createTempHome, FIXTURE_PLAN_MD, runCli } from './helpers.js';

describe('E2E: Multi-project isolation', () => {
  let tempHome: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tempHome = await createTempHome();
    env = { AGENTX_HOME: tempHome };
  });

  afterEach(async () => {
    await cleanupTempHome(tempHome);
  });

  it('two projects are isolated from each other', { timeout: 15_000 }, async () => {
    // Create project A
    const initA = await runCli(['init', '--name', 'project-a', '--no-interactive'], env);
    expect(initA.exitCode).toBe(0);

    // Create project B (now active)
    const initB = await runCli(['init', '--name', 'project-b', '--no-interactive'], env);
    expect(initB.exitCode).toBe(0);

    // Parse fixture into project A via --project flag
    const parse = await runCli(['parse', FIXTURE_PLAN_MD, '--project', 'project-a'], env);
    expect(parse.exitCode).toBe(0);

    // List project A tasks -- should have tasks
    const listA = await runCli(['list', '--format', 'json', '--project', 'project-a'], env);
    expect(listA.exitCode).toBe(0);
    const tasksA = JSON.parse(listA.stdout);
    expect(tasksA.length).toBeGreaterThan(0);

    // List project B tasks -- should be empty
    const listB = await runCli(['list', '--project', 'project-b'], env);
    expect(listB.exitCode).toBe(0);
    expect(listB.stdout).toContain('No tasks found');
  });

  it('--project flag targets a non-active project', async () => {
    // Create two projects
    await runCli(['init', '--name', 'alpha', '--no-interactive'], env);
    await runCli(['init', '--name', 'beta', '--no-interactive'], env);

    // Parse into alpha (not the active project)
    const parse = await runCli(['parse', FIXTURE_PLAN_MD, '--project', 'alpha'], env);
    expect(parse.exitCode).toBe(0);

    // Score alpha (use --format json to avoid template rendering in bundled CLI)
    const score = await runCli(
      ['score', '--heuristic-only', '--format', 'json', '--project', 'alpha'],
      env,
    );
    expect(score.exitCode).toBe(0);
    expect(score.stdout).toContain('heuristic');
  });
});

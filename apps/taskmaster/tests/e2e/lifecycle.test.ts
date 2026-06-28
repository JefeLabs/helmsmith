import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempHome, createTempHome, FIXTURE_PLAN_MD, runCli } from './helpers.js';

describe('E2E: Project lifecycle', () => {
  let tempHome: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tempHome = await createTempHome();
    env = { AGENTX_HOME: tempHome };
  });

  afterEach(async () => {
    await cleanupTempHome(tempHome);
  });

  it('completes full lifecycle: init -> parse -> score -> list -> set-status -> report', {
    timeout: 15_000,
  }, async () => {
    // 1. Init project
    const init = await runCli(['init', '--name', 'e2e-project', '--no-interactive'], env);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain('created');

    // 2. Parse fixture plan
    const parse = await runCli(['parse', FIXTURE_PLAN_MD], env);
    expect(parse.exitCode).toBe(0);
    expect(parse.stdout).toContain('Parsed');

    // 3. Score with heuristic only (use --format json to avoid template rendering)
    const score = await runCli(['score', '--heuristic-only', '--format', 'json'], env);
    expect(score.exitCode).toBe(0);

    // stdout contains "Scored by: heuristic" line followed by JSON
    expect(score.stdout).toContain('heuristic');
    // Verify there is valid JSON in the output (after the "Scored by:" line)
    const jsonStart = score.stdout.indexOf('[');
    expect(jsonStart).toBeGreaterThan(-1);
    const scoreData = JSON.parse(score.stdout.slice(jsonStart));
    expect(Array.isArray(scoreData)).toBe(true);
    expect(scoreData.length).toBeGreaterThan(0);

    // 4. List tasks as JSON
    const list = await runCli(['list', '--format', 'json'], env);
    expect(list.exitCode).toBe(0);

    const tasks = JSON.parse(list.stdout);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);

    // 5. Set status on first task
    const taskId = tasks[0].id;
    const setStatus = await runCli(['set-status', taskId, 'in-progress', '--force'], env);
    expect(setStatus.exitCode).toBe(0);
    expect(setStatus.stdout).toContain(taskId);

    // 6. Generate report as JSON
    const report = await runCli(['report', '--format', 'json'], env);
    expect(report.exitCode).toBe(0);

    const reportData = JSON.parse(report.stdout);
    expect(reportData).toHaveProperty('taskCounts');
  });

  it('init requires --name in non-interactive mode', async () => {
    const result = await runCli(['init', '--no-interactive'], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--name is required');
  });

  it('score reports no tasks when project is empty', async () => {
    // Init a project but do not parse
    await runCli(['init', '--name', 'empty-project', '--no-interactive'], env);
    const score = await runCli(['score', '--heuristic-only'], env);
    expect(score.exitCode).toBe(0);
    expect(score.stdout).toContain('No tasks found');
  });
});

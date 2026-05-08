import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli, createTempHome, cleanupTempHome } from './helpers.js';

describe('E2E: CRUD commands', () => {
  let tempHome: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tempHome = await createTempHome();
    env = { AGENTX_HOME: tempHome };
    // Init a project for all CRUD tests
    await runCli(['init', '--name', 'crud-project', '--no-interactive'], env);
  });

  afterEach(async () => {
    await cleanupTempHome(tempHome);
  });

  it('add -> show -> list -> remove lifecycle', { timeout: 15_000 }, async () => {
    // Add a task
    const add = await runCli(['add', '--title', 'Integration test task', '--priority', 'high'], env);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain('Created task');

    // Extract task ID from output (e.g., "Created task 1: Integration test task")
    const idMatch = add.stdout.match(/Created task\s+(\S+):/);
    expect(idMatch).not.toBeNull();
    const taskId = idMatch![1];

    // Show the task as JSON
    const show = await runCli(['show', taskId, '--format', 'json'], env);
    expect(show.exitCode).toBe(0);
    const taskData = JSON.parse(show.stdout);
    expect(taskData.id).toBe(taskId);
    expect(taskData.title).toBe('Integration test task');
    expect(taskData.priority).toBe('high');

    // List tasks as JSON
    const list = await runCli(['list', '--format', 'json'], env);
    expect(list.exitCode).toBe(0);
    const tasks = JSON.parse(list.stdout);
    expect(tasks.some((t: { id: string }) => t.id === taskId)).toBe(true);

    // Remove the task
    const remove = await runCli(['remove', taskId, '--force'], env);
    expect(remove.exitCode).toBe(0);
    expect(remove.stdout).toContain('Removed');

    // Verify task is gone
    const listAfter = await runCli(['list'], env);
    expect(listAfter.exitCode).toBe(0);
    expect(listAfter.stdout).toContain('No tasks found');
  });

  it('add with --type and --skills', async () => {
    const add = await runCli([
      'add', '--title', 'Skilled task',
      '--type', 'task',
      '--skills', 'backend,frontend',
      '--priority', 'critical',
    ], env);
    expect(add.exitCode).toBe(0);

    // Extract ID and show
    const idMatch = add.stdout.match(/Created task\s+(\S+):/);
    const taskId = idMatch![1];

    const show = await runCli(['show', taskId, '--format', 'json'], env);
    expect(show.exitCode).toBe(0);
    const taskData = JSON.parse(show.stdout);
    expect(taskData.requiredSkills).toEqual(['backend', 'frontend']);
    expect(taskData.priority).toBe('critical');
  });

  it('add multiple tasks and list shows all', async () => {
    await runCli(['add', '--title', 'First task'], env);
    await runCli(['add', '--title', 'Second task'], env);
    await runCli(['add', '--title', 'Third task'], env);

    const list = await runCli(['list', '--format', 'json'], env);
    expect(list.exitCode).toBe(0);
    const tasks = JSON.parse(list.stdout);
    expect(tasks.length).toBe(3);
  });

  it('set-status updates task state', async () => {
    const add = await runCli(['add', '--title', 'Status test task'], env);
    const idMatch = add.stdout.match(/Created task\s+(\S+):/);
    const taskId = idMatch![1];

    // Move to in-progress
    const setStatus = await runCli(['set-status', taskId, 'in-progress', '--force'], env);
    expect(setStatus.exitCode).toBe(0);
    expect(setStatus.stdout).toContain('in-progress');

    // Verify via show
    const show = await runCli(['show', taskId, '--format', 'json'], env);
    const taskData = JSON.parse(show.stdout);
    expect(taskData.status).toBe('in-progress');
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskNode } from '../src/config/schema.js';
import { readTasks, writeTasks } from '../src/formats/tasks-store.js';

function makeTask(
  overrides: Partial<TaskNode> & { id: string; title: string; type: TaskNode['type'] },
): TaskNode {
  return {
    description: '',
    status: 'todo',
    complexity: 1,
    priority: 'medium',
    requiredSkills: [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: [],
    qaFeedback: [],
    children: [],
    metadata: {
      source: '',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

describe('tasks-store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tasks-store-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('readTasks', () => {
    it('returns empty array when tasks.json does not exist', async () => {
      const tasks = await readTasks(tmpDir);
      expect(tasks).toEqual([]);
    });

    it('reads and validates a tasks.json file', async () => {
      const data = [
        { id: 'T-1', title: 'First task', type: 'task' },
        { id: 'T-2', title: 'Second task', type: 'task' },
      ];
      const tasksPath = join(tmpDir, 'tasks.json');
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(tasksPath, JSON.stringify(data), 'utf-8');

      const tasks = await readTasks(tmpDir);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('T-1');
      expect(tasks[1].id).toBe('T-2');
      // Defaults should be applied by Zod
      expect(tasks[0].status).toBe('todo');
      expect(tasks[0].priority).toBe('medium');
    });

    it('throws on invalid tasks.json', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(
        join(tmpDir, 'tasks.json'),
        JSON.stringify([{ id: 'T-1', type: 'invalid' }]),
        'utf-8',
      );

      await expect(readTasks(tmpDir)).rejects.toThrow();
    });
  });

  describe('writeTasks', () => {
    it('atomically writes tasks.json', async () => {
      const tasks: TaskNode[] = [makeTask({ id: 'T-1', title: 'First', type: 'task' })];

      await writeTasks(tmpDir, tasks);

      const content = await readFile(join(tmpDir, 'tasks.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('T-1');
    });

    it('overwrites existing tasks.json', async () => {
      const tasks1: TaskNode[] = [makeTask({ id: 'T-1', title: 'Old', type: 'task' })];
      const tasks2: TaskNode[] = [makeTask({ id: 'T-2', title: 'New', type: 'task' })];

      await writeTasks(tmpDir, tasks1);
      await writeTasks(tmpDir, tasks2);

      const content = await readFile(join(tmpDir, 'tasks.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('T-2');
    });

    it('validates before writing (rejects invalid tasks)', async () => {
      const badTasks = [{ id: 'T-1', title: 'Bad', type: 'invalid' }] as unknown as TaskNode[];
      await expect(writeTasks(tmpDir, badTasks)).rejects.toThrow();
    });

    it('produces valid JSON with indentation', async () => {
      await writeTasks(tmpDir, [makeTask({ id: 'T-1', title: 'Pretty', type: 'task' })]);
      const content = await readFile(join(tmpDir, 'tasks.json'), 'utf-8');
      // Should be pretty-printed
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });
  });

  describe('concurrent writes', () => {
    it('handles sequential writes without corruption', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        makeTask({ id: `T-${i + 1}`, title: `Task ${i + 1}`, type: 'task' }),
      );

      // Write sequentially
      for (const task of tasks) {
        await writeTasks(tmpDir, [task]);
      }

      // Last write should win
      const final = await readTasks(tmpDir);
      expect(final).toHaveLength(1);
      expect(final[0].id).toBe('T-5');
    });
  });
});

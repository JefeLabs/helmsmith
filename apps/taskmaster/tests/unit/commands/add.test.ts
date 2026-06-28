import { describe, expect, it } from 'vitest';
import { executeAdd } from '../../../src/commands/add.js';
import type { ProjectConfig, TaskNode } from '../../../src/config/schema.js';

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: '1',
    title: 'Test task',
    description: '',
    type: 'task',
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
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    style: 'task-only',
    states: { preset: 'standard', enforce_transitions: false },
    skills: { vocabulary: ['backend', 'frontend'], auto_infer: true },
    ai: { model: 'claude-sonnet-4-20250514' },
    thresholds: { expand: 5, flag: 8 },
    ...overrides,
  };
}

describe('executeAdd', () => {
  it('creates a top-level task with correct ID from getNextId', async () => {
    const tasks = [makeTask({ id: '1' }), makeTask({ id: '2' })];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, { title: 'New task' });

    expect(result.task.id).toBe('3');
    expect(result.task.title).toBe('New task');
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[2].id).toBe('3');
  });

  it('creates a child task under parent with correct dotted ID', async () => {
    const parent = makeTask({ id: '1', children: [makeTask({ id: '1.1' })] });
    const tasks = [parent];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, {
      title: 'Child task',
      parent: '1',
    });

    expect(result.task.id).toBe('1.2');
    expect(result.task.title).toBe('Child task');
    expect(parent.children).toHaveLength(2);
    expect(parent.children[1].id).toBe('1.2');
  });

  it('throws when parent ID is not found', async () => {
    const tasks = [makeTask({ id: '1' })];
    const config = makeConfig();

    await expect(executeAdd(tasks, config, { title: 'Orphan', parent: '999' })).rejects.toThrow(
      'Parent task "999" not found.',
    );
  });

  it('uses default type from style hierarchy when not specified', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig({ style: 'task-only' });

    const result = await executeAdd(tasks, config, { title: 'Default type task' });

    expect(result.task.type).toBe('task');
  });

  it('uses agile-full hierarchy default when style is agile-full', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig({ style: 'agile-full' });

    const result = await executeAdd(tasks, config, { title: 'Epic default' });

    expect(result.task.type).toBe('epic');
  });

  it('parses skills from comma-separated string', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, {
      title: 'Skilled task',
      skills: 'backend, frontend, database',
    });

    expect(result.task.requiredSkills).toEqual(['backend', 'frontend', 'database']);
  });

  it('assigns default status from state engine', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, { title: 'Status task' });

    // 'standard' preset's first open state is 'backlog'
    expect(result.task.status).toBe('backlog');
  });

  it('sets default complexity to 1', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, { title: 'Complexity task' });

    expect(result.task.complexity).toBe(1);
  });

  it('recomputes readiness after add', async () => {
    const tasks = [
      makeTask({
        id: '1',
        dependencies: [{ taskId: '2', type: 'blocks' }],
      }),
    ];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, { title: 'Dep target', type: 'task' });

    // Task '1' depends on '2' which doesn't exist -> blocked
    // The new task has no deps -> pending
    expect(result.task.readiness).toBe('pending');
  });

  it('throws for invalid task type', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig({ style: 'task-only' });

    await expect(executeAdd(tasks, config, { title: 'Bad type', type: 'epic' })).rejects.toThrow(
      'Invalid task type "epic"',
    );
  });

  it('throws for invalid priority', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig();

    await expect(
      executeAdd(tasks, config, { title: 'Bad priority', priority: 'urgent' }),
    ).rejects.toThrow('Invalid priority "urgent"');
  });

  it('respects positional type over --type flag', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig({ style: 'agile-full' });

    const result = await executeAdd(tasks, config, {
      title: 'Positional type',
      typeArg: 'story',
      type: 'epic',
    });

    expect(result.task.type).toBe('story');
  });

  it('sets metadata fields correctly', async () => {
    const tasks: TaskNode[] = [];
    const config = makeConfig();

    const result = await executeAdd(tasks, config, { title: 'Meta task' });

    expect(result.task.metadata.source).toBe('');
    expect(result.task.metadata.autoExpanded).toBe(false);
    expect(result.task.metadata.skillsInferred).toBe(false);
    expect(result.task.metadata.createdAt).toBeDefined();
  });
});

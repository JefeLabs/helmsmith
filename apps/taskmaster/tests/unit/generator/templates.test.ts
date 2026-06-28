import { beforeEach, describe, expect, it } from 'vitest';
import { renderToMarkdown, resetEngine } from '../../../src/generator/index.js';
import { makeTask, sampleTasks } from '../../fixtures/tasks.js';

beforeEach(() => {
  resetEngine();
});

describe('task-list.hbs template', () => {
  it('renders a markdown table with all tasks', () => {
    const md = renderToMarkdown('task-list', { tasks: sampleTasks });

    expect(md).toContain('# Task List');
    expect(md).toContain('| ID | Title | Status | Complexity | Priority | Type |');

    // Check all task IDs are present
    for (const task of sampleTasks) {
      expect(md).toContain(task.id);
      expect(md).toContain(task.title);
    }
  });

  it('shows task count in footer', () => {
    const md = renderToMarkdown('task-list', { tasks: sampleTasks });
    expect(md).toContain(`**${sampleTasks.length}**`);
    expect(md).toContain('tasks');
  });

  it('renders filters when provided', () => {
    const md = renderToMarkdown('task-list', {
      tasks: sampleTasks,
      filters: { status: 'done', category: 'closed' },
    });
    expect(md).toContain('status=done');
    expect(md).toContain('category=closed');
  });

  it('renders singular "task" for count 1', () => {
    const md = renderToMarkdown('task-list', { tasks: [makeTask()] });
    expect(md).toContain('**1**');
    expect(md).toContain('task');
    expect(md).not.toContain('tasks');
  });

  it('renders empty table for empty tasks array', () => {
    const md = renderToMarkdown('task-list', { tasks: [] });
    expect(md).toContain('# Task List');
    expect(md).toContain('**0**');
    expect(md).toContain('tasks');
  });
});

describe('task-detail.hbs template', () => {
  it('renders full detail view with all sections', () => {
    const task = makeTask({
      id: 'T-5',
      title: 'Complex task',
      description: 'This is a detailed description.',
      type: 'task',
      status: 'in-progress',
      complexity: 7,
      priority: 'high',
      requiredSkills: ['backend', 'database'],
      dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      readiness: 'blocked',
      children: [
        makeTask({ id: 'T-5.1', title: 'Child 1', status: 'done', complexity: 2 }),
        makeTask({ id: 'T-5.2', title: 'Child 2', status: 'todo', complexity: 3 }),
      ],
    });

    const md = renderToMarkdown('task-detail', { task });

    // Header
    expect(md).toContain('T-5');
    expect(md).toContain('Complex task');

    // Metadata
    expect(md).toContain('task');
    expect(md).toContain('high');
    expect(md).toContain('blocked');

    // Description
    expect(md).toContain('This is a detailed description.');

    // Skills
    expect(md).toContain('backend');
    expect(md).toContain('database');

    // Dependencies
    expect(md).toContain('T-1');
    expect(md).toContain('blocks');

    // Children
    expect(md).toContain('T-5.1');
    expect(md).toContain('Child 1');
    expect(md).toContain('T-5.2');
    expect(md).toContain('Child 2');
    expect(md).toContain('Subtasks (2)');
  });

  it('omits dependency section when no dependencies', () => {
    const task = makeTask({ dependencies: [] });
    const md = renderToMarkdown('task-detail', { task });
    expect(md).not.toContain('**Dependencies:**');
  });

  it('omits subtask section when no children', () => {
    const task = makeTask({ children: [] });
    const md = renderToMarkdown('task-detail', { task });
    expect(md).not.toContain('Subtasks');
  });

  it('omits skills section when no requiredSkills', () => {
    const task = makeTask({ requiredSkills: [] });
    const md = renderToMarkdown('task-detail', { task });
    expect(md).not.toContain('**Skills:**');
  });
});

describe('complexity-report.hbs template', () => {
  it('renders summary table with band counts', () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'Easy', complexity: 2 }),
      makeTask({ id: 'T-2', title: 'Medium', complexity: 5 }),
      makeTask({ id: 'T-3', title: 'Hard', complexity: 9 }),
    ];
    const summary = { low: 1, medium: 1, high: 1, average: 5.3 };

    const md = renderToMarkdown('complexity-report', { tasks, summary });

    expect(md).toContain('# Complexity Report');
    expect(md).toContain('Low (1-3)');
    expect(md).toContain('Medium (4-6)');
    expect(md).toContain('High (7-10)');
    expect(md).toContain('5.3');
  });

  it('marks high complexity tasks for decomposition', () => {
    const tasks = [makeTask({ id: 'T-1', title: 'Hard task', complexity: 8 })];
    const summary = { low: 0, medium: 0, high: 1, average: 8 };

    const md = renderToMarkdown('complexity-report', { tasks, summary });
    expect(md).toContain('Consider decomposition');
  });

  it('marks low complexity tasks as implementation-ready', () => {
    const tasks = [makeTask({ id: 'T-1', title: 'Easy task', complexity: 2 })];
    const summary = { low: 1, medium: 0, high: 0, average: 2 };

    const md = renderToMarkdown('complexity-report', { tasks, summary });
    expect(md).toContain('Implementation-ready');
  });
});

describe('progress-report.hbs template', () => {
  it('renders progress bar and metrics table', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'in-progress' }),
      makeTask({ id: 'T-3', status: 'blocked' }),
    ];
    const progress = { total: 5, done: 2, inProgress: 1, blocked: 1, percentage: 40 };

    const md = renderToMarkdown('progress-report', { tasks, progress });

    expect(md).toContain('# Progress Report');
    expect(md).toContain('Total');
    expect(md).toContain('5');
    expect(md).toContain('Done');
    expect(md).toContain('2');
    expect(md).toContain('Blocked');
    expect(md).toContain('1');
  });
});

describe('dependency-graph.hbs template', () => {
  it('renders tasks with their dependencies', () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'Root', dependencies: [] }),
      makeTask({
        id: 'T-2',
        title: 'Depends on T-1',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    const md = renderToMarkdown('dependency-graph', { tasks });

    expect(md).toContain('# Dependency Graph');
    expect(md).toContain('T-2');
    expect(md).toContain('T-1');
    expect(md).toContain('blocks');
    // T-1 has no dependencies, so it should not have a dependency section
    expect(md).not.toContain('**T-1** (Root)');
  });

  it('renders multiple dependency types', () => {
    const tasks = [
      makeTask({
        id: 'T-4',
        title: 'Multi-dep',
        dependencies: [
          { taskId: 'T-2', type: 'blocks' },
          { taskId: 'T-3', type: 'produces' },
        ],
      }),
    ];

    const md = renderToMarkdown('dependency-graph', { tasks });
    expect(md).toContain('blocks');
    expect(md).toContain('produces');
  });
});

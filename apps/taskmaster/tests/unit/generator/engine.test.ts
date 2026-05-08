import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  compileTemplate,
  renderToMarkdown,
  renderToTerminal,
  setProjectPath,
  resetEngine,
} from '../../../src/generator/index.js';
import { makeTask } from '../../fixtures/tasks.js';

let tempDir: string;

beforeEach(() => {
  resetEngine();
  tempDir = join(tmpdir(), `agentx-test-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  resetEngine();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('compileTemplate', () => {
  it('compiles the task-list template', () => {
    const compiled = compileTemplate('task-list');
    expect(typeof compiled).toBe('function');
  });

  it('compiles the task-detail template', () => {
    const compiled = compileTemplate('task-detail');
    expect(typeof compiled).toBe('function');
  });

  it('caches compiled templates', () => {
    const first = compileTemplate('task-list');
    const second = compileTemplate('task-list');
    expect(first).toBe(second);
  });

  it('throws for missing template', () => {
    expect(() => compileTemplate('nonexistent-template')).toThrow(/not found/);
  });
});

describe('renderToMarkdown', () => {
  it('renders task-list with task data', () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'First task', status: 'done', complexity: 3 }),
      makeTask({ id: 'T-2', title: 'Second task', status: 'todo', complexity: 7 }),
    ];

    const md = renderToMarkdown('task-list', { tasks });
    expect(md).toContain('Task List');
    expect(md).toContain('T-1');
    expect(md).toContain('First task');
    expect(md).toContain('T-2');
    expect(md).toContain('Second task');
    expect(md).toContain('2');
    expect(md).toContain('tasks');
  });

  it('renders task-detail with single task', () => {
    const task = makeTask({
      id: 'T-5',
      title: 'Detailed task',
      description: 'A detailed description of the task.',
      status: 'in-progress',
      complexity: 6,
      priority: 'high',
      requiredSkills: ['backend', 'database'],
      dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      children: [
        makeTask({ id: 'T-5.1', title: 'Child task', status: 'todo', complexity: 2 }),
      ],
    });

    const md = renderToMarkdown('task-detail', { task });
    expect(md).toContain('T-5');
    expect(md).toContain('Detailed task');
    expect(md).toContain('A detailed description');
    expect(md).toContain('high');
    expect(md).toContain('backend');
    expect(md).toContain('T-1');
    expect(md).toContain('T-5.1');
    expect(md).toContain('Child task');
  });

  it('renders complexity-report with summary data', () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'Easy', complexity: 2 }),
      makeTask({ id: 'T-2', title: 'Medium', complexity: 5 }),
      makeTask({ id: 'T-3', title: 'Hard', complexity: 8 }),
    ];
    const summary = { low: 1, medium: 1, high: 1, average: 5 };

    const md = renderToMarkdown('complexity-report', { tasks, summary });
    expect(md).toContain('Complexity Report');
    expect(md).toContain('Low (1-3)');
    expect(md).toContain('Medium (4-6)');
    expect(md).toContain('High (7-10)');
    expect(md).toContain('T-1');
    expect(md).toContain('T-3');
  });

  it('renders progress-report with progress data', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'in-progress' }),
    ];
    const progress = { total: 5, done: 2, inProgress: 1, blocked: 1, percentage: 40 };

    const md = renderToMarkdown('progress-report', { tasks, progress });
    expect(md).toContain('Progress Report');
    expect(md).toContain('T-1');
    expect(md).toContain('T-2');
  });

  it('renders dependency-graph with dependency data', () => {
    const tasks = [
      makeTask({
        id: 'T-2',
        title: 'Parser',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({
        id: 'T-4',
        title: 'Scorer',
        dependencies: [
          { taskId: 'T-2', type: 'blocks' },
          { taskId: 'T-3', type: 'produces' },
        ],
      }),
    ];

    const md = renderToMarkdown('dependency-graph', { tasks });
    expect(md).toContain('Dependency Graph');
    expect(md).toContain('T-2');
    expect(md).toContain('T-1');
    expect(md).toContain('blocks');
    expect(md).toContain('T-4');
    expect(md).toContain('produces');
  });
});

describe('renderToTerminal', () => {
  it('produces non-empty ANSI output for task-list', () => {
    const tasks = [
      makeTask({ id: 'T-1', title: 'Test task', status: 'done', complexity: 3 }),
    ];

    const output = renderToTerminal('task-list', { tasks });
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('T-1');
  });

  it('produces non-empty ANSI output for task-detail', () => {
    const task = makeTask({ id: 'T-1', title: 'Test', description: 'Desc' });

    const output = renderToTerminal('task-detail', { task });
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('template override system', () => {
  it('uses user template when present in project templates dir', () => {
    // Create a project with a custom template override
    const templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir, { recursive: true });
    writeFileSync(
      join(templatesDir, 'task-list.hbs'),
      '# Custom List\n{{#each tasks}}* {{id}}\n{{/each}}',
    );

    setProjectPath(tempDir);

    const tasks = [
      makeTask({ id: 'T-1', title: 'First' }),
      makeTask({ id: 'T-2', title: 'Second' }),
    ];

    const md = renderToMarkdown('task-list', { tasks });
    expect(md).toContain('Custom List');
    expect(md).toContain('* T-1');
    expect(md).toContain('* T-2');
    // Should NOT contain the default "Task List" heading
    expect(md).not.toContain('| ID |');
  });

  it('falls back to built-in when no override exists', () => {
    setProjectPath(tempDir); // tempDir has no templates/ subdir

    const tasks = [makeTask({ id: 'T-1', title: 'Test' })];
    const md = renderToMarkdown('task-list', { tasks });
    expect(md).toContain('Task List');
  });
});

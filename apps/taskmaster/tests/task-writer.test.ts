import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskNode } from '../src/config/schema.js';
import { generateTaskFiles } from '../src/formats/task-writer.js';
import { safeLoad } from '../src/formats/yaml-bridge.js';

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

describe('task-writer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'task-writer-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates YAML files for each task', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'First task', type: 'task', tags: ['backend'] }),
      makeTask({ id: 'T-2', title: 'Second task', type: 'task' }),
    ];

    const files = await generateTaskFiles(tmpDir, tasks);
    expect(files).toHaveLength(2);

    const tasksDir = join(tmpDir, 'tasks');
    const dirFiles = await readdir(tasksDir);
    expect(dirFiles).toContain('T-1.yaml');
    expect(dirFiles).toContain('T-2.yaml');
  });

  it('writes valid YAML content that round-trips', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'Build API',
      type: 'task',
      description: 'Build the REST API layer',
      complexity: 7,
      priority: 'high',
      requiredSkills: ['backend', 'database'],
      tags: ['api', 'backend'],
    });

    await generateTaskFiles(tmpDir, [task]);

    const content = await readFile(join(tmpDir, 'tasks', 'T-1.yaml'), 'utf-8');
    const parsed = safeLoad(content) as Record<string, unknown>;

    expect(parsed.id).toBe('T-1');
    expect(parsed.title).toBe('Build API');
    expect(parsed.description).toBe('Build the REST API layer');
    expect(parsed.complexity).toBe(7);
    expect(parsed.priority).toBe('high');
    expect(parsed.requiredSkills).toEqual(['backend', 'database']);
    expect(parsed.tags).toEqual(['api', 'backend']);
  });

  it('creates tasks/ directory if it does not exist', async () => {
    const tasks: TaskNode[] = [makeTask({ id: 'T-1', title: 'Task', type: 'task' })];
    await generateTaskFiles(tmpDir, tasks);

    const dirFiles = await readdir(join(tmpDir, 'tasks'));
    expect(dirFiles).toContain('T-1.yaml');
  });

  it('generates files for children with their own IDs', async () => {
    const parent = makeTask({
      id: 'T-1',
      title: 'Parent',
      type: 'task',
      children: [
        makeTask({ id: 'T-1.1', title: 'Child 1', type: 'subtask' }),
        makeTask({ id: 'T-1.2', title: 'Child 2', type: 'subtask' }),
      ],
    });

    const files = await generateTaskFiles(tmpDir, [parent]);
    expect(files).toHaveLength(3);

    const dirFiles = await readdir(join(tmpDir, 'tasks'));
    expect(dirFiles).toContain('T-1.yaml');
    expect(dirFiles).toContain('T-1.1.yaml');
    expect(dirFiles).toContain('T-1.2.yaml');
  });

  it('includes child IDs as references in parent YAML', async () => {
    const parent = makeTask({
      id: 'T-1',
      title: 'Parent',
      type: 'task',
      children: [makeTask({ id: 'T-1.1', title: 'Child 1', type: 'subtask' })],
    });

    await generateTaskFiles(tmpDir, [parent]);

    const content = await readFile(join(tmpDir, 'tasks', 'T-1.yaml'), 'utf-8');
    const parsed = safeLoad(content) as Record<string, unknown>;
    expect(parsed.children).toEqual(['T-1.1']);
  });

  it('returns empty array for no tasks', async () => {
    const files = await generateTaskFiles(tmpDir, []);
    expect(files).toEqual([]);
  });

  it('includes metadata in YAML output', async () => {
    const task = makeTask({
      id: 'T-1',
      title: 'With metadata',
      type: 'task',
      metadata: {
        source: 'plan.md:L10',
        autoExpanded: true,
        skillsInferred: true,
        createdAt: '2026-01-15T12:00:00Z',
      },
    });

    await generateTaskFiles(tmpDir, [task]);

    const content = await readFile(join(tmpDir, 'tasks', 'T-1.yaml'), 'utf-8');
    const parsed = safeLoad(content) as Record<string, unknown>;
    const metadata = parsed.metadata as Record<string, unknown>;
    expect(metadata.source).toBe('plan.md:L10');
    expect(metadata.autoExpanded).toBe(true);
    expect(metadata.skillsInferred).toBe(true);
    expect(metadata.createdAt).toBe('2026-01-15T12:00:00Z');
  });
});

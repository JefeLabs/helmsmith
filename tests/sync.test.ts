import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncTaskFiles } from '../src/formats/sync.js';
import { writeTasks, readTasks } from '../src/formats/tasks-store.js';
import { generateTaskFiles } from '../src/formats/task-writer.js';
import { safeDump } from '../src/formats/yaml-bridge.js';
import type { TaskNode } from '../src/config/schema.js';

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string; type: TaskNode['type'] }): TaskNode {
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

describe('sync', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
    await mkdir(join(tmpDir, 'tasks'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reports no changes when everything is in sync', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'Task One', type: 'task' }),
    ];

    await writeTasks(tmpDir, tasks);
    await generateTaskFiles(tmpDir, tasks);

    const result = await syncTaskFiles(tmpDir);
    expect(result.changes).toHaveLength(0);
    expect(result.unchanged).toContain('T-1');
  });

  it('detects title change in YAML', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'Original Title', type: 'task' }),
    ];

    await writeTasks(tmpDir, tasks);
    await generateTaskFiles(tmpDir, tasks);

    // Manually edit the YAML file
    const yamlContent = safeDump({
      id: 'T-1',
      title: 'Updated Title',
      description: '',
      type: 'task',
      status: 'todo',
      complexity: 1,
      priority: 'medium',
      requiredSkills: [],
      tags: [],
    });
    await writeFile(join(tmpDir, 'tasks', 'T-1.yaml'), yamlContent, 'utf-8');

    const result = await syncTaskFiles(tmpDir);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].taskId).toBe('T-1');
    expect(result.changes[0].diffs).toContainEqual({
      field: 'title',
      jsonValue: 'Original Title',
      yamlValue: 'Updated Title',
    });

    // Verify tasks.json was updated
    const updatedTasks = await readTasks(tmpDir);
    expect(updatedTasks[0].title).toBe('Updated Title');
  });

  it('detects multiple field changes', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'Task', type: 'task', complexity: 3, priority: 'low' }),
    ];

    await writeTasks(tmpDir, tasks);
    await generateTaskFiles(tmpDir, tasks);

    const yamlContent = safeDump({
      id: 'T-1',
      title: 'Task',
      description: 'New description',
      type: 'task',
      status: 'in-progress',
      complexity: 7,
      priority: 'high',
      requiredSkills: ['backend'],
      tags: [],
    });
    await writeFile(join(tmpDir, 'tasks', 'T-1.yaml'), yamlContent, 'utf-8');

    const result = await syncTaskFiles(tmpDir);
    expect(result.changes).toHaveLength(1);

    const diffFields = result.changes[0].diffs.map((d) => d.field);
    expect(diffFields).toContain('description');
    expect(diffFields).toContain('status');
    expect(diffFields).toContain('complexity');
    expect(diffFields).toContain('priority');
    expect(diffFields).toContain('requiredSkills');
  });

  it('dry-run mode does not modify tasks.json', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'Original', type: 'task' }),
    ];

    await writeTasks(tmpDir, tasks);
    await generateTaskFiles(tmpDir, tasks);

    // Edit YAML
    const yamlContent = safeDump({
      id: 'T-1',
      title: 'Changed',
      description: '',
      type: 'task',
      status: 'todo',
      complexity: 1,
      priority: 'medium',
      requiredSkills: [],
      tags: [],
    });
    await writeFile(join(tmpDir, 'tasks', 'T-1.yaml'), yamlContent, 'utf-8');

    const result = await syncTaskFiles(tmpDir, { dryRun: true });
    expect(result.changes).toHaveLength(1);

    // tasks.json should NOT be updated
    const unchanged = await readTasks(tmpDir);
    expect(unchanged[0].title).toBe('Original');
  });

  it('reports YAML files with no matching task in tasks.json', async () => {
    await writeTasks(tmpDir, []);

    // Write an orphan YAML file
    const yamlContent = safeDump({
      id: 'T-99',
      title: 'Orphan',
      type: 'task',
      status: 'todo',
    });
    await writeFile(join(tmpDir, 'tasks', 'T-99.yaml'), yamlContent, 'utf-8');

    const result = await syncTaskFiles(tmpDir);
    expect(result.missingInJson).toContain('T-99');
  });

  it('reports tasks with no YAML file', async () => {
    const tasks: TaskNode[] = [
      makeTask({ id: 'T-1', title: 'No YAML', type: 'task' }),
    ];
    await writeTasks(tmpDir, tasks);
    // Don't generate YAML files

    const result = await syncTaskFiles(tmpDir);
    expect(result.missingYamlFiles).toContain('T-1');
  });

  it('syncs changes to child tasks', async () => {
    const tasks: TaskNode[] = [
      makeTask({
        id: 'T-1',
        title: 'Parent',
        type: 'task',
        children: [
          makeTask({ id: 'T-1.1', title: 'Child', type: 'subtask' }),
        ],
      }),
    ];

    await writeTasks(tmpDir, tasks);
    await generateTaskFiles(tmpDir, tasks);

    // Edit child YAML
    const yamlContent = safeDump({
      id: 'T-1.1',
      title: 'Updated Child',
      description: '',
      type: 'subtask',
      status: 'todo',
      complexity: 1,
      priority: 'medium',
      requiredSkills: [],
      tags: [],
    });
    await writeFile(join(tmpDir, 'tasks', 'T-1.1.yaml'), yamlContent, 'utf-8');

    const result = await syncTaskFiles(tmpDir);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].taskId).toBe('T-1.1');

    // Verify the child was updated in tasks.json
    const updated = await readTasks(tmpDir);
    expect(updated[0].children[0].title).toBe('Updated Child');
  });

  it('handles empty tasks directory gracefully', async () => {
    await writeTasks(tmpDir, [makeTask({ id: 'T-1', title: 'Task', type: 'task' })]);
    // tasks/ dir exists but is empty
    const result = await syncTaskFiles(tmpDir);
    expect(result.changes).toHaveLength(0);
    expect(result.missingYamlFiles).toContain('T-1');
  });
});

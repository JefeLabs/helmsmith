import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { safeDump } from './yaml-bridge.js';
import type { TaskNode } from '../config/schema.js';

/**
 * Generate individual YAML task files from an array of TaskNode objects.
 * Each task becomes a file named `{id}.yaml` in the project's `tasks/` directory.
 * Subtask children are included inline in the parent's YAML.
 */
export async function generateTaskFiles(
  projectPath: string,
  tasks: TaskNode[],
): Promise<string[]> {
  const tasksDir = join(projectPath, 'tasks');
  await mkdir(tasksDir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const task of tasks) {
    const files = await writeTaskTree(tasksDir, task);
    writtenFiles.push(...files);
  }

  return writtenFiles;
}

/**
 * Write a task (and recursively its children) as YAML files.
 */
async function writeTaskTree(tasksDir: string, task: TaskNode): Promise<string[]> {
  const filePath = join(tasksDir, `${task.id}.yaml`);
  const yamlContent = taskToYaml(task);
  await writeFile(filePath, yamlContent, 'utf-8');

  const written: string[] = [filePath];

  for (const child of task.children) {
    const childFiles = await writeTaskTree(tasksDir, child);
    written.push(...childFiles);
  }

  return written;
}

/**
 * Convert a TaskNode to a YAML-serializable plain object, then to YAML string.
 * Children are represented by ID references only (they get their own files).
 */
function taskToYaml(task: TaskNode): string {
  const doc: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    status: task.status,
    complexity: task.complexity,
    priority: task.priority,
    requiredSkills: task.requiredSkills,
    dependencies: task.dependencies.map((d) => ({
      taskId: d.taskId,
      type: d.type,
    })),
    tags: task.tags,
    metadata: {
      source: task.metadata.source,
      autoExpanded: task.metadata.autoExpanded,
      skillsInferred: task.metadata.skillsInferred,
      createdAt: task.metadata.createdAt,
    },
  };

  // Include child IDs as references
  if (task.children.length > 0) {
    doc.children = task.children.map((c) => c.id);
  }

  return safeDump(doc);
}

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskNode } from '../config/schema.js';
import { readTasks, writeTasks } from './tasks-store.js';
import { safeLoad } from './yaml-bridge.js';

/** Fields that can be edited in YAML and synced back into tasks.json. */
const EDITABLE_FIELDS = [
  'title',
  'description',
  'status',
  'complexity',
  'priority',
  'requiredSkills',
  'tags',
] as const;

export interface FieldDiff {
  field: string;
  jsonValue: unknown;
  yamlValue: unknown;
}

export interface SyncChange {
  taskId: string;
  diffs: FieldDiff[];
}

export interface SyncResult {
  changes: SyncChange[];
  unchanged: string[];
  missingInJson: string[];
  missingYamlFiles: string[];
}

/**
 * Sync YAML task files back into tasks.json.
 *
 * - Reads all `.yaml` files from the project's `tasks/` directory
 * - Compares each against the corresponding entry in tasks.json
 * - Merges changed editable fields from YAML into tasks.json (YAML wins)
 *
 * Options:
 *   dryRun: if true, compute diffs but do not write
 */
export async function syncTaskFiles(
  projectPath: string,
  options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const tasksDir = join(projectPath, 'tasks');
  const tasks = await readTasks(projectPath);

  // Build a map of tasks by ID (flat, including children)
  const taskMap = new Map<string, TaskNode>();
  flattenTasks(tasks, taskMap);

  // Read all YAML files from tasks/
  const yamlTasks = await readYamlTaskFiles(tasksDir);

  const result: SyncResult = {
    changes: [],
    unchanged: [],
    missingInJson: [],
    missingYamlFiles: [],
  };

  // Compare YAML files against JSON tasks
  for (const [yamlId, yamlData] of yamlTasks) {
    const jsonTask = taskMap.get(yamlId);

    if (!jsonTask) {
      result.missingInJson.push(yamlId);
      continue;
    }

    const diffs = computeDiffs(jsonTask, yamlData);

    if (diffs.length > 0) {
      result.changes.push({ taskId: yamlId, diffs });

      if (!options.dryRun) {
        applyDiffs(jsonTask, yamlData);
      }
    } else {
      result.unchanged.push(yamlId);
    }
  }

  // Find tasks that have no YAML file
  for (const id of taskMap.keys()) {
    if (!yamlTasks.has(id)) {
      result.missingYamlFiles.push(id);
    }
  }

  // Write back if not dry-run and there were changes
  if (!options.dryRun && result.changes.length > 0) {
    await writeTasks(projectPath, tasks);
  }

  return result;
}

/**
 * Flatten a tree of tasks into a map by ID.
 */
function flattenTasks(tasks: TaskNode[], map: Map<string, TaskNode>): void {
  for (const task of tasks) {
    map.set(task.id, task);
    if (task.children.length > 0) {
      flattenTasks(task.children, map);
    }
  }
}

/**
 * Read all .yaml task files from a directory.
 * Returns a map of taskId -> parsed YAML data.
 */
async function readYamlTaskFiles(tasksDir: string): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  if (!existsSync(tasksDir)) {
    return result;
  }

  const files = await readdir(tasksDir);

  for (const file of files) {
    if (!file.endsWith('.yaml')) continue;

    const content = await readFile(join(tasksDir, file), 'utf-8');
    const parsed = safeLoad(content);

    if (parsed && typeof parsed === 'object' && 'id' in (parsed as Record<string, unknown>)) {
      const data = parsed as Record<string, unknown>;
      result.set(data.id as string, data);
    }
  }

  return result;
}

/**
 * Compute field-level diffs between a JSON task and YAML data for editable fields.
 */
function computeDiffs(jsonTask: TaskNode, yamlData: Record<string, unknown>): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of EDITABLE_FIELDS) {
    if (!(field in yamlData)) continue;

    const jsonValue = jsonTask[field];
    const yamlValue = yamlData[field];

    if (!deepEqual(jsonValue, yamlValue)) {
      diffs.push({ field, jsonValue, yamlValue });
    }
  }

  return diffs;
}

/**
 * Apply YAML values to a JSON task (mutates in place).
 */
function applyDiffs(jsonTask: TaskNode, yamlData: Record<string, unknown>): void {
  for (const field of EDITABLE_FIELDS) {
    if (!(field in yamlData)) continue;

    const yamlValue = yamlData[field];
    const jsonValue = jsonTask[field];

    if (!deepEqual(jsonValue, yamlValue)) {
      (jsonTask as Record<string, unknown>)[field] = yamlValue;
    }
  }
}

/**
 * Simple deep equality check for JSON-compatible values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

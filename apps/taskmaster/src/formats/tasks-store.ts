import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { TasksFileSchema, type TaskNode } from '../config/schema.js';
const TASKS_FILENAME = 'tasks.json';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 200;

/**
 * Read and validate tasks.json for a project.
 * Returns an empty array if the file does not exist.
 */
export async function readTasks(projectPath: string): Promise<TaskNode[]> {
  const tasksPath = join(projectPath, TASKS_FILENAME);

  if (!existsSync(tasksPath)) {
    return [];
  }

  const content = await readFile(tasksPath, 'utf-8');
  const parsed = JSON.parse(content);
  return TasksFileSchema.parse(parsed);
}

/**
 * Atomically write tasks to tasks.json with file locking.
 *
 * Steps:
 * 1. Acquire lock on tasks.json
 * 2. Write to tasks.json.tmp
 * 3. Rename tasks.json.tmp -> tasks.json (atomic on POSIX)
 * 4. Release lock
 *
 * Retries up to MAX_RETRIES times if the lock is held.
 */
export async function writeTasks(projectPath: string, tasks: TaskNode[]): Promise<void> {
  // Validate before writing
  TasksFileSchema.parse(tasks);

  const tasksPath = join(projectPath, TASKS_FILENAME);
  const tmpPath = join(projectPath, `${TASKS_FILENAME}.tmp`);

  // Ensure the file exists for locking (proper-lockfile requires the file to exist)
  if (!existsSync(tasksPath)) {
    await writeFile(tasksPath, '[]', 'utf-8');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const release = await lockfile.lock(tasksPath, {
        retries: { retries: 2, minTimeout: 100, maxTimeout: 500 },
      });

      try {
        const content = JSON.stringify(tasks, null, 2);
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, tasksPath);
      } finally {
        await release();
      }

      return; // success
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Failed to write tasks.json after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

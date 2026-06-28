import type { TaskNode } from '../config/schema.js';
import { generateTaskFiles } from '../formats/task-writer.js';

export interface GenerateResult {
  /** Paths of generated YAML task files. */
  files: string[];
}

/**
 * Execute the generate command: regenerate YAML task files
 * from the canonical tasks.json data.
 */
export async function executeGenerate(
  projectDir: string,
  tasks: TaskNode[],
): Promise<GenerateResult> {
  const files = await generateTaskFiles(projectDir, tasks);
  return { files };
}

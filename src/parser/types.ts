import type { TaskNode } from '../config/schema.js';

/** Format of the input plan file */
export type PlanFormat = 'markdown' | 'yaml' | 'text';

/** Options passed to the parser */
export interface ParseOptions {
  /** Project style key (determines heading-to-type mapping and max depth) */
  style: string;
  /** Soft target for number of top-level tasks */
  numTasks?: number;
  /** Default status for new tasks (derived from state config) */
  defaultStatus: string;
}

/** A section extracted from the plan file (intermediate representation) */
export interface ParsedSection {
  /** Heading text (becomes task title) */
  title: string;
  /** Heading depth (1 for #, 2 for ##, etc.) */
  depth: number;
  /** Body content below the heading (paragraphs, bullets, code) */
  body: string;
  /** Child sections (sub-headings) */
  children: ParsedSection[];
  /** Optional priority hint from YAML plans */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Optional tags hint from YAML plans */
  tags?: string[];
}

/** Result returned by parsePlan() */
export interface ParseResult {
  tasks: TaskNode[];
  warnings: string[];
  metadata: {
    format: PlanFormat;
    sectionsFound: number;
    tasksGenerated: number;
  };
}

/** Interface for AI-assisted dependency inference (deferred to T-2.5/T-6) */
export interface DependencyInferrer {
  inferDependencies(tasks: TaskNode[]): Promise<TaskNode[]>;
}

/** No-op inferrer used as default until AI integration is built */
export const noopInferrer: DependencyInferrer = {
  inferDependencies: async (tasks) => tasks,
};

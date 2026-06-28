import type { TaskNode } from '../config/schema.js';

export interface TaskListContext {
  tasks: TaskNode[];
  filters?: {
    status?: string;
    category?: string;
    type?: string;
  };
}

export interface TaskDetailContext {
  task: TaskNode;
}

export interface ComplexityReportContext {
  tasks: TaskNode[];
  summary: {
    low: number;
    medium: number;
    high: number;
    average: number;
  };
}

export interface ProgressReportContext {
  tasks: TaskNode[];
  progress: {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    pending: number;
    percentage: number;
  };
}

export interface DependencyGraphContext {
  tasks: TaskNode[];
}

export type { SummaryReportContext } from '../reports/types.js';

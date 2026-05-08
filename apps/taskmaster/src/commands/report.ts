import type { TaskNode, StateDefinition } from '../config/schema.js';
import {
  recomputeAllReadiness,
  applyReadiness,
} from '../readiness/index.js';
import { aggregateReport, REPORT_TYPE_TO_TEMPLATE } from '../reports/index.js';
import type { ReportType } from '../reports/types.js';

export interface ReportOpts {
  type: string;
  format: string;
  template?: string;
}

export interface ReportResult {
  context: Record<string, unknown>;
  templateName: string;
  tasks: TaskNode[];
}

const VALID_REPORT_TYPES = ['summary', 'complexity', 'progress', 'dependencies', 'qa'];

/**
 * Execute the report command: recompute readiness, aggregate report data,
 * and return the template context for rendering.
 */
export async function executeReport(
  tasks: TaskNode[],
  states: StateDefinition[],
  opts: ReportOpts,
): Promise<ReportResult> {
  // Recompute readiness for accurate reports
  const results = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, results);

  let context: Record<string, unknown>;
  let templateName: string;

  if (opts.template && !opts.type) {
    // Custom template pass-through
    const { flattenTasks } = await import('../readiness/dag.js');
    context = { tasks: flattenTasks(tasks) };
    templateName = opts.template;
  } else {
    if (!VALID_REPORT_TYPES.includes(opts.type)) {
      throw new Error(
        `Invalid report type "${opts.type}". Valid types: ${VALID_REPORT_TYPES.join(', ')}`,
      );
    }
    const reportType = opts.type as ReportType;
    context = aggregateReport(reportType, tasks, states);
    templateName = REPORT_TYPE_TO_TEMPLATE[reportType];
  }

  return { context, templateName, tasks };
}

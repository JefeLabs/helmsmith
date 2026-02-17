import type { TaskNode, StateDefinition } from '../config/schema.js';
import {
  aggregateSummary,
  aggregateComplexity,
  aggregateProgress,
  aggregateDependencies,
  aggregateQA,
} from './aggregator.js';
import type { ReportType } from './types.js';

export type { ReportType, ReportFormat, SummaryReportContext, SkillCoverage, QAReportContext } from './types.js';
export {
  aggregateSummary,
  aggregateComplexity,
  aggregateProgress,
  aggregateDependencies,
  aggregateQA,
  generateMermaidSyntax,
} from './aggregator.js';

/** Mapping from built-in report type to its Handlebars template name. */
export const REPORT_TYPE_TO_TEMPLATE: Record<ReportType, string> = {
  summary: 'summary-report',
  complexity: 'complexity-report',
  progress: 'progress-report',
  dependencies: 'dependency-graph',
  qa: 'qa-report',
};

/**
 * Dispatch to the correct aggregator based on report type.
 * Returns the context object suitable for Handlebars rendering or JSON/YAML serialization.
 */
export function aggregateReport(
  type: ReportType,
  tasks: TaskNode[],
  states: StateDefinition[],
): Record<string, unknown> {
  switch (type) {
    case 'summary':
      return aggregateSummary(tasks, states) as unknown as Record<string, unknown>;
    case 'complexity':
      return aggregateComplexity(tasks) as unknown as Record<string, unknown>;
    case 'progress':
      return aggregateProgress(tasks, states) as unknown as Record<string, unknown>;
    case 'dependencies':
      return aggregateDependencies(tasks) as unknown as Record<string, unknown>;
    case 'qa':
      return aggregateQA(tasks, states) as unknown as Record<string, unknown>;
  }
}

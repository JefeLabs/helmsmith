/** Built-in report types. */
export type ReportType = 'summary' | 'complexity' | 'progress' | 'dependencies';

/** Output format for reports. */
export type ReportFormat = 'json' | 'yaml' | 'md' | 'table';

/** A single skill with the number of tasks requiring it. */
export interface SkillCoverage {
  skill: string;
  count: number;
}

/** Context for the summary report template (project health dashboard). */
export interface SummaryReportContext {
  generatedAt: string;
  taskCounts: {
    total: number;
    open: number;
    active: number;
    closed: number;
  };
  complexity: {
    low: number;
    medium: number;
    high: number;
    average: number;
  };
  skillCoverage: SkillCoverage[];
  readiness: {
    ready: number;
    blocked: number;
    pending: number;
  };
  blockedAlerts: Array<{
    id: string;
    title: string;
    waitingOn: string[];
  }>;
  progressPercentage: number;
}

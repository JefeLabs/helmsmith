/** Built-in report types. */
export type ReportType = 'summary' | 'complexity' | 'progress' | 'dependencies' | 'qa';

/** Output format for reports. */
export type ReportFormat = 'json' | 'yaml' | 'md' | 'table';

/** A single skill with the number of tasks requiring it. */
export interface SkillCoverage {
  skill: string;
  count: number;
}

/** A QA failure entry for the QA report. */
export interface QAReportFailure {
  id: string;
  title: string;
  severity: string;
  testType: string;
  description: string;
  cause: string;
  reporter: string;
  timestamp: string;
}

/** Context for the QA report template. */
export interface QAReportContext {
  generatedAt: string;
  failures: QAReportFailure[];
  reviewNeeded: Array<{ id: string; title: string }>;
  stats: {
    totalFailures: number;
    bySeverity: { critical: number; major: number; minor: number };
    byTestType: Array<{ testType: string; count: number }>;
  };
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

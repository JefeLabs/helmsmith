import type { ApplicationBlueprint } from '../types.js';

export const DATA_PIPELINE_BLUEPRINT: ApplicationBlueprint = {
  id: 'data-pipeline',
  name: 'Data Pipeline',
  description:
    'Data processing pipeline that ingests, transforms, and loads data with schema validation, checkpoint/restart capability, and quarantine handling for malformed records.',
  appType: 'pipeline',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'batch-or-stream',
      question: 'Is this a batch, streaming, or hybrid pipeline?',
      type: 'single-select',
      options: ['batch', 'stream', 'hybrid'],
      default: 'batch',
    },
    {
      id: 'data-volume',
      question: 'What is the expected data volume?',
      type: 'single-select',
      options: ['small', 'medium', 'large'],
      default: 'medium',
    },
    {
      id: 'source-type',
      question: 'What is the primary data source?',
      type: 'single-select',
      options: ['database', 'api', 'file', 'queue'],
      default: 'database',
    },
    {
      id: 'idempotent-processing',
      question: 'Must the pipeline produce identical results when re-run on the same input?',
      type: 'boolean',
      default: true,
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'schema-validation',
      title: 'Schema validation',
      description:
        'Validate each record against a defined schema at ingestion and after transformation, catching data quality issues before they propagate downstream.',
      category: 'data-integrity',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'data-engineering'],
      tags: ['concern:data-integrity', 'layer:transform'],
      implementationGuidance:
        'Define input and output schemas using Zod, JSON Schema, or a similar library. Validate records at the pipeline boundary (after ingestion and before output). Route invalid records to quarantine rather than failing the entire pipeline. Include the validation error details alongside the quarantined record.',
    },
    {
      id: 'checkpoint-restart',
      title: 'Checkpoint and restart',
      description:
        'Persist pipeline progress at regular intervals so that a failed run can resume from the last checkpoint rather than reprocessing all data.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 6,
      requiredSkills: ['backend', 'data-engineering'],
      tags: ['concern:reliability', 'layer:pipeline'],
      implementationGuidance:
        'Store checkpoint state (last processed offset, batch ID, or timestamp) to a durable store after each successfully processed batch. On startup, check for an existing checkpoint and resume from that position. Use atomic writes for checkpoint updates to prevent corruption from mid-write crashes.',
    },
    {
      id: 'quarantine-handling',
      title: 'Quarantine handling',
      description:
        'Divert records that fail validation or transformation to a quarantine store for manual inspection without halting the pipeline.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'data-engineering'],
      tags: ['concern:reliability', 'layer:pipeline'],
      implementationGuidance:
        'Write quarantined records to a separate file, table, or queue along with the error reason, source batch ID, and timestamp. Set a quarantine threshold (e.g., >10% of records quarantined) that triggers a pipeline halt and alert. Provide tooling to inspect, fix, and replay quarantined records.',
    },
    {
      id: 'pipeline-logging',
      title: 'Pipeline logging',
      description:
        'Log pipeline execution metrics (records processed, skipped, quarantined, elapsed time) at each stage for operational visibility.',
      category: 'observability',
      urgency: 'upfront',
      estimatedComplexity: 3,
      requiredSkills: ['backend'],
      tags: ['concern:observability', 'layer:pipeline'],
      implementationGuidance:
        'Log structured entries at the start and end of each pipeline stage with record counts and duration. Emit periodic progress logs for long-running stages. Include batch/run identifiers in every log entry. Use warn level for quarantined records and error level for stage failures.',
    },
    {
      id: 'error-handling',
      title: 'Error handling',
      description:
        'Distinguish between record-level errors (quarantine the record) and pipeline-level errors (halt and alert), applying the correct recovery strategy.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:error-handling', 'layer:pipeline'],
      implementationGuidance:
        'Wrap each record processing step in error handling that catches record-level failures and routes them to quarantine. Catch pipeline-level failures (lost database connection, out of disk) at the stage level and trigger a checkpoint-and-halt. Never silently swallow errors; always log and categorize them.',
    },

    // PATTERN-FIRST
    {
      id: 'data-lineage',
      title: 'Data lineage tracking',
      description:
        'Track the origin, transformations, and destination of each record so that data quality issues can be traced back to their source.',
      category: 'data-integrity',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['data-engineering'],
      tags: ['concern:data-integrity', 'layer:pipeline'],
      implementationGuidance:
        'Attach metadata to each record (source system, ingestion timestamp, pipeline run ID) and preserve it through transformations. Log stage transitions with input and output record counts. Store lineage metadata alongside output records for downstream auditing.',
    },
    {
      id: 'backfill-strategy',
      title: 'Backfill strategy',
      description:
        'Support reprocessing historical data for a specific time range without disrupting ongoing incremental pipeline runs.',
      category: 'operations',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend', 'data-engineering'],
      tags: ['concern:operations', 'layer:pipeline'],
      implementationGuidance:
        'Accept a date range parameter that overrides the checkpoint-based resume behavior. Run backfills in a separate execution context to avoid conflicting with incremental runs. Ensure idempotent writes so backfills can safely overwrite existing data. Log backfill runs distinctly for auditing.',
    },
    {
      id: 'partitioning',
      title: 'Data partitioning',
      description:
        'Partition data by a meaningful key (date, region, tenant) to enable parallel processing and efficient queries on the output.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['data-engineering'],
      tags: ['concern:performance', 'layer:pipeline'],
      implementationGuidance:
        'Choose a partition key that aligns with common query patterns (usually date or tenant). Write output to partitioned directories or tables. Process partitions in parallel where dependencies allow. Implement partition pruning in downstream queries to avoid full scans.',
    },
    {
      id: 'monitoring-alerting',
      title: 'Monitoring and alerting',
      description:
        'Track pipeline run health, data freshness, and SLA compliance, alerting operators when runs fail, stall, or produce unexpected results.',
      category: 'observability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:observability', 'layer:infra'],
      implementationGuidance:
        'Emit metrics for each run: duration, record counts (input/output/quarantined), and success/failure status. Set up alerts for failed runs, runs exceeding expected duration, and data freshness violations. Track trends over time to detect gradual degradation.',
    },
    {
      id: 'dead-data-handling',
      title: 'Dead data handling',
      description:
        'Detect and handle records that are too old, duplicated, or otherwise unprocessable, routing them out of the main pipeline flow.',
      category: 'data-integrity',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['data-engineering'],
      tags: ['concern:data-integrity', 'layer:pipeline'],
      implementationGuidance:
        'Define criteria for "dead" data (e.g., older than retention period, known duplicate, missing required foreign keys). Filter dead records early in the pipeline to avoid wasting processing resources. Log dead data statistics for each run and route them to a dead data archive if audit requirements apply.',
    },
    {
      id: 'rate-limiting',
      title: 'Rate limiting and throttling',
      description:
        'Control the rate of reads from source systems and writes to destinations to avoid overwhelming external services or exceeding API quotas.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['backend'],
      tags: ['concern:performance', 'layer:pipeline'],
      implementationGuidance:
        'Implement a token bucket or fixed-window rate limiter for API source reads. Use batch size limits for database reads to control memory usage. Add configurable delays between batches when writing to rate-limited destinations. Log throttling events so operators can tune the limits.',
    },
    {
      id: 'retry-circuit-breaker',
      title: 'Retry and circuit breaker',
      description:
        'Retry transient failures with backoff and open a circuit breaker when a downstream dependency is persistently unavailable.',
      category: 'reliability',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['backend'],
      tags: ['concern:reliability', 'layer:pipeline'],
      implementationGuidance:
        'Wrap external calls (API, database) in a retry wrapper with exponential backoff and a max attempt limit. Layer a circuit breaker that opens after N consecutive failures, halting calls for a cooldown period before retrying. Log state transitions (closed, open, half-open) and alert on circuit open events.',
    },
    {
      id: 'output-validation',
      title: 'Output validation',
      description:
        'Validate pipeline output against expected schema and business rules before committing results to the destination, catching transformation bugs early.',
      category: 'data-integrity',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['data-engineering'],
      tags: ['concern:data-integrity', 'layer:pipeline'],
      implementationGuidance:
        'Apply output schema validation to every record before writing to the destination. Run aggregate checks (expected row counts, referential integrity, value distribution) on the full output batch. Fail the pipeline stage and preserve the checkpoint if validation fails, so the run can be retried after fixing the transform.',
    },

    // DEFERRED
    {
      id: 'dependency-management',
      title: 'Pipeline dependency management',
      description:
        'Define and enforce execution order between pipeline stages and across pipelines, preventing runs from starting before their dependencies complete.',
      category: 'operations',
      urgency: 'deferred',
      estimatedComplexity: 6,
      requiredSkills: ['data-engineering', 'devops'],
      tags: ['concern:operations', 'layer:infra'],
      implementationGuidance:
        'Use a workflow orchestrator (e.g., Airflow, Dagster, or a custom DAG runner) to define pipeline dependencies as a directed acyclic graph. Block downstream pipelines until upstream runs complete successfully. Support manual override for re-running failed dependencies.',
    },
    {
      id: 'data-quality-metrics',
      title: 'Data quality metrics',
      description:
        'Compute and track data quality scores (completeness, accuracy, consistency) across pipeline runs to detect drift and degradation over time.',
      category: 'data-integrity',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['data-engineering'],
      tags: ['concern:data-integrity', 'layer:pipeline'],
      implementationGuidance:
        'Define quality metrics per dataset: null rate, uniqueness, referential integrity, value range compliance. Compute these metrics after each pipeline run and store them in a metrics table. Set thresholds that trigger alerts when quality drops below acceptable levels. Display trends in a dashboard for data stewards.',
    },
    {
      id: 'cleanup-archival',
      title: 'Cleanup and archival',
      description:
        'Automatically archive or delete old pipeline outputs, checkpoints, and quarantine data according to a configurable retention policy.',
      category: 'operations',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['backend', 'devops'],
      tags: ['concern:operations', 'layer:infra'],
      implementationGuidance:
        'Define retention periods for each data category (output data, checkpoints, quarantine, logs). Run a cleanup job on a schedule that removes or archives data past its retention date. Use soft deletes or move-to-archive before permanent deletion. Log all cleanup actions for auditability.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'data-volume',
      answerEquals: 'large',
      addConcerns: ['partitioning'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'batch-or-stream',
      answerEquals: 'stream',
      addConcerns: ['backfill-strategy'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'idempotent-processing',
      answerEquals: true,
      addConcerns: ['output-validation'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'source-type',
      answerEquals: 'api',
      addConcerns: ['rate-limiting', 'retry-circuit-breaker'],
      promoteToUrgency: 'upfront',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'schema-validation',
    'checkpoint-restart',
    'quarantine-handling',
    'pipeline-logging',
    'error-handling',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['data-pipeline', 'ETL', 'batch-processing'],
    frameworks: [],
    capabilities: [],
    fileIndicators: ['pipelines/', 'etl/', 'jobs/', 'transforms/'],
    weight: 0.7,
  },
};

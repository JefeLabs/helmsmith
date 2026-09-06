import { Accordion, Button, Card, Chip, Separator } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Code, LoadingSpinner } from '../components/ui';
import { Job, jobs } from '../lib/api';

/**
 * Per-input drill-down for a benchmark run. Lists jobs in the cohort
 * with status, score, and a collapsible accordion showing input /
 * output / rationale for each. Used by clicking through from
 * /benchmarks → "View jobs."
 */
export default function BenchmarkRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  const { data, isPending, error } = useQuery({
    queryKey: ['benchmark-run', runId],
    queryFn: () => jobs.listByBenchmarkRun(runId!),
    enabled: !!runId,
    refetchInterval: 5_000,
  });

  if (!runId) return null;
  if (isPending) return <LoadingSpinner label="Loading jobs…" />;
  if (error) return <Code color="danger">{String(error)}</Code>;
  if (!data || data.length === 0) {
    return (
      <Card>
        <Card.Content>
          <p className="text-muted">No jobs found for run {runId}.</p>
        </Card.Content>
      </Card>
    );
  }

  const label = data[0]?.benchmarkLabel;
  const counts = countByStatus(data);

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header className="flex flex-row justify-between items-start gap-3">
          <div className="flex flex-col gap-1">
            <Code>{runId}</Code>
            {label && <p className="text-sm font-semibold">{label}</p>}
            <p className="text-xs text-muted">
              {data.length} job(s) · {counts.completed} completed · {counts.failed} failed ·{' '}
              {counts.inFlight} in-flight
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => navigate(`/benchmarks?runIds=${runId}`)}
          >
            ← back to compare
          </Button>
        </Card.Header>
      </Card>

      {/* v2 `variant="splitted"` → default variant with a card surface per item. */}
      <Accordion allowsMultipleExpanded className="space-y-2">
        {data.map((job, idx) => (
          <Accordion.Item key={job.id} id={job.id} className="rounded-2xl bg-surface px-4">
            <Accordion.Heading>
              <Accordion.Trigger aria-label={`job ${idx + 1}`}>
                <div className="flex flex-col gap-1 items-start">
                  <JobRowTitle job={job} index={idx + 1} />
                  <span className="text-xs text-muted font-mono">{job.id.slice(0, 24)}…</span>
                </div>
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body>
                <JobDetail job={job} />
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </div>
  );
}

function JobRowTitle({ job, index }: { job: Job; index: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted text-sm w-8">#{index}</span>
      <Chip size="sm" color={statusColor(job.status)} variant="soft">
        {job.status}
      </Chip>
      <ScoreChip score={job.evalScore} />
      <span className="text-sm text-foreground truncate max-w-md">{summarizeInput(job.input)}</span>
    </div>
  );
}

function JobDetail({ job }: { job: Job }) {
  const [showFullInput, setShowFullInput] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);

  return (
    <div className="space-y-3 text-sm">
      <Section label="status" value={job.status} />
      {job.benchmarkLabel && <Section label="label" value={job.benchmarkLabel} />}
      {job.failureReason && <Section label="failureReason" value={job.failureReason} />}

      <Separator />

      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <span className="text-muted">input</span>
          <Button size="sm" variant="tertiary" onPress={() => setShowFullInput((s) => !s)}>
            {showFullInput ? 'collapse' : 'expand'}
          </Button>
        </div>
        <pre className="text-xs bg-surface-secondary p-2 rounded max-h-96 overflow-auto">
          {showFullInput
            ? JSON.stringify(job.input, null, 2)
            : truncate(JSON.stringify(job.input, null, 2), 240)}
        </pre>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <span className="text-muted">output</span>
          <Button size="sm" variant="tertiary" onPress={() => setShowFullOutput((s) => !s)}>
            {showFullOutput ? 'collapse' : 'expand'}
          </Button>
        </div>
        <pre className="text-xs bg-surface-secondary p-2 rounded max-h-96 overflow-auto">
          {job.output == null
            ? '(no output yet)'
            : showFullOutput
              ? JSON.stringify(job.output, null, 2)
              : truncate(JSON.stringify(job.output, null, 2), 240)}
        </pre>
      </div>

      {(job.evalScore != null || job.evalRationale) && (
        <>
          <Separator />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted">score</span>
              <ScoreChip score={job.evalScore} />
              {job.evalJudge && (
                <Chip size="sm" variant="soft">
                  judge: {job.evalJudge}
                </Chip>
              )}
            </div>
            {job.evalRationale && <p className="text-foreground text-xs">{job.evalRationale}</p>}
          </div>
        </>
      )}

      <Separator />

      <div className="flex gap-3 text-xs text-muted">
        <span>created {fmt(job.createdAt)}</span>
        {job.startedAt && <span>started {fmt(job.startedAt)}</span>}
        {job.completedAt && <span>completed {fmt(job.completedAt)}</span>}
      </div>
    </div>
  );
}

function Section({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ScoreChip({ score }: { score?: number | null }) {
  if (score == null) {
    return (
      <Chip size="sm" variant="soft">
        unscored
      </Chip>
    );
  }
  const tone = score >= 0.7 ? 'success' : score >= 0.3 ? 'warning' : 'danger';
  return (
    <Chip size="sm" color={tone} variant="soft">
      {score.toFixed(2)}
    </Chip>
  );
}

function statusColor(status: Job['status']) {
  return status === 'completed'
    ? 'success'
    : status === 'failed' || status === 'cancelled'
      ? 'danger'
      : status === 'running'
        ? 'accent'
        : 'default';
}

function summarizeInput(input: unknown): string {
  if (input == null) return '(no input)';
  if (typeof input === 'string') return truncate(input, 100);
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.prompt === 'string') return truncate(o.prompt, 100);
    if (typeof o.text === 'string') return truncate(o.text, 100);
    return truncate(JSON.stringify(input), 100);
  }
  return String(input);
}

function countByStatus(rows: Job[]) {
  let completed = 0,
    failed = 0,
    inFlight = 0;
  for (const j of rows) {
    if (j.status === 'completed') completed += 1;
    else if (j.status === 'failed' || j.status === 'cancelled') failed += 1;
    else inFlight += 1;
  }
  return { completed, failed, inFlight };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

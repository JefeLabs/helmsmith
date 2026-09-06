import { Button, Card, Separator, Table } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Code, LoadingSpinner, TextInput } from '../components/ui';
import { BenchmarkRunSummary, benchmarks } from '../lib/api';

/**
 * Benchmark compare page. URL drives state — ?runIds=A,B,C lets users
 * share a comparison. Renders a summary table + side-by-side bar
 * charts for the metrics that matter (success rate, avg score,
 * latency).
 */
export default function BenchmarksPage() {
  const [params, setParams] = useSearchParams();
  const runIdsParam = params.get('runIds') ?? '';
  const runIds = useMemo(
    () =>
      runIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [runIdsParam],
  );

  const [draft, setDraft] = useState(runIdsParam);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['benchmarks-compare', runIds.join(',')],
    queryFn: () => benchmarks.compare(runIds),
    enabled: runIds.length > 0,
    refetchInterval: 5_000,
  });

  function applyDraft() {
    setParams({ runIds: draft });
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header className="flex flex-col gap-1 items-start">
          <p className="text-base font-semibold">Benchmark compare</p>
          <p className="text-sm text-muted">
            Paste comma-separated run IDs (returned by <Code>workspace bench run</Code>);
            auto-refresh every 5s.
          </p>
        </Card.Header>
        <Separator />
        <Card.Content className="flex flex-row gap-2 items-end">
          <TextInput
            label="Run IDs"
            placeholder="run-abc,run-def"
            value={draft}
            onValueChange={setDraft}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyDraft();
            }}
          />
          <Button variant="primary" onPress={applyDraft} isDisabled={!draft.trim()}>
            Compare
          </Button>
          <Button variant="secondary" onPress={() => refetch()} isDisabled={runIds.length === 0}>
            Refresh
          </Button>
        </Card.Content>
      </Card>

      {isPending && runIds.length > 0 && <LoadingSpinner label="Loading benchmark data…" />}
      {error && <Code color="danger">{String(error)}</Code>}
      {data && data.length > 0 && <CompareView rows={data} />}
      {data && data.length === 0 && (
        <Card>
          <Card.Content>
            <p className="text-muted">No matching runs found.</p>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function CompareView({ rows }: { rows: BenchmarkRunSummary[] }) {
  const navigate = useNavigate();
  // Color cycle for the bars per run — Hero UI's Tailwind palette.
  const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#0ea5e9'];

  // Build chart data: one row per metric, columns per run.
  const metricChart = [
    {
      metric: 'success rate',
      ...rowsByLabel(rows, (r) => r.successRate),
    },
    {
      metric: 'avg score',
      ...rowsByLabel(rows, (r) => r.avgScore ?? 0),
    },
  ];

  const latencyChart = [
    {
      metric: 'p50 (ms)',
      ...rowsByLabel(rows, (r) => r.p50LatencyMs),
    },
    {
      metric: 'p95 (ms)',
      ...rowsByLabel(rows, (r) => r.p95LatencyMs),
    },
  ];

  // Estimation: MAE is always >=0, bias is signed. Both share the
  // story-point unit so they belong on the same axis.
  const anyEstimated = rows.some((r) => r.estimated > 0);
  const estimationChart = [
    {
      metric: 'MAE (pts)',
      ...rowsByLabel(rows, (r) => r.meanAbsError ?? 0),
    },
    {
      metric: 'bias (pts)',
      ...rowsByLabel(rows, (r) => r.bias ?? 0),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Side-by-side cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r, idx) => (
          <Card key={r.runId}>
            <Card.Header className="flex flex-row justify-between items-start gap-2">
              <div className="flex flex-col items-start gap-0">
                <Code className="text-xs">
                  {r.runId.length > 24 ? `${r.runId.slice(0, 24)}…` : r.runId}
                </Code>
                <p
                  className="text-sm font-semibold mt-1"
                  style={{ color: colors[idx % colors.length] }}
                >
                  {r.label ?? '—'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => navigate(`/benchmarks/${encodeURIComponent(r.runId)}`)}
              >
                View jobs →
              </Button>
            </Card.Header>
            <Separator />
            <Card.Content className="space-y-1 text-sm">
              <Row label="total" value={r.total} />
              <Row
                label="completed"
                value={`${r.completed} (${(r.successRate * 100).toFixed(1)}%)`}
              />
              <Row label="failed" value={r.failed} />
              <Row label="in-flight" value={r.inFlight} />
              <Separator className="my-1" />
              <Row label="p50 latency" value={`${r.p50LatencyMs} ms`} />
              <Row label="p95 latency" value={`${r.p95LatencyMs} ms`} />
              <Separator className="my-1" />
              <Row label="scored" value={`${r.scored} / ${r.total}`} />
              <Row label="avg score" value={r.avgScore != null ? r.avgScore.toFixed(3) : '—'} />
              {r.estimated > 0 && (
                <>
                  <Separator className="my-1" />
                  <Row label="estimated" value={`${r.estimated} / ${r.total}`} />
                  <Row
                    label="MAE (pts)"
                    value={r.meanAbsError != null ? r.meanAbsError.toFixed(2) : '—'}
                  />
                  <Row label="bias (pts)" value={r.bias != null ? formatBias(r.bias) : '—'} />
                </>
              )}
            </Card.Content>
          </Card>
        ))}
      </div>

      {/* Quality chart */}
      <Card>
        <Card.Header>
          <p className="text-base">Quality</p>
        </Card.Header>
        <Separator />
        <Card.Content style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={metricChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="metric" stroke="#9ca3af" />
              <YAxis domain={[0, 1]} stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: '#1f2937', border: 'none' }} />
              <Legend />
              {rows.map((r, idx) => (
                <Bar key={r.runId} dataKey={labelKey(r)} fill={colors[idx % colors.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card.Content>
      </Card>

      {/* Latency chart */}
      <Card>
        <Card.Header>
          <p className="text-base">Latency</p>
        </Card.Header>
        <Separator />
        <Card.Content style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={latencyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="metric" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: '#1f2937', border: 'none' }} />
              <Legend />
              {rows.map((r, idx) => (
                <Bar key={r.runId} dataKey={labelKey(r)} fill={colors[idx % colors.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card.Content>
      </Card>

      {/* Estimation chart — only when there's something to plot. */}
      {anyEstimated && (
        <Card>
          <Card.Header className="flex flex-col gap-1 items-start">
            <p className="text-base">Estimation accuracy</p>
            <p className="text-xs text-muted">
              <Code>MAE</Code> = mean(|actual − estimated|) — lower is better. <Code>bias</Code> =
              mean(actual − estimated) — positive means consistently under-estimating; negative
              means over-estimating; near zero means estimates are well-calibrated.
            </p>
          </Card.Header>
          <Separator />
          <Card.Content style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={estimationChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="metric" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip contentStyle={{ background: '#1f2937', border: 'none' }} />
                <Legend />
                {rows.map((r, idx) => (
                  <Bar key={r.runId} dataKey={labelKey(r)} fill={colors[idx % colors.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card.Content>
        </Card>
      )}

      {/* Detail table */}
      <Card>
        <Card.Header>
          <p className="text-base">All metrics</p>
        </Card.Header>
        <Separator />
        <Card.Content>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Benchmark runs">
                <Table.Header>
                  <Table.Column isRowHeader>runId</Table.Column>
                  <Table.Column>label</Table.Column>
                  <Table.Column>total</Table.Column>
                  <Table.Column>completed</Table.Column>
                  <Table.Column>failed</Table.Column>
                  <Table.Column>in-flight</Table.Column>
                  <Table.Column>p50ms</Table.Column>
                  <Table.Column>p95ms</Table.Column>
                  <Table.Column>success</Table.Column>
                  <Table.Column>scored</Table.Column>
                  <Table.Column>avgScore</Table.Column>
                  <Table.Column>est</Table.Column>
                  <Table.Column>MAE</Table.Column>
                  <Table.Column>bias</Table.Column>
                </Table.Header>
                <Table.Body>
                  {rows.map((r) => (
                    <Table.Row key={r.runId} id={r.runId}>
                      <Table.Cell>
                        <Code>{r.runId.slice(0, 12)}…</Code>
                      </Table.Cell>
                      <Table.Cell>{r.label ?? '—'}</Table.Cell>
                      <Table.Cell>{r.total}</Table.Cell>
                      <Table.Cell>{r.completed}</Table.Cell>
                      <Table.Cell>{r.failed}</Table.Cell>
                      <Table.Cell>{r.inFlight}</Table.Cell>
                      <Table.Cell>{r.p50LatencyMs}</Table.Cell>
                      <Table.Cell>{r.p95LatencyMs}</Table.Cell>
                      <Table.Cell>{(r.successRate * 100).toFixed(1)}%</Table.Cell>
                      <Table.Cell>{r.scored}</Table.Cell>
                      <Table.Cell>{r.avgScore != null ? r.avgScore.toFixed(3) : '—'}</Table.Cell>
                      <Table.Cell>{r.estimated}</Table.Cell>
                      <Table.Cell>
                        {r.meanAbsError != null ? r.meanAbsError.toFixed(2) : '—'}
                      </Table.Cell>
                      <Table.Cell>{r.bias != null ? formatBias(r.bias) : '—'}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>
    </div>
  );
}

/**
 * Format signed bias with an explicit sign so the direction is obvious
 * at a glance. Negative values already render with "-"; positive get a
 * leading "+".
 */
function formatBias(b: number): string {
  const r = b.toFixed(2);
  return b > 0 ? `+${r}` : r;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Build per-row record where each key is a run's display label and
 * the value is the metric. Recharts uses the dataKey to pick the
 * column, so we project { metric, "qwen-0.6b": 0.83, "qwen-4b": 0.91 }.
 */
function rowsByLabel(
  rows: BenchmarkRunSummary[],
  pick: (r: BenchmarkRunSummary) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[labelKey(r)] = pick(r);
  }
  return out;
}

function labelKey(r: BenchmarkRunSummary): string {
  return r.label?.trim() ? r.label : r.runId.slice(0, 8);
}

import { Button, Chip, Table } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Code, LoadingSpinner } from '../components/ui';
import { Job, jobs } from '../lib/api';

export default function JobsPage() {
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobs.list,
    refetchInterval: 3_000,
  });

  if (isPending) return <LoadingSpinner label="Loading jobs…" />;
  if (error) return <Code color="danger">{String(error)}</Code>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onPress={() => navigate('/jobs/new')}>
          New job
        </Button>
      </div>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Jobs">
            <Table.Header>
              <Table.Column isRowHeader>job id</Table.Column>
              <Table.Column>flow</Table.Column>
              <Table.Column>product</Table.Column>
              <Table.Column>status</Table.Column>
              <Table.Column>started</Table.Column>
              <Table.Column>completed</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => <p className="text-center py-4 text-muted">No jobs yet.</p>}
            >
              {(data ?? []).map((j: Job) => (
                <Table.Row key={j.id} id={j.id}>
                  <Table.Cell>
                    <Code>{j.id.slice(0, 16)}…</Code>
                  </Table.Cell>
                  <Table.Cell>{j.flowId}</Table.Cell>
                  <Table.Cell>{j.productId}</Table.Cell>
                  <Table.Cell>{statusChip(j.status)}</Table.Cell>
                  <Table.Cell className="text-xs text-muted">
                    {j.startedAt ? new Date(j.startedAt).toLocaleTimeString() : '—'}
                  </Table.Cell>
                  <Table.Cell className="text-xs text-muted">
                    {j.completedAt ? new Date(j.completedAt).toLocaleTimeString() : '—'}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function statusChip(status: Job['status']) {
  const color =
    status === 'completed'
      ? 'success'
      : status === 'failed' || status === 'cancelled'
        ? 'danger'
        : status === 'running'
          ? 'accent'
          : 'default';
  return (
    <Chip size="sm" color={color} variant="soft">
      {status}
    </Chip>
  );
}

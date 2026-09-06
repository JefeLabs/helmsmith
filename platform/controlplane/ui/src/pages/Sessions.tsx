import { Chip, Table } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Code, LoadingSpinner } from '../components/ui';
import { IntentSession, intent } from '../lib/api';

export default function SessionsPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: intent.list,
    refetchInterval: 3_000,
  });

  if (isPending) return <LoadingSpinner label="Loading sessions…" />;
  if (error) return <Code color="danger">{String(error)}</Code>;

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Intent sessions">
          <Table.Header>
            <Table.Column isRowHeader>session</Table.Column>
            <Table.Column>pipeline</Table.Column>
            <Table.Column>status</Table.Column>
            <Table.Column>intake job</Table.Column>
            <Table.Column>work job</Table.Column>
            <Table.Column>created</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <p className="text-center py-4 text-muted">No sessions yet — start one in Intake.</p>
            )}
          >
            {(data ?? []).map((s: IntentSession) => (
              <Table.Row key={s.id} id={s.id}>
                <Table.Cell>
                  <Link to={`/intake/${s.id}`} className="text-accent text-sm">
                    {s.id.slice(0, 8)}…
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <Code>{s.intakePipelineId}</Code>
                </Table.Cell>
                <Table.Cell>
                  <Chip size="sm" variant="soft">
                    {s.status}
                  </Chip>
                </Table.Cell>
                <Table.Cell className="text-xs font-mono">
                  {s.intakeJobId?.slice(0, 12) ?? '—'}
                </Table.Cell>
                <Table.Cell className="text-xs font-mono">
                  {s.workJobId?.slice(0, 12) ?? '—'}
                </Table.Cell>
                <Table.Cell className="text-xs text-muted">
                  {new Date(s.createdAt).toLocaleString()}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

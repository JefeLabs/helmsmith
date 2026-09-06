import { Card, Chip, Separator, Tabs } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { Code, LoadingSpinner } from '../components/ui';
import { catalog, Flow, Product } from '../lib/api';

export default function CatalogPage() {
  return (
    <Tabs defaultSelectedKey="flows">
      <Tabs.ListContainer>
        <Tabs.List aria-label="Catalog">
          <Tabs.Tab id="flows">
            Flows
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="products">
            Products
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="flows">
        <FlowsTab />
      </Tabs.Panel>
      <Tabs.Panel id="products">
        <ProductsTab />
      </Tabs.Panel>
    </Tabs>
  );
}

function FlowsTab() {
  const { data, isPending, error } = useQuery({ queryKey: ['flows'], queryFn: catalog.flows });
  if (isPending) return <LoadingSpinner label="Loading flows…" />;
  if (error) return <Code color="danger">{String(error)}</Code>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {(data ?? []).map((f: Flow) => (
        <Card key={f.id}>
          <Card.Header className="flex flex-row justify-between items-center">
            <Code>{f.id}</Code>
            <Chip size="sm" variant="soft" color={kindColor(f.kind)}>
              {f.kind}
            </Chip>
          </Card.Header>
          <Separator />
          <Card.Content className="gap-2 text-sm">
            <p className="text-foreground">{f.description ?? <em>no description</em>}</p>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">nodes ({nodeCount(f.nodes)})</summary>
              <pre className="bg-surface-secondary p-2 rounded mt-1 overflow-x-auto">
                {JSON.stringify(f.nodes, null, 2)}
              </pre>
            </details>
          </Card.Content>
        </Card>
      ))}
      {data && data.length === 0 && (
        <Card>
          <Card.Content>
            <p className="text-muted">
              No flows registered. Register one with <Code>POST /api/catalog/flows</Code>.
            </p>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function ProductsTab() {
  const { data, isPending, error } = useQuery({
    queryKey: ['products'],
    queryFn: catalog.products,
  });
  if (isPending) return <LoadingSpinner label="Loading products…" />;
  if (error) return <Code color="danger">{String(error)}</Code>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {(data ?? []).map((p: Product) => (
        <Card key={p.id}>
          <Card.Header>
            <div className="flex flex-col">
              <Code>{p.id}</Code>
              {p.displayName && <span className="text-sm">{p.displayName}</span>}
            </div>
          </Card.Header>
        </Card>
      ))}
    </div>
  );
}

function kindColor(kind: Flow['kind']) {
  return kind === 'work' ? 'accent' : kind === 'job-definition' ? 'success' : 'warning';
}

function nodeCount(nodes: unknown): number {
  return Array.isArray(nodes) ? nodes.length : 0;
}

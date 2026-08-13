import type { Catalog, FlowDef, Edge as SpecEdge, TaskStep } from '@helmsmith/flow-spec';
import { validateUnifiedCatalog } from '@helmsmith/flow-spec';
import type { Connection } from '@xyflow/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { loadServerCatalog, saveServerCatalog } from './catalog-client.ts';
import type { ValidationState } from './components/BottomPanel.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { Canvas } from './components/Canvas.tsx';
import { PropertyPanel } from './components/PropertyPanel.tsx';
import type { DesignerEdge, DesignerNode } from './graph-model.ts';
import { flowToGraph, graphToFlow, newStep } from './graph-model.ts';
import { kindColor, STEP_KINDS } from './kinds.ts';
import { SAMPLE_CATALOG } from './sample-catalog.ts';

interface Selection {
  type: 'node' | 'edge';
  id: string;
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog>(SAMPLE_CATALOG);
  const [flowId, setFlowId] = useState<string>(SAMPLE_CATALOG.flows[0]?.id ?? '');
  const initial = useMemo(() => flowToGraph(SAMPLE_CATALOG.flows[0] as FlowDef), []);
  const [nodes, setNodes] = useState<DesignerNode[]>(initial.nodes);
  const [edges, setEdges] = useState<DesignerEdge[]>(initial.edges);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [serverStatus, setServerStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const currentFlow = catalog.flows.find((f) => f.id === flowId);

  /** The catalog with the canvas's live edits folded in — what gets
   *  validated on every change and what export writes. */
  const liveCatalog: Catalog = useMemo(() => {
    if (!currentFlow) return catalog;
    return {
      ...catalog,
      flows: catalog.flows.map((f) =>
        f.id === flowId ? graphToFlow(currentFlow, nodes, edges) : f,
      ),
    };
  }, [catalog, currentFlow, flowId, nodes, edges]);

  const validation: ValidationState = useMemo(() => {
    const warnings: ValidationState['warnings'] = [];
    try {
      validateUnifiedCatalog(structuredClone(liveCatalog), 'designer', {
        onUnsupported: (f) => warnings.push(f),
      });
      return { errors: [], warnings };
    } catch (err) {
      return { errors: [(err as Error).message], warnings };
    }
  }, [liveCatalog]);

  const commitGraph = useCallback((nextNodes: DesignerNode[], nextEdges: DesignerEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  const switchFlow = useCallback(
    (id: string) => {
      // Fold current canvas state into the catalog, then load the target.
      const folded = liveCatalog;
      setCatalog(folded);
      const target = folded.flows.find((f) => f.id === id);
      if (!target) return;
      const graph = flowToGraph(target);
      setFlowId(id);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setSelection(null);
    },
    [liveCatalog],
  );

  const addNode = useCallback(
    (kind: TaskStep['kind']) => {
      const step = newStep(
        kind,
        nodes.map((n) => n.data.step),
      );
      const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
      const node: DesignerNode = {
        id: step.id,
        type: 'step',
        position: { x: maxX + 260, y: 120 + (nodes.length % 3) * 110 },
        data: { step },
      };
      commitGraph([...nodes, node], edges);
      setSelection({ type: 'node', id: step.id });
    },
    [nodes, edges, commitGraph],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edge: SpecEdge = { from: connection.source, to: connection.target, type: 'sequence' };
      const dEdge: DesignerEdge = {
        id: `e${edges.length}:${Date.now()}:${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        data: { edge },
      };
      commitGraph(nodes, [...edges, dEdge]);
      setSelection({ type: 'edge', id: dEdge.id });
    },
    [nodes, edges, commitGraph],
  );

  const updateStep = useCallback(
    (id: string, step: TaskStep) => {
      commitGraph(
        nodes.map((n) => (n.id === id ? { ...n, data: { step } } : n)),
        edges,
      );
    },
    [nodes, edges, commitGraph],
  );

  const renameStep = useCallback(
    (id: string, nextId: string) => {
      commitGraph(
        nodes.map((n) =>
          n.id === id ? { ...n, id: nextId, data: { step: { ...n.data.step, id: nextId } } } : n,
        ),
        edges.map((e) => ({
          ...e,
          source: e.source === id ? nextId : e.source,
          target: e.target === id ? nextId : e.target,
        })),
      );
      setSelection({ type: 'node', id: nextId });
    },
    [nodes, edges, commitGraph],
  );

  const updateEdge = useCallback(
    (id: string, edge: SpecEdge) => {
      commitGraph(
        nodes,
        edges.map((e) => (e.id === id ? { ...e, data: { edge } } : e)),
      );
    },
    [nodes, edges, commitGraph],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.type === 'node') {
      commitGraph(
        nodes.filter((n) => n.id !== selection.id),
        edges.filter((e) => e.source !== selection.id && e.target !== selection.id),
      );
    } else {
      commitGraph(
        nodes,
        edges.filter((e) => e.id !== selection.id),
      );
    }
    setSelection(null);
  }, [selection, nodes, edges, commitGraph]);

  const relayout = useCallback(() => {
    if (!currentFlow) return;
    const graph = flowToGraph(graphToFlow(currentFlow, nodes, edges));
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [currentFlow, nodes, edges]);

  const addFlow = useCallback(() => {
    const base = 'new-flow';
    let id = base;
    let n = 1;
    while (liveCatalog.flows.some((f) => f.id === id)) id = `${base}-${++n}`;
    const flow: FlowDef = {
      id,
      nodes: [{ id: 'start', kind: 'trigger', config: { kind: 'manual' } }],
      edges: [],
    };
    const next = { ...liveCatalog, flows: [...liveCatalog.flows, flow] };
    setCatalog(next);
    const graph = flowToGraph(flow);
    setFlowId(id);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelection(null);
  }, [liveCatalog]);

  const loadCatalogState = useCallback((parsed: Catalog) => {
    setCatalog(parsed);
    const first = parsed.flows[0] as FlowDef;
    const graph = flowToGraph(first);
    setFlowId(first.id);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelection(null);
  }, []);

  const serverLoad = useCallback(() => {
    setServerStatus({ text: 'loading…', ok: true });
    loadServerCatalog('/harness')
      .then((parsed) => {
        if (parsed.flows.length === 0) throw new Error('server catalog has no flows');
        loadCatalogState(parsed);
        setServerStatus({ text: `loaded ${parsed.flows.length} flow(s) ⇩`, ok: true });
      })
      .catch((err) => setServerStatus({ text: (err as Error).message, ok: false }));
  }, [loadCatalogState]);

  const serverSave = useCallback(() => {
    setServerStatus({ text: 'saving…', ok: true });
    saveServerCatalog('/harness', liveCatalog)
      .then((r) =>
        setServerStatus({
          text: `saved ${r.flowCount} flow(s) ⇧${r.warnings.length > 0 ? ` · ${r.warnings.length} warning(s)` : ''}`,
          ok: true,
        }),
      )
      .catch((err) => setServerStatus({ text: (err as Error).message, ok: false }));
  }, [liveCatalog]);

  const importCatalog = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as Catalog;
          if (!Array.isArray(parsed.flows) || parsed.flows.length === 0) {
            alert('catalog has no flows');
            return;
          }
          loadCatalogState(parsed);
        } catch (err) {
          alert(`not a catalog: ${(err as Error).message}`);
        }
      });
    },
    [loadCatalogState],
  );

  const exportCatalog = useCallback(() => {
    const blob = new Blob([`${JSON.stringify(liveCatalog, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flows.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [liveCatalog]);

  const lampColor =
    validation.errors.length > 0
      ? 'var(--error)'
      : validation.warnings.length > 0
        ? 'var(--warn)'
        : 'var(--ok)';

  return (
    <div className="grid h-full" style={{ gridTemplateRows: '52px minmax(0,1fr) 220px' }}>
      {/* ── Toolbar ── */}
      <header
        className="panel flex items-center gap-4 border-x-0 border-t-0 px-4"
        style={{ background: 'var(--ink-deep)' }}
      >
        <span className="font-display text-lg" style={{ color: 'var(--brass)' }}>
          Helmsmith
        </span>
        <span className="panel-title">flow designer</span>
        <span className="status-lamp" style={{ background: lampColor }} title="catalog status" />
        <div className="ml-auto flex items-center gap-2">
          {serverStatus && (
            <span
              className="font-mono text-[11px]"
              style={{ color: serverStatus.ok ? 'var(--dim)' : 'var(--error)' }}
              title={serverStatus.text}
            >
              {serverStatus.text.length > 60
                ? `${serverStatus.text.slice(0, 59)}…`
                : serverStatus.text}
            </span>
          )}
          <button type="button" className="btn" onClick={serverLoad}>
            server ⇩
          </button>
          <button type="button" className="btn" onClick={serverSave}>
            server ⇧
          </button>
          <button type="button" className="btn" onClick={relayout}>
            relayout
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            import
          </button>
          <button type="button" className="btn primary" onClick={exportCatalog}>
            export flows.json
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCatalog(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {/* ── Main ── */}
      <div className="grid min-h-0" style={{ gridTemplateColumns: '216px minmax(0,1fr) 340px' }}>
        <aside className="panel flex min-h-0 flex-col border-y-0 border-l-0">
          <div className="border-b px-3 py-2" style={{ borderColor: 'var(--line-soft)' }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="panel-title">flows</span>
              <button type="button" className="btn" onClick={addFlow}>
                +
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {liveCatalog.flows.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`flow-tab ${f.id === flowId ? 'active' : ''}`}
                  onClick={() => switchFlow(f.id)}
                >
                  {f.id}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <div className="panel-title mb-2">add step</div>
            {STEP_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="palette-item"
                onClick={() => addNode(kind)}
              >
                <span className="palette-dot" style={{ background: kindColor(kind) }} />
                {kind}
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0">
          <Canvas
            nodes={nodes}
            edges={edges}
            onGraphChange={commitGraph}
            onSelect={setSelection}
            onConnect={onConnect}
          />
        </main>

        <aside className="panel min-h-0 border-y-0 border-r-0">
          <PropertyPanel
            selection={selection}
            nodes={nodes}
            edges={edges}
            onUpdateStep={updateStep}
            onRenameStep={renameStep}
            onUpdateEdge={updateEdge}
            onDeleteSelection={deleteSelection}
          />
        </aside>
      </div>

      {/* ── Bottom ── */}
      <footer className="panel border-x-0 border-b-0">
        <BottomPanel validation={validation} />
      </footer>
    </div>
  );
}

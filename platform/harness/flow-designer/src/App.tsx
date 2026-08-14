import type { Catalog, FlowDef, Edge as SpecEdge, TaskStep } from '@helmsmith/flow-spec';
import { validateUnifiedCatalog } from '@helmsmith/flow-spec';
import type { Connection } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadServerCatalog,
  loadServerLayout,
  saveServerCatalog,
  saveServerLayout,
} from './catalog-client.ts';
import type { ValidationState } from './components/BottomPanel.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { Canvas } from './components/Canvas.tsx';
import { PropertyPanel } from './components/PropertyPanel.tsx';
import { SubflowPreview } from './components/SubflowPreview.tsx';
import type { DesignerEdge, DesignerNode } from './graph-model.ts';
import { flowToGraph, graphToFlow, newStep } from './graph-model.ts';
import { emptyHistory, type History, recorded, redone, undone } from './history.ts';
import { kindColor, STEP_KINDS } from './kinds.ts';
import {
  appliedLayout,
  capturedLayout,
  isLayoutFile,
  layoutsForFlows,
  readLayouts,
  writeLayout,
  writeLayouts,
} from './layout-store.ts';
import { SAMPLE_CATALOG } from './sample-catalog.ts';

interface Selection {
  type: 'node' | 'edge';
  id: string;
}

export interface FlowDesignerProps {
  /** Catalog to open with. Defaults to the built-in sample. */
  initialCatalog?: Catalog;
  /** Fires with the LIVE catalog (canvas edits folded in) after every
   *  change — how a host app observes/persists the user's work. */
  onCatalogChange?: (catalog: Catalog) => void;
  /** Base URL for the harness/controlplane /v1/catalog wire shape.
   *  Default '/harness' (the dev/npx proxy path). Pass null to hide
   *  the server ⇩/⇧ buttons entirely (file-only embedding). */
  serverBase?: string | null;
  /** Theming overrides: --flow-* custom properties (see styles.css /
   *  README for the contract) set inline on the component root. Plain
   *  CSS (`.my-theme .flow-designer { --flow-accent: … }`) reaches the
   *  same properties without this prop. */
  theme?: Readonly<Record<string, string>>;
  /** Toolbar wordmark. Defaults to the Helmsmith wordmark for the
   *  standalone app; pass null to render no brand at all (embeds). */
  brand?: React.ReactNode | null;
}

/** Map a flow to canvas shapes, overlaying any layout persisted for it —
 *  the one load path shared by mount/switch/import/server-load. `relayout`
 *  deliberately bypasses this: it is the explicit recompute. */
function loadGraph(flow: FlowDef): { nodes: DesignerNode[]; edges: DesignerEdge[] } {
  const graph = flowToGraph(flow);
  return {
    nodes: appliedLayout(graph.nodes, readLayouts(localStorage)[flow.id]),
    edges: graph.edges,
  };
}

export function FlowDesigner({
  initialCatalog = SAMPLE_CATALOG,
  onCatalogChange,
  serverBase = '/harness',
  theme,
  brand = 'Helmsmith',
}: FlowDesignerProps = {}) {
  const [catalog, setCatalog] = useState<Catalog>(initialCatalog);
  const [flowId, setFlowId] = useState<string>(initialCatalog.flows[0]?.id ?? '');
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial mount only
  const initial = useMemo(() => loadGraph(initialCatalog.flows[0] as FlowDef), []);
  const [nodes, setNodes] = useState<DesignerNode[]>(initial.nodes);
  const [edges, setEdges] = useState<DesignerEdge[]>(initial.edges);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [serverStatus, setServerStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory);
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

  // Host-app observation: every change surfaces the live catalog.
  useEffect(() => {
    onCatalogChange?.(liveCatalog);
  }, [liveCatalog, onCatalogChange]);

  const commitGraph = useCallback((nextNodes: DesignerNode[], nextEdges: DesignerEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  /** Snapshot the PRE-mutation state — called at every semantic
   *  mutation point (and once per drag, from the canvas). */
  const recordPoint = useCallback(() => {
    setHistory((h) => recorded(h, { nodes, edges }));
  }, [nodes, edges]);

  const undoAction = useCallback(() => {
    const r = undone(history, { nodes, edges });
    if (!r) return;
    setHistory(r.history);
    setNodes(r.snapshot.nodes);
    setEdges(r.snapshot.edges);
    setSelection(null);
  }, [history, nodes, edges]);

  const redoAction = useCallback(() => {
    const r = redone(history, { nodes, edges });
    if (!r) return;
    setHistory(r.history);
    setNodes(r.snapshot.nodes);
    setEdges(r.snapshot.edges);
    setSelection(null);
  }, [history, nodes, edges]);

  // Persist whatever the canvas shows — drags, undo, relayout all flow
  // through here, so the stored layout is always the visible one.
  // (flowId and nodes update in the same batch on every load path.)
  useEffect(() => {
    writeLayout(localStorage, flowId, capturedLayout(nodes));
  }, [nodes, flowId]);

  // ⌘Z / ⌘⇧Z (and Ctrl+Y) — suppressed while typing so native text
  // undo inside inputs/textareas keeps working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoAction, redoAction]);

  const switchFlow = useCallback(
    (id: string) => {
      // Fold current canvas state into the catalog, then load the target.
      const folded = liveCatalog;
      setCatalog(folded);
      const target = folded.flows.find((f) => f.id === id);
      if (!target) return;
      const graph = loadGraph(target);
      setFlowId(id);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setSelection(null);
      setHistory(emptyHistory); // history is per-flow-session (v1)
    },
    [liveCatalog],
  );

  const addNode = useCallback(
    (kind: TaskStep['kind']) => {
      const step = newStep(
        kind,
        nodes.map((n) => n.data.step),
      );
      recordPoint();
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
    [nodes, edges, commitGraph, recordPoint],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      recordPoint();
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
    [nodes, edges, commitGraph, recordPoint],
  );

  const updateStep = useCallback(
    (id: string, step: TaskStep) => {
      const existing = nodes.find((n) => n.id === id);
      // No-op applies (JsonField blurs without changes) create no history.
      if (existing && JSON.stringify(existing.data.step) === JSON.stringify(step)) return;
      recordPoint();
      commitGraph(
        nodes.map((n) => (n.id === id ? { ...n, data: { step } } : n)),
        edges,
      );
    },
    [nodes, edges, commitGraph, recordPoint],
  );

  const renameStep = useCallback(
    (id: string, nextId: string) => {
      recordPoint();
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
    [nodes, edges, commitGraph, recordPoint],
  );

  const updateEdge = useCallback(
    (id: string, edge: SpecEdge) => {
      const existing = edges.find((e) => e.id === id);
      if (existing && JSON.stringify(existing.data.edge) === JSON.stringify(edge)) return;
      recordPoint();
      commitGraph(
        nodes,
        edges.map((e) => (e.id === id ? { ...e, data: { edge } } : e)),
      );
    },
    [nodes, edges, commitGraph, recordPoint],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    recordPoint();
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
  }, [selection, nodes, edges, commitGraph, recordPoint]);

  const relayout = useCallback(() => {
    if (!currentFlow) return;
    recordPoint();
    const graph = flowToGraph(graphToFlow(currentFlow, nodes, edges));
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [currentFlow, nodes, edges, recordPoint]);

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
    const graph = loadGraph(flow);
    setFlowId(id);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelection(null);
    setHistory(emptyHistory);
  }, [liveCatalog]);

  const loadCatalogState = useCallback((parsed: Catalog) => {
    setCatalog(parsed);
    const first = parsed.flows[0] as FlowDef;
    const graph = loadGraph(first);
    setFlowId(first.id);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelection(null);
    setHistory(emptyHistory);
  }, []);

  const serverLoad = useCallback(() => {
    if (serverBase === null) return;
    setServerStatus({ text: 'loading…', ok: true });
    loadServerCatalog(serverBase)
      .then(async (parsed) => {
        if (parsed.flows.length === 0) throw new Error('server catalog has no flows');
        // Layout sidecar rides along, best-effort: seed the store
        // BEFORE loading state so loadGraph overlays the shared
        // arrangement. A server without the route changes nothing.
        const layouts = await loadServerLayout(serverBase);
        if (layouts) writeLayouts(localStorage, layouts);
        loadCatalogState(parsed);
        setServerStatus({ text: `loaded ${parsed.flows.length} flow(s) ⇩`, ok: true });
      })
      .catch((err) => setServerStatus({ text: (err as Error).message, ok: false }));
  }, [loadCatalogState, serverBase]);

  const serverSave = useCallback(() => {
    if (serverBase === null) return;
    setServerStatus({ text: 'saving…', ok: true });
    saveServerCatalog(serverBase, liveCatalog)
      .then((r) => {
        // The arrangement travels with the save, best-effort — a
        // failure (or a server without the route) never blocks.
        void saveServerLayout(
          serverBase,
          layoutsForFlows(
            localStorage,
            liveCatalog.flows.map((f) => f.id),
          ),
        );
        setServerStatus({
          text: `saved ${r.flowCount} flow(s) ⇧${r.warnings.length > 0 ? ` · ${r.warnings.length} warning(s)` : ''}`,
          ok: true,
        });
      })
      .catch((err) => setServerStatus({ text: (err as Error).message, ok: false }));
  }, [liveCatalog, serverBase]);

  const importCatalog = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as unknown;
          // A layout sidecar (flows.layout.json) imports into the
          // layout store and re-arranges the current canvas — the
          // catalog itself is untouched.
          if (isLayoutFile(parsed)) {
            recordPoint();
            writeLayouts(localStorage, parsed);
            setNodes((ns) => appliedLayout(ns, readLayouts(localStorage)[flowId]));
            setServerStatus({
              text: `layout imported for ${Object.keys(parsed).length} flow(s)`,
              ok: true,
            });
            return;
          }
          const catalogParsed = parsed as Catalog;
          if (!Array.isArray(catalogParsed.flows) || catalogParsed.flows.length === 0) {
            alert('catalog has no flows');
            return;
          }
          loadCatalogState(catalogParsed);
        } catch (err) {
          alert(`not a catalog: ${(err as Error).message}`);
        }
      });
    },
    [loadCatalogState, recordPoint, flowId],
  );

  const exportCatalog = useCallback(() => {
    const download = (name: string, value: unknown) => {
      const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };
    download('flows.json', liveCatalog);
    // The arrangement travels as a SIDECAR file — the catalog itself
    // stays byte-pure (FlowDef carries no editor concerns). Skipped
    // when nothing is arranged.
    const layouts = layoutsForFlows(
      localStorage,
      liveCatalog.flows.map((f) => f.id),
    );
    if (Object.keys(layouts).length > 0) download('flows.layout.json', layouts);
  }, [liveCatalog]);

  const lampColor =
    validation.errors.length > 0
      ? 'var(--flow-error)'
      : validation.warnings.length > 0
        ? 'var(--flow-warn)'
        : 'var(--flow-ok)';

  // A selected subflow step reveals its child flow in the translucent
  // inset under the canvas — resolved by flowId against the live catalog.
  const selectedSubflow = useMemo(() => {
    if (selection?.type !== 'node') return null;
    const step = nodes.find((n) => n.id === selection.id)?.data.step;
    if (!step || step.kind !== 'subflow') return null;
    const cfg = step.config as { flowId?: string; version?: string };
    const target = cfg.flowId ?? '';
    return {
      target,
      version: cfg.version,
      flow: liveCatalog.flows.find((f) => f.id === target),
    };
  }, [selection, nodes, liveCatalog]);

  return (
    <div
      className="flow-designer grid h-full"
      style={{ gridTemplateRows: '52px minmax(0,1fr) 220px', ...theme } as React.CSSProperties}
    >
      {/* ── Toolbar ── */}
      <header
        className="panel flex items-center gap-4 border-x-0 border-t-0 px-4"
        style={{ background: 'var(--flow-app-bg)' }}
      >
        {brand !== null && (
          <span className="font-display text-lg" style={{ color: 'var(--flow-accent)' }}>
            {brand}
          </span>
        )}
        <span className="panel-title">flow designer</span>
        <span className="status-lamp" style={{ background: lampColor }} title="catalog status" />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={undoAction}
            disabled={history.past.length === 0}
            style={history.past.length === 0 ? { opacity: 0.35, cursor: 'default' } : undefined}
            title="undo (⌘Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn"
            onClick={redoAction}
            disabled={history.future.length === 0}
            style={history.future.length === 0 ? { opacity: 0.35, cursor: 'default' } : undefined}
            title="redo (⌘⇧Z)"
          >
            ↷
          </button>
          {serverStatus && (
            <span
              className="font-mono text-[11px]"
              style={{ color: serverStatus.ok ? 'var(--flow-text-dim)' : 'var(--flow-error)' }}
              title={serverStatus.text}
            >
              {serverStatus.text.length > 60
                ? `${serverStatus.text.slice(0, 59)}…`
                : serverStatus.text}
            </span>
          )}
          {serverBase !== null && (
            <>
              <button type="button" className="btn" onClick={serverLoad}>
                server ⇩
              </button>
              <button type="button" className="btn" onClick={serverSave}>
                server ⇧
              </button>
            </>
          )}
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
          <div className="border-b px-3 py-2" style={{ borderColor: 'var(--flow-border-soft)' }}>
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

        <main className="relative min-h-0">
          <Canvas
            nodes={nodes}
            edges={edges}
            onGraphChange={commitGraph}
            onSelect={setSelection}
            onConnect={onConnect}
            onRecordPoint={recordPoint}
          />
          {selectedSubflow && (
            <SubflowPreview
              flow={selectedSubflow.flow}
              targetId={selectedSubflow.target}
              versionPin={selectedSubflow.version}
              onOpen={() => switchFlow(selectedSubflow.target)}
            />
          )}
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

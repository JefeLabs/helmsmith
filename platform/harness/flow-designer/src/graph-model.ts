/**
 * Pure FlowDef ↔ canvas-graph mapping. Kept free of React Flow imports
 * so the round-trip is unit-testable in node: the canvas renders THESE
 * shapes, and every canvas mutation flows back through `graphToFlow`
 * before validation/export — the FlowDef stays the single source of
 * truth, exactly as the runtime consumes it.
 *
 * Layout: FlowDef carries no positions (deliberately — layout is a
 * designer concern, not wire contract), so `flowToGraph` computes a
 * left-to-right layered layout via dagre on import/switch. Hand-arranged
 * positions persist as a browser-local sidecar (layout-store.ts) that
 * loads overlay on top of this computed baseline.
 */
import dagre from '@dagrejs/dagre';
import type { FlowDef, Edge as SpecEdge, TaskStep } from '@helmsmith/flow-spec';

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 76;

export interface DesignerNodeData {
  step: TaskStep;
  [key: string]: unknown;
}

export interface DesignerNode {
  id: string;
  type: 'step';
  position: { x: number; y: number };
  data: DesignerNodeData;
}

export interface DesignerEdgeData {
  edge: SpecEdge;
  [key: string]: unknown;
}

export interface DesignerEdge {
  id: string;
  source: string;
  target: string;
  data: DesignerEdgeData;
}

export function flowToGraph(flow: FlowDef): { nodes: DesignerNode[]; edges: DesignerEdge[] } {
  const positions = layoutPositions(flow);
  const nodes: DesignerNode[] = flow.nodes.map((step) => ({
    id: step.id,
    type: 'step',
    position: positions.get(step.id) ?? { x: 0, y: 0 },
    data: { step },
  }));
  const edges: DesignerEdge[] = flow.edges.map((edge, i) => ({
    id: `e${i}:${edge.type}:${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    data: { edge },
  }));
  return { nodes, edges };
}

/**
 * Reassemble a FlowDef from canvas state. Step bodies come from node
 * data (the property panel edits them there); edge bodies come from
 * edge data with `from`/`to` rewritten from the canvas connection so
 * drag-reconnects survive the round trip.
 */
export function graphToFlow(
  base: FlowDef,
  nodes: readonly DesignerNode[],
  edges: readonly DesignerEdge[],
): FlowDef {
  return {
    ...base,
    nodes: nodes.map((n) => n.data.step),
    edges: edges.map((e) => ({ ...e.data.edge, from: e.source, to: e.target })),
  };
}

function layoutPositions(flow: FlowDef): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96, marginx: 32, marginy: 32 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const step of flow.nodes) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of flow.edges) {
    // Reject edges cycle backward — excluding them keeps the layered
    // layout reading left-to-right like the router's forward pass.
    if (edge.type === 'reject') continue;
    g.setEdge(edge.from, edge.to);
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const step of flow.nodes) {
    const pos = g.node(step.id);
    // dagre centers nodes; React Flow anchors top-left.
    out.set(step.id, { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 });
  }
  return out;
}

/** Fresh minimal step for palette drops, unique-id'd against the flow. */
export function newStep(kind: TaskStep['kind'], existing: readonly TaskStep[]): TaskStep {
  let n = 1;
  let id = kind === 'trigger' ? 'trigger' : `${kind}-${n}`;
  const ids = new Set(existing.map((s) => s.id));
  while (ids.has(id)) {
    n += 1;
    id = `${kind}-${n}`;
  }
  const config: Record<TaskStep['kind'], unknown> = {
    trigger: { kind: 'manual' },
    agent: { agent: { id, role: 'Agent', adapter: 'claude-sdk' } },
    tool: { toolId: 'core:tools:jq' },
    script: { language: 'bash', source: 'true' },
    transform: { expression: { kind: 'jsonpath', path: '$.output' } },
    gate: {
      assertions: [
        {
          expression: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.output' } },
          message: 'output exists',
        },
      ],
    },
    subflow: { flowId: 'inner' },
    publish: { action: 'push-and-open-pr' },
  };
  return { id, kind, config: config[kind] as TaskStep['config'] };
}

import type { Edge as SpecEdge } from '@helmsmith/flow-spec';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useRef } from 'react';
import type { DesignerEdge, DesignerNode } from '../graph-model.ts';
import { StepNode } from './StepNode.tsx';

const nodeTypes = { step: StepNode };

/** Chart line-work per edge kind. */
function edgeStyle(edge: SpecEdge): {
  stroke: string;
  dash?: string;
  label: string;
  animated?: boolean;
} {
  switch (edge.type) {
    case 'sequence':
      return { stroke: '#5b7495', label: '' };
    case 'conditional':
      return { stroke: '#4cc9f0', dash: '7 4', label: 'if' };
    case 'error': {
      const on = edge.on && edge.on.length > 0 ? edge.on.join(',') : '✱';
      return { stroke: '#e5484d', dash: '3 3', label: `err:${on}` };
    }
    case 'fallback':
      return { stroke: '#8296ad', dash: '1 5', label: 'fallback' };
    case 'reject':
      return {
        stroke: '#d9a441',
        dash: '9 4',
        label: `reject ≤${edge.maxAttempts ?? 3}`,
        animated: true,
      };
  }
}

export function Canvas({
  nodes,
  edges,
  onGraphChange,
  onSelect,
  onConnect,
  onRecordPoint,
}: {
  nodes: DesignerNode[];
  edges: DesignerEdge[];
  onGraphChange: (nodes: DesignerNode[], edges: DesignerEdge[]) => void;
  onSelect: (sel: { type: 'node' | 'edge'; id: string } | null) => void;
  onConnect: (connection: Connection) => void;
  /** History hook: called with the PRE-mutation state still current —
   *  once per drag (at drag-start) and before canvas-native removals.
   *  Selection churn never records. */
  onRecordPoint: () => void;
}) {
  const dragActive = useRef(false);
  const rfEdges = useMemo(
    () =>
      edges.map((e) => {
        const s = edgeStyle(e.data.edge);
        return {
          ...e,
          label: s.label || undefined,
          animated: s.animated ?? false,
          style: { stroke: s.stroke, strokeDasharray: s.dash, strokeWidth: 1.6 },
          labelStyle: { fill: s.stroke, fontFamily: 'IBM Plex Mono', fontSize: 10 },
          labelBgStyle: { fill: '#0a121d', fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
        };
      }),
    [edges],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<DesignerNode>[]) => {
      if (changes.some((c) => c.type === 'remove')) onRecordPoint();
      const dragging = changes.some((c) => c.type === 'position' && c.dragging === true);
      if (dragging && !dragActive.current) {
        dragActive.current = true;
        onRecordPoint(); // one entry per drag, at its start
      }
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
        dragActive.current = false;
      }
      onGraphChange(applyNodeChanges(changes, nodes), edges);
    },
    [nodes, edges, onGraphChange, onRecordPoint],
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<DesignerEdge>[]) => {
      if (changes.some((c) => c.type === 'remove')) onRecordPoint();
      onGraphChange(nodes, applyEdgeChanges(changes, edges) as DesignerEdge[]);
    },
    [nodes, edges, onGraphChange, onRecordPoint],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_ev, node) => onSelect({ type: 'node', id: node.id })}
      onEdgeClick={(_ev, edge) => onSelect({ type: 'edge', id: edge.id })}
      onPaneClick={() => onSelect(null)}
      fitView
      proOptions={{ hideAttribution: false }}
      deleteKeyCode={['Backspace', 'Delete']}
    >
      <Background variant={BackgroundVariant.Lines} gap={28} color="#14223622" />
      <Background variant={BackgroundVariant.Dots} gap={112} size={1.5} color="#2c425e" />
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
}

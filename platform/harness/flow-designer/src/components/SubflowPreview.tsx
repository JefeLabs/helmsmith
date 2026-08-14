import type { FlowDef } from '@helmsmith/flow-spec';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { flowToGraph } from '../graph-model.ts';
import { appliedLayout, readLayouts } from '../layout-store.ts';
import { decorateEdges, nodeTypes } from './Canvas.tsx';

/**
 * The translucent inset that appears under the canvas while a subflow
 * step is selected: the ACTUAL child flow (resolved by flowId from the
 * live catalog), rendered read-only with the same node cards and edge
 * styling as the main canvas. Unresolvable targets (and version pins,
 * which record but never drive resolution) get an explanatory note
 * instead of an empty band.
 */
export function SubflowPreview({
  flow,
  targetId,
  versionPin,
  onOpen,
}: {
  /** The resolved child flow, or undefined when the id has no match. */
  flow?: FlowDef;
  targetId: string;
  versionPin?: string;
  /** Jump-through: make the child the ACTIVE flow (full editing) on the
   *  same designer surface. The flows sidebar remains the way back. */
  onOpen?: () => void;
}) {
  const graph = useMemo(() => {
    if (!flow) return null;
    const g = flowToGraph(flow);
    return {
      nodes: appliedLayout(g.nodes, readLayouts(localStorage)[flow.id]),
      edges: decorateEdges(g.edges),
    };
  }, [flow]);

  return (
    <div className="subflow-inset" data-testid="subflow-inset">
      <div className="subflow-inset-head">
        <span className="panel-title">subflow · {targetId}</span>
        {versionPin && (
          <span className="subflow-inset-note">
            pinned {versionPin} — resolution stays by flowId
          </span>
        )}
        <span className="subflow-inset-note" style={{ marginLeft: 'auto' }}>
          read-only preview
        </span>
        {flow && onOpen && (
          <button type="button" className="btn tiny" onClick={onOpen}>
            open {targetId} →
          </button>
        )}
      </div>
      {graph ? (
        <div className="subflow-inset-body">
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="subflow-inset-empty">
          flow “{targetId}” is not in this catalog — nothing to preview
        </div>
      )}
    </div>
  );
}

/**
 * `@helmsmith/flow-designer` — the embeddable entry.
 *
 *   import { FlowDesigner } from '@helmsmith/flow-designer';
 *   import '@helmsmith/flow-designer/styles.css';
 *
 *   <FlowDesigner initialCatalog={catalog} onCatalogChange={save}
 *                 serverBase="/my-harness-proxy" />
 *
 * The component fills its container (height comes from the parent —
 * give it one). React/ReactDOM are peer dependencies; everything else
 * (React Flow, dagre, flow-spec, the compiled Tailwind utilities and
 * chart-room theme) is bundled into this entry and the stylesheet.
 * The `npx @helmsmith/flow-designer` app is this same component,
 * served standalone.
 */
import './styles.css';

export type { Catalog, FlowDef } from '@helmsmith/flow-spec';
export { FlowDesigner, type FlowDesignerProps } from './App.tsx';

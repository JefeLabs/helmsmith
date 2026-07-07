/**
 * Pages — full-screen experiences ready to launch from a CLI
 * handler. A page is a template + real content + the right organisms.
 *
 *   <ConnectView>          React component for embedded use
 *   runConnectView({})     functional wrapper for CLI .action() handlers
 *
 * Per Atomic Design: pages are concrete instances of templates.
 * They're the deepest level of the hierarchy and where domain
 * content lives.
 */

export type { ConnectViewProps } from './ConnectView.tsx';
export { ConnectView } from './ConnectView.tsx';
export type { RunConnectViewOptions } from './runConnectView.ts';
export { runConnectView } from './runConnectView.ts';
export type { RunTuiViewOptions } from './runTuiView.ts';
export { runTuiView } from './runTuiView.ts';

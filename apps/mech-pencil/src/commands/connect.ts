/**
 * `mech-pencil connect` — the uniform connections TUI every toolbox
 * app exposes (CONVENTIONS.md).
 *
 * mech-pencil is fully offline: it generates JSON locally and makes no
 * agent/API calls, so there are no required connections today. The
 * view renders the empty state. If a future "generate from an agent"
 * feature lands, register its `Connection` here (same pattern as
 * pritty), not a bespoke flow.
 */

import { runConnectView } from '@jefelabs/tui-view-components';

export async function runConnect(): Promise<void> {
  await runConnectView({ appName: 'mech-pencil' });
}

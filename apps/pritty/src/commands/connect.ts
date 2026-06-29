import { runConnectView } from '@helmsmith/tui-view-components';
import { githubCopilotConnection } from '../connections.js';

export async function runConnect(): Promise<void> {
  await runConnectView({
    appName: 'pritty',
    required: [githubCopilotConnection],
  });
}

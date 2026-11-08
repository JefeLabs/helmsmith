/**
 * Child-process fixture for `ConnectView.test.ts`: renders `<ConnectView>` in
 * openTUI's test renderer (which needs Bun), drives it with mock keys, and
 * prints `STATUS_CALLS=<n>` plus the settled frame between FRAME-BEGIN and
 * FRAME-END on stdout.
 *
 *   bun connect-render.ts <idle|login-fails> <themeDir>
 *
 * `idle`: one required connection, `optional` left to its default; the
 * view just sits there. `login-fails`: the connection's login() rejects; the
 * fixture presses enter on "login …" and waits until the view has re-fetched
 * status after the failure.
 */
import { testRender } from '@opentui/react/test-utils';
import { createElement } from 'react';
import type { Connection } from '../../connection.ts';
import { KeyboardProvider } from '../../keyboard/registry.tsx';
import { HelmsmithThemeProvider } from '../../theme/HelmsmithThemeProvider.tsx';
import { ConnectView } from '../ConnectView.tsx';

const [scenario, themeDir] = process.argv.slice(2);
if ((scenario !== 'idle' && scenario !== 'login-fails') || !themeDir) {
  throw new Error('usage: connect-render.ts <idle|login-fails> <themeDir>');
}

let statusCalls = 0;
let loginCalls = 0;
const service: Connection = {
  id: 'svc',
  displayName: 'Service',
  async getStatus() {
    statusCalls++;
    return { state: 'disconnected', message: 'not signed in' };
  },
  async login() {
    loginCalls++;
    throw new Error('device code expired');
  },
  async logout() {},
};

console.error = () => {}; // React's act() warnings; not what this fixture measures
const setup = await testRender(
  createElement(
    HelmsmithThemeProvider,
    { appName: 'connect-test', themeDir, watch: false },
    createElement(
      KeyboardProvider,
      null,
      createElement(ConnectView, {
        appName: 'connect-test',
        required: [service],
        onQuit: () => {},
      }),
    ),
  ),
  { width: 100, height: 24 },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, done: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await setup.renderOnce();
    if (done()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}; last frame:\n${setup.captureCharFrame()}`);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await setup.renderOnce();
    await sleep(20);
  }
}

// The login action is disabled until the first status fetch lands.
await until('the initial status', () => setup.captureCharFrame().includes('not signed in'));
if (scenario === 'login-fails') {
  const before = statusCalls;
  setup.mockInput.pressEnter();
  // login() rejected, then the view re-fetched status.
  await until('the post-failure refresh', () => loginCalls === 1 && statusCalls > before);
}
await settle();

process.stdout.write(
  `STATUS_CALLS=${statusCalls}\nFRAME-BEGIN\n${setup.captureCharFrame()}\nFRAME-END\n`,
);
setup.renderer.destroy();
process.exit(0);

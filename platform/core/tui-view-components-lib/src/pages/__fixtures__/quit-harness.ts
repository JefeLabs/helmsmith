/**
 * Child-process fixture for `teardown.test.ts`: mounts a real openTUI view
 * through one of the CLI harnesses, quits it, and prints `QUIT-RESOLVED`
 * once the harness promise resolves. The test then checks that the process
 * actually exits — a harness that leaves the renderer holding the terminal
 * keeps Bun alive forever.
 *
 *   bun quit-harness.ts <tui-view|connect-view> <themeDir>
 *
 * `tui-view` quits from the view's first effect; `connect-view` waits for
 * the test to send `q` on stdin, exercising the real keybinding path.
 */
import { createElement, useEffect } from 'react';
import { runConnectView } from '../runConnectView.ts';
import { runTuiView } from '../runTuiView.ts';

const [mode, themeDir] = process.argv.slice(2);
if (!themeDir) throw new Error('usage: quit-harness.ts <tui-view|connect-view> <themeDir>');

function QuitOnMount({ onQuit }: { onQuit: () => void }) {
  useEffect(() => {
    onQuit();
  }, [onQuit]);
  return null;
}

if (mode === 'tui-view') {
  await runTuiView({ appName: 'teardown-test', themeDir }, (onQuit) =>
    createElement(QuitOnMount, { onQuit }),
  );
} else if (mode === 'connect-view') {
  await runConnectView({ appName: 'teardown-test', themeDir });
} else {
  throw new Error(`unknown mode: ${mode}`);
}
process.stderr.write('QUIT-RESOLVED\n');

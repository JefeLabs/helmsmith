/**
 * `runConnectView` — programmatic entry point for CLI handlers.
 *
 * Mounts `<ConnectView>` through `runTuiView` (openTUI renderer +
 * `<HelmsmithThemeProvider>` + `<KeyboardProvider>`) so the CLI's `.action()`
 * can call this from a non-React context:
 *
 *   program.command("connect").action(() =>
 *     runConnectView({
 *       appName: "pritty",
 *       required: [githubCopilot],
 *     }),
 *   );
 */

import { createElement } from 'react';
import type { Connection } from '../connection.ts';
import { ConnectView } from './ConnectView.tsx';
import { runTuiView } from './runTuiView.ts';

export interface RunConnectViewOptions {
  appName: string;
  required?: Connection[];
  optional?: Connection[];
  /** Override the theme directory. Default: `~/.helmsmith/theme/`. */
  themeDir?: string;
  /** Theme to use if no `default.*` file exists yet. Default: rose-pine. */
  fallbackThemeName?: string;
}

/**
 * Mount the connect view as a full-screen openTUI app. Resolves when
 * the user quits (via `q` / Ctrl+C / process signals), after the
 * renderer has handed the terminal back.
 *
 * Built on `runTuiView`, which owns the openTUI bootstrap, the theme +
 * keyboard providers and the teardown.
 */
export async function runConnectView(opts: RunConnectViewOptions): Promise<void> {
  return runTuiView(
    { appName: opts.appName, themeDir: opts.themeDir, fallbackThemeName: opts.fallbackThemeName },
    (onQuit) =>
      createElement(ConnectView, {
        appName: opts.appName,
        required: opts.required,
        optional: opts.optional,
        onQuit,
      }),
  );
}

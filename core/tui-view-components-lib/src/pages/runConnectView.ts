/**
 * `runConnectView` — programmatic entry point for CLI handlers.
 *
 * Wraps `<ConnectView>` in `<AgentxThemeProvider>` + `<KeyboardProvider>`
 * + an openTUI renderer so the CLI's `.action()` can call this from
 * a non-React context:
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
import { KeyboardProvider } from '../keyboard/registry.tsx';
import { AgentxThemeProvider } from '../theme/AgentxThemeProvider.tsx';
import { ConnectView } from './ConnectView.tsx';

export interface RunConnectViewOptions {
  appName: string;
  required?: Connection[];
  optional?: Connection[];
  /** Override the theme directory. Default: `~/.agentx/theme/`. */
  themeDir?: string;
  /** Theme to use if no `default.*` file exists yet. Default: rose-pine. */
  fallbackThemeName?: string;
}

/**
 * Mount the connect view as a full-screen openTUI app. Resolves when
 * the user quits (via `q` / Ctrl+C / process signals).
 *
 * Implementation is split between this thin wrapper and the React
 * tree. The renderer setup uses `@opentui/core`'s `createCliRenderer`
 * + `@opentui/react`'s `createRoot`, dynamically imported so the
 * theme subsystem stays usable in non-TUI contexts.
 */
export async function runConnectView(opts: RunConnectViewOptions): Promise<void> {
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([
    import('@opentui/core'),
    import('@opentui/react'),
  ]);

  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      try {
        // Different @opentui versions expose unmount differently. Try a
        // few shapes; tolerate version drift.
        const r = root as { unmount?: () => void };
        r.unmount?.();
      } catch {
        /* ignore */
      }
      try {
        const rd = renderer as unknown as { stop?: () => void; close?: () => void };
        rd.stop?.();
        rd.close?.();
      } catch {
        /* ignore */
      }
      resolve();
    };

    // Pass children as the third arg to createElement (idiomatic React)
    // rather than as a `children` prop. This is what JSX desugars to and
    // is what biome's noChildrenProp rule expects.
    const tree = createElement(
      AgentxThemeProvider,
      {
        appName: opts.appName,
        fallbackThemeName: opts.fallbackThemeName,
        themeDir: opts.themeDir,
        watch: true,
      },
      createElement(
        KeyboardProvider,
        null,
        createElement(ConnectView, {
          appName: opts.appName,
          required: opts.required,
          optional: opts.optional,
          onQuit: cleanup,
        }),
      ),
    );
    root.render(tree);
  });
}

/**
 * `runTuiView` — generic full-screen TUI launcher for CLI handlers.
 *
 * This is the renderer-mounting harness extracted from `runConnectView`
 * so any app can launch its OWN page (a wizard, a dashboard, …) without
 * re-deriving the `@opentui` bootstrap + the version-tolerant teardown.
 *
 *   await runTuiView({ appName: "mech-pencil" }, (onQuit) =>
 *     createElement(MyView, { onQuit }),
 *   );
 *
 * The caller supplies a `render(onQuit)` that returns the page element.
 * `onQuit` tears the renderer down and resolves the returned promise —
 * wire it to your view's quit/finish path. `runConnectView` is built on
 * this.
 */

import { createElement, type ReactElement } from 'react';
import { KeyboardProvider } from '../keyboard/registry.tsx';
import { HelmsmithThemeProvider } from '../theme/HelmsmithThemeProvider.tsx';

export interface RunTuiViewOptions {
  appName: string;
  /** Override the theme directory. Default: `~/.helmsmith/theme/`. */
  themeDir?: string;
  /** Theme to use if no `default.*` file exists yet. Default: rose-pine. */
  fallbackThemeName?: string;
}

/**
 * Mount `render(onQuit)` as a full-screen openTUI app wrapped in the
 * standard theme + keyboard providers. Resolves when the view calls
 * the `onQuit` it was handed (quit key, finish, Ctrl+C path).
 */
export async function runTuiView(
  opts: RunTuiViewOptions,
  render: (onQuit: () => void) => ReactElement,
): Promise<void> {
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
        // destroy(), not stop(): stop() only pauses the render loop and keeps
        // the terminal and stdin, so the screen cleared on quit but the host
        // CLI never exited (teardown.test.ts).
        renderer.destroy();
      } catch {
        /* ignore */
      }
      resolve();
    };

    // children as the 3rd createElement arg (what JSX desugars to;
    // satisfies biome's noChildrenProp).
    const tree = createElement(
      HelmsmithThemeProvider,
      {
        appName: opts.appName,
        fallbackThemeName: opts.fallbackThemeName,
        themeDir: opts.themeDir,
        watch: true,
      },
      createElement(KeyboardProvider, null, render(cleanup)),
    );
    root.render(tree);
  });
}

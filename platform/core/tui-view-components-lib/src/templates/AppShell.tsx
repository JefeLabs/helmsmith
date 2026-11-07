/**
 * `<AppShell>` — the canonical provider stack every TUI app mounts
 * at its root. Replaces the manual triple-stack of providers with
 * one wrapper.
 *
 * Without AppShell:
 *
 *   <HelmsmithThemeProvider appName="myapp" watch>
 *     <KeyboardProvider>
 *       <FocusManager>
 *         <App />
 *       </FocusManager>
 *     </KeyboardProvider>
 *   </HelmsmithThemeProvider>
 *
 * With AppShell:
 *
 *   <AppShell appName="myapp">
 *     <App />
 *   </AppShell>
 *
 * Per Atomic Design: templates are layout/scaffolding patterns
 * shared across pages. AppShell is the "every page needs these
 * three providers" template.
 */

import type { ReactNode } from 'react';
import { FocusManager } from '../focus/manager.tsx';
import { KeyboardProvider } from '../keyboard/registry.tsx';
import { HelmsmithThemeProvider } from '../theme/HelmsmithThemeProvider.tsx';

export interface AppShellProps {
  /** App identifier — drives the per-app theme override filename. */
  appName: string;
  /** Theme used when no `~/.helmsmith/theme/default.*` exists. */
  fallbackThemeName?: string;
  /** Override the theme directory (mostly for tests). */
  themeDir?: string;
  /** Watch the theme dir for hot reload. Default: true. */
  watch?: boolean;
  /** Initial focus id (passed to FocusManager). */
  initialFocus?: string;
  children: ReactNode;
}

export function AppShell({
  appName,
  fallbackThemeName,
  themeDir,
  watch = true,
  initialFocus,
  children,
}: AppShellProps) {
  return (
    <HelmsmithThemeProvider
      appName={appName}
      fallbackThemeName={fallbackThemeName}
      themeDir={themeDir}
      watch={watch}
    >
      <KeyboardProvider>
        <FocusManager initialFocus={initialFocus}>{children}</FocusManager>
      </KeyboardProvider>
    </HelmsmithThemeProvider>
  );
}

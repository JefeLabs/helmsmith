/**
 * `<AppShell>` — the canonical provider stack every TUI app mounts
 * at its root. Replaces the manual triple-stack of providers with
 * one wrapper.
 *
 * Without AppShell:
 *
 *   <AgentxThemeProvider appName="myapp" watch>
 *     <KeyboardProvider>
 *       <FocusManager>
 *         <App />
 *       </FocusManager>
 *     </KeyboardProvider>
 *   </AgentxThemeProvider>
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

import type { ReactNode } from "react";
import { AgentxThemeProvider } from "../theme/AgentxThemeProvider.tsx";
import { KeyboardProvider } from "../keyboard/registry.tsx";
import { FocusManager } from "../focus/manager.tsx";

export interface AppShellProps {
  /** App identifier — drives the per-app theme override filename. */
  appName: string;
  /** Theme used when no `~/.agentx/theme/default.*` exists. */
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
    <AgentxThemeProvider
      appName={appName}
      fallbackThemeName={fallbackThemeName}
      themeDir={themeDir}
      watch={watch}
    >
      <KeyboardProvider>
        <FocusManager initialFocus={initialFocus}>{children}</FocusManager>
      </KeyboardProvider>
    </AgentxThemeProvider>
  );
}

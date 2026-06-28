/**
 * Templates — layout patterns shared across pages. Templates are
 * not screens themselves; they wrap a page's children with the
 * structural concerns (providers, root layout, persistent
 * navigation chrome).
 *
 * Per Atomic Design: templates are the page-level scaffolding,
 * minus the actual content. AppShell is the canonical example —
 * every TUI app's root is an AppShell.
 */

export type { AppShellProps } from './AppShell.tsx';
export { AppShell } from './AppShell.tsx';

import chalk from 'chalk';

export interface TabDef {
  id: string;
  key: string;
  label: string;
}

/**
 * Render a tab bar with active indicator.
 *
 * Active tab:   bold label
 * Inactive tab: dim label
 * Navigate with Tab key.
 */
export function renderTabBar(tabs: TabDef[], activeId: string): string {
  const parts = tabs.map((tab) => {
    const isActive = tab.id === activeId;
    if (isActive) {
      return chalk.bgCyan.black.bold(` ${tab.label} `);
    }
    return chalk.dim(tab.label);
  });

  return '  ' + chalk.dim('[Tab]') + ' ' + parts.join(chalk.dim('  │  '));
}

/**
 * Render a hotkey bar showing available actions.
 *
 * Each item: bold cyan key letter + label.
 */
export function renderHotkeyBar(
  items: Array<{ key: string; label: string }>,
): string {
  const parts = items.map((item) => {
    // [X] notation = active toggle, render with background highlight
    if (item.key.startsWith('[') && item.key.endsWith(']')) {
      return chalk.bgCyan.black.bold(item.key) + ' ' + item.label;
    }
    return chalk.bold.cyan(item.key.toUpperCase()) + ' ' + item.label;
  });
  return '  ' + parts.join('   ');
}

/**
 * Render a breadcrumb row with context path and numbered drill-down options.
 *
 * Gittyup-style: "path > path > 1 item  2 item  3 item"
 */
export function renderBreadcrumb(
  crumbs: string[],
  items: Array<{ key: string; label: string }>,
): string {
  const path = crumbs.map((c) => chalk.dim(c)).join(chalk.dim(' \u203A '));
  if (items.length === 0) return '  ' + path;
  const numbered = items.map(
    (item) => chalk.bold.yellow(item.key) + ' ' + item.label,
  );
  return '  ' + path + chalk.dim(' \u203A ') + numbered.join('   ');
}

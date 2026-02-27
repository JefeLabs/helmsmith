export interface LegendItem {
  label: string;
  color: (s: string) => string;
  char?: string;
}

export interface LegendOptions {
  /** If true, render items on a single line separated by spaces. Default: true */
  inline?: boolean;
}

/**
 * Render a legend showing colored indicators with labels.
 *
 * File types: "█ app  ▓ test  ░ config  ▒ storybook"
 * Teams: "── Platform ── Product ·· FrontendCo"
 */
export function renderLegend(
  items: LegendItem[],
  options?: LegendOptions
): string {
  const inline = options?.inline ?? true;

  const parts = items.map((item) => {
    const indicator = item.char ?? "\u25A0"; // ■ default square
    return `${item.color(indicator)} ${item.label}`;
  });

  if (inline) {
    return parts.join("  ");
  }

  return parts.join("\n");
}

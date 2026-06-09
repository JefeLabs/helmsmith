/**
 * Launches the SummaryView as a full-screen TUI via the ecosystem's runTuiView
 * harness (handles the openTUI bootstrap, theme + keyboard providers, and
 * teardown). FocusManager is added here because the Table needs focus context
 * and runTuiView wraps theme+keyboard but not focus.
 *
 * Uses `createElement` rather than JSX so the tree is a `ReactElement` (what
 * runTuiView's render callback requires) — @opentui's JSX yields the looser
 * `ReactNode`.
 */
import { FocusManager } from '@ecruz165/tui-view-components/focus';
import { runTuiView } from '@ecruz165/tui-view-components/pages';
import { createElement } from 'react';
import type { ReportService } from '../reports/ReportService.js';
import type { Period } from './model.js';
import { SummaryView } from './SummaryView.js';

export interface RunViewerOptions {
  reports: ReportService;
  timezone: string;
  period: Period;
  date: string;
}

export async function runViewer(opts: RunViewerOptions): Promise<void> {
  await runTuiView({ appName: 'discord-timetracker' }, (onQuit) =>
    createElement(FocusManager, {
      initialFocus: 'table',
      // biome-ignore lint/correctness/noChildrenProp: createElement's typed overload requires `children` in props when the component declares it required (FocusManagerProps.children).
      children: createElement(SummaryView, {
        reports: opts.reports,
        timezone: opts.timezone,
        initialPeriod: opts.period,
        initialDate: opts.date,
        onQuit,
      }),
    }),
  );
}

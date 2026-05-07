import chalk from 'chalk';
import { homedir } from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import type { DetailLayer } from '../ui/grouped-hbar-chart.js';
import { renderBanner } from '../ui/banner.js';
import { renderLegend } from '../ui/legend.js';
import { renderTabBar, renderHotkeyBar, renderBreadcrumb } from '../ui/tab-bar.js';
import type { TabDef } from '../ui/tab-bar.js';
import { readKey, readKeyWithTimeout } from '../ui/keypress.js';
import { readLine } from '../ui/readline.js';
import { getLastNWeeks, getLastNMonths, getLastNQuarters, getLastNYears, weekToMonth, weekToQuarter, weekToYear, monthShort } from '../aggregator/filters.js';
import { recordsToCsv } from '../commands/export-data.js';
import { assignAuthor, unassignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import { reattributeRecords } from '../collector/author-map.js';
import { SEGMENT_DEFS } from '../ui/constants.js';
import type { Segment } from '../aggregator/segments.js';
import { weekShort, quarterShort, yearShort } from '../ui/format.js';
import { teamDetailView } from './team-detail.js';
import { renderManageTab, buildManageHotkeyItems } from './manage-tab.js';
import { scanDirectory } from '../collector/dir-scanner.js';
import { expandTilde } from '../store/paths.js';
import type { ManageSection } from './manage-tab.js';
import { renderTopPerformersTab } from './components/top-performers-section.js';
import { renderRepoActivityTab } from './components/repo-activity-section.js';
import {
  renderContributionsTab,
  renderContributionsDetailTab,
  type DrillLevel,
  type ContribGranularity,
  type TimeBucket,
} from './components/contribution-section.js';

// ── Types ────────────────────────────────────────────────────────────────────

type TabId = 'contributions' | 'repo_activity' | 'top_performers' | 'manage';
type ManageSectionId = ManageSection;
type WindowSize = 4 | 8 | 12;

const TABS: TabDef[] = [
  { id: 'contributions', key: 'c', label: 'Contributions' },
  { id: 'repo_activity', key: 'r', label: 'Repo Activity' },
  { id: 'top_performers', key: 'p', label: 'Top Performers' },
  { id: 'manage', key: 'm', label: 'Manage' },
];

const GRANULARITY_ORDER: ContribGranularity[] = ['year', 'quarter', 'month', 'week'];
const DRILL_ORDER: DrillLevel[] = ['org', 'team', 'user'];

const GRANULARITY_DEFAULTS: Record<ContribGranularity, number> = {
  week: 12,
  month: 6,
  quarter: 4,
  year: 3,
};

const DEPTH_BOUNDS: Record<ContribGranularity, { min: number; max: number; step: number }> = {
  week: { min: 2, max: 24, step: 2 },
  month: { min: 2, max: 12, step: 1 },
  quarter: { min: 2, max: 8, step: 1 },
  year: { min: 1, max: 5, step: 1 },
};

function toWindowSize(weeksBack: number): WindowSize {
  if (weeksBack <= 4) return 4;
  if (weeksBack <= 8) return 8;
  return 12;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Calculate how many weeks to display based on terminal height and bars per group.
 */
export function computeWeeksToShow(termRows: number, barsPerGroup: number): number {
  return Math.min(4, Math.max(2, Math.floor((termRows - 30) / (barsPerGroup + 1))));
}

/**
 * Build time buckets for the Contributions tab.
 * Week mode: one bucket per ISO week.
 * Month mode: one bucket per calendar month, aggregating all weeks in that month.
 */
function buildTimeBuckets(
  granularity: ContribGranularity,
  depth: number,
  currentWeek: string,
  records: UserWeekRepoRecord[],
): TimeBucket[] {
  if (granularity === 'week') {
    const weeks = getLastNWeeks(depth, currentWeek);
    return weeks.reverse().map((w) => ({ label: weekShort(w), weeks: [w] }));
  }

  const allWeeks = [...new Set(records.map((r) => r.week))];

  if (granularity === 'month') {
    const months = getLastNMonths(depth, currentWeek);
    return months.reverse().map((m) => ({
      label: monthShort(m),
      weeks: allWeeks.filter((w) => weekToMonth(w) === m),
    }));
  }

  if (granularity === 'quarter') {
    const quarters = getLastNQuarters(depth, currentWeek);
    return quarters.reverse().map((q) => ({
      label: quarterShort(q),
      weeks: allWeeks.filter((w) => weekToQuarter(w) === q),
    }));
  }

  // year
  const years = getLastNYears(depth, currentWeek);
  return years.reverse().map((y) => ({
    label: yearShort(y),
    weeks: allWeeks.filter((w) => weekToYear(w) === y),
  }));
}

/**
 * Classify the trend shape from a chronological series of values.
 * Returns a short perception label: accelerating, slowing, recovering, dipping, stable, new.
 */
function classifyPerception(history: number[]): string {
  const nonZero = history.filter((v) => v > 0);
  if (nonZero.length <= 1) return 'new';
  if (history.length < 3) {
    // Only 2 points — simple comparison
    const [a, b] = history;
    const threshold = Math.max(a, b) * 0.1;
    if (b > a + threshold) return 'accelerating';
    if (b < a - threshold) return 'dipping';
    return 'stable';
  }

  // Split into first half and second half
  const mid = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, mid);
  const secondHalf = history.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  // Find the minimum point index for V-shape / peak detection
  const minVal = Math.min(...history);
  const maxVal = Math.max(...history);
  const minIdx = history.indexOf(minVal);
  const maxIdx = history.indexOf(maxVal);
  const range = maxVal - minVal;
  const threshold = maxVal * 0.15;

  // V-shape: dip in the middle, recovery at end
  if (range > threshold && minIdx > 0 && minIdx < history.length - 1) {
    const afterMin = history.slice(minIdx);
    const avgAfterMin = afterMin.reduce((s, v) => s + v, 0) / afterMin.length;
    if (avgAfterMin > minVal + threshold && avgSecond > avgFirst) {
      return 'recovering';
    }
  }

  // Peak in the middle, declining at end
  if (range > threshold && maxIdx > 0 && maxIdx < history.length - 1) {
    const afterMax = history.slice(maxIdx);
    const avgAfterMax = afterMax.reduce((s, v) => s + v, 0) / afterMax.length;
    if (avgAfterMax < maxVal - threshold && avgSecond < avgFirst) {
      return 'slowing';
    }
  }

  // Consistent direction
  if (avgSecond > avgFirst + threshold) return 'accelerating';
  if (avgSecond < avgFirst - threshold) return 'dipping';
  return 'stable';
}

const legend = renderLegend(
  SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
  { inline: true },
);

function getNumberedTeams(
  config: ViewContext['config'],
): Array<{ key: string; label: string; teamName: string }> {
  const teams: Array<{ key: string; label: string; teamName: string }> = [];
  let n = 1;
  for (const org of config.orgs) {
    for (const team of org.teams) {
      if (n > 9) break;
      const prefix = org.type === 'core' ? '\u2605' : '\u25C6';
      teams.push({
        key: String(n),
        label: `${prefix} ${team.name}`,
        teamName: team.name,
      });
      n++;
    }
  }
  return teams;
}


// ── Key mapping ──────────────────────────────────────────────────────────────

function mapKey(
  keyName: string,
  activeTab: TabId,
  repoWindowWeeks: WindowSize,
  leaderboardWindowWeeks: WindowSize,
  numberedTeams: Array<{ key: string; teamName: string }>,
): string | null {
  // Tab cycling
  if (keyName === 'tab') return `tab:next`;

  // Global
  if (keyName === 'q') return 'quit';

  // Tab-specific
  switch (activeTab) {
    case 'contributions':
      if (keyName === '+' || keyName === '=') return 'contrib_granularity_finer';
      if (keyName === '-') return 'contrib_granularity_coarser';
      if (keyName === 'right') return 'contrib_extend';
      if (keyName === 'left') return 'contrib_shrink';
      if (keyName === 'down') return 'contrib_drill_down';
      if (keyName === 'up') return 'contrib_drill_up';
      if (keyName === 't') return 'contrib_toggle_tag';
      if (keyName === 'd') return 'contrib_toggle_detail';
      if (keyName === 'v') return 'contrib_toggle_pivot';
      if (keyName === 'h') return 'contrib_toggle_unassigned';
      if (keyName === 'u') return 'contrib_toggle_peruser';
      if (keyName === 's') return 'contrib_segment_menu';
      // Numbered team drill-down
      for (const t of numberedTeams) {
        if (keyName === t.key) return `team:${t.teamName}`;
      }
      break;
    case 'repo_activity':
      if (keyName === '1' && repoWindowWeeks !== 4) return 'repo_window_4';
      if (keyName === '2' && repoWindowWeeks !== 8) return 'repo_window_8';
      if (keyName === '3' && repoWindowWeeks !== 12) return 'repo_window_12';
      break;
    case 'top_performers':
      if (keyName === '1' && leaderboardWindowWeeks !== 4) return 'lb_window_4';
      if (keyName === '2' && leaderboardWindowWeeks !== 8) return 'lb_window_8';
      if (keyName === '3' && leaderboardWindowWeeks !== 12) return 'lb_window_12';
      break;
    case 'manage':
      if (keyName === 'r') return 'manage_repos';
      if (keyName === 'o') return 'manage_orgs';
      if (keyName === 'a') return 'manage_authors';
      if (keyName === 'g') return 'manage_groups';
      if (keyName === 't') return 'manage_tags';
      if (keyName === 's') return 'manage_scan_all';
      if (keyName === 'd') return 'manage_scan_dir';
      if (keyName === 'up') return 'manage_cursor_up';
      if (keyName === 'down') return 'manage_cursor_down';
      if (keyName === 'return') return 'manage_action_selected';
      if (keyName === 'x' || keyName === 'backspace') return 'manage_remove_repo';
      if (keyName === 'n') return 'manage_new_org';
      if (keyName === '+' || keyName === '=') return 'manage_add_team';
      if (keyName === '-') return 'manage_remove_team';
      if (keyName === 'u') return 'manage_unassign_author';
      if (keyName === 'e') return 'manage_export';
      if (keyName === 'p') return 'manage_bulk_assign';
      break;
  }

  return null; // unrecognized key — re-render
}

// ── Hotkey bar builder ───────────────────────────────────────────────────────

function buildHotkeyItems(
  activeTab: TabId,
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  contribGranularity: ContribGranularity,
  contribDepth: number,
  detailLayers: Set<DetailLayer>,
  contribTableMode: boolean,
  contribPivotEntity: boolean,
  contribPerUserMode: boolean,
  contribHideUnassigned: boolean,
  excludedSegments: Set<Segment>,
  repoWindow: WindowSize,
  lbWindow: WindowSize,
): Array<{ key: string; label: string }> {
  const items: Array<{ key: string; label: string }> = [];

  const granShort = contribGranularity[0]; // w, m, q, y

  switch (activeTab) {
    case 'contributions': {
      const drillIdx = DRILL_ORDER.indexOf(drillLevel);
      if (drillIdx < DRILL_ORDER.length - 1) {
        items.push({ key: '\u2193', label: `${DRILL_ORDER[drillIdx + 1]}` });
      }
      if (drillIdx > 0) {
        items.push({ key: '\u2191', label: `${DRILL_ORDER[drillIdx - 1]}` });
      }
      items.push({ key: tagOverlay ? '[T]' : 'T', label: 'Tags' });
      items.push({ key: '+/-', label: contribGranularity });
      items.push({ key: '\u2190/\u2192', label: `${contribDepth}${granShort}` });
      const hasAnyDetail = detailLayers.size > 0 || contribTableMode;
      let dLabel = 'Detail';
      if (contribTableMode) {
        dLabel = 'Table';
      } else if (detailLayers.has('lines')) {
        dLabel = 'Lines';
      }
      items.push({ key: hasAnyDetail ? '[D]' : 'D', label: dLabel });
      items.push({ key: contribPivotEntity ? '[V]' : 'V', label: contribPivotEntity ? 'By Entity' : 'By Time' });
      items.push({ key: contribPerUserMode ? '[U]' : 'U', label: contribPerUserMode ? '/user' : 'Total' });
      items.push({ key: contribHideUnassigned ? '[H]' : 'H', label: contribHideUnassigned ? 'Assigned' : 'Show all' });
      if (excludedSegments.size > 0) {
        const excluded = [...excludedSegments].map((s) => s[0].toUpperCase()).join('');
        items.push({ key: '[S]', label: `-${excluded}` });
      } else {
        items.push({ key: 'S', label: 'Seg' });
      }
      break;
    }
    case 'repo_activity':
      if (repoWindow !== 4) items.push({ key: '1', label: '4 weeks' });
      if (repoWindow !== 8) items.push({ key: '2', label: '8 weeks' });
      if (repoWindow !== 12) items.push({ key: '3', label: '3 months' });
      break;
    case 'top_performers':
      if (lbWindow !== 4) items.push({ key: '1', label: '4 weeks' });
      if (lbWindow !== 8) items.push({ key: '2', label: '8 weeks' });
      if (lbWindow !== 12) items.push({ key: '3', label: '3 months' });
      break;
  }

  items.push({ key: 'Q', label: 'Quit' });

  return items;
}

// ── Dashboard view ───────────────────────────────────────────────────────────

/**
 * Dashboard view — tabbed entry screen with instant hotkey navigation.
 *
 * Four tabs: Contributions, Avg Output, Repo Activity, Top Performers.
 * Press a single key to switch tabs, toggle options, or drill down.
 * No scrollable menus — every action is one keypress away.
 */
export async function dashboardView(ctx: ViewContext): Promise<NavigationAction> {
  const initialWindow = toWindowSize(ctx.config.settings.weeks_back);
  let activeTab: TabId = 'contributions';
  let contribDrillLevel: DrillLevel = 'org';
  let contribTagOverlay = false;
  let contribGranularity: ContribGranularity = 'week';
  let contribDepth: number = ctx.config.settings.weeks_back;
  let contribDetailLayers = new Set<DetailLayer>();
  let contribTableMode = false;
  let contribPivotEntity = false;
  let contribPerUserMode = false;
  let contribHideUnassigned = true;
  let contribExcludedSegments = new Set<Segment>();
  let repoWindowWeeks: WindowSize = initialWindow;
  let leaderboardWindowWeeks: WindowSize = initialWindow;
  let manageSection: ManageSectionId = 'repos';
  let manageRepoNames: string[] = [];
  let manageRepoIdx = 0;
  let manageAuthorGroups: string[][] = [];
  let manageAuthorIdx = 0;

  const numberedTeams = getNumberedTeams(ctx.config);

  // Pre-compute label width across all drill levels so columns stay stable
  let contribLabelWidth = 14;
  for (const org of ctx.config.orgs) {
    const orgLen = org.name.length + 2; // "★ " or "◆ " prefix
    if (orgLen > contribLabelWidth) contribLabelWidth = orgLen;
    for (const team of org.teams) {
      const teamLen = team.name.length + 2;
      if (teamLen > contribLabelWidth) contribLabelWidth = teamLen;
    }
  }
  for (const [tag, meta] of Object.entries(ctx.config.tags ?? {})) {
    const tagLen = (meta?.label ?? tag).length;
    if (tagLen > contribLabelWidth) contribLabelWidth = tagLen;
  }
  // Include member names for user drill level
  for (const r of ctx.records) {
    if (r.member.length > contribLabelWidth) contribLabelWidth = r.member.length;
  }
  contribLabelWidth += 1; // padding

  while (true) {
    const termCols = process.stdout.columns || 100;

    // Clear screen + scrollback buffer + move cursor home
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

    // Banner
    console.log(renderBanner({ title: 'GitRadar' }));

    // Tab bar
    console.log(renderTabBar(TABS, activeTab));

    // Hotkey bar
    let hotkeys: Array<{ key: string; label: string }>;
    if (activeTab === 'manage') {
      hotkeys = buildManageHotkeyItems(
        manageSection,
        ctx.config.repos.length > 0,
        (ctx.authorRegistry ? Object.keys(ctx.authorRegistry.authors).length : 0) > 0,
        ctx.config.orgs.length > 0,
      );
    } else {
      hotkeys = buildHotkeyItems(
        activeTab, contribDrillLevel, contribTagOverlay, contribGranularity, contribDepth,
        contribDetailLayers, contribTableMode, contribPivotEntity, contribPerUserMode, contribHideUnassigned, contribExcludedSegments, repoWindowWeeks, leaderboardWindowWeeks,
      );
    }
    console.log(renderHotkeyBar(hotkeys));

    // Breadcrumb row (contributions tab — shows drill level + numbered team drill-downs)
    if (activeTab === 'contributions') {
      const modeLabel = contribTagOverlay ? 'By Tag'
        : contribDrillLevel === 'org' ? 'By Org'
        : contribDrillLevel === 'team' ? 'By Team' : 'By User';
      console.log(renderBreadcrumb([modeLabel], numberedTeams));
    }
    console.log('');

    // Build time buckets and range label for contributions tab
    const contribBuckets = buildTimeBuckets(contribGranularity, contribDepth, ctx.currentWeek, ctx.records);
    const contribRangeLabel = `${contribDepth} ${contribGranularity}s`;
    const contribPeriodLabel = contribGranularity === 'week' ? 'Week'
      : contribGranularity === 'month' ? 'Month'
      : contribGranularity === 'quarter' ? 'Quarter' : 'Year';

    // Tab content
    const contribRecords = contribHideUnassigned
      ? ctx.records.filter((r) => r.org !== 'unassigned')
      : ctx.records;

    switch (activeTab) {
      case 'contributions':
        if (contribTableMode) {
          renderContributionsDetailTab(ctx, contribDrillLevel, contribTagOverlay, contribPivotEntity, contribBuckets, contribRangeLabel, contribPeriodLabel, termCols, contribRecords);
        } else {
          renderContributionsTab(ctx, contribDrillLevel, contribTagOverlay, contribPivotEntity, contribBuckets, contribGranularity, contribRangeLabel, termCols, legend, classifyPerception, contribLabelWidth, contribRecords, contribExcludedSegments, contribDetailLayers, ctx.enrichments, contribPerUserMode);
        }
        break;
      case 'repo_activity':
        renderRepoActivityTab(ctx, repoWindowWeeks, termCols);
        break;
      case 'top_performers':
        renderTopPerformersTab(ctx, leaderboardWindowWeeks);
        break;
      case 'manage': {
        // Clamp cursors to valid range
        if (manageRepoIdx >= ctx.config.repos.length) {
          manageRepoIdx = Math.max(0, ctx.config.repos.length - 1);
        }
        const authorCount = ctx.authorRegistry ? Object.keys(ctx.authorRegistry.authors).length : 0;
        if (manageAuthorIdx >= authorCount) {
          manageAuthorIdx = Math.max(0, authorCount - 1);
        }
        const manageResult = renderManageTab(ctx, manageSection, termCols, manageRepoIdx, manageAuthorIdx);
        manageRepoNames = manageResult.repoNames;
        manageAuthorGroups = manageResult.authorEmailGroups;
        break;
      }
    }

    // Wait for keypress (with timeout to poll for external DB changes).
    // When a DbWatcher is active, it aborts the signal on filesystem
    // changes — interrupting the timeout for near-instant reactivity.
    try {
      const POLL_INTERVAL_MS = 5_000;
      const signal = ctx.createRefreshSignal?.();
      const key = ctx.onRefreshData
        ? await readKeyWithTimeout(POLL_INTERVAL_MS, signal)
        : await readKey();

      // Timeout — check if background process updated the database
      if (key === null) {
        ctx.onRefreshData?.();
        continue; // re-render (with potentially fresh data)
      }

      const action = mapKey(
        key.name, activeTab,
        repoWindowWeeks, leaderboardWindowWeeks, numberedTeams,
      );

      if (!action) continue; // unrecognized key — re-render

      // Tab switches
      if (action === 'tab:next') {
        const tabIds = TABS.map((t) => t.id) as TabId[];
        const idx = tabIds.indexOf(activeTab);
        activeTab = tabIds[(idx + 1) % tabIds.length];
        continue;
      }
      if (action.startsWith('tab:')) {
        activeTab = action.slice(4) as TabId;
        continue;
      }

      // Contributions: granularity (+/-)
      if (action === 'contrib_granularity_finer') {
        const idx = GRANULARITY_ORDER.indexOf(contribGranularity);
        if (idx < GRANULARITY_ORDER.length - 1) {
          contribGranularity = GRANULARITY_ORDER[idx + 1];
          contribDepth = GRANULARITY_DEFAULTS[contribGranularity];
        }
        continue;
      }
      if (action === 'contrib_granularity_coarser') {
        const idx = GRANULARITY_ORDER.indexOf(contribGranularity);
        if (idx > 0) {
          contribGranularity = GRANULARITY_ORDER[idx - 1];
          contribDepth = GRANULARITY_DEFAULTS[contribGranularity];
        }
        continue;
      }
      // Contributions: timeframe (←/→)
      if (action === 'contrib_extend') {
        const bounds = DEPTH_BOUNDS[contribGranularity];
        contribDepth = Math.min(bounds.max, contribDepth + bounds.step);
        continue;
      }
      if (action === 'contrib_shrink') {
        const bounds = DEPTH_BOUNDS[contribGranularity];
        contribDepth = Math.max(bounds.min, contribDepth - bounds.step);
        continue;
      }
      // Contributions: drill level (↑/↓)
      if (action === 'contrib_drill_down') {
        const idx = DRILL_ORDER.indexOf(contribDrillLevel);
        if (idx < DRILL_ORDER.length - 1) {
          contribDrillLevel = DRILL_ORDER[idx + 1];
        }
        continue;
      }
      if (action === 'contrib_drill_up') {
        const idx = DRILL_ORDER.indexOf(contribDrillLevel);
        if (idx > 0) {
          contribDrillLevel = DRILL_ORDER[idx - 1];
        }
        continue;
      }
      // Contributions: tag overlay toggle
      if (action === 'contrib_toggle_tag') { contribTagOverlay = !contribTagOverlay; continue; }
      // Contributions: detail toggle
      if (action === 'contrib_toggle_detail') {
        process.stdout.write('\n');
        console.log(chalk.bold('  Detail View:'));
        console.log(`  ${chalk.cyan('L')}  ${contribDetailLayers.has('lines') ? chalk.underline('Lines') : 'Lines'} ${chalk.dim('(+ins · -del · tst% · churn)')}`);
        console.log(`  ${chalk.cyan('T')}  ${contribTableMode ? chalk.underline('Table') : 'Table'} ${chalk.dim('(full numeric table)')}`);
        console.log(chalk.dim('  Esc  Clear\n'));
        const detailKey = await readKey();
        if (detailKey.name === 'l') {
          contribTableMode = false;
          if (contribDetailLayers.has('lines')) contribDetailLayers.delete('lines');
          else contribDetailLayers.add('lines');
        } else if (detailKey.name === 't') {
          contribTableMode = !contribTableMode;
          contribDetailLayers.clear();
        } else {
          contribDetailLayers.clear();
          contribTableMode = false;
        }
        continue;
      }
      // Contributions: pivot toggle (time-first ↔ entity-first)
      if (action === 'contrib_toggle_peruser') { contribPerUserMode = !contribPerUserMode; continue; }
      if (action === 'contrib_toggle_pivot') { contribPivotEntity = !contribPivotEntity; continue; }
      // Contributions: show/hide unassigned authors
      if (action === 'contrib_toggle_unassigned') { contribHideUnassigned = !contribHideUnassigned; continue; }

      // Contributions: segment exclusion menu
      if (action === 'contrib_segment_menu') {
        process.stdout.write('\n');
        console.log(chalk.bold('  Segment Filter:'));
        console.log(`  ${chalk.cyan('H')}  ${contribExcludedSegments.has('high') ? chalk.strikethrough('High (top 20%)') : 'Hide High (top 20%)'}`);
        console.log(`  ${chalk.cyan('M')}  ${contribExcludedSegments.has('middle') ? chalk.strikethrough('Middle (60%)') : 'Hide Middle (60%)'}`);
        console.log(`  ${chalk.cyan('L')}  ${contribExcludedSegments.has('low') ? chalk.strikethrough('Low (bottom 20%)') : 'Hide Low (bottom 20%)'}`);
        console.log(`  ${chalk.cyan('A')}  Show All (reset)`);
        console.log(chalk.dim('  Esc  Cancel\n'));
        const segKey = await readKey();
        if (segKey.name === 'h') {
          if (contribExcludedSegments.has('high')) contribExcludedSegments.delete('high');
          else contribExcludedSegments.add('high');
        } else if (segKey.name === 'm') {
          if (contribExcludedSegments.has('middle')) contribExcludedSegments.delete('middle');
          else contribExcludedSegments.add('middle');
        } else if (segKey.name === 'l') {
          if (contribExcludedSegments.has('low')) contribExcludedSegments.delete('low');
          else contribExcludedSegments.add('low');
        } else if (segKey.name === 'a') {
          contribExcludedSegments = new Set<Segment>();
        }
        continue;
      }

      // Repo Activity window
      if (action === 'repo_window_4') { repoWindowWeeks = 4; continue; }
      if (action === 'repo_window_8') { repoWindowWeeks = 8; continue; }
      if (action === 'repo_window_12') { repoWindowWeeks = 12; continue; }

      // Top Performers window
      if (action === 'lb_window_4') { leaderboardWindowWeeks = 4; continue; }
      if (action === 'lb_window_8') { leaderboardWindowWeeks = 8; continue; }
      if (action === 'lb_window_12') { leaderboardWindowWeeks = 12; continue; }

      // Manage tab: section switches
      if (action === 'manage_repos') { manageSection = 'repos'; continue; }
      if (action === 'manage_orgs') { manageSection = 'orgs'; continue; }
      if (action === 'manage_authors') { manageSection = 'authors'; continue; }
      if (action === 'manage_groups') { manageSection = 'groups'; continue; }
      if (action === 'manage_tags') { manageSection = 'tags'; continue; }

      // Manage tab: cursor navigation
      if (action === 'manage_cursor_up') {
        if (manageSection === 'repos' && manageRepoNames.length > 0) {
          manageRepoIdx = (manageRepoIdx - 1 + manageRepoNames.length) % manageRepoNames.length;
        } else if (manageSection === 'authors' && manageAuthorGroups.length > 0) {
          manageAuthorIdx = (manageAuthorIdx - 1 + manageAuthorGroups.length) % manageAuthorGroups.length;
        }
        continue;
      }
      if (action === 'manage_cursor_down') {
        if (manageSection === 'repos' && manageRepoNames.length > 0) {
          manageRepoIdx = (manageRepoIdx + 1) % manageRepoNames.length;
        } else if (manageSection === 'authors' && manageAuthorGroups.length > 0) {
          manageAuthorIdx = (manageAuthorIdx + 1) % manageAuthorGroups.length;
        }
        continue;
      }

      // Manage tab: remove selected repo
      if (action === 'manage_remove_repo' && manageSection === 'repos') {
        if (manageRepoIdx >= 0 && manageRepoIdx < manageRepoNames.length) {
          const repoName = manageRepoNames[manageRepoIdx];
          process.stdout.write(chalk.yellow(`\n  Remove ${repoName}? (y/n) `));
          const confirm = await readKey();
          if (confirm.name === 'y') {
            ctx.config.repos.splice(manageRepoIdx, 1);
            if (ctx.onRemoveRepo) {
              await ctx.onRemoveRepo(repoName);
            }
            // Adjust cursor
            if (manageRepoIdx >= ctx.config.repos.length && manageRepoIdx > 0) {
              manageRepoIdx--;
            }
          }
        }
        continue;
      }

      // Manage tab: scan selected repo (Enter in repos section)
      if (action === 'manage_action_selected' && manageSection === 'repos' && ctx.onScanRepo) {
        if (manageRepoIdx >= 0 && manageRepoIdx < manageRepoNames.length) {
          const repoName = manageRepoNames[manageRepoIdx];
          process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
          console.log(chalk.bold(`Collecting git data: ${repoName}...\n`));
          try {
            await ctx.onScanRepo(repoName);
            console.log(chalk.green(`\nCollection complete. Press any key to continue.`));
          } catch (err) {
            console.log(chalk.red(`\nScan failed: ${err instanceof Error ? err.message : err}`));
            console.log(chalk.dim('Press any key to continue.'));
          }
          await readKey();
        }
        continue;
      }

      // Manage tab: scan all repos
      if (action === 'manage_scan_all' && ctx.onScanRepo) {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold(`Collecting git data from all repos...\n`));
        for (const repoName of manageRepoNames) {
          try {
            await ctx.onScanRepo(repoName);
          } catch (err) {
            console.log(chalk.red(`  ${repoName}: failed — ${err instanceof Error ? err.message : err}`));
          }
        }
        console.log(chalk.green(`\nAll collections complete. Press any key to continue.`));
        await readKey();
        continue;
      }

      // Manage tab: assign/move selected author (Enter in authors section)
      if (action === 'manage_action_selected' && manageSection === 'authors') {
        if (manageAuthorIdx >= 0 && manageAuthorIdx < manageAuthorGroups.length && ctx.authorRegistry) {
          const emails = manageAuthorGroups[manageAuthorIdx];
          const firstAuthor = ctx.authorRegistry.authors[emails[0].toLowerCase()];
          if (!firstAuthor) { continue; }

          if (ctx.config.orgs.length === 0) {
            process.stdout.write('\n');
            console.log(chalk.yellow('  No organizations configured. Press O to add one first.'));
            console.log(chalk.dim('  Press any key to continue.'));
            await readKey();
            continue;
          }

          process.stdout.write('\n');
          const emailLabel = emails.length > 1
            ? chalk.dim(` (${emails.length} emails)`)
            : chalk.dim(` <${firstAuthor.email}>`);
          const isReassign = !!firstAuthor.org;
          const verb = isReassign ? 'Move' : 'Assign';
          console.log(chalk.bold(`  ${verb}: ${firstAuthor.name}`) + emailLabel);
          if (isReassign) {
            console.log(chalk.dim(`  Currently: ${firstAuthor.org} → ${firstAuthor.team}`));
          }
          console.log('');

          // If already assigned, offer quick "change team within same org"
          const currentOrg = isReassign
            ? ctx.config.orgs.find((o) => o.name === firstAuthor.org)
            : undefined;
          if (currentOrg && currentOrg.teams.length > 1) {
            console.log(chalk.dim(`  Change team within ${currentOrg.name}:`));
            for (let i = 0; i < currentOrg.teams.length; i++) {
              const isCurrent = currentOrg.teams[i].name === firstAuthor.team;
              const marker = isCurrent ? chalk.green(' ●') : '  ';
              console.log(`  ${chalk.cyan(String(i + 1))}  ${currentOrg.teams[i].name}${marker}`);
            }
            console.log(`  ${chalk.cyan('O')}  Pick different org`);
            console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

            const teamOrOrgChoice = await readKey();
            if (teamOrOrgChoice.name === 'escape') { continue; }

            if (teamOrOrgChoice.name !== 'o') {
              // Quick team change within same org
              const teamIdx = parseInt(teamOrOrgChoice.name, 10) - 1;
              if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= currentOrg.teams.length) { continue; }
              const teamName = currentOrg.teams[teamIdx].name;

              for (const email of emails) {
                ctx.authorRegistry = assignAuthor(ctx.authorRegistry, email, currentOrg.name, teamName);
              }
              if (ctx.onSaveAuthorRegistry) {
                await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
              }
              ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
              const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
              console.log(chalk.green(`  Moved to ${currentOrg.name} → ${teamName}${countLabel}`));
              console.log(chalk.dim('  Press any key to continue.'));
              await readKey();
              continue;
            }
            // Fall through to full org picker
            console.log('');
          }

          // Pick org
          for (let i = 0; i < ctx.config.orgs.length; i++) {
            const o = ctx.config.orgs[i];
            const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
            const isCurrent = isReassign && o.name === firstAuthor.org;
            const marker = isCurrent ? chalk.green(' ●') : '';
            console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name}${marker}`);
          }
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const orgChoice = await readKey();
          if (orgChoice.name === 'escape') { continue; }
          const orgIdx = parseInt(orgChoice.name, 10) - 1;
          if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
          const selectedOrg = ctx.config.orgs[orgIdx];

          // Pick team
          let teamName: string;
          if (selectedOrg.teams.length === 1) {
            teamName = selectedOrg.teams[0].name;
          } else {
            console.log('');
            for (let i = 0; i < selectedOrg.teams.length; i++) {
              const isCurrent = isReassign && selectedOrg.name === firstAuthor.org && selectedOrg.teams[i].name === firstAuthor.team;
              const marker = isCurrent ? chalk.green(' ●') : '';
              console.log(`  ${chalk.cyan(String(i + 1))}  ${selectedOrg.teams[i].name}${marker}`);
            }
            console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

            const teamChoice = await readKey();
            if (teamChoice.name === 'escape') { continue; }
            const teamIdx = parseInt(teamChoice.name, 10) - 1;
            if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
            teamName = selectedOrg.teams[teamIdx].name;
          }

          // Assign all emails in the group
          for (const email of emails) {
            ctx.authorRegistry = assignAuthor(ctx.authorRegistry, email, selectedOrg.name, teamName);
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          // Re-attribute existing records with updated author assignments
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
          const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
          console.log(chalk.green(`  ${isReassign ? 'Moved' : 'Assigned'} to ${selectedOrg.name} → ${teamName}${countLabel}`));

          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
        }
        continue;
      }

      // Manage tab: unassign selected author
      if (action === 'manage_unassign_author' && manageSection === 'authors') {
        if (manageAuthorIdx >= 0 && manageAuthorIdx < manageAuthorGroups.length && ctx.authorRegistry) {
          const emails = manageAuthorGroups[manageAuthorIdx];
          const firstAuthor = ctx.authorRegistry.authors[emails[0].toLowerCase()];
          if (!firstAuthor) { continue; }

          if (!firstAuthor.org) {
            process.stdout.write('\n');
            console.log(chalk.dim(`  ${firstAuthor.name} is already unassigned.`));
            console.log(chalk.dim('  Press any key to continue.'));
            await readKey();
            continue;
          }

          process.stdout.write('\n');
          const emailLabel = emails.length > 1
            ? chalk.dim(` (${emails.length} emails)`)
            : chalk.dim(` <${firstAuthor.email}>`);
          console.log(chalk.bold(`  Unassign: ${firstAuthor.name}`) + emailLabel);
          console.log(chalk.dim(`  Currently: ${firstAuthor.org} → ${firstAuthor.team}`));
          console.log('');
          console.log(`  ${chalk.cyan('Y')}  Confirm unassign`);
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const confirm = await readKey();
          if (confirm.name !== 'y') { continue; }

          for (const email of emails) {
            ctx.authorRegistry = unassignAuthor(ctx.authorRegistry, email);
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
          const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
          console.log(chalk.green(`  Unassigned ${firstAuthor.name}${countLabel}`));

          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
        }
        continue;
      }

      // Manage tab: bulk assign by identifier prefix
      if (action === 'manage_bulk_assign' && manageSection === 'authors' && ctx.authorRegistry) {
        if (ctx.config.orgs.length === 0) {
          process.stdout.write('\n');
          console.log(chalk.yellow('  No organizations configured. Press O to add one first.'));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Bulk Assign by Identifier Prefix\n'));

        // Show existing prefixes
        const prefixes = Object.values(ctx.authorRegistry.authors)
          .filter((a) => a.identifier && !a.org)
          .reduce((acc, a) => {
            const p = a.identifier!.slice(0, 3).toUpperCase();
            acc.set(p, (acc.get(p) ?? 0) + 1);
            return acc;
          }, new Map<string, number>());

        if (prefixes.size > 0) {
          console.log(chalk.dim('  Unassigned prefixes found:'));
          for (const [p, count] of [...prefixes.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${chalk.cyan(p)}  ${count} authors`);
          }
          console.log('');
        }

        const prefix = await readLine(chalk.cyan('  Identifier prefix: '));
        if (!prefix?.trim()) { continue; }

        // Pick org
        console.log('');
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const marker = o.type === 'core' ? '\u2605' : '\u25C6';
          console.log(`  ${chalk.cyan(String(i + 1))}  ${marker} ${o.name}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        // Pick team
        let teamName: string;
        if (selectedOrg.teams.length === 1) {
          teamName = selectedOrg.teams[0].name;
        } else {
          console.log('');
          for (let i = 0; i < selectedOrg.teams.length; i++) {
            console.log(`  ${chalk.cyan(String(i + 1))}  ${selectedOrg.teams[i].name}`);
          }
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const teamChoice = await readKey();
          if (teamChoice.name === 'escape') { continue; }
          const teamIdx = parseInt(teamChoice.name, 10) - 1;
          if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
          teamName = selectedOrg.teams[teamIdx].name;
        }

        const result = assignByIdentifierPrefix(
          ctx.authorRegistry, prefix.trim(), selectedOrg.name, teamName,
        );
        ctx.authorRegistry = result.registry;

        if (ctx.onSaveAuthorRegistry) {
          await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
        }
        // Re-attribute existing records with updated author assignments
        ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);

        if (result.assignedCount > 0) {
          console.log(chalk.green(`\n  Assigned ${result.assignedCount} authors with prefix "${prefix.trim()}" to ${selectedOrg.name} → ${teamName}`));
        } else {
          console.log(chalk.yellow(`\n  No unassigned authors found with prefix "${prefix.trim()}"`));
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: scan directory for repos
      if (action === 'manage_scan_dir' && manageSection === 'repos') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Add Repos from Directory\n'));

        const cwd = process.cwd();
        const home = homedir();
        console.log(`  ${chalk.cyan('1')}  Home     ${chalk.dim(home)}`);
        console.log(`  ${chalk.cyan('2')}  Current  ${chalk.dim(cwd)}`);
        console.log(`  ${chalk.cyan('3')}  Custom path`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const choice = await readKey();
        if (choice.name === 'escape') { continue; }

        let dirPath: string | null = null;
        if (choice.name === '1') {
          dirPath = home;
        } else if (choice.name === '2') {
          dirPath = cwd;
        } else if (choice.name === '3') {
          dirPath = await readLine(chalk.cyan('  Path: '));
          if (dirPath) dirPath = expandTilde(dirPath.trim());
        } else {
          continue;
        }

        if (!dirPath) { continue; }

        const group = await readLine(chalk.cyan('  Group name (default): ')) ?? '';
        const depthStr = await readLine(chalk.cyan('  Depth 1-3 (1): ')) ?? '';
        const depth = Math.min(3, Math.max(1, parseInt(depthStr, 10) || 1));

        console.log(chalk.dim(`\n  Scanning ${dirPath} (depth ${depth})...\n`));

        let added = 0;
        try {
          if (ctx.onScanDir) {
            // Full flow: discover + persist to repos.yml + update config
            added = await ctx.onScanDir(dirPath, group.trim() || 'default', depth);
          } else {
            // Lightweight: just discover and add to runtime config
            const discovered = await scanDirectory(dirPath, depth);
            const existingNames = new Set(ctx.config.repos.map(
              (r) => r.name ?? r.path.split('/').pop() ?? r.path,
            ));
            const groupName = group.trim() || 'default';
            for (const repo of discovered) {
              if (!existingNames.has(repo.name)) {
                ctx.config.repos.push({ path: repo.path, name: repo.name, group: groupName });
                added++;
              }
            }
          }

          if (added > 0) {
            console.log(chalk.green(`  ${added} new repos added.`));
          } else {
            console.log(chalk.yellow('  No new repos found.'));
          }
        } catch (err) {
          console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : err}`));
        }

        // Offer to scan the newly added repos right away
        if (added > 0 && ctx.onScanRepo) {
          console.log(chalk.cyan(`\n  Collect git data now? (y/n) `));
          const confirm = await readKey();
          if (confirm.name === 'y') {
            const updatedRepoNames = ctx.config.repos.map(
              (r) => r.name ?? r.path.split('/').pop() ?? r.path,
            );
            console.log('');
            for (const repoName of updatedRepoNames) {
              try {
                await ctx.onScanRepo(repoName);
              } catch (err) {
                console.log(chalk.red(`  ${repoName}: failed — ${err instanceof Error ? err.message : err}`));
              }
            }
            console.log(chalk.green(`\n  All collections complete.`));
          }
        }
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: add new organization
      if (action === 'manage_new_org' && manageSection === 'orgs') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('New Organization\n'));

        // Org name
        const orgName = await readLine(chalk.cyan('  Name: '));
        if (!orgName?.trim()) { continue; }

        // Org type
        console.log(`\n  ${chalk.cyan('1')}  Core (internal team)`);
        console.log(`  ${chalk.cyan('2')}  Consultant (external/vendor)`);
        const typeChoice = await readKey();
        const orgType = typeChoice.name === '2' ? 'consultant' : 'core';

        // Identifier prefix (optional)
        console.log('');
        const identifier = await readLine(
          chalk.cyan('  Identifier prefix ') + chalk.dim('(e.g. ACN, optional): '),
        );

        // Initial team
        const teamName = await readLine(chalk.cyan('  First team name: '));
        if (!teamName?.trim()) { continue; }

        // Tag for the team
        const teamTag = await readLine(
          chalk.cyan('  Team tag ') + chalk.dim('(default): '),
        ) ?? '';

        const newOrg = {
          name: orgName.trim(),
          type: orgType as 'core' | 'consultant',
          identifier: identifier?.trim() || undefined,
          teams: [{
            name: teamName.trim(),
            tag: teamTag.trim() || 'default',
            members: [],
          }],
        };

        ctx.config.orgs.push(newOrg);

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(newOrg);
            console.log(chalk.green(`\n  Organization "${newOrg.name}" created and saved.`));
          } catch (err) {
            console.log(chalk.red(`\n  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`\n  Organization "${newOrg.name}" added (runtime only).`));
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: add team to existing org
      if (action === 'manage_add_team' && manageSection === 'orgs') {
        if (ctx.config.orgs.length === 0) { continue; }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Add Team to Organization\n'));

        // Pick org
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
          const teamCount = chalk.dim(`(${o.teams.length} team${o.teams.length !== 1 ? 's' : ''})`);
          console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name} ${teamCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        // Show existing teams
        console.log(chalk.dim(`  Existing teams in ${selectedOrg.name}: ${selectedOrg.teams.map((t) => t.name).join(', ')}\n`));

        // Team name
        const teamName = await readLine(chalk.cyan('  Team name: '));
        if (!teamName?.trim()) { continue; }

        // Check for duplicate
        if (selectedOrg.teams.some((t) => t.name.toLowerCase() === teamName.trim().toLowerCase())) {
          console.log(chalk.yellow(`\n  Team "${teamName.trim()}" already exists in ${selectedOrg.name}.`));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        // Tag
        const teamTag = await readLine(
          chalk.cyan('  Team tag ') + chalk.dim('(default): '),
        ) ?? '';

        selectedOrg.teams.push({
          name: teamName.trim(),
          tag: teamTag.trim() || 'default',
          members: [],
        });

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(selectedOrg);
            console.log(chalk.green(`\n  Team "${teamName.trim()}" added to ${selectedOrg.name} and saved.`));
          } catch (err) {
            console.log(chalk.red(`\n  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`\n  Team "${teamName.trim()}" added to ${selectedOrg.name} (runtime only).`));
        }

        console.log(chalk.dim(`  Teams: ${selectedOrg.teams.map((t) => t.name).join(', ')}`));
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: remove team from org
      if (action === 'manage_remove_team' && manageSection === 'orgs') {
        if (ctx.config.orgs.length === 0) { continue; }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Remove Team from Organization\n'));

        // Pick org
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
          const teamCount = chalk.dim(`(${o.teams.length} team${o.teams.length !== 1 ? 's' : ''})`);
          console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name} ${teamCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        if (selectedOrg.teams.length <= 1) {
          console.log(chalk.yellow(`  ${selectedOrg.name} has only one team — cannot remove the last team.`));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        // Pick team to remove
        console.log(chalk.dim(`  Select team to remove from ${selectedOrg.name}:\n`));
        for (let i = 0; i < selectedOrg.teams.length; i++) {
          const t = selectedOrg.teams[i];
          const memberCount = t.members.length > 0 ? chalk.dim(` (${t.members.length} members)`) : '';
          console.log(`  ${chalk.cyan(String(i + 1))}  ${t.name}${memberCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const teamChoice = await readKey();
        if (teamChoice.name === 'escape') { continue; }
        const teamIdx = parseInt(teamChoice.name, 10) - 1;
        if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
        const teamToRemove = selectedOrg.teams[teamIdx];

        // Check if authors are assigned to this team
        const assignedCount = ctx.authorRegistry
          ? Object.values(ctx.authorRegistry.authors).filter(
              (a) => a.org === selectedOrg.name && a.team === teamToRemove.name,
            ).length
          : 0;

        if (assignedCount > 0) {
          console.log(chalk.yellow(`\n  ${assignedCount} author${assignedCount !== 1 ? 's' : ''} assigned to "${teamToRemove.name}".`));
          console.log(chalk.yellow('  They will become unassigned.'));
        }

        console.log(`\n  ${chalk.red('Remove')} "${teamToRemove.name}" from ${selectedOrg.name}?`);
        console.log(`  ${chalk.cyan('Y')}  Confirm`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const confirm = await readKey();
        if (confirm.name !== 'y') { continue; }

        // Remove the team
        selectedOrg.teams.splice(teamIdx, 1);

        // Unassign authors that were on this team
        if (assignedCount > 0 && ctx.authorRegistry) {
          for (const author of Object.values(ctx.authorRegistry.authors)) {
            if (author.org === selectedOrg.name && author.team === teamToRemove.name) {
              author.org = undefined;
              author.team = undefined;
            }
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
        }

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(selectedOrg);
            console.log(chalk.green(`  Team "${teamToRemove.name}" removed from ${selectedOrg.name}.`));
          } catch (err) {
            console.log(chalk.red(`  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`  Team "${teamToRemove.name}" removed (runtime only).`));
        }

        if (assignedCount > 0) {
          console.log(chalk.dim(`  ${assignedCount} author${assignedCount !== 1 ? 's' : ''} unassigned.`));
        }
        console.log(chalk.dim(`  Remaining teams: ${selectedOrg.teams.map((t) => t.name).join(', ')}`));
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: export
      if (action === 'manage_export') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Export\n'));

        console.log(`  ${chalk.cyan('1')}  Data (CSV)        ${chalk.dim('contribution records')}`);
        console.log(`  ${chalk.cyan('2')}  Workspace (YAML)  ${chalk.dim('portable repo list')}`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const exportChoice = await readKey();
        if (exportChoice.name === 'escape') { continue; }

        if (exportChoice.name === '1') {
          // ── CSV export ──
          const defaultPath = path.join(homedir(), 'gitradar-export.csv');
          const customPath = await readLine(
            chalk.cyan('  Output path ') + chalk.dim(`(${defaultPath}): `),
          );
          const outPath = expandTilde((customPath?.trim() || defaultPath));

          if (ctx.records.length === 0) {
            console.log(chalk.yellow('\n  No records to export. Collect data first.'));
          } else {
            try {
              const csv = recordsToCsv(ctx.records);
              await writeFile(outPath, csv, 'utf-8');
              console.log(chalk.green(`\n  Exported ${ctx.records.length} records to ${outPath}`));
            } catch (err) {
              console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : err}`));
            }
          }
        } else if (exportChoice.name === '2') {
          // ── Workspace YAML export ──
          const defaultPath = path.join(homedir(), 'gitradar-workspace.yml');
          const customPath = await readLine(
            chalk.cyan('  Output path ') + chalk.dim(`(${defaultPath}): `),
          );
          const outPath = expandTilde((customPath?.trim() || defaultPath));

          const portableRepos = ctx.config.repos.map((r) => {
            const portable: Record<string, unknown> = {
              name: r.name ?? r.path.split('/').pop() ?? r.path,
            };
            if (r.group && r.group !== 'default') portable.group = r.group;
            return portable;
          });

          const output: Record<string, unknown> = {
            workspaces: {
              exported: { repos: portableRepos },
            },
          };

          const groups = ctx.config.groups ?? {};
          const tags = ctx.config.tags ?? {};
          if (Object.keys(groups).length > 0) output.groups = groups;
          if (Object.keys(tags).length > 0) output.tags = tags;

          try {
            const yamlOut = yaml.dump(output, {
              indent: 2,
              lineWidth: 120,
              noRefs: true,
              quotingType: '"',
            });
            await writeFile(outPath, yamlOut, 'utf-8');
            console.log(chalk.green(`\n  Workspace exported to ${outPath}`));
            console.log(chalk.dim(`  ${portableRepos.length} repos (paths stripped for portability)`));
          } catch (err) {
            console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          continue;
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Navigation
      if (action === 'quit') {
        return { type: 'quit' };
      }
      if (action.startsWith('team:')) {
        const teamName = action.slice(5);
        return { type: 'push', view: (c) => teamDetailView(c, teamName) };
      }
    } catch {
      // SIGINT (Ctrl+C)
      return { type: 'quit' };
    }
  }
}

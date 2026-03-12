import { GitRadarEngine } from '../engine/gitradar-engine.js';
import { generateDemoData } from '../demo.js';
import { runNavigator } from '../views/navigator.js';
import { dashboardView } from '../views/dashboard.js';
import { trendsView } from '../views/trends.js';

// Re-export types and helpers so existing consumers don't break
export type { RunOptions } from '../engine/gitradar-engine.js';
export { getLastScanAgo, buildConfigFromWorkspace } from '../engine/gitradar-engine.js';

/**
 * Main entry point for the gitradar CLI.
 *
 * This is a thin orchestrator that delegates to GitRadarEngine for
 * data management, scanning, and ViewContext construction.
 */
export async function runMain(opts: import('../engine/gitradar-engine.js').RunOptions): Promise<void> {
  const engine = new GitRadarEngine();

  // ── Early exits ─────────────────────────────────────────────────────────
  if (opts.reset) {
    await engine.handleReset();
    return;
  }

  if (opts.storeStats) {
    await engine.handleStoreStats();
    return;
  }

  // ── Demo mode ───────────────────────────────────────────────────────────
  if (opts.demo) {
    const demoData = generateDemoData(opts.weeks ?? 12);
    engine.config = demoData.config;
    engine.records = demoData.records;
    console.log(
      `Demo mode: ${engine.records.length} records generated ` +
        `(${engine.config.orgs.length} orgs, ${engine.config.orgs.reduce((n, o) => n + o.teams.length, 0)} teams)`,
    );
  } else {
    // ── Real mode: workspace + scan ─────────────────────────────────────
    const ok = await engine.resolveWorkspace(opts);
    if (!ok) return;

    await engine.loadStores();

    if (opts.prune !== undefined) {
      await engine.handlePrune(opts.prune);
      if (opts.scanOnly) return;
    }

    await engine.scan(opts);

    // Enrich after scan unless explicitly skipped
    if (!opts.skipEnrich) {
      await engine.enrich({ weeks: opts.weeks });
    }

    if (opts.scanOnly) return;
  }

  // ── Filtering ─────────────────────────────────────────────────────────
  engine.applyFilters(opts);

  if (opts.json) {
    console.log(JSON.stringify(engine.records, null, 2));
    return;
  }

  // ── Launch TUI ────────────────────────────────────────────────────────
  const ctx = await engine.buildViewContext();

  const initial =
    opts.initialView === 'trends'
      ? trendsView
      : dashboardView;

  process.on('SIGINT', () => {
    console.log('\n');
    process.exit(0);
  });

  try {
    await runNavigator(initial, ctx);
  } finally {
    engine.close();
  }
}

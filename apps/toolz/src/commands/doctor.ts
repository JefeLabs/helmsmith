import { runDoctor } from '../core/index.js';
import { dim, fail, info, ok, warn } from '../ui/index.js';

export interface DoctorOptions {
  errorsOnly?: boolean;
  json?: boolean;
}

/**
 * Validate the registry against reality — detects stale paths,
 * version drift, removed packages. Reports at three severity tiers
 * (error / warning / info); exits non-zero on any error.
 */
export async function runDoctorCommand(options: DoctorOptions = {}): Promise<void> {
  const findings = await runDoctor();
  const filtered = options.errorsOnly ? findings.filter((f) => f.severity === 'error') : findings;

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    if (findings.some((f) => f.severity === 'error')) process.exit(1);
    return;
  }

  if (filtered.length === 0) {
    console.log(ok('No issues found.'));
    return;
  }

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  for (const severity of ['error', 'warning', 'info'] as const) {
    const subset = filtered.filter((f) => f.severity === severity);
    if (subset.length === 0) continue;
    const styled =
      severity === 'error'
        ? fail(`${severity.toUpperCase()} (${subset.length})`)
        : severity === 'warning'
          ? warn(`${severity.toUpperCase()} (${subset.length})`)
          : info(`${severity.toUpperCase()} (${subset.length})`);
    console.log(`\n${styled}`);
    for (const f of subset) {
      console.log(`  ${f.tool} ${dim(`[${f.code}]`)}`);
      console.log(`    ${f.message}`);
      if (f.fix) console.log(dim(`    → ${f.fix}`));
    }
  }

  console.log(`\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`);
  if (counts.error > 0) process.exit(1);
}

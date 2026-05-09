import { runDoctor } from "../doctor.js";
import { findPackageRoot } from "./_shared/package-root.js";

export interface DoctorOptions {
  errorsOnly?: boolean;
}

/**
 * Health check the kit — broken references, orphan files, frontmatter
 * completeness, prerequisite resolution, tag format + two-tier check.
 * Exits non-zero on any error-severity finding so CI gates are easy.
 */
export function runDoctorCommand(options: DoctorOptions = {}): void {
  const packageRoot = findPackageRoot();
  const findings = runDoctor(packageRoot);
  const filtered = options.errorsOnly
    ? findings.filter((f) => f.severity === "error")
    : findings;

  if (filtered.length === 0) {
    console.log("✓ No issues found.");
    return;
  }

  const counts = {
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  for (const severity of ["error", "warning", "info"] as const) {
    const subset = filtered.filter((f) => f.severity === severity);
    if (subset.length === 0) continue;
    const tag =
      severity === "error" ? "✗" : severity === "warning" ? "⚠" : "ℹ";
    console.log(`\n${tag} ${severity.toUpperCase()} (${subset.length})`);
    for (const f of subset) {
      console.log(`  ${f.source}`);
      console.log(`    ${f.message}`);
    }
  }

  console.log(
    `\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`,
  );
  if (counts.error > 0) process.exit(1);
}

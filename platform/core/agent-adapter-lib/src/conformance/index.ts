/**
 * Conformance suite — the keystone (PRD §5, §13 D5, Phase E).
 *
 * `runConformance(makeAdapter, opts?)` drives ANY AgentAdapter through the fixed
 * scenario set in ./scenarios.ts and returns a report. An adapter (built-in or
 * third-party) that passes its capability-appropriate scenarios is swap-compatible
 * by construction. Exported as `@helmsmith/agent-adapter/conformance` so adapter
 * authors can run the same suite against their own implementation.
 *
 * Skips:
 *   - opts.skipScenarios — an explicit per-adapter skip list (the limited-adapter
 *     path; kept for FUTURE limited adapters even though all 11 built-ins run today).
 *   - scenario.skipFor(caps) — a capability-aware AUTO-skip (e.g. extended-thinking
 *     is skipped when supportsExtendedThinking is false).
 *
 * The runner is test-framework-agnostic: scenarios throw plain Errors on a
 * contract violation; the runner catches them and records a `fail` result. The
 * caller (e.g. a vitest test) asserts that `report.failed === 0`.
 */

import type { AgentAdapter, AgentSpecType } from '../agent.ts';
import { collect } from './fixtures/index.ts';
import type { ConformanceHarness, ConformanceScenario } from './scenarios.ts';
import { SCENARIOS } from './scenarios.ts';

export { SENTINELS } from './fixtures/index.ts';
export type { ConformanceHarness, ConformanceScenario } from './scenarios.ts';
export { SCENARIOS } from './scenarios.ts';

export interface RunConformanceOptions {
  /** Scenario names to skip explicitly (the documented limited-adapter path). */
  skipScenarios?: string[];
}

export type ScenarioStatus = 'pass' | 'skip' | 'fail';

export interface ScenarioResult {
  name: string;
  status: ScenarioStatus;
  /** Skip rationale or failure message. */
  reason?: string;
}

export interface ConformanceReport {
  adapterType: AgentSpecType;
  results: ScenarioResult[];
  passed: number;
  skipped: number;
  failed: number;
  /** The subset of results with status 'fail' (empty when fully conformant). */
  failures: ScenarioResult[];
}

function makeHarness(adapter: AgentAdapter): ConformanceHarness {
  return {
    caps: adapter.capabilities,
    collect,
    assert(cond: unknown, message: string): void {
      if (!cond) throw new Error(message);
    },
  };
}

/**
 * Drive `makeAdapter()` through every conformance scenario.
 *
 * `makeAdapter` is invoked once per executed scenario so each runs against a
 * fresh adapter instance (no cross-scenario state leakage).
 */
export async function runConformance(
  makeAdapter: () => AgentAdapter,
  opts?: RunConformanceOptions,
): Promise<ConformanceReport> {
  const skipSet = new Set(opts?.skipScenarios ?? []);

  // A probe instance supplies the type + capabilities for skip decisions.
  const probe = makeAdapter();
  const caps = probe.capabilities;
  const adapterType = probe.type;

  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS as readonly ConformanceScenario[]) {
    if (skipSet.has(scenario.name)) {
      results.push({ name: scenario.name, status: 'skip', reason: 'skipScenarios' });
      continue;
    }
    if (scenario.skipFor?.(caps)) {
      results.push({ name: scenario.name, status: 'skip', reason: 'capability skipFor' });
      continue;
    }

    const adapter = makeAdapter();
    const harness = makeHarness(adapter);
    try {
      await scenario.run(adapter, harness);
      results.push({ name: scenario.name, status: 'pass' });
    } catch (err) {
      results.push({
        name: scenario.name,
        status: 'fail',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failures = results.filter((r) => r.status === 'fail');
  return {
    adapterType,
    results,
    passed: results.filter((r) => r.status === 'pass').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    failed: failures.length,
    failures,
  };
}

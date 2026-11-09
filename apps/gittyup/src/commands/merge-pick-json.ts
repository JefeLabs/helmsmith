/**
 * What `merge --json` and `pick --json` share (spec §5.1): the refusals, in the order
 * both commands apply them, and the run → report → exit code tail. Each command calls
 * the checks itself, because pick slots its own between them.
 */
import type { ManifestManager } from '../config/manifest.js';
import { type AiMode, AiModeSchema } from '../config/schema.js';
import { GittyupError } from '../core/errors.js';
import {
  type RunDeps,
  type RunOptions,
  resolveAgentMode,
  setupAgent,
  toMergePickDocument,
} from '../core/json-operations.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { MergePickRow } from '../output/contract.js';
import { emitJson } from '../output/json.js';

const DEFAULT_AI_MODEL = 'gpt-4o';

/** 1. `--ai` must be a known mode (USAGE). */
export function parseAiFlag(ai: string | undefined): AiMode | undefined {
  if (ai === undefined) return undefined;
  const parsed = AiModeSchema.safeParse(ai);
  if (!parsed.success) {
    throw new GittyupError('USAGE', `--ai must be one of auto, suggest, manual (got "${ai}")`, {
      ai,
    });
  }
  return parsed.data;
}

/** 3. A target is required (TARGET_REQUIRED). */
export function requireScope(opts: { group?: string; repo?: string }): string {
  const scope = opts.group ?? opts.repo;
  if (!scope) throw new GittyupError('TARGET_REQUIRED', 'Specify --group or --repo');
  return scope;
}

/** 4. `--ai suggest` shows a person a proposal (INTERACTIVE_ONLY). */
export function refuseSuggest(ai: AiMode | undefined): void {
  if (ai === 'suggest') {
    throw new GittyupError(
      'INTERACTIVE_ONLY',
      '--ai suggest needs a person to approve each proposal; use --ai auto or --ai manual with --json',
      { ai },
    );
  }
}

/** 5. `--yes` is the confirmation (CONFIRMATION_REQUIRED). */
export function requireYes(opts: { yes?: boolean }, operation: 'merge' | 'pick'): void {
  if (!opts.yes) {
    throw new GittyupError(
      'CONFIRMATION_REQUIRED',
      `--json never prompts; pass --yes to confirm the ${operation}`,
    );
  }
}

/** Set up the agent, run, print the report, and exit 1 unless every repo succeeded. */
export async function emitMergePickReport(params: {
  operation: 'merge' | 'pick';
  source: string;
  target: string;
  manifest: ManifestManager;
  orchestrator: Orchestrator;
  ai: AiMode | undefined;
  opts: { fetch?: boolean; push?: boolean; pr?: boolean };
  run: (deps: RunDeps, runOptions: RunOptions) => Promise<MergePickRow[]>;
}): Promise<void> {
  const { operation, source, target, manifest, orchestrator, ai, opts, run } = params;
  const settings = manifest.data.settings;
  const { mode, modeSource } = resolveAgentMode(ai, settings.ai_mode);
  const agent = await setupAgent(mode, modeSource, settings.ai_model ?? DEFAULT_AI_MODEL);
  const rows = await run(
    { getGit: (repo) => orchestrator.repos.getGit(repo), agent },
    { fetch: opts.fetch !== false, push: !!opts.push, pr: !!opts.pr },
  );
  emitJson(toMergePickDocument(operation, source, target, agent, rows));
  // A repo that conflicted, errored or was skipped is not a success (spec §3.1).
  if (rows.some((r) => r.status !== 'success')) process.exitCode = 1;
}

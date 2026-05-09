/**
 * Contribution validation orchestrator. Runs the three layers in
 * order and accumulates findings into a single result.
 *
 * Layer 1 (structural) and layer 2 (file bundle) are always-on,
 * synchronous, and run regardless of whether agent review is
 * configured. Layer 3 is opt-in — only invoked when a reviewer is
 * provided. The contribute endpoint (#5) decides whether to run
 * layer 3 inline or async based on the reviewer's expected latency.
 *
 * Design principle: layers are independent. Each accumulates
 * findings; this orchestrator concatenates and lets the caller
 * decide what to do. We deliberately don't short-circuit on
 * layer-1 failures into skipping layer 2 — surfacing as many
 * issues as possible in one round-trip is better UX than
 * fix-resubmit-fix-resubmit.
 */

import type {
  CatalogIndex,
  CreateContributionRequest,
  ReviewFinding,
} from "./contracts.js";
import { validateStructural } from "./validation/structural.js";
import { validateFileBundle } from "./validation/files.js";
import {
  type ContributionReviewer,
  shouldBlock,
} from "./validation/reviewer.js";

export interface ValidateContributionOptions {
  catalog: CatalogIndex | null;
  coreTags: Set<string>;
  /** Optional layer-3 reviewer. When omitted, layer 3 is skipped. */
  reviewer?: ContributionReviewer;
}

export interface ValidationResult {
  findings: ReviewFinding[];
  /** Convenience boolean: true when no high-severity findings exist. */
  passed: boolean;
}

/**
 * Run all configured validation layers and return accumulated
 * findings. The returned `passed` boolean uses the default blocking
 * policy (any high-severity finding blocks); callers wanting a
 * different threshold should inspect findings directly.
 */
export async function validateContribution(
  req: CreateContributionRequest,
  options: ValidateContributionOptions,
): Promise<ValidationResult> {
  const findings: ReviewFinding[] = [];

  // Layer 1: structural — frontmatter, slug, references, tags, body length
  findings.push(
    ...validateStructural(req, {
      catalog: options.catalog,
      coreTags: options.coreTags,
    }),
  );

  // Layer 2: file bundle — paths, types, sizes, secrets
  findings.push(...validateFileBundle(req));

  // Layer 3: agent review (opt-in). Only run if layers 1+2 didn't
  // hard-fail — we don't burn agent tokens on submissions that are
  // already going to be rejected. Inspect for high-severity findings;
  // skip layer 3 if any.
  if (options.reviewer && !shouldBlock(findings)) {
    try {
      const agentFindings = await options.reviewer.review({
        kind: req.kind,
        slug: req.slug,
        files: req.files,
        frontmatter: req.frontmatter,
      });
      findings.push(...agentFindings);
    } catch (err) {
      // Reviewer infrastructure failure (provider down, network
      // error, etc.) shouldn't reject the contribution. Surface as
      // medium-severity so the operator sees it and can fall back
      // to layer-1/2-only acceptance until the reviewer recovers.
      findings.push({
        severity: "medium",
        axis: "quality",
        message: `Agent reviewer error: ${
          (err as Error).message ?? "unknown"
        }. Layers 1+2 still validated successfully.`,
      });
    }
  }

  return {
    findings,
    passed: !shouldBlock(findings),
  };
}

/* ── public re-exports for callers ───────────────────────────── */

export { validateStructural } from "./validation/structural.js";
export { validateFileBundle } from "./validation/files.js";
export {
  type ContributionReviewer,
  type ReviewInput,
  type AdapterLike,
  type AgentAdapterReviewerOptions,
  AgentAdapterReviewer,
  MockReviewer,
  parseFindings,
  shouldBlock,
} from "./validation/reviewer.js";

/**
 * Terminal flow-output enforcement — the spec side of roadmap 2.5.
 *
 * `parseFlowOutput` is what the runtime calls when a flow reaches its
 * terminal node: given the flow's declared `FlowOutputContract` and the
 * terminal node's output text, it either produces the parsed value the
 * contract promises (a JobIntent, an array of them, a FlowDef, a JSON
 * value, or the raw text) or a descriptive error the runtime turns into
 * a job failure. Browser-safe and pure, so a designer UI can preview
 * emission with the exact function the runtime enforces with.
 *
 * `structured.schema` is enforced (2.7) via the spec's own JSON-Schema
 * subset (`schema.ts` — browser-safe, zero-dep): the parsed value is
 * checked with `schemaViolations` and any violation fails the job with
 * located messages. The subset itself is gated at catalog load by
 * `validateSchemaShape`, so a schema that reaches this point is fully
 * enforceable.
 */
import { schemaViolations } from './schema.ts';
import type { FlowOutputContract, JobIntent } from './types.ts';
import { validateFlowCatalog } from './validate.ts';

export type FlowOutputParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Parse and shape-check a terminal node's output text against the
 * flow's output contract. `undefined` contract ≡ `{ kind: 'agent-text' }`
 * (the default for `kind: 'work'` flows).
 */
export function parseFlowOutput(
  contract: FlowOutputContract | undefined,
  text: string,
): FlowOutputParseResult {
  const kind = contract?.kind ?? 'agent-text';
  switch (kind) {
    case 'agent-text':
      return { ok: true, value: text };
    case 'job-intent': {
      const parsed = parseJson(text, 'job-intent');
      if (!parsed.ok) return parsed;
      const shapeError = jobIntentShapeError(parsed.value, 'output');
      if (shapeError) return { ok: false, error: shapeError };
      return { ok: true, value: parsed.value as JobIntent };
    }
    case 'job-intents': {
      const parsed = parseJson(text, 'job-intents');
      if (!parsed.ok) return parsed;
      if (!Array.isArray(parsed.value)) {
        return { ok: false, error: 'job-intents output must be a JSON array of JobIntents' };
      }
      for (const [i, item] of parsed.value.entries()) {
        const shapeError = jobIntentShapeError(item, `output[${i}]`);
        if (shapeError) return { ok: false, error: shapeError };
      }
      const c = contract as Extract<FlowOutputContract, { kind: 'job-intents' }>;
      if (c.min !== undefined && parsed.value.length < c.min) {
        return {
          ok: false,
          error: `job-intents output has ${parsed.value.length} intents, below the declared min of ${c.min}`,
        };
      }
      if (c.max !== undefined && parsed.value.length > c.max) {
        return {
          ok: false,
          error: `job-intents output has ${parsed.value.length} intents, above the declared max of ${c.max}`,
        };
      }
      return { ok: true, value: parsed.value };
    }
    case 'flow-spec': {
      const parsed = parseJson(text, 'flow-spec');
      if (!parsed.ok) return parsed;
      try {
        validateFlowCatalog({ flows: [parsed.value] }, 'flow output');
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      return { ok: true, value: parsed.value };
    }
    case 'structured': {
      const parsed = parseJson(text, 'structured');
      if (!parsed.ok) return parsed;
      // 2.7 — enforce the declared subset schema against the parsed value.
      const schema = (contract as Extract<FlowOutputContract, { kind: 'structured' }>).schema;
      const issues = schemaViolations(parsed.value, schema);
      if (issues.length > 0) {
        return {
          ok: false,
          error: `structured output violates the declared schema: ${issues.join('; ')}`,
        };
      }
      return parsed;
    }
  }
}

function parseJson(text: string, contractKind: string): FlowOutputParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: `flow declares output.kind '${contractKind}' but the terminal output is not valid JSON: ${(err as Error).message}`,
    };
  }
}

/** Structural JobIntent check. Returns a located error string, or null
 *  when the value is a valid intent. Mirrors the JobIntent type:
 *  flowId/productId non-empty strings, `input` present (any value,
 *  including null), optional `set` string, optional `config` object. */
function jobIntentShapeError(value: unknown, where: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `${where} must be a JobIntent object`;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.flowId !== 'string' || !v.flowId) {
    return `${where}.flowId must be a non-empty string`;
  }
  if (typeof v.productId !== 'string' || !v.productId) {
    return `${where}.productId must be a non-empty string`;
  }
  if (!('input' in v)) {
    return `${where}.input is required (use null for intentionally empty input)`;
  }
  if (v.set !== undefined && (typeof v.set !== 'string' || !v.set)) {
    return `${where}.set must be a non-empty string when present`;
  }
  if (v.config !== undefined && (!v.config || typeof v.config !== 'object')) {
    return `${where}.config must be an object when present`;
  }
  return null;
}

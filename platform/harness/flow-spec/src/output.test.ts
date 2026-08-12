import { describe, expect, it } from 'vitest';
import { parseFlowOutput } from './index.ts';

describe('parseFlowOutput', () => {
  it('agent-text (and undefined contract) passes text through', () => {
    expect(parseFlowOutput(undefined, 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(parseFlowOutput({ kind: 'agent-text' }, 'hello')).toEqual({ ok: true, value: 'hello' });
  });

  it('job-intent parses and shape-checks the intent', () => {
    const good = JSON.stringify({ flowId: 'work-1', productId: 'p1', input: { x: 1 } });
    expect(parseFlowOutput({ kind: 'job-intent' }, good)).toEqual({
      ok: true,
      value: { flowId: 'work-1', productId: 'p1', input: { x: 1 } },
    });
  });

  it('job-intent rejects non-JSON and missing fields with located errors', () => {
    const nonJson = parseFlowOutput({ kind: 'job-intent' }, 'not json');
    expect(nonJson.ok).toBe(false);
    if (!nonJson.ok) expect(nonJson.error).toMatch(/JSON/);

    const missing = parseFlowOutput(
      { kind: 'job-intent' },
      JSON.stringify({ flowId: 'work-1', input: null }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/productId/);
  });

  it('job-intents enforces array shape and min/max', () => {
    const one = JSON.stringify([{ flowId: 'f', productId: 'p', input: null }]);
    expect(parseFlowOutput({ kind: 'job-intents' }, one).ok).toBe(true);

    const tooFew = parseFlowOutput({ kind: 'job-intents', min: 2 }, one);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.error).toMatch(/min/);

    const notArray = parseFlowOutput(
      { kind: 'job-intents' },
      JSON.stringify({ flowId: 'f', productId: 'p', input: null }),
    );
    expect(notArray.ok).toBe(false);

    const badItem = parseFlowOutput(
      { kind: 'job-intents' },
      JSON.stringify([{ productId: 'p', input: null }]),
    );
    expect(badItem.ok).toBe(false);
    if (!badItem.ok) expect(badItem.error).toMatch(/\[0\].*flowId/);
  });

  it('flow-spec validates the emitted flow through the catalog validator', () => {
    const validFlow = {
      id: 'emitted',
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'manual' } },
        { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
      ],
      edges: [{ from: 't', to: 'a', type: 'sequence' }],
    };
    expect(parseFlowOutput({ kind: 'flow-spec' }, JSON.stringify(validFlow)).ok).toBe(true);

    const noTrigger = { ...validFlow, nodes: [validFlow.nodes[1]], edges: [] };
    const bad = parseFlowOutput({ kind: 'flow-spec' }, JSON.stringify(noTrigger));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/trigger/);
  });

  it('structured parses JSON but does NOT enforce the schema (reported at load instead)', () => {
    const contract = { kind: 'structured' as const, schema: { type: 'object' } };
    // 42 violates the declared schema — still ok: schema enforcement is
    // the flow-output-schema unsupported feature, not silent behavior.
    expect(parseFlowOutput(contract, '42')).toEqual({ ok: true, value: 42 });
    expect(parseFlowOutput(contract, 'not json').ok).toBe(false);
  });
});

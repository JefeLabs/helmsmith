import { describe, expect, it } from 'vitest';

describe('parseFlowOutput — structured schema enforcement (2.7)', () => {
  const contract = {
    kind: 'structured' as const,
    schema: {
      type: 'object',
      required: ['score'],
      properties: { score: { type: 'number', minimum: 0, maximum: 1 } },
    },
  };

  it('accepts a conforming structured output', () => {
    const r = parseFlowOutput(contract, '{"score": 0.7}');
    expect(r).toEqual({ ok: true, value: { score: 0.7 } });
  });

  it('fails a schema-violating structured output with located violations', () => {
    const r = parseFlowOutput(contract, '{"score": "high"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('violates the declared schema');
      expect(r.error).toContain('$.score');
    }
  });
});

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

  it('structured enforces the declared schema on the parsed value (2.7)', () => {
    const contract = { kind: 'structured' as const, schema: { type: 'object' } };
    expect(parseFlowOutput(contract, '42').ok).toBe(false); // violates type: object
    expect(parseFlowOutput(contract, '{"any": 1}')).toEqual({ ok: true, value: { any: 1 } });
    expect(parseFlowOutput(contract, 'not json').ok).toBe(false);
  });
});

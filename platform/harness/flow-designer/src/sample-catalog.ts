/**
 * The catalog the designer opens with — a realistic review-and-ship
 * flow exercising most of the contract (approval tag, reject cycle,
 * error matchers, output schemas, publish, fail terminal) plus a
 * job-definition intake flow, so the canvas demonstrates the language
 * instead of starting blank.
 */
import type { Catalog } from '@helmsmith/flow-spec';

export const SAMPLE_CATALOG: Catalog = {
  flows: [
    {
      id: 'review-and-ship',
      kind: 'work',
      version: '1.0.0',
      description: 'Plan, build, review with HITL, publish a PR.',
      nodes: [
        { id: 'start', kind: 'trigger', config: { kind: 'manual' } },
        {
          id: 'builder',
          kind: 'agent',
          config: {
            agent: {
              id: 'builder',
              role: 'Builder',
              adapter: 'claude-sdk',
              systemPrompt: 'Implement the request.',
            },
          },
        },
        {
          id: 'reviewer',
          kind: 'agent',
          output: {
            kind: 'json',
            schema: {
              type: 'object',
              required: ['score'],
              properties: { score: { type: 'number', minimum: 0, maximum: 1 } },
            },
          },
          config: {
            agent: {
              id: 'reviewer',
              role: 'Reviewer',
              adapter: 'claude-sdk',
              systemPrompt: 'Respond ONLY with JSON {"score": <0..1>}.',
            },
          },
        },
        {
          id: 'quality-gate',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'jsonpath', path: '$.nodes.reviewer.score' },
                  op: '>',
                  rhs: { kind: 'literal', value: 0.8 },
                },
                message: 'review score must exceed 0.8',
              },
            ],
          },
        },
        {
          id: 'ship',
          kind: 'publish',
          effect: 'side-effecting',
          tags: {
            approval: { assigneeRole: 'tech-lead', slaMs: 86_400_000, concurrency: 'pessimistic' },
          },
          config: { action: 'push-and-open-pr', draft: false },
        },
        {
          id: 'gave-up',
          kind: 'transform',
          terminal: 'fail',
          config: { expression: { kind: 'literal', value: 'quality gate exhausted' } },
        },
      ],
      edges: [
        { from: 'start', to: 'builder', type: 'sequence' },
        { from: 'builder', to: 'reviewer', type: 'sequence' },
        { from: 'reviewer', to: 'quality-gate', type: 'sequence' },
        { from: 'quality-gate', to: 'ship', type: 'sequence' },
        {
          from: 'quality-gate',
          to: 'builder',
          type: 'reject',
          maxAttempts: 3,
          onMaxAttempts: { kind: 'escalate', to: 'gave-up' },
        },
        { from: 'builder', to: 'gave-up', type: 'error', on: ['Timeout'] },
      ],
    },
    {
      id: 'intake',
      kind: 'job-definition',
      output: { kind: 'job-intent' },
      description: 'Turns a conversation into a work order.',
      nodes: [
        { id: 'start', kind: 'trigger', config: { kind: 'manual' } },
        {
          id: 'planner',
          kind: 'agent',
          config: {
            agent: {
              id: 'planner',
              role: 'Planner',
              adapter: 'claude-sdk',
              systemPrompt: 'Emit a JobIntent JSON for review-and-ship.',
            },
          },
        },
      ],
      edges: [{ from: 'start', to: 'planner', type: 'sequence' }],
    },
  ],
};

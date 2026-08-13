import { describe, expect, it } from 'vitest';
import { schemaViolations, validateSchemaShape } from './schema.ts';
import { CatalogError } from './types.ts';

describe('validateSchemaShape (load-time subset gate)', () => {
  it('accepts the supported subset', () => {
    expect(() =>
      validateSchemaShape(
        {
          type: 'object',
          required: ['score'],
          additionalProperties: false,
          properties: {
            score: { type: 'number', minimum: 0, maximum: 1 },
            verdict: { enum: ['approve', 'reject'] },
            notes: { type: 'string', minLength: 1, maxLength: 500, pattern: '^\\S' },
            files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
            exact: { const: 42 },
            multi: { type: ['string', 'null'] },
          },
        },
        'test.schema',
      ),
    ).not.toThrow();
  });

  it('accepts the empty schema (matches anything)', () => {
    expect(() => validateSchemaShape({}, 'test.schema')).not.toThrow();
  });

  it('rejects unsupported keywords instead of silently ignoring them', () => {
    expect(() => validateSchemaShape({ $ref: '#/defs/x' }, 'test.schema')).toThrow(CatalogError);
    expect(() => validateSchemaShape({ oneOf: [{ type: 'string' }] }, 'test.schema')).toThrow(
      /unsupported keyword/,
    );
  });

  it('rejects malformed keyword operands with located errors', () => {
    expect(() => validateSchemaShape({ type: 'objct' }, 'test.schema')).toThrow(/type/);
    expect(() => validateSchemaShape({ required: 'score' }, 'test.schema')).toThrow(/required/);
    expect(() =>
      validateSchemaShape({ properties: { a: { pattern: '(' } } }, 'test.schema'),
    ).toThrow(/pattern/);
    expect(() => validateSchemaShape({ additionalProperties: {} }, 'test.schema')).toThrow(
      /additionalProperties/,
    );
  });

  it('rejects non-object schemas', () => {
    expect(() => validateSchemaShape(true, 'test.schema')).toThrow(CatalogError);
    expect(() => validateSchemaShape([], 'test.schema')).toThrow(CatalogError);
  });
});

describe('schemaViolations (runtime check)', () => {
  const review = {
    type: 'object' as const,
    required: ['score', 'verdict'],
    additionalProperties: false,
    properties: {
      score: { type: 'number', minimum: 0, maximum: 1 },
      verdict: { enum: ['approve', 'reject'] },
      files: { type: 'array', items: { type: 'string' } },
    },
  };

  it('returns [] for a conforming value', () => {
    expect(schemaViolations({ score: 0.9, verdict: 'approve', files: ['a.ts'] }, review)).toEqual(
      [],
    );
  });

  it('collects every violation with a jsonpath-style location', () => {
    const issues = schemaViolations({ score: '0.9', extra: true }, review);
    expect(issues.join('\n')).toContain('$.score');
    expect(issues.join('\n')).toContain('$.verdict'); // missing required
    expect(issues.join('\n')).toContain('$.extra'); // additionalProperties: false
    expect(issues.length).toBe(3);
  });

  it('checks nested array items, bounds, enum, const, integer, and pattern', () => {
    expect(schemaViolations([1, 2.5], { type: 'array', items: { type: 'integer' } })).toHaveLength(
      1,
    );
    expect(schemaViolations([1], { type: 'array', minItems: 2 })).toHaveLength(1);
    expect(schemaViolations('x', { enum: ['a', 'b'] })).toHaveLength(1);
    expect(schemaViolations(41, { const: 42 })).toHaveLength(1);
    expect(schemaViolations('nope', { type: 'string', pattern: '^yes' })).toHaveLength(1);
    expect(schemaViolations(null, { type: ['string', 'null'] })).toEqual([]);
  });

  it('the empty schema accepts anything', () => {
    expect(schemaViolations({ anything: [1, 'x'] }, {})).toEqual([]);
  });
});

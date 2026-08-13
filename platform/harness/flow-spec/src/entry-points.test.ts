import { describe, expect, it } from 'vitest';
import * as definition from './definition.ts';
import * as run from './run.ts';
import * as tenancy from './tenancy.ts';

/** The subpath entries exist so a browser consumer can import the
 *  definition surface without dragging run-side or tenancy shapes —
 *  each entry re-exports a curated subset of the root surface. */
describe('subpath entry points', () => {
  it('./definition carries the authoring surface (types + validator + evaluator)', () => {
    expect(typeof definition.validateFlowCatalog).toBe('function');
    expect(typeof definition.evalExpression).toBe('function');
    expect(typeof definition.schemaViolations).toBe('function');
    expect(typeof definition.walkAgents).toBe('function');
    // Run-side and tenancy symbols deliberately absent.
    expect('parseFlowOutput' in definition).toBe(false);
    expect('validateUnifiedCatalog' in definition).toBe(false);
    expect('findProduct' in definition).toBe(false);
  });

  it('./run carries the run-side wire shapes', () => {
    expect(typeof run.parseFlowOutput).toBe('function');
    expect('validateFlowCatalog' in run).toBe(false);
  });

  it('./tenancy carries product shapes + the unified validator', () => {
    expect(typeof tenancy.validateUnifiedCatalog).toBe('function');
    expect(typeof tenancy.findProduct).toBe('function');
    expect('evalExpression' in tenancy).toBe(false);
  });
});

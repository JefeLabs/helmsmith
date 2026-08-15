import { describe, expect, it } from 'vitest';
import type { BootstrapStep as BootstrapStepFromDefinition } from './definition.ts';
import * as definition from './definition.ts';
import type { BootstrapStep as BootstrapStepFromRoot } from './index.ts';
import * as run from './run.ts';
import * as tenancy from './tenancy.ts';

/** The subpath entries exist so a browser consumer can import the
 *  definition surface without dragging run-side or tenancy shapes —
 *  each entry re-exports a curated subset of the root surface. */
describe('subpath entry points', () => {
  // Types erase at runtime, so this is a compile-time assertion wearing a
  // test's clothes: it fails to transform if either entry stops exporting
  // BootstrapStep. The ./definition entry matters most — a designer UI
  // building the argv editor imports from the authoring surface, not root.
  it('carries BootstrapStep on both the root and ./definition entries', () => {
    const fromRoot: BootstrapStepFromRoot = {
      run: ['copilot', 'plugin', 'install', 'superpowers@superpowers-marketplace'],
      description: 'install the plugin the system prompt assumes is present',
    };
    const fromDefinition: BootstrapStepFromDefinition = { run: ['copilot', '--version'] };

    expect(fromRoot.run[0]).toBe('copilot');
    expect(fromDefinition.run).toHaveLength(2);
  });

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

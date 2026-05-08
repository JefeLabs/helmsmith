import { describe, it, expect } from 'vitest';
import {
  BLUEPRINTS,
  getBlueprint,
  listBlueprints,
  getBlueprintsByAppType,
} from '../../../src/blueprints/registry.js';
import { ApplicationBlueprintSchema } from '../../../src/blueprints/types.js';

const EXPECTED_IDS = [
  'rest-api',
  'event-driven',
  'cli-tool',
  'data-pipeline',
  'frontend-spa',
  'fullstack-web',
  'library-sdk',
];

describe('BLUEPRINTS registry', () => {
  it('contains all 7 expected archetype IDs', () => {
    const ids = Object.keys(BLUEPRINTS);
    expect(ids).toHaveLength(7);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
  });
});

describe('getBlueprint', () => {
  it('returns a blueprint for a valid ID', () => {
    const bp = getBlueprint('rest-api');
    expect(bp).toBeDefined();
    expect(bp!.id).toBe('rest-api');
    expect(bp!.name).toBe('REST API Service');
  });

  it('returns undefined for an unknown ID', () => {
    const bp = getBlueprint('nonexistent-archetype');
    expect(bp).toBeUndefined();
  });
});

describe('listBlueprints', () => {
  it('returns all 7 blueprints with correct summary fields', () => {
    const summaries = listBlueprints();
    expect(summaries).toHaveLength(7);

    for (const summary of summaries) {
      expect(summary).toHaveProperty('id');
      expect(summary).toHaveProperty('name');
      expect(summary).toHaveProperty('appType');
      expect(summary).toHaveProperty('concernCount');
      expect(summary).toHaveProperty('nonNegotiableCount');
      expect(typeof summary.id).toBe('string');
      expect(typeof summary.name).toBe('string');
      expect(typeof summary.appType).toBe('string');
      expect(typeof summary.concernCount).toBe('number');
      expect(typeof summary.nonNegotiableCount).toBe('number');
    }
  });

  it('summary concernCount matches actual concerns length', () => {
    const summaries = listBlueprints();
    for (const summary of summaries) {
      const bp = getBlueprint(summary.id);
      expect(bp).toBeDefined();
      expect(summary.concernCount).toBe(bp!.concerns.length);
      expect(summary.nonNegotiableCount).toBe(bp!.nonNegotiableBundle.length);
    }
  });
});

describe('getBlueprintsByAppType', () => {
  it('returns rest-api and event-driven for appType "service"', () => {
    const services = getBlueprintsByAppType('service');
    const serviceIds = services.map((bp) => bp.id);
    expect(serviceIds).toContain('rest-api');
    expect(serviceIds).toContain('event-driven');
  });

  it('returns empty array for unknown appType', () => {
    const result = getBlueprintsByAppType('quantum-computing');
    expect(result).toEqual([]);
  });
});

describe('Blueprint schema validation', () => {
  it('each blueprint passes ApplicationBlueprintSchema validation', () => {
    for (const [id, bp] of Object.entries(BLUEPRINTS)) {
      const result = ApplicationBlueprintSchema.safeParse(bp);
      expect(result.success, `Blueprint "${id}" failed schema validation: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('each blueprint has at least one non-negotiable concern', () => {
    for (const [id, bp] of Object.entries(BLUEPRINTS)) {
      expect(
        bp.nonNegotiableBundle.length,
        `Blueprint "${id}" has no non-negotiable concerns`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

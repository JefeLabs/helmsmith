import { describe, it, expect } from 'vitest';
import { generateDemoData } from '../demo.js';
import { ConfigSchema, UserWeekRepoRecordSchema } from '../types/schema.js';

describe('generateDemoData', () => {
  it('returns a valid Config object', () => {
    const { config } = generateDemoData();
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('returns records that validate against UserWeekRepoRecordSchema', () => {
    const { records } = generateDemoData();
    expect(records.length).toBeGreaterThan(0);

    // Validate a sample of records (first 20 + last 20)
    const sample = [
      ...records.slice(0, 20),
      ...records.slice(-20),
    ];
    for (const record of sample) {
      const result = UserWeekRepoRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    }
  });

  it('contains both orgs: Acme Corp and ContractCo', () => {
    const { config, records } = generateDemoData();

    const orgNames = config.orgs.map((o) => o.name);
    expect(orgNames).toContain('Acme Corp');
    expect(orgNames).toContain('ContractCo');

    const recordOrgs = new Set(records.map((r) => r.org));
    expect(recordOrgs.has('Acme Corp')).toBe(true);
    expect(recordOrgs.has('ContractCo')).toBe(true);
  });

  it('contains all expected teams', () => {
    const { records } = generateDemoData();
    const teams = new Set(records.map((r) => r.team));

    expect(teams.has('Platform')).toBe(true);
    expect(teams.has('Product')).toBe(true);
    expect(teams.has('Mobile')).toBe(true);
    expect(teams.has('Frontend Squad')).toBe(true);
    expect(teams.has('Data Squad')).toBe(true);
  });

  it('Acme Corp is core and ContractCo is consultant', () => {
    const { config } = generateDemoData();

    const acme = config.orgs.find((o) => o.name === 'Acme Corp');
    const contract = config.orgs.find((o) => o.name === 'ContractCo');

    expect(acme?.type).toBe('core');
    expect(contract?.type).toBe('consultant');
  });

  it('has correct org types on records', () => {
    const { records } = generateDemoData();

    const acmeRecords = records.filter((r) => r.org === 'Acme Corp');
    const contractRecords = records.filter((r) => r.org === 'ContractCo');

    expect(acmeRecords.length).toBeGreaterThan(0);
    expect(contractRecords.length).toBeGreaterThan(0);

    for (const r of acmeRecords) {
      expect(r.orgType).toBe('core');
    }
    for (const r of contractRecords) {
      expect(r.orgType).toBe('consultant');
    }
  });

  it('generates 12 weeks by default', () => {
    const { records } = generateDemoData();
    const weeks = new Set(records.map((r) => r.week));
    expect(weeks.size).toBe(12);
  });

  it('respects custom weeks parameter', () => {
    const { records } = generateDemoData(4);
    const weeks = new Set(records.map((r) => r.week));
    expect(weeks.size).toBe(4);
  });

  it('produces reproducible data (seeded randomness)', () => {
    const first = generateDemoData(4);
    const second = generateDemoData(4);

    expect(first.records.length).toBe(second.records.length);

    // Check a sample of records match exactly
    for (let i = 0; i < Math.min(50, first.records.length); i++) {
      expect(first.records[i]).toEqual(second.records[i]);
    }
  });

  it('has multiple repo groups represented', () => {
    const { records } = generateDemoData();
    const groups = new Set(records.map((r) => r.group));

    expect(groups.size).toBeGreaterThanOrEqual(3);
  });

  it('has repos defined in config', () => {
    const { config } = generateDemoData();
    expect(config.repos.length).toBe(8);

    const repoGroups = new Set(config.repos.map((r) => r.group));
    expect(repoGroups.has('web')).toBe(true);
    expect(repoGroups.has('backend')).toBe(true);
    expect(repoGroups.has('mobile')).toBe(true);
  });

  it('all records have positive commits and valid filetype metrics', () => {
    const { records } = generateDemoData();

    for (const r of records) {
      expect(r.commits).toBeGreaterThan(0);
      expect(r.activeDays).toBeGreaterThanOrEqual(1);
      expect(r.activeDays).toBeLessThanOrEqual(5);

      // All filetype metrics should be non-negative
      for (const ft of ['app', 'test', 'config', 'storybook'] as const) {
        expect(r.filetype[ft].files).toBeGreaterThanOrEqual(0);
        expect(r.filetype[ft].insertions).toBeGreaterThanOrEqual(0);
        expect(r.filetype[ft].deletions).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('week strings match ISO week format YYYY-Www', () => {
    const { records } = generateDemoData();
    for (const r of records) {
      expect(r.week).toMatch(/^\d{4}-W\d{2}$/);
    }
  });

  it('contains expected number of members across orgs', () => {
    const { records } = generateDemoData();
    const members = new Set(records.map((r) => r.member));

    // Acme: 4+4+3 = 11, ContractCo: 2+3 = 5, total = 16
    expect(members.size).toBe(16);
  });

  it('has groups and tags in config', () => {
    const { config } = generateDemoData();

    expect(Object.keys(config.groups).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(config.tags).length).toBeGreaterThanOrEqual(2);
  });
});

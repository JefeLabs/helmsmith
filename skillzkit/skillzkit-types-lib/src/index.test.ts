import { describe, expect, it } from 'vitest';
import type { Catalog, Command, Interface, ItemKind, Skill, Workflow } from './index.js';

describe('@jefelabs/skillzkit-types', () => {
  it('Catalog accepts a minimal-but-complete shape', () => {
    const catalog: Catalog = {
      version: 1,
      generatedAt: '2026-05-10T00:00:00.000Z',
      packageVersion: '0.1.0',
      commands: [],
      skills: [],
      workflows: [],
    };
    expect(catalog.version).toBe(1);
  });

  it('Command requires slug/path/kind/description/references/referencedBy/dependsOn/dependents/body/frontmatter; outcome optional', () => {
    const cmd: Command = {
      slug: 'core:tools:npm',
      path: 'core/tools/npm.md',
      kind: 'command',
      description: 'Install npm packages',
      references: [],
      referencedBy: [],
      dependsOn: [],
      dependents: [],
      body: '# npm tool\n\nInstall packages.',
      frontmatter: {},
    };
    expect(cmd.outcome).toBeUndefined();
    expect(cmd.tags).toBeUndefined();
    expect(cmd.requires).toBeUndefined();
    expect(cmd.produces).toBeUndefined();
  });

  it('ItemKind union is exhaustive', () => {
    const kinds: ItemKind[] = ['command', 'workflow', 'context'];
    expect(kinds).toHaveLength(3);
  });

  it('Interface union is exhaustive', () => {
    const ifaces: Interface[] = ['cli', 'mcp', 'rest'];
    expect(ifaces).toHaveLength(3);
  });

  it('Workflow inherits the cross-cutting fields from Command', () => {
    const wf: Workflow = {
      qualifiedName: 'product:greenfield',
      domain: 'product',
      slug: 'greenfield',
      commandSlug: 'product:workflows:greenfield',
      description: 'Set up a new product from scratch',
      references: [],
      body: '...',
      frontmatter: {},
    };
    expect(wf.qualifiedName).toBe('product:greenfield');
  });

  it('Skill is the simplest of the three (no kind/path-relative-to-commands)', () => {
    const skill: Skill = {
      name: 'skillzkit-product-router',
      path: 'skillzkit-product-router/SKILL.md',
      description: 'Route product intent to the right command',
      references: [],
      body: '...',
      frontmatter: {},
    };
    expect(skill.name).toBe('skillzkit-product-router');
  });
});

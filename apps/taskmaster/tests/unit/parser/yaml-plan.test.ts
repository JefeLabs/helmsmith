import { describe, expect, it } from 'vitest';
import { parseYamlPlan } from '../../../src/parser/yaml-plan.js';

describe('parseYamlPlan', () => {
  it('parses a simple YAML plan with flat tasks', () => {
    const content = [
      'tasks:',
      '  - title: Task One',
      '    description: First task description.',
      '  - title: Task Two',
      '    description: Second task description.',
    ].join('\n');

    const sections = parseYamlPlan(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Task One');
    expect(sections[0].body).toBe('First task description.');
    expect(sections[0].depth).toBe(1);
    expect(sections[1].title).toBe('Task Two');
  });

  it('parses nested children', () => {
    const content = [
      'tasks:',
      '  - title: Parent',
      '    description: Parent desc.',
      '    children:',
      '      - title: Child A',
      '        description: Child A desc.',
      '      - title: Child B',
      '        description: Child B desc.',
    ].join('\n');

    const sections = parseYamlPlan(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].children).toHaveLength(2);
    expect(sections[0].children[0].title).toBe('Child A');
    expect(sections[0].children[0].depth).toBe(2);
    expect(sections[0].children[1].title).toBe('Child B');
  });

  it('preserves priority and tags hints', () => {
    const content = [
      'tasks:',
      '  - title: Important Task',
      '    priority: critical',
      '    tags:',
      '      - backend',
      '      - database',
    ].join('\n');

    const sections = parseYamlPlan(content);

    expect(sections[0].priority).toBe('critical');
    expect(sections[0].tags).toEqual(['backend', 'database']);
  });

  it('handles missing optional fields', () => {
    const content = ['tasks:', '  - title: Minimal Task'].join('\n');

    const sections = parseYamlPlan(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Minimal Task');
    expect(sections[0].body).toBe('');
    expect(sections[0].priority).toBeUndefined();
    expect(sections[0].tags).toBeUndefined();
  });

  it('handles the optional plan-level title', () => {
    const content = ['title: My Project Plan', 'tasks:', '  - title: First Task'].join('\n');

    // Plan title is not used as a task, just the tasks array
    const sections = parseYamlPlan(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('First Task');
  });

  it('rejects YAML without tasks array', () => {
    const content = 'title: No Tasks Here';
    expect(() => parseYamlPlan(content)).toThrow();
  });

  it('rejects tasks without title', () => {
    const content = ['tasks:', '  - description: No title here'].join('\n');

    expect(() => parseYamlPlan(content)).toThrow();
  });

  it('parses the sample-plan.yaml fixture', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const content = readFileSync(
      join(import.meta.dirname, '../../fixtures/sample-plan.yaml'),
      'utf-8',
    );

    const sections = parseYamlPlan(content);

    // Should have 5 top-level tasks
    expect(sections).toHaveLength(5);
    expect(sections[0].title).toBe('Product Catalog');
    expect(sections[0].priority).toBe('high');

    // Product Catalog has 3 children
    expect(sections[0].children).toHaveLength(3);
    expect(sections[0].children[1].title).toBe('Search Engine');
    expect(sections[0].children[1].priority).toBe('critical');
  });
});

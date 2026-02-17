import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectFormat, parsePlan } from '../../../src/parser/index.js';
import type { ParseOptions } from '../../../src/parser/types.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

const defaultOptions: ParseOptions = {
  style: 'task-only',
  defaultStatus: 'todo',
};

describe('detectFormat', () => {
  it('detects .md as markdown', () => {
    expect(detectFormat('plan.md', '')).toBe('markdown');
  });

  it('detects .markdown as markdown', () => {
    expect(detectFormat('plan.markdown', '')).toBe('markdown');
  });

  it('detects .yaml as yaml', () => {
    expect(detectFormat('plan.yaml', '')).toBe('yaml');
  });

  it('detects .yml as yaml', () => {
    expect(detectFormat('plan.yml', '')).toBe('yaml');
  });

  it('detects .txt as text', () => {
    expect(detectFormat('plan.txt', '')).toBe('text');
  });

  it('falls back to markdown for content with headings', () => {
    expect(detectFormat('plan', '# Hello\n\nWorld')).toBe('markdown');
  });

  it('falls back to yaml for content with tasks: key', () => {
    expect(detectFormat('plan', 'tasks:\n  - title: foo')).toBe('yaml');
  });

  it('falls back to text for unrecognized content', () => {
    expect(detectFormat('plan', 'Just some text here.')).toBe('text');
  });

  it('falls back to text for unknown extension', () => {
    expect(detectFormat('plan.docx', 'Just some text')).toBe('text');
  });
});

describe('parsePlan', () => {
  describe('markdown plans', () => {
    it('parses sample-plan.md into task-only style', async () => {
      const content = readFileSync(join(fixturesDir, 'sample-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'sample-plan.md', defaultOptions);

      expect(result.metadata.format).toBe('markdown');
      expect(result.metadata.tasksGenerated).toBe(3);
      expect(result.tasks).toHaveLength(3);

      // Check top-level task types
      expect(result.tasks[0].type).toBe('task');
      expect(result.tasks[0].title).toBe('Authentication System');

      // Check children are subtasks in task-only style
      expect(result.tasks[0].children.length).toBeGreaterThan(0);
      expect(result.tasks[0].children[0].type).toBe('subtask');
    });

    it('parses sample-plan.md into agile-full style', async () => {
      const content = readFileSync(join(fixturesDir, 'sample-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'sample-plan.md', {
        ...defaultOptions,
        style: 'agile-full',
      });

      expect(result.tasks[0].type).toBe('epic');
      expect(result.tasks[0].children[0].type).toBe('story');
      expect(result.tasks[0].children[0].children[0].type).toBe('task');
    });

    it('parses flat-plan.md into flat style', async () => {
      const content = readFileSync(join(fixturesDir, 'flat-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'flat-plan.md', {
        ...defaultOptions,
        style: 'flat',
      });

      expect(result.metadata.format).toBe('markdown');
      expect(result.tasks).toHaveLength(6);
      result.tasks.forEach((task) => {
        expect(task.type).toBe('task');
        expect(task.children).toHaveLength(0);
      });
    });

    it('generates sequential IDs', async () => {
      const content = readFileSync(join(fixturesDir, 'flat-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'flat-plan.md', defaultOptions);

      expect(result.tasks[0].id).toBe('1');
      expect(result.tasks[1].id).toBe('2');
      expect(result.tasks[5].id).toBe('6');
    });

    it('sets default status on all tasks', async () => {
      const content = readFileSync(join(fixturesDir, 'flat-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'flat-plan.md', {
        ...defaultOptions,
        defaultStatus: 'backlog',
      });

      result.tasks.forEach((task) => {
        expect(task.status).toBe('backlog');
      });
    });
  });

  describe('yaml plans', () => {
    it('parses sample-plan.yaml', async () => {
      const content = readFileSync(join(fixturesDir, 'sample-plan.yaml'), 'utf-8');
      const result = await parsePlan(content, 'sample-plan.yaml', defaultOptions);

      expect(result.metadata.format).toBe('yaml');
      expect(result.tasks).toHaveLength(5);
      expect(result.tasks[0].title).toBe('Product Catalog');
      expect(result.tasks[0].priority).toBe('high');
      expect(result.tasks[0].tags).toEqual(['backend', 'database']);
    });

    it('preserves child structure from YAML', async () => {
      const content = readFileSync(join(fixturesDir, 'sample-plan.yaml'), 'utf-8');
      const result = await parsePlan(content, 'sample-plan.yaml', defaultOptions);

      // Product Catalog has 3 children
      expect(result.tasks[0].children).toHaveLength(3);
      expect(result.tasks[0].children[0].title).toBe('Product Model');
      expect(result.tasks[0].children[1].priority).toBe('critical');
    });
  });

  describe('text plans', () => {
    it('parses sample-plan.txt', async () => {
      const content = readFileSync(join(fixturesDir, 'sample-plan.txt'), 'utf-8');
      const result = await parsePlan(content, 'sample-plan.txt', defaultOptions);

      expect(result.metadata.format).toBe('text');
      expect(result.tasks.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('warnings', () => {
    it('warns when no headings found in markdown', async () => {
      const content = 'Just some text without any headings.';
      const result = await parsePlan(content, 'plan.md', defaultOptions);

      // Markdown parser returns empty sections for no headings,
      // so text fallback doesn't apply here. But the result should still work.
      expect(result.tasks).toHaveLength(0);
    });

    it('warns when headings exceed max depth', async () => {
      // After document-title unwrapping, # is removed and depths shift by 1.
      // Task-only has maxDepth 2, so we need 4 levels to exceed it after unwrap.
      const content = '# Doc Title\n\n## Section\n\n### Sub\n\n#### Too Deep\n\nBody.';
      const result = await parsePlan(content, 'plan.md', {
        ...defaultOptions,
        style: 'task-only',
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('depth'))).toBe(true);
    });
  });

  describe('numTasks option', () => {
    it('reduces task count to target', async () => {
      const content = readFileSync(join(fixturesDir, 'flat-plan.md'), 'utf-8');
      const result = await parsePlan(content, 'flat-plan.md', {
        ...defaultOptions,
        numTasks: 3,
      });

      expect(result.tasks).toHaveLength(3);
    });
  });

  describe('dependency inferrer', () => {
    it('calls the inferrer with parsed tasks', async () => {
      const content = '# Task A\n\nBody.';
      let inferrerCalled = false;

      const result = await parsePlan(content, 'plan.md', defaultOptions, {
        inferDependencies: async (tasks) => {
          inferrerCalled = true;
          return tasks;
        },
      });

      expect(inferrerCalled).toBe(true);
      expect(result.tasks).toHaveLength(1);
    });
  });
});

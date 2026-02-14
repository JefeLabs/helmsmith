import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/parser/markdown.js';

describe('parseMarkdown', () => {
  it('parses a single heading into one section', () => {
    const content = '# My Title\n\nSome body text.';
    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('My Title');
    expect(sections[0].depth).toBe(1);
    expect(sections[0].body).toContain('Some body text.');
  });

  it('parses multiple top-level headings', () => {
    const content = '# First\n\nBody one.\n\n# Second\n\nBody two.\n\n# Third\n\nBody three.';
    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe('First');
    expect(sections[1].title).toBe('Second');
    expect(sections[2].title).toBe('Third');
  });

  it('nests sub-headings as children', () => {
    const content = '# Parent\n\nParent body.\n\n## Child One\n\nChild body.\n\n## Child Two\n\nAnother child.';
    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Parent');
    expect(sections[0].children).toHaveLength(2);
    expect(sections[0].children[0].title).toBe('Child One');
    expect(sections[0].children[0].depth).toBe(2);
    expect(sections[0].children[1].title).toBe('Child Two');
  });

  it('handles three levels of nesting', () => {
    const content = '# L1\n\n## L2\n\n### L3\n\nDeep body.';
    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].children).toHaveLength(1);
    expect(sections[0].children[0].children).toHaveLength(1);
    expect(sections[0].children[0].children[0].title).toBe('L3');
    expect(sections[0].children[0].children[0].body).toContain('Deep body.');
  });

  it('includes bullet lists in body text', () => {
    const content = '# Tasks\n\n- Item one\n- Item two\n- Item three';
    const sections = parseMarkdown(content);

    expect(sections[0].body).toContain('Item one');
    expect(sections[0].body).toContain('Item two');
    expect(sections[0].body).toContain('Item three');
  });

  it('includes numbered lists in body text', () => {
    const content = '# Steps\n\n1. First step\n2. Second step\n3. Third step';
    const sections = parseMarkdown(content);

    expect(sections[0].body).toContain('First step');
    expect(sections[0].body).toContain('Second step');
    expect(sections[0].body).toContain('Third step');
  });

  it('includes code blocks in body text', () => {
    const content = '# Config\n\n```yaml\nkey: value\n```';
    const sections = parseMarkdown(content);

    expect(sections[0].body).toContain('```yaml');
    expect(sections[0].body).toContain('key: value');
    expect(sections[0].body).toContain('```');
  });

  it('ignores content before the first heading', () => {
    const content = 'Some preamble text.\n\n# Actual Heading\n\nBody text.';
    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Actual Heading');
    expect(sections[0].body).not.toContain('preamble');
  });

  it('returns empty array for empty content', () => {
    const sections = parseMarkdown('');
    expect(sections).toHaveLength(0);
  });

  it('returns empty array for content with no headings', () => {
    const content = 'Just some text without any headings.\n\nAnother paragraph.';
    const sections = parseMarkdown(content);
    expect(sections).toHaveLength(0);
  });

  it('handles sibling sections at different depths correctly', () => {
    const content = [
      '# A',
      '## A.1',
      '## A.2',
      '# B',
      '## B.1',
      '### B.1.1',
    ].join('\n\n');

    const sections = parseMarkdown(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('A');
    expect(sections[0].children).toHaveLength(2);
    expect(sections[1].title).toBe('B');
    expect(sections[1].children).toHaveLength(1);
    expect(sections[1].children[0].children).toHaveLength(1);
  });

  it('parses the sample-plan.md fixture', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const content = readFileSync(
      join(import.meta.dirname, '../../fixtures/sample-plan.md'),
      'utf-8',
    );

    const sections = parseMarkdown(content);

    // Should have 3 top-level sections: Authentication, API Layer, Database
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe('Authentication System');
    expect(sections[1].title).toBe('API Layer');
    expect(sections[2].title).toBe('Database Layer');

    // Authentication should have 2 children: Registration, Login
    expect(sections[0].children).toHaveLength(2);
    expect(sections[0].children[0].title).toBe('User Registration');
    expect(sections[0].children[1].title).toBe('Login Flow');

    // Registration should have 1 child: Email Verification
    expect(sections[0].children[0].children).toHaveLength(1);
    expect(sections[0].children[0].children[0].title).toBe('Email Verification');

    // Email Verification body should include code block
    expect(sections[0].children[0].children[0].body).toContain('VerificationToken');
  });
});

import { describe, it, expect } from 'vitest';
import { parseText } from '../../../src/parser/text.js';

describe('parseText', () => {
  it('detects underline-style headings with ===', () => {
    const content = 'Main Title\n==========\n\nSome body text.';
    const sections = parseText(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Main Title');
    expect(sections[0].depth).toBe(1);
    expect(sections[0].body).toContain('Some body text.');
  });

  it('detects underline-style headings with ---', () => {
    const content = 'Sub Title\n---------\n\nSub body text.';
    const sections = parseText(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Sub Title');
    expect(sections[0].depth).toBe(2);
  });

  it('nests --- headings under === headings', () => {
    const content = [
      'Main',
      '====',
      '',
      'Main body.',
      '',
      'Sub',
      '---',
      '',
      'Sub body.',
    ].join('\n');

    const sections = parseText(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Main');
    expect(sections[0].children).toHaveLength(1);
    expect(sections[0].children[0].title).toBe('Sub');
    expect(sections[0].children[0].depth).toBe(2);
  });

  it('detects ALL CAPS headings', () => {
    const content = 'SETUP\n\nInstall dependencies.\n\nDEPLOYMENT\n\nDeploy to production.';
    const sections = parseText(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('SETUP');
    expect(sections[1].title).toBe('DEPLOYMENT');
  });

  it('detects numbered section patterns', () => {
    const content = [
      '1. Database Setup',
      '',
      'Configure the database.',
      '',
      '2. API Design',
      '',
      'Design the API endpoints.',
    ].join('\n');

    const sections = parseText(content);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Database Setup');
    expect(sections[1].title).toBe('API Design');
  });

  it('detects nested numbered patterns', () => {
    const content = [
      '1. Main Section',
      '',
      'Main body.',
      '',
      '1.1 Sub Section',
      '',
      'Sub body.',
    ].join('\n');

    const sections = parseText(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Main Section');
    expect(sections[0].depth).toBe(1);
    expect(sections[0].children).toHaveLength(1);
    expect(sections[0].children[0].title).toBe('Sub Section');
    expect(sections[0].children[0].depth).toBe(2);
  });

  it('falls back to single section when no patterns found', () => {
    const content = 'Just some plain text\nwith multiple lines\nand no headings.';
    const sections = parseText(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Untitled');
    expect(sections[0].body).toContain('Just some plain text');
  });

  it('handles empty content', () => {
    const sections = parseText('');
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Untitled');
    expect(sections[0].body).toBe('');
  });

  it('parses the sample-plan.txt fixture', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const content = readFileSync(
      join(import.meta.dirname, '../../fixtures/sample-plan.txt'),
      'utf-8',
    );

    const sections = parseText(content);

    // Should have 4 top-level sections (PROJECT SETUP, DATABASE LAYER, API DESIGN, DEPLOYMENT)
    expect(sections.length).toBeGreaterThanOrEqual(4);

    // Check first section
    const firstSection = sections[0];
    expect(firstSection.title).toBe('PROJECT SETUP');
    expect(firstSection.depth).toBe(1);
  });
});

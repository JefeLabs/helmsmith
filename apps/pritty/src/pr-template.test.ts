import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPullRequestTemplate, templatePromptGuidance } from './pr-template.js';

describe('findPullRequestTemplate', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pritty-prtemplate-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no template exists', () => {
    expect(findPullRequestTemplate(tmp)).toBeNull();
  });

  it('finds .github/PULL_REQUEST_TEMPLATE.md (highest priority)', () => {
    mkdirSync(join(tmp, '.github'), { recursive: true });
    writeFileSync(
      join(tmp, '.github/PULL_REQUEST_TEMPLATE.md'),
      '# PR Template\n\n## Why\n\n## Test plan\n',
    );
    const result = findPullRequestTemplate(tmp);
    expect(result?.path).toBe('.github/PULL_REQUEST_TEMPLATE.md');
    expect(result?.content).toContain('## Why');
    expect(result?.truncated).toBe(false);
  });

  it('finds repo-root pull_request_template.md (content match)', () => {
    // On case-insensitive filesystems (macOS default APFS), the
    // priority list's UPPERCASE variant resolves to the same file.
    // Assert on content, not path — the function correctly reads
    // the right file either way.
    writeFileSync(join(tmp, 'pull_request_template.md'), 'ROOT TEMPLATE');
    const result = findPullRequestTemplate(tmp);
    expect(result?.content).toBe('ROOT TEMPLATE');
  });

  it('finds docs/PULL_REQUEST_TEMPLATE.md', () => {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/PULL_REQUEST_TEMPLATE.md'), 'DOCS TEMPLATE');
    const result = findPullRequestTemplate(tmp);
    expect(result?.path).toBe('docs/PULL_REQUEST_TEMPLATE.md');
  });

  it('respects priority order — .github wins over repo root', () => {
    mkdirSync(join(tmp, '.github'), { recursive: true });
    writeFileSync(join(tmp, '.github/pull_request_template.md'), 'GITHUB DIR');
    writeFileSync(join(tmp, 'pull_request_template.md'), 'ROOT');
    const result = findPullRequestTemplate(tmp);
    expect(result?.content).toBe('GITHUB DIR');
    expect(result?.path.startsWith('.github/')).toBe(true);
  });

  it('truncates oversized templates to keep the AI context bounded', () => {
    mkdirSync(join(tmp, '.github'), { recursive: true });
    const huge = 'x'.repeat(10_000);
    writeFileSync(join(tmp, '.github/pull_request_template.md'), huge);
    const result = findPullRequestTemplate(tmp);
    expect(result?.truncated).toBe(true);
    expect(result?.content.length).toBeLessThanOrEqual(8_000);
  });
});

describe('templatePromptGuidance', () => {
  it('returns empty string when template is null', () => {
    expect(templatePromptGuidance(null)).toBe('');
  });

  it('includes the template content in a markdown code block', () => {
    const guidance = templatePromptGuidance({
      path: '.github/pull_request_template.md',
      content: '## Summary\n\n## Why',
      truncated: false,
    });
    expect(guidance).toContain('Use the following PR template');
    expect(guidance).toContain('## Summary');
    expect(guidance).toContain('## Why');
    expect(guidance).toContain('```markdown');
  });

  it('instructs the AI to drop irrelevant sections rather than pad', () => {
    const guidance = templatePromptGuidance({
      path: '.github/pull_request_template.md',
      content: 'anything',
      truncated: false,
    });
    expect(guidance).toContain('Drop sections');
  });
});

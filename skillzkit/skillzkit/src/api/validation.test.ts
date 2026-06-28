import { describe, expect, it } from 'vitest';
import type { CatalogIndex, CreateContributionRequest, ReviewFinding } from './contracts.js';
import {
  AgentAdapterReviewer,
  MockReviewer,
  parseFindings,
  shouldBlock,
  validateContribution,
  validateFileBundle,
  validateStructural,
} from './validation.js';

/* ── fixtures ────────────────────────────────────────────────── */

const emptyCatalog: CatalogIndex = {
  version: 1,
  generatedAt: '2026-05-09T00:00:00.000Z',
  packageVersion: '0.1.0',
  commands: [],
  skills: [],
  workflows: [],
};

function makeCommand(
  overrides: Partial<CreateContributionRequest> = {},
): CreateContributionRequest {
  return {
    kind: 'command',
    slug: 'core:tools:my-tool',
    frontmatter: { description: 'Helpful tool' },
    files: [
      {
        path: 'core/tools/my-tool.md',
        content: '# my-tool\n\nDoes a thing.\n',
      },
    ],
    ...overrides,
  };
}

function makeSkill(overrides: Partial<CreateContributionRequest> = {}): CreateContributionRequest {
  return {
    kind: 'skill',
    slug: 'my-skill',
    frontmatter: { name: 'my-skill', description: 'Routes intent' },
    files: [
      {
        path: 'SKILL.md',
        content: '# my-skill\n\nRoute things.\n',
      },
    ],
    ...overrides,
  };
}

function findOf(
  findings: ReviewFinding[],
  predicate: (f: ReviewFinding) => boolean,
): ReviewFinding | undefined {
  return findings.find(predicate);
}

/* ── layer 1: structural ─────────────────────────────────────── */

describe('validateStructural — slug format', () => {
  it('accepts a valid command slug', () => {
    const findings = validateStructural(makeCommand(), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findings).toEqual([]);
  });

  it('rejects an uppercase slug', () => {
    const findings = validateStructural(makeCommand({ slug: 'Core:Tools:Foo' }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('does not match'))).toBeDefined();
  });

  it('rejects a single-segment command slug (must have colons)', () => {
    const findings = validateStructural(makeCommand({ slug: 'my-tool' }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.severity === 'high')).toBeDefined();
  });

  it('accepts a valid skill name without colons', () => {
    const findings = validateStructural(makeSkill(), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findings).toEqual([]);
  });

  it('rejects a colonized skill name', () => {
    const findings = validateStructural(makeSkill({ slug: 'skill:with:colons' }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.severity === 'high')).toBeDefined();
  });
});

describe('validateStructural — required frontmatter', () => {
  it('rejects missing description', () => {
    const findings = validateStructural(makeCommand({ frontmatter: {} }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('description'))).toBeDefined();
  });

  it('rejects empty description', () => {
    const findings = validateStructural(makeCommand({ frontmatter: { description: '   ' } }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('description'))).toBeDefined();
  });

  it('requires `outcome` for workflows', () => {
    const wf: CreateContributionRequest = {
      kind: 'workflow',
      slug: 'product:greenfield',
      frontmatter: { description: 'Bootstrap a new product' },
      files: [{ path: 'product/workflows/greenfield.md', content: '...' }],
    };
    const findings = validateStructural(wf, {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('outcome'))).toBeDefined();
  });

  it('requires `name` for skills', () => {
    const findings = validateStructural(makeSkill({ frontmatter: { description: '...' } }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('name'))).toBeDefined();
  });
});

describe('validateStructural — tags', () => {
  it('accepts core tags silently', () => {
    const findings = validateStructural(
      makeCommand({ frontmatter: { description: 'x', tags: ['accessibility'] } }),
      { catalog: emptyCatalog, coreTags: new Set(['accessibility']) },
    );
    expect(findings).toEqual([]);
  });

  it('flags extension tags as low severity (not blocking)', () => {
    const findings = validateStructural(
      makeCommand({ frontmatter: { description: 'x', tags: ['new-extension'] } }),
      { catalog: emptyCatalog, coreTags: new Set(['accessibility']) },
    );
    const ext = findOf(findings, (f) => f.message.includes('extension'));
    expect(ext?.severity).toBe('low');
  });

  it('rejects malformed tag format', () => {
    const findings = validateStructural(
      makeCommand({ frontmatter: { description: 'x', tags: ['BAD CAPS'] } }),
      { catalog: emptyCatalog, coreTags: new Set() },
    );
    expect(
      findOf(findings, (f) => f.severity === 'high' && f.message.includes('violates format')),
    ).toBeDefined();
  });

  it('flags duplicate tags as medium severity', () => {
    const findings = validateStructural(
      makeCommand({
        frontmatter: { description: 'x', tags: ['accessibility', 'accessibility'] },
      }),
      { catalog: emptyCatalog, coreTags: new Set(['accessibility']) },
    );
    expect(
      findOf(findings, (f) => f.severity === 'medium' && f.message.includes('Duplicate')),
    ).toBeDefined();
  });
});

describe('validateStructural — references', () => {
  it("flags references that don't resolve in the catalog", () => {
    const findings = validateStructural(
      makeCommand({
        files: [{ path: 'x.md', content: 'see /does:not:exist for details' }],
      }),
      { catalog: emptyCatalog, coreTags: new Set() },
    );
    const ref = findOf(findings, (f) => f.message.includes('does:not:exist'));
    expect(ref?.severity).toBe('medium');
  });

  it('does not flag references to slugs in the catalog', () => {
    const catalog: CatalogIndex = {
      ...emptyCatalog,
      commands: [
        {
          slug: 'core:tools:other',
          path: 'core/tools/other.md',
          kind: 'command',
          description: 'x',
          references: [],
          referencedBy: [],
          frontmatter: {},
        },
      ],
    };
    const findings = validateStructural(
      makeCommand({
        files: [{ path: 'x.md', content: 'see /core:tools:other' }],
      }),
      { catalog, coreTags: new Set() },
    );
    expect(findOf(findings, (f) => f.message.includes('core:tools:other'))).toBeUndefined();
  });
});

describe('validateStructural — body length', () => {
  it('flags bodies over the size cap', () => {
    const huge = 'x'.repeat(60_000);
    const findings = validateStructural(makeCommand({ files: [{ path: 'x.md', content: huge }] }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
    });
    expect(findOf(findings, (f) => f.message.includes('Body of'))).toBeDefined();
  });
});

/* ── layer 2: file bundle ────────────────────────────────────── */

describe('validateFileBundle — required files', () => {
  it('rejects skills without SKILL.md', () => {
    const findings = validateFileBundle(
      makeSkill({ files: [{ path: 'other.md', content: '...' }] }),
    );
    expect(findOf(findings, (f) => f.message.includes('SKILL.md'))).toBeDefined();
  });

  it('rejects commands with multiple .md files', () => {
    const findings = validateFileBundle(
      makeCommand({
        files: [
          { path: 'a.md', content: '...' },
          { path: 'b.md', content: '...' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('exactly one'))).toBeDefined();
  });
});

describe('validateFileBundle — path safety', () => {
  it('rejects paths with `..` traversal', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: '../escape.py', content: '...' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('traversal'))).toBeDefined();
  });

  it('rejects absolute paths', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [{ path: '/etc/passwd', content: 'x' }],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('absolute'))).toBeDefined();
  });

  it('rejects paths with null bytes', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: 'evil .py', content: 'x' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('null byte'))).toBeDefined();
  });

  it('flags dotfile segments at medium severity', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: '.hidden.py', content: '...' },
        ],
      }),
    );
    const f = findOf(findings, (f) => f.message.includes('dotfile'));
    expect(f?.severity).toBe('medium');
  });
});

describe('validateFileBundle — file types', () => {
  it('rejects disallowed extensions', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: 'binary.exe', content: '...' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('allowlist'))).toBeDefined();
  });

  it('accepts the canonical allowlist (md, py, sh, ts, js, json, yaml, toml)', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: 'runner.py', content: "print('hi')" },
          { path: 'setup.sh', content: '#!/bin/sh\n' },
          { path: 'helper.ts', content: 'export const x = 1;' },
          { path: 'lib.js', content: 'module.exports = {};' },
          { path: 'config.json', content: '{"a":1}' },
          { path: 'settings.yaml', content: 'a: 1' },
          { path: 'Cargo.toml', content: '[package]\nname = "x"' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('allowlist'))).toBeUndefined();
  });
});

describe('validateFileBundle — size', () => {
  it('rejects oversize per-file content', () => {
    const huge = 'x'.repeat(150_000);
    const findings = validateFileBundle(
      makeCommand({
        files: [{ path: 'x.md', content: huge }],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('max'))).toBeDefined();
  });
});

describe('validateFileBundle — secret scanning', () => {
  it('flags AWS access keys', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: 'config.py', content: "AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'" },
        ],
      }),
    );
    const f = findOf(findings, (f) => f.message.includes('AWS access key'));
    expect(f?.severity).toBe('high');
  });

  it('flags GitHub PATs', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          {
            path: 'deploy.sh',
            content: 'TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('GitHub'))).toBeDefined();
  });

  it('flags PEM private keys', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          {
            path: 'key.txt',
            content: '-----BEGIN RSA PRIVATE KEY-----\nMII...\n',
          },
        ],
      }),
    );
    // .txt is not in allowlist so we'll get an extension finding too;
    // but the secret should still be detected on the content.
    expect(findOf(findings, (f) => f.message.includes('PEM private key'))).toBeDefined();
  });

  it('does not false-positive on legitimate-looking strings', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [{ path: 'SKILL.md', content: 'Use AKIA-style placeholders, e.g. AKIAEXAMPLE.' }],
      }),
    );
    // AKIAEXAMPLE is too short for the regex (needs 16 chars after AKIA)
    expect(findOf(findings, (f) => f.message.includes('AWS access key'))).toBeUndefined();
  });
});

describe('validateFileBundle — JSON parse', () => {
  it('flags malformed JSON', () => {
    const findings = validateFileBundle(
      makeSkill({
        files: [
          { path: 'SKILL.md', content: '...' },
          { path: 'config.json', content: '{ not json' },
        ],
      }),
    );
    expect(findOf(findings, (f) => f.message.includes('does not parse'))).toBeDefined();
  });
});

/* ── layer 3: reviewer ───────────────────────────────────────── */

describe('MockReviewer', () => {
  it('returns no findings by default', async () => {
    const reviewer = new MockReviewer();
    const result = await reviewer.review({
      kind: 'command',
      slug: 'x:y:z',
      files: [],
      frontmatter: {},
    });
    expect(result).toEqual([]);
  });

  it('returns canned findings when configured', async () => {
    const canned: ReviewFinding[] = [{ severity: 'high', axis: 'safety', message: 'bad' }];
    const reviewer = new MockReviewer(canned);
    const result = await reviewer.review({
      kind: 'command',
      slug: 'x:y:z',
      files: [],
      frontmatter: {},
    });
    expect(result).toEqual(canned);
  });
});

describe('AgentAdapterReviewer', () => {
  it('invokes the adapter with system+user prompts and parses findings', async () => {
    let captured: { system?: string; user: string } | undefined;
    const reviewer = new AgentAdapterReviewer({
      adapter: {
        async invoke(spec) {
          captured = spec;
          return JSON.stringify({
            findings: [{ severity: 'low', axis: 'quality', message: 'minor nit' }],
          });
        },
      },
    });
    const findings = await reviewer.review({
      kind: 'skill',
      slug: 'my-skill',
      files: [{ path: 'SKILL.md', content: 'Body' }],
      frontmatter: { name: 'my-skill', description: 'x' },
    });
    expect(captured?.system).toContain('QUALITY');
    expect(captured?.user).toContain('Slug/Name: my-skill');
    expect(captured?.user).toContain('BEGIN FILE: SKILL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
  });

  it('returns a meta-finding (not throws) when adapter returns garbage', async () => {
    const reviewer = new AgentAdapterReviewer({
      adapter: {
        async invoke() {
          return 'not JSON, just prose';
        },
      },
    });
    const findings = await reviewer.review({
      kind: 'command',
      slug: 'x:y:z',
      files: [],
      frontmatter: { description: 'x' },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('strips code-fence wrapper in adapter response', async () => {
    const reviewer = new AgentAdapterReviewer({
      adapter: {
        async invoke() {
          return '```json\n{"findings":[{"severity":"high","axis":"safety","message":"oops"}]}\n```';
        },
      },
    });
    const findings = await reviewer.review({
      kind: 'command',
      slug: 'x:y:z',
      files: [],
      frontmatter: { description: 'x' },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });
});

describe('parseFindings — robustness', () => {
  it('extracts JSON embedded in surrounding prose', () => {
    const out = parseFindings(
      `Here are my findings: {"findings":[{"severity":"medium","axis":"quality","message":"redundant"}]}. Hope that helps.`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].axis).toBe('quality');
  });

  it('filters out malformed individual findings', () => {
    const out = parseFindings(
      `{"findings":[{"severity":"high","axis":"safety","message":"ok"},{"oops":"bad shape"}]}`,
    );
    expect(out).toHaveLength(1);
  });
});

describe('shouldBlock policy', () => {
  it('blocks on any high-severity finding', () => {
    expect(shouldBlock([{ severity: 'high', axis: 'safety', message: 'x' }])).toBe(true);
  });

  it('does not block on medium or low', () => {
    expect(
      shouldBlock([
        { severity: 'medium', axis: 'quality', message: 'x' },
        { severity: 'low', axis: 'structural', message: 'y' },
      ]),
    ).toBe(false);
  });
});

/* ── orchestrator ────────────────────────────────────────────── */

describe('validateContribution — orchestration', () => {
  it('accumulates findings from all layers', async () => {
    const result = await validateContribution(
      makeCommand({
        slug: 'BAD',
        files: [
          { path: 'a.md', content: '...' },
          { path: 'b.md', content: '...' },
        ],
      }),
      { catalog: emptyCatalog, coreTags: new Set() },
    );
    // Layer 1 should flag the bad slug; layer 2 should flag the
    // multiple .md files. Both should appear in the same result.
    expect(
      findOf(result.findings, (f) => f.axis === 'structural' && f.severity === 'high'),
    ).toBeDefined();
    expect(
      findOf(result.findings, (f) => f.axis === 'bundle' && f.severity === 'high'),
    ).toBeDefined();
    expect(result.passed).toBe(false);
  });

  it('skips layer 3 when layers 1+2 already found high-severity issues', async () => {
    let reviewerCalled = false;
    const reviewer: import('./validation.js').ContributionReviewer = {
      async review() {
        reviewerCalled = true;
        return [];
      },
    };
    await validateContribution(makeCommand({ slug: 'BAD' }), {
      catalog: emptyCatalog,
      coreTags: new Set(),
      reviewer,
    });
    expect(reviewerCalled).toBe(false);
  });

  it('runs layer 3 when layers 1+2 pass', async () => {
    let reviewerCalled = false;
    const reviewer: import('./validation.js').ContributionReviewer = {
      async review() {
        reviewerCalled = true;
        return [];
      },
    };
    const result = await validateContribution(makeCommand(), {
      catalog: emptyCatalog,
      coreTags: new Set(),
      reviewer,
    });
    expect(reviewerCalled).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('treats reviewer errors as medium-severity, not rejection', async () => {
    const reviewer: import('./validation.js').ContributionReviewer = {
      async review() {
        throw new Error('provider down');
      },
    };
    const result = await validateContribution(makeCommand(), {
      catalog: emptyCatalog,
      coreTags: new Set(),
      reviewer,
    });
    const meta = findOf(result.findings, (f) => f.message.includes('Agent reviewer error'));
    expect(meta?.severity).toBe('medium');
    // Still passes since medium doesn't block
    expect(result.passed).toBe(true);
  });
});

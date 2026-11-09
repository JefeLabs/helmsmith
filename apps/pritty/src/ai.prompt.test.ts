import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateCommitMessages, generatePR } from './ai.js';
import { ConfigSchema } from './config.js';

/**
 * What pritty sends the model and how it reads the answer. A stand-in
 * `claude` on PATH records its argv and stdin and answers with the envelope
 * `claude -p --output-format json` prints, so no test reaches a model.
 */
let tmp: string;
const originalPath = process.env.PATH ?? '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pritty-prompt-test-'));
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\nprintf '%s\\0' "$@" > "${tmp}/argv"\ncat > "${tmp}/stdin"\ncat "${tmp}/envelope.json"\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(tmp, { recursive: true, force: true });
});

function answer(result: string): void {
  writeFileSync(
    join(tmp, 'envelope.json'),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }),
  );
}

function sent(): { system: string; prompt: string } {
  const argv = readFileSync(join(tmp, 'argv'), 'utf8').split('\0');
  return {
    system: argv[argv.indexOf('--system-prompt') + 1] ?? '',
    prompt: readFileSync(join(tmp, 'stdin'), 'utf8'),
  };
}

const config = ConfigSchema.parse({ provider: 'claude' });

describe('generateCommitMessages', () => {
  it('accepts a single commit object as a one-commit plan', async () => {
    answer(JSON.stringify({ category: 'app', message: 'fix(pin): pin x', files: [] }));
    const plan = await generateCommitMessages({ app: ['src/a.ts'] }, '+a', config);
    expect(plan).toEqual([{ category: 'app', message: 'fix(pin): pin x', files: [] }]);
  });

  it('still refuses an answer that is neither a plan nor a commit', async () => {
    answer(JSON.stringify({ note: 'no' }));
    await expect(generateCommitMessages({ app: ['src/a.ts'] }, '+a', config)).rejects.toThrow(
      /non-array output/,
    );
  });

  it('gives the model the branch name and what a fix/ branch means', async () => {
    answer(JSON.stringify([{ category: 'app', message: 'fix: x', files: [] }]));
    await generateCommitMessages({ app: ['src/a.ts'] }, '+a', config, undefined, {
      branch: 'fix/family/my-profile--phone-kenya',
    });
    const { system, prompt } = sent();
    expect(prompt).toContain('Branch: fix/family/my-profile--phone-kenya');
    expect(system).toMatch(/fix\/.*branch/i);
  });
});

describe('generatePR', () => {
  it('does not ask for a checklist of unchecked boxes', async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    await generatePR(
      [{ hash: 'a'.repeat(40), subject: 'fix(x): y' }],
      { branch: 'fix/x', base: 'main', owner: 'o', repo: 'r' },
      config,
    );
    const { system } = sent();
    expect(system).not.toMatch(/checklist/i);
    expect(system).toMatch(/no `- \[ \]` checkboxes/i);
  });
});

describe('generatePR input (item 9: the model saw only commit subjects)', () => {
  const meta = { branch: 'fix/x', base: 'main', owner: 'o', repo: 'r' };

  it("gives the model each commit's body and the changed files", async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    await generatePR(
      [
        {
          hash: 'a'.repeat(40),
          subject: 'fix(phone): store one dial code',
          body: 'The change-phone modal saved +1 +15553217654.\nNow it saves +15553217654.',
        },
        { hash: 'b'.repeat(40), subject: 'test(phone): cover the modal' },
      ],
      { ...meta, files: ['app-ui/components/ChangePhoneModal.tsx', 'app-ui/test/phone.test.ts'] },
      config,
    );
    const { system, prompt } = sent();
    expect(prompt).toContain('fix(phone): store one dial code');
    expect(prompt).toContain('The change-phone modal saved +1 +15553217654.');
    expect(prompt).toContain('Now it saves +15553217654.');
    expect(prompt).toContain('Changed files (2):');
    expect(prompt).toContain('app-ui/components/ChangePhoneModal.tsx');
    expect(system).toMatch(/commit bodies/i);
  });

  it('caps the commit and file listing at the same 12,000 characters as the commit diff', async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    const huge = 'x'.repeat(9_000);
    await generatePR(
      [
        { hash: 'a'.repeat(40), subject: 'fix(a): one', body: huge },
        { hash: 'b'.repeat(40), subject: 'fix(a): two', body: huge },
      ],
      { ...meta, files: ['src/a.ts'] },
      config,
    );
    const { prompt } = sent();
    expect(prompt.length).toBeLessThan(12_000 + 500);
    expect(prompt).toContain('... (truncated)');
    expect(prompt).toContain('fix(a): one');
  });
});

describe('generatePR commit bodies: trailers out, every commit kept under the cap', () => {
  const meta = { branch: 'fix/x', base: 'main', owner: 'o', repo: 'r' };

  it('drops the attribution trailers and keeps the rest of the body, Refs included', async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    await generatePR(
      [
        {
          hash: 'a'.repeat(40),
          subject: 'fix(student-import): widen the csv import dialog',
          body: [
            'Step 2 columns overflowed the sm:max-w-md dialog.',
            '',
            'Refs #6114 (kept open for the jefeui follow-up).',
            '',
            'Commit-Message-By: pritty',
            'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
            'Signed-off-by: E <e@x>',
          ].join('\n'),
        },
      ],
      meta,
      config,
    );
    const { prompt } = sent();
    expect(prompt).toContain('Step 2 columns overflowed the sm:max-w-md dialog.');
    expect(prompt).toContain('Refs #6114 (kept open for the jefeui follow-up).');
    expect(prompt).not.toMatch(/Co-Authored-By|Commit-Message-By/i);
    expect(prompt).toContain('Signed-off-by: E <e@x>');
  });

  it('strips only Commit-Message-By and Co-Authored-By, only from the closing trailer block', async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    await generatePR(
      [
        {
          hash: 'a'.repeat(40),
          subject: 'docs(team): explain pairing credit',
          body: [
            'GitHub credits a pair from a line like this one:',
            'co-authored-by: Name <name@example.com>',
            '',
            'Refs: #1',
            'commit-message-by: pritty',
            'CO-AUTHORED-BY: Claude Opus 5.5 <noreply@anthropic.com>',
          ].join('\n'),
        },
      ],
      meta,
      config,
    );
    const { prompt } = sent();
    expect(prompt).toContain('Refs: #1');
    expect(prompt).toContain('co-authored-by: Name <name@example.com>');
    expect(prompt).not.toContain('commit-message-by: pritty');
    expect(prompt).not.toContain('CO-AUTHORED-BY');
  });

  it('keeps every subject and a share of every body when the bodies outgrow the cap', async () => {
    answer(JSON.stringify({ title: 't', body: 'b', labels: [] }));
    await generatePR(
      ['a', 'b', 'c'].map((ch) => ({
        hash: ch.repeat(40),
        subject: `fix(${ch}): change ${ch}`,
        body: ch.repeat(9_000),
      })),
      { ...meta, files: ['src/a.ts'] },
      config,
    );
    const { prompt } = sent();
    expect(prompt.length).toBeLessThan(12_000 + 500);
    for (const ch of ['a', 'b', 'c']) {
      expect(prompt).toContain(`fix(${ch}): change ${ch}`);
      expect(prompt).toContain(ch.repeat(2_000));
    }
  });
});

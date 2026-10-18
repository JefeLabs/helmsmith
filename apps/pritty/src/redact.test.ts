import { describe, expect, it, vi } from 'vitest';
import { redactDiff, withTimeout } from './redact.js';

describe('redactDiff', () => {
  it('masks secret-looking assignments, bearer tokens and well-known token prefixes', () => {
    const diff = [
      '+API_KEY=abc123secretvalue',
      '+  password: "hunter2"',
      '+Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      '+const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
      '+aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
      '+const port = 3000;',
    ].join('\n');
    const out = redactDiff(diff);
    expect(out).not.toContain('abc123secretvalue');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('+const port = 3000;');
    expect(out).toContain('[REDACTED]');
  });

  it('drops private key blocks', () => {
    const diff = [
      '+-----BEGIN RSA PRIVATE KEY-----',
      '+MIIEowIBAAKCAQEA7',
      '+-----END RSA PRIVATE KEY-----',
      '+after',
    ].join('\n');
    const out = redactDiff(diff);
    expect(out).not.toContain('MIIEowIBAAKCAQEA7');
    expect(out).toContain('+after');
  });

  it('omits the whole diff of files that are secrets by name', () => {
    const diff = [
      'diff --git a/.env b/.env',
      '+DB_URL=postgres://u:p@h/db',
      'diff --git a/src/a.ts b/src/a.ts',
      '+export const a = 1;',
      'diff --git a/certs/server.pem b/certs/server.pem',
      '+-----BEGIN CERTIFICATE-----',
    ].join('\n');
    const out = redactDiff(diff);
    expect(out).not.toContain('postgres://');
    expect(out).toContain('[diff for .env omitted]');
    expect(out).toContain('+export const a = 1;');
    expect(out).toContain('[diff for certs/server.pem omitted]');
  });
});

describe('withTimeout', () => {
  it('rejects a call that never settles, naming it', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise<never>(() => {}), 1000, 'AI request');
      const assertion = expect(p).rejects.toThrow(/AI request timed out after 1000 ms/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes a value through when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
  });
});

describe('redactDiff hardening', () => {
  it('scans context lines too, not only added and removed ones', () => {
    const out = redactDiff(' TOKEN=abcdef123456\n+x = 1');
    expect(out).not.toContain('abcdef123456');
    expect(out).toContain('+x = 1');
  });

  it('omits secret files whose header paths are quoted, renamed from, or combined diffs', () => {
    const diff = [
      'diff --git "a/.env" "b/.env"',
      '+A=1secret',
      'diff --git a/.env b/renamed.txt',
      'similarity index 100%',
      '+B=2secret',
      'diff --cc .env.local',
      '+C=3secret',
      'diff --git a/src/ok.ts b/src/ok.ts',
      '+export const ok = true;',
    ].join('\n');
    const out = redactDiff(diff);
    expect(out).not.toMatch(/[123]secret/);
    expect(out).toContain('+export const ok = true;');
  });
});

describe('redactDiff against header shapes git really emits', () => {
  it('omits a secret file whose path has spaces (git does not quote those)', () => {
    const diff = [
      'diff --git a/config/prod secrets.json b/config/prod secrets.json',
      'index 1..2 100644',
      '--- a/config/prod secrets.json',
      '+++ b/config/prod secrets.json',
      '+{"k":"1secret"}',
      'diff --git a/src/ok.ts b/src/ok.ts',
      '+export const ok = true;',
    ].join('\n');
    const out = redactDiff(diff);
    expect(out).not.toContain('1secret');
    expect(out).toContain('+export const ok = true;');
  });

  it('handles CRLF line endings', () => {
    const diff = ['diff --git a/.env b/.env', '+A=2secret', 'diff --git a/x.ts b/x.ts', '+ok'].join(
      '\r\n',
    );
    const out = redactDiff(diff);
    expect(out).not.toContain('2secret');
    expect(out).toContain('+ok');
  });

  it('decides from the +++ line when the header was ambiguous', () => {
    const diff = [
      'diff --git a/weird b/thing b/.env',
      '--- a/weird b/thing',
      '+++ b/.env',
      '+C=3secret',
    ].join('\n');
    expect(redactDiff(diff)).not.toContain('3secret');
  });
});

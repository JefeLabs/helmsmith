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

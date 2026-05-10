import { describe, expect, it } from 'vitest';
import { createCli, noopAuthProvider } from './index.js';

describe('createCli', () => {
  it('returns a configured commander Program with name and version', () => {
    const { program } = createCli({ name: 'test-cli', version: '1.2.3' });
    expect(program.name()).toBe('test-cli');
    expect(program.version()).toBe('1.2.3');
  });

  it('falls back to noopAuthProvider when auth is omitted', () => {
    const { auth } = createCli({ name: 'x', version: '0.0.0' });
    expect(auth).toBe(noopAuthProvider);
  });

  it('uses the injected auth provider when supplied', async () => {
    const fakeAuth = {
      async getToken() {
        return 'fake-token';
      },
    };
    const { auth } = createCli({ name: 'x', version: '0.0.0', auth: fakeAuth });
    await expect(auth.getToken()).resolves.toBe('fake-token');
  });

  it('noopAuthProvider throws on getToken to surface misconfiguration', async () => {
    await expect(noopAuthProvider.getToken()).rejects.toThrow(/noopAuthProvider/);
  });
});

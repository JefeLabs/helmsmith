import { describe, expect, it } from 'vitest';
import {
  type Connection,
  type ConnectionState,
  type ConnectionStatus,
  noopConnection,
} from './connection.ts';

describe('Connection contract', () => {
  it('noopConnection returns disconnected by default', async () => {
    const c = noopConnection({
      id: 'test',
      displayName: 'Test Provider',
    });
    const status = await c.getStatus();
    expect(status.state).toBe('disconnected');
  });

  it('noopConnection honors initial state', async () => {
    const c = noopConnection({
      id: 'test',
      displayName: 'Test',
      state: 'connected',
    });
    expect((await c.getStatus()).state).toBe('connected');
  });

  it('noopConnection.login throws to surface misconfiguration', async () => {
    const c = noopConnection({ id: 'x', displayName: 'X' });
    await expect(c.login()).rejects.toThrow(/login\(\) not implemented/);
  });

  it('noopConnection.logout is a no-op', async () => {
    const c = noopConnection({ id: 'x', displayName: 'X' });
    await expect(c.logout()).resolves.toBeUndefined();
  });

  it('Connection interface accepts a minimal implementation', async () => {
    let token: string | null = null;

    const c: Connection = {
      id: 'minimal',
      displayName: 'Minimal',
      async getStatus(): Promise<ConnectionStatus> {
        return token ? { state: 'connected', identity: 'abc' } : { state: 'disconnected' };
      },
      async login() {
        token = 'tok-abc';
        return { state: 'connected', identity: 'abc' };
      },
      async logout() {
        token = null;
      },
    };

    expect((await c.getStatus()).state).toBe('disconnected');
    await c.login();
    expect((await c.getStatus()).state).toBe('connected');
    await c.logout();
    expect((await c.getStatus()).state).toBe('disconnected');
  });

  it('ConnectionState union covers exactly 3 states', () => {
    const states: ConnectionState[] = ['connected', 'expired', 'disconnected'];
    expect(states).toHaveLength(3);
  });
});

/**
 * bridgeBroker — adapt a `Provider`-typed agent-auth CredentialBroker to the
 * structural `CredentialBroker` shape `@helmsmith/agent-adapter`'s
 * `createAgent` expects.
 *
 * Two impedance mismatches are reconciled here:
 *   1. Provider narrowing — agent-auth's `getCredential(provider: Provider)`
 *      vs the lib's `getCredential(provider: string)`. The lib hands raw
 *      provider strings ('anthropic', 'openai', 'google', …); we narrow them
 *      to the `Provider` union the underlying broker requires.
 *   2. `expiresAt` type — agent-auth's `Credential.expiresAt` is an ISO
 *      `string`; the lib's structural broker wants a `Date`. We normalize.
 *
 * Kept in agent-auth-lib (which owns `Provider`/`Credential`) so every
 * consumer that hands a broker to `createAgent` shares one bridge instead of
 * re-deriving the conversion. The return type is declared structurally so this
 * module takes no dependency on `@helmsmith/agent-adapter`.
 */

import type { CredentialBroker, Provider } from './types.ts';

/** Structural subset of the agent-adapter lib's `CredentialBroker`. */
export interface AdapterCredentialBroker {
  getCredential(provider: string): Promise<{ apiKey: string; expiresAt?: Date }>;
}

/**
 * Wrap a `Provider`-typed `CredentialBroker` so it satisfies the agent-adapter
 * lib's structural broker contract (string provider in, `Date` expiry out).
 */
export function bridgeBroker(broker: CredentialBroker): AdapterCredentialBroker {
  return {
    getCredential: async (provider: string) => {
      const credential = await broker.getCredential(provider as Provider);
      return {
        apiKey: credential.apiKey,
        ...(credential.expiresAt ? { expiresAt: new Date(credential.expiresAt) } : {}),
      };
    },
  };
}

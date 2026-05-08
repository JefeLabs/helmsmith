import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge } from '../../../src/auth/oauth-pkce.js';

describe('oauth-pkce', () => {
  describe('generateCodeVerifier', () => {
    it('generates a URL-safe string of specified length', () => {
      const verifier = generateCodeVerifier(64);
      expect(verifier).toHaveLength(64);
      // base64url characters only
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates different values on each call', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });

    it('uses default length of 64', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toHaveLength(64);
    });

    it('supports custom lengths', () => {
      const short = generateCodeVerifier(43);
      expect(short).toHaveLength(43);
    });
  });

  describe('generateCodeChallenge', () => {
    it('produces a base64url-encoded SHA-256 hash', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = generateCodeChallenge(verifier);
      // Should be base64url (no +, /, or =)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('produces deterministic output for same input', () => {
      const verifier = 'test-verifier-12345';
      const c1 = generateCodeChallenge(verifier);
      const c2 = generateCodeChallenge(verifier);
      expect(c1).toBe(c2);
    });

    it('produces different output for different input', () => {
      const c1 = generateCodeChallenge('verifier-a');
      const c2 = generateCodeChallenge('verifier-b');
      expect(c1).not.toBe(c2);
    });
  });
});

/**
 * The regression that matters most: the root entry must not reach any optional
 * provider SDK, and must register nothing.
 *
 * Before externalization, importing the root pulled all 11 adapter modules —
 * three of which statically import an optional peer (bedrock-sdk/index.ts,
 * gemini-sdk/index.ts, openai-sdk/index.ts). A host that had not installed
 * those peers crashed at module load, so "optional" was true only on paper.
 *
 * The check runs in a subprocess with those packages made unresolvable, which
 * is the closest thing to a host that never installed them. Vitest's own module
 * graph cannot express this — it already has the dev-dependency copies loaded.
 *
 * NOTE: the subprocess uses Node's native type stripping, which is strip-ONLY
 * and rejects TypeScript parameter properties (`constructor(private readonly
 * x: T)`). The adapter classes use those, so this technique can import the ROOT
 * entry but never an adapter module. That is exactly the boundary under test.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OPTIONAL_PEERS = [
  '@aws-sdk/client-bedrock-runtime',
  '@google/genai',
  'openai',
  '@anthropic-ai/sdk',
  '@anthropic-ai/claude-agent-sdk',
];

const ROOT_ENTRY = new URL('./index.ts', import.meta.url).href;

describe('root entry', () => {
  it('imports cleanly with every optional provider SDK unresolvable', () => {
    const script = `
      const Module = require('node:module');
      const orig = Module._resolveFilename;
      const blocked = ${JSON.stringify(OPTIONAL_PEERS)};
      Module._resolveFilename = function (req, ...rest) {
        if (blocked.includes(req)) {
          const e = new Error("Cannot find package '" + req + "'");
          e.code = 'MODULE_NOT_FOUND';
          throw e;
        }
        return orig.call(this, req, ...rest);
      };
      import(${JSON.stringify(ROOT_ENTRY)})
        .then((m) => {
          const registered = m.registeredAdapterTypes();
          if (registered.length !== 0) {
            console.error('root registered: ' + registered.join(', '));
            process.exit(1);
          }
          if (Object.keys(m.ADAPTER_CATALOG).length !== 11) {
            console.error('catalog size: ' + Object.keys(m.ADAPTER_CATALOG).length);
            process.exit(1);
          }
          console.log('OK');
        })
        .catch((err) => {
          console.error(err.message);
          process.exit(1);
        });
    `;
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.trim()).toBe('OK');
  });

  it('has no adapters barrel left to import', () => {
    expect(existsSync(new URL('./adapters/index.ts', import.meta.url))).toBe(false);
  });
});

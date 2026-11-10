import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { name, version } from './index.js';

describe('library entry', () => {
  it('exports the package name and the version from package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as {
      name: string;
      version: string;
    };
    expect(name).toBe(pkg.name);
    expect(version).toBe(pkg.version);
  });
});

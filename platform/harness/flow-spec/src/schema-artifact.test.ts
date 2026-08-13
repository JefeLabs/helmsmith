/**
 * Drift guard for the generated JSON Schema artifact (roadmap 1.2):
 * regenerates the schema from the current types and compares it to the
 * checked-in `schema/flow-spec.schema.json`. A type change that skips
 * `pnpm schema` fails here — the artifact can never silently drift
 * from the TypeScript contract, which is the whole point of generating
 * it instead of hand-porting rules to Java.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGenerator } from 'ts-json-schema-generator';
import { describe, expect, it } from 'vitest';

describe('generated JSON Schema artifact', () => {
  it('schema/flow-spec.schema.json matches the current types (run `pnpm schema` after type changes)', () => {
    const generated = createGenerator({
      path: join(__dirname, 'schema-roots.ts'),
      type: 'FlowSpecSchemaRoots',
      tsconfig: join(__dirname, '..', 'tsconfig.json'),
    }).createSchema('FlowSpecSchemaRoots');
    const checkedIn = JSON.parse(
      readFileSync(join(__dirname, '..', 'schema', 'flow-spec.schema.json'), 'utf8'),
    );
    expect(generated).toEqual(checkedIn);
  });

  it('exposes every wire-shape root a non-TypeScript consumer needs', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '..', 'schema', 'flow-spec.schema.json'), 'utf8'),
    );
    const roots = Object.keys(schema.definitions?.FlowSpecSchemaRoots?.properties ?? {}).sort();
    expect(roots).toEqual([
      'approvalRequest',
      'approvalResume',
      'catalog',
      'changedFile',
      'flow',
      'jobIntent',
      'nodeExit',
      'runState',
      'suspendRequest',
    ]);
  });
});
